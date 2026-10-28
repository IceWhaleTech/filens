//! Indexing policy lives in WASM. The host supplies OCR and a PDFium WASM
//! invocation bridge; it never decides reading order or when OCR is needed.
use super::*;
use calamine::Reader as WorkbookReader;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::path::{Component, PathBuf};

const MAX_INPUT: u64 = 256 << 20;
thread_local! { static STATE: RefCell<Option<State>> = const { RefCell::new(None) }; }

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome {
    text: String,
    complete: bool,
    truncated: bool,
    warnings: Vec<String>,
    error_code: String,
    error_message: String,
}
struct State {
    result: Outcome,
    limit: usize,
    ocr_limit: usize,
    ocr_pages: usize,
    work: PathBuf,
    images: HashMap<String, String>,
}

pub(super) fn active() -> bool {
    STATE.with(|s| s.borrow().is_some())
}
fn full() -> bool {
    STATE.with(|s| s.borrow().as_ref().is_some_and(|s| s.result.truncated))
}
fn append(value: &str) {
    STATE.with(|s| {
        let mut slot = s.borrow_mut();
        let s = slot.as_mut().unwrap();
        let remaining = s.limit.saturating_sub(s.result.text.len());
        let mut end = value.len().min(remaining);
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        s.result.text.push_str(&value[..end]);
        if end < value.len() {
            s.result.truncated = true;
        }
    });
}
fn partial(code: &str, message: String) {
    STATE.with(|s| {
        let mut slot = s.borrow_mut();
        let s = slot.as_mut().unwrap();
        s.result.complete = false;
        if s.result.error_code.is_empty() {
            s.result.error_code = code.into();
            s.result.error_message = message.clone();
        }
        if s.result.warnings.len() < 32 {
            s.result.warnings.push(message);
        }
    });
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "filens_text")]
unsafe extern "C" {
    fn host_call(request: *const u8, length: usize, response: *mut u8, capacity: usize) -> i32;
}
fn host(request: Value) -> Result<Value, ConvertError> {
    #[cfg(target_arch = "wasm32")]
    {
        let bytes = serde_json::to_vec(&request).unwrap();
        let mut output = vec![0; 4 << 20];
        let length = unsafe {
            host_call(
                bytes.as_ptr(),
                bytes.len(),
                output.as_mut_ptr(),
                output.len(),
            )
        };
        if length <= 0 || length as usize > output.len() {
            return Err(ConvertError {
                code: "engine_unavailable",
                message: "invalid extraction host response".into(),
            });
        }
        let result: Value = serde_json::from_slice(&output[..length as usize])
            .map_err(|e| parse_error(format!("extraction host response: {e}")))?;
        if let Some(error) = result
            .get("error")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            let code = match result["errorCode"].as_str() {
                Some("password_required") => "password_required",
                Some("parse_error") => "parse_error",
                _ => "engine_unavailable",
            };
            return Err(ConvertError {
                code,
                message: error.into(),
            });
        }
        Ok(result)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = request;
        Err(ConvertError {
            code: "engine_unavailable",
            message: "OCR/PDF requires the WASM host".into(),
        })
    }
}

fn image(bytes: &[u8], extension: &str) -> Result<(), ConvertError> {
    if full() {
        return Ok(());
    }
    let hash = format!("{:x}", Sha256::digest(bytes));
    let cached = STATE.with(|s| s.borrow().as_ref().unwrap().images.get(&hash).cloned());
    if let Some(text) = cached {
        append(&text);
        append("\n");
        return Ok(());
    }
    let ext: String = extension
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(8)
        .collect();
    let path = STATE.with(|s| {
        s.borrow()
            .as_ref()
            .unwrap()
            .work
            .join(format!("image-{hash}.{ext}"))
    });
    fs::write(&path, bytes).map_err(|e| io_error(format!("write OCR image: {e}")))?;
    let result = host(json!({"operation":"ocr", "path":path}));
    let _ = fs::remove_file(path);
    match result {
        Ok(result) => {
            let text = result["text"].as_str().unwrap_or("").to_owned();
            append(&text);
            append("\n");
            STATE.with(|s| {
                s.borrow_mut().as_mut().unwrap().images.insert(hash, text);
            });
        }
        Err(error) => partial("ocr_failed", error.message),
    }
    Ok(())
}

pub(super) fn paragraphs(paragraphs: &[DocxParagraph]) -> Result<(), ConvertError> {
    for paragraph in paragraphs {
        if full() {
            break;
        }
        if paragraph.runs.is_empty() {
            append(&paragraph.text);
        } else {
            for run in &paragraph.runs {
                append(&run.text);
                if let Some(picture) = &run.image {
                    image(&picture.data, picture.extension)?;
                }
            }
        }
        append(if paragraph.table_cell_end && !paragraph.table_row_end {
            "\t"
        } else {
            "\n"
        });
    }
    Ok(())
}
pub(super) fn sheets(sheets: &[(&str, &[Vec<SheetCell>])]) -> Result<(), ConvertError> {
    for (name, rows) in sheets {
        append(name);
        append("\n");
        for row in *rows {
            if full() {
                return Ok(());
            }
            for (index, cell) in row.iter().enumerate() {
                if index > 0 {
                    append("\t");
                }
                match cell {
                    SheetCell::Empty => {}
                    SheetCell::Text(s) | SheetCell::Number(s) | SheetCell::Date(s) => append(s),
                    SheetCell::Bool(v) => append(if *v { "true" } else { "false" }),
                }
            }
            append("\n");
        }
    }
    Ok(())
}
pub(super) fn slides(slides: &[OdfSlide]) -> Result<(), ConvertError> {
    for slide in slides {
        if full() {
            break;
        }
        for text in &slide.paragraphs {
            append(text);
            append("\n");
        }
        for picture in slide.image.iter().chain(slide.overlay_images.iter()) {
            image(&picture.data, picture.extension)?;
        }
    }
    Ok(())
}

