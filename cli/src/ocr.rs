//! Optional native capability. Document parsing and OCR policy stay in WASM.
use anyhow::{Result, bail, ensure};
use libloading::Library;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
        mpsc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

type JsonFn = unsafe extern "C" fn(*const u8, usize, *mut u8, usize) -> usize;

struct Native {
    _companion: Library,
    _library: Library,
    destroy: JsonFn,
    infer: JsonFn,
    handle: u64,
}

fn call(function: JsonFn, request: Value) -> Result<Value> {
    let mut payload = serde_json::to_vec(&request)?;
    let length = payload.len();
    payload.push(0);
    let mut output = vec![0; 4 << 20];
    // Both buffers remain live throughout the native JSON ABI invocation.
    let size = unsafe { function(payload.as_ptr(), length, output.as_mut_ptr(), output.len()) };
    ensure!(
        size > 0 && size <= output.len(),
        "invalid NCNN response length"
    );
    let value: Value =
        serde_json::from_slice(output[..size].strip_suffix(&[0]).unwrap_or(&output[..size]))?;
    ensure!(
        value["error"].as_str().unwrap_or("").is_empty(),
        "{}",
        value["error"]
    );
    Ok(value)
}

impl Native {
    fn open() -> Result<Self> {
        let path = PathBuf::from(std::env::var("FILENS_OCR_LIBRARY")?);
        let models = std::env::var("FILENS_OCR_MODEL_DIR")?;
        let companion = path.parent().unwrap().join(if cfg!(target_os = "macos") {
            "libncnn.dylib"
        } else {
            "libncnn.so"
        });
        // This is a single-threaded, isolated worker; set the runtime's lookup
        // path before opening either library.
        unsafe {
            std::env::set_var("ZIMAOS_NCNN_NATIVE_LIBRARY_PATH", &companion);
        }
        #[cfg(unix)]
        let companion: Library = unsafe {
            libloading::os::unix::Library::open(
                Some(&companion),
                libloading::os::unix::RTLD_NOW | libloading::os::unix::RTLD_GLOBAL,
            )?
            .into()
        };
        #[cfg(not(unix))]
        let companion = unsafe { Library::new(companion)? };
        let library = unsafe { Library::new(path)? };
        let create: JsonFn = unsafe { *library.get(b"zima_ncnn_create_json_v2\0")? };
        let destroy: JsonFn = unsafe { *library.get(b"zima_ncnn_destroy_json_v2\0")? };
        let load: JsonFn = unsafe { *library.get(b"zima_ncnn_load_json_v2\0")? };
        let infer: JsonFn = unsafe { *library.get(b"zima_ncnn_infer_json_v2\0")? };
        let handle = call(create, json!({}))?["handle_id"].as_u64().unwrap_or(0);
        ensure!(handle != 0, "NCNN returned an invalid handle");
        let native = Self {
            _companion: companion,
            _library: library,
            destroy,
            infer,
            handle,
        };
        let loaded = call(
            load,
            json!({"handle_id":handle,"model_class":"ocr","bundle_id":"rapidocr-ncnn","bundle_path":models,"backend_candidates":["cpu"],"allow_cpu_fallback":true,"thread_limit":2}),
        )?;
        ensure!(
            loaded["backend_effective"] == "cpu" && loaded["ocr_detection_outcome"] == true,
            "native OCR unavailable: {}",
            loaded["degrade_reason"]
        );
        Ok(native)
    }
    fn recognize(&self, request: &Value) -> Result<Value> {
        let deadline = request["deadline"]
            .as_u64()
            .unwrap_or_else(|| now_ms() + 30000);
        let response = call(
            self.infer,
            json!({
                "handle_id":self.handle,"model_class":"ocr","bundle_id":"rapidocr-ncnn","task":"ocr","thread_limit":2,"deadline_unix_milli":deadline,
                "input":{"image":request["path"],"params":{"padding":50,"max_side_len":960,"box_score_thresh":0.3,"box_thresh":0.3,"unclip_ratio":1.6,"run_det":true,"run_cls":true,"run_rec":true,"do_angle":true,"most_angle":false}}
            }),
        )?;
        let output = &response["output"];
        ensure!(
            output["ok"] == true,
            "native OCR failed: {}",
            output["error"]
        );
        let mut result = json!({"text":output["text"]});
        if request["layout"] == true {
            result["detail"] = output.clone();
        }
        Ok(result)
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        let _ = call(self.destroy, json!({"handle_id":self.handle}));
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn worker() -> Result<()> {
    let native = match Native::open() {
        Ok(n) => n,
        Err(e) => {
            println!("{}", json!({"error":e.to_string()}));
            return Err(e);
        }
    };
    let mut input = BufReader::new(std::io::stdin());
    loop {
        let mut line = String::new();
        if input.by_ref().take((1 << 20) + 1).read_line(&mut line)? == 0 {
            return Ok(());
        }
        ensure!(line.len() <= 1 << 20, "OCR request exceeds 1 MiB");
        let response = (|| -> Result<Value> {
            let request: Value = serde_json::from_str(&line)?;
            let mut response =
                json!({"provider":"rapidocr-ncnn","openmpThreads":2,"maxSideLen":960});
            if request["operation"] != "health" {
                let result = native.recognize(&request)?;
                for (key, value) in result.as_object().unwrap() {
                    response[key] = value.clone();
                }
            }
            Ok(response)
        })()
        .unwrap_or_else(|e| json!({"error":e.to_string()}));
        let mut out = std::io::stdout().lock();
        writeln!(out, "{response}")?;
        out.flush()?;
    }
}

struct Worker {
    child: Child,
    input: ChildStdin,
    responses: mpsc::Receiver<Result<String>>,
    pid: Arc<AtomicU32>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.pid.store(0, Ordering::SeqCst);
    }
}
pub struct Provider {
    pub enabled: bool,
    pub library: PathBuf,
    pub models: PathBuf,
    pid: Arc<AtomicU32>,
    worker: Option<Worker>,
}
impl Provider {
    pub fn new(bundle: &std::path::Path, enabled: bool, pid: Arc<AtomicU32>) -> Self {
        Self {
            enabled,
            library: std::env::var_os("FILENS_OCR_LIBRARY")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    bundle.join("native").join(if cfg!(target_os = "macos") {
                        "libzima_ncnn_runtime_v7.dylib"
                    } else {
                        "libzima_ncnn_runtime_v7.so"
                    })
                }),
            models: std::env::var_os("FILENS_OCR_MODEL_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| bundle.join("models/rapidocr-ncnn")),
            pid,
            worker: None,
        }
    }
    pub fn call(&mut self, mut request: Value) -> Result<Value> {
        ensure!(self.enabled, "OCR provider is unavailable");
        if self.worker.is_none() {
            let mut child = Command::new(std::env::current_exe()?)
                .arg("--ocr-worker")
                .env("OMP_NUM_THREADS", "2")
                .env("OMP_THREAD_LIMIT", "2")
                .env("GOMAXPROCS", "2")
                .env("FILENS_OCR_LIBRARY", &self.library)
                .env("FILENS_OCR_MODEL_DIR", &self.models)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()?;
            self.pid.store(child.id(), Ordering::SeqCst);
            let input = child.stdin.take().unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap());
            let (tx, responses) = mpsc::channel();
            std::thread::spawn(move || {
                loop {
                    let mut line = String::new();
                    let result = output
                        .by_ref()
                        .take((4 << 20) + 1)
                        .read_line(&mut line)
                        .map_err(anyhow::Error::from)
                        .and_then(|n| {
                            ensure!(n != 0, "RapidOCR worker exited");
                            ensure!(n <= 4 << 20, "OCR response exceeds limit");
                            Ok(line)
                        });
                    let failed = result.is_err();
                    if tx.send(result).is_err() || failed {
                        break;
                    }
                }
            });
            self.worker = Some(Worker {
                child,
                input,
                responses,
                pid: self.pid.clone(),
            });
        }
        request["deadline"] = json!(now_ms() + 30000);
        let result = (|| -> Result<Value> {
            let worker = self.worker.as_mut().unwrap();
            writeln!(worker.input, "{request}")?;
            worker.input.flush()?;
            let line = worker.responses.recv_timeout(Duration::from_secs(30))??;
            let value: Value = serde_json::from_str(&line)?;
            if let Some(error) = value["error"].as_str().filter(|s| !s.is_empty()) {
                bail!("{error}");
            }
            Ok(value)
        })();
        if result.is_err() {
            self.worker = None;
        }
        result
    }
    pub fn capacity(&mut self) -> Value {
        let mut result = json!({"provider":"rapidocr-ncnn","enabled":self.enabled,"available":false,"openmpThreads":2,"maxSideLen":960,"padding":50,"orientation":true});
        if self.enabled {
            match self.call(json!({"operation":"health"})) {
                Ok(v)
                    if v["provider"] == "rapidocr-ncnn"
                        && v["openmpThreads"] == 2
                        && v["maxSideLen"] == 960 =>
                {
                    result["available"] = json!(true)
                }
                Ok(_) => result["error"] = json!("unexpected RapidOCR health response"),
                Err(e) => result["error"] = json!(e.to_string()),
            }
        }
        result
    }
}
