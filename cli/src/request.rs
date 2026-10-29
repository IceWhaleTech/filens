use anyhow::{Result, bail, ensure};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};

pub const FORMATS: [&str; 8] = [
    "text", "json", "markdown", "html", "yaml", "xml", "csv", "tsv",
];

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub intent: String,
    pub input: String,
    pub operation: String,
    pub format: String,
    pub max_bytes: i64,
    pub layout: bool,
    pub output: String,
    pub source_format: String,
    pub target_format: String,
    pub options: serde_json::Value,
    pub force: bool,
}

pub struct Options {
    pub request: Request,
    pub wasm: String,
    pub ocr: bool,
    pub timeout: Duration,
    pub help: bool,
    pub structured: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            request: Request::default(),
            wasm: String::new(),
            ocr: true,
            timeout: Duration::from_secs(120),
            help: false,
            structured: false,
        }
    }
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid request expression")
}
fn has(s: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| s.contains(term))
}
pub fn normalize(s: &str) -> String {
    match s.trim().to_lowercase().as_str() {
        "txt" | "plain" | "plain text" => "text".into(),
        "md" => "markdown".into(),
        "yml" => "yaml".into(),
        "htm" => "html".into(),
        other => other.into(),
    }
}

pub fn parse(o: &mut Options, args: &[String], stdin: impl Read) -> Result<()> {
    // Select the error serializer even when an invalid flag precedes --json.
    for (i, arg) in args
        .iter()
        .enumerate()
        .take_while(|(_, a)| a.as_str() != "--")
    {
        let format = if arg == "--json" {
            Some("json")
        } else if arg == "--format" {
            args.get(i + 1).map(String::as_str)
        } else {
            arg.strip_prefix("--format=")
        };
        if let Some(f) = format
            .map(normalize)
            .filter(|f| FORMATS.contains(&f.as_str()))
        {
            o.request.format = f;
        }
    }
    let mut positional = vec![];
    let mut explicit = None;
    let mut piped = false;
    let mut flags = true;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        if flags && arg == "--" {
            flags = false;
            continue;
        }
        if !flags || !arg.starts_with('-') || arg == "-" {
            if flags && arg == "-" {
                piped = true;
            } else {
                positional.push(arg.clone());
            }
            continue;
        }
        let (name, inline) = arg
            .split_once('=')
            .map_or((arg.as_str(), None), |(k, v)| (k, Some(v)));
        match name {
            "--help" | "-h" => o.help = true,
            "--json" => {
                explicit = Some("json".to_owned());
                o.request.format = "json".into();
            }
            "--capacity" | "--capabilities" => o.request.operation = "capabilities".into(),
            "--no-ocr" => o.ocr = false,
            "--layout" => o.request.layout = true,
            "--force" => o.request.force = true,
            "--input" | "--format" | "--wasm" | "--max-bytes" | "--timeout" | "--output" | "-o"
            | "--source" | "--from" | "--target" | "--to" | "--password" | "--locale" => {
                let value = match inline {
                    Some(v) => v,
                    None => {
                        let v = args
                            .get(i)
                            .ok_or_else(|| anyhow::anyhow!("{name} needs a value"))?;
                        i += 1;
                        v
                    }
                };
                match name {
                    "--input" => o.request.input = value.into(),
                    "--format" => {
                        explicit = Some(value.to_owned());
                        o.request.format = value.into();
                    }
                    "--wasm" => o.wasm = value.into(),
                    "--max-bytes" => o.request.max_bytes = value.parse()?,
                    "--timeout" => o.timeout = duration(value)?,
                    "--output" | "-o" => o.request.output = value.into(),
                    "--source" | "--from" => o.request.source_format = value.into(),
                    "--target" | "--to" => o.request.target_format = value.into(),
                    "--password" | "--locale" => {
                        if o.request.options.is_null() {
                            o.request.options = serde_json::json!({});
                        }
                        o.request.options[name.trim_start_matches('-')] = serde_json::json!(value);
                    }
                    _ => unreachable!(),
                }
            }
            _ => bail!("unknown option {name}; use --help or describe what to read"),
        }
    }
    if piped {
        ensure!(
            positional.is_empty() && o.request.input.is_empty(),
            "stdin request cannot be combined with another input or intent"
        );
        let mut data = String::new();
        stdin.take((1 << 20) + 1).read_to_string(&mut data)?;
        ensure!(data.len() <= 1 << 20, "request exceeds 1 MiB");
        if data.trim_start().starts_with('{') {
            o.structured = true;
            o.request.format = "json".into();
            // Merge fields onto CLI defaults, matching the existing protocol.
            let value: serde_json::Value = serde_json::from_str(&data)?;
            let mut merged = serde_json::to_value(&o.request)?;
            for (key, value) in value.as_object().unwrap() {
                merged[key] = value.clone();
            }
            o.request = serde_json::from_value(merged)?;
        } else {
            ensure!(!data.trim().is_empty(), "stdin request is empty");
            o.request.intent = data.trim().into();
        }
    } else if !positional.is_empty() {
        if positional.first().is_some_and(|s| s == "convert") {
            o.request.operation = "convert".into();
            ensure!(
                positional.len() <= 3,
                "convert accepts one input and one output path"
            );
            if let Some(input) = positional.get(1) {
                set_input(&mut o.request, input)?;
            }
            if let Some(output) = positional.get(2) {
                ensure!(
                    o.request.output.is_empty() || o.request.output == *output,
                    "multiple output paths found"
                );
                o.request.output = output.clone();
            }
        } else {
            o.request.intent = positional.join(" ");
            for arg in &positional {
                if std::fs::metadata(arg).is_ok_and(|m| m.is_file()) {
                    set_input(&mut o.request, arg)?;
                }
            }
        }
    }
    if let Some(f) = explicit {
        o.request.format = f;
    }
    if o.help {
        return Ok(());
    }
    resolve(&mut o.request)?;
    ensure!(!o.timeout.is_zero(), "timeout must be positive");
    ensure!(
        (0..=33554432).contains(&o.request.max_bytes),
        "maxBytes must be between 1 and 33554432, or 0 for the default"
    );
    Ok(())
}

