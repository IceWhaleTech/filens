//! Bounded archive traversal in the shared document core. Never unpack using
//! archive paths: stage one member at a time under a generated flat filename.
use super::*;
use std::io::{self, Read};
use std::{cell::Cell, rc::Rc};

const MAX_DEPTH: usize = 8;
const MAX_EXPANDED: u64 = 256 << 20;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Expansion {
    files: Vec<Value>,
    errors: Vec<Value>,
    error_count: usize,
    visited: usize,
    skipped: usize,
    expanded_bytes: u64,
    pub(super) truncated: bool,
}

pub(super) struct Session {
    result: Expansion,
    options: Value,
    supported: HashSet<String>,
    serial: usize,
    remaining: usize,
    max_entries: usize,
    text_bytes: usize,
    expanded_bytes: Rc<Cell<u64>>,
    visited: usize,
    work: PathBuf,
    selected: Option<Vec<String>>,
    selected_outcome: Option<Outcome>,
}

fn source(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".tar.gz") { return "tgz".into(); }
    Path::new(&lower).extension().and_then(|s| s.to_str()).unwrap_or("").into()
}

fn clean_name(name: &str) -> Result<String, String> {
    let name = name.replace('\\', "/");
    if name.len() > 4096 || name.starts_with('/') || name.contains(':') || name.chars().any(char::is_control) {
        return Err("invalid archive member path".into());
    }
    let mut parts = Vec::new();
    for part in name.split('/') {
        match part { ".." => return Err("parent traversal in archive member path".into()), "" | "." => {}, p => parts.push(p) }
    }
    if parts.is_empty() { return Err("empty archive member path".into()); }
    Ok(parts.join("/"))
}

struct Staged(PathBuf);
impl Drop for Staged {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

struct Metered<R> { reader: R, used: Rc<Cell<u64>>, limit: u64 }
impl<R: Read> Read for Metered<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let available = self.limit.saturating_sub(self.used.get());
        let bound = buffer.len().min((available + 1) as usize);
        let count = self.reader.read(&mut buffer[..bound])?;
        self.used.set(self.used.get() + count as u64);
        if self.used.get() > self.limit { return Err(io::Error::other("archive expansion exceeds byte limit")); }
        Ok(count)
    }
}

impl Session {
    fn metered<R: Read>(&self, reader: R) -> Metered<R> {
        Metered { reader, used: self.expanded_bytes.clone(), limit: MAX_EXPANDED }
    }
    pub(super) fn new(request: &Request, options: &Value) -> Self {
        let remaining = options["maxArchiveFiles"].as_u64().unwrap_or(2000).min(20000) as usize;
        Self {
            result: Expansion::default(), options: options.clone(),
            supported: catalog::formats().iter().filter(|f| f["textExtraction"] == true)
                .filter_map(|f| f["format"].as_str().map(String::from)).collect(),
            serial: 0, remaining, max_entries: (remaining * 100).min(100000), text_bytes: 0, expanded_bytes: Rc::new(Cell::new(0)), visited: 0,
            work: Path::new(&request.output).parent().unwrap_or(Path::new("/work")).into(),
            selected: options["archiveMembers"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()),
            selected_outcome: None,
        }
    }

    fn issue(&mut self, members: &[String], code: &str, message: impl ToString) {
        self.result.error_count += 1;
        if self.result.errors.len() < 64 {
            self.result.errors.push(json!({"members":members,"code":code,"message":message.to_string()}));
        }
        if code == "archive_limit" { self.result.truncated = true; }
    }

    fn observe(&mut self, parents: &[String]) -> bool {
        self.result.visited += 1;
        self.visited += 1;
        if self.visited > self.max_entries {
            self.issue(parents, "archive_limit", "archive entry limit reached"); return false;
        }
        true
    }

    fn visible(&self, name: &str) -> bool {
        if self.selected.is_some() { return true; }
        let parts: Vec<_> = name.split('/').collect();
        if parts.len() > self.options["maxDepth"].as_u64().unwrap_or(32) as usize { return false; }
        !parts.iter().any(|part| [".git", "node_modules", "target", "dist"].contains(part)
            || (self.options["includeHidden"] != true && part.starts_with('.')))
    }

    fn add(&mut self, members: &[String], content: Outcome) {
        if self.selected.as_deref() == Some(members) { self.selected_outcome = Some(content); return; }
        if self.remaining == 0 || self.text_bytes + content.text.len() > 32 << 20 {
            self.issue(members, "archive_limit", "archive file count or extracted text limit reached");
            return;
        }
        self.remaining -= 1;
        self.text_bytes += content.text.len();
        self.result.files.push(json!({"memberPath":members.iter().map(|p|catalog::escape_archive_path(p)).collect::<Vec<_>>().join("!/"),"members":members,"content":content}));
    }

