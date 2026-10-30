//! Search orchestration only; no persistent index, cache or source hashing. Extraction, chunks, ranking and exports use WASM.
use crate::{request::Options, runtime::Runtime, walk};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path},
};

#[derive(Default)]
struct Extracted {
    content: HashMap<usize, Value>,
    errors: Vec<(usize, String)>,
    truncated: bool,
    batches: usize,
    native_files: usize,
}
impl Extracted {
    fn merge(&mut self, other: Self) {
        self.content.extend(other.content);
        self.errors.extend(other.errors);
        self.truncated |= other.truncated;
        self.batches += other.batches;
        self.native_files += other.native_files;
    }
}

fn batches(
    engine: &mut Runtime,
    work: &Path,
    root: &Path,
    entries: &[walk::Entry],
    ids: &[usize],
    ocr_formats: &HashSet<String>,
    options: &Value,
) -> Result<Extracted> {
    let mut result = Extracted::default();
    for ids in ids.chunks(256) {
        let mut inputs = Vec::new();
        for &id in ids {
            let relative = Path::new(&entries[id].path);
            let extension = relative
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if engine.uses_native_search()
                && options["includeLayout"] != true
                && crate::native_search::supports_plain(&extension)
            {
                result.native_files += 1;
                result.content.insert(
                    id,
                    json!({"content":crate::native_search::extract_plain(
                        &root.join(relative),
                        options["maxBytes"].as_u64().unwrap_or(8 << 20) as usize,
                    )}),
                );
                continue;
            }
            inputs.push(
                json!({"id":id,"input":format!("/scan/{}", entries[id].path.replace('\\', "/")),
                "source":extension,"copyInput":ocr_formats.contains(&extension)}),
            );
        }
        if inputs.is_empty() {
            continue;
        }
        std::fs::write(
            work.join("extract-batch.json"),
            serde_json::to_vec(&json!({"files":inputs,"options":options}))?,
        )?;
        if work.join("result.json").exists() {
            std::fs::remove_file(work.join("result.json"))?;
        }
        result.batches += 1;
        let wire = engine.run_with_directory(
            &[
                "converter-text",
                "--operation",
                "extract-batch",
                "--input",
                "/work/extract-batch.json",
                "--output",
                "/work/text.txt",
                "--source",
                "json",
                "--target",
                "text",
                "--result",
                "/work/result.json",
            ]
            .map(String::from),
            Some(root),
        );
        match wire {
            Ok(wire) if wire["ok"] == true => {
                result.truncated |= wire["payload"]["truncated"] == true;
                for file in wire["payload"]["files"]
                    .as_array()
                    .ok_or_else(|| anyhow::anyhow!("missing extraction batch outcomes"))?
                {
                    let id = file["id"]
                        .as_u64()
                        .ok_or_else(|| anyhow::anyhow!("missing extraction batch id"))?
                        as usize;
                    ensure!(ids.contains(&id), "unexpected extraction batch id");
                    result.content.insert(id, file.clone());
                }
            }
            error => {
                for input in &inputs {
                    result.errors.push((
                        input["id"].as_u64().unwrap() as usize,
                        format!("WASM extraction batch: {error:?}"),
                    ));
                }
            }
        }
        if result.truncated {
            break;
        }
    }
    Ok(result)
}