fn duration(s: &str) -> Result<Duration> {
    // Accept Go duration syntax used by existing callers, including 1m30s.
    let parts = re(r"([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(ns|us|µs|μs|ms|s|m|h)");
    let mut seconds = 0.0;
    let mut end = 0;
    for cap in parts.captures_iter(s) {
        ensure!(cap.get(0).unwrap().start() == end, "invalid timeout");
        end = cap.get(0).unwrap().end();
        seconds += cap[1].parse::<f64>()?
            * match &cap[2] {
                "h" => 3600.0,
                "m" => 60.0,
                "s" => 1.0,
                "ms" => 1e-3,
                "ns" => 1e-9,
                _ => 1e-6,
            };
    }
    ensure!(
        end == s.len() && end != 0 && seconds > 0.0 && seconds <= i64::MAX as f64 / 1e9,
        "invalid timeout; use e.g. 2m or 30s"
    );
    Duration::try_from_secs_f64(seconds).map_err(Into::into)
}

fn set_input(r: &mut Request, value: &str) -> Result<()> {
    ensure!(
        r.input.is_empty() || r.input == value,
        "one file per request; multiple input paths found"
    );
    r.input = value.into();
    Ok(())
}

fn resolve(r: &mut Request) -> Result<()> {
    if r.operation == "convert" {
        return resolve_conversion(r);
    }
    ensure!(
        r.output.is_empty()
            && r.source_format.is_empty()
            && r.target_format.is_empty()
            && !r.force
            && r.options.is_null(),
        "conversion options require the convert operation"
    );
    let intent = r.intent.trim().to_owned();
    let lower = intent.to_lowercase();
    let quoted = re(r#"["'“‘]([^"'”’]+)["'”’]"#);
    let mut options = quoted.replace_all(&intent, "").into_owned();
    if !r.input.is_empty() {
        options = options.replace(&r.input, "");
    }
    r.layout |= r.operation == "layout"
        || re(r"(?i)(?-u:\b)(?:layout|coordinates|bounding\s+boxes)(?-u:\b)|布局|版面|坐标")
            .is_match(&options);
    if r.format.is_empty() {
        let output = re(
            r"(?i)(?:(?-u:\b)(?:as|in|output|return)\s+(?:plain\s+)?|(?:以|用|为|输出|返回)\s*)(json|yaml|yml|markdown|md|html|htm|csv|tsv|xml|text|txt)(?-u:\b)",
        );
        let suffix = re(
            r"(?i)(?-u:\b)(json|yaml|yml|markdown|md|html|csv|tsv|xml|text)\s*(?:format|output|格式|输出|返回)",
        );
        r.format = output
            .captures(&options)
            .or_else(|| suffix.captures(&options))
            .map(|c| c[1].to_owned())
            .unwrap_or_else(|| if r.layout { "json" } else { "text" }.into());
    }
    r.format = normalize(&r.format);
    ensure!(
        FORMATS.contains(&r.format.as_str()),
        "unsupported output format {:?}; choose {}",
        r.format,
        FORMATS.join(", ")
    );
    ensure!(
        !(r.layout && r.format == "text"),
        "plain text cannot represent layout metadata; choose json, yaml, xml, markdown, html, csv or tsv"
    );
    if r.operation == "capacity" {
        r.operation = "capabilities".into();
    }
    if r.operation == "extract" {
        r.operation = "read".into();
    }
    if r.operation.is_empty() {
        r.operation = if intent.is_empty()
            || lower == "capacity"
            || lower == "capabilities"
            || lower.starts_with("capacity ")
            || lower.starts_with("capabilities ")
            || has(
                &lower,
                &[
                    "你能做什么",
                    "有什么能力",
                    "支持哪些",
                    "what can you do",
                    "your capabilities",
                ],
            ) {
            if r.input.is_empty() {
                "capabilities"
            } else {
                "read"
            }
        } else if has(&lower, &["understand", "理解", "检查文档"]) {
            "understand"
        } else if r.layout {
            "layout"
        } else {
            "read"
        }
        .into();
    }
    ensure!(
        ["read", "understand", "capabilities", "layout"].contains(&r.operation.as_str()),
        "unsupported operation {:?}",
        r.operation
    );
    if r.operation == "capabilities" {
        ensure!(
            r.input.is_empty(),
            "capabilities does not accept an input file"
        );
        return Ok(());
    }
    let mut search = if r.input.is_empty() {
        intent.clone()
    } else {
        intent.replace(&r.input, "")
    };
    for cap in quoted.captures_iter(&search.clone()) {
        set_input(r, &cap[1])?;
        search = search.replace(&cap[0], "");
    }
    for found in re(r#"[^\s"'“”‘’，。；：！？,;!?<>]+\.[a-zA-Z0-9]{1,12}"#).find_iter(&search)
    {
        let mut path = found.as_str();
        for prefix in ["读取", "提取", "理解", "读一下", "读"] {
            path = path.strip_prefix(prefix).unwrap_or(path);
        }
        set_input(r, path)?;
    }
    ensure!(
        !r.input.is_empty(),
        "name the local file to read, for example: filens read report.pdf --json"
    );
    ensure!(!r.input.contains("://"), "input must be a local file path");
    ensure!(
        !has(
            &lower.replace(&r.input.to_lowercase(), ""),
            &[
                "summarize",
                "summarise",
                "总结",
                "摘要",
                "问答",
                "翻译",
                "translate",
                "回答",
                "how many",
                "多少",
                "为什么",
                "why "
            ]
        ),
        "semantic reasoning belongs to the calling agent; request read/understand, then use the returned text and evidence blocks to answer"
    );
    Ok(())
}

fn resolve_conversion(r: &mut Request) -> Result<()> {
    if r.format.is_empty() {
        r.format = "json".into();
    }
    r.format = normalize(&r.format);
    ensure!(
        ["text", "json", "yaml", "xml"].contains(&r.format.as_str()),
        "conversion responses support text, json, yaml or xml; use --to for the file format"
    );
    ensure!(
        !r.layout,
        "convert does not accept --layout; inspect the output with filens layout"
    );
    ensure!(
        !r.input.is_empty() && !r.input.contains("://"),
        "convert requires one local input file"
    );
    ensure!(
        r.options.is_null() || r.options.is_object(),
        "conversion options must be a JSON object"
    );
    fn extension(path: &str) -> String {
        std::path::Path::new(path)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    }
    if r.source_format.is_empty() {
        r.source_format = extension(&r.input);
    }
    if r.target_format.is_empty() {
        r.target_format = extension(&r.output);
    }
    for format in [&mut r.source_format, &mut r.target_format] {
        *format = format.trim().trim_start_matches('.').to_ascii_lowercase();
        if *format == "jpeg" {
            *format = "jpg".into();
        }
        ensure!(
            !format.is_empty()
                && format.len() <= 12
                && format.bytes().all(|b| b.is_ascii_alphanumeric()),
            "source and target formats must be file extensions"
        );
    }
    if r.output.is_empty() {
        r.output = std::path::Path::new(&r.input)
            .with_extension(&r.target_format)
            .to_string_lossy()
            .into();
    }
    ensure!(
        r.output != "-" && !r.output.contains("://"),
        "convert output must be a local file path"
    );
    let input = std::path::absolute(&r.input)?;
    let output = std::path::absolute(&r.output)?;
    ensure!(
        input != output,
        "conversion output must differ from the input file"
    );
    if let (Ok(a), Ok(b)) = (
        std::fs::canonicalize(&input),
        std::fs::canonicalize(&output),
    ) {
        ensure!(a != b, "conversion output must differ from the input file");
    }
    ensure!(
        r.force || std::fs::symlink_metadata(&output).is_err(),
        "output already exists; choose another path or pass --force"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options(args: &[&str], stdin: &str) -> Result<Options> {
        let mut o = Options::default();
        parse(
            &mut o,
            &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            stdin.as_bytes(),
        )?;
        Ok(o)
    }
    #[test]
    fn requests_and_errors() {
        let o = options(&["理解 “meeting notes.docx”，以 JSON 输出"], "").unwrap();
        assert_eq!(
            (
                o.request.operation.as_str(),
                o.request.input.as_str(),
                o.request.format.as_str()
            ),
            ("understand", "meeting notes.docx", "json")
        );
        assert_eq!(
            options(&["-"], r#"{"input":"report.pdf","layout":true}"#)
                .unwrap()
                .request
                .format,
            "json"
        );
        assert!(options(&["-"], r#"{"input":"x.txt","typo":true}"#).is_err());
        assert!(options(&["-"], "{} {}").is_err());
        assert!(options(&["read a.pdf b.docx"], "").is_err());
        assert!(options(&["summarize report.pdf"], "").is_err());
        assert!(options(&["layout", "report.pdf", "--format", "text"], "").is_err());
        assert!(options(&["--max-bytes=-1", "x.txt"], "").is_err());
        assert_eq!(duration("1m30.5s").unwrap(), Duration::from_millis(90500));
        assert!(duration("999999999999999h").is_err());
    }
    #[test]
    fn conversion_request_and_path_validation() {
        let o = options(
            &[
                "convert",
                "/source/report.rtf",
                "--to",
                "docx",
                "--locale",
                "zh-CN",
            ],
            "",
        )
        .unwrap();
        assert_eq!(o.request.output, "/source/report.docx");
        assert_eq!(o.request.options["locale"], "zh-CN");
        assert_eq!(o.request.format, "json");
        assert!(options(&["convert", "input.doc", "--to", "../docx"], "").is_err());
        assert!(options(&["convert", "input.doc", "input.doc", "--force"], "").is_err());
        assert!(options(&["read", "input.doc", "--to", "docx"], "").is_err());
    }
}
