//! Stream sheet values without expanding ODF's repeated empty grid into RAM.
use super::*;

fn repeat(v: &BytesStart<'_>, key: &[u8]) -> Result<usize, ConvertError> {
    attribute(v, key).map_or(Ok(1), |s| {
        s.parse::<usize>()
            .ok()
            .filter(|&n| n > 0)
            .ok_or_else(|| parse_error("invalid ODF cell/row repeat".into()))
    })
}
fn cached(v: &BytesStart<'_>) -> String {
    [
        b"value".as_slice(),
        b"boolean-value",
        b"date-value",
        b"time-value",
        b"string-value",
    ]
    .iter()
    .find_map(|key| attribute(v, key))
    .unwrap_or_default()
}
fn emit(row: &[(String, usize)], count: usize) {
    let Some(last) = row.iter().rposition(|(s, _)| !s.is_empty()) else {
        return;
    };
    for _ in 0..count {
        let mut first = true;
        for (value, repeat) in &row[..=last] {
            for _ in 0..*repeat {
                if full() {
                    return;
                }
                if !first {
                    append("\t");
                }
                append(value);
                first = false;
            }
        }
        append("\n");
        if full() {
            return;
        }
    }
}
pub(super) fn extract(bytes: &[u8]) -> Result<(), ConvertError> {
    let mut reader = Reader::from_reader(bytes);
    let mut depth = 0usize;
    let mut row = Vec::new();
    let mut row_repeat = 1;
    let mut cell_repeat = 1;
    let mut cell_value = String::new();
    let mut cell_text = String::new();
    let mut in_cell = false;
    let mut text_depth = 0usize;
    loop {
        if full() {
            return Ok(());
        }
        let event = reader
            .read_event()
            .map_err(|e| parse_error(e.to_string()))?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(v) | Event::Empty(v) => match local_name(v.name().as_ref()) {
                b"table" => {
                    if depth == 0 {
                        append(&attribute(&v, b"name").unwrap_or_default());
                        append("\n");
                    }
                    if !empty {
                        depth += 1;
                    }
                }
                b"table-row" if depth == 1 => {
                    row.clear();
                    row_repeat = repeat(&v, b"number-rows-repeated")?;
                }
                b"table-cell" | b"covered-table-cell" if depth == 1 => {
                    cell_repeat = repeat(&v, b"number-columns-repeated")?;
                    cell_value = cached(&v);
                    cell_text.clear();
                    in_cell = !empty;
                    text_depth = 0;
                    if empty {
                        row.push((std::mem::take(&mut cell_value), cell_repeat));
                    }
                }
                b"p" | b"h" if in_cell && !empty => text_depth += 1,
                b"s" if in_cell && text_depth > 0 => {
                    // Text space runs are bounded by the content budget.
                    let count = repeat(&v, b"c")?;
                    let limit = STATE.with(|s| s.borrow().as_ref().unwrap().limit);
                    cell_text.extend(std::iter::repeat_n(' ', count.min(limit)));
                }
                b"tab" if in_cell => cell_text.push('\t'),
                b"line-break" if in_cell => cell_text.push('\n'),
                _ => {}
            },
            Event::Text(v) if in_cell && text_depth > 0 => {
                cell_text.push_str(&v.decode().map_err(|e| parse_error(e.to_string()))?)
            }
            Event::CData(v) if in_cell && text_depth > 0 => {
                cell_text.push_str(&v.decode().map_err(|e| parse_error(e.to_string()))?)
            }
            Event::GeneralRef(v) if in_cell && text_depth > 0 => {
                append_xml_reference(&mut cell_text, &v, "ODF sheet")?
            }
            Event::End(v) => match local_name(v.name().as_ref()) {
                b"p" | b"h" if in_cell => {
                    text_depth = text_depth.saturating_sub(1);
                    cell_text.push('\n');
                }
                b"table-cell" if in_cell => {
                    let value = if cell_value.is_empty() {
                        cell_text.trim_end_matches('\n').to_owned()
                    } else {
                        std::mem::take(&mut cell_value)
                    };
                    row.push((value, cell_repeat));
                    in_cell = false;
                }
                b"table-row" if depth == 1 => emit(&row, row_repeat),
                b"table" => depth = depth.saturating_sub(1),
                _ => {}
            },
            Event::Eof => return Ok(()),
            _ => {}
        }
    }
}
