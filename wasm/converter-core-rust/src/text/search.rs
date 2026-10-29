//! Cross-document retrieval over complete extracted text; no host-side parsing.
use super::*;
use std::collections::{BTreeMap, HashSet};
use unicode_normalization::UnicodeNormalization;

const MAX_CHUNKS: usize = 65536;
const CHARS: usize = 640;
const OVERLAP: usize = 80;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    query: String,
    mode: String,
    limit: usize,
    format: String,
    files: Vec<Source>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    path: String,
    sha256: String,
    text: String,
    #[serde(default)]
    relative_path: String,
    #[serde(default)]
    layout: Value,
    complete: bool,
}
impl Source {
    fn name(&self) -> &str {
        if self.relative_path.is_empty() {
            std::path::Path::new(&self.path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&self.path)
        } else {
            &self.relative_path
        }
    }
}
#[derive(Clone, Copy)]
struct Span {
    file: usize,
    start: usize,
    end: usize,
}

fn normalized(s: &str) -> String {
    s.nfkc().flat_map(char::to_lowercase).collect()
}
fn terms(text: &str) -> BTreeMap<String, f64> {
    let mut result = BTreeMap::new();
    let mut word = String::new();
    let mut previous = None;
    fn flush(word: &mut String, result: &mut BTreeMap<String, f64>) {
        let trimmed = word.trim_matches(['.', '-', '_']);
        if !trimmed.is_empty() && !super::prune::stop(trimmed) {
            *result.entry(trimmed.into()).or_default() += 1.0;
            if !trimmed.chars().any(|c| c.is_ascii_digit()) {
                for part in trimmed
                    .split(['.', '-', '_'])
                    .filter(|s| !s.is_empty() && *s != trimmed && !super::prune::stop(s))
                {
                    *result.entry(part.into()).or_default() += 0.5;
                }
            }
        }
        word.clear();
    }
    for c in normalized(text).chars() {
        if matches!(c as u32,0x3400..=0x4dbf|0x4e00..=0x9fff|0xf900..=0xfaff|0x20000..=0x323af) {
            flush(&mut word, &mut result);
            if !super::prune::stop(&c.to_string()) {
                *result.entry(c.to_string()).or_default() += 0.25;
            }
            if let Some(p) = previous {
                *result.entry(format!("{p}{c}")).or_default() += 1.0;
            }
            previous = Some(c);
        } else {
            previous = None;
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                word.push(c);
            } else {
                flush(&mut word, &mut result);
            }
        }
    }
    flush(&mut word, &mut result);
    result
}
fn spans(file: usize, text: &str, emit: &mut Vec<Span>) -> bool {
    let mut start = 0;
    while start < text.len() {
        if emit.len() == MAX_CHUNKS {
            return false;
        }
        let mut end = text[start..]
            .char_indices()
            .nth(CHARS)
            .map_or(text.len(), |(i, _)| start + i);
        if end < text.len() {
            if let Some(line) = text[start..end]
                .rfind('\n')
                .filter(|i| *i >= (end - start) / 2)
            {
                end = start + line + 1;
            }
        }
        emit.push(Span { file, start, end });
        if end == text.len() {
            break;
        }
        let next = text[start..end]
            .char_indices()
            .rev()
            .nth(OVERLAP)
            .map_or(end, |(i, _)| start + i);
        start = next.max(start + text[start..].chars().next().unwrap().len_utf8());
    }
    true
}

fn evaluate(corpus: Corpus) -> Result<Value, String> {
    evaluate_with_feature_budget(corpus, 8 << 20)
}

