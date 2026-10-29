//! WASI plumbing and capability dispatch only; no document parsers live here.
use crate::{ocr::Provider, pdf::Pdf};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Component, Path, PathBuf},
};
use wasmi::{Caller, Engine, Instance, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};
use wasmi_wasi::{WasiCtx, WasiCtxBuilder};

pub struct State {
    pub wasi: WasiCtx,
    pub limits: StoreLimits,
    pub work: PathBuf,
    pub ocr: Provider,
    pub pdf: Option<Pdf>,
    pub pdf_path: PathBuf,
}
pub fn limits() -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(512 << 20)
        .memories(1)
        .instances(1)
        .build()
}

pub fn read_wasm(path: &Path) -> Result<Vec<u8>> {
    let compressed = path.with_extension("wasm.gz");
    // Accept explicit raw modules and compact npm resources. Decompress only
    // the module being used; PDFium stays lazy for non-PDF requests.
    if path.is_file() && path.extension().is_none_or(|e| e != "gz") {
        return Ok(std::fs::read(path)?);
    }
    let file = std::fs::File::open(if path.extension().is_some_and(|e| e == "gz") {
        path
    } else {
        &compressed
    })?;
    let mut bytes = vec![];
    flate2::read::GzDecoder::new(file)
        .take((64 << 20) + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 64 << 20, "decompressed WASM exceeds limit");
    Ok(bytes)
}

impl State {
    fn path(&self, value: &Value) -> Result<PathBuf> {
        let path = value.as_str().unwrap_or("");
        let relative = path
            .strip_prefix("/work/")
            .ok_or_else(|| anyhow::anyhow!("capability path must be inside /work"))?;
        let parts: Vec<_> = Path::new(relative).components().collect();
        ensure!(
            matches!(parts.as_slice(), [Component::Normal(_)]),
            "capability paths must be flat"
        );
        let local = self.work.join(relative);
        ensure!(
            !std::fs::symlink_metadata(&local).is_ok_and(|s| s.file_type().is_symlink()),
            "capability paths cannot be symbolic links"
        );
        Ok(local)
    }
    fn call(&mut self, mut request: Value) -> Result<Value> {
        let operation = request["operation"].as_str().unwrap_or("").to_owned();
        let path = if request.get("path").is_some() {
            Some(self.path(&request["path"])?)
        } else {
            None
        };
        if operation == "ocr" {
            request["path"] = json!(path.ok_or_else(|| anyhow::anyhow!("OCR path required"))?);
            return self.ocr.call(request);
        }
        ensure!(
            ["pdf_open", "pdf_text", "pdf_layout", "pdf_render"].contains(&operation.as_str()),
            "unknown extraction capability"
        );
        if self.pdf.is_none() {
            self.pdf = Some(Pdf::new(&self.pdf_path)?);
        }
        self.pdf.as_mut().unwrap().call(
            &operation,
            path.as_deref(),
            request["page"].as_i64().unwrap_or(0) as i32,
            request["dpi"].as_i64().unwrap_or(0) as i32,
        )
    }
}

