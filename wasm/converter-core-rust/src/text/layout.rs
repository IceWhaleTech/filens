//! Source structure, coordinate normalization and document exports belong to WASM.
use super::*;

const MAX_BLOCKS: usize = 20_000;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Layout {
    version: &'static str,
    source_format: String,
    coordinate_convention: &'static str,
    coverage: &'static str,
    pub pages: Vec<Value>,
    pub images: Vec<Value>,
    pub blocks: Vec<Value>,
    pub(super) warnings: Vec<String>,
    pub(super) truncated: bool,
    #[serde(skip)]
    current_page: Option<u64>,
}

impl Layout {
    pub fn new(source: &str) -> Self {
        Self { version: "filens-layout-v1", source_format: source.into(),
            coordinate_convention: "top-left origin; x right, y down; units and coordinateSpace are explicit; absent bounds mean unavailable, not zero",
            coverage:"text", ..Self::default() }
    }
}

pub(super) fn enabled() -> bool {
    STATE.with(|s| {
        s.borrow()
            .as_ref()
            .is_some_and(|s| s.result.layout.is_some())
    })
}
pub(super) fn source_image() -> bool {
    STATE.with(|s| {
        s.borrow()
            .as_ref()
            .and_then(|s| s.result.layout.as_ref())
            .is_some_and(|l| {
                matches!(
                    l.source_format.as_str(),
                    "png"
                        | "jpg"
                        | "jpeg"
                        | "jpe"
                        | "jfif"
                        | "gif"
                        | "bmp"
                        | "tif"
                        | "tiff"
                        | "webp"
                        | "pbm"
                        | "pgm"
                        | "ppm"
                        | "pnm"
                        | "pfm"
                        | "hdr"
                        | "exr"
                        | "mat"
                        | "fits"
                        | "fit"
                        | "fts"
                        | "raw"
                )
            })
    })
}
pub(super) fn offset() -> usize {
    STATE.with(|s| s.borrow().as_ref().unwrap().result.text.len())
}
pub(super) fn open(kind: &str) -> Option<usize> {
    STATE.with(|s| {
        let mut slot = s.borrow_mut(); let s = slot.as_mut()?;
        let layout = s.result.layout.as_mut()?;
        if layout.blocks.len() >= MAX_BLOCKS {
            layout.truncated = true;
            return None;
        }
        let index = layout.blocks.len();
        let mut block = json!({"id":format!("l{}", index+1),"kind":kind,"startByte":s.result.text.len(),"endByte":s.result.text.len()});
        if let Some(page) = layout.current_page { block["page"] = json!(page); }
        layout.blocks.push(block);
        Some(index)
    })
}
pub(super) fn properties(index: Option<usize>, values: Value) {
    if let Some(index) = index {
        STATE.with(|s| {
            if let Some(layout) = s
                .borrow_mut()
                .as_mut()
                .and_then(|s| s.result.layout.as_mut())
            {
                if let (Some(block), Some(values)) = (
                    layout.blocks.get_mut(index).and_then(Value::as_object_mut),
                    values.as_object(),
                ) {
                    block.extend(values.clone());
                }
            }
        });
    }
}
pub(super) fn close(index: Option<usize>) {
    properties(index, json!({"endByte":offset()}));
}
pub(super) fn warning(message: &str) {
    STATE.with(|s| {
        if let Some(layout) = s
            .borrow_mut()
            .as_mut()
            .and_then(|s| s.result.layout.as_mut())
        {
            if layout.warnings.len() < 32 && !layout.warnings.iter().any(|s| s == message) {
                layout.warnings.push(message.into());
            }
        }
    });
}
pub(super) fn page(index: u64, width: Option<f64>, height: Option<f64>, unit: &str, kind: &str) {
    STATE.with(|s| {
        if let Some(layout) = s
            .borrow_mut()
            .as_mut()
            .and_then(|s| s.result.layout.as_mut())
        {
            layout.current_page = Some(index);
            let mut page = json!({"index":index,"kind":kind});
            if let (Some(width), Some(height)) = (width, height) {
                page["width"] = json!(width);
                page["height"] = json!(height);
                page["unit"] = json!(unit);
            }
            layout.pages.push(page);
        }
    });
}