pub fn execute(
    o: &Options,
    mut response: Value,
    engine: &mut Runtime,
    work: &Path,
    capacity: &Value,
) -> Result<(Value, i32)> {
    let input = Path::new(response["source"]["path"].as_str().unwrap());
    let single_archive = input.is_file();
    let root = if single_archive { input.parent().unwrap() } else { input };
    let extensions: Vec<_> = if o.request.search_mode == "files" {
        vec![json!("*")]
    } else {
        capacity
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["textExtraction"] == true || c["archiveSearch"] == true)
            .map(|c| c["format"].clone())
            .collect()
    };
    let max_files = o.request.max_files.unwrap_or(2000);
    let config = json!({"extensions":extensions,"maxFiles":max_files,"maxEntries":(max_files*100).min(1000000),
        "maxDepth":o.request.max_depth.unwrap_or(32),"includeHidden":o.request.include_hidden,"exclude":[".git","node_modules","target","dist"]});
    let started = std::time::Instant::now();
    let mut scan = if single_archive {
        walk::Scan { backend:"single-archive".into(), visited:1,
            entries:vec![walk::Entry {path:input.file_name().unwrap().to_string_lossy().into_owned(),bytes:input.metadata()?.len()}],
            ..Default::default() }
    } else { walk::scan(root, work, &config)? };
    let discovery_ms = started.elapsed().as_millis();
    let mut files = Vec::new();
    let mut text_bytes = 0;
    let mut extraction_errors = Vec::new();
    let mut extraction_error_count = 0;
    let mut incomplete_sources = 0;
    let mut entries = std::mem::take(&mut scan.entries);
    entries.retain(|entry| {
        let valid = Path::new(&entry.path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
        if !valid {
            scan.issue(entry.path.clone(), "invalid relative discovery path".into());
        }
        valid
    });
    let configured_jobs = std::env::var("FILENS_SEARCH_JOBS")
        .ok()
        .map(|s| s.parse::<usize>())
        .transpose()?;
    ensure!(
        configured_jobs.is_none_or(|n| (1..=8).contains(&n)),
        "FILENS_SEARCH_JOBS must be between 1 and 8"
    );
    let mut jobs = 1;
    let mut extracted = Extracted::default();
    if o.request.search_mode != "files" {
        let ocr_formats: HashSet<String> = capacity
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["ocr"] == true || c["archiveSearch"] == true)
            .filter_map(|c| c["format"].as_str().map(String::from))
            .collect();
        let options = json!({"maxBytes":if o.request.max_bytes == 0 { 8 << 20 } else { o.request.max_bytes },
            "maxOCRPages":200,"includeStructure":false,"includeLayout":o.request.layout,"outputFormat":"json",
            "maxArchiveFiles":max_files,"includeHidden":o.request.include_hidden,"maxDepth":o.request.max_depth.unwrap_or(32)});
        jobs = configured_jobs.unwrap_or_else(|| {
            let source_bytes = entries.iter().map(|entry| entry.bytes).sum::<u64>();
            if source_bytes <= 8 << 20 {
                1
            } else {
                std::thread::available_parallelism().map_or(1, usize::from).min(4)
            }
        });
        if entries.len() < 32 {
            jobs = 1;
        }
        if jobs == 1 {
            extracted = batches(
                engine,
                work,
                root,
                &entries,
                &(0..entries.len()).collect::<Vec<_>>(),
                &ocr_formats,
                &options,
            )?;
        } else {
            let (ocr_ids, plain_ids): (Vec<_>, Vec<_>) = (0..entries.len()).partition(|&id| {
                let extension = Path::new(&entries[id].path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                ocr_formats.contains(&extension)
            });
            let plain_workers = jobs
                .saturating_sub(usize::from(!ocr_ids.is_empty()))
                .max(1)
                .min(plain_ids.len());
            jobs = plain_workers + usize::from(!ocr_ids.is_empty());
            if entries.iter().any(|entry| {
                let extension = Path::new(&entry.path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                !engine.uses_native_search()
                    || o.request.layout
                    || !crate::native_search::supports_plain(&extension)
            }) {
                engine.ensure_loaded()?;
            }
            let mut workers = Vec::new();
            if plain_workers > 0 {
                for ids in plain_ids.chunks(plain_ids.len().div_ceil(plain_workers)) {
                    let directory = tempfile::Builder::new()
                        .prefix("search-worker-")
                        .tempdir_in(work)?;
                    let runtime = engine.fork_without_ocr(directory.path())?;
                    workers.push((runtime, directory, ids));
                }
            }
            std::thread::scope(|scope| -> Result<()> {
                let handles: Vec<_> = workers
                    .into_iter()
                    .map(|(mut runtime, directory, ids)| {
                        let entries = &entries;
                        let options = &options;
                        let ocr_formats = &ocr_formats;
                        scope.spawn(move || {
                            batches(
                                &mut runtime,
                                directory.path(),
                                root,
                                entries,
                                ids,
                                ocr_formats,
                                options,
                            )
                        })
                    })
                    .collect();
                if !ocr_ids.is_empty() {
                    extracted.merge(batches(
                        engine,
                        work,
                        root,
                        &entries,
                        &ocr_ids,
                        &ocr_formats,
                        &options,
                    )?);
                }
                for handle in handles {
                    extracted.merge(
                        handle
                            .join()
                            .map_err(|_| anyhow::anyhow!("search worker failed"))??,
                    );
                }
                Ok(())
            })?;
        }
        scan.truncated |= extracted.truncated;
        for (id, error) in &extracted.errors {
            scan.issue(entries[*id].path.clone(), error.clone());
        }
    }
    if o.request.search_mode == "files" {
        let ids: Vec<_> = entries.iter().enumerate().filter(|(_, entry)| {
            crate::text_catalog::is_archive(&Path::new(&entry.path).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase())
        }).map(|(id, _)| id).collect();
        if !ids.is_empty() {
            extracted = batches(engine, work, root, &entries, &ids, &HashSet::new(), &json!({
                "archiveNamesOnly":true,"maxArchiveFiles":max_files,"includeHidden":o.request.include_hidden,
                "maxDepth":o.request.max_depth.unwrap_or(32)
            }))?;
            scan.truncated |= extracted.truncated;
            for (id, error) in &extracted.errors { scan.issue(entries[*id].path.clone(), error.clone()); }
        }
    }
    let extraction_batches = extracted.batches;
    let native_files = extracted.native_files;
    let mut archive_files = 0;
    let mut archive_visited = 0;
    let mut archive_expanded_bytes = 0;
    'sources: for (id, entry) in entries.iter().enumerate() {
        let path = root.join(&entry.path);
        if o.request.search_mode == "files" {
            if files.len() >= max_files { scan.truncated = true; break; }
            files.push(json!({"path":path,"relativePath":entry.path,"sha256":"","text":"","layout":null,"complete":true}));
        }
        let Some(outcome) = extracted.content.remove(&id) else {
            continue;
        };
        let archive = &outcome["archive"];
        let members;
        let outcomes = if archive.is_object() {
            archive_visited += archive["visited"].as_u64().unwrap_or(0);
            archive_expanded_bytes += archive["expandedBytes"].as_u64().unwrap_or(0);
            scan.truncated |= archive["truncated"] == true;
            extraction_error_count += archive["errorCount"].as_u64().unwrap_or(0) as usize;
            for error in archive["errors"].as_array().into_iter().flatten() {
                if extraction_errors.len() < 64 {
                    let suffix = error["members"].as_array().into_iter().flatten().filter_map(Value::as_str).map(crate::text_catalog::escape_archive_path).collect::<Vec<_>>().join("!/");
                    extraction_errors.push(json!({"path":if suffix.is_empty(){path.to_string_lossy().into_owned()}else{format!("{}!/{suffix}",crate::text_catalog::escape_archive_path(&path.to_string_lossy()))},"error":{"code":error["code"],"message":error["message"]}}));
                }
            }
            archive["files"].as_array().unwrap().as_slice()
        } else {
            members = vec![outcome.clone()];
            members.as_slice()
        };
        for item in outcomes {
        if files.len() >= max_files { scan.truncated = true; break 'sources; }
        let content = &item["content"];
        let virtual_path = item["memberPath"].as_str().map(|s| format!("{}!/{s}",crate::text_catalog::escape_archive_path(&path.to_string_lossy())));
        let source_path = virtual_path.clone().unwrap_or_else(||path.to_string_lossy().into_owned());
        if content["complete"] != true || content["truncated"] == true {
            extraction_error_count += 1;
            if extraction_errors.len() < 64 {
                extraction_errors.push(json!({"path":source_path,"error":{"code":content["errorCode"],"message":content["errorMessage"]}}));
            }
        }
        let text = content["text"].as_str().unwrap_or("");
        if text_bytes + text.len() > 32 << 20 {
            scan.truncated = true;
            break 'sources;
        }
        text_bytes += text.len();
        let source_complete = content["complete"] == true && content["truncated"] != true;
        if !source_complete {
            incomplete_sources += 1;
        }
        let mut source = json!({"path":source_path,"relativePath":virtual_path.as_ref().map_or_else(||entry.path.clone(),|_|format!("{}!/{}",entry.path,item["members"].as_array().unwrap().iter().filter_map(Value::as_str).collect::<Vec<_>>().join("!/"))),"sha256":"","text":text,"layout":content["layout"],"complete":source_complete});
        if virtual_path.is_some() {
            archive_files += 1;
            source["archive"] = json!({"path":path,"members":item["members"]});
        }
        files.push(source);
        }
    }
    let corpus = json!({"query":o.request.query,"mode":o.request.search_mode,"limit":o.request.max_results.unwrap_or(10),"format":o.request.format,"files":files});
    let payload = if engine.uses_native_search() {
        match crate::native_search::evaluate(corpus) {
            Ok(value) => value,
            Err(error) => {
                crate::failure(&mut response, "search_failed", error);
                return Ok((response, 2));
            }
        }
    } else {
        std::fs::write(
            work.join("search-corpus.json"),
            serde_json::to_vec(&corpus)?,
        )?;
        if work.join("result.json").exists() {
            std::fs::remove_file(work.join("result.json"))?;
        }
        let wire = engine.run(
            &[
                "converter-text",
                "--operation",
                "search-text",
                "--input",
                "/work/search-corpus.json",
                "--output",
                "/work/search.txt",
                "--source",
                "json",
                "--target",
                "text",
                "--result",
                "/work/result.json",
            ]
            .map(String::from),
        )?;
        if wire["ok"] != true {
            crate::failure(
                &mut response,
                "search_failed",
                wire["errorMessage"]
                    .as_str()
                    .unwrap_or("WASM search failed"),
            );
            return Ok((response, 2));
        }
        wire["payload"].clone()
    };
    response["search"] = payload["search"].clone();
    response["content"] = payload["content"].clone();
    response["search"]["scan"] = json!({"backend":scan.backend,"visited":scan.visited,"discoveredFiles":entries.len(),"skipped":scan.skipped,"truncated":scan.truncated,
        "discoveryMs":discovery_ms,"errors":scan.errors,"errorCount":scan.error_count,"extractionErrors":extraction_errors,"extractionErrorCount":extraction_error_count,
        "incompleteSources":incomplete_sources,"textBytes":text_bytes,"archives":{"files":archive_files,"visited":archive_visited,"expandedBytes":archive_expanded_bytes,"maxDepth":8,"maxExpandedBytesPerBatch":268435456},"cache":{"enabled":false,"storage":"none","hits":0,"writes":0,"errors":0},"integrity":"assumed","execution":{"workers":jobs,"sharedTextModules":engine.loaded_modules(),"nativeFiles":native_files,"ranking":if engine.uses_native_search(){"native-rust"}else{"wasm"},"extractionBatches":extraction_batches,"batchSize":256}});
    response["search"]["scope"] = config;
    let complete = response["search"]["complete"] == true
        && !scan.truncated
        && scan.error_count == 0
        && extraction_error_count == 0
        && incomplete_sources == 0;
    response["search"]["complete"] = json!(complete);
    response["content"]["complete"] = json!(complete);
    response["content"]["truncated"] =
        json!(scan.truncated || response["search"]["truncated"] == true);
    response["search"]["truncated"] = response["content"]["truncated"].clone();
    response["ok"] = json!(complete);
    if !complete {
        crate::failure(
            &mut response,
            "search_incomplete",
            "search coverage is incomplete; inspect search.scan and sourceComplete before using the results",
        );
    }
    Ok((response, if complete { 0 } else { 3 }))
}
