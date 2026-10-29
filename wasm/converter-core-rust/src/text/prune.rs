//! Model-free, extractive text pruning. All ranking and provenance live in WASM.
//! Inspired by Blue's segmentation -> BM25/structure -> budget pipeline.
use super::*;
use std::collections::{BTreeMap, BTreeSet};

const MAX_CANDIDATES: usize = 4096;
const SHORTLIST: usize = 512;
const MAX_EXCERPTS: usize = 64;
const CHUNK_CHARS: usize = 384;

#[derive(Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Options {
    pub query: String,
    pub max_chars: usize,
    pub ratio: f64,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            query: String::new(),
            max_chars: 2000,
            ratio: 0.3,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Summary {
    version: &'static str,
    method: &'static str,
    extractive: bool,
    query: String,
    query_matched: Option<bool>,
    source_complete: bool,
    source_bytes: usize,
    source_characters: usize,
    characters: usize,
    budget_characters: usize,
    retained_ratio: f64,
    omitted: bool,
    total_segments: usize,
    sampled: bool,
    ranked_segments: usize,
    source_coordinates: &'static str,
    excerpts: Vec<Excerpt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Excerpt {
    id: String,
    start_byte: usize,
    end_byte: usize,
    source_start_byte: usize,
    source_end_byte: usize,
    source_start_line: usize,
    source_end_line: usize,
    score: f64,
    clipped: bool,
}

struct Segment {
    start: usize,
    end: usize,
    chars: usize,
    clipped: bool,
    terms: BTreeMap<String, f64>,
    norm: f64,
    facts: BTreeSet<String>,
    score: f64,
    relevance: f64,
    similarity: f64,
}

fn cjk(c: char) -> bool {
    matches!(c as u32, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x323af)
}
pub(super) fn stop(word: &str) -> bool {
    matches!(
        word,
        "a" | "an"
            | "and"
            | "are"
            | "as"
            | "at"
            | "be"
            | "been"
            | "by"
            | "for"
            | "from"
            | "has"
            | "have"
            | "he"
            | "her"
            | "his"
            | "i"
            | "in"
            | "is"
            | "it"
            | "its"
            | "of"
            | "on"
            | "or"
            | "our"
            | "she"
            | "that"
            | "the"
            | "their"
            | "them"
            | "there"
            | "these"
            | "they"
            | "this"
            | "to"
            | "was"
            | "we"
            | "were"
            | "which"
            | "with"
            | "you"
            | "your"
            | "的"
            | "了"
            | "在"
            | "是"
            | "和"
    )
}
fn tokens(text: &str) -> BTreeMap<String, f64> {
    let mut terms = BTreeMap::new();
    let mut word = String::new();
    let mut prior = None;
    let add = |s: String, terms: &mut BTreeMap<String, f64>| {
        if !stop(&s) {
            *terms.entry(s).or_default() += 1.0;
        }
    };
    for c in text.chars().flat_map(char::to_lowercase) {
        if cjk(c) {
            if !word.is_empty() {
                add(std::mem::take(&mut word), &mut terms);
            }
            add(c.to_string(), &mut terms);
            if let Some(p) = prior {
                add(format!("{p}{c}"), &mut terms);
            }
            prior = Some(c);
        } else {
            prior = None;
            if c.is_alphanumeric() {
                word.push(c);
            } else if !word.is_empty() {
                add(std::mem::take(&mut word), &mut terms);
            }
        }
    }
    if !word.is_empty() {
        add(word, &mut terms);
    }
    terms
}

// Two linear passes permit uniform sampling of the whole text without storing
// unbounded spans. Sentence stops preserve decimals, email addresses and URLs.
fn spans(text: &str, mut emit: impl FnMut(usize, usize, bool)) {
    let mut start = 0;
    let mut chars = 0;
    for (at, c) in text.char_indices() {
        chars += 1;
        let end = at + c.len_utf8();
        let next = text[end..].chars().next();
        let stop = matches!(c, '\n' | '\r' | '。' | '！' | '？' | '；')
            || (matches!(c, '.' | '!' | '?' | ';') && next.is_none_or(char::is_whitespace));
        if stop || chars >= CHUNK_CHARS {
            let part = &text[start..end];
            let trimmed = part.trim();
            if !trimmed.is_empty() {
                let a = start + part.len() - part.trim_start().len();
                emit(a, a + trimmed.len(), !stop && next.is_some());
            }
            start = end;
            chars = 0;
        }
    }
    let part = &text[start..];
    let trimmed = part.trim();
    if !trimmed.is_empty() {
        let a = start + part.len() - part.trim_start().len();
        emit(a, a + trimmed.len(), false);
    }
}

fn cosine(a: &Segment, b: &Segment) -> f64 {
    if a.norm == 0.0 || b.norm == 0.0 {
        return 0.0;
    }
    let (small, large) = if a.terms.len() < b.terms.len() {
        (&a.terms, &b.terms)
    } else {
        (&b.terms, &a.terms)
    };
    (small
        .iter()
        .map(|(k, v)| v * large.get(k).unwrap_or(&0.0))
        .sum::<f64>()
        / (a.norm * b.norm))
        .clamp(0.0, 1.0)
}
fn round(n: f64) -> f64 {
    (n * 1_000_000.0).round() / 1_000_000.0
}

pub(super) fn apply(result: &mut Outcome, options: Options) -> Result<(), ConvertError> {
    if !(1..=20_000).contains(&options.max_chars)
        || !options.ratio.is_finite()
        || options.ratio <= 0.0
        || options.ratio > 1.0
        || options.query.len() > 4096
    {
        return Err(ConvertError { code:"invalid_request", message:"summary requires maxChars 1..20000, ratio >0 and <=1, query at most 4096 UTF-8 bytes".into() });
    }
    let text = &result.text;
    let original_chars = text.chars().count();
    let budget = options
        .max_chars
        .min((original_chars as f64 * options.ratio).ceil() as usize);
    let mut count = 0;
    spans(text, |_, _, _| count += 1);
    let mut segments = Vec::new();
    let mut unique = BTreeSet::new();
    let mut index = 0;
    let mut next_sample = 0;
    let sample_count = count.min(MAX_CANDIDATES);
    spans(text, |a, b, clipped| {
        let chosen =
            count <= MAX_CANDIDATES || index == next_sample * (count - 1) / (sample_count - 1);
        index += 1;
        if !chosen {
            return;
        }
        next_sample += 1;
        let part = &text[a..b];
        let key = part
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        if !unique.insert(key) {
            return;
        }
        let terms = tokens(part);
        let mut facts: BTreeSet<_> = terms
            .keys()
            .filter(|s| s.chars().any(|c| c.is_numeric()))
            .cloned()
            .collect();
        for marker in ["not", "no", "never", "without", "不", "未", "无", "禁止"] {
            if terms.contains_key(marker) || (marker.chars().any(cjk) && part.contains(marker)) {
                facts.insert(marker.into());
            }
        }
        segments.push(Segment {
            start: a,
            end: b,
            chars: part.chars().count(),
            clipped,
            terms,
            norm: 0.0,
            facts,
            score: 0.0,
            relevance: 0.0,
            similarity: 0.0,
        });
    });
    let query = tokens(options.query.trim());
    let focused = !options.query.trim().is_empty();
    let mut df = BTreeMap::<String, usize>::new();
    for s in &segments {
        for term in s.terms.keys() {
            *df.entry(term.clone()).or_default() += 1;
        }
    }
    let n = segments.len() as f64;
    let average = segments
        .iter()
        .map(|s| s.terms.values().sum::<f64>())
        .sum::<f64>()
        / n.max(1.0);
    let mut centroid = BTreeMap::<String, f64>::new();
    let mut max_relevance: f64 = 0.0;
    for s in &mut segments {
        let dl = s.terms.values().sum::<f64>();
        for (term, tf) in &mut s.terms {
            let freq = df[term] as f64;
            let idf = ((n - freq + 0.5) / (freq + 0.5) + 1.0).ln();
            if query.contains_key(term) {
                let weight = if term.chars().count() == 1 && term.chars().any(cjk) {
                    0.25
                } else {
                    1.0
                };
                s.relevance += weight * idf * (*tf * 2.2)
                    / (*tf + 1.2 * (0.25 + 0.75 * dl / average.max(1.0)));
            }
            *tf = (1.0 + tf.ln()) * (1.0 + idf);
            *centroid.entry(term.clone()).or_default() += *tf;
        }
        s.norm = s.terms.values().map(|v| v * v).sum::<f64>().sqrt();
        max_relevance = max_relevance.max(s.relevance);
    }
    let centroid_norm = centroid
        .values()
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt()
        .max(1e-12);
    let heading_spans: Vec<_> = result
        .layout
        .iter()
        .flat_map(|l| &l.blocks)
        .filter(|b| b["kind"] == "heading")
        .filter_map(|b| {
            Some((
                b["startByte"].as_u64()? as usize,
                b["endByte"].as_u64()? as usize,
            ))
        })
        .collect();
    for s in &mut segments {
        let part = &text[s.start..s.end];
        let lower = part.to_lowercase();
        let centrality = s.terms.iter().map(|(k, v)| v * centroid[k]).sum::<f64>()
            / (s.norm * centroid_norm).max(1e-12);
        let density =
            part.chars().filter(|c| c.is_alphanumeric()).count() as f64 / s.chars.max(1) as f64;
        let signals = [
            "决议",
            "决定",
            "结论",
            "风险",
            "截止",
            "必须",
            "禁止",
            "预算",
            "合计",
            "decision",
            "conclusion",
            "risk",
            "deadline",
            "must",
            "action",
            "total",
            "budget",
        ]
        .iter()
        .filter(|w| lower.contains(**w))
        .count()
        .min(3) as f64
            / 3.0;
        let heading = part.starts_with('#')
            || heading_spans
                .iter()
                .any(|(a, b)| s.start < *b && s.end > *a);
        let position = 1.0 - s.start as f64 / text.len().max(1) as f64;
        let has_number = s
            .facts
            .iter()
            .any(|term| term.chars().any(|c| c.is_numeric()));
        let has_negation = s
            .facts
            .iter()
            .any(|term| !term.chars().any(|c| c.is_numeric()));
        let base = 0.35 * centrality
            + 0.15 * density
            + 0.20 * signals
            + 0.10 * position
            + if heading { 0.05 } else { 0.0 }
            + if has_number { 0.08 } else { 0.0 }
            + if has_negation { 0.07 } else { 0.0 };
        s.score = if focused {
            0.8 * s.relevance / max_relevance.max(1e-12) + 0.2 * base
        } else {
            base
        };
    }
    let ranked_segments = segments.len();
    let mut pool: Vec<_> = (0..segments.len())
        .filter(|i| !focused || segments[*i].relevance > 0.0)
        .collect();
    pool.sort_by(|a, b| {
        segments[*b]
            .score
            .total_cmp(&segments[*a].score)
            .then(segments[*a].start.cmp(&segments[*b].start))
    });
    pool.truncate(SHORTLIST);
    let mut selected = Vec::new();
    let mut used = 0;
    while !pool.is_empty() && selected.len() < MAX_EXCERPTS {
        let available = budget.saturating_sub(used + usize::from(!selected.is_empty()));
        let best = pool
            .iter()
            .enumerate()
            .filter(|(_, i)| segments[**i].chars <= available)
            .max_by(|(_, a), (_, b)| {
                let a = &segments[**a];
                let b = &segments[**b];
                (0.75 * a.score - 0.25 * a.similarity)
                    .total_cmp(&(0.75 * b.score - 0.25 * b.similarity))
                    .then(b.start.cmp(&a.start))
            })
            .map(|(at, _)| at);
        let Some(best) = best else {
            break;
        };
        let chosen = pool.remove(best);
        used += segments[chosen].chars + usize::from(!selected.is_empty());
        selected.push(chosen);
        pool.retain(|i| {
            let similarity = cosine(&segments[chosen], &segments[*i]);
            segments[*i].similarity = segments[*i].similarity.max(similarity);
            !(similarity >= 0.92 && segments[chosen].facts == segments[*i].facts)
        });
    }
    // A tiny budget may fit no complete sentence. Make the clipping explicit.
    if selected.is_empty() && budget > 0 {
        if let Some(i) = pool.first().copied() {
            let s = &mut segments[i];
            s.end = s.start
                + text[s.start..s.end]
                    .char_indices()
                    .nth(budget)
                    .map_or(s.end - s.start, |(at, _)| at);
            s.chars = text[s.start..s.end].chars().count();
            s.clipped = true;
            selected.push(i);
        }
    }
    selected.sort_by_key(|i| segments[*i].start);
    let mut output = String::new();
    let mut excerpts = Vec::new();
    let mut line = 1;
    let mut cursor = 0;
    for i in selected {
        let s = &segments[i];
        if !output.is_empty() {
            output.push('\n');
        }
        line += text[cursor..s.start]
            .bytes()
            .filter(|b| *b == b'\n')
            .count();
        let start_byte = output.len();
        output.push_str(&text[s.start..s.end]);
        let end_line = line + text[s.start..s.end].bytes().filter(|b| *b == b'\n').count();
        excerpts.push(Excerpt {
            id: format!("s{}", excerpts.len() + 1),
            start_byte,
            end_byte: output.len(),
            source_start_byte: s.start,
            source_end_byte: s.end,
            source_start_line: line,
            source_end_line: end_line,
            score: round(s.score),
            clipped: s.clipped,
        });
        cursor = s.end;
        line = end_line;
    }
    if let Some(layout) = &mut result.layout {
        remap(layout, &excerpts);
    }
    let characters = output.chars().count();
    if excerpts.iter().any(|e| e.clipped) {
        result.warnings.push("Some excerpts were clipped at a character budget or long-line boundary; inspect the source before quoting them as complete sentences.".into());
    }
    if focused && max_relevance == 0.0 {
        result.warnings.push("No lexical query matches in the ranked segments; this does not prove the topic is absent from the document.".into());
    }
    if count > MAX_CANDIDATES {
        result.warnings.push("Summary ranking sampled segments uniformly across the extracted text; some segments were not scored.".into());
    }
    result.summary = Some(Summary {
        version: "filens-summary-v1",
        method: "density-tfidf-bm25-mmr",
        extractive: true,
        query: options.query,
        query_matched: focused.then_some(max_relevance > 0.0),
        source_complete: result.complete && !result.truncated,
        source_bytes: text.len(),
        source_characters: original_chars,
        characters,
        budget_characters: budget,
        retained_ratio: round(characters as f64 / original_chars.max(1) as f64),
        omitted: excerpts
            .iter()
            .map(|e| e.source_end_byte - e.source_start_byte)
            .sum::<usize>()
            < text.len(),
        total_segments: count,
        sampled: count > MAX_CANDIDATES,
        ranked_segments,
        source_coordinates: "sourceStartByte/sourceEndByte: zero-based UTF-8 offsets in the full extracted text returned by read; end exclusive. startByte/endByte: offsets in content.text. Source lines are one-based, not page numbers.",
        excerpts,
    });
    result.text = output;
    Ok(())
}

fn remap(layout: &mut layout::Layout, excerpts: &[Excerpt]) {
    let original = std::mem::take(&mut layout.blocks);
    for excerpt in excerpts {
        for source in &original {
            let (Some(a), Some(b)) = (source["startByte"].as_u64(), source["endByte"].as_u64())
            else {
                continue;
            };
            let a = (a as usize).max(excerpt.source_start_byte);
            let b = (b as usize).min(excerpt.source_end_byte);
            if a >= b {
                continue;
            }
            if layout.blocks.len() >= 20_000 {
                layout.truncated = true;
                layout
                    .warnings
                    .push("Summary layout block limit reached.".into());
                return;
            }
            let mut block = source.clone();
            block["sourceBlockId"] = source["id"].clone();
            block["id"] = json!(format!("l{}", layout.blocks.len() + 1));
            block["sourceStartByte"] = json!(a);
            block["sourceEndByte"] = json!(b);
            block["startByte"] = json!(excerpt.start_byte + a - excerpt.source_start_byte);
            block["endByte"] = json!(excerpt.start_byte + b - excerpt.source_start_byte);
            // Selection can omit cells/rows, so preserve their identity as source
            // metadata rather than reconstructing a misleading complete table.
            if block["kind"] == "table" || block["kind"] == "cell" || block["kind"] == "row" {
                block["sourceKind"] = block["kind"].clone();
                block["kind"] = json!("paragraph");
                block.as_object_mut().unwrap().remove("table");
            }
            if block.get("bounds").is_some() {
                block["boundsScope"] = json!("original source block; may include omitted text");
            }
            layout.blocks.push(block);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(text: &str, query: &str, max_chars: usize, ratio: f64) -> Outcome {
        let mut result = Outcome {
            text: text.into(),
            complete: true,
            ..Default::default()
        };
        apply(
            &mut result,
            Options {
                query: query.into(),
                max_chars,
                ratio,
            },
        )
        .unwrap();
        result
    }
    fn verify(source: &str, result: &Outcome) {
        let summary = result.summary.as_ref().unwrap();
        assert!(result.text.chars().count() <= summary.budget_characters);
        for e in &summary.excerpts {
            assert_eq!(
                &source[e.source_start_byte..e.source_end_byte],
                &result.text[e.start_byte..e.end_byte]
            );
        }
    }
    #[test]
    fn query_finds_late_chinese_evidence_and_keeps_negation_numbers() {
        let source = "欢迎来到文档中心。\n目录导航与联系方式。\n预算不得超过12345.67元。\n预算批准额度为20000元。\n这是无关的天气记录。";
        let r = run(source, "预算", 80, 1.0);
        verify(source, &r);
        assert!(r.text.contains("不得超过12345.67元。"));
        assert!(r.text.contains("20000元。"));
        assert!(!r.text.contains("天气"));
    }
    #[test]
    fn no_query_extracts_decisions_and_deduplicates() {
        let source = "Welcome to the documentation.\nWelcome to the documentation.\nDecision: ship the release on Friday.\nThe project budget is 42000 dollars.\nContact us for more information.\n";
        let r = run(source, "", 100, 0.6);
        verify(source, &r);
        assert!(r.text.contains("Decision:"));
        assert!(r.text.contains("42000"));
        assert!(r.text.matches("Welcome").count() <= 1);
    }
    #[test]
    fn tiny_budget_empty_and_no_match_are_explicit() {
        let r = run("🙂预算不得超支。", "预算", 3, 1.0);
        verify("🙂预算不得超支。", &r);
        assert!(r.summary.unwrap().excerpts[0].clipped);
        let r = run("Budget is 42.", "zebra", 100, 1.0);
        assert!(r.text.is_empty());
        assert_eq!(r.summary.unwrap().query_matched, Some(false));
        let r = run("", "", 100, 0.3);
        assert!(r.text.is_empty());
        assert!(!r.summary.unwrap().omitted);
    }
    #[test]
    fn stable_order_and_changed_facts_are_not_duplicates() {
        let source = "The production budget for the release is 10000 dollars and must be approved.\nThe production budget for the release is 20000 dollars and must be approved.\nThe production budget for the release is not approved and cannot be used.\n";
        let a = run(source, "budget", 1000, 1.0);
        let b = run(source, "budget", 1000, 1.0);
        verify(source, &a);
        assert_eq!(a.text, b.text);
        assert!(a.text.contains("10000"));
        assert!(a.text.contains("20000"));
        assert!(a.text.contains("not approved"));
    }
    #[test]
    fn sampling_covers_document_tail_with_bounded_candidates() {
        let mut source = (0..5000)
            .map(|i| format!("Routine entry {i}.\n"))
            .collect::<String>();
        source.push_str("Critical deployment risk: database corruption.\n");
        let r = run(&source, "corruption", 150, 1.0);
        verify(&source, &r);
        assert!(r.text.contains("database corruption"));
        let s = r.summary.unwrap();
        assert!(s.sampled);
        assert!(s.ranked_segments <= MAX_CANDIDATES);
    }
}