pub(super) fn pdf_rects(response: &Value, text: &str, start: usize) {
    let height = response["height"].as_f64().unwrap_or(0.0);
    let mut cursor = 0;
    if let Some(rects) = response["structured"]["Rects"].as_array() {
        for rect in rects {
            let value = rect["Text"].as_str().unwrap_or("");
            if value.trim().is_empty() {
                continue;
            }
            let token = open("text");
            let p = &rect["PointPosition"];
            let left = p["Left"].as_f64().unwrap_or(0.0);
            let right = p["Right"].as_f64().unwrap_or(left);
            let top = p["Top"].as_f64().unwrap_or(height);
            let bottom = p["Bottom"].as_f64().unwrap_or(top);
            let mut corners = vec![(left, top), (right, top), (right, bottom), (left, bottom)];
            if let Some(basis) = response["deviceBasis"].as_array().filter(|b| b.len() == 3) {
                for (x, y) in &mut corners {
                    let transform = |key: &str| {
                        let origin = basis[0][key].as_f64().unwrap_or(0.0);
                        (origin
                            + (basis[1][key].as_f64().unwrap_or(origin) - origin) * (*x / 1000.0)
                            + (basis[2][key].as_f64().unwrap_or(origin) - origin) * (*y / 1000.0))
                            / 100.0
                    };
                    (*x, *y) = (transform("DeviceX"), transform("DeviceY"));
                }
            } else {
                for (_, y) in &mut corners {
                    *y = height - *y;
                }
            }
            let x = corners.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
            let y = corners.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
            let right = corners
                .iter()
                .map(|p| p.0)
                .fold(f64::NEG_INFINITY, f64::max);
            let bottom = corners
                .iter()
                .map(|p| p.1)
                .fold(f64::NEG_INFINITY, f64::max);
            let mut values = json!({"source":"pdf-text","bounds":{"x":x,"y":y,"width":right-x,"height":bottom-y,"unit":"pt"},"startByte":null,"endByte":null});
            if let Some(at) = text[cursor..].find(value) {
                let at = cursor + at;
                if start + at + value.len() <= offset() {
                    values["startByte"] = json!(start + at);
                    values["endByte"] = json!(start + at + value.len());
                }
                cursor = at + value.len();
            }
            if let Some(font) = rect.get("FontInformation").filter(|f| !f.is_null()) {
                values["font"] = font.clone();
            }
            STATE.with(|s| {
                if let Some(page) = s
                    .borrow()
                    .as_ref()
                    .and_then(|s| s.result.layout.as_ref())
                    .and_then(|l| l.current_page)
                {
                    values["coordinateSpace"] = json!(format!("page:{page}"));
                }
            });
            properties(token, values);
        }
    }
}