pub(super) fn execute(request: &Request, started: Instant) {
    let limit = request.options_json["maxBytes"]
        .as_u64()
        .unwrap_or(8 << 20)
        .min(32 << 20) as usize;
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            result: Outcome {
                complete: true,
                ..Default::default()
            },
            limit,
            ocr_limit: request.options_json["maxOCRPages"]
                .as_u64()
                .unwrap_or(200)
                .min(200) as usize,
            ocr_pages: 0,
            work: Path::new(&request.output)
                .parent()
                .unwrap_or(Path::new("/work"))
                .into(),
            images: HashMap::new(),
        })
    });
    let extracted = extract(request);
    if let Err(error) = extracted {
        partial(error.code, error.message);
    }
    let result = STATE.with(|s| s.borrow_mut().take().unwrap().result);
    let input_size = fs::metadata(&request.input).map_or(0, |m| m.len());
    let contract = ResultContract {
        ok: result.complete,
        source_format: request.source.clone(),
        target_format: "text".into(),
        backend: "wasm-text".into(),
        content_type: "text/plain; charset=utf-8".into(),
        error_code: result.error_code.clone(),
        error_message: result.error_message.clone(),
        warnings: result.warnings.clone(),
        payload: Some(serde_json::to_value(result).unwrap()),
        metrics: Metrics {
            elapsed_ms: 0,
            input_size,
        },
        ..Default::default()
    };
    if let Err(error) = write_result(&request.result, contract, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn extract(request: &Request) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(&request.input).map_err(|e| io_error(format!("stat input: {e}")))?;
    if !metadata.is_file() || metadata.len() > MAX_INPUT {
        return Err(io_error(
            "input must be a regular file no larger than 256 MiB".into(),
        ));
    }
    if let Some((_, code, message)) = encrypted_input_failure(request) {
        return Err(ConvertError { code, message });
    }
    let input = &request.input;
    let source = request.source.as_str();
    match source {
        "pdf" => pdf(input),
        "djvu" => djvu(input),
        "pages" | "numbers" | "key" => iwork(input, source),
        "docx" | "docm" | "docxf" | "dotx" | "dotm" => openxml(input, "word"),
        "pptx" | "pptm" | "ppsx" | "ppsm" | "potx" | "potm" => openxml(input, "ppt"),
        "xlsx" | "xlsm" | "xltx" | "xltm" | "xlsb" => spreadsheet(input),
        "xps" | "oxps" => xps(input),
        "dwg" | "dxf" => cad(input, source),
        "png" | "jpg" | "jpeg" | "jpe" | "jfif" | "gif" | "bmp" | "tif" | "tiff" | "webp" => {
            let bytes = fs::read(input).map_err(|e| io_error(e.to_string()))?;
            image(&bytes, source)
        }
        "ppm" => {
            let path = STATE.with(|s| s.borrow().as_ref().unwrap().work.join("ppm.png"));
            ppm::convert(input, path.to_str().unwrap())?;
            let bytes = fs::read(&path).map_err(|e| io_error(e.to_string()))?;
            let _ = fs::remove_file(path);
            image(&bytes, "png")
        }
        _ if is_word_binary_source(source) => convert_word_binary(input, ""),
        _ if is_ppt_binary_source(source) => convert_ppt_binary(input, ""),
        _ if is_biff_source(source) => convert_biff(input, ""),
        _ if is_odf_source(source) => odf(input, source),
        "rtf" => paragraphs(&extract_rtf_paragraphs(
            &fs::read(input).map_err(|e| io_error(e.to_string()))?,
        )?),
        _ if is_raw_source(source) || source == "raw" => {
            let output = STATE.with(|s| s.borrow().as_ref().unwrap().work.join("raw-preview.jpg"));
            convert_raw_preview(input, output.to_str().unwrap(), "jpg")?;
            let bytes = fs::read(&output).map_err(|e| io_error(e.to_string()))?;
            let _ = fs::remove_file(output);
            image(&bytes, "jpg")
        }
        _ => {
            let pairs: Vec<ConversionPair> = serde_json::from_str(CONVERSIONS).unwrap();
            if !pairs
                .iter()
                .any(|p| p.source_format == source && p.target_format == "docx")
            {
                return Err(ConvertError {
                    code: "unsupported_format",
                    message: format!("no text extraction for {source}"),
                });
            }
            convert_text(input, "", source)
        }
    }
}