fn evaluate_with_feature_budget(corpus: Corpus, feature_budget: usize) -> Result<Value, String> {
    if corpus.query.trim().is_empty()
        || corpus.query.len() > 4096
        || !(1..=100).contains(&corpus.limit)
        || !["bm25", "exact", "files"].contains(&corpus.mode.as_str())
    {
        return Err("invalid search query, limit or mode".into());
    }
    let query = terms(&corpus.query);
    if query.is_empty() && corpus.mode != "exact" {
        return Err("query contains no searchable terms".into());
    }
    let mut chunks = Vec::new();
    let mut complete = true;
    for (i, file) in corpus.files.iter().enumerate() {
        if chunks.len() >= MAX_CHUNKS {
            complete = false;
            break;
        }
        if corpus.mode == "files" {
            chunks.push(Span {
                file: i,
                start: 0,
                end: 0,
            });
        } else if corpus.mode == "exact" {
            for (at, phrase) in file.text.match_indices(corpus.query.trim()) {
                if chunks.len() >= MAX_CHUNKS {
                    complete = false;
                    break;
                }
                let start = file.text[..at]
                    .char_indices()
                    .rev()
                    .nth(80)
                    .map_or(0, |(i, _)| i);
                let end = at + phrase.len();
                let end = file.text[end..]
                    .char_indices()
                    .nth(160)
                    .map_or(file.text.len(), |(i, _)| end + i);
                chunks.push(Span {
                    file: i,
                    start,
                    end,
                });
            }
            if file.name().contains(corpus.query.trim()) && !chunks.iter().any(|s| s.file == i) {
                let end = file
                    .text
                    .char_indices()
                    .nth(CHARS)
                    .map_or(file.text.len(), |(i, _)| i);
                chunks.push(Span {
                    file: i,
                    start: 0,
                    end,
                });
            }
        } else if !spans(i, &file.text, &mut chunks) {
            complete = false;
            break;
        }
    }
    let path_terms: Vec<_> = corpus.files.iter().map(|f| terms(f.name())).collect();
    let tokens = |span: Span| {
        let mut found = terms(&corpus.files[span.file].text[span.start..span.end]);
        for (term, value) in &path_terms[span.file] {
            *found.entry(term.clone()).or_default() += value.min(2.0);
        }
        found
    };
    let mut df = BTreeMap::<String, usize>::new();
    let mut total = 0.0;
    let mut lengths = Vec::with_capacity(chunks.len());
    let mut features = Vec::with_capacity(chunks.len());
    let mut feature_bytes = 0usize;
    // Only query-term document frequencies are needed: memory remains bounded.
    for &span in &chunks {
        if corpus.mode == "exact" {
            lengths.push(0.0);
            features.push(None);
            continue;
        }
        let mut found = tokens(span);
        let length = found.values().sum::<f64>();
        total += length;
        lengths.push(length);
        for term in query.keys() {
            if found.contains_key(term) {
                *df.entry(term.clone()).or_default() += 1;
            }
        }
        // Reuse query TFs for scoring instead of tokenizing every chunk twice.
        // Keep a bounded cache; over-budget chunks follow the original path.
        found.retain(|term, _| query.contains_key(term));
        let bytes = found.keys().map(|term| term.len() + 80).sum::<usize>();
        if feature_bytes.saturating_add(bytes) <= feature_budget {
            feature_bytes += bytes;
            features.push(Some(found));
        } else {
            features.push(None);
        }
    }
    let average = (total / chunks.len().max(1) as f64).max(1.0);
    let exact = normalized(corpus.query.trim());
    let precise: Vec<_> = query
        .keys()
        .filter(|t| t.chars().any(|c| c.is_ascii_digit()))
        .collect();
    let strong: Vec<_> = query.keys().filter(|t| t.chars().count() > 1).collect();
    let mut scored = Vec::<(Span, f64)>::new();
    for (chunk_index, &span) in chunks.iter().enumerate() {
        let source = &corpus.files[span.file];
        let value = &source.text[span.start..span.end];
        let score = if corpus.mode == "exact" {
            if value.contains(corpus.query.trim()) || source.name().contains(corpus.query.trim()) {
                1.0
            } else {
                0.0
            }
        } else {
            let fallback;
            let found = if let Some(found) = &features[chunk_index] {
                found
            } else {
                fallback = tokens(span);
                &fallback
            };
            if !precise.iter().all(|t| found.contains_key(*t))
                || (!strong.is_empty() && !strong.iter().any(|t| found.contains_key(*t)))
            {
                continue;
            }
            let length = lengths[chunk_index];
            let phrase =
                normalized(value).contains(&exact) || normalized(source.name()).contains(&exact);
            query
                .iter()
                .map(|(term, weight)| {
                    let tf = *found.get(term).unwrap_or(&0.0);
                    let freq = *df.get(term).unwrap_or(&0) as f64;
                    let idf = (1.0 + (chunks.len() as f64 - freq + 0.5) / (freq + 0.5)).ln();
                    weight.min(2.0) * idf * (tf * 2.2)
                        / (tf + 1.2 * (0.25 + 0.75 * length / average))
                })
                .sum::<f64>()
                + if phrase { 3.0 } else { 0.0 }
        };
        if score > 0.0 {
            scored.push((span, score));
        }
    }
    scored.sort_by(|(a, x), (b, y)| {
        y.total_cmp(x)
            .then_with(|| corpus.files[a.file].path.cmp(&corpus.files[b.file].path))
            .then(a.start.cmp(&b.start))
    });
    let matched_files: HashSet<_> = scored.iter().map(|(s, _)| s.file).collect();
    let mut order = Vec::new();
    let mut selected = HashMap::<usize, Vec<(Span, f64)>>::new();
    for (span, score) in scored {
        if !selected.contains_key(&span.file) {
            if order.len() >= corpus.limit {
                continue;
            }
            order.push(span.file);
        }
        let list = selected.entry(span.file).or_default();
        if list.len() < 3
            && !list
                .iter()
                .any(|(other, _)| span.start < other.end && other.start < span.end)
        {
            list.push((span, score));
        }
    }
    let mut results = Vec::new();
    for i in order {
        let file = &corpus.files[i];
        let excerpts:Vec<_>=selected[&i].iter().enumerate().filter(|_|corpus.mode!="files").map(|(j,(span,score))|{
            let start_line=file.text[..span.start].bytes().filter(|c|*c==b'\n').count()+1;
            let text=&file.text[span.start..span.end];
            let end_line=start_line+text.bytes().filter(|c|*c==b'\n').count()-usize::from(text.ends_with('\n'));
            let layout_blocks:Vec<_>=file.layout["blocks"].as_array().into_iter().flatten().filter(|block|{
                block["startByte"].as_u64().zip(block["endByte"].as_u64()).is_some_and(|(a,b)|a<span.end as u64 && b>span.start as u64)
            }).map(|block|{let mut value=block.clone();value["boundsScope"]=json!("source-block");value}).collect();
            json!({"id":format!("s{}",j+1),"startByte":span.start,"endByte":span.end,"startLine":start_line,"endLine":end_line,"text":text,"score":score,
                "layout":{"blocks":layout_blocks,"pages":file.layout["pages"],"images":file.layout["images"]}})
        }).collect();
        results.push(json!({"path":file.path,"sha256":if file.sha256.is_empty(){Value::Null}else{json!(file.sha256)},"score":selected[&i][0].1,"sourceComplete":file.complete,"excerpts":excerpts}));
    }
    let mut text = String::new();
    for (i, file) in results.iter().enumerate() {
        text.push_str(&format!("{}. {}\n", i + 1, file["path"].as_str().unwrap()));
        for excerpt in file["excerpts"].as_array().unwrap() {
            text.push_str(&format!(
                "  #{} · lines {}–{} · bytes {}:{}\n{}\n\n",
                excerpt["id"].as_str().unwrap(),
                excerpt["startLine"],
                excerpt["endLine"],
                excerpt["startByte"],
                excerpt["endByte"],
                excerpt["text"].as_str().unwrap()
            ));
        }
    }
    let search = json!({"version":"filens-search-v1","method":if corpus.mode=="files" {"filename-bm25"} else if corpus.mode=="exact" {"literal"} else {"bm25-exact"},
        "semantic":false,"query":corpus.query,"indexedFiles":corpus.files.len(),"matchedFiles":matched_files.len(),"returnedFiles":results.len(),
        "chunks":chunks.len(),"complete":complete,"truncated":!complete,"noLexicalMatch":results.is_empty(),"results":results});
    let rendered = render(&search, &text, &corpus.format);
    Ok(
        json!({"search":search,"content":{"text":text,"rendered":rendered,"complete":complete,"truncated":!complete,"warnings":[]}}),
    )
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn render(search: &Value, text: &str, format: &str) -> String {
    match format {
        "html" => format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>FiLens search</title></head><body><pre>{}</pre></body></html>\n",
            escape(text)
        ),
        "markdown" => text
            .lines()
            .map(|line| format!("> {}\n", line.replace('<', "&lt;").replace('>', "&gt;")))
            .collect(),
        "csv" | "tsv" => {
            let separator = if format == "csv" { "," } else { "\t" };
            let row = |cells: Vec<String>| {
                cells
                    .iter()
                    .map(|s| format!("\"{}\"", s.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(separator)
                    + "\n"
            };
            let mut out = row([
                "path",
                "score",
                "startByte",
                "endByte",
                "startLine",
                "endLine",
                "text",
            ]
            .into_iter()
            .map(String::from)
            .collect());
            for hit in search["results"].as_array().unwrap() {
                let excerpts = hit["excerpts"].as_array().unwrap();
                if excerpts.is_empty() {
                    out += &row(vec![
                        hit["path"].as_str().unwrap().into(),
                        hit["score"].to_string(),
                        "".into(),
                        "".into(),
                        "".into(),
                        "".into(),
                        "".into(),
                    ]);
                }
                for e in excerpts {
                    out += &row(vec![
                        hit["path"].as_str().unwrap().into(),
                        e["score"].to_string(),
                        e["startByte"].to_string(),
                        e["endByte"].to_string(),
                        e["startLine"].to_string(),
                        e["endLine"].to_string(),
                        e["text"].as_str().unwrap().into(),
                    ]);
                }
            }
            out
        }
        _ => text.into(),
    }
}

pub(super) fn execute(request: &Request, started: Instant) {
    let result = fs::read(&request.input)
        .map_err(|e| e.to_string())
        .and_then(|bytes| {
            if bytes.len() > 64 << 20 {
                return Err("search corpus exceeds 64 MiB".into());
            }
            serde_json::from_slice::<Corpus>(&bytes)
                .map_err(|e| e.to_string())
                .and_then(evaluate)
        });
    let wire = match result {
        Ok(payload) => ResultContract {
            ok: true,
            payload: Some(payload),
            ..Default::default()
        },
        Err(message) => ResultContract {
            ok: false,
            error_code: "invalid_search".into(),
            error_message: message,
            ..Default::default()
        },
    };
    if let Err(error) = write_result(&request.result, wire, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(path: &str, text: &str) -> Source {
        Source {
            path: path.into(),
            relative_path: path.into(),
            sha256: "fixture".into(),
            text: text.into(),
            layout: Value::Null,
            complete: true,
        }
    }
    fn run(query: &str, mode: &str, files: Vec<Source>) -> Value {
        evaluate(Corpus {
            query: query.into(),
            mode: mode.into(),
            limit: 10,
            format: "json".into(),
            files,
        })
        .unwrap()
    }
    #[test]
    fn chinese_numbers_and_original_offsets() {
        let original =
            "会议记录\n预算不得超过12345.67元；需要负责人审批。\n风险：扫描小字可能漏字。";
        let v = run(
            "预算 12345.67",
            "bm25",
            vec![
                source("wrong.txt", "预算12345.76元"),
                source("right.txt", original),
            ],
        );
        assert_eq!(v["search"]["matchedFiles"], 1);
        let hit = &v["search"]["results"][0];
        assert_eq!(hit["path"], "right.txt");
        let e = &hit["excerpts"][0];
        assert_eq!(
            &original[e["startByte"].as_u64().unwrap() as usize
                ..e["endByte"].as_u64().unwrap() as usize],
            e["text"].as_str().unwrap()
        );
    }
    #[test]
    fn exact_search_crosses_chunks_and_is_literal() {
        let needle = "AbC.".repeat(60);
        let text = format!("{}{}{}", "x".repeat(630), needle, "y".repeat(300));
        let v = run(&needle, "exact", vec![source("one.txt", &text)]);
        assert!(
            v["search"]["results"][0]["excerpts"][0]["text"]
                .as_str()
                .unwrap()
                .contains(&needle)
        );
        assert_eq!(
            run("abc.", "exact", vec![source("one.txt", &text)])["search"]["matchedFiles"],
            0
        );
    }
    #[test]
    fn exact_chunk_limit_includes_filename_matches() {
        let value = run(
            "n",
            "exact",
            vec![
                source("n-one.txt", &"n".repeat(MAX_CHUNKS)),
                source("n-empty.txt", ""),
                source("n-three.txt", &"n".repeat(100)),
            ],
        );
        assert_eq!(value["search"]["chunks"], MAX_CHUNKS);
        assert_eq!(value["search"]["complete"], false);
        assert_eq!(value["search"]["matchedFiles"], 1);
    }
    #[test]
    fn no_matches_and_numeric_identifier_traps() {
        assert_eq!(
            run(
                "FILENS2026",
                "bm25",
                vec![source("one.txt", "FILENS2027 approved")]
            )["search"]["matchedFiles"],
            0
        );
        let value = run(
            "unobtainium",
            "bm25",
            vec![source("one.txt", "ordinary text")],
        );
        assert_eq!(value["search"]["noLexicalMatch"], true);
        assert_eq!(value["content"]["complete"], true);
    }
    #[test]
    fn bounded_feature_cache_preserves_scores_and_evidence() {
        let corpus = || Corpus {
            query: "预算 approval".into(), mode: "bm25".into(), limit: 10, format: "json".into(),
            files: vec![source("one.txt", "现行预算需要 approval。"), source("two.txt", "approval budget notes"), source("none.txt", "ordinary background")],
        };
        assert_eq!(evaluate_with_feature_budget(corpus(), 0).unwrap(), evaluate(corpus()).unwrap());
    }
    #[test]
    fn full_text_tail_and_file_deduplication() {
        let text = format!(
            "{}\nneedle budget\n{}\nneedle risk",
            "boring text\n".repeat(500),
            "more text\n".repeat(500)
        );
        let value = run(
            "needle",
            "bm25",
            vec![source("large.txt", &text), source("second.txt", "needle")],
        );
        assert_eq!(value["search"]["matchedFiles"], 2);
        assert_eq!(value["search"]["returnedFiles"], 2);
        for hit in value["search"]["results"].as_array().unwrap() {
            assert!(hit["excerpts"].as_array().unwrap().len() <= 3);
        }
    }
    #[test]
    fn filename_mode_and_source_layout() {
        let names = run(
            "budget",
            "files",
            vec![source("budget.pdf", ""), source("other.exe", "")],
        );
        assert_eq!(names["search"]["matchedFiles"], 1);
        assert_eq!(names["search"]["results"][0]["excerpts"], json!([]));
        let mut file = source("contract.txt", "预算上限");
        file.layout = json!({"blocks":[{"startByte":0,"endByte":12,"page":2,"bounds":{"x":10}}],"pages":[{"index":2}]});
        let v = run("预算", "bm25", vec![file]);
        assert_eq!(
            v["search"]["results"][0]["excerpts"][0]["layout"]["blocks"][0]["page"],
            2
        );
    }
}
