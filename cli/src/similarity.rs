//! Host plumbing only: directory discovery, metadata and shared WASM invocation.
use crate::{failure, request::Options, runtime::Runtime, walk};
use anyhow::Result;
use serde_json::{Value, json};
use std::path::Path;

pub fn execute(
    o: &Options,
    mut response: Value,
    engine: &mut Runtime,
    work: &Path,
) -> Result<(Value, i32)> {
    let root = std::fs::canonicalize(&o.request.input)?;
    let extensions = if o.request.similarity_mode == "duplicates" {
        json!(["*"])
    } else {
        json!([
            "png", "jpg", "jpeg", "jpe", "jfif", "webp", "gif", "bmp", "tif", "tiff"
        ])
    };
    let max_files = o.request.max_files.unwrap_or(2000);
    let config = json!({"extensions":extensions,"exclude":[".git","node_modules","target","dist"],
        "maxFiles":max_files,"maxDepth":o.request.max_depth.unwrap_or(32),
        "maxEntries":(max_files*100).min(1_000_000),"includeHidden":o.request.include_hidden});
    let mut scan = walk::scan(&root, work, &config)?;
    let mut files = vec![];
    for entry in &scan.entries {
        let mut source = json!({"path":entry.path,"bytes":entry.bytes});
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            match std::fs::symlink_metadata(root.join(&entry.path)) {
                Ok(metadata) => {
                    source["identity"] = json!(format!("{}:{}", metadata.dev(), metadata.ino()));
                }
                Err(error) => {
                    scan.error_count += 1;
                    if scan.errors.len() < 64 {
                        scan.errors.push(walk::Issue {
                            path: entry.path.clone(),
                            message: error.to_string(),
                        });
                    }
                    continue;
                }
            }
        }
        files.push(source);
    }
    std::fs::write(
        work.join("similarity.json"),
        serde_json::to_vec(&json!({
            "mode":o.request.similarity_mode,"threshold":o.request.threshold.unwrap_or(8),
            "maxResults":o.request.max_results.unwrap_or(100),"format":o.request.format,"files":files
        }))?,
    )?;
    let result_path = work.join("result.json");
    if result_path.exists() {
        std::fs::remove_file(result_path)?;
    }
    let wire = engine.run_with_directory(
        &[
            "converter-text",
            "--operation",
            "scan-similar",
            "--input",
            "/work/similarity.json",
            "--output",
            "/work/similarity.txt",
            "--source",
            "json",
            "--target",
            "text",
            "--result",
            "/work/result.json",
        ]
        .map(String::from),
        Some(&root),
    )?;
    if wire["ok"] != true || !wire["payload"].is_object() {
        failure(
            &mut response,
            wire["errorCode"].as_str().unwrap_or("similarity_failed"),
            wire["errorMessage"]
                .as_str()
                .unwrap_or("WASM similarity scan failed"),
        );
        return Ok((response, 1));
    }
    response["similarity"] = wire["payload"]["similarity"].clone();
    response["content"] = wire["payload"]["content"].clone();
    response["similarity"]["scan"] = json!({"backend":scan.backend,"visited":scan.visited,"discoveredFiles":scan.entries.len(),
        "skipped":scan.skipped,"truncated":scan.truncated,"errorCount":scan.error_count,"errors":scan.errors});
    response["similarity"]["scope"] = config;
    let complete =
        response["similarity"]["complete"] == true && scan.error_count == 0 && !scan.truncated;
    let truncated = response["similarity"]["truncated"] == true || scan.truncated;
    response["similarity"]["complete"] = json!(complete);
    response["content"]["complete"] = json!(complete);
    response["similarity"]["truncated"] = json!(truncated);
    response["content"]["truncated"] = json!(truncated);
    response["ok"] = json!(complete);
    if !complete {
        failure(
            &mut response,
            "similarity_incomplete",
            "similarity coverage is incomplete; inspect scan, processing errors and limits",
        );
    }
    Ok((response, if complete { 0 } else { 3 }))
}
