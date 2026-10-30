//! Native entry points for the exact frontend Rust decoder/retrieval sources.
//! The CLI adds no independent parser or ranking algorithm.
mod plain;
mod search;
mod stopwords;

use serde_json::{Value, json};
use std::{io::Read, path::Path};

pub fn evaluate(corpus: Value) -> Result<Value, String> {
    search::evaluate_value(corpus)
}
pub fn supports_plain(source: &str) -> bool {
    plain::supported(source)
}
pub fn extract_plain(path: &Path, max_bytes: usize) -> Value {
    let read = || -> Result<String, String> {
        let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() > 256 << 20 {
            return Err("source must be a regular file no larger than 256 MiB".into());
        }
        let mut bytes = Vec::with_capacity((metadata.len() as usize).min(8 << 20));
        Read::by_ref(&mut file)
            .take((256 << 20) + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 256 << 20 {
            return Err("source grew beyond 256 MiB".into());
        }
        Ok(plain::decode_text(&bytes))
    };
    match read() {
        Ok(mut text) => {
            let limit = max_bytes.min(32 << 20);
            let truncated = text.len() > limit;
            let mut end = text.len().min(limit);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
            json!({"text":text,"complete":true,"truncated":truncated,"layout":null,"errorCode":"","errorMessage":""})
        }
        Err(message) => {
            json!({"text":"","complete":false,"truncated":false,"layout":null,"errorCode":"io_error","errorMessage":message})
        }
    }
}
