//! Conversion orchestration. Pair policy, format parsers, conversion and output
//! validation are implemented by the same WASM engines used by the frontend.
use crate::{failure, ocr::Provider, request::Options, runtime::Runtime};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicU32},
};

pub fn capabilities(engine: &mut Runtime) -> Result<Value> {
    let wire = engine.run(
        &[
            "converter-text",
            "--operation",
            "conversion-capabilities",
            "--result",
            "/work/result.json",
        ]
        .map(String::from),
    )?;
    ensure!(
        wire["ok"] == true
            && wire["payload"]["pairs"]
                .as_array()
                .is_some_and(|p| !p.is_empty()),
        "WASM conversion capabilities unavailable; rebuild the core"
    );
    Ok(wire["payload"].clone())
}

pub fn execute(
    o: &Options,
    mut response: Value,
    mut engine: Runtime,
    bundle: &Path,
    work: &Path,
    pid: Arc<AtomicU32>,
) -> Result<(Value, i32)> {
    let capacity = capabilities(&mut engine)?;
    let r = &o.request;
    let pair =
        |p: &Value| p["sourceFormat"] == r.source_format && p["targetFormat"] == r.target_format;
    if !capacity["pairs"].as_array().unwrap().iter().any(pair) {
        failure(
            &mut response,
            "unsupported_format",
            format!(
                "unsupported conversion pair: {} -> {}; inspect capacity.conversionPairs",
                r.source_format, r.target_format
            ),
        );
        return Ok((response, 2));
    }
    let image = capacity["imagePairs"]
        .as_array()
        .is_some_and(|pairs| pairs.iter().any(pair));
    if image {
        let path = std::env::var_os("FILENS_IMAGE_WASM")
            .map(PathBuf::from)
            .unwrap_or_else(|| bundle.join("converter-image.wasm"));
        engine = Runtime::new(&path, work, bundle, Provider::new(bundle, false, pid))?;
    }
    let mut input = std::fs::File::open(&r.input)?.take((256 << 20) + 1);
    let mut copied = std::fs::File::create(work.join(format!("input.{}", r.source_format)))?;
    ensure!(
        std::io::copy(&mut input, &mut copied)? <= 256 << 20,
        "input exceeded size limit while copying"
    );
    let options = if r.options.is_null() {
        json!({})
    } else {
        r.options.clone()
    };
    std::fs::write(work.join("options.json"), serde_json::to_vec(&options)?)?;
    let args = [
        if image {
            "converter-image"
        } else {
            "converter-text"
        },
        "--input",
        &format!("/work/input.{}", r.source_format),
        "--output",
        &format!("/work/converted.{}", r.target_format),
        "--source",
        &r.source_format,
        "--target",
        &r.target_format,
        "--options",
        "/work/options.json",
        "--result",
        "/work/result.json",
    ]
    .map(String::from);
    std::fs::remove_file(work.join("result.json"))?;
    let result = engine.run(&args)?;
    response["conversion"] = result.clone();
    if result["ok"] != true {
        let code = result["errorCode"].as_str().unwrap_or("conversion_failed");
        failure(
            &mut response,
            code,
            result["errorMessage"]
                .as_str()
                .unwrap_or("conversion failed"),
        );
        return Ok((response, if code == "unsupported_format" { 2 } else { 3 }));
    }
    let metadata = std::fs::metadata(work.join(format!("converted.{}", r.target_format)))?;
    ensure!(
        metadata.is_file() && metadata.len() > 0 && metadata.len() <= 256 << 20,
        "WASM produced invalid or oversized conversion output"
    );
    response["output"] = json!({"path":std::path::absolute(&r.output)?,"format":r.target_format,"bytes":metadata.len()});
    response["ok"] = json!(true);
    Ok((response, 0))
}

pub fn commit(
    work: &Path,
    target: &str,
    output: &Path,
    force: bool,
    canceled: impl Fn() -> bool,
) -> Result<()> {
    let parent = output.parent().unwrap();
    std::fs::create_dir_all(parent)?;
    let mut pending = tempfile::Builder::new()
        .prefix(".filens-output-")
        .tempfile_in(parent)?;
    let mut source = std::fs::File::open(work.join(format!("converted.{target}")))?;
    std::io::copy(&mut source, &mut pending)?;
    pending.as_file().sync_all()?;
    ensure!(!canceled(), "request canceled before output commit");
    // Commit only after the supervisor accepted the completed request. A
    // failed conversion or cancellation never replaces a destination file.
    if force {
        pending.persist(output)?;
    } else {
        pending.persist_noclobber(output)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canceled_commit_preserves_destination_and_cleans_staging_file() {
        let work = tempfile::tempdir().unwrap();
        std::fs::write(work.path().join("converted.docx"), b"new output").unwrap();
        let destination = work.path().join("existing.docx");
        std::fs::write(&destination, b"original output").unwrap();
        assert!(commit(work.path(), "docx", &destination, true, || true).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original output");
        assert_eq!(std::fs::read_dir(work.path()).unwrap().count(), 2);
        assert!(commit(work.path(), "docx", &destination, false, || false).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original output");
    }
}
