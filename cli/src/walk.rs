//! Directory discovery: native FTS on macOS, embedded private hdrw WASI elsewhere.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(target_os = "macos")]
use std::collections::HashSet;
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
use std::io::Read;
use std::path::Path;

#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
const HDRW: &[u8] = include_bytes!("../assets/hdrw.wasm.gz");

#[derive(Deserialize, Serialize)]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
}
#[derive(Deserialize, Serialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub backend: String,
    pub entries: Vec<Entry>,
    pub errors: Vec<Issue>,
    pub error_count: usize,
    pub visited: usize,
    pub skipped: usize,
    pub truncated: bool,
}
impl Scan {
    pub fn issue(&mut self, path: String, message: String) {
        self.error_count += 1;
        if self.errors.len() < 64 {
            self.errors.push(Issue { path, message });
        }
    }
}
pub fn capacity() -> Value {
    json!({"backend": if cfg!(target_os="macos") { "fts" } else { "hdrw-wasi" },
        "hdrwEmbedded": cfg!(any(not(target_os="macos"), feature="hdrw-wasi")),
        "rawDevices":false,"followSymlinks":false})
}
pub fn scan(root: &Path, work: &Path, config: &Value) -> Result<Scan> {
    let backend = std::env::var("FILENS_WALKER").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "fts"
        } else {
            "hdrw-wasi"
        }
        .into()
    });
    let mut result = if backend == "hdrw-wasi" {
        wasm(root, work, config)?
    } else {
        ensure!(backend == "fts", "unknown directory walker");
        #[cfg(target_os = "macos")]
        {
            native(root, config)?
        }
        #[cfg(not(target_os = "macos"))]
        {
            anyhow::bail!("FTS walker is only available on macOS")
        }
    };
    result.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}
#[cfg(not(any(not(target_os = "macos"), feature = "hdrw-wasi")))]
fn wasm(_root: &Path, _work: &Path, _config: &Value) -> Result<Scan> {
    anyhow::bail!("This macOS build uses native FTS and does not embed hdrw")
}
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
fn wasm(root: &Path, work: &Path, config: &Value) -> Result<Scan> {
    use wasmi::{Engine, Linker, Module, Store};
    use wasmi_wasi::{Dir, WasiCtx, WasiCtxBuilder, ambient_authority};
    struct State {
        wasi: WasiCtx,
        limits: wasmi::StoreLimits,
    }
    std::fs::write(work.join("walk-options.json"), serde_json::to_vec(config)?)?;
    let mut bytes = vec![];
    flate2::read::GzDecoder::new(HDRW)
        .take((32 << 20) + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 32 << 20, "hdrw module exceeds limit");
    let engine = Engine::default();
    let module = Module::new(&engine, &bytes[..])?;
    let wasi = WasiCtxBuilder::new()
        .arg("hdrw-wasi")?
        .inherit_stderr()
        .preopened_dir(Dir::open_ambient_dir(root, ambient_authority())?, "/scan")?
        .preopened_dir(Dir::open_ambient_dir(work, ambient_authority())?, "/work")?
        .build();
    let mut store = Store::new(
        &engine,
        State {
            wasi,
            limits: crate::runtime::limits(),
        },
    );
    store.limiter(|state| &mut state.limits);
    let mut linker = Linker::<State>::new(&engine);
    wasmi_wasi::add_to_linker(&mut linker, |state| &mut state.wasi)?;
    let instance = linker.instantiate(&mut store, &module)?.start(&mut store)?;
    if let Err(error) = instance
        .get_typed_func::<(), ()>(&store, "_start")?
        .call(&mut store, ())
    {
        ensure!(error.i32_exit_status() == Some(0), "hdrw WASI: {error}");
    }
    let mut output = vec![];
    std::fs::File::open(work.join("walk-result.json"))?
        .take((16 << 20) + 1)
        .read_to_end(&mut output)?;
    ensure!(output.len() <= 16 << 20, "directory response exceeds limit");
    Ok(serde_json::from_slice(&output)?)
}

#[cfg(target_os = "macos")]
fn native(root: &Path, config: &Value) -> Result<Scan> {
    use std::{
        ffi::{CStr, CString},
        os::unix::ffi::OsStrExt,
    };
    struct Context<'a> {
        root: &'a Path,
        config: &'a Value,
        extensions: HashSet<String>,
        excluded: HashSet<String>,
        result: Scan,
    }
    unsafe extern "C" {
        fn filens_fts_walk(
            root: *const libc::c_char,
            context: *mut libc::c_void,
            callback: extern "C" fn(
                *mut libc::c_void,
                *const libc::c_char,
                libc::c_int,
                i64,
                libc::c_int,
            ) -> libc::c_int,
        ) -> libc::c_int;
    }
    extern "C" fn entry(
        context: *mut libc::c_void,
        path: *const libc::c_char,
        kind: libc::c_int,
        bytes: i64,
        error: libc::c_int,
    ) -> libc::c_int {
        let c = unsafe { &mut *(context as *mut Context<'_>) };
        let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
            c.result
                .issue("<non-UTF-8>".into(), "Filename is not valid UTF-8".into());
            return 0;
        };
        let Ok(relative) = Path::new(path).strip_prefix(c.root) else {
            c.result
                .issue(".".into(), "FTS returned a path outside the root".into());
            return 2;
        };
        let relative = relative.to_str().unwrap();
        if error != 0 {
            c.result.issue(
                relative.into(),
                std::io::Error::from_raw_os_error(error).to_string(),
            );
            return 0;
        }
        if relative.is_empty() {
            return 0;
        }
        c.result.visited += 1;
        if c.result.visited > c.config["maxEntries"].as_u64().unwrap() as usize {
            c.result.truncated = true;
            return 2;
        }
        let name = Path::new(relative).file_name().unwrap().to_str().unwrap();
        let depth = Path::new(relative).components().count();
        if depth > c.config["maxDepth"].as_u64().unwrap() as usize
            || (!c.config["includeHidden"].as_bool().unwrap() && name.starts_with('.'))
            || c.excluded.contains(name)
        {
            c.result.skipped += 1;
            return i32::from(kind == 1);
        }
        if kind != 2 {
            return 0;
        }
        let ext = Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !c.extensions.contains("*") && !c.extensions.contains(&ext) {
            c.result.skipped += 1;
            return 0;
        }
        if c.result.entries.len() >= c.config["maxFiles"].as_u64().unwrap() as usize {
            c.result.truncated = true;
            return 2;
        }
        c.result.entries.push(Entry {
            path: relative.into(),
            bytes: bytes.max(0) as u64,
        });
        0
    }
    let set = |key: &str| {
        config[key]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    };
    let mut context = Context {
        root,
        config,
        extensions: set("extensions"),
        excluded: set("exclude"),
        result: Scan {
            backend: "fts".into(),
            ..Default::default()
        },
    };
    let root_string = CString::new(root.as_os_str().as_bytes())?;
    let error = unsafe {
        filens_fts_walk(
            root_string.as_ptr(),
            &mut context as *mut _ as *mut libc::c_void,
            entry,
        )
    };
    if error != 0 {
        context.result.issue(
            ".".into(),
            std::io::Error::from_raw_os_error(error).to_string(),
        );
    }
    Ok(context.result)
}