fn numbers(text: &str) -> Vec<f64> {
    text.split(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-')))
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

// The native OCR capability reports original, orientation-corrected image pixels
// plus a known padding offset. Parse its diagnostics here, never in the host.
pub(super) fn ocr(response: &Value, start: usize, standalone: bool) {
    if !enabled() {
        return;
    }
    let raw = response["detail"]["raw_output"].as_str().unwrap_or("");
    let size = raw
        .lines()
        .find_map(|s| s.strip_prefix("ImageSize("))
        .map(numbers)
        .unwrap_or_default();
    let lines = response["detail"]["lines"].as_array();
    if size.len() < 2 || lines.is_none() {
        warning("OCR provider supplied no usable image geometry; text is retained without invented bounds.");
        return;
    }
    let (width, height) = (size[0], size[1]);
    let (space, page_size) = STATE.with(|s| {
        let mut slot = s.borrow_mut(); let layout = slot.as_mut().unwrap().result.layout.as_mut().unwrap();
        let page = layout.current_page.and_then(|p| layout.pages.iter().find(|v| v["index"] == p)).cloned();
        if let Some(page) = page.filter(|v| v["unit"] == "pt") {
            (format!("page:{}", page["index"]), Some((page["width"].as_f64().unwrap_or(width), page["height"].as_f64().unwrap_or(height))))
        } else {
            let id = format!("image:{}", layout.images.len()+1);
            layout.images.push(json!({"id":id,"width":width,"height":height,"unit":"px","orientation":"EXIF applied","placement":if standalone {"standalone"} else {"embedded; position within document unavailable"}}));
            (id, None)
        }
    });
    if standalone {
        page(1, Some(width), Some(height), "px", "image");
    }
    let lines = lines.unwrap();
    let mut cursor = start;
    for line in raw.lines().filter(|s| s.starts_with("TextBox[")) {
        let Some((index, rest)) = line[8..].split_once(']') else {
            continue;
        };
        let Ok(index) = index.parse::<usize>() else {
            continue;
        };
        let Some(text) = lines.get(index).and_then(Value::as_str) else {
            continue;
        };
        let Some((score, points)) = rest
            .split_once("score(")
            .and_then(|(_, v)| v.split_once(')'))
        else {
            continue;
        };
        let points = numbers(points);
        if points.len() != 8 {
            continue;
        }
        let padding = if rest.contains("+padding") { 50.0 } else { 0.0 };
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        let (sx, sy, unit) = page_size
            .map(|(w, h)| (w / width, h / height, "pt"))
            .unwrap_or((1.0, 1.0, "px"));
        let mut polygon = Vec::new();
        for xy in points.chunks_exact(2) {
            let x = (xy[0] - padding).clamp(0.0, width) * sx;
            let y = (xy[1] - padding).clamp(0.0, height) * sy;
            xs.push(x);
            ys.push(y);
            polygon.push(json!([x, y]));
        }
        let x = xs.iter().copied().fold(f64::INFINITY, f64::min);
        let y = ys.iter().copied().fold(f64::INFINITY, f64::min);
        let right = xs.iter().copied().fold(0.0, f64::max);
        let bottom = ys.iter().copied().fold(0.0, f64::max);
        let token = open("text");
        let end = (cursor + text.len()).min(offset());
        properties(
            token,
            json!({"source":"ocr","startByte":cursor.min(offset()),"endByte":end,"coordinateSpace":space,"bounds":{"x":x,"y":y,"width":right-x,"height":bottom-y,"unit":unit},"polygon":polygon,"detectionScore":score.parse::<f64>().ok()}),
        );
        cursor += text.len() + 1;
    }
}

pub(super) fn finish(layout: &mut Layout, text: &str) {
    layout.coverage = if layout.blocks.iter().any(|b| b.get("bounds").is_some()) {
        "physical-and-logical"
    } else if !layout.blocks.is_empty() {
        "logical"
    } else {
        "text"
    };
    if layout.blocks.is_empty() {
        let mut start = 0;
        for line in text.split_inclusive('\n').take(MAX_BLOCKS) {
            layout.blocks.push(json!({"id":format!("l{}",layout.blocks.len()+1),"kind":"paragraph","startByte":start,"endByte":start+line.len()}));
            start += line.len();
        }
        if start < text.len() {
            layout.truncated = true;
        }
        layout.warnings.push("Only extracted-text structure is available for this source; physical page coordinates were not reconstructed.".into());
    }
    if layout.pages.is_empty() {
        layout.warnings.push("This is a flow document or logical structure; page numbers and physical coordinates are unavailable.".into());
    }
    if layout.truncated {
        layout.warnings.push(
            "Layout block limit reached; remaining text may have no individual layout blocks."
                .into(),
        );
    }
}

fn span(block: &Value) -> Option<(usize, usize)> {
    Some((
        block["startByte"].as_u64()? as usize,
        block["endByte"].as_u64()? as usize,
    ))
}
fn value<'a>(block: &'a Value, text: &'a str) -> &'a str {
    let value = span(block)
        .and_then(|(a, b)| text.get(a..b))
        .or_else(|| block["text"].as_str())
        .unwrap_or("");
    if block["kind"] == "cell" && block.get("sourcePart").is_none() {
        value
    } else {
        value.trim_end_matches(['\r', '\n', '\t'])
    }
}
pub(super) fn html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn md(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('|', "\\|")
        .replace('\n', "<br>")
}
fn quote(text: &str, delimiter: char) -> String {
    if text.contains([delimiter, '"', '\r', '\n']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.into()
    }
}
fn grid<'a>(table: &Value, layout: &'a Layout, text: &'a str) -> Vec<Vec<&'a str>> {
    let cells: Vec<_> = layout
        .blocks
        .iter()
        .filter(|b| b["kind"] == "cell" && b["table"] == table["id"])
        .collect();
    let rows = cells
        .iter()
        .filter_map(|c| c["row"].as_u64())
        .max()
        .unwrap_or(0) as usize;
    let cols = cells
        .iter()
        .filter_map(|c| c["column"].as_u64())
        .max()
        .unwrap_or(0) as usize;
    // Do not allocate a sparse worksheet's entire coordinate rectangle.
    if rows.saturating_mul(cols) > 100_000 {
        return Vec::new();
    }
    let mut result = vec![vec![""; cols]; rows];
    for cell in cells {
        if let (Some(r), Some(c)) = (cell["row"].as_u64(), cell["column"].as_u64()) {
            if r > 0 && c > 0 {
                result[r as usize - 1][c as usize - 1] = value(cell, text);
            }
        }
    }
    result
}

pub(super) fn render(format: &str, text: &str, layout: &Layout, flat: bool) -> String {
    if matches!(format, "csv" | "tsv") {
        let delimiter = if format == "csv" { ',' } else { '\t' };
        let tables: Vec<_> = layout
            .blocks
            .iter()
            .filter(|b| b["kind"] == "table")
            .collect();
        let grid = if tables.len() == 1 && !flat {
            grid(tables[0], layout, text)
        } else {
            Vec::new()
        };
        let mut rows: Vec<Vec<String>> = Vec::new();
        if !grid.is_empty() {
            rows.extend(
                grid.iter()
                    .map(|r| r.iter().map(|v| v.to_string()).collect()),
            );
        } else {
            rows.push(
                [
                    "id",
                    "kind",
                    "page",
                    "table",
                    "row",
                    "column",
                    "text",
                    "x",
                    "y",
                    "width",
                    "height",
                    "unit",
                    "coordinateSpace",
                ]
                .map(String::from)
                .to_vec(),
            );
            for b in &layout.blocks {
                let field = |key: &str| {
                    b[key].as_str().map(String::from).unwrap_or_else(|| {
                        if b[key].is_null() {
                            String::new()
                        } else {
                            b[key].to_string()
                        }
                    })
                };
                let mut row = vec![
                    field("id"),
                    field("kind"),
                    field("page"),
                    field("table"),
                    field("row"),
                    field("column"),
                    value(b, text).into(),
                ];
                for k in ["x", "y", "width", "height", "unit"] {
                    row.push(
                        b["bounds"][k]
                            .as_str()
                            .map(String::from)
                            .unwrap_or_else(|| {
                                if b["bounds"][k].is_null() {
                                    String::new()
                                } else {
                                    b["bounds"][k].to_string()
                                }
                            }),
                    );
                }
                row.push(field("coordinateSpace"));
                rows.push(row);
            }
        }
        return rows
            .iter()
            .map(|r| {
                r.iter()
                    .map(|v| quote(v, delimiter))
                    .collect::<Vec<_>>()
                    .join(&delimiter.to_string())
                    + "\n"
            })
            .collect();
    }
    let is_html = format == "html";
    let mut result = if is_html {
        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>Document</title></head><body>\n".into()
    } else {
        String::new()
    };
    let tables: Vec<_> = layout
        .blocks
        .iter()
        .filter(|b| b["kind"] == "table")
        .collect();
    let mut cursor = 0;
    for block in &layout.blocks {
        if matches!(block["kind"].as_str(), Some("cell" | "row")) {
            continue;
        }
        if block["kind"] != "table"
            && tables.iter().any(|t| {
                span(t)
                    .zip(span(block))
                    .is_some_and(|((a, b), (c, d))| c >= a && d <= b)
            })
        {
            continue;
        }
        let Some((start, end)) = span(block) else {
            continue;
        };
        if start < cursor || end > text.len() || start >= end {
            continue;
        }
        if start > cursor {
            let gap = text[cursor..start].trim();
            if !gap.is_empty() {
                result.push_str(&if is_html {
                    format!("<p>{}</p>\n", html(gap))
                } else {
                    format!("{gap}\n\n")
                });
            }
        }
        let content = value(block, text);
        let grid = if block["kind"] == "table" {
            grid(block, layout, text)
        } else {
            Vec::new()
        };
        if !grid.is_empty() {
            if is_html {
                result.push_str("<table>\n");
                for row in &grid {
                    result.push_str("<tr>");
                    for cell in row {
                        result.push_str(&format!("<td>{}</td>", html(cell)));
                    }
                    result.push_str("</tr>\n");
                }
                result.push_str("</table>\n");
            } else {
                for (i, row) in grid.iter().enumerate() {
                    result.push_str(&format!(
                        "| {} |\n",
                        row.iter().map(|v| md(v)).collect::<Vec<_>>().join(" | ")
                    ));
                    if i == 0 {
                        result.push_str(&format!("| {} |\n", vec!["---"; row.len()].join(" | ")));
                    }
                }
                result.push('\n');
            }
        } else if !content.trim().is_empty() {
            let level = block["level"].as_u64().unwrap_or(1).clamp(1, 6);
            if is_html {
                let tag = if block["kind"] == "heading" {
                    format!("h{level}")
                } else {
                    "p".into()
                };
                result.push_str(&format!("<{tag}>{}</{tag}>\n", html(content)));
            } else if block["kind"] == "heading" {
                result.push_str(&format!("{} {content}\n\n", "#".repeat(level as usize)));
            } else {
                result.push_str(content);
                result.push_str("\n\n");
            }
        }
        cursor = end;
    }
    if cursor < text.len() {
        let tail = &text[cursor..];
        result.push_str(&if is_html {
            format!("<p>{}</p>\n", html(tail))
        } else {
            tail.into()
        });
    }
    if is_html {
        result.push_str("</body></html>\n");
    }
    result
}