    fn member(&mut self, reader: &mut impl Read, name: &str, parents: &[String], depth: usize) {
        let mut members = parents.to_vec();
        let name = match clean_name(name) {
            Ok(name) => name,
            Err(message) => { members.push(name.into()); self.issue(&members, "invalid_archive_path", message); return; }
        };
        members.push(name.clone());
        if self.selected.as_ref().is_some_and(|selected| !selected.starts_with(&members)) { return; }
        if !self.visible(&name) {
            self.result.skipped += 1;
            return;
        }
        let extension = source(&name);
        let nested = catalog::is_archive(&extension);
        let names_only = self.options["archiveNamesOnly"] == true;
        if names_only { self.add(&members, Outcome { complete: true, ..Default::default() }); }
        if !nested && (names_only || !self.supported.contains(&extension)) {
            if !names_only { self.result.skipped += 1; }
            return;
        }
        if self.remaining == 0 && !names_only {
            self.issue(&members, "archive_limit", "archive file count limit reached"); return;
        }
        if nested && depth >= MAX_DEPTH {
            self.issue(&members, "archive_limit", "archive nesting exceeds 8 layers"); return;
        }
        if self.result.truncated { return; }
        self.serial += 1;
        let stage = Staged(self.work.join(format!("archive-member-{}.{}", self.serial, extension)));
        let written = (|| -> io::Result<()> {
            let mut file = fs::File::create(&stage.0)?;
            io::copy(reader, &mut file)?;
            Ok(())
        })();
        if self.expanded_bytes.get() > MAX_EXPANDED {
            self.issue(&members, "archive_limit", "archive expansion exceeds 256 MiB"); return;
        }
        if let Err(error) = written {
            let code = if error.to_string().to_lowercase().contains("password") { "password_required" } else { "archive_parse_error" };
            self.issue(&members, code, error); return;
        }
        if nested {
            self.expand(&stage.0, &name, &members, depth + 1);
        } else {
            let mut options = self.options.clone();
            options.as_object_mut().unwrap().remove("archiveMembers");
            let child = Request { input: stage.0.to_string_lossy().into_owned(),
                output: self.work.join("archive-text.txt").to_string_lossy().into_owned(),
                source: extension, operation: "extract-text".into(), options_json: options, ..Default::default() };
            self.add(&members, extract_outcome(&child));
        }
    }

    fn zip(&mut self, path: &Path, parents: &[String], depth: usize) -> Result<(), String> {
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
        let mut seen = HashSet::new();
        for i in 0..zip.len() {
            if self.result.truncated || self.selected_outcome.is_some() { break; }
            if !self.observe(parents) { break; }
            let raw = zip.by_index_raw(i).map_err(|e| e.to_string())?;
            if raw.is_dir() || raw.is_symlink() { self.result.skipped += 1; continue; }
            let name = raw.name().to_string();
            let encrypted = raw.encrypted();
            drop(raw);
            if !seen.insert(clean_name(&name).unwrap_or_else(|_|name.clone())) {
                let mut chain = parents.to_vec(); chain.push(name);
                self.issue(&chain, "duplicate_archive_path", "duplicate ZIP member name"); continue;
            }
            // Filename-only search can list encrypted leaf names without decoding.
            if !catalog::is_archive(&source(&name)) && (self.options["archiveNamesOnly"] == true || !self.supported.contains(&source(&name))) {
                self.member(&mut io::empty(), &name, parents, depth); continue;
            }
            match zip.by_index(i) {
                Ok(entry) => self.member(&mut self.metered(entry), &name, parents, depth),
                Err(error) => {
                    let mut chain = parents.to_vec(); chain.push(name);
                    self.issue(&chain, if encrypted { "password_required" } else { "archive_parse_error" }, error);
                }
            }
        }
        Ok(())
    }

    fn tar(&mut self, reader: impl Read, parents: &[String], depth: usize) -> Result<(), String> {
        let mut archive = tar::Archive::new(self.metered(reader));
        let mut seen = HashSet::new();
        for entry in archive.entries().map_err(|e| e.to_string())? {
            if self.result.truncated || self.selected_outcome.is_some() { break; }
            if !self.observe(parents) { break; }
            let mut entry = entry.map_err(|e| e.to_string())?;
            if !entry.header().entry_type().is_file() { self.result.skipped += 1; continue; }
            let name = entry.path().map_err(|e| e.to_string())?.to_str().ok_or("non-UTF-8 TAR member path")?.to_owned();
            if !seen.insert(clean_name(&name).unwrap_or_else(|_|name.clone())) {
                let mut chain = parents.to_vec(); chain.push(name);
                self.issue(&chain, "duplicate_archive_path", "duplicate TAR member name"); continue;
            }
            self.member(&mut entry, &name, parents, depth);
        }
        Ok(())
    }

