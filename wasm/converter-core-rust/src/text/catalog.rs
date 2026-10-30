//! Shared format metadata; no document parsing or conversion.
use serde_json::{Value, json};

pub const ARCHIVES: &[&str] = &["zip", "jar", "war", "ear", "apk", "tar", "tgz", "gz"];

pub fn is_archive(source: &str) -> bool { ARCHIVES.contains(&source) }

// Escape delimiter characters only; preserve ordinary paths and Unicode.
pub fn escape_archive_path(path: &str) -> String { path.replace('%', "%25").replace('!', "%21") }
pub fn unescape_archive_path(path: &str) -> String { path.replace("%21", "!").replace("%25", "%") }

pub fn formats() -> Vec<Value> {
    let mut formats: Vec<Value> =
        serde_json::from_str::<Value>(include_str!("../../../../converter/text-formats.json"))
            .unwrap()["capabilities"]
            .as_array()
            .unwrap()
            .clone();
    let pairs: Vec<Value> = serde_json::from_str(include_str!(
        "../../../converter-core/manifest/conversions.json"
    ))
    .unwrap();
    for pair in pairs {
        if formats.iter().any(|f| f["format"] == pair["sourceFormat"]) {
            continue;
        }
        let (kind, ocr) = match pair["targetFormat"].as_str().unwrap_or("") {
            "docx" => ("text", false),
            "xlsx" => ("spreadsheet", false),
            "jpg" => ("image", true),
            _ => continue,
        };
        formats.push(
            json!({"format":pair["sourceFormat"],"kind":kind,"textExtraction":true,"ocr":ocr}),
        );
    }
    for source in ARCHIVES {
        formats.push(json!({"format":source,"kind":"archive","textExtraction":false,"archiveSearch":true,"ocr":false}));
    }
    formats.sort_by(|a, b| a["format"].as_str().cmp(&b["format"].as_str()));
    formats
}
