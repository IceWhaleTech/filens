//! Response serialization; document exports are rendered by converter-text.
use anyhow::Result;
use serde_json::Value;
use std::io::Write;

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn xml(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                out.push_str(&format!("<field name=\"{}\">", escape(key)));
                xml(value, out);
                out.push_str("</field>");
            }
        }
        Value::Array(values) => {
            for value in values {
                out.push_str("<item>");
                xml(value, out);
                out.push_str("</item>");
            }
        }
        Value::Null => (),
        Value::String(s) => out.push_str(&escape(s)),
        other => out.push_str(&other.to_string()),
    }
}
pub fn write(format: &str, response: &Value) -> Result<()> {
    let mut stdout = std::io::stdout().lock();
    match format {
        "json" => {
            serde_json::to_writer(&mut stdout, response)?;
            writeln!(stdout)?;
        }
        "yaml" => serde_yaml::to_writer(&mut stdout, response)?,
        "xml" => {
            let mut output = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<filens>");
            xml(response, &mut output);
            output.push_str("</filens>\n");
            stdout.write_all(output.as_bytes())?;
        }
        _ => {
            if let Some(path) = response["output"]["path"].as_str() {
                writeln!(stdout, "{path}")?;
            }
            if let Some(warnings) = response["conversion"]["warnings"].as_array() {
                for warning in warnings {
                    eprintln!("warning: {}", warning.as_str().unwrap_or(""));
                }
            }
            if let Some(capacity) = response.get("capacity") {
                let data = serde_json::to_string_pretty(response)?;
                match format {
                    "html" => writeln!(
                        stdout,
                        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>filens capabilities</title></head><body><pre>{}</pre></body></html>",
                        escape(&data)
                    )?,
                    "markdown" => {
                        writeln!(stdout, "# filens capabilities\n\n```json\n{data}\n```")?
                    }
                    "csv" | "tsv" => {
                        let sep = if format == "csv" { ',' } else { '\t' };
                        writeln!(
                            stdout,
                            "kind{sep}content\ncapabilities{sep}\"{}\"",
                            data.replace('"', "\"\"")
                        )?;
                    }
                    _ => {
                        stdout.write_all(crate::HELP.as_bytes())?;
                        let formats = capacity["formats"].as_array().unwrap();
                        writeln!(
                            stdout,
                            "\nSupported input formats ({}):\n{}",
                            formats.len(),
                            formats
                                .iter()
                                .filter_map(|f| f["format"].as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        )?;
                        writeln!(
                            stdout,
                            "RapidOCR NCNN: enabled={} available={} OpenMP threads=2 max side=960",
                            capacity["ocr"]["enabled"], capacity["ocr"]["available"]
                        )?;
                        if let Some(error) = capacity["ocr"]["error"].as_str() {
                            eprintln!("{error}");
                        }
                    }
                }
            }
            if let Some(content) = response.get("content") {
                let key = if format == "text" { "text" } else { "rendered" };
                stdout.write_all(content[key].as_str().unwrap_or("").as_bytes())?;
                if let Some(warnings) = content["warnings"].as_array() {
                    for warning in warnings {
                        eprintln!("warning: {}", warning.as_str().unwrap_or(""));
                    }
                }
            }
            if let Some(error) = response.get("error") {
                eprintln!(
                    "{}: {}",
                    error["code"].as_str().unwrap_or("error"),
                    error["message"].as_str().unwrap_or("")
                );
            }
        }
    }
    stdout.flush()?;
    Ok(())
}