    fn expand(&mut self, path: &Path, name: &str, parents: &[String], depth: usize) {
        let result = (|| -> Result<(), String> {
            match source(name).as_str() {
                "zip" | "jar" | "war" | "ear" | "apk" => self.zip(path, parents, depth),
                "tar" => self.tar(fs::File::open(path).map_err(|e| e.to_string())?, parents, depth),
                "tgz" => self.tar(flate2::read::MultiGzDecoder::new(fs::File::open(path).map_err(|e| e.to_string())?), parents, depth),
                "gz" => {
                    let mut gzip = flate2::read::MultiGzDecoder::new(fs::File::open(path).map_err(|e| e.to_string())?);
                    if gzip.header().is_none() { return Err("invalid gzip header".into()); }
                    let fallback = name.rsplit('/').next().unwrap_or(name);
                    let fallback = &fallback[..fallback.len().saturating_sub(3)];
                    let member = gzip.header().and_then(|h| h.filename()).and_then(|s| std::str::from_utf8(s).ok()).unwrap_or(fallback).to_owned();
                    if self.observe(parents) { self.member(&mut self.metered(&mut gzip), &member, parents, depth); }
                    Ok(())
                }
                _ => Err("unsupported archive format".into()),
            }
        })();
        if let Err(error) = result { self.issue(parents, if self.expanded_bytes.get() > MAX_EXPANDED {"archive_limit"}else{"archive_parse_error"}, error); }
    }

    pub(super) fn extract(&mut self, request: &Request) -> Value {
        self.result = Expansion::default();
        let before = self.expanded_bytes.get();
        match fs::metadata(&request.input) {
            Ok(meta) if meta.is_file() && meta.len() <= MAX_INPUT => {
                let name = request.options_json["archiveName"].as_str().unwrap_or_else(|| Path::new(&request.input).file_name().and_then(|p| p.to_str()).unwrap_or(""));
                self.expand(Path::new(&request.input), name, &[], 1);
            }
            _ => self.issue(&[], "io_error", "archive input must be a regular file no larger than 256 MiB"),
        }
        self.result.expanded_bytes = self.expanded_bytes.get() - before;
        serde_json::to_value(std::mem::take(&mut self.result)).unwrap()
    }
}

pub(super) fn read_selected(request: &Request) -> Outcome {
    let mut session = Session::new(request, &request.options_json);
    if session.selected.as_ref().is_none_or(|s| s.is_empty() || s.len() > MAX_DEPTH) {
        return Outcome { error_code:"invalid_request".into(), error_message:"archive member chain must contain 1–8 paths".into(), ..Default::default() };
    }
    let report = session.extract(request);
    if let Some(content) = session.selected_outcome { return content; }
    let error = report["errors"].as_array().and_then(|a|a.first());
    Outcome { error_code:error.and_then(|e|e["code"].as_str()).unwrap_or("archive_member_not_found").into(),
        error_message:error.and_then(|e|e["message"].as_str()).unwrap_or("requested archive member was not found or is not readable").into(),
        truncated:report["truncated"] == true, ..Default::default() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_and_archive_kinds() {
        assert_eq!(clean_name("./资料\\合同.txt").unwrap(), "资料/合同.txt");
        for p in ["../escape.txt", "/absolute.txt", "C:\\outside.txt", "a/../../b", "bad\0name"] { assert!(clean_name(p).is_err(), "{p}"); }
        assert_eq!(source("Bundle.TAR.GZ"), "tgz");
        assert!(!catalog::is_archive(&source("report.docx")));
    }
    #[test]
    fn decompression_budget_is_shared_by_nested_readers() {
        let used = Rc::new(Cell::new(0));
        let mut first = Metered { reader:io::Cursor::new(b"abc"),used:used.clone(),limit:5 };
        let mut bytes = Vec::new(); first.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes,b"abc");
        let mut second = Metered { reader:io::Cursor::new(b"def"),used:used.clone(),limit:5 };
        assert!(second.read_to_end(&mut Vec::new()).is_err());
        assert_eq!(used.get(),6);
    }
}