fn archive(input: &str) -> Result<ZipArchive<File>, ConvertError> {
    let file = File::open(input).map_err(|e| io_error(e.to_string()))?;
    let z = ZipArchive::new(file).map_err(|e| parse_error(e.to_string()))?;
    if z.len() > MAX_PACKAGE_ENTRIES || z.decompressed_size().is_some_and(|n| n > MAX_INPUT as u128)
    {
        return Err(parse_error("package exceeds extraction limits".into()));
    }
    Ok(z)
}
fn entry(z: &mut ZipArchive<File>, path: &str) -> Result<Vec<u8>, ConvertError> {
    let f = z
        .by_name(path)
        .map_err(|e| parse_error(format!("{path}: {e}")))?;
    if f.size() > MAX_ENTRY_BYTES {
        return Err(parse_error(format!("{path}: entry too large")));
    }
    let mut out = Vec::new();
    f.take(MAX_ENTRY_BYTES + 1)
        .read_to_end(&mut out)
        .map_err(|e| parse_error(e.to_string()))?;
    if out.len() as u64 > MAX_ENTRY_BYTES {
        return Err(parse_error("entry exceeds extraction limit".into()));
    }
    Ok(out)
}
fn names(z: &ZipArchive<File>) -> Vec<String> {
    z.file_names().map(str::to_owned).collect()
}
fn resolve(part: &str, target: &str) -> Result<String, ConvertError> {
    let mut out = PathBuf::new();
    let joined = if target.starts_with('/') {
        PathBuf::from(target.trim_start_matches('/'))
    } else {
        Path::new(part)
            .parent()
            .unwrap_or(Path::new(""))
            .join(target)
    };
    for component in joined.components() {
        match component {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            Component::ParentDir if out.pop() => {}
            _ => return Err(parse_error("package relationship escapes its root".into())),
        }
    }
    Ok(out.to_string_lossy().replace('\\', "/"))
}
// Attribute entities must be decoded before paths or visible text are used.
fn attribute(start: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    start
        .attributes()
        .flatten()
        .find(|a| local_name(a.key.as_ref()) == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}
fn relationships(
    z: &mut ZipArchive<File>,
    part: &str,
) -> Result<HashMap<String, String>, ConvertError> {
    let p = Path::new(part);
    let rel = p
        .parent()
        .unwrap_or(Path::new(""))
        .join("_rels")
        .join(format!("{}.rels", p.file_name().unwrap().to_string_lossy()));
    let rel = rel.to_string_lossy();
    if !z.file_names().any(|n| n == rel) {
        return Ok(HashMap::new());
    }
    let bytes = entry(z, &rel)?;
    let mut reader = Reader::from_reader(bytes.as_slice());
    let mut result = HashMap::new();
    loop {
        match reader.read_event() {
            Ok(Event::Empty(v)) | Ok(Event::Start(v))
                if local_name(v.name().as_ref()) == b"Relationship" =>
            {
                if attribute(&v, b"TargetMode").as_deref() == Some("External") {
                    continue;
                }
                if let (Some(id), Some(target)) = (attribute(&v, b"Id"), attribute(&v, b"Target")) {
                    result.insert(id, resolve(part, &target)?);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(parse_error(e.to_string())),
            _ => {}
        }
    }
    Ok(result)
}
fn part_image(z: &mut ZipArchive<File>, path: &str) -> Result<(), ConvertError> {
    image(
        &entry(z, path)?,
        Path::new(path)
            .extension()
            .and_then(|p| p.to_str())
            .unwrap_or("bin"),
    )
}
fn xml_part(z: &mut ZipArchive<File>, part: &str) -> Result<(), ConvertError> {
    let rels = relationships(z, part)?;
    let bytes = entry(z, part)?;
    let mut reader = Reader::from_reader(bytes.as_slice());
    let mut text_depth: usize = 0;
    let mut skip_depth: usize = 0;
    let mut image_depth: usize = 0;
    let mut binary: Option<String> = None;
    loop {
        if full() {
            break;
        }
        let event = reader.read_event();
        let empty = matches!(&event, Ok(Event::Empty(_)));
        match event {
            Ok(Event::Start(v)) | Ok(Event::Empty(v)) => {
                let name = v.name();
                let local = local_name(name.as_ref());
                if !empty && matches!(local, b"t" | b"p" | b"h") {
                    text_depth += 1;
                }
                if !empty && matches!(local, b"instrText" | b"del" | b"binary-data") {
                    skip_depth += 1;
                }
                if matches!(local, b"tab") {
                    append("\t");
                }
                if matches!(local, b"br" | b"line-break") {
                    append("\n");
                }
                if local == b"Glyphs" {
                    if let Some(value) = attribute(&v, b"UnicodeString") {
                        append(&value);
                        append("\n");
                    }
                }
                if matches!(local, b"blip" | b"imagedata") {
                    if let Some(path) = attribute(&v, b"embed")
                        .or_else(|| attribute(&v, b"id"))
                        .and_then(|id| rels.get(&id))
                    {
                        part_image(z, path)?;
                    }
                }
                if local == b"image" {
                    if !empty {
                        image_depth += 1;
                    }
                    if let Some(target) = attribute(&v, b"href") {
                        part_image(z, &resolve(part, &target)?)?;
                    }
                }
                if local == b"binary-data" && !empty && image_depth > 0 {
                    binary = Some(String::new());
                }
                if local == b"ImageBrush" {
                    if let Some(target) =
                        attribute(&v, b"ImageSource").filter(|s| !s.starts_with('{'))
                    {
                        part_image(z, &resolve(part, &target)?)?;
                    }
                }
            }
            Ok(Event::End(v)) => match local_name(v.name().as_ref()) {
                b"t" => text_depth = text_depth.saturating_sub(1),
                b"p" | b"h" => {
                    text_depth = text_depth.saturating_sub(1);
                    append("\n");
                }
                b"tc" => append("\t"),
                b"tr" => append("\n"),
                b"instrText" | b"del" => skip_depth = skip_depth.saturating_sub(1),
                b"image" => image_depth = image_depth.saturating_sub(1),
                b"binary-data" => {
                    skip_depth = skip_depth.saturating_sub(1);
                    if let Some(encoded) = binary.take() {
                        let bytes = decode_base64(&encoded)
                            .ok_or_else(|| parse_error("invalid embedded ODF image".into()))?;
                        image(&bytes, "bin")?;
                    }
                }
                _ => {}
            },
            Ok(Event::Text(v)) if binary.is_some() => binary
                .as_mut()
                .unwrap()
                .push_str(&v.decode().map_err(|e| parse_error(e.to_string()))?),
            Ok(Event::Text(v)) if text_depth > 0 && skip_depth == 0 => {
                append(&v.decode().map_err(|e| parse_error(e.to_string()))?)
            }
            Ok(Event::CData(v)) if text_depth > 0 && skip_depth == 0 => {
                append(&v.decode().map_err(|e| parse_error(e.to_string()))?)
            }
            Ok(Event::GeneralRef(v)) if text_depth > 0 && skip_depth == 0 => {
                let mut s = String::new();
                append_xml_reference(&mut s, &v, "extract text")?;
                append(&s);
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(parse_error(e.to_string())),
            _ => {}
        }
    }
    Ok(())
}
fn openxml(input: &str, family: &str) -> Result<(), ConvertError> {
    let mut z = archive(input)?;
    if family == "word" {
        xml_part(&mut z, "word/document.xml")?;
        let mut others: Vec<_> = names(&z)
            .into_iter()
            .filter(|s| {
                s.starts_with("word/")
                    && s.ends_with(".xml")
                    && (s.contains("header")
                        || s.contains("footer")
                        || s.ends_with("footnotes.xml")
                        || s.ends_with("endnotes.xml"))
            })
            .collect();
        others.sort();
        for part in others {
            xml_part(&mut z, &part)?;
        }
    } else {
        let part = "ppt/presentation.xml";
        let rels = relationships(&mut z, part)?;
        let bytes = entry(&mut z, part)?;
        let mut reader = Reader::from_reader(bytes.as_slice());
        loop {
            match reader.read_event() {
                Ok(Event::Start(v)) | Ok(Event::Empty(v))
                    if local_name(v.name().as_ref()) == b"sldId" =>
                {
                    // local_name(Id) differs from the lower-case relationship id.
                    if let Some(path) = v
                        .attributes()
                        .flatten()
                        .find(|a| a.key.as_ref().ends_with(b":id"))
                        .map(|a| String::from_utf8_lossy(&a.value).into_owned())
                        .and_then(|id| rels.get(&id))
                    {
                        xml_part(&mut z, path)?;
                    }
                    if full() {
                        break;
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(parse_error(e.to_string())),
                _ => {}
            }
        }
    }
    Ok(())
}
fn spreadsheet(input: &str) -> Result<(), ConvertError> {
    let mut z = archive(input)?;
    let normalized = if input.ends_with(".xlsb") {
        Some(normalize_xlsb(&mut z)?)
    } else {
        None
    };
    let workbook_input = normalized
        .as_ref()
        .map(|p| p.to_str().unwrap())
        .unwrap_or(input);
    let mut workbook =
        calamine::open_workbook_auto(workbook_input).map_err(|e| parse_error(e.to_string()))?;
    let mut sheet_parts = HashMap::new();
    if z.file_names().any(|p| p == "xl/workbook.xml") {
        let rels = relationships(&mut z, "xl/workbook.xml")?;
        let bytes = entry(&mut z, "xl/workbook.xml")?;
        let mut r = Reader::from_reader(bytes.as_slice());
        loop {
            match r.read_event() {
                Ok(Event::Start(v)) | Ok(Event::Empty(v))
                    if local_name(v.name().as_ref()) == b"sheet" =>
                {
                    if let (Some(name), Some(path)) = (
                        attribute(&v, b"name"),
                        attribute(&v, b"id").and_then(|id| rels.get(&id)),
                    ) {
                        sheet_parts.insert(name, path.clone());
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(parse_error(e.to_string())),
                _ => {}
            }
        }
    }
    for name in workbook.sheet_names().to_owned() {
        append(&name);
        append("\n");
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| parse_error(e.to_string()))?;
        for row in range.rows() {
            if full() {
                return Ok(());
            }
            for (index, cell) in row.iter().enumerate() {
                if index > 0 {
                    append("\t");
                }
                append(&cell.to_string());
            }
            append("\n");
        }
        if let Some(part) = sheet_parts.get(&name) {
            let rels = relationships(&mut z, part)?;
            let bytes = entry(&mut z, part)?;
            let mut r = Reader::from_reader(bytes.as_slice());
            loop {
                match r.read_event() {
                    Ok(Event::Start(v)) | Ok(Event::Empty(v))
                        if local_name(v.name().as_ref()) == b"drawing" =>
                    {
                        if let Some(path) = attribute(&v, b"id").and_then(|id| rels.get(&id)) {
                            xml_part(&mut z, path)?;
                        }
                    }
                    Ok(Event::Eof) => break,
                    Err(e) => return Err(parse_error(e.to_string())),
                    _ => {}
                }
            }
        }
    }
    // XLSB's binary worksheet records are decoded by calamine. Drawing XML
    // remains in the OPC package and is processed in its stable part order.
    if sheet_parts.is_empty() {
        let mut drawings: Vec<_> = names(&z)
            .into_iter()
            .filter(|n| n.starts_with("xl/drawings/drawing") && n.ends_with(".xml"))
            .collect();
        drawings.sort();
        for drawing in drawings {
            xml_part(&mut z, &drawing)?;
        }
    }
    Ok(())
}

// Excel 2007 beta XLSB files have an extra reserved u32 in BrtBundleSh.
// Normalize that historical record in WASM, and validate relationships before
// calamine's unchecked map lookup. The source package is never modified.
fn normalize_xlsb(z: &mut ZipArchive<File>) -> Result<PathBuf, ConvertError> {
    let rels = relationships(z, "xl/workbook.bin")?;
    let bytes = entry(z, "xl/workbook.bin")?;
    let mut normalized = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let record_start = at;
        let first = bytes[at];
        at += 1;
        let typ = if first & 128 != 0 {
            let next = *bytes
                .get(at)
                .ok_or_else(|| parse_error("truncated XLSB type".into()))?;
            at += 1;
            u16::from(first & 127) | (u16::from(next) << 7)
        } else {
            u16::from(first)
        };
        let mut size = 0usize;
        let mut terminated = false;
        for shift in (0..28).step_by(7) {
            let b = *bytes
                .get(at)
                .ok_or_else(|| parse_error("truncated XLSB size".into()))?;
            at += 1;
            size |= usize::from(b & 127) << shift;
            if b & 128 == 0 {
                terminated = true;
                break;
            }
        }
        if !terminated
            || size > MAX_ENTRY_BYTES as usize
            || at.checked_add(size).is_none_or(|n| n > bytes.len())
        {
            return Err(parse_error("invalid XLSB record size".into()));
        }
        let payload = &bytes[at..at + size];
        at += size;
        if typ == 0x009c {
            let relationship = |offset: usize| -> Option<String> {
                let count =
                    u32::from_le_bytes(payload.get(offset..offset + 4)?.try_into().ok()?) as usize;
                let raw = payload.get(offset + 4..offset + 4 + count.checked_mul(2)?)?;
                String::from_utf16(
                    &raw.chunks_exact(2)
                        .map(|b| u16::from_le_bytes([b[0], b[1]]))
                        .collect::<Vec<_>>(),
                )
                .ok()
            };
            let modern = relationship(8).is_some_and(|id| rels.contains_key(&id));
            if !modern && relationship(12).is_some_and(|id| rels.contains_key(&id)) {
                normalized.push(first);
                if first & 128 != 0 {
                    normalized.push((typ >> 7) as u8);
                }
                let mut size = size - 4;
                loop {
                    let b = (size & 127) as u8;
                    size >>= 7;
                    normalized.push(if size > 0 { b | 128 } else { b });
                    if size == 0 {
                        break;
                    }
                }
                normalized.extend_from_slice(&payload[..4]);
                normalized.extend_from_slice(&payload[8..]);
                continue;
            }
            if !modern {
                return Err(parse_error("XLSB worksheet relationship is missing".into()));
            }
        }
        normalized.extend_from_slice(&bytes[record_start..at]);
    }
    let path = STATE.with(|s| s.borrow().as_ref().unwrap().work.join("normalized.xlsb"));
    let file = File::create(&path).map_err(|e| io_error(e.to_string()))?;
    let mut output = zip::ZipWriter::new(file);
    for name in names(z) {
        if name.ends_with('/') {
            continue;
        }
        let content = if name == "xl/workbook.bin" {
            normalized.clone()
        } else {
            entry(z, &name)?
        };
        output
            .start_file(
                &name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .map_err(|e| io_error(e.to_string()))?;
        output
            .write_all(&content)
            .map_err(|e| io_error(e.to_string()))?;
    }
    output.finish().map_err(|e| io_error(e.to_string()))?;
    Ok(path)
}
fn odf(input: &str, source: &str) -> Result<(), ConvertError> {
    if source.starts_with('f') {
        let bytes = fs::read(input).map_err(|e| io_error(e.to_string()))?;
        let mut reader = Reader::from_reader(bytes.as_slice());
        let mut writer = quick_xml::Writer::new(Vec::new());
        let mut image_depth: usize = 0;
        let mut binary = None;
        let mut pictures = Vec::new();
        loop {
            let event = reader
                .read_event()
                .map_err(|e| parse_error(e.to_string()))?;
            match &event {
                Event::Start(v) if local_name(v.name().as_ref()) == b"image" => image_depth += 1,
                Event::Start(v)
                    if local_name(v.name().as_ref()) == b"binary-data" && image_depth > 0 =>
                {
                    binary = Some(String::new())
                }
                Event::Text(v) if binary.is_some() => {
                    binary
                        .as_mut()
                        .unwrap()
                        .push_str(&v.decode().map_err(|e| parse_error(e.to_string()))?);
                    continue;
                }
                Event::End(v) if local_name(v.name().as_ref()) == b"binary-data" => {
                    if let Some(encoded) = binary.take() {
                        pictures.push(
                            decode_base64(&encoded)
                                .ok_or_else(|| parse_error("invalid embedded ODF image".into()))?,
                        );
                    }
                }
                Event::End(v) if local_name(v.name().as_ref()) == b"image" => {
                    image_depth = image_depth.saturating_sub(1)
                }
                Event::Eof => break,
                _ => {}
            }
            writer
                .write_event(event)
                .map_err(|e| io_error(e.to_string()))?;
        }
        let clean = STATE.with(|s| {
            s.borrow()
                .as_ref()
                .unwrap()
                .work
                .join(format!("flat-clean.{source}"))
        });
        fs::write(&clean, writer.into_inner()).map_err(|e| io_error(e.to_string()))?;
        convert_odf(
            clean.to_str().unwrap(),
            "",
            source,
            if source == "fods" {
                "xlsx"
            } else if source == "fodp" {
                "pptx"
            } else {
                "docx"
            },
        )?;
        let _ = fs::remove_file(clean);
        for picture in pictures {
            image(&picture, "bin")?;
        }
        return Ok(());
    }
    let mut z = archive(input)?;
    if source.ends_with('s') || matches!(source, "sxc" | "stc") {
        convert_odf(input, "", source, "xlsx")?;
        let content = entry(&mut z, "content.xml")?;
        // Only emit images here; sheet values have already been emitted.
        odf_images(&mut z, &content)
    } else {
        xml_part(&mut z, "content.xml")
    }
}
fn odf_images(z: &mut ZipArchive<File>, bytes: &[u8]) -> Result<(), ConvertError> {
    let mut r = Reader::from_reader(bytes);
    loop {
        match r.read_event() {
            Ok(Event::Start(v)) | Ok(Event::Empty(v))
                if local_name(v.name().as_ref()) == b"image" =>
            {
                if let Some(p) = attribute(&v, b"href") {
                    part_image(z, &resolve("content.xml", &p)?)?;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(parse_error(e.to_string())),
            _ => {}
        }
    }
    Ok(())
}
fn xps(input: &str) -> Result<(), ConvertError> {
    let mut z = archive(input)?;
    let sequence = names(&z)
        .into_iter()
        .find(|n| n.to_lowercase().ends_with(".fdseq"))
        .ok_or_else(|| parse_error("missing XPS document sequence".into()))?;
    let docs = xps_references(&mut z, &sequence, b"DocumentReference")?;
    for doc in docs {
        for page in xps_references(&mut z, &doc, b"PageContent")? {
            xml_part(&mut z, &page)?;
            if full() {
                return Ok(());
            }
        }
    }
    Ok(())
}
fn xps_references(
    z: &mut ZipArchive<File>,
    part: &str,
    tag: &[u8],
) -> Result<Vec<String>, ConvertError> {
    let bytes = entry(z, part)?;
    let mut r = Reader::from_reader(bytes.as_slice());
    let mut refs = Vec::new();
    loop {
        match r.read_event() {
            Ok(Event::Start(v)) | Ok(Event::Empty(v)) if local_name(v.name().as_ref()) == tag => {
                if let Some(target) = attribute(&v, b"Source") {
                    refs.push(resolve(part, &target)?);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(parse_error(e.to_string())),
            _ => {}
        }
    }
    Ok(refs)
}
fn pdf(input: &str) -> Result<(), ConvertError> {
    let pages = host(json!({"operation":"pdf_open","path":input}))?["pages"]
        .as_u64()
        .ok_or_else(|| parse_error("missing PDF page count".into()))?;
    for page in 0..pages {
        if full() {
            break;
        }
        let text = host(json!({"operation":"pdf_text","page":page}))?["text"]
            .as_str()
            .unwrap_or("")
            .to_owned();
        if text.chars().any(|c| !c.is_whitespace() && !c.is_control()) {
            append(&text);
            append("\n");
            continue;
        }
        if !ocr_page() {
            break;
        }
        let path = STATE.with(|s| s.borrow().as_ref().unwrap().work.join("pdf-page.png"));
        match host(json!({"operation":"pdf_render","page":page,"path":path,"dpi":200})) {
            Ok(_) => {
                let bytes = fs::read(&path).map_err(|e| io_error(e.to_string()))?;
                let _ = fs::remove_file(path);
                image(&bytes, "png")?;
            }
            Err(e) => partial("page_failed", e.message),
        }
    }
    Ok(())
}
fn ocr_page() -> bool {
    STATE.with(|s| {
        let mut slot = s.borrow_mut();
        let s = slot.as_mut().unwrap();
        if s.ocr_pages >= s.ocr_limit {
            s.result.truncated = true;
            false
        } else {
            s.ocr_pages += 1;
            true
        }
    })
}
fn djvu(input: &str) -> Result<(), ConvertError> {
    let doc = djvu_rs::Document::open(input).map_err(|e| parse_error(e.to_string()))?;
    for index in 0..doc.page_count() {
        if full() {
            break;
        }
        let page = doc.page(index).map_err(|e| parse_error(e.to_string()))?;
        if let Some(text) = page
            .text()
            .map_err(|e| parse_error(e.to_string()))?
            .filter(|s| !s.trim().is_empty())
        {
            append(&text);
            append("\n");
        } else {
            if !ocr_page() {
                break;
            }
            let (w, h) = page.size_at_dpi(200.0);
            if u64::from(w) * u64::from(h) > 32_000_000 {
                return Err(parse_error("DjVu page exceeds pixel limit".into()));
            }
            let pix = page
                .render_to_size(w, h)
                .map_err(|e| parse_error(e.to_string()))?;
            let mut bytes = Vec::new();
            let mut encoder = png::Encoder::new(&mut bytes, w, h);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .map_err(|e| io_error(e.to_string()))?
                .write_image_data(&pix.data)
                .map_err(|e| io_error(e.to_string()))?;
            image(&bytes, "png")?;
        }
    }
    Ok(())
}
fn iwork(input: &str, source: &str) -> Result<(), ConvertError> {
    let _ = archive(input)?;
    let doc = iwork::Document::open(input).map_err(|e| parse_error(e.to_string()))?;
    let mut visit = IWorkText {
        doc: &doc,
        elements: doc
            .elements()
            .into_iter()
            .map(|e| (e.identifier.get(), e))
            .collect(),
        tables: doc
            .tables()
            .into_iter()
            .map(|t| (t.identifier.get(), t))
            .collect(),
        media: doc
            .data_files()
            .into_iter()
            .map(|d| (d.identifier, d.stored_name))
            .collect(),
        seen: HashSet::new(),
        storages: HashSet::new(),
    };
    match source {
        "key" => {
            for slide in doc.slides() {
                for id in slide.drawables {
                    visit.element(id)?;
                }
                // Placeholders inherited from a layout may not be in owned_drawables.
                for text in slide.texts {
                    visit.storage(text.storage)?;
                }
                append(&slide.notes);
                append("\n");
                if full() {
                    break;
                }
            }
        }
        "numbers" => {
            for sheet in doc.sheets() {
                append(&sheet.name);
                append("\n");
                for id in sheet.drawables {
                    visit.element(id)?;
                }
                if full() {
                    break;
                }
            }
        }
        _ => {
            if let Some(body) = doc.body_storage() {
                visit.storage(body)?;
            }
            let mut floating: Vec<_> = visit
                .elements
                .values()
                .filter_map(|e| match e.placement {
                    iwork::drawable::Placement::Floating { page } => {
                        Some((page, e.geometry.y, e.geometry.x, e.identifier.get()))
                    }
                    _ => None,
                })
                .collect();
            floating.sort_by(|a, b| {
                a.0.cmp(&b.0)
                    .then(a.1.total_cmp(&b.1))
                    .then(a.2.total_cmp(&b.2))
            });
            for (_, _, _, id) in floating {
                visit.element(id)?;
            }
            // Include headers, footnotes and other storages after the main flow.
            for storage in doc.text_storages() {
                visit.storage(storage.identifier)?;
            }
        }
    }
    Ok(())
}
struct IWorkText<'a> {
    doc: &'a iwork::Document,
    elements: HashMap<u64, iwork::drawable::ElementInfo>,
    tables: HashMap<u64, iwork::table::TableInfo>,
    media: HashMap<u64, String>,
    seen: HashSet<u64>,
    storages: HashSet<u64>,
}
impl IWorkText<'_> {
    fn element(&mut self, id: u64) -> Result<(), ConvertError> {
        if full() || !self.seen.insert(id) {
            return Ok(());
        }
        if let Some(table) = self.tables.get(&id) {
            append(&table.name);
            append("\n");
            let mut cells = table.cells().to_vec();
            cells.sort_by_key(|c| (c.row, c.column));
            let mut last_row = None;
            for cell in cells {
                if full() {
                    break;
                }
                if last_row != Some(cell.row) {
                    if last_row.is_some() {
                        append("\n");
                    }
                    last_row = Some(cell.row);
                } else {
                    append("\t");
                }
                append(&iwork_cell(&cell.value));
            }
            append("\n");
        }
        if let Some(element) = self.elements.get(&id).cloned() {
            if let Some(storage) = element.text {
                self.storage(storage)?;
            }
            if let Some(data) = element
                .media
                .and_then(|m| m.data)
                .and_then(|id| self.media.get(&id))
            {
                let path = format!("Data/{data}");
                if let Some(bytes) = self.doc.package().get(&path) {
                    let ext = Path::new(data)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("bin");
                    image(bytes, ext)?;
                } else {
                    partial("parse_error", format!("missing iWork media {path}"));
                }
            }
            for child in element.children {
                self.element(child)?;
            }
        }
        Ok(())
    }
    fn storage(&mut self, id: u64) -> Result<(), ConvertError> {
        if full() || !self.storages.insert(id) {
            return Ok(());
        }
        let text = self
            .doc
            .storage_text(id)
            .map_err(|e| parse_error(e.to_string()))?;
        let mut anchored: Vec<_> = self
            .elements
            .values()
            .filter_map(|e| match e.placement {
                iwork::drawable::Placement::InText { storage, character } if storage == id => {
                    Some((character, e.identifier.get()))
                }
                _ => None,
            })
            .collect();
        anchored.sort();
        let mut cursor = 0;
        for (character, element) in anchored {
            let mut units = 0;
            let mut end = text.len();
            for (offset, c) in text.char_indices() {
                if units >= character {
                    end = offset;
                    break;
                }
                units += c.len_utf16() as u64;
            }
            append(&text[cursor..end.max(cursor)]);
            cursor = end.max(cursor);
            self.element(element)?;
        }
        append(&text[cursor..]);
        append("\n");
        Ok(())
    }
}

fn iwork_cell(value: &iwork::table::CellValue) -> String {
    use iwork::table::CellValue;
    match value {
        CellValue::Empty | CellValue::Span => String::new(),
        CellValue::Text(s) | CellValue::RichText(s) => s.clone(),
        CellValue::Number(n) | CellValue::Currency(n) => n.to_f64().to_string(),
        CellValue::Date(n) | CellValue::Duration(n) => n.to_string(),
        CellValue::Bool(b) => b.to_string(),
        CellValue::Error => "#ERROR".into(),
        CellValue::Unknown(n) => format!("#UNKNOWN({n})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn start(limit: usize) {
        STATE.with(|s| {
            *s.borrow_mut() = Some(State {
                result: Outcome {
                    complete: true,
                    ..Default::default()
                },
                limit,
                ocr_limit: 200,
                ocr_pages: 0,
                work: std::env::temp_dir(),
                images: HashMap::new(),
            })
        });
    }
    #[test]
    fn utf8_budget() {
        start(4);
        append("中文");
        STATE.with(|s| {
            let v = s.borrow_mut().take().unwrap();
            assert_eq!(v.result.text, "中");
            assert!(v.result.truncated);
        });
    }
    #[test]
    fn package_paths() {
        assert_eq!(
            resolve("word/document.xml", "media/a.png").unwrap(),
            "word/media/a.png"
        );
        assert!(resolve("word/document.xml", "../../secret").is_err());
    }
    #[test]
    fn no_intermediate_office_file() {
        start(100);
        write_docx(
            "",
            &[DocxParagraph {
                text: "Hello 世界".into(),
                ..Default::default()
            }],
        )
        .unwrap();
        STATE.with(|s| assert_eq!(s.borrow_mut().take().unwrap().result.text, "Hello 世界\n"));
    }
}

fn cad(input: &str, source: &str) -> Result<(), ConvertError> {
    let doc = if source == "dwg" {
        acadrust::DwgReader::from_file(input).and_then(|mut r| r.read())
    } else {
        acadrust::DxfReader::from_file(input).and_then(|r| r.read())
    }
    .map_err(|e| parse_error(e.to_string()))?;
    let mut stack = HashSet::new();
    for block in doc
        .block_records
        .iter()
        .filter(|b| b.name.starts_with("*Model_Space") || b.name.starts_with("*Paper_Space"))
    {
        for entity in doc.entities_in_block(&block.name) {
            cad_entity(&doc, entity, &mut stack)?;
        }
    }
    Ok(())
}
fn cad_entity(
    doc: &acadrust::CadDocument,
    entity: &acadrust::entities::EntityType,
    stack: &mut HashSet<String>,
) -> Result<(), ConvertError> {
    use acadrust::entities::EntityType;
    if full() {
        return Ok(());
    }
    let emit = |s: &str| {
        append(&cadkit_core::text::plain_text(s));
        append("\n");
    };
    match entity {
        EntityType::Text(t) => emit(&t.value),
        EntityType::MText(t) => emit(&t.value),
        EntityType::AttributeEntity(t) => emit(&t.value),
        EntityType::Dimension(t) => emit(t.base().text_override().unwrap_or("")),
        EntityType::MultiLeader(t) => emit(&t.context.text_string),
        EntityType::Table(t) => {
            for row in &t.rows {
                for cell in &row.cells {
                    for content in &cell.contents {
                        emit(content.value.display());
                    }
                    append("\t");
                }
                append("\n");
            }
        }
        EntityType::Insert(t) => {
            if stack.len() < 64 && stack.insert(t.block_name.clone()) {
                for child in doc.entities_in_block(&t.block_name) {
                    cad_entity(doc, child, stack)?;
                }
                stack.remove(&t.block_name);
            }
            for attribute in &t.attributes {
                emit(&attribute.value);
            }
        }
        _ => {}
    }
    Ok(())
}
