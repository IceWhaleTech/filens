mod convert;
#[path = "../../wasm/converter-core-rust/src/text/native_search.rs"]
mod native_search;
mod ocr;
mod output;
mod pdf;
mod request;
mod runtime;
mod search;
mod similarity;
#[path = "../../wasm/converter-core-rust/src/text/catalog.rs"]
mod text_catalog;
mod walk;

use anyhow::{Result, ensure};
use request::Options;
use serde_json::{Value, json};
use std::{
    io::{IsTerminal, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

const HELP: &str = include_str!("../help.txt");
fn failure(response: &mut Value, code: &str, message: impl ToString) {
    response["ok"] = json!(false);
    response["error"] = json!({"code":code,"message":message.to_string()});
}
fn response(o: &Options) -> Value {
    let mut value = json!({"version":"filens-agent-v1","ok":false});
    if !o.request.operation.is_empty() {
        value["operation"] = json!(o.request.operation);
    }
    if !o.request.intent.is_empty() {
        value["intent"] = json!(o.request.intent);
    }
    value
}
fn finish(format: &str, value: &Value, code: i32) -> i32 {
    match output::write(format, value) {
        Ok(()) => code,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

fn run() -> Result<i32> {
    let mut args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--ocr-worker"] {
        ocr::worker()?;
        return Ok(0);
    }
    if args.is_empty() && !std::io::stdin().is_terminal() {
        args.push("-".into());
    }
    let mut options = Options::default();
    if let Err(e) = request::parse(&mut options, &args, std::io::stdin().lock()) {
        let mut value = response(&options);
        failure(&mut value, "invalid_request", e);
        let format =
            if options.structured && !request::FORMATS.contains(&options.request.format.as_str()) {
                "json"
            } else {
                &options.request.format
            };
        return Ok(finish(format, &value, 2));
    }
    if options.help {
        std::io::stdout().write_all(HELP.as_bytes())?;
        return Ok(0);
    }
    let mut value = response(&options);
    if options.request.operation != "capabilities" {
        let parts: Vec<_> = options.request.input.split("!/").collect();
        let archive_member = parts.len() > 1 && !matches!(options.request.operation.as_str(), "search" | "similar" | "convert")
            && std::fs::metadata(text_catalog::unescape_archive_path(parts[0])).is_ok_and(|m|m.is_file())
            && text_catalog::is_archive(&Path::new(parts[0]).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase());
        let physical_input = if archive_member { text_catalog::unescape_archive_path(parts[0]) } else { options.request.input.clone() };
        let metadata = match std::fs::metadata(&physical_input) {
            Ok(m) => m,
            Err(e) => {
                failure(&mut value, "io_error", e);
                return Ok(finish(&options.request.format, &value, 1));
            }
        };
        if matches!(options.request.operation.as_str(), "search" | "similar") {
            let archive = options.request.operation == "search" && metadata.is_file() && metadata.len() <= 256 << 20
                && text_catalog::is_archive(&Path::new(&options.request.input).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase());
            if !metadata.is_dir() && !archive {
                failure(
                    &mut value,
                    "invalid_input",
                    "search input must be a directory or supported archive; similar requires a directory",
                );
                return Ok(finish(&options.request.format, &value, 2));
            }
            value["source"] =
                json!({"path":std::fs::canonicalize(&options.request.input)?,"kind":if archive {"archive"}else{"directory"}});
        } else if !metadata.is_file() || metadata.len() > 256 << 20 {
            failure(
                &mut value,
                "invalid_input",
                "input must be a regular file no larger than 256 MiB",
            );
            return Ok(finish(&options.request.format, &value, 2));
        }
        if !matches!(options.request.operation.as_str(), "search" | "similar") {
            let path = std::path::absolute(&options.request.input)?;
            let mut format = path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            if options.request.operation == "convert" {
                format = options.request.source_format.clone();
            }
            value["source"] = json!({"path":path,"format":format,"bytes":metadata.len()});
            if archive_member {
                let outer = std::fs::canonicalize(&physical_input)?;
                value["source"]["path"] = json!(format!("{}!/{}",text_catalog::escape_archive_path(&outer.to_string_lossy()),parts[1..].join("!/")));
                value["source"]["archive"] = json!({"path":outer,"members":parts[1..].iter().map(|p|text_catalog::unescape_archive_path(p)).collect::<Vec<_>>()});
                value["source"]["archiveFormat"] = json!(Path::new(&physical_input).extension().unwrap().to_string_lossy().to_lowercase());
            }
        }
    }
    let work = tempfile::Builder::new().prefix("filens-text-").tempdir()?;
    let work_path = work.path().to_owned();
    let bundle = std::env::current_exe()?.parent().unwrap().to_owned();
    let canceled = Arc::new(AtomicBool::new(false));
    let pid = Arc::new(AtomicU32::new(0));
    let signal = canceled.clone();
    ctrlc::set_handler(move || {
        signal.store(true, Ordering::SeqCst);
    })?;
    let format = options.request.format.clone();
    let conversion = (options.request.operation == "convert").then(|| {
        (
            options.request.output.clone(),
            options.request.target_format.clone(),
            options.request.force,
        )
    });
    let timeout = options.timeout;
    let initial = value.clone();
    let worker_pid = pid.clone();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = execute(&options, value, &bundle, &work_path, worker_pid);
        let _ = tx.send(result);
    });
    let deadline = Instant::now() + timeout;
    loop {
        if canceled.load(Ordering::SeqCst) || Instant::now() >= deadline {
            ocr::terminate_worker(pid.load(Ordering::SeqCst));
            let mut value = initial;
            failure(
                &mut value,
                "canceled",
                if canceled.load(Ordering::SeqCst) {
                    "request canceled"
                } else {
                    "request deadline exceeded"
                },
            );
            return Ok(finish(&format, &value, 1));
        }
        match rx.recv_timeout(Duration::from_millis(20)) {
            Ok(Ok((mut value, code))) => {
                let is_canceled = || canceled.load(Ordering::SeqCst) || Instant::now() >= deadline;
                if is_canceled() {
                    continue;
                }
                if code == 0
                    && let Some((output, target, force)) = &conversion
                    && let Err(error) = convert::commit(
                        work.path(),
                        target,
                        &std::path::absolute(output)?,
                        *force,
                        is_canceled,
                    )
                {
                    value.as_object_mut().unwrap().remove("output");
                    failure(
                        &mut value,
                        if is_canceled() {
                            "canceled"
                        } else {
                            "io_error"
                        },
                        error,
                    );
                    return Ok(finish(&format, &value, 1));
                }
                return Ok(finish(&format, &value, code));
            }
            Ok(Err(e)) => {
                let mut value = initial;
                failure(&mut value, "engine_error", e);
                return Ok(finish(&format, &value, 1));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Err(e) => return Err(e.into()),
        }
    }
}

fn execute(
    o: &Options,
    mut response: Value,
    bundle: &Path,
    work: &Path,
    pid: Arc<AtomicU32>,
) -> Result<(Value, i32)> {
    let profile = std::env::var("FILENS_PROFILE")
        .ok()
        .filter(|s| s == "full" || s == "lite")
        .unwrap_or_else(|| {
            if cfg!(feature = "lite") {
                "lite"
            } else {
                "full"
            }
            .into()
        });
    let mut provider = ocr::Provider::new(bundle, o.ocr, pid.clone());
    if profile == "lite"
        && std::env::var_os("FILENS_OCR_LIBRARY").is_none()
        && !provider.library.is_file()
    {
        provider.enabled = false;
    }
    let wasm = if !o.wasm.is_empty() {
        PathBuf::from(&o.wasm)
    } else {
        std::env::var_os("FILENS_TEXT_WASM")
            .map(PathBuf::from)
            .unwrap_or_else(|| bundle.join("converter-text.wasm"))
    };
    let bundled_search = o.request.operation == "search"
        && o.wasm.is_empty()
        && std::env::var_os("FILENS_TEXT_WASM").is_none();
    let initialized = if bundled_search {
        runtime::Runtime::native_search(&wasm, work, bundle, provider)
    } else if o.request.operation == "search" {
        runtime::Runtime::for_search(&wasm, work, bundle, provider)
    } else {
        runtime::Runtime::new(&wasm, work, bundle, provider)
    };
    let mut engine = match initialized {
        Ok(e) => e,
        Err(e) => {
            failure(
                &mut response,
                "engine_unavailable",
                format!("read text WASM: {e}; run npm run build:agent or set FILENS_TEXT_WASM"),
            );
            return Ok((response, 1));
        }
    };
    if o.request.operation == "convert" {
        return convert::execute(o, response, engine, bundle, work, pid);
    }
    if o.request.operation == "search" && o.request.search_mode == "files" {
        // Filename search needs neither document capabilities nor extraction/OCR.
        return search::execute(o, response, &mut engine, work, &json!([]));
    }
    let capacity = if bundled_search {
        // The catalogue comes from the same frontend core, with no WASM start.
        Value::Array(text_catalog::formats())
    } else {
        match engine.run(
            &[
                "converter-text",
                "--operation",
                "text-capabilities",
                "--result",
                "/work/result.json",
            ]
            .map(String::from),
        ) {
            Ok(v) if v["ok"] == true && v["payload"].as_array().is_some_and(|a| !a.is_empty()) => {
                v["payload"].clone()
            }
            result => {
                failure(
                    &mut response,
                    "engine_unavailable",
                    format!("read WASM capabilities: {result:?}"),
                );
                return Ok((response, 1));
            }
        }
    };
    if o.request.operation == "capabilities" {
        let mut metadata: Value = serde_json::from_str(include_str!("../capacity.json"))?;
        metadata["profile"] = json!(profile);
        metadata["formats"] = capacity;
        metadata["ocr"] = engine.ocr_capacity();
        metadata["search"]["discovery"] = walk::capacity();
        metadata["similarity"]["discovery"] = walk::capacity();
        let conversion = convert::capabilities(&mut engine)?;
        metadata["conversionPairs"] = conversion["pairs"].clone();
        response["capacity"] = metadata;
        response["ok"] = json!(true);
        return Ok((response, 0));
    }
    if o.request.operation == "search" {
        return search::execute(o, response, &mut engine, work, &capacity);
    }
    if o.request.operation == "similar" {
        return similarity::execute(o, response, &mut engine, work);
    }
    extract_content(o, response, &mut engine, work, &capacity, false)
}

fn extract_content(
    o: &Options,
    mut response: Value,
    engine: &mut runtime::Runtime,
    work: &Path,
    capacity: &Value,
    prepared: bool,
) -> Result<(Value, i32)> {
    let source = response["source"]["format"].as_str().unwrap().to_owned();
    let archive = response["source"]["archive"].is_object();
    let input_source = if archive { response["source"]["archiveFormat"].as_str().unwrap() } else { &source };
    if !capacity
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["format"] == source && c["textExtraction"] == true)
    {
        failure(
            &mut response,
            "unsupported_format",
            format!("no text extraction for {source}; ask filens for its capabilities"),
        );
        return Ok((response, 2));
    }
    // Bound the copy as well as the initial stat: input can change while read.
    if !prepared {
        let mut input = std::fs::File::open(if archive {response["source"]["archive"]["path"].as_str().unwrap()} else {response["source"]["path"].as_str().unwrap()})?
            .take((256 << 20) + 1);
        let mut output = std::fs::File::create(work.join(format!("input.{input_source}")))?;
        let copied = std::io::copy(&mut input, &mut output)?;
        ensure!(
            copied <= 256 << 20,
            "input exceeded size limit while copying"
        );
    }
    let summary = (o.request.operation == "summarize").then(|| json!({
        "query":o.request.query,"maxChars":o.request.summary_chars.unwrap_or(2000),"ratio":o.request.summary_ratio.unwrap_or(0.3)
    }));
    let options = json!({"maxBytes":if o.request.max_bytes == 0 { 8 << 20 } else { o.request.max_bytes },"maxOCRPages":200,"includeStructure":o.request.format != "text" || o.request.operation == "understand" || o.request.layout,"includeLayout":o.request.layout,"outputFormat":o.request.format,"summary":summary,"archiveMembers":response["source"]["archive"]["members"],"archiveName":response["source"]["archive"]["path"].as_str().and_then(|p|Path::new(p).file_name()).and_then(|p|p.to_str())});
    std::fs::write(work.join("options.json"), serde_json::to_vec(&options)?)?;
    let args = [
        "converter-text",
        "--operation",
        "extract-text",
        "--input",
        &format!("/work/input.{input_source}"),
        "--output",
        "/work/text.txt",
        "--source",
        input_source,
        "--target",
        "text",
        "--options",
        "/work/options.json",
        "--result",
        "/work/result.json",
    ]
    .map(String::from);
    // A failed invocation must never reuse the capabilities result.
    if work.join("result.json").exists() {
        std::fs::remove_file(work.join("result.json"))?;
    }
    let wire = engine.run(&args)?;
    let Some(content) = wire.get("payload").filter(|v| v.is_object()) else {
        failure(
            &mut response,
            wire["errorCode"].as_str().unwrap_or("engine_error"),
            wire["errorMessage"]
                .as_str()
                .unwrap_or("missing extraction payload"),
        );
        return Ok((response, 3));
    };
    response["content"] = content.clone();
    if content["complete"] != true {
        failure(
            &mut response,
            content["errorCode"].as_str().unwrap_or("extraction_failed"),
            content["errorMessage"]
                .as_str()
                .unwrap_or("incomplete extraction"),
        );
        return Ok((response, 3));
    }
    if content["truncated"] == true {
        failure(
            &mut response,
            "content_truncated",
            "content limit reached; the returned text is incomplete",
        );
        return Ok((response, 3));
    }
    response["ok"] = json!(true);
    Ok((response, 0))
}

fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(e) => {
            eprintln!("filens: {e}");
            1
        }
    };
    std::process::exit(code);
}
