//! Loopback HTTP/file plumbing only. The browser uses the shared frontend engines.
use anyhow::{Result, bail, ensure};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, SystemTime},
};

const HELP: &str = "filens preview FILE [--port 0] [--no-open] [--json] [--assets DIR]\n\
Serves one file on 127.0.0.1 and opens its browser-local preview. Ctrl-C stops it.\n\
Build assets with npm run build:preview, or set FILENS_PREVIEW_DIR.\n\
External companion files must be bundled into a supported ZIP or selected in the demo.\n";

pub fn capacity(bundle: &Path) -> serde_json::Value {
    let assets = std::env::var_os("FILENS_PREVIEW_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| bundle.join("preview"));
    json!({"available":assets.join("index.html").is_file() && assets.join("filens.js").is_file(),
        "command":"filens preview FILE", "transport":"loopback-http", "engine":"frontend",
        "optionalAssets":true, "setup":"npm run build:preview", "structuredRequests":false})
}

pub fn run(args: &[String]) -> Result<i32> {
    let mut input = None;
    let mut port: u16 = 0;
    let mut open = true;
    let mut structured = false;
    let mut assets = std::env::var_os("FILENS_PREVIEW_DIR").map(PathBuf::from);
    let mut flags = true;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        if flags && arg == "--" {
            flags = false;
            continue;
        }
        if !flags || !arg.starts_with('-') {
            ensure!(input.is_none(), "preview accepts one file");
            input = Some(PathBuf::from(arg));
            continue;
        }
        match arg.as_str() {
            "--help" | "-h" => {
                print!("{HELP}");
                return Ok(0);
            }
            "--no-open" => open = false,
            "--json" => structured = true,
            "--port" | "--assets" => {
                let value = args
                    .get(i)
                    .ok_or_else(|| anyhow::anyhow!("{arg} needs a value"))?;
                i += 1;
                if arg == "--port" {
                    port = value.parse()?;
                } else {
                    assets = Some(PathBuf::from(value));
                }
            }
            _ => bail!("unknown preview option {arg}"),
        }
    }
    let input =
        std::fs::canonicalize(input.ok_or_else(|| {
            anyhow::anyhow!("preview requires a file; use filens preview --help")
        })?)?;
    ensure!(input.is_file(), "preview requires a regular file");
    let assets = assets.unwrap_or_else(|| {
        std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .join("preview")
    });
    ensure!(
        assets.join("index.html").is_file() && assets.join("filens.js").is_file(),
        "preview assets are missing; run npm run build:preview in the source checkout, or use --assets DIR / FILENS_PREVIEW_DIR with a built preview directory"
    );
    let assets = std::fs::canonicalize(assets)?;
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let seed = tempfile::Builder::new()
        .prefix("filens-preview-")
        .tempdir()?;
    let token = format!(
        "{:x}",
        Sha256::digest(format!("{:?}{:?}", seed.path(), SystemTime::now()).as_bytes())
    );
    let prefix = format!("/{}/", &token[..32]);
    let url = format!("http://{address}{prefix}index.html?cli");
    let canceled = Arc::new(AtomicBool::new(false));
    let signal = canceled.clone();
    ctrlc::set_handler(move || signal.store(true, Ordering::SeqCst))?;
    if structured {
        println!(
            "{}",
            json!({"ok":true,"operation":"preview","url":url,"source":{"name":input.file_name().unwrap().to_string_lossy()},"stop":"Ctrl-C"})
        );
    } else {
        println!("{url}\nBrowser-local preview. Press Ctrl-C to stop.");
    }
    std::io::stdout().flush()?;
    if open {
        open_browser(&url);
    }
    let state = Arc::new(Server {
        input,
        assets,
        prefix,
        host: address.to_string(),
    });
    let active = Arc::new(AtomicUsize::new(0));
    while !canceled.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut socket, _)) => {
                if active.load(Ordering::SeqCst) >= 32 {
                    continue;
                }
                active.fetch_add(1, Ordering::SeqCst);
                let state = state.clone();
                let active = active.clone();
                std::thread::spawn(move || {
                    let _ = state.serve(&mut socket);
                    active.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(0)
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();
    if let Err(error) = result {
        eprintln!("Open the URL in a browser: {error}");
    }
}

struct Server {
    input: PathBuf,
    assets: PathBuf,
    prefix: String,
    host: String,
}
impl Server {
    fn serve(&self, socket: &mut TcpStream) -> Result<()> {
        // macOS accepts can inherit O_NONBLOCK from the listener. Streaming
        // larger chunks must wait for the browser instead of truncating on EAGAIN.
        socket.set_nonblocking(false)?;
        socket.set_read_timeout(Some(Duration::from_secs(5)))?;
        socket.set_write_timeout(Some(Duration::from_secs(10)))?;
        let mut data = Vec::new();
        while !data.ends_with(b"\r\n\r\n") && data.len() < 16384 {
            let mut byte = [0];
            if socket.read(&mut byte)? == 0 {
                return Ok(());
            }
            data.push(byte[0]);
        }
        if !data.ends_with(b"\r\n\r\n") {
            return reply(socket, 431, b"Headers too large", false);
        }
        let request = String::from_utf8_lossy(&data);
        let mut lines = request.split("\r\n");
        let mut first = lines.next().unwrap_or("").split_whitespace();
        let method = first.next().unwrap_or("");
        let target = first.next().unwrap_or("");
        let head = method == "HEAD";
        if method != "GET" && !head {
            return reply(socket, 405, b"Method not allowed", head);
        }
        let headers: Vec<_> = lines.filter_map(|line| line.split_once(':')).collect();
        let header = |name: &str| {
            headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.trim())
        };
        let origin = format!("http://{}", self.host);
        if header("host") != Some(self.host.as_str())
            || header("origin").is_some_and(|value| value != origin)
            || header("sec-fetch-site") == Some("cross-site")
        {
            return reply(socket, 403, b"Forbidden", head);
        }
        let pathname = target.split('?').next().unwrap_or("");
        let Some(relative) = pathname.strip_prefix(&self.prefix) else {
            return reply(socket, 404, b"Not found", head);
        };
        if relative == "source.json" {
            let data = serde_json::to_vec(
                &json!({"name":self.input.file_name().unwrap().to_string_lossy(),"url":format!("./input.{}", self.input.extension().and_then(|s|s.to_str()).unwrap_or("bin"))}),
            )?;
            write_headers(socket, 200, "application/json", data.len() as u64, None)?;
            if !head {
                socket.write_all(&data)?;
            }
            return Ok(());
        }
        let input_name = format!(
            "input.{}",
            self.input
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("bin")
        );
        let file = if relative == input_name {
            self.input.clone()
        } else {
            if relative.is_empty()
                || relative.contains('%')
                || relative.contains('\\')
                || Path::new(relative)
                    .components()
                    .any(|c| !matches!(c, Component::Normal(_)))
            {
                return reply(socket, 404, b"Not found", head);
            }
            let Ok(file) = std::fs::canonicalize(self.assets.join(relative)) else {
                return reply(socket, 404, b"Not found", head);
            };
            if !file.starts_with(&self.assets) {
                return reply(socket, 404, b"Not found", head);
            }
            file
        };
        let Ok(mut input) = File::open(&file) else {
            return reply(socket, 404, b"Not found", head);
        };
        if !input.metadata()?.is_file() {
            return reply(socket, 404, b"Not found", head);
        }
        let length = input.metadata()?.len();
        let range = match byte_range(header("range"), length) {
            Ok(value) => value,
            Err(_) => {
                write!(
                    socket,
                    "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{length}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )?;
                return Ok(());
            }
        };
        let (start, count) = range
            .map(|(start, end)| (start, end - start + 1))
            .unwrap_or((0, length));
        write_headers(
            socket,
            if range.is_some() { 206 } else { 200 },
            mime(&file),
            count,
            range.map(|(start, end)| format!("bytes {start}-{end}/{length}")),
        )?;
        if !head {
            input.seek(SeekFrom::Start(start))?;
            std::io::copy(&mut input.take(count), socket)?;
        }
        Ok(())
    }
}
fn byte_range(value: Option<&str>, length: u64) -> Result<Option<(u64, u64)>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|v| v.split_once('-'))
        .ok_or_else(|| anyhow::anyhow!("invalid range"))?;
    ensure!(length > 0, "empty file");
    let range = if start.is_empty() {
        let suffix: u64 = end.parse()?;
        ensure!(suffix > 0, "empty suffix");
        (length.saturating_sub(suffix), length - 1)
    } else {
        (
            start.parse()?,
            if end.is_empty() {
                length - 1
            } else {
                end.parse::<u64>()?.min(length - 1)
            },
        )
    };
    ensure!(range.0 < length && range.0 <= range.1, "invalid range");
    Ok(Some(range))
}
fn write_headers(
    socket: &mut TcpStream,
    status: u16,
    mime: &str,
    length: u64,
    range: Option<String>,
) -> Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    };
    write!(
        socket,
        "HTTP/1.1 {status} {}\r\nContent-Type: {mime}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n",
        reason
    )?;
    if let Some(range) = range {
        write!(socket, "Content-Range: {range}\r\n")?;
    }
    write!(socket, "\r\n")?;
    Ok(())
}
fn reply(socket: &mut TcpStream, status: u16, body: &[u8], head: bool) -> Result<()> {
    write_headers(
        socket,
        status,
        "text/plain; charset=utf-8",
        body.len() as u64,
        None,
    )?;
    if !head {
        socket.write_all(body)?;
    }
    Ok(())
}
fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "wasm" => "application/wasm",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_media_ranges() {
        assert_eq!(byte_range(None, 10).unwrap(), None);
        for (request, expected) in [
            ("bytes=0-0", (0, 0)),
            ("bytes=2-", (2, 9)),
            ("bytes=-3", (7, 9)),
            ("bytes=2-99", (2, 9)),
        ] {
            assert_eq!(byte_range(Some(request), 10).unwrap(), Some(expected));
        }
        for request in [
            "bytes=10-",
            "bytes=8-2",
            "bytes=-0",
            "bytes=0-1,3-4",
            "no-range",
        ] {
            assert!(byte_range(Some(request), 10).is_err());
        }
        assert!(byte_range(Some("bytes=0-"), 0).is_err());
    }
}
