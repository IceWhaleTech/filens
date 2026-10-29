//! Search orchestration/cache only. Extraction, chunks, ranking and exports use WASM.
use crate::{request::Options, runtime::Runtime, walk};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn cache_root() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("FILENS_SEARCH_CACHE_DIR") {
        return Some(path.into());
    }
    if let Some(path) = std::env::var_os("XDG_CACHE_HOME") {
        return Some(PathBuf::from(path).join("filens/search-v1"));
    }
    if cfg!(windows) {
        return std::env::var_os("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("filens/cache/search-v1"));
    }
    std::env::var_os("HOME").map(|p| {
        PathBuf::from(p).join(if cfg!(target_os = "macos") {
            "Library/Caches/filens/search-v1"
        } else {
            ".cache/filens/search-v1"
        })
    })
}
fn read_cache(path: &Path, fingerprint: &str) -> Option<Value> {
    let mut bytes = vec![];
    std::fs::File::open(path)
        .ok()?
        .take((64 << 20) + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 64 << 20 {
        return None;
    }
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    (value["fingerprint"] == fingerprint
        && value["content"]["text"].is_string()
        && value["content"]["complete"] == true
        && value["content"]["truncated"] == false)
        .then(|| value["content"].clone())
}
fn write_cache(path: &Path, fingerprint: &str, content: &Value) -> Result<()> {
    let directory = path.parent().unwrap();
    std::fs::create_dir_all(directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer(
        &mut temporary,
        &json!({"fingerprint":fingerprint,"content":content}),
    )?;
    temporary.flush()?;
    temporary.persist(path)?;
    Ok(())
}
fn read_source(path: &Path) -> Result<Vec<u8>> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.len() <= 256 << 20,
        "source must be a regular file no larger than 256 MiB"
    );
    let mut bytes = Vec::with_capacity((metadata.len() as usize).min(8 << 20));
    Read::by_ref(&mut file)
        .take((256 << 20) + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 256 << 20, "source grew beyond 256 MiB");
    Ok(bytes)
}
pub fn execute(
    o: &Options,
    mut response: Value,
    engine: &mut Runtime,
    work: &Path,
    capacity: &Value,
    wasm: &Path,
) -> Result<(Value, i32)> {
    let root = Path::new(response["source"]["path"].as_str().unwrap());
    let extensions: Vec<_> = if o.request.search_mode == "files" {
        vec![json!("*")]
    } else {
        capacity
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["textExtraction"] == true)
            .map(|c| c["format"].clone())
            .collect()
    };
    let max_files = o.request.max_files.unwrap_or(2000);
    let config = json!({"extensions":extensions,"maxFiles":max_files,"maxEntries":(max_files*100).min(1000000),
        "maxDepth":o.request.max_depth.unwrap_or(32),"includeHidden":o.request.include_hidden,"exclude":[".git","node_modules","target","dist"]});
    let started = std::time::Instant::now();
    let mut scan = walk::scan(root, work, &config)?;
    let discovery_ms = started.elapsed().as_millis();
    let fingerprint = hash(&serde_json::to_vec(&json!({
        "engine":hash(&crate::runtime::read_wasm(wasm)?),"ocr":engine.ocr_cache_identity()?,"maxBytes":o.request.max_bytes,"layout":o.request.layout,
    }))?);
    let cache = if o.request.cache.unwrap_or(true) && o.request.search_mode != "files" {
        cache_root().map(|p| p.join(hash(root.to_string_lossy().as_bytes())))
    } else {
        None
    };
    let mut cache_hits = 0;
    let mut cache_writes = 0;
    let mut cache_errors = 0;
    let mut current_keys = HashSet::new();
    let mut files = Vec::new();
    let mut text_bytes = 0;
    let mut extraction_errors = Vec::new();
    let mut extraction_error_count = 0;
    let mut incomplete_sources = 0;
    let entries = std::mem::take(&mut scan.entries);
    for entry in &entries {
        let relative = Path::new(&entry.path);
        if relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            scan.issue(entry.path.clone(), "invalid relative discovery path".into());
            continue;
        }
        let path = root.join(relative);
        if o.request.search_mode == "files" {
            files.push(json!({"path":path,"relativePath":entry.path,"sha256":"","text":"","layout":null,"complete":true}));
            continue;
        }
        let source = match read_source(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                scan.issue(entry.path.clone(), error.to_string());
                continue;
            }
        };
        let source_hash = hash(&source);
        let key = format!("{}.json", hash(entry.path.as_bytes()));
        current_keys.insert(key.clone());
        let cache_file = cache.as_ref().map(|p| p.join(&key));
        let file_fingerprint = hash(format!("{fingerprint}:{source_hash}").as_bytes());
        let content = if let Some(content) = cache_file
            .as_ref()
            .and_then(|p| read_cache(p, &file_fingerprint))
        {
            cache_hits += 1;
            content
        } else {
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            std::fs::write(work.join(format!("input.{extension}")), &source)?;
            let mut options = o.clone();
            options.request.operation = "read".into();
            options.request.format = "json".into();
            options.request.query.clear();
            let initial = json!({"version":"filens-agent-v1","operation":"read","source":{"path":path,"format":extension,"bytes":source.len()}});
            let (result, code) =
                match crate::extract_content(&options, initial, engine, work, capacity, true) {
                    Ok(value) => value,
                    Err(error) => {
                        scan.issue(entry.path.clone(), error.to_string());
                        continue;
                    }
                };
            if code != 0 {
                extraction_error_count += 1;
                if extraction_errors.len() < 64 {
                    extraction_errors.push(json!({"path":path,"error":result["error"]}));
                }
            }
            let Some(content) = result.get("content") else {
                continue;
            };
            if code == 0
                && let Some(cache_file) = &cache_file
            {
                match write_cache(cache_file, &file_fingerprint, content) {
                    Ok(()) => cache_writes += 1,
                    Err(_) => cache_errors += 1,
                }
            }
            content.clone()
        };
        let text = content["text"].as_str().unwrap_or("");
        if text_bytes + text.len() > 32 << 20 {
            scan.truncated = true;
            break;
        }
        text_bytes += text.len();
        let source_complete = content["complete"] == true && content["truncated"] != true;
        if !source_complete {
            incomplete_sources += 1;
        }
        files.push(json!({"path":path,"relativePath":entry.path,"sha256":source_hash,"text":text,"layout":content["layout"],"complete":source_complete}));
    }
    if !scan.truncated
        && scan.error_count == 0
        && let Some(cache) = &cache
    {
        if let Ok(entries) = std::fs::read_dir(cache) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.len() == 69
                    && name.ends_with(".json")
                    && name[..64].bytes().all(|b| b.is_ascii_hexdigit())
                    && !current_keys.contains(&name)
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    let corpus = json!({"query":o.request.query,"mode":o.request.search_mode,"limit":o.request.max_results.unwrap_or(10),"format":o.request.format,"files":files});
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
    response["search"] = wire["payload"]["search"].clone();
    response["content"] = wire["payload"]["content"].clone();
    response["search"]["scan"] = json!({"backend":scan.backend,"visited":scan.visited,"discoveredFiles":entries.len(),"skipped":scan.skipped,"truncated":scan.truncated,
        "discoveryMs":discovery_ms,"errors":scan.errors,"errorCount":scan.error_count,"extractionErrors":extraction_errors,"extractionErrorCount":extraction_error_count,
        "incompleteSources":incomplete_sources,"textBytes":text_bytes,"cache":{"enabled":cache.is_some(),"hits":cache_hits,"writes":cache_writes,"errors":cache_errors}});
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