pub struct Runtime {
    engine: Engine,
    module: Module,
    state: Option<State>,
}
impl Runtime {
    pub fn new(wasm: &Path, work: &Path, bundle: &Path, ocr: Provider) -> Result<Self> {
        let engine = Engine::default();
        let module = Module::new(&engine, &read_wasm(wasm)?[..])?;
        let state = State {
            wasi: WasiCtxBuilder::new().build(),
            limits: limits(),
            work: work.into(),
            ocr,
            pdf: None,
            pdf_path: std::env::var_os("FILENS_PDFIUM_WASM")
                .map(PathBuf::from)
                .unwrap_or_else(|| bundle.join("pdfium.wasm")),
        };
        Ok(Self {
            engine,
            module,
            state: Some(state),
        })
    }
    pub fn ocr_capacity(&mut self) -> Value {
        self.state.as_mut().unwrap().ocr.capacity()
    }
    pub fn ocr_cache_identity(&self) -> Result<Value> {
        use sha2::{Digest, Sha256};
        let provider = &self.state.as_ref().unwrap().ocr;
        let file_hash = |path: &Path| -> Result<String> {
            if !path.is_file() {
                return Ok("missing".into());
            }
            let mut file = std::fs::File::open(path)?;
            let mut hasher = Sha256::new();
            let mut buffer = [0; 65536];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
            }
            Ok(format!("{:x}", hasher.finalize()))
        };
        let mut models = vec![];
        if provider.enabled && provider.models.is_dir() {
            for entry in std::fs::read_dir(&provider.models)? {
                let entry = entry?;
                if entry.file_type()?.is_file()
                    && ["bin", "param", "txt"].contains(
                        &entry
                            .path()
                            .extension()
                            .and_then(|s| s.to_str())
                            .unwrap_or(""),
                    )
                {
                    models.push(json!({"name":entry.file_name().to_string_lossy(),"sha256":file_hash(&entry.path())?}));
                }
            }
            models.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        }
        Ok(
            json!({"enabled":provider.enabled,"library":if provider.enabled {file_hash(&provider.library)?} else {"disabled".into()},"models":models}),
        )
    }
    pub fn run(&mut self, args: &[String]) -> Result<Value> {
        self.run_with_directory(args, None)
    }
    pub fn run_with_directory(&mut self, args: &[String], input: Option<&Path>) -> Result<Value> {
        let work = self.state.as_ref().unwrap().work.clone();
        let directory = wasmi_wasi::Dir::open_ambient_dir(&work, wasmi_wasi::ambient_authority())?;
        let mut builder = WasiCtxBuilder::new();
        builder
            .args(args)?
            .inherit_stderr()
            .preopened_dir(directory, "/work")?;
        if let Some(root) = input {
            builder.preopened_dir(
                wasmi_wasi::Dir::open_ambient_dir(root, wasmi_wasi::ambient_authority())?,
                "/scan",
            )?;
        }
        let wasi = builder.build();
        let mut state = self.state.take().unwrap();
        state.wasi = wasi;
        let mut store = Store::new(&self.engine, state);
        store.limiter(|s| &mut s.limits);
        let mut linker = Linker::<State>::new(&self.engine);
        wasmi_wasi::add_to_linker(&mut linker, |s| &mut s.wasi)?;
        linker.func_wrap(
            "filens_text",
            "host_call",
            |mut caller: Caller<'_, State>, ptr: i32, len: i32, out: i32, cap: i32| -> i32 {
                let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) else {
                    return 0;
                };
                if !(0..=65536).contains(&len) || cap <= 0 {
                    return 0;
                }
                let mut data = vec![0; len as usize];
                if memory
                    .read(&caller, ptr as u32 as usize, &mut data)
                    .is_err()
                {
                    return 0;
                }
                let result = serde_json::from_slice(&data)
                    .map_err(anyhow::Error::from)
                    .and_then(|request| caller.data_mut().call(request))
                    .unwrap_or_else(|e| {
                        let code = if e.to_string().starts_with("password_required") {
                            "password_required"
                        } else if e.to_string().starts_with("parse_error") {
                            "parse_error"
                        } else {
                            "engine_unavailable"
                        };
                        json!({"error":e.to_string(),"errorCode":code})
                    });
                let Ok(bytes) = serde_json::to_vec(&result) else {
                    return 0;
                };
                if bytes.len() > cap as usize
                    || memory
                        .write(&mut caller, out as u32 as usize, &bytes)
                        .is_err()
                {
                    return 0;
                }
                bytes.len() as i32
            },
        )?;
        let mut status = 0;
        let result = (|| -> Result<Instance> {
            let instance = linker
                .instantiate(&mut store, &self.module)?
                .start(&mut store)?;
            let start = instance.get_typed_func::<(), ()>(&store, "_start")?;
            if let Err(e) = start.call(&mut store, ()) {
                match e.i32_exit_status() {
                    Some(code) => status = code,
                    None => return Err(e.into()),
                }
            }
            Ok(instance)
        })();
        self.state = Some(store.into_data());
        result?;
        let mut result = vec![];
        std::fs::File::open(work.join("result.json"))?
            .take((128 << 20) + 1)
            .read_to_end(&mut result)?;
        ensure!(result.len() <= 128 << 20, "WASM result exceeds limit");
        let value: Value = serde_json::from_slice(&result)?;
        ensure!(
            status == 0 || value["ok"] != true,
            "WASM exited with {status} after reporting success"
        );
        Ok(value)
    }
}
