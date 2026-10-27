use quick_xml::escape::{escape, resolve_predefined_entity};
use quick_xml::events::{BytesDecl, BytesStart, Event};
use quick_xml::{Reader, Writer};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process;
use std::time::Instant;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

mod panorama;
mod ppm;

const OPENXML_BACKEND: &str = "openxml-package";
const TEXT_BACKEND: &str = "text";
const RTF_BACKEND: &str = "rtf";
const TABULAR_BACKEND: &str = "tabular";
const ODF_BACKEND: &str = "odf";
const WORD_BINARY_BACKEND: &str = "word-binary";
const BIFF_BACKEND: &str = "biff";
const PPT_BINARY_BACKEND: &str = "ppt-binary";
const RAW_PREVIEW_BACKEND: &str = "raw-preview";
const FIDELITY: &str = "lightweight";
const OPENXML_WARNING: &str = "OpenXML package backend normalized an OpenXML package to its preview document target; macro parts are stripped and other package contents are preserved.";
const PLAIN_TEXT_WARNING: &str = "Text backend performed lightweight plain text extraction; layout, rich Markdown markup, embedded media, and styling are not preserved.";
const DELIMITED_TEXT_WARNING: &str = "Text backend performed lightweight delimited spreadsheet extraction; formulas, formatting, encodings, comments, and external data are not preserved.";
const JSON_TEXT_WARNING: &str = "Text backend performed lightweight JSON tabular extraction; nested structures are flattened or stringified, and ordering, schemas, comments, and formatting are not preserved.";
const HTML_TEXT_WARNING: &str = "Text backend performed lightweight HTML text extraction; CSS layout, scripts, forms, embedded media, and detailed styling are not preserved.";
const RTF_WARNING: &str = "RTF backend performed lightweight text extraction; complex layout, embedded objects, and full style fidelity are not preserved.";
const TABULAR_WARNING: &str = "Tabular backend performed lightweight spreadsheet data extraction; formulas, formatting, indexes, code pages, memo fields, and macros are not preserved.";
const ODF_WARNING: &str = "ODF backend performed lightweight OpenDocument extraction; layout, styles, media, formulas, and macros are not preserved.";
const WORD_BINARY_WARNING: &str = "Word binary backend uses the built-in CFB/piece-table parser; paragraph/run styles (including inherited spacing, indentation, alignment, fonts, colors, and rich text), section page setup, manual and last-saved/estimated pagination, columns, page borders, header/footer stories, common fields with cached results, OfficeArt FSPA/Escher picture positions, custom wrapping, rotation, flips, crop, opacity, and z-order, multi-level lists, table grids, merges, cell borders/layout, row pagination, heading-like lines, and embedded raster/WMF/EMF images are preserved, while editable legacy OfficeArt shapes, nested or complex fields, macros, and embedded objects may be simplified or omitted.";
const BIFF_WARNING: &str = "BIFF conversion core performed lightweight binary spreadsheet extraction; basic formulas and formatting are preserved, but charts, macros, embedded objects, and unsupported formula tokens are not preserved.";
const PPT_BINARY_WARNING: &str = "PowerPoint binary backend preserves embedded full-slide JPEG/PNG artwork where available and otherwise extracts text; editable layout, animations, charts, macros, and embedded objects are not preserved.";
const RAW_PREVIEW_WARNING: &str = "RAW preview backend extracted the largest embedded 8-bit JPEG; use the optional converter-image WASM module when sensor decoding is required.";
const ICNS_PREVIEW_WARNING: &str = "ICNS preview backend extracted the largest embedded PNG icon; legacy raw icon planes and JPEG 2000 icon chunks are not decoded.";
const CONVERSIONS: &str = include_str!("../../converter-core/manifest/conversions.json");
const MAX_PACKAGE_ENTRIES: usize = 10_000;
const MAX_ENTRY_BYTES: u64 = 64 << 20;
const MAX_PACKAGE_BYTES: u64 = 256 << 20;
const MAX_LEGACY_BINARY_BYTES: u64 = 64 << 20;
const MAX_TEXT_BYTES: u64 = 64 << 20;
const MAX_RAW_BYTES: u64 = 256 << 20;
const MAX_TEXT_PARAGRAPHS: usize = 2000;
const MAX_WORD_PARAGRAPHS: usize = 3000;
const MAX_TEXT_LINE_CHARS: usize = 32767;
const MAX_SHEET_ROWS: usize = 10_000;
const MAX_SHEET_COLUMNS: usize = 16_384;
const MAX_DELIMITED_ROWS: usize = 1_048_576;
const MAX_DELIMITED_CELLS: usize = 1_000_000;

#[derive(Default)]
struct Request {
    operation: String,
    input: String,
    output: String,
    source: String,
    target: String,
    options: String,
    password: String,
    result: String,
    options_json: serde_json::Value,
}

#[derive(Clone, Default)]
struct DocxParagraph {
    text: String,
    source_cp_start: i32,
    source_cp_end: i32,
    source_fc_start: u32,
    source_fc_end: u32,
    heading_level: usize,
    list_kind: &'static str,
    list_level: usize,
    list_id: usize,
    alignment: &'static str,
    spacing_before: u16,
    spacing_after: u16,
    line_spacing: u16,
    line_spacing_rule: &'static str,
    indent_left: i16,
    indent_right: i16,
    first_line_indent: i16,
    shading: String,
    keep_next: bool,
    keep_lines: bool,
    page_break_before: bool,
    page_break_after: bool,
    last_rendered_page_break_before: bool,
    rendered_page_break_offsets: Vec<usize>,
    bidi: bool,
    bold: bool,
    runs: Vec<DocxRun>,
    table_cell: bool,
    table_cell_end: bool,
    table_row_end: bool,
    table_cell_merged: bool,
    table_grid_span: usize,
    table_v_merge: &'static str,
    table_grid_left: i16,
    table_grid_right: i16,
    table_grid_bounds: Vec<i16>,
    table_cell_borders: [Option<DocxPageBorder>; 4],
    table_cell_borders_explicit: bool,
    table_cell_margins: [Option<i16>; 4],
    table_cell_preferred_width: u16,
    table_cell_vertical_align: &'static str,
    table_cell_text_direction: &'static str,
    table_cell_no_wrap: bool,
    table_cell_fit_text: bool,
    table_row_height: i16,
    table_row_cant_split: bool,
    table_row_header: bool,
    table_alignment: &'static str,
    table_borders: Option<[Option<DocxPageBorder>; 6]>,
}

#[derive(Clone, Default)]
struct DocxImage {
    data: Vec<u8>,
    extension: &'static str,
    content_type: &'static str,
    width_emu: u64,
    height_emu: u64,
    floating: bool,
    anchor_x_emu: i64,
    anchor_y_emu: i64,
    anchor_align_h: &'static str,
    anchor_align_v: &'static str,
    relative_h: &'static str,
    relative_v: &'static str,
    wrap: &'static str,
    wrap_side: &'static str,
    behind_doc: bool,
    anchor_lock: bool,
    relative_height: u32,
    rotation: i32,
    flip_h: bool,
    flip_v: bool,
    crop_left: u32,
    crop_top: u32,
    crop_right: u32,
    crop_bottom: u32,
    wrap_polygon: Vec<(i32, i32)>,
    opacity: Option<u32>,
    wrap_distance_left: u32,
    wrap_distance_top: u32,
    wrap_distance_right: u32,
    wrap_distance_bottom: u32,
}

#[derive(Clone, Copy)]
struct DocxSection {
    section_type: &'static str,
    page_width: u32,
    page_height: u32,
    margin_top: i32,
    margin_right: i32,
    margin_bottom: i32,
    margin_left: i32,
    margin_header: i32,
    margin_footer: i32,
    gutter: i32,
    landscape: bool,
    columns: u16,
    column_spacing: i32,
    column_separator: bool,
    column_rtl: bool,
    title_page: bool,
    page_border_top: Option<DocxPageBorder>,
    page_border_left: Option<DocxPageBorder>,
    page_border_bottom: Option<DocxPageBorder>,
    page_border_right: Option<DocxPageBorder>,
    page_border_display: &'static str,
    page_border_offset_from: &'static str,
    page_border_z_order: &'static str,
}

#[derive(Clone, Copy)]
struct DocxPageBorder {
    style: &'static str,
    size: u16,
    color: Option<[u8; 3]>,
    space: u8,
    shadow: bool,
    frame: bool,
}

#[derive(Clone, Copy)]
struct WordBinarySection {
    cp_end: i32,
    properties: DocxSection,
}

#[derive(Clone)]
struct WordBinaryHeaderFooter {
    section_index: usize,
    kind: &'static str,
    paragraphs: Vec<DocxParagraph>,
}

#[derive(Clone, Copy)]
struct WordBinaryShapeAnchor {
    spid: u32,
    cp: i32,
    x_left: i32,
    y_top: i32,
    x_right: i32,
    y_bottom: i32,
    relative_h: &'static str,
    relative_v: &'static str,
    wrap: &'static str,
    wrap_side: &'static str,
    below_text: bool,
    anchor_lock: bool,
}

#[derive(Clone, Default)]
struct WordBinaryShapeArt {
    spid: u32,
    blip_index: Option<usize>,
    rotation: i32,
    flip_h: bool,
    flip_v: bool,
    crop_left: u32,
    crop_top: u32,
    crop_right: u32,
    crop_bottom: u32,
    wrap_polygon: Vec<(i32, i32)>,
    opacity: Option<u32>,
    position_h: &'static str,
    position_v: &'static str,
    relative_h: &'static str,
    relative_v: &'static str,
    wrap_distance_left: u32,
    wrap_distance_top: u32,
    wrap_distance_right: u32,
    wrap_distance_bottom: u32,
    z_order: Option<u32>,
    behind_doc: Option<bool>,
    image: Option<DocxImage>,
}

#[derive(Clone, Default)]
struct WordBinaryOfficeArt {
    shapes: Vec<WordBinaryShapeArt>,
    blips: Vec<Option<DocxImage>>,
    blip_delay_offsets: Vec<Option<usize>>,
}

impl Default for DocxSection {
    fn default() -> Self {
        Self {
            section_type: "nextPage",
            page_width: 12_240,
            page_height: 15_840,
            margin_top: 1_080,
            margin_right: 1_080,
            margin_bottom: 1_080,
            margin_left: 1_080,
            margin_header: 720,
            margin_footer: 720,
            gutter: 0,
            landscape: false,
            columns: 1,
            column_spacing: 720,
            column_separator: false,
            column_rtl: false,
            title_page: false,
            page_border_top: None,
            page_border_left: None,
            page_border_bottom: None,
            page_border_right: None,
            page_border_display: "allPages",
            page_border_offset_from: "text",
            page_border_z_order: "front",
        }
    }
}

#[derive(Clone, Default)]
struct DocxRun {
    text: String,
    field_instruction: String,
    font_name: String,
    bold: bool,
    italic: bool,
    underline: bool,
    underline_style: &'static str,
    strike: bool,
    small_caps: bool,
    caps: bool,
    hidden: bool,
    rtl: bool,
    vertical_align: &'static str,
    font_size: usize,
    color: String,
    highlight: String,
    image: Option<DocxImage>,
}

#[derive(Clone)]
enum SheetCell {
    Empty,
    Text(String),
    Number(String),
    Bool(bool),
    Date(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversionPair {
    source_format: String,
    target_format: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Metrics {
    elapsed_ms: u128,
    #[serde(skip_serializing_if = "is_zero")]
    input_size: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ResultContract {
    ok: bool,
    source_format: String,
    target_format: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    backend: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    fidelity: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    content_type: String,
    warnings: Vec<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    error_code: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    error_message: String,
    metrics: Metrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    required_ranges: Vec<panorama::RequiredRange>,
}

#[derive(Debug)]
struct ConvertError {
    code: &'static str,
    message: String,
}

fn main() {
    let started = Instant::now();
    let mut request = Request::default();
    let parse_error = parse_request(&mut request).err();
    let input_size = if request.operation == "inspect-panorama" {
        request
            .options_json
            .get("logicalSize")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    } else {
        fs::metadata(&request.input)
            .ok()
            .filter(|metadata| metadata.is_file())
            .map_or(0, |metadata| metadata.len())
    };

    let result = if let Some(message) = parse_error {
        failure(&request, "io_error", message, input_size, None)
    } else if request.operation == "inspect-panorama" {
        match panorama::inspect(&request.source, &request.options_json) {
            Ok(panorama::InspectOutcome::Complete(payload)) => ResultContract {
                ok: true,
                source_format: request.source.clone(),
                target_format: "panorama-manifest".into(),
                backend: "panorama-inspector".into(),
                fidelity: "metadata".into(),
                content_type: "application/json".into(),
                payload: Some(payload),
                metrics: Metrics {
                    elapsed_ms: 0,
                    input_size,
                },
                ..Default::default()
            },
            Ok(panorama::InspectOutcome::NeedRanges(required_ranges)) => ResultContract {
                source_format: request.source.clone(),
                target_format: "panorama-manifest".into(),
                backend: "panorama-inspector".into(),
                error_code: "need_ranges".into(),
                error_message: "additional source ranges are required".into(),
                required_ranges,
                metrics: Metrics {
                    elapsed_ms: 0,
                    input_size,
                },
                ..Default::default()
            },
            Err(error) => failure(
                &request,
                error.code,
                error.message,
                input_size,
                Some("panorama-inspector"),
            ),
        }
    } else if request.operation == "decode-panorama-metadata" {
        match panorama::decode_metadata(&request.options_json) {
            Ok(payload) => ResultContract {
                ok: true,
                target_format: "panorama-metadata".into(),
                backend: "panorama-metadata-decoder".into(),
                fidelity: "metadata".into(),
                content_type: "application/json".into(),
                payload: Some(payload),
                metrics: Metrics {
                    elapsed_ms: 0,
                    input_size: 0,
                },
                ..Default::default()
            },
            Err(error) => failure(
                &request,
                error.code,
                error.message,
                0,
                Some("panorama-metadata-decoder"),
            ),
        }
    } else if request.operation == "panorama-seam" {
        match panorama::compute_seam(&request.options_json) {
            Ok(payload) => ResultContract {
                ok: true,
                target_format: "panorama-seam".into(),
                backend: "panorama-seam-dp".into(),
                fidelity: "computed".into(),
                content_type: "application/json".into(),
                payload: Some(payload),
                metrics: Metrics {
                    elapsed_ms: 0,
                    input_size: 0,
                },
                ..Default::default()
            },
            Err(error) => failure(
                &request,
                error.code,
                error.message,
                0,
                Some("panorama-seam-dp"),
            ),
        }
    } else if let Err(error) = validate_input(&request, input_size) {
        failure(&request, error.code, error.message, input_size, None)
    } else if let Some((backend, code, message)) = encrypted_input_failure(&request) {
        failure(&request, code, message, input_size, Some(backend))
    } else {
        let (backend, warning, conversion) = if is_openxml_source(&request.source) {
            (
                OPENXML_BACKEND,
                OPENXML_WARNING,
                normalize_package(&request.input, &request.output, &request.target),
            )
        } else if is_raw_source(&request.source) {
            (
                RAW_PREVIEW_BACKEND,
                RAW_PREVIEW_WARNING,
                convert_raw_preview(&request.input, &request.output, &request.target),
            )
        } else if request.source == "ppm" {
            ("ppm", "", ppm::convert(&request.input, &request.output))
        } else if is_icns_source(&request.source) {
            (
                "icns-preview",
                ICNS_PREVIEW_WARNING,
                convert_icns_preview(&request.input, &request.output, &request.target),
            )
        } else if is_word_binary_source(&request.source) {
            (
                WORD_BINARY_BACKEND,
                WORD_BINARY_WARNING,
                convert_word_binary(&request.input, &request.output),
            )
        } else if is_biff_source(&request.source) {
            (
                BIFF_BACKEND,
                BIFF_WARNING,
                convert_biff(&request.input, &request.output),
            )
        } else if is_ppt_binary_source(&request.source) {
            (
                PPT_BINARY_BACKEND,
                PPT_BINARY_WARNING,
                convert_ppt_binary(&request.input, &request.output),
            )
        } else if is_odf_source(&request.source) {
            (
                ODF_BACKEND,
                ODF_WARNING,
                convert_odf(
                    &request.input,
                    &request.output,
                    &request.source,
                    &request.target,
                ),
            )
        } else if request.source == "rtf" {
            (
                RTF_BACKEND,
                RTF_WARNING,
                convert_rtf(&request.input, &request.output),
            )
        } else if is_legacy_tabular_source(&request.source) {
            (
                TABULAR_BACKEND,
                TABULAR_WARNING,
                convert_legacy_tabular(&request.input, &request.output, &request.source),
            )
        } else if is_tabular_source(&request.source) {
            (
                TEXT_BACKEND,
                if is_json_source(&request.source) {
                    JSON_TEXT_WARNING
                } else {
                    DELIMITED_TEXT_WARNING
                },
                convert_tabular(&request.input, &request.output, &request.source),
            )
        } else {
            (
                TEXT_BACKEND,
                if is_html_source(&request.source) || is_mhtml_source(&request.source) {
                    HTML_TEXT_WARNING
                } else {
                    PLAIN_TEXT_WARNING
                },
                convert_text(&request.input, &request.output, &request.source),
            )
        };
        match conversion {
            Ok(()) => match validate_output(&request.output, &request.target) {
                Ok(()) => success(&request, input_size, backend, warning),
                Err(error) => failure(
                    &request,
                    "conversion_failed",
                    format!(
                        "converted output failed OpenXML validation for {}: {}",
                        request.output, error.message
                    ),
                    input_size,
                    Some(backend),
                ),
            },
            Err(error) => failure(
                &request,
                error.code,
                error.message,
                input_size,
                Some(backend),
            ),
        }
    };

    let ok = result.ok;
    if let Err(error) = write_result(&request.result, result, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
    process::exit(if ok { 0 } else { 1 });
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

fn parse_request(request: &mut Request) -> Result<(), String> {
    let mut args = env::args().skip(1);
    while let Some(flag) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for {flag}"))?;
        match flag.as_str() {
            "--operation" => request.operation = value,
            "--input" => request.input = value,
            "--output" => request.output = value,
            "--source" => request.source = normalize_format(&value),
            "--target" => request.target = normalize_format(&value),
            "--options" => request.options = value,
            "--result" => request.result = value,
            _ => return Err(format!("flag provided but not defined: {flag}")),
        }
    }
    let required: &[(&String, &str)] = if request.operation == "inspect-panorama" {
        &[
            (&request.source, "missing --source"),
            (&request.options, "missing --options"),
            (&request.result, "missing --result"),
        ]
    } else if matches!(
        request.operation.as_str(),
        "panorama-seam" | "decode-panorama-metadata"
    ) {
        &[
            (&request.options, "missing --options"),
            (&request.result, "missing --result"),
        ]
    } else {
        &[
            (&request.input, "missing --input"),
            (&request.output, "missing --output"),
            (&request.source, "missing --source"),
            (&request.target, "missing --target"),
            (&request.result, "missing --result"),
        ]
    };
    for (value, message) in required {
        if value.is_empty() {
            return Err((*message).into());
        }
    }
    if !request.options.is_empty() {
        match fs::read_to_string(&request.options) {
            Ok(text) if !text.trim().is_empty() => {
                let options = serde_json::from_str::<serde_json::Value>(&text)
                    .map_err(|error| format!("parse options: {error}"))?;
                request.options_json = options.clone();
                request.password = options
                    .get("password")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("read options: {error}")),
        }
    }
    Ok(())
}

fn validate_input(request: &Request, input_size: u64) -> Result<(), ConvertError> {
    let metadata = fs::metadata(&request.input).map_err(|error| ConvertError {
        code: "io_error",
        message: format!("stat input: {error}"),
    })?;
    if !metadata.is_file() {
        return Err(ConvertError {
            code: "io_error",
            message: format!("input is a directory: {}", request.input),
        });
    }
    debug_assert_eq!(metadata.len(), input_size);
    if input_size > MAX_LEGACY_BINARY_BYTES
        && (is_word_binary_source(&request.source)
            || is_biff_source(&request.source)
            || is_ppt_binary_source(&request.source))
    {
        return Err(io_error(
            "legacy binary input is too large for the lightweight backend".into(),
        ));
    }
    if input_size > MAX_RAW_BYTES && is_raw_source(&request.source) {
        return Err(io_error(
            "RAW input is too large for embedded preview extraction".into(),
        ));
    }
    if request.source == "ppm" && input_size > MAX_RAW_BYTES {
        return Err(io_error("PPM input is too large for conversion".into()));
    }
    let pairs: Vec<ConversionPair> =
        serde_json::from_str(CONVERSIONS).map_err(|error| ConvertError {
            code: "conversion_failed",
            message: format!("parse embedded conversion manifest: {error}"),
        })?;
    let source_supported = pairs
        .iter()
        .any(|pair| pair.source_format == request.source);
    if !source_supported {
        return Err(ConvertError {
            code: "unsupported_format",
            message: format!("unsupported source format: {}", request.source),
        });
    }
    if !pairs
        .iter()
        .any(|pair| pair.source_format == request.source && pair.target_format == request.target)
    {
        return Err(ConvertError {
            code: "unsupported_format",
            message: format!(
                "unsupported conversion pair: {} -> {}",
                request.source, request.target
            ),
        });
    }
    Ok(())
}

fn encrypted_input_failure(request: &Request) -> Option<(&'static str, &'static str, String)> {
    let backend = if is_word_binary_source(&request.source) {
        WORD_BINARY_BACKEND
    } else if is_biff_source(&request.source) {
        BIFF_BACKEND
    } else if is_ppt_binary_source(&request.source) {
        PPT_BINARY_BACKEND
    } else if matches!(request.source.as_str(), "msg" | "oft") {
        TEXT_BACKEND
    } else {
        return None;
    };
    let input = fs::read(&request.input).ok()?;
    let file = CompoundFile::parse(&input).ok()?;
    if !file.entries.iter().any(|entry| {
        let name = entry
            .name
            .trim_matches(char::is_control)
            .trim()
            .to_ascii_lowercase();
        matches!(
            name.as_str(),
            "encryptedpackage" | "encryptioninfo" | "dataspaces"
        ) || name.contains("encryption")
            || name.contains("encrypted")
    }) {
        return None;
    }
    if request.password.trim().is_empty() {
        Some((
            backend,
            "password_required",
            "encrypted Office/WPS input requires a password".into(),
        ))
    } else {
        Some((
            backend,
            "password_invalid",
            "encrypted Office/WPS input could not be decrypted by this WASM converter with the supplied password".into(),
        ))
    }
}

fn success(request: &Request, input_size: u64, backend: &str, warning: &str) -> ResultContract {
    ResultContract {
        ok: true,
        source_format: request.source.clone(),
        target_format: request.target.clone(),
        backend: backend.into(),
        fidelity: FIDELITY.into(),
        content_type: content_type(&request.target).into(),
        warnings: if warning.is_empty() {
            Vec::new()
        } else {
            vec![warning.into()]
        },
        metrics: Metrics {
            elapsed_ms: 0,
            input_size,
        },
        ..Default::default()
    }
}

fn failure(
    request: &Request,
    code: &'static str,
    message: String,
    input_size: u64,
    backend: Option<&str>,
) -> ResultContract {
    ResultContract {
        source_format: request.source.clone(),
        target_format: request.target.clone(),
        backend: backend.unwrap_or_default().into(),
        fidelity: if backend.is_some() {
            FIDELITY.into()
        } else {
            String::new()
        },
        content_type: if backend.is_some() {
            content_type(&request.target).into()
        } else {
            String::new()
        },
        warnings: Vec::new(),
        error_code: code.into(),
        error_message: message,
        metrics: Metrics {
            elapsed_ms: 0,
            input_size,
        },
        ..Default::default()
    }
}

fn write_result(path: &str, mut result: ResultContract, elapsed_ms: u128) -> Result<(), String> {
    if path.is_empty() {
        return Err(result.error_message);
    }
    result.metrics.elapsed_ms = elapsed_ms;
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create result directory: {error}"))?;
    }
    let mut json =
        serde_json::to_vec_pretty(&result).map_err(|error| format!("encode result: {error}"))?;
    json.push(b'\n');
    fs::write(path, json).map_err(|error| format!("write result: {error}"))
}

fn is_openxml_source(source: &str) -> bool {
    matches!(
        source,
        "docm"
            | "dotx"
            | "dotm"
            | "xlsm"
            | "xltx"
            | "xltm"
            | "pptm"
            | "ppsx"
            | "ppsm"
            | "potx"
            | "potm"
    )
}

fn is_word_binary_source(source: &str) -> bool {
    matches!(source, "doc" | "dot" | "wps" | "wpt")
}

fn is_biff_source(source: &str) -> bool {
    matches!(source, "xls" | "xlt" | "et" | "ett")
}

fn is_ppt_binary_source(source: &str) -> bool {
    matches!(source, "ppt" | "pps" | "pot" | "dps" | "dpt")
}

fn is_raw_source(source: &str) -> bool {
    matches!(
        source,
        "dng"
            | "cr2"
            | "cr3"
            | "nef"
            | "nrw"
            | "arw"
            | "sr2"
            | "srf"
            | "orf"
            | "rw2"
            | "rwl"
            | "raf"
            | "kdc"
            | "x3f"
            | "pef"
            | "srw"
            | "erf"
            | "mef"
            | "mos"
            | "mrw"
            | "3fr"
            | "iiq"
    )
}

fn is_icns_source(source: &str) -> bool {
    source == "icns"
}

fn convert_raw_preview(input: &str, output: &str, target: &str) -> Result<(), ConvertError> {
    if !matches!(target, "jpg" | "jpeg") {
        return Err(ConvertError {
            code: "unsupported_format",
            message: format!("unsupported RAW target format: {target}"),
        });
    }
    let bytes = fs::read(input).map_err(|error| io_error(format!("read RAW input: {error}")))?;
    if let Some(preview) = best_embedded_jpeg(&bytes) {
        return fs::write(output, preview)
            .map_err(|error| io_error(format!("write RAW JPEG preview: {error}")));
    }

    Err(parse_error(
        "RAW file does not contain a supported 8-bit embedded JPEG preview; configure converter-image.wasm for sensor decoding".into(),
    ))
}

fn convert_icns_preview(input: &str, output: &str, target: &str) -> Result<(), ConvertError> {
    if target != "png" {
        return Err(ConvertError {
            code: "unsupported_format",
            message: format!("unsupported ICNS target format: {target}"),
        });
    }
    let bytes = fs::read(input).map_err(|error| io_error(format!("read ICNS input: {error}")))?;
    let preview = best_icns_png(&bytes).ok_or_else(|| {
        parse_error("ICNS file does not contain a complete embedded PNG icon preview".into())
    })?;
    fs::write(output, preview).map_err(|error| io_error(format!("write ICNS PNG preview: {error}")))
}

fn best_icns_png(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.get(..4) != Some(b"icns") || bytes.len() < 8 {
        return None;
    }
    let declared_len = usize::try_from(u32::from_be_bytes(bytes[4..8].try_into().ok()?)).ok()?;
    if declared_len < 8 || declared_len > bytes.len() {
        return None;
    }

    let mut cursor = 8usize;
    let mut best: Option<(usize, usize, u64)> = None;
    while cursor + 8 <= declared_len {
        let chunk_len = usize::try_from(u32::from_be_bytes(
            bytes[cursor + 4..cursor + 8].try_into().ok()?,
        ))
        .ok()?;
        if chunk_len < 8 {
            return None;
        }
        let chunk_end = cursor.checked_add(chunk_len)?;
        if chunk_end > declared_len {
            return None;
        }
        let data_start = cursor + 8;
        let data = &bytes[data_start..chunk_end];
        if let Some(png_end) = png_bounds(data) {
            let Some((width, height)) = png_dimensions(data) else {
                cursor = chunk_end;
                continue;
            };
            let area = u64::from(width).saturating_mul(u64::from(height));
            let candidate_end = data_start + png_end;
            if best.is_none_or(|(best_start, best_end, best_area)| {
                area > best_area
                    || (area == best_area && candidate_end - data_start > best_end - best_start)
            }) {
                best = Some((data_start, candidate_end, area));
            }
        }
        cursor = chunk_end;
    }
    best.map(|(start, end, _)| &bytes[start..end])
}

fn png_bounds(bytes: &[u8]) -> Option<usize> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.get(..8) != Some(PNG_SIGNATURE) {
        return None;
    }
    let mut cursor = 8usize;
    while cursor + 12 <= bytes.len() {
        let chunk_len = usize::try_from(u32::from_be_bytes(
            bytes[cursor..cursor + 4].try_into().ok()?,
        ))
        .ok()?;
        let chunk_end = cursor.checked_add(12)?.checked_add(chunk_len)?;
        if chunk_end > bytes.len() {
            return None;
        }
        if bytes.get(cursor + 4..cursor + 8) == Some(b"IEND") {
            return Some(chunk_end);
        }
        cursor = chunk_end;
    }
    None
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.get(..24).is_none()
        || bytes.get(..8) != Some(b"\x89PNG\r\n\x1a\n")
        || bytes.get(12..16) != Some(b"IHDR")
    {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

// ponytail: embedded previews avoid a full RAW developer; add demosaic/color processing when sensor-pixel previews are required.
fn best_embedded_jpeg(bytes: &[u8]) -> Option<&[u8]> {
    let mut best: Option<(usize, usize, u64)> = None;
    let mut start = 0usize;
    while start + 1 < bytes.len() {
        let Some(offset) = bytes[start..]
            .windows(2)
            .position(|pair| pair == [0xff, 0xd8])
        else {
            break;
        };
        let candidate_start = start + offset;
        if let Some((end, width, height)) = jpeg_bounds(bytes, candidate_start) {
            let area = u64::from(width) * u64::from(height);
            if best.is_none_or(|(best_start, best_end, best_area)| {
                area > best_area
                    || (area == best_area && end - candidate_start > best_end - best_start)
            }) {
                best = Some((candidate_start, end, area));
            }
        }
        start = candidate_start + 2;
    }
    best.map(|(start, end, _)| &bytes[start..end])
}

fn jpeg_bounds(bytes: &[u8], start: usize) -> Option<(usize, u16, u16)> {
    if bytes.get(start..start + 2)? != [0xff, 0xd8] {
        return None;
    }
    let mut cursor = start + 2;
    let mut dimensions = None;
    while cursor + 1 < bytes.len() {
        // RAW pixels can contain accidental SOI bytes. Every header segment
        // must start with a marker, and another SOI cannot extend this image.
        if bytes.get(cursor) != Some(&0xff) {
            return None;
        }
        while bytes.get(cursor) == Some(&0xff) {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        match marker {
            0x00 | 0xd8 | 0xd0..=0xd7 => return None,
            0xd9 => return dimensions.map(|(width, height)| (cursor, width, height)),
            _ => {}
        }
        let length = u16::from_be_bytes([*bytes.get(cursor)?, *bytes.get(cursor + 1)?]) as usize;
        if length < 2 || cursor + length > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let precision = *bytes.get(cursor + 2)?;
            let height = u16::from_be_bytes([*bytes.get(cursor + 3)?, *bytes.get(cursor + 4)?]);
            let width = u16::from_be_bytes([*bytes.get(cursor + 5)?, *bytes.get(cursor + 6)?]);
            let components = *bytes.get(cursor + 7)?;
            if precision != 8 || width == 0 || height == 0 || !matches!(components, 1 | 3 | 4) {
                return None;
            }
            dimensions = Some((width, height));
        }
        cursor += length;
        if marker == 0xda {
            while cursor + 1 < bytes.len() {
                if bytes[cursor] != 0xff {
                    cursor += 1;
                    continue;
                }
                let marker_start = cursor;
                while bytes.get(cursor) == Some(&0xff) {
                    cursor += 1;
                }
                match *bytes.get(cursor)? {
                    0x00 | 0xd0..=0xd7 => cursor += 1,
                    0xd9 => return dimensions.map(|(width, height)| (cursor + 1, width, height)),
                    _ => {
                        cursor = marker_start;
                        break;
                    }
                }
            }
        }
    }
    None
}

fn convert_text(input: &str, output: &str, source: &str) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(input).map_err(|error| io_error(format!("stat text input: {error}")))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(io_error(
            "text input is too large for the lightweight backend".into(),
        ));
    }
    let bytes = fs::read(input).map_err(|error| io_error(format!("read text input: {error}")))?;
    let text = decode_text(&bytes);
    let paragraphs = if is_markdown_source(source) {
        extract_markdown_paragraphs(&text)
    } else if is_subtitle_source(source) {
        extract_subtitle_paragraphs(&text, source)
    } else if source == "ipynb" {
        extract_ipynb_paragraphs(&text)
    } else if is_xml_text_source(source) {
        extract_xml_paragraphs(&text)?
    } else if is_mhtml_source(source) {
        extract_mhtml_paragraphs(&text)
    } else if is_html_source(source) {
        extract_html_paragraphs(&text)
    } else if source == "fb2" {
        extract_fb2_paragraphs(&text)?
    } else if source == "epub" {
        extract_epub_paragraphs(input)?
    } else if source == "ics" {
        extract_calendar_paragraphs(&text)
    } else if source == "vcf" {
        extract_vcard_paragraphs(&text)
    } else if source == "eml" {
        extract_eml_paragraphs(&text)
    } else if source == "mbox" {
        extract_mbox_paragraphs(&text)
    } else if matches!(source, "msg" | "oft") {
        extract_msg_paragraphs(&bytes)?
    } else {
        plain_docx_paragraphs(&text)
    };
    write_docx(output, &paragraphs)
}

#[derive(Clone)]
struct RtfState {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    vertical_align: &'static str,
    color: String,
    highlight: String,
    font_size: usize,
    alignment: &'static str,
    list_level: usize,
    skip: bool,
    ignorable_next: bool,
    unicode_skip: usize,
}

impl Default for RtfState {
    fn default() -> Self {
        Self {
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            vertical_align: "",
            color: String::new(),
            highlight: String::new(),
            font_size: 0,
            alignment: "",
            list_level: 0,
            skip: false,
            ignorable_next: false,
            unicode_skip: 1,
        }
    }
}

fn convert_rtf(input: &str, output: &str) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(input).map_err(|error| io_error(format!("stat RTF input: {error}")))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(io_error(
            "RTF input is too large for the lightweight backend".into(),
        ));
    }
    let bytes = fs::read(input).map_err(|error| io_error(format!("read RTF input: {error}")))?;
    let paragraphs = extract_rtf_paragraphs(&bytes)?;
    write_docx(output, &paragraphs)
}

fn extract_rtf_paragraphs(input: &[u8]) -> Result<Vec<DocxParagraph>, ConvertError> {
    if !input
        .iter()
        .skip_while(|byte| byte.is_ascii_whitespace())
        .copied()
        .collect::<Vec<_>>()
        .starts_with(br"{\rtf")
    {
        return Err(parse_error(
            "input does not look like an RTF document".into(),
        ));
    }
    let mut index = 0;
    let mut state = RtfState::default();
    let mut stack = Vec::new();
    let mut current = Vec::<DocxRun>::new();
    let mut paragraphs = Vec::new();
    let colors = rtf_color_table(input);
    while index < input.len() {
        match input[index] {
            b'{' => {
                stack.push(state.clone());
                state.ignorable_next = false;
                index += 1;
            }
            b'}' => {
                if let Some(previous) = stack.pop() {
                    state = previous;
                }
                index += 1;
            }
            b'\\' => {
                index += 1;
                if index >= input.len() {
                    break;
                }
                match input[index] {
                    b'\\' | b'{' | b'}' => {
                        if !state.skip {
                            rtf_add_text(
                                &mut current,
                                &state,
                                char::from(input[index]).to_string(),
                            );
                        }
                        index += 1;
                    }
                    b'~' => {
                        if !state.skip {
                            rtf_add_text(&mut current, &state, " ".into());
                        }
                        index += 1;
                    }
                    b'-' | b'_' => {
                        if !state.skip {
                            rtf_add_text(&mut current, &state, "-".into());
                        }
                        index += 1;
                    }
                    b'*' => {
                        state.ignorable_next = true;
                        index += 1;
                    }
                    b'\'' => {
                        if index + 2 < input.len() {
                            if let Ok(value) = u8::from_str_radix(
                                &String::from_utf8_lossy(&input[index + 1..index + 3]),
                                16,
                            ) {
                                if !state.skip {
                                    rtf_add_text(
                                        &mut current,
                                        &state,
                                        windows_1252_char(value).to_string(),
                                    );
                                }
                            }
                            index += 3;
                        } else {
                            index = input.len();
                        }
                    }
                    byte if byte.is_ascii_alphabetic() => {
                        let start = index;
                        while index < input.len() && input[index].is_ascii_alphabetic() {
                            index += 1;
                        }
                        let word = String::from_utf8_lossy(&input[start..index]);
                        let sign = if input.get(index) == Some(&b'-') {
                            index += 1;
                            -1
                        } else {
                            1
                        };
                        let number_start = index;
                        while index < input.len() && input[index].is_ascii_digit() {
                            index += 1;
                        }
                        let parameter = (index > number_start).then(|| {
                            String::from_utf8_lossy(&input[number_start..index])
                                .parse::<i32>()
                                .unwrap_or(0)
                                * sign
                        });
                        if input.get(index) == Some(&b' ') {
                            index += 1;
                        }
                        if state.ignorable_next {
                            state.ignorable_next = false;
                            if rtf_destination(&word) {
                                state.skip = true;
                                continue;
                            }
                        }
                        if state.skip {
                            continue;
                        }
                        if rtf_destination(&word) {
                            state.skip = true;
                            continue;
                        }
                        match word.as_ref() {
                            "par" => {
                                rtf_flush_paragraph(&mut current, &state, &mut paragraphs);
                                state.list_level = 0;
                            }
                            "line" => rtf_add_text(&mut current, &state, "\n".into()),
                            "tab" => rtf_add_text(&mut current, &state, "\t".into()),
                            "emdash" | "endash" => rtf_add_text(&mut current, &state, "-".into()),
                            "bullet" => rtf_add_text(&mut current, &state, "*".into()),
                            "lquote" | "rquote" => rtf_add_text(&mut current, &state, "'".into()),
                            "ldblquote" | "rdblquote" => {
                                rtf_add_text(&mut current, &state, "\"".into())
                            }
                            "u" => {
                                if let Some(mut value) = parameter {
                                    if value < 0 {
                                        value += 65536;
                                    }
                                    if let Some(character) = char::from_u32(value as u32) {
                                        rtf_add_text(&mut current, &state, character.to_string());
                                    }
                                    for _ in 0..state.unicode_skip {
                                        if index < input.len() {
                                            index += if input.get(index) == Some(&b'\\')
                                                && input.get(index + 1) == Some(&b'\'')
                                            {
                                                4
                                            } else {
                                                1
                                            };
                                        }
                                    }
                                }
                            }
                            "uc" => {
                                if let Some(value) =
                                    parameter.filter(|value| (0..=16).contains(value))
                                {
                                    state.unicode_skip = value as usize;
                                }
                            }
                            "b" => state.bold = parameter != Some(0),
                            "i" => state.italic = parameter != Some(0),
                            "ul" => state.underline = parameter != Some(0),
                            "ulnone" => state.underline = false,
                            "strike" => state.strike = parameter != Some(0),
                            "super" => {
                                state.vertical_align = if parameter == Some(0) {
                                    ""
                                } else {
                                    "superscript"
                                }
                            }
                            "sub" => {
                                state.vertical_align = if parameter == Some(0) {
                                    ""
                                } else {
                                    "subscript"
                                }
                            }
                            "nosupersub" => state.vertical_align = "",
                            "cf" => {
                                state.color = parameter
                                    .and_then(|value| colors.get(value.max(0) as usize))
                                    .cloned()
                                    .unwrap_or_default()
                            }
                            "highlight" => {
                                state.highlight = parameter
                                    .and_then(|value| colors.get(value.max(0) as usize))
                                    .cloned()
                                    .unwrap_or_default()
                            }
                            "plain" => {
                                state.bold = false;
                                state.italic = false;
                                state.underline = false;
                                state.strike = false;
                                state.vertical_align = "";
                                state.color.clear();
                                state.highlight.clear();
                                state.font_size = 0;
                            }
                            "fs" => {
                                if let Some(value) =
                                    parameter.filter(|value| (1..=4000).contains(value))
                                {
                                    state.font_size = value as usize;
                                }
                            }
                            "pard" | "ql" => {
                                state.alignment = "";
                                state.list_level = 0;
                            }
                            "qc" => state.alignment = "center",
                            "qr" => state.alignment = "right",
                            "qj" => state.alignment = "both",
                            "ilvl" => {
                                if let Some(value) =
                                    parameter.filter(|value| (0..=8).contains(value))
                                {
                                    state.list_level = value as usize;
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => index += 1,
                }
            }
            b'\r' | b'\n' => index += 1,
            byte => {
                if !state.skip {
                    rtf_add_text(&mut current, &state, windows_1252_char(byte).to_string());
                }
                index += 1;
            }
        }
    }
    rtf_flush_paragraph(&mut current, &state, &mut paragraphs);
    paragraphs.truncate(4000);
    Ok(paragraphs)
}

fn rtf_color_table(input: &[u8]) -> Vec<String> {
    let Some(start) = input.windows(10).position(|value| value == br"{\colortbl") else {
        return vec![String::new()];
    };
    let mut depth = 0usize;
    let mut end = input.len();
    for (offset, byte) in input[start..].iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    end = start + offset;
                    break;
                }
            }
            _ => {}
        }
    }
    let table = String::from_utf8_lossy(&input[start..end]);
    let mut colors = vec![String::new()];
    for entry in table.split(';').skip(1).take(255) {
        let component = |name: &str| {
            entry.find(name).and_then(|offset| {
                entry[offset + name.len()..]
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect::<String>()
                    .parse::<u8>()
                    .ok()
            })
        };
        if let (Some(red), Some(green), Some(blue)) = (
            component("\\red"),
            component("\\green"),
            component("\\blue"),
        ) {
            colors.push(format!("{red:02X}{green:02X}{blue:02X}"));
        }
    }
    colors
}

fn rtf_destination(word: &str) -> bool {
    matches!(
        word,
        "fonttbl"
            | "colortbl"
            | "stylesheet"
            | "info"
            | "pict"
            | "object"
            | "header"
            | "footer"
            | "headerl"
            | "headerr"
            | "headerf"
            | "footerl"
            | "footerr"
            | "footerf"
            | "generator"
            | "themedata"
            | "datastore"
            | "xmlnstbl"
            | "listtable"
            | "listoverridetable"
            | "rsidtbl"
    )
}

fn rtf_add_text(runs: &mut Vec<DocxRun>, state: &RtfState, text: String) {
    if let Some(last) = runs.last_mut().filter(|run| {
        run.bold == state.bold
            && run.italic == state.italic
            && run.underline == state.underline
            && run.strike == state.strike
            && run.vertical_align == state.vertical_align
            && run.color == state.color
            && run.highlight == state.highlight
            && run.font_size == state.font_size
    }) {
        last.text.push_str(&text);
    } else {
        runs.push(DocxRun {
            text,
            bold: state.bold,
            italic: state.italic,
            underline: state.underline,
            strike: state.strike,
            vertical_align: state.vertical_align,
            color: state.color.clone(),
            highlight: state.highlight.clone(),
            font_size: state.font_size,
            ..Default::default()
        });
    }
}

fn rtf_flush_paragraph(
    runs: &mut Vec<DocxRun>,
    state: &RtfState,
    paragraphs: &mut Vec<DocxParagraph>,
) {
    for run in runs.iter_mut() {
        let mut collapsed = String::new();
        let mut previous_space = false;
        for character in run.text.chars() {
            if matches!(character, '\n' | '\t') {
                collapsed.push(character);
                previous_space = false;
            } else if character.is_whitespace() {
                if !previous_space {
                    collapsed.push(' ');
                }
                previous_space = true;
            } else {
                collapsed.push(character);
                previous_space = false;
            }
        }
        run.text = collapsed;
    }
    runs.retain(|run| !run.text.is_empty());
    if let Some(first) = runs.first_mut() {
        first.text = first.text.trim_start().to_string();
    }
    if let Some(last) = runs.last_mut() {
        last.text = last.text.trim_end().to_string();
    }
    if runs.is_empty() {
        return;
    }
    let mut list_kind = "";
    let first = &mut runs[0].text;
    if first.starts_with('*') || first.starts_with('•') {
        list_kind = "bullet";
        *first = first[1..].trim_start().to_string();
    } else if let Some(marker) = first.split_whitespace().next() {
        let marker = marker.trim_end_matches(['.', ')']);
        if !marker.is_empty()
            && (marker.bytes().all(|byte| byte.is_ascii_digit())
                || (marker.len() == 1 && marker.as_bytes()[0].is_ascii_alphabetic()))
        {
            list_kind = "decimal";
            let length = first.find(char::is_whitespace).unwrap_or(first.len());
            *first = first[length..].trim_start().to_string();
        }
    }
    paragraphs.push(DocxParagraph {
        list_kind,
        list_level: state.list_level,
        alignment: state.alignment,
        runs: std::mem::take(runs),
        ..Default::default()
    });
}

fn is_markdown_source(source: &str) -> bool {
    matches!(source, "md" | "markdown" | "mkd" | "mkdn" | "mdown")
}

fn is_subtitle_source(source: &str) -> bool {
    matches!(source, "srt" | "vtt" | "sbv" | "ass" | "ssa")
}

fn is_xml_text_source(source: &str) -> bool {
    matches!(
        source,
        "xml"
            | "rss"
            | "atom"
            | "kml"
            | "gpx"
            | "ttml"
            | "dfxp"
            | "xsd"
            | "xsl"
            | "xslt"
            | "wsdl"
            | "plist"
            | "pom"
    )
}

fn is_html_source(source: &str) -> bool {
    matches!(source, "html" | "htm" | "shtml" | "xhtml" | "xht" | "xhtm")
}

fn is_mhtml_source(source: &str) -> bool {
    matches!(source, "mht" | "mhtml")
}

fn is_json_source(source: &str) -> bool {
    matches!(source, "json" | "jsonl" | "ndjson" | "jsonlines" | "ldjson")
}

fn is_tabular_source(source: &str) -> bool {
    matches!(source, "csv" | "tsv" | "tab" | "psv") || is_json_source(source)
}

fn is_legacy_tabular_source(source: &str) -> bool {
    matches!(source, "dbf" | "slk" | "dif")
}

fn is_odf_source(source: &str) -> bool {
    matches!(
        source,
        "odt"
            | "ott"
            | "fodt"
            | "sxw"
            | "stw"
            | "ods"
            | "ots"
            | "fods"
            | "sxc"
            | "stc"
            | "odp"
            | "otp"
            | "fodp"
            | "sxi"
            | "sti"
            | "odg"
            | "otg"
            | "fodg"
            | "sxd"
            | "std"
    )
}

fn convert_tabular(input: &str, output: &str, source: &str) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(input).map_err(|error| io_error(format!("stat text input: {error}")))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(io_error(
            "text input is too large for the lightweight backend".into(),
        ));
    }
    let bytes = fs::read(input).map_err(|error| io_error(format!("read text input: {error}")))?;
    let text = decode_text(&bytes);
    let (name, rows) = if is_json_source(source) {
        (source.to_ascii_uppercase(), parse_json_rows(&text, source)?)
    } else {
        parse_delimited_rows(&text, source)?
    };
    write_xlsx(output, &name, &rows)
}

fn convert_legacy_tabular(input: &str, output: &str, source: &str) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(input).map_err(|error| io_error(format!("stat tabular input: {error}")))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(io_error(
            "tabular input is too large for the lightweight backend".into(),
        ));
    }
    let bytes =
        fs::read(input).map_err(|error| io_error(format!("read tabular input: {error}")))?;
    let (name, rows) = match source {
        "dbf" => ("DBF", parse_dbf_rows(&bytes)?),
        "slk" => ("SYLK", parse_sylk_rows(&decode_text(&bytes))?),
        "dif" => ("DIF", parse_dif_rows(&decode_text(&bytes))?),
        _ => return Err(parse_error(format!("unsupported tabular format: {source}"))),
    };
    write_xlsx(output, name, &rows)
}

struct OdfSlide {
    name: String,
    paragraphs: Vec<String>,
    legacy_binary: bool,
    image: Option<PptSlideImage>,
    overlay_images: Vec<PptSlideImage>,
}

#[derive(Clone)]
struct PptSlideImage {
    extension: &'static str,
    content_type: &'static str,
    data: Vec<u8>,
    anchor: Option<PptImageAnchor>,
}

#[derive(Clone, Copy)]
struct PptImageAnchor {
    left: u16,
    top: u16,
    right: u16,
    bottom: u16,
}

const CFB_FREE: u32 = 0xffff_ffff;
const CFB_END: u32 = 0xffff_fffe;
const CFB_FAT: u32 = 0xffff_fffd;
const CFB_DIFAT: u32 = 0xffff_fffc;

struct CompoundEntry {
    name: String,
    path: String,
    kind: u8,
    start: u32,
    size: u64,
}

struct CompoundDirectoryRecord {
    name: String,
    kind: u8,
    left: u32,
    right: u32,
    child: u32,
    start: u32,
    size: u64,
}

struct CompoundFile {
    input: Vec<u8>,
    sector_size: usize,
    mini_sector_size: usize,
    mini_cutoff: u64,
    fat: Vec<u32>,
    mini_fat: Vec<u32>,
    mini_stream: Vec<u8>,
    entries: Vec<CompoundEntry>,
}

impl CompoundFile {
    fn parse(input: &[u8]) -> Result<Self, ConvertError> {
        if input.len() < 512
            || !input.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        {
            return Err(parse_error(
                "input does not look like a legacy compound file".into(),
            ));
        }
        let sector_shift = le_u16(input, 0x1e)? as usize;
        let mini_shift = le_u16(input, 0x20)? as usize;
        if sector_shift > 20 || mini_shift > 20 {
            return Err(parse_error("compound file has invalid sector shift".into()));
        }
        let mut file = Self {
            input: input.to_vec(),
            sector_size: 1usize << sector_shift,
            mini_sector_size: 1usize << mini_shift,
            mini_cutoff: le_u32(input, 0x38)? as u64,
            fat: Vec::new(),
            mini_fat: Vec::new(),
            mini_stream: Vec::new(),
            entries: Vec::new(),
        };
        if file.sector_size < 512 || file.mini_sector_size == 0 {
            return Err(parse_error("compound file has invalid sector size".into()));
        }
        if file.mini_cutoff == 0 {
            file.mini_cutoff = 4096;
        }
        let fat_count = le_u32(input, 0x2c)? as usize;
        let directory_sector = le_u32(input, 0x30)?;
        let mini_fat_sector = le_u32(input, 0x3c)?;
        let mini_fat_count = le_u32(input, 0x40)?;
        let difat_sector = le_u32(input, 0x44)?;
        let difat_count = le_u32(input, 0x48)?;
        let mut difat = file.read_difat(&input[0x4c..0x200], difat_sector, difat_count)?;
        difat.truncate(fat_count);
        file.fat = file.read_fat(&difat)?;
        let directory = file.read_regular_chain(directory_sector, 0)?;
        file.entries = parse_compound_directory(&directory)?;
        if file.entries.is_empty() {
            return Err(parse_error("compound file has no directory entries".into()));
        }
        if mini_fat_sector != CFB_END && mini_fat_count > 0 {
            let bytes = file.read_regular_chain(
                mini_fat_sector,
                mini_fat_count as u64 * file.sector_size as u64,
            )?;
            file.mini_fat = bytes
                .chunks_exact(4)
                .map(|value| u32::from_le_bytes(value.try_into().unwrap()))
                .collect();
        }
        if let Some(root) = file.entries.iter().find(|entry| entry.kind == 5) {
            if root.size > 0 && root.start != CFB_END {
                file.mini_stream = file.read_regular_chain(root.start, root.size)?;
            }
        }
        Ok(file)
    }

    fn read_difat(
        &self,
        header: &[u8],
        first_sector: u32,
        sector_count: u32,
    ) -> Result<Vec<u32>, ConvertError> {
        let mut output: Vec<u32> = header
            .chunks_exact(4)
            .map(|value| u32::from_le_bytes(value.try_into().unwrap()))
            .filter(|value| !cfb_special(*value))
            .collect();
        let mut sector = first_sector;
        for _ in 0..sector_count {
            if cfb_special(sector) {
                break;
            }
            let data = self.read_sector(sector)?;
            for value in data[..self.sector_size - 4].chunks_exact(4) {
                let value = u32::from_le_bytes(value.try_into().unwrap());
                if !cfb_special(value) {
                    output.push(value);
                }
            }
            sector = u32::from_le_bytes(data[self.sector_size - 4..].try_into().unwrap());
        }
        Ok(output)
    }

    fn read_fat(&self, sectors: &[u32]) -> Result<Vec<u32>, ConvertError> {
        let mut fat = Vec::new();
        for sector in sectors
            .iter()
            .copied()
            .filter(|sector| !cfb_special(*sector))
        {
            fat.extend(
                self.read_sector(sector)?
                    .chunks_exact(4)
                    .map(|value| u32::from_le_bytes(value.try_into().unwrap())),
            );
        }
        Ok(fat)
    }

    fn read_stream(&self, entry: &CompoundEntry) -> Result<Vec<u8>, ConvertError> {
        if entry.size < self.mini_cutoff
            && !self.mini_fat.is_empty()
            && !self.mini_stream.is_empty()
        {
            self.read_mini_chain(entry.start, entry.size)
        } else {
            self.read_regular_chain(entry.start, entry.size)
        }
    }

    fn read_regular_chain(&self, first: u32, expected: u64) -> Result<Vec<u8>, ConvertError> {
        if cfb_special(first) {
            return Ok(Vec::new());
        }
        let mut output = Vec::new();
        let mut sector = first;
        let mut visited = HashSet::new();
        while !cfb_special(sector) {
            if !visited.insert(sector) {
                return Err(parse_error("compound file sector chain loops".into()));
            }
            let next = *self.fat.get(sector as usize).ok_or_else(|| {
                parse_error("compound file sector chain points outside FAT".into())
            })?;
            output.extend_from_slice(self.read_sector(sector)?);
            sector = next;
        }
        if expected > 0 {
            output.truncate(expected.min(output.len() as u64) as usize);
        }
        Ok(output)
    }

    fn read_mini_chain(&self, first: u32, expected: u64) -> Result<Vec<u8>, ConvertError> {
        if cfb_special(first) {
            return Ok(Vec::new());
        }
        let mut output = Vec::new();
        let mut sector = first;
        let mut visited = HashSet::new();
        while !cfb_special(sector) {
            if !visited.insert(sector) {
                return Err(parse_error("compound file mini sector chain loops".into()));
            }
            let offset = sector as usize * self.mini_sector_size;
            if offset >= self.mini_stream.len() {
                return Err(parse_error(
                    "compound file mini sector points outside mini stream".into(),
                ));
            }
            let end = (offset + self.mini_sector_size).min(self.mini_stream.len());
            output.extend_from_slice(&self.mini_stream[offset..end]);
            sector = *self.mini_fat.get(sector as usize).ok_or_else(|| {
                parse_error("compound file mini sector chain points outside mini FAT".into())
            })?;
        }
        output.truncate(expected.min(output.len() as u64) as usize);
        Ok(output)
    }

    fn read_sector(&self, sector: u32) -> Result<&[u8], ConvertError> {
        let offset = (sector as usize)
            .checked_mul(self.sector_size)
            .ok_or_else(|| parse_error("compound file sector offset overflow".into()))?;
        let start = 512usize
            .checked_add(offset)
            .ok_or_else(|| parse_error("compound file sector offset overflow".into()))?;
        let end = start
            .checked_add(self.sector_size)
            .ok_or_else(|| parse_error("compound file sector offset overflow".into()))?;
        self.input
            .get(start..end)
            .ok_or_else(|| parse_error(format!("compound file sector {sector} is outside input")))
    }
}

fn le_u16(input: &[u8], offset: usize) -> Result<u16, ConvertError> {
    input
        .get(offset..offset + 2)
        .map(|value| u16::from_le_bytes(value.try_into().unwrap()))
        .ok_or_else(|| parse_error("compound file header is truncated".into()))
}

fn le_u32(input: &[u8], offset: usize) -> Result<u32, ConvertError> {
    input
        .get(offset..offset + 4)
        .map(|value| u32::from_le_bytes(value.try_into().unwrap()))
        .ok_or_else(|| parse_error("compound file header is truncated".into()))
}

fn cfb_special(value: u32) -> bool {
    matches!(value, CFB_FREE | CFB_END | CFB_FAT | CFB_DIFAT)
}

fn parse_compound_directory(data: &[u8]) -> Result<Vec<CompoundEntry>, ConvertError> {
    let mut records = Vec::new();
    for record in data.chunks_exact(128) {
        let name_length = u16::from_le_bytes(record[0x40..0x42].try_into().unwrap()) as usize;
        if !(2..=64).contains(&name_length) || record[0x42] == 0 {
            records.push(None);
            continue;
        }
        let name = String::from_utf16_lossy(
            &record[..name_length - 2]
                .chunks_exact(2)
                .map(|value| u16::from_le_bytes(value.try_into().unwrap()))
                .collect::<Vec<_>>(),
        );
        if name.is_empty() {
            records.push(None);
            continue;
        }
        records.push(Some(CompoundDirectoryRecord {
            name,
            kind: record[0x42],
            left: u32::from_le_bytes(record[0x44..0x48].try_into().unwrap()),
            right: u32::from_le_bytes(record[0x48..0x4c].try_into().unwrap()),
            child: u32::from_le_bytes(record[0x4c..0x50].try_into().unwrap()),
            start: u32::from_le_bytes(record[0x74..0x78].try_into().unwrap()),
            size: u64::from_le_bytes(record[0x78..0x80].try_into().unwrap()),
        }));
    }
    let Some((root_id, root)) = records.iter().enumerate().find_map(|(index, record)| {
        record
            .as_ref()
            .filter(|entry| entry.kind == 5)
            .map(|entry| (index, entry))
    }) else {
        return Err(parse_error(
            "compound file has no root directory entry".into(),
        ));
    };
    let mut entries = vec![CompoundEntry {
        name: root.name.clone(),
        path: String::new(),
        kind: root.kind,
        start: root.start,
        size: root.size,
    }];
    let mut visited = HashSet::from([root_id as u32]);
    append_compound_directory_tree(&records, root.child, "", &mut visited, &mut entries);
    if entries.len() == 1 {
        // Synthetic fixtures and some damaged producers leave all streams unlinked from Root Entry.
        for (id, record) in records.iter().enumerate() {
            let Some(record) = record.as_ref() else {
                continue;
            };
            if id == root_id || record.kind == 5 {
                continue;
            }
            entries.push(CompoundEntry {
                name: record.name.clone(),
                path: record.name.clone(),
                kind: record.kind,
                start: record.start,
                size: record.size,
            });
        }
    }
    Ok(entries)
}

fn append_compound_directory_tree(
    records: &[Option<CompoundDirectoryRecord>],
    id: u32,
    parent: &str,
    visited: &mut HashSet<u32>,
    output: &mut Vec<CompoundEntry>,
) {
    if cfb_special(id) || !visited.insert(id) {
        return;
    }
    let Some(record) = records.get(id as usize).and_then(Option::as_ref) else {
        return;
    };
    append_compound_directory_tree(records, record.left, parent, visited, output);
    let path = if parent.is_empty() {
        record.name.clone()
    } else {
        format!("{parent}/{}", record.name)
    };
    output.push(CompoundEntry {
        name: record.name.clone(),
        path: path.clone(),
        kind: record.kind,
        start: record.start,
        size: record.size,
    });
    if matches!(record.kind, 1 | 5) {
        append_compound_directory_tree(records, record.child, &path, visited, output);
    }
    append_compound_directory_tree(records, record.right, parent, visited, output);
}

fn convert_biff(input: &str, output: &str) -> Result<(), ConvertError> {
    let bytes = fs::read(input).map_err(|error| io_error(format!("read BIFF input: {error}")))?;
    let workbook = read_biff_workbook(&bytes)?;
    let sheets = parse_biff_sheets(&workbook)?;
    let borrowed = sheets
        .iter()
        .map(|(name, rows)| (name.as_str(), rows.as_slice()))
        .collect::<Vec<_>>();
    write_xlsx_sheets(output, &borrowed)
}

fn read_biff_workbook(input: &[u8]) -> Result<Vec<u8>, ConvertError> {
    if looks_like_biff(input) {
        return Ok(input.to_vec());
    }
    let file = CompoundFile::parse(input)?;
    for entry in file
        .entries
        .iter()
        .filter(|entry| entry.kind == 2 && !entry.path.contains('/'))
    {
        if matches!(
            entry.name.trim().to_ascii_lowercase().as_str(),
            "workbook" | "book"
        ) {
            let stream = file.read_stream(entry)?;
            if looks_like_biff(&stream) {
                return Ok(stream);
            }
            return Err(parse_error("compound workbook stream is not BIFF".into()));
        }
    }
    Err(parse_error(
        "compound file does not contain a Workbook stream".into(),
    ))
}

fn looks_like_biff(input: &[u8]) -> bool {
    input.get(..2).is_some_and(|value| {
        matches!(
            u16::from_le_bytes(value.try_into().unwrap()),
            0x0809 | 0x0409 | 0x0209 | 0x0009
        )
    })
}

fn parse_biff_sheets(input: &[u8]) -> Result<Vec<(String, Vec<Vec<SheetCell>>)>, ConvertError> {
    let mut records = Vec::new();
    let mut offset = 0;
    while offset + 4 <= input.len() {
        let record_offset = offset;
        let id = u16::from_le_bytes(input[offset..offset + 2].try_into().unwrap());
        let size = u16::from_le_bytes(input[offset + 2..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        if offset > input.len().saturating_sub(size) {
            return Err(parse_error(format!(
                "BIFF record 0x{id:04X} at offset {record_offset} is truncated"
            )));
        }
        records.push((id, record_offset, &input[offset..offset + size]));
        offset += size;
    }
    if records.is_empty() {
        return Err(parse_error("BIFF workbook has no records".into()));
    }

    let mut sheet_locations = Vec::new();
    let mut shared_strings = Vec::new();
    for (index, (id, _, data)) in records.iter().enumerate() {
        if *id == 0x0085 && data.len() >= 7 && data[5] == 0 {
            sheet_locations.push((
                u32::from_le_bytes(data[..4].try_into().unwrap()) as usize,
                read_biff_short_string(data, 6)
                    .map(|(value, _)| value)
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| format!("Sheet{}", sheet_locations.len() + 1)),
            ));
        } else if *id == 0x00fc {
            let mut sst = data.to_vec();
            for (next_id, _, next_data) in records.iter().skip(index + 1) {
                if *next_id != 0x003c {
                    break;
                }
                sst.extend_from_slice(next_data);
            }
            shared_strings = parse_biff_sst(&sst);
        }
    }

    if sheet_locations.is_empty() {
        sheet_locations.push((0, "Sheet1".into()));
    }
    let mut offsets = sheet_locations
        .iter()
        .map(|(offset, _)| *offset)
        .collect::<Vec<_>>();
    offsets.sort_unstable();
    offsets.dedup();
    Ok(sheet_locations
        .into_iter()
        .map(|(sheet_offset, name)| {
            let sheet_end = offsets
                .iter()
                .copied()
                .find(|offset| *offset > sheet_offset)
                .unwrap_or(input.len());
            (
                name,
                parse_biff_sheet_rows(&records, &shared_strings, sheet_offset, sheet_end),
            )
        })
        .collect())
}

fn parse_biff_sheet_rows(
    records: &[(u16, usize, &[u8])],
    shared_strings: &[String],
    sheet_offset: usize,
    sheet_end: usize,
) -> Vec<Vec<SheetCell>> {
    let mut cells = HashMap::new();
    let mut max_row = 0;
    let mut max_col = 0;
    let mut pending_formula_string = None;
    for &(id, record_offset, data) in records {
        if record_offset < sheet_offset || record_offset >= sheet_end {
            continue;
        }
        let mut set = |row: usize, col: usize, value: SheetCell| {
            if row < 10_000 && col < 256 {
                max_row = max_row.max(row);
                max_col = max_col.max(col);
                cells.insert((row, col), value);
            }
        };
        match id {
            0x0204 if data.len() >= 8 => {
                let (row, col) = biff_position(data);
                if let Some((value, _)) = read_biff_cell_string(data, 6) {
                    set(row, col, SheetCell::Text(value));
                }
            }
            0x00fd if data.len() >= 10 => {
                let (row, col) = biff_position(data);
                let index = u32::from_le_bytes(data[6..10].try_into().unwrap()) as usize;
                if let Some(value) = shared_strings.get(index) {
                    set(row, col, SheetCell::Text(value.clone()));
                }
            }
            0x0203 if data.len() >= 14 => {
                let (row, col) = biff_position(data);
                let value = f64::from_bits(u64::from_le_bytes(data[6..14].try_into().unwrap()));
                set(row, col, SheetCell::Number(value.to_string()));
            }
            0x027e if data.len() >= 10 => {
                let (row, col) = biff_position(data);
                let value = decode_biff_rk(u32::from_le_bytes(data[6..10].try_into().unwrap()));
                set(row, col, SheetCell::Number(value.to_string()));
            }
            0x00bd if data.len() >= 10 => {
                let row = u16::from_le_bytes(data[..2].try_into().unwrap()) as usize;
                let first_col = u16::from_le_bytes(data[2..4].try_into().unwrap()) as usize;
                for (index, value) in data[4..data.len() - 2].chunks_exact(6).enumerate() {
                    let number =
                        decode_biff_rk(u32::from_le_bytes(value[2..6].try_into().unwrap()));
                    set(
                        row,
                        first_col + index,
                        SheetCell::Number(number.to_string()),
                    );
                }
            }
            0x0205 if data.len() >= 8 => {
                let (row, col) = biff_position(data);
                if data[7] == 0 {
                    set(row, col, SheetCell::Bool(data[6] != 0));
                } else {
                    set(row, col, SheetCell::Text(format!("#ERR{}", data[6])));
                }
            }
            0x0006 if data.len() >= 14 => {
                let (row, col) = biff_position(data);
                match decode_biff_formula_result(&data[6..14]) {
                    Some(BiffFormulaResult::Cell(value)) => set(row, col, value),
                    Some(BiffFormulaResult::String) => pending_formula_string = Some((row, col)),
                    None => {}
                }
            }
            0x0207 => {
                if let Some((row, col)) = pending_formula_string.take() {
                    if let Some((value, _)) = read_biff_cell_string(data, 0) {
                        set(row, col, SheetCell::Text(value));
                    }
                }
            }
            _ => {}
        }
    }
    if cells.is_empty() {
        return Vec::new();
    }
    (0..=max_row)
        .map(|row| {
            (0..=max_col)
                .map(|col| cells.remove(&(row, col)).unwrap_or(SheetCell::Empty))
                .collect()
        })
        .collect()
}

fn biff_position(data: &[u8]) -> (usize, usize) {
    (
        u16::from_le_bytes(data[..2].try_into().unwrap()) as usize,
        u16::from_le_bytes(data[2..4].try_into().unwrap()) as usize,
    )
}

fn parse_biff_sst(data: &[u8]) -> Vec<String> {
    let Some(header) = data.get(4..8) else {
        return Vec::new();
    };
    let count = u32::from_le_bytes(header.try_into().unwrap()) as usize;
    let mut offset = 8;
    let mut values = Vec::new();
    for _ in 0..count {
        let Some((value, next)) = read_biff_unicode_string(data, offset, false) else {
            break;
        };
        values.push(value);
        offset = next;
    }
    values
}

fn read_biff_cell_string(data: &[u8], offset: usize) -> Option<(String, usize)> {
    read_biff_unicode_string(data, offset, false).or_else(|| {
        let length = *data.get(offset)? as usize;
        let start = offset + 1;
        let bytes = data.get(start..start + length)?;
        Some((
            bytes.iter().map(|byte| windows_1252_char(*byte)).collect(),
            start + length,
        ))
    })
}

fn read_biff_short_string(data: &[u8], offset: usize) -> Option<(String, usize)> {
    let length = *data.get(offset)? as usize;
    let flags = *data.get(offset + 1)?;
    let start = offset + 2;
    let byte_length = length.checked_mul(if flags & 1 != 0 { 2 } else { 1 })?;
    let bytes = data.get(start..start + byte_length)?;
    Some((
        decode_biff_chars(bytes, flags & 1 != 0),
        start + byte_length,
    ))
}

fn read_biff_unicode_string(data: &[u8], offset: usize, short: bool) -> Option<(String, usize)> {
    let (length, mut cursor) = if short {
        (*data.get(offset)? as usize, offset + 1)
    } else {
        (
            u16::from_le_bytes(data.get(offset..offset + 2)?.try_into().unwrap()) as usize,
            offset + 2,
        )
    };
    let flags = *data.get(cursor)?;
    cursor += 1;
    let rich_runs = if flags & 0x08 != 0 {
        let count = u16::from_le_bytes(data.get(cursor..cursor + 2)?.try_into().unwrap()) as usize;
        cursor += 2;
        count
    } else {
        0
    };
    let extension = if flags & 0x04 != 0 {
        let size = u32::from_le_bytes(data.get(cursor..cursor + 4)?.try_into().unwrap()) as usize;
        cursor += 4;
        size
    } else {
        0
    };
    let byte_length = length.checked_mul(if flags & 1 != 0 { 2 } else { 1 })?;
    let bytes = data.get(cursor..cursor + byte_length)?;
    cursor = cursor
        .checked_add(byte_length)?
        .checked_add(rich_runs.checked_mul(4)?)?
        .checked_add(extension)?;
    (cursor <= data.len()).then(|| (decode_biff_chars(bytes, flags & 1 != 0), cursor))
}

fn decode_biff_chars(input: &[u8], utf16: bool) -> String {
    if utf16 {
        decode_utf16(input, true)
    } else {
        input.iter().map(|byte| windows_1252_char(*byte)).collect()
    }
}

fn decode_biff_rk(value: u32) -> f64 {
    let mut result = if value & 0x02 != 0 {
        ((value as i32) >> 2) as f64
    } else {
        f64::from_bits(((value & 0xffff_fffc) as u64) << 32)
    };
    if value & 0x01 != 0 {
        result /= 100.0;
    }
    result
}

enum BiffFormulaResult {
    Cell(SheetCell),
    String,
}

fn decode_biff_formula_result(input: &[u8]) -> Option<BiffFormulaResult> {
    if input.len() < 8 {
        return None;
    }
    if input[6] == 0xff && input[7] == 0xff {
        return match input[0] {
            0 => Some(BiffFormulaResult::String),
            1 => Some(BiffFormulaResult::Cell(SheetCell::Bool(
                input[1] != 0 || input[2] != 0,
            ))),
            2 => Some(BiffFormulaResult::Cell(SheetCell::Text(format!(
                "#ERR{}",
                if input[2] == 0 { input[1] } else { input[2] }
            )))),
            _ => None,
        };
    }
    Some(BiffFormulaResult::Cell(SheetCell::Number(
        f64::from_bits(u64::from_le_bytes(input.try_into().unwrap())).to_string(),
    )))
}

fn convert_ppt_binary(input: &str, output: &str) -> Result<(), ConvertError> {
    let bytes = fs::read(input)
        .map_err(|error| io_error(format!("read PowerPoint binary input: {error}")))?;
    let file = CompoundFile::parse(&bytes)?;
    let mut document = Vec::new();
    let mut current_user = Vec::new();
    let mut picture_stream = Vec::new();
    for entry in file
        .entries
        .iter()
        .filter(|entry| entry.kind == 2 && entry.size > 0)
    {
        let target = match entry.path.trim().to_ascii_lowercase().as_str() {
            "powerpoint document" => &mut document,
            "current user" => &mut current_user,
            "pictures" => &mut picture_stream,
            _ => continue,
        };
        *target = file.read_stream(entry)?;
    }
    if document.is_empty() {
        return Err(parse_error(
            "compound file has no root PowerPoint Document stream".into(),
        ));
    }

    let pictures = parse_ppt_picture_stream(&picture_stream);
    let persisted = ppt_persisted_records(&document, &current_user);
    let mut slides = persisted
        .iter()
        .filter_map(|(_, offset)| ppt_record(&document, *offset))
        .filter(|(_, record_type, _)| *record_type == 1006)
        .take(256)
        .enumerate()
        .map(|(index, (_, _, payload))| {
            let mut paragraphs = Vec::new();
            let _ = walk_ppt_records(payload, &mut 0, &mut paragraphs, &mut Vec::new());
            retain_ppt_text(&mut paragraphs);
            let mut slide_images = find_ppt_blip_layers(payload)
                .into_iter()
                .filter_map(|(id, anchor)| {
                    pictures
                        .get(id.checked_sub(1)?)
                        .and_then(Clone::clone)
                        .map(|mut image| {
                            image.anchor = anchor;
                            image
                        })
                })
                .collect::<Vec<_>>();
            if slide_images.is_empty() {
                slide_images = find_ppt_blip_ids(payload)
                    .into_iter()
                    .filter_map(|id| id.checked_sub(1))
                    .filter_map(|id| pictures.get(id).and_then(Clone::clone))
                    .collect();
            }
            let mut slide_images = slide_images.into_iter();
            let image = slide_images.next();
            let overlay_images = slide_images.collect();
            OdfSlide {
                name: format!("Extracted Slide {}", index + 1),
                paragraphs,
                legacy_binary: true,
                image,
                overlay_images,
            }
        })
        .collect::<Vec<_>>();

    if !slides.is_empty() {
        return write_pptx(output, &slides);
    }

    // Older producers may store a navigable record tree without Current User/PersistDirectory data.
    let mut items = Vec::new();
    let mut slide_items = Vec::new();
    walk_ppt_records(&document, &mut 0, &mut items, &mut slide_items)?;
    retain_ppt_text(&mut items);
    for slide in &mut slide_items {
        retain_ppt_text(slide);
    }
    slide_items.retain(|slide| !slide.is_empty());
    if slide_items.is_empty() && items.is_empty() {
        return Err(ConvertError {
            code: "engine_unavailable",
            message: "unsupported legacy PowerPoint binary structure: no TextCharsAtom or TextBytesAtom records were found".into(),
        });
    }
    slides = if slide_items.is_empty() {
        // ponytail: old producers without Slide containers keep the previous text-chunk fallback.
        items.chunks(6).map(<[String]>::to_vec).collect::<Vec<_>>()
    } else {
        slide_items
    }
    .into_iter()
    .take(256)
    .enumerate()
    .map(|(index, paragraphs)| OdfSlide {
        name: format!("Extracted Slide {}", index + 1),
        paragraphs,
        legacy_binary: true,
        image: None,
        overlay_images: Vec::new(),
    })
    .collect::<Vec<_>>();
    write_pptx(output, &slides)
}

fn ppt_record(data: &[u8], offset: usize) -> Option<(u16, u16, &[u8])> {
    let header = u16::from_le_bytes(data.get(offset..offset + 2)?.try_into().ok()?);
    let record_type = u16::from_le_bytes(data.get(offset + 2..offset + 4)?.try_into().ok()?);
    let size = u32::from_le_bytes(data.get(offset + 4..offset + 8)?.try_into().ok()?) as usize;
    let start = offset.checked_add(8)?;
    let payload = data.get(start..start.checked_add(size)?)?;
    Some((header, record_type, payload))
}

fn ppt_persisted_records(document: &[u8], current_user: &[u8]) -> Vec<(u32, usize)> {
    let Some(mut edit_offset) = current_user
        .get(16..20)
        .map(|value| u32::from_le_bytes(value.try_into().unwrap()) as usize)
    else {
        return Vec::new();
    };
    let mut records = HashMap::new();
    let mut visited = HashSet::new();
    while edit_offset > 0 && visited.insert(edit_offset) {
        let Some((_, 4085, edit)) = ppt_record(document, edit_offset) else {
            break;
        };
        let Some(persist_offset) = edit
            .get(12..16)
            .map(|value| u32::from_le_bytes(value.try_into().unwrap()) as usize)
        else {
            break;
        };
        if let Some((_, 6002, directory)) = ppt_record(document, persist_offset) {
            let mut cursor = 0usize;
            while cursor + 4 <= directory.len() {
                let descriptor =
                    u32::from_le_bytes(directory[cursor..cursor + 4].try_into().unwrap());
                cursor += 4;
                let first_id = descriptor & 0x000f_ffff;
                let count = descriptor >> 20;
                if count == 0 || count > 4095 || cursor + count as usize * 4 > directory.len() {
                    break;
                }
                for index in 0..count {
                    let offset =
                        u32::from_le_bytes(directory[cursor..cursor + 4].try_into().unwrap())
                            as usize;
                    cursor += 4;
                    if ppt_record(document, offset).is_some() {
                        records.entry(first_id + index).or_insert(offset);
                    }
                }
            }
        }
        edit_offset = edit
            .get(8..12)
            .map(|value| u32::from_le_bytes(value.try_into().unwrap()) as usize)
            .unwrap_or(0);
    }
    let mut records = records.into_iter().collect::<Vec<_>>();
    records.sort_unstable_by_key(|(id, _)| *id);
    records
}

fn parse_ppt_picture_stream(data: &[u8]) -> Vec<Option<PptSlideImage>> {
    let mut pictures = Vec::new();
    let mut offset = 0usize;
    while let Some((_, record_type, payload)) = ppt_record(data, offset) {
        // OfficeArt stores JPEG and PNG blips in separate record types. Do not
        // scan PNG payloads for incidental JPEG markers from compressed data.
        let image = if record_type == 0xf01d {
            find_bytes(payload, &[0xff, 0xd8]).map(|start| PptSlideImage {
                extension: "jpeg",
                content_type: "image/jpeg",
                data: payload[start..].to_vec(),
                anchor: None,
            })
        } else if record_type == 0xf01e {
            find_bytes(payload, b"\x89PNG\r\n\x1a\n").map(|start| PptSlideImage {
                extension: "png",
                content_type: "image/png",
                data: payload[start..].to_vec(),
                anchor: None,
            })
        } else {
            None
        };
        pictures.push(image);
        offset += 8 + payload.len();
    }
    pictures
}

fn find_ppt_blip_ids(data: &[u8]) -> Vec<usize> {
    let mut ids = Vec::new();
    let mut offset = 0usize;
    while let Some((header, record_type, payload)) = ppt_record(data, offset) {
        if record_type == 0xf00b {
            let property_count = (header >> 4) as usize;
            for property in payload
                .get(..property_count.saturating_mul(6))
                .unwrap_or_default()
                .chunks_exact(6)
            {
                let id = u16::from_le_bytes(property[..2].try_into().unwrap());
                let value = u32::from_le_bytes(property[2..].try_into().unwrap());
                if id & 0x3fff == 260 && id & 0x4000 != 0 && value > 0 {
                    ids.push(value as usize);
                }
            }
        }
        if header & 0x000f == 0x000f {
            ids.extend(find_ppt_blip_ids(payload));
        }
        offset += 8 + payload.len();
    }
    ids
}

fn find_ppt_blip_layers(data: &[u8]) -> Vec<(usize, Option<PptImageAnchor>)> {
    let mut layers = Vec::new();
    let mut offset = 0usize;
    while let Some((header, record_type, payload)) = ppt_record(data, offset) {
        if record_type == 0xf004 {
            let mut ids = Vec::new();
            let mut anchor = None;
            let mut child_offset = 0usize;
            while let Some((child_header, child_type, child_payload)) =
                ppt_record(payload, child_offset)
            {
                if child_type == 0xf00b {
                    ids.extend(ppt_fopt_blip_ids(child_header, child_payload));
                } else if child_type == 0xf010 && child_payload.len() >= 8 {
                    anchor = Some(PptImageAnchor {
                        left: u16::from_le_bytes(child_payload[0..2].try_into().unwrap()),
                        top: u16::from_le_bytes(child_payload[2..4].try_into().unwrap()),
                        right: u16::from_le_bytes(child_payload[4..6].try_into().unwrap()),
                        bottom: u16::from_le_bytes(child_payload[6..8].try_into().unwrap()),
                    });
                }
                child_offset += 8 + child_payload.len();
            }
            layers.extend(ids.into_iter().map(|id| (id, anchor)));
        } else if header & 0x000f == 0x000f {
            layers.extend(find_ppt_blip_layers(payload));
        }
        offset += 8 + payload.len();
    }
    layers
}

fn ppt_fopt_blip_ids(header: u16, payload: &[u8]) -> Vec<usize> {
    let property_count = (header >> 4) as usize;
    payload
        .get(..property_count.saturating_mul(6))
        .unwrap_or_default()
        .chunks_exact(6)
        .filter_map(|property| {
            let id = u16::from_le_bytes(property[..2].try_into().unwrap());
            let value = u32::from_le_bytes(property[2..].try_into().unwrap());
            (id & 0x3fff == 260 && id & 0x4000 != 0 && value > 0).then_some(value as usize)
        })
        .collect()
}

fn find_bytes(input: &[u8], needle: &[u8]) -> Option<usize> {
    (!needle.is_empty() && needle.len() <= input.len())
        .then(|| {
            input
                .windows(needle.len())
                .position(|value| value == needle)
        })
        .flatten()
}

fn retain_ppt_text(items: &mut Vec<String>) {
    items.retain(|item| {
        let lower = item.to_ascii_lowercase();
        !item.is_empty()
            && !lower.contains("microsoft powerpoint")
            && !lower.contains("powerpoint document")
            && !lower.starts_with("current user")
    });
}

fn walk_ppt_records(
    data: &[u8],
    count: &mut usize,
    items: &mut Vec<String>,
    slides: &mut Vec<Vec<String>>,
) -> Result<(), ConvertError> {
    let mut offset = 0;
    while offset + 8 <= data.len() {
        *count += 1;
        if *count > 200_000 {
            return Err(parse_error(
                "PowerPoint binary record limit exceeded".into(),
            ));
        }
        let header = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap());
        let record_type = u16::from_le_bytes(data[offset + 2..offset + 4].try_into().unwrap());
        let size = u32::from_le_bytes(data[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        if start > data.len().saturating_sub(size) {
            return Err(parse_error(format!(
                "PowerPoint record at offset {offset} is truncated"
            )));
        }
        let payload = &data[start..start + size];
        let text = match record_type {
            4000 => normalize_ppt_text(&decode_utf16(payload, true)),
            4008 => normalize_ppt_text(
                &payload
                    .iter()
                    .map(|byte| windows_1252_char(*byte))
                    .collect::<String>(),
            ),
            _ => String::new(),
        };
        if !text.is_empty() {
            items.push(text);
        }
        if header & 0x0f == 0x0f && !payload.is_empty() {
            if record_type == 1006 {
                let mut slide = Vec::new();
                walk_ppt_records(payload, count, &mut slide, slides)?;
                if !slide.is_empty() {
                    slides.push(slide);
                }
            } else {
                walk_ppt_records(payload, count, items, slides)?;
            }
        }
        offset = start + size;
    }
    Ok(())
}

fn normalize_ppt_text(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

struct WordBinaryStreams {
    document: Vec<u8>,
    table0: Vec<u8>,
    table1: Vec<u8>,
    data: Vec<u8>,
}

#[derive(Clone)]
struct WordBinaryPiece {
    cp_start: i32,
    cp_end: i32,
    file_offset: usize,
    compressed: bool,
    prm: u16,
}

#[derive(Clone, Copy, Default)]
struct WordBinaryFib {
    flags: u16,
    ccp_text: usize,
    ccp_ftn: usize,
    ccp_hdd: usize,
    fc_clx: usize,
    lcb_clx: usize,
    fc_chpx: usize,
    lcb_chpx: usize,
    fc_papx: usize,
    lcb_papx: usize,
    fc_stshf: usize,
    lcb_stshf: usize,
    fc_sttbf_ffn: usize,
    lcb_sttbf_ffn: usize,
    fc_dop: usize,
    lcb_dop: usize,
    fc_plcf_sed: usize,
    lcb_plcf_sed: usize,
    fc_plcf_hdd: usize,
    lcb_plcf_hdd: usize,
    fc_plcfspa_mom: usize,
    lcb_plcfspa_mom: usize,
    fc_plcfspa_hdr: usize,
    lcb_plcfspa_hdr: usize,
    fc_dgg_info: usize,
    lcb_dgg_info: usize,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct WordBinaryCharProps {
    font_index: Option<u16>,
    bold: bool,
    italic: bool,
    underline: bool,
    underline_style: &'static str,
    strike: bool,
    small_caps: bool,
    caps: bool,
    hidden: bool,
    rtl: bool,
    vertical_align: &'static str,
    font_size: usize,
    color: Option<[u8; 3]>,
    highlight: Option<[u8; 3]>,
    picture_offset: Option<u32>,
}

#[derive(Clone, Default)]
struct WordBinaryParaProps {
    style_id: u16,
    heading_level: usize,
    list_kind: &'static str,
    list_level: usize,
    list_id: usize,
    alignment: &'static str,
    spacing_before: u16,
    spacing_after: u16,
    line_spacing: u16,
    line_spacing_rule: &'static str,
    indent_left: i16,
    indent_right: i16,
    first_line_indent: i16,
    shading: String,
    keep_next: bool,
    keep_lines: bool,
    page_break_before: bool,
    bidi: bool,
    spacing_before_explicit: bool,
    spacing_after_explicit: bool,
    table_cell: bool,
    table_row_end: bool,
    table_row_height: i16,
    table_row_cant_split: bool,
    table_row_header: bool,
    table_alignment: &'static str,
    table_borders: Option<[Option<DocxPageBorder>; 6]>,
    table_cell_padding_ops: Vec<WordBinaryCellPadding>,
    table_def: Option<WordBinaryTableDef>,
}

#[derive(Clone, Default)]
struct WordBinaryTableDef {
    rgdxa: Vec<i16>,
    cells: Vec<WordBinaryTableCellDef>,
}

#[derive(Clone, Copy, Default)]
struct WordBinaryTableCellDef {
    flags: u16,
    width: u16,
    borders: [Option<DocxPageBorder>; 4],
    margins: [Option<i16>; 4],
}

#[derive(Clone, Copy, Default)]
struct WordBinaryCellPadding {
    first_cell: usize,
    limit_cell: usize,
    sides: u8,
    width: i16,
}

const WORD_BINARY_F_MERGED: u16 = 0x0002;
const WORD_BINARY_F_VERT_MERGE: u16 = 0x0020;
const WORD_BINARY_F_VERT_RESTART: u16 = 0x0040;

#[derive(Clone)]
struct WordBinaryChar {
    value: char,
    cp: i32,
    fc: u32,
    props: WordBinaryCharProps,
}

fn convert_word_binary(input: &str, output: &str) -> Result<(), ConvertError> {
    let bytes =
        fs::read(input).map_err(|error| io_error(format!("read Word binary input: {error}")))?;
    let file = CompoundFile::parse(&bytes)?;
    let mut streams = WordBinaryStreams {
        document: Vec::new(),
        table0: Vec::new(),
        table1: Vec::new(),
        data: Vec::new(),
    };
    for entry in file
        .entries
        .iter()
        .filter(|entry| entry.kind == 2 && entry.size > 0 && !entry.path.contains('/'))
    {
        let target = match entry.name.trim().to_ascii_lowercase().as_str() {
            "worddocument" => &mut streams.document,
            "0table" => &mut streams.table0,
            "1table" => &mut streams.table1,
            "data" => &mut streams.data,
            _ => continue,
        };
        if let Ok(data) = file.read_stream(entry) {
            *target = data;
        }
    }
    if streams.document.is_empty() {
        return Err(parse_error(
            "compound file has no WordDocument stream".into(),
        ));
    }
    let fib = parse_word_binary_fib(&streams.document).unwrap_or_default();
    let table = word_binary_table(&streams, fib);
    let font_names = parse_word_binary_font_names(table, fib);
    let styles = parse_word_binary_stylesheet(table, fib);
    let pieces = parse_word_binary_piece_table(&streams, fib).ok_or_else(|| ConvertError {
        code: "engine_unavailable",
        message: "unsupported legacy Word binary structure: no decodable WordDocument CLX piece table was found".into(),
    })?;
    let chpx = parse_word_binary_chpx(&streams.document, table, fib);
    let papx = parse_word_binary_papx(&streams.document, table, fib, &styles);
    let page_count = parse_word_binary_page_count(table, fib);
    let paragraphs = decode_word_binary_paragraphs(
        &streams.document,
        &streams.data,
        &pieces,
        &chpx,
        &papx,
        &font_names,
    );
    let sections = parse_word_binary_sections(&streams.document, table, fib).unwrap_or_else(|| {
        vec![WordBinarySection {
            cp_end: i32::MAX,
            properties: DocxSection::default(),
        }]
    });
    let header_footers = parse_word_binary_header_footers(
        &streams.document,
        &streams.data,
        table,
        fib,
        &pieces,
        &chpx,
        &papx,
        &font_names,
    );
    let main_shape_anchors =
        parse_word_binary_shape_anchors(table, fib.fc_plcfspa_mom, fib.lcb_plcfspa_mom, 0);
    let header_shape_anchors = parse_word_binary_shape_anchors(
        table,
        fib.fc_plcfspa_hdr,
        fib.lcb_plcfspa_hdr,
        fib.ccp_text.saturating_add(fib.ccp_ftn) as i32,
    );
    let office_art = parse_word_binary_officeart(table, &streams.document, fib);
    let mut header_footers = header_footers;
    for record in &mut header_footers {
        attach_word_binary_shape_anchors_with_art(
            &mut record.paragraphs,
            &header_shape_anchors,
            &office_art,
        );
    }
    let mut paragraphs = paragraphs;
    append_unreferenced_word_binary_images(&mut paragraphs, &streams.data, false);
    append_unreferenced_word_binary_images(&mut paragraphs, &streams.document, true);
    attach_word_binary_shape_anchors_with_art(&mut paragraphs, &main_shape_anchors, &office_art);
    apply_word_binary_pagination(&mut paragraphs, &sections, page_count);
    write_docx_with_sections_and_headers(output, &paragraphs, &sections, &header_footers)
}

fn parse_word_binary_header_footers(
    document: &[u8],
    data: &[u8],
    table: &[u8],
    fib: WordBinaryFib,
    pieces: &[WordBinaryPiece],
    chpx: &[WordBinaryChpxEntry],
    papx: &[WordBinaryPapxEntry],
    font_names: &[String],
) -> Vec<WordBinaryHeaderFooter> {
    if fib.ccp_hdd == 0 || fib.lcb_plcf_hdd < 12 {
        return Vec::new();
    }
    let Some(plc) = table.get(fib.fc_plcf_hdd..fib.fc_plcf_hdd.saturating_add(fib.lcb_plcf_hdd))
    else {
        return Vec::new();
    };
    let cp_count = plc.len() / 4;
    if cp_count < 3 {
        return Vec::new();
    }
    let story_count = cp_count.saturating_sub(1);
    let hdd_len = fib.ccp_hdd;
    let hdd_base = fib.ccp_text.saturating_add(fib.ccp_ftn);
    let kinds = [
        "evenHeader",
        "defaultHeader",
        "evenFooter",
        "defaultFooter",
        "firstHeader",
        "firstFooter",
    ];
    let mut records = Vec::new();
    for story_index in 6..story_count {
        let start = word_binary_u32(plc, story_index * 4).unwrap_or(0) as usize;
        let end = word_binary_u32(plc, (story_index + 1) * 4).unwrap_or(0) as usize;
        let start = start.min(hdd_len);
        let end = end.min(hdd_len);
        if start >= end {
            continue;
        }
        let local = story_index.saturating_sub(6);
        let section_index = local / 6;
        let kind = kinds[local % kinds.len()];
        let story_start = hdd_base.saturating_add(start) as i32;
        let story_end = hdd_base.saturating_add(end) as i32;
        let paragraphs = decode_word_binary_paragraphs_range(
            document,
            data,
            pieces,
            chpx,
            papx,
            font_names,
            story_start,
            story_end,
        );
        // A non-empty PLC range containing only a paragraph mark is an explicit
        // blank story and must stop inheritance from the previous section.
        records.push(WordBinaryHeaderFooter {
            section_index,
            kind,
            paragraphs,
        });
    }
    records
}

fn parse_word_binary_sections(
    document: &[u8],
    table: &[u8],
    fib: WordBinaryFib,
) -> Option<Vec<WordBinarySection>> {
    let plc = table.get(fib.fc_plcf_sed..fib.fc_plcf_sed.saturating_add(fib.lcb_plcf_sed))?;
    if plc.len() < 16 || (plc.len() - 4) % 16 != 0 {
        return None;
    }
    let section_count = (plc.len() - 4) / 16;
    let descriptor_offset = (section_count + 1) * 4;
    let mut sections = Vec::with_capacity(section_count);
    for index in 0..section_count {
        let cp_end =
            i32::from_le_bytes(plc.get((index + 1) * 4..(index + 2) * 4)?.try_into().ok()?);
        let descriptor_start = descriptor_offset + index * 12;
        let descriptor = plc.get(descriptor_start..descriptor_start + 12)?;
        let properties = parse_word_binary_section_descriptor(document, descriptor);
        sections.push(WordBinarySection { cp_end, properties });
    }
    (!sections.is_empty()).then_some(sections)
}

fn parse_word_binary_section_descriptor(document: &[u8], descriptor: &[u8]) -> DocxSection {
    let Some(fc_sepx) = descriptor
        .get(2..6)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_le_bytes)
        .map(|value| value as usize)
    else {
        return DocxSection::default();
    };
    if fc_sepx == u32::MAX as usize || fc_sepx + 2 > document.len() {
        return DocxSection::default();
    }
    let Some(size) = document
        .get(fc_sepx..fc_sepx + 2)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u16::from_le_bytes)
        .map(usize::from)
    else {
        return DocxSection::default();
    };
    let Some(grpprl) = document.get(fc_sepx + 2..fc_sepx + 2 + size) else {
        return DocxSection::default();
    };
    parse_word_binary_section_properties(grpprl)
}

fn parse_word_binary_shape_anchors(
    table: &[u8],
    fc: usize,
    lcb: usize,
    cp_base: i32,
) -> Vec<WordBinaryShapeAnchor> {
    let Some(plc) = table.get(fc..fc.saturating_add(lcb)) else {
        return Vec::new();
    };
    if plc.len() < 30 || (plc.len() - 4) % 30 != 0 {
        return Vec::new();
    }
    let count = (plc.len() - 4) / 30;
    let records_offset = (count + 1) * 4;
    let mut anchors = Vec::with_capacity(count);
    for index in 0..count {
        let cp = word_binary_u32(plc, index * 4)
            .and_then(|value| i32::try_from(value).ok())
            .map(|value| cp_base.saturating_add(value));
        let Some(cp) = cp else {
            continue;
        };
        let Some(record) = plc.get(records_offset + index * 26..records_offset + (index + 1) * 26)
        else {
            continue;
        };
        let spid = u32::from_le_bytes(record[0..4].try_into().unwrap());
        let x_left = i32::from_le_bytes(record[4..8].try_into().unwrap());
        let y_top = i32::from_le_bytes(record[8..12].try_into().unwrap());
        let x_right = i32::from_le_bytes(record[12..16].try_into().unwrap());
        let y_bottom = i32::from_le_bytes(record[16..20].try_into().unwrap());
        let flags = u16::from_le_bytes(record[20..22].try_into().unwrap());
        let simple_position = flags & 0x2000 != 0;
        let (h_position, v_position) = if simple_position {
            ("page", "page")
        } else {
            (
                match (flags >> 1) & 0x3 {
                    0 => "margin",
                    1 => "page",
                    2 => "column",
                    _ => "page",
                },
                match (flags >> 3) & 0x3 {
                    0 => "margin",
                    1 => "page",
                    2 => "paragraph",
                    _ => "page",
                },
            )
        };
        let wrap = match (flags >> 5) & 0xf {
            1 => "none",
            3 => "topAndBottom",
            4 | 5 => "tight",
            6..=15 => "through",
            _ => "square",
        };
        let wrap_side = match (flags >> 9) & 0xf {
            1 => "left",
            2 => "right",
            3 => "largest",
            _ => "bothSides",
        };
        anchors.push(WordBinaryShapeAnchor {
            spid,
            cp,
            x_left,
            y_top,
            x_right,
            y_bottom,
            relative_h: h_position,
            relative_v: v_position,
            wrap,
            wrap_side,
            below_text: flags & 0x4000 != 0,
            anchor_lock: flags & 0x8000 != 0,
        });
    }
    anchors
}

fn parse_word_binary_officeart(
    table: &[u8],
    delay_stream: &[u8],
    fib: WordBinaryFib,
) -> WordBinaryOfficeArt {
    let Some(data) = table.get(fib.fc_dgg_info..fib.fc_dgg_info.saturating_add(fib.lcb_dgg_info))
    else {
        return WordBinaryOfficeArt::default();
    };
    if data.len() < 8 {
        return WordBinaryOfficeArt::default();
    }
    let mut office_art = WordBinaryOfficeArt::default();
    let mut offset = 0usize;
    if let Some(next) = parse_word_binary_escher_record(data, offset, data.len(), &mut office_art) {
        offset = next;
    }
    // OfficeArtWordDrawing prefixes each document drawing container with a one-byte
    // main/header label. The label is not an Escher record, so skip it explicitly.
    while offset < data.len() {
        if data[offset] <= 1 {
            offset += 1;
        }
        let Some(next) = parse_word_binary_escher_record(data, offset, data.len(), &mut office_art)
        else {
            break;
        };
        if next <= offset {
            break;
        }
        offset = next;
    }
    for (image, delay_offset) in office_art
        .blips
        .iter_mut()
        .zip(&office_art.blip_delay_offsets)
    {
        if image.is_none() {
            *image = delay_offset.and_then(|offset| {
                parse_word_binary_escher_blip(delay_stream, offset, delay_stream.len())
            });
        }
    }
    let blips = office_art.blips.clone();
    for shape in &mut office_art.shapes {
        if let Some(index) = shape.blip_index {
            shape.image = blips.get(index.saturating_sub(1)).and_then(Clone::clone);
        }
    }
    office_art
}

fn word_binary_escher_header(data: &[u8], offset: usize, end: usize) -> Option<(u16, u16, usize)> {
    let header = data.get(offset..offset.saturating_add(8))?;
    let options = u16::from_le_bytes(header[..2].try_into().ok()?);
    let record_id = u16::from_le_bytes(header[2..4].try_into().ok()?);
    let length = u32::from_le_bytes(header[4..8].try_into().ok()?) as usize;
    let total = 8usize.checked_add(length)?;
    (offset.checked_add(total)? <= end).then_some((options, record_id, total))
}

fn parse_word_binary_escher_record(
    data: &[u8],
    offset: usize,
    end: usize,
    office_art: &mut WordBinaryOfficeArt,
) -> Option<usize> {
    let (options, record_id, total) = word_binary_escher_header(data, offset, end)?;
    let payload_start = offset + 8;
    let payload_end = offset + total;
    match record_id {
        0xf001 => parse_word_binary_escher_children(data, payload_start, payload_end, office_art),
        0xf004 => {
            parse_word_binary_escher_shape_container(data, payload_start, payload_end, office_art)
        }
        0xf007 => parse_word_binary_escher_bse(data, payload_start, payload_end, office_art),
        _ if options & 0x000f == 0x000f => {
            parse_word_binary_escher_children(data, payload_start, payload_end, office_art)
        }
        _ => {}
    }
    Some(payload_end)
}

fn parse_word_binary_escher_children(
    data: &[u8],
    start: usize,
    end: usize,
    office_art: &mut WordBinaryOfficeArt,
) {
    let mut offset = start;
    while offset.saturating_add(8) <= end {
        let Some(next) = parse_word_binary_escher_record(data, offset, end, office_art) else {
            break;
        };
        if next <= offset {
            break;
        }
        offset = next;
    }
}

fn parse_word_binary_escher_shape_container(
    data: &[u8],
    start: usize,
    end: usize,
    office_art: &mut WordBinaryOfficeArt,
) {
    let mut offset = start;
    let mut shape: Option<WordBinaryShapeArt> = None;
    while offset.saturating_add(8) <= end {
        let Some((options, record_id, total)) = word_binary_escher_header(data, offset, end) else {
            break;
        };
        let payload_start = offset + 8;
        let payload_end = offset + total;
        match record_id {
            0xf00a if payload_end.saturating_sub(payload_start) >= 8 => {
                let spid =
                    u32::from_le_bytes(data[payload_start..payload_start + 4].try_into().unwrap());
                let flags = u32::from_le_bytes(
                    data[payload_start + 4..payload_start + 8]
                        .try_into()
                        .unwrap(),
                );
                shape = Some(WordBinaryShapeArt {
                    spid,
                    flip_h: flags & 0x0040 != 0,
                    flip_v: flags & 0x0080 != 0,
                    ..Default::default()
                });
            }
            0xf00b | 0xf122 => {
                if let Some(current) = shape.as_mut() {
                    parse_word_binary_escher_opt(
                        data,
                        payload_start,
                        payload_end,
                        options,
                        current,
                    );
                }
            }
            0xf004 => parse_word_binary_escher_shape_container(
                data,
                payload_start,
                payload_end,
                office_art,
            ),
            _ if options & 0x000f == 0x000f => {
                parse_word_binary_escher_children(data, payload_start, payload_end, office_art)
            }
            _ => {}
        }
        offset = payload_end;
    }
    if let Some(shape) = shape {
        if shape.spid != 0 {
            office_art.shapes.push(shape);
        }
    }
}

fn parse_word_binary_escher_opt(
    data: &[u8],
    start: usize,
    end: usize,
    options: u16,
    shape: &mut WordBinaryShapeArt,
) {
    let property_count = usize::from(options >> 4);
    let property_start = start;
    let Some(property_bytes) = property_count.checked_mul(6) else {
        return;
    };
    let Some(properties) =
        data.get(property_start..property_start.saturating_add(property_bytes).min(end))
    else {
        return;
    };
    for property in properties.chunks_exact(6).take(property_count) {
        let property_id = u16::from_le_bytes([property[0], property[1]]) & 0x3fff;
        let flags = u16::from_le_bytes([property[0], property[1]]);
        let value = u32::from_le_bytes(property[2..6].try_into().unwrap());
        if flags & 0x8000 != 0 {
            continue;
        }
        match property_id {
            0x0004 => shape.rotation = word_binary_officeart_rotation(value),
            0x0100 => shape.crop_top = word_binary_officeart_fixed_percentage(value),
            0x0101 => shape.crop_bottom = word_binary_officeart_fixed_percentage(value),
            0x0102 => shape.crop_left = word_binary_officeart_fixed_percentage(value),
            0x0103 => shape.crop_right = word_binary_officeart_fixed_percentage(value),
            0x0104 if value > 0 => shape.blip_index = usize::try_from(value).ok(),
            0x0182 => shape.opacity = Some(word_binary_officeart_fixed_percentage(value)),
            0x0384 => shape.wrap_distance_left = value,
            0x0385 => shape.wrap_distance_top = value,
            0x0386 => shape.wrap_distance_right = value,
            0x0387 => shape.wrap_distance_bottom = value,
            0x038f => shape.position_h = word_binary_officeart_horizontal_position(value),
            0x0390 => shape.relative_h = word_binary_officeart_horizontal_relative(value),
            0x0391 => shape.position_v = word_binary_officeart_vertical_position(value),
            0x0392 => shape.relative_v = word_binary_officeart_vertical_relative(value),
            0x03aa => shape.z_order = Some(value),
            0x03ba => shape.behind_doc = Some(value != 0),
            _ => {}
        }
    }
    let mut complex_offset = property_start.saturating_add(property_bytes);
    for property in properties.chunks_exact(6).take(property_count) {
        let property_id = u16::from_le_bytes([property[0], property[1]]) & 0x3fff;
        let flags = u16::from_le_bytes([property[0], property[1]]);
        if flags & 0x8000 == 0 {
            continue;
        }
        let size = u32::from_le_bytes(property[2..6].try_into().unwrap()) as usize;
        let Some(complex) = data.get(complex_offset..complex_offset.saturating_add(size).min(end))
        else {
            return;
        };
        if property_id == 0x0383 {
            shape.wrap_polygon = word_binary_officeart_wrap_polygon(complex);
        }
        complex_offset = complex_offset.saturating_add(size);
    }
}

fn word_binary_officeart_horizontal_position(value: u32) -> &'static str {
    match value {
        1 => "left",
        2 => "center",
        3 => "right",
        4 => "inside",
        5 => "outside",
        _ => "",
    }
}

fn word_binary_officeart_horizontal_relative(value: u32) -> &'static str {
    match value {
        1 => "margin",
        2 => "page",
        3 => "column",
        4 => "character",
        _ => "",
    }
}

fn word_binary_officeart_vertical_position(value: u32) -> &'static str {
    match value {
        1 => "top",
        2 => "center",
        3 => "bottom",
        4 => "inside",
        5 => "outside",
        _ => "",
    }
}

fn word_binary_officeart_vertical_relative(value: u32) -> &'static str {
    match value {
        1 => "margin",
        2 => "page",
        3 => "paragraph",
        4 => "line",
        _ => "",
    }
}

fn word_binary_officeart_wrap_polygon(data: &[u8]) -> Vec<(i32, i32)> {
    if data.len() < 6 {
        return Vec::new();
    }
    let count = usize::from(u16::from_le_bytes([data[0], data[1]]));
    let raw_size = i16::from_le_bytes([data[4], data[5]]);
    let element_size = if raw_size < 0 {
        usize::try_from((-i32::from(raw_size)) >> 2).unwrap_or(0)
    } else {
        usize::try_from(raw_size).unwrap_or(0)
    };
    if count == 0 || element_size < 8 {
        return Vec::new();
    }
    let mut points = Vec::with_capacity(count.min(256));
    for index in 0..count.min(256) {
        let start = 6usize.saturating_add(index.saturating_mul(element_size));
        let Some(point) = data.get(start..start.saturating_add(8)) else {
            break;
        };
        points.push((
            i32::from_le_bytes(point[..4].try_into().unwrap()),
            i32::from_le_bytes(point[4..8].try_into().unwrap()),
        ));
    }
    points
}

fn parse_word_binary_escher_bse(
    data: &[u8],
    start: usize,
    end: usize,
    office_art: &mut WordBinaryOfficeArt,
) {
    let (image, delay_offset) = if end.saturating_sub(start) >= 36 {
        let raw_delay_offset = u32::from_le_bytes(data[start + 28..start + 32].try_into().unwrap());
        let delay_offset = (raw_delay_offset != 0 && raw_delay_offset != u32::MAX)
            .then(|| usize::try_from(raw_delay_offset).ok())
            .flatten();
        let blip_start = start
            .saturating_add(36)
            .saturating_add(usize::from(data[start + 33]));
        (
            parse_word_binary_escher_blip(data, blip_start, end),
            delay_offset,
        )
    } else {
        (None, None)
    };
    office_art.blips.push(image);
    office_art.blip_delay_offsets.push(delay_offset);
}

fn parse_word_binary_escher_blip(data: &[u8], offset: usize, end: usize) -> Option<DocxImage> {
    let (_, record_id, total) = word_binary_escher_header(data, offset, end)?;
    if !(0xf018..=0xf117).contains(&record_id) {
        return None;
    }
    let payload_start = offset.saturating_add(8);
    let payload_end = offset.saturating_add(total);
    extract_word_binary_image(data.get(payload_start..payload_end)?, 0)
}

fn word_binary_officeart_fixed_percentage(value: u32) -> u32 {
    u32::try_from((u64::from(value).saturating_mul(100_000) + 32_768) / 65_536)
        .unwrap_or(100_000)
        .min(100_000)
}

fn word_binary_officeart_rotation(value: u32) -> i32 {
    let value = i32::from_le_bytes(value.to_le_bytes());
    (i64::from(value).saturating_mul(60_000) / 65_536) as i32
}

fn word_binary_twips_to_emu(value: i32) -> i64 {
    i64::from(value).saturating_mul(635)
}

fn apply_word_binary_shape_anchor(image: &mut DocxImage, shape: WordBinaryShapeAnchor) {
    image.floating = true;
    image.anchor_x_emu = word_binary_twips_to_emu(shape.x_left);
    image.anchor_y_emu = word_binary_twips_to_emu(shape.y_top);
    image.relative_h = shape.relative_h;
    image.relative_v = shape.relative_v;
    image.wrap = shape.wrap;
    image.wrap_side = shape.wrap_side;
    image.behind_doc = shape.below_text;
    image.anchor_lock = shape.anchor_lock;
    let width = shape.x_right.saturating_sub(shape.x_left).unsigned_abs();
    let height = shape.y_bottom.saturating_sub(shape.y_top).unsigned_abs();
    if width > 0 {
        image.width_emu = word_binary_twips_to_emu(i32::try_from(width).unwrap_or(i32::MAX)) as u64;
    }
    if height > 0 {
        image.height_emu =
            word_binary_twips_to_emu(i32::try_from(height).unwrap_or(i32::MAX)) as u64;
    }
}

#[cfg(test)]
fn attach_word_binary_shape_anchors(
    paragraphs: &mut [DocxParagraph],
    shapes: &[WordBinaryShapeAnchor],
) {
    attach_word_binary_shape_anchors_with_art(paragraphs, shapes, &WordBinaryOfficeArt::default());
}

fn apply_word_binary_shape_art(image: &mut DocxImage, art: &WordBinaryShapeArt) {
    image.relative_height = art.z_order.unwrap_or(image.relative_height);
    image.rotation = art.rotation;
    image.flip_h = art.flip_h;
    image.flip_v = art.flip_v;
    image.crop_left = art.crop_left;
    image.crop_top = art.crop_top;
    image.crop_right = art.crop_right;
    image.crop_bottom = art.crop_bottom;
    image.wrap_polygon = art.wrap_polygon.clone();
    image.opacity = art.opacity;
    image.anchor_align_h = art.position_h;
    image.anchor_align_v = art.position_v;
    if !art.relative_h.is_empty() {
        image.relative_h = art.relative_h;
    }
    if !art.relative_v.is_empty() {
        image.relative_v = art.relative_v;
    }
    image.wrap_distance_left = art.wrap_distance_left;
    image.wrap_distance_top = art.wrap_distance_top;
    image.wrap_distance_right = art.wrap_distance_right;
    image.wrap_distance_bottom = art.wrap_distance_bottom;
    if let Some(behind_doc) = art.behind_doc {
        image.behind_doc = behind_doc;
    }
}

fn attach_word_binary_shape_anchors_with_art(
    paragraphs: &mut [DocxParagraph],
    shapes: &[WordBinaryShapeAnchor],
    office_art: &WordBinaryOfficeArt,
) {
    for shape in shapes {
        let Some((_, paragraph)) = paragraphs
            .iter_mut()
            .enumerate()
            .filter(|(_, paragraph)| {
                paragraph.source_cp_start <= shape.cp && shape.cp <= paragraph.source_cp_end
            })
            .min_by_key(|(_, paragraph)| {
                paragraph
                    .source_cp_end
                    .saturating_sub(paragraph.source_cp_start)
            })
        else {
            continue;
        };
        let art = office_art
            .shapes
            .iter()
            .find(|candidate| candidate.spid == shape.spid);
        let preferred_data = art
            .and_then(|candidate| candidate.image.as_ref())
            .map(|candidate| candidate.data.as_slice());
        let image_index = preferred_data
            .and_then(|data| {
                paragraph.runs.iter().position(|run| {
                    run.image
                        .as_ref()
                        .is_some_and(|image| !image.floating && image.data.as_slice() == data)
                })
            })
            .or_else(|| {
                paragraph
                    .runs
                    .iter()
                    .position(|run| run.image.as_ref().is_some_and(|image| !image.floating))
            });
        let image_index = if let Some(image_index) = image_index {
            image_index
        } else if let Some(candidate) = art.and_then(|candidate| candidate.image.clone()) {
            if paragraph.runs.is_empty() && !paragraph.text.is_empty() {
                paragraph.runs.push(DocxRun {
                    text: paragraph.text.clone(),
                    bold: paragraph.bold,
                    ..Default::default()
                });
            }
            paragraph.runs.push(DocxRun {
                image: Some(candidate),
                ..Default::default()
            });
            paragraph.runs.len().saturating_sub(1)
        } else {
            continue;
        };
        let image = paragraph.runs[image_index]
            .image
            .as_mut()
            .expect("selected run has no image");
        apply_word_binary_shape_anchor(image, *shape);
        if let Some(art) = art {
            apply_word_binary_shape_art(image, art);
        }
    }
}

fn word_binary_border_style(kind: u8) -> &'static str {
    match kind {
        1 => "single",
        2 => "thick",
        3 => "double",
        // Word's hairline style has no direct WordprocessingML equivalent.
        5 => "single",
        6 => "dotted",
        7 => "dashed",
        8 => "dotDash",
        9 => "dotDotDash",
        10 => "triple",
        11 => "thinThickSmallGap",
        12 => "thickThinSmallGap",
        13 => "thinThickThinSmallGap",
        14 => "thinThickMediumGap",
        15 => "thickThinMediumGap",
        16 => "thinThickThinMediumGap",
        17 => "thinThickLargeGap",
        18 => "thickThinLargeGap",
        19 => "thinThickThinLargeGap",
        20 => "wave",
        21 => "doubleWave",
        22 => "dashSmallGap",
        23 => "dashDotStroked",
        24 => "threeDEmboss",
        25 => "threeDEngrave",
        26 => "outset",
        27 => "inset",
        _ => "single",
    }
}

fn word_binary_border_color(index: u8) -> Option<[u8; 3]> {
    word_binary_palette_color(index)
}

fn parse_word_binary_page_border(value: &[u8], version: u8) -> Option<DocxPageBorder> {
    let (line_width, border_type, color, flags) = if version == 9 {
        let bytes = value.get(1..9)?;
        let cv = &bytes[..4];
        let bits = &bytes[4..];
        let color = (cv != [0, 0, 0, 0xff]).then_some([cv[0], cv[1], cv[2]]);
        (bits[0], bits[1], color, bits[2])
    } else {
        let bytes = value.get(..4)?;
        (
            bytes[0],
            bytes[1],
            word_binary_border_color(bytes[2]),
            bytes[3],
        )
    };
    if border_type == 0 || line_width == 0 || line_width == 0xff {
        return None;
    }
    Some(DocxPageBorder {
        style: word_binary_border_style(border_type),
        size: u16::from(line_width),
        color,
        space: flags & 0x1f,
        shadow: flags & 0x20 != 0,
        frame: flags & 0x40 != 0,
    })
}

fn parse_word_binary_table_borders(value: &[u8]) -> Option<[Option<DocxPageBorder>; 6]> {
    let payload = value.get(1..)?;
    if payload.len() < 24 {
        return None;
    }
    let mut borders = [None; 6];
    for (index, border) in borders.iter_mut().enumerate() {
        *border = parse_word_binary_page_border(payload.get(index * 4..index * 4 + 4)?, 8);
    }
    Some(borders)
}

fn parse_word_binary_cell_padding(value: &[u8]) -> Option<WordBinaryCellPadding> {
    let payload = value.get(1..)?;
    if payload.len() < 6 || payload[3] != 3 {
        return None;
    }
    Some(WordBinaryCellPadding {
        first_cell: usize::from(payload[0]),
        limit_cell: usize::from(payload[1]),
        sides: payload[2] & 0x0f,
        width: i16::from_le_bytes([payload[4], payload[5]]),
    })
}

fn apply_word_binary_cell_padding(
    definition: &mut WordBinaryTableDef,
    padding: WordBinaryCellPadding,
) {
    let limit = padding.limit_cell.min(definition.cells.len());
    for cell in definition
        .cells
        .iter_mut()
        .take(limit)
        .skip(padding.first_cell)
    {
        for side in 0..4 {
            if padding.sides & (1 << side) != 0 {
                cell.margins[side] = Some(padding.width.max(0));
            }
        }
    }
}

fn parse_word_binary_section_properties(grpprl: &[u8]) -> DocxSection {
    let mut section = DocxSection::default();
    let mut offset = 0usize;
    while offset + 2 <= grpprl.len() {
        let sprm = u16::from_le_bytes([grpprl[offset], grpprl[offset + 1]]);
        let operand_offset = offset + 2;
        let Some(length) = word_binary_sprm_operand_len(sprm, grpprl, operand_offset) else {
            break;
        };
        let Some(value) = grpprl.get(operand_offset..operand_offset.saturating_add(length)) else {
            break;
        };
        let operation = sprm & 0x01ff;
        let signed = || {
            value
                .get(..2)
                .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as i32)
        };
        let unsigned = || {
            value
                .get(..2)
                .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]) as i32)
        };
        match sprm {
            // Section column properties use full SPRM ids because their low
            // operation bits overlap the legacy page-size operations below.
            0x500b => {
                if let Some(count_minus_one) = unsigned() {
                    section.columns = count_minus_one.clamp(0, 43) as u16 + 1;
                }
            }
            0x900c => {
                if let Some(gap) = unsigned() {
                    section.column_spacing = gap.clamp(0, 31_680);
                }
            }
            0x3019 => section.column_separator = value.first().copied().unwrap_or(0) != 0,
            0x3228 => section.column_rtl = value.first().copied().unwrap_or(0) != 0,
            0x300a => section.title_page = value.first().copied().unwrap_or(0) != 0,
            0x702b => section.page_border_top = parse_word_binary_page_border(value, 8),
            0x702c => section.page_border_left = parse_word_binary_page_border(value, 8),
            0x702d => section.page_border_bottom = parse_word_binary_page_border(value, 8),
            0x702e => section.page_border_right = parse_word_binary_page_border(value, 8),
            0xd234 => section.page_border_top = parse_word_binary_page_border(value, 9),
            0xd235 => section.page_border_left = parse_word_binary_page_border(value, 9),
            0xd236 => section.page_border_bottom = parse_word_binary_page_border(value, 9),
            0xd237 => section.page_border_right = parse_word_binary_page_border(value, 9),
            0x522f => {
                let options = value.first().copied().unwrap_or(0);
                section.page_border_display = match options & 0x07 {
                    1 => "firstPage",
                    2 => "notFirstPage",
                    _ => "allPages",
                };
                section.page_border_z_order = if (options >> 3) & 0x03 == 1 {
                    "back"
                } else {
                    "front"
                };
                section.page_border_offset_from = if (options >> 5) & 0x07 == 1 {
                    "page"
                } else {
                    "text"
                };
            }
            _ => match operation {
                0x09 => {
                    section.section_type = match value.first().copied().unwrap_or(2) {
                        0 => "continuous",
                        1 => "nextColumn",
                        3 => "evenPage",
                        4 => "oddPage",
                        _ => "nextPage",
                    }
                }
                0x1d => section.landscape = value.first().copied().unwrap_or(0) != 0,
                0x1f => {
                    section.page_width =
                        unsigned().unwrap_or(section.page_width as i32).max(1) as u32
                }
                0x20 => {
                    section.page_height =
                        unsigned().unwrap_or(section.page_height as i32).max(1) as u32
                }
                0x21 => section.margin_left = signed().unwrap_or(section.margin_left),
                0x22 => section.margin_right = signed().unwrap_or(section.margin_right),
                0x23 => section.margin_top = signed().unwrap_or(section.margin_top),
                0x24 => section.margin_bottom = signed().unwrap_or(section.margin_bottom),
                0x25 => section.gutter = signed().unwrap_or(section.gutter),
                0x17 => section.margin_header = signed().unwrap_or(section.margin_header),
                0x18 => section.margin_footer = signed().unwrap_or(section.margin_footer),
                _ => {}
            },
        }
        offset = operand_offset.saturating_add(length);
    }
    if section.landscape && section.page_width < section.page_height {
        std::mem::swap(&mut section.page_width, &mut section.page_height);
    }
    section
}

fn append_unreferenced_word_binary_images(
    paragraphs: &mut Vec<DocxParagraph>,
    data: &[u8],
    associate_by_offset: bool,
) {
    let mut offset = 0usize;
    let mut images: Vec<(DocxImage, Option<usize>)> = Vec::new();
    while offset < data.len() {
        let Some((relative, _, _)) = find_word_binary_raster(&data[offset..]) else {
            break;
        };
        let start = offset.saturating_add(relative);
        let Some(image) = extract_word_binary_image(data, start) else {
            offset = start.saturating_add(4);
            continue;
        };
        let image_len = image.data.len();
        let target = if associate_by_offset {
            let source_offset = u32::try_from(start).unwrap_or(u32::MAX);
            paragraphs.iter().position(|paragraph| {
                paragraph.source_fc_start > 0
                    && paragraph.source_fc_start <= source_offset
                    && source_offset <= paragraph.source_fc_end
            })
        } else {
            None
        };
        if let Some((_, existing_target)) = images
            .iter_mut()
            .find(|(existing, _)| existing.data == image.data)
        {
            if existing_target.is_none() {
                *existing_target = target;
            }
        } else {
            images.push((image, target));
        }
        offset = start.saturating_add(image_len.max(4));
    }
    for (image, target) in images {
        let already_referenced = paragraphs.iter().any(|paragraph| {
            paragraph.runs.iter().any(|run| {
                run.image
                    .as_ref()
                    .is_some_and(|candidate| candidate.data == image.data)
            })
        });
        if already_referenced {
            continue;
        }
        if let Some(index) = target {
            if let Some(paragraph) = paragraphs.get_mut(index) {
                if paragraph.runs.is_empty() && !paragraph.text.is_empty() {
                    paragraph.runs.push(DocxRun {
                        text: paragraph.text.clone(),
                        bold: paragraph.bold,
                        ..Default::default()
                    });
                }
                paragraph.runs.push(DocxRun {
                    image: Some(image),
                    ..Default::default()
                });
                continue;
            }
        }
        {
            paragraphs.push(DocxParagraph {
                runs: vec![DocxRun {
                    image: Some(image),
                    ..Default::default()
                }],
                ..Default::default()
            });
        }
    }
}

fn parse_word_binary_fib(document: &[u8]) -> Option<WordBinaryFib> {
    if document.len() < 36 || u16::from_le_bytes(document.get(..2)?.try_into().ok()?) != 0xA5EC {
        return None;
    }
    let flags = u16::from_le_bytes(document.get(0x0a..0x0c)?.try_into().ok()?);
    let csw = u16::from_le_bytes(document.get(32..34)?.try_into().ok()?) as usize;
    let cslw_offset = 34usize.checked_add(csw.checked_mul(2)?)?;
    let cslw = u16::from_le_bytes(
        document
            .get(cslw_offset..cslw_offset + 2)?
            .try_into()
            .ok()?,
    ) as usize;
    let rglw_offset = cslw_offset.checked_add(2)?;
    let lw = |index: usize| -> Option<usize> {
        Some(u32::from_le_bytes(
            document
                .get(rglw_offset + index.checked_mul(4)?..rglw_offset + index.checked_mul(4)? + 4)?
                .try_into()
                .ok()?,
        ) as usize)
    };
    let fclcb_count_offset = rglw_offset.checked_add(cslw.checked_mul(4)?)?;
    let fclcb_offset = fclcb_count_offset.checked_add(2)?;
    let pair = |index: usize| {
        let offset = fclcb_offset.checked_add(index.checked_mul(8)?)?;
        Some((
            u32::from_le_bytes(document.get(offset..offset + 4)?.try_into().ok()?) as usize,
            u32::from_le_bytes(document.get(offset + 4..offset + 8)?.try_into().ok()?) as usize,
        ))
    };
    let (fc_clx, lcb_clx) = pair(33)?;
    let (fc_plcf_sed, lcb_plcf_sed) = pair(6).unwrap_or((0, 0));
    let (fc_plcf_hdd, lcb_plcf_hdd) = pair(11).unwrap_or((0, 0));
    let (fc_plcfspa_mom, lcb_plcfspa_mom) = pair(40).unwrap_or((0, 0));
    let (fc_plcfspa_hdr, lcb_plcfspa_hdr) = pair(41).unwrap_or((0, 0));
    let (fc_dgg_info, lcb_dgg_info) = pair(50).unwrap_or((0, 0));
    let (fc_chpx, lcb_chpx) = pair(12).unwrap_or((0, 0));
    let (fc_papx, lcb_papx) = pair(13).unwrap_or((0, 0));
    let (fc_stshf, lcb_stshf) = pair(1).unwrap_or((0, 0));
    let (fc_sttbf_ffn, lcb_sttbf_ffn) = pair(15).unwrap_or((0, 0));
    let (fc_dop, lcb_dop) = pair(31).unwrap_or((0, 0));
    Some(WordBinaryFib {
        flags,
        ccp_text: lw(3).unwrap_or(0),
        ccp_ftn: lw(4).unwrap_or(0),
        ccp_hdd: lw(5).unwrap_or(0),
        fc_clx,
        lcb_clx,
        fc_chpx,
        lcb_chpx,
        fc_papx,
        lcb_papx,
        fc_stshf,
        lcb_stshf,
        fc_sttbf_ffn,
        lcb_sttbf_ffn,
        fc_dop,
        lcb_dop,
        fc_plcf_sed,
        lcb_plcf_sed,
        fc_plcf_hdd,
        lcb_plcf_hdd,
        fc_plcfspa_mom,
        lcb_plcfspa_mom,
        fc_plcfspa_hdr,
        lcb_plcfspa_hdr,
        fc_dgg_info,
        lcb_dgg_info,
    })
}

fn parse_word_binary_page_count(table: &[u8], fib: WordBinaryFib) -> Option<usize> {
    let dop = table.get(fib.fc_dop..fib.fc_dop.saturating_add(fib.lcb_dop))?;
    let pages = word_binary_u16(dop, 46)? as usize;
    (pages > 0 && pages <= MAX_WORD_PARAGRAPHS).then_some(pages)
}

fn word_binary_table<'a>(streams: &'a WordBinaryStreams, fib: WordBinaryFib) -> &'a [u8] {
    if fib.flags & 0x0200 != 0 {
        if !streams.table1.is_empty() {
            return &streams.table1;
        }
    } else if !streams.table0.is_empty() {
        return &streams.table0;
    }
    if !streams.table0.is_empty() {
        &streams.table0
    } else {
        &streams.table1
    }
}

fn parse_word_binary_font_names(table: &[u8], fib: WordBinaryFib) -> Vec<String> {
    let Some(data) =
        table.get(fib.fc_sttbf_ffn..fib.fc_sttbf_ffn.saturating_add(fib.lcb_sttbf_ffn))
    else {
        return Vec::new();
    };
    if data.len() < 4 {
        return Vec::new();
    }
    let extended = data.get(..2) == Some(&[0xff, 0xff]);
    let (mut pos, count, char_width) = if extended {
        (
            6usize,
            usize::from(u16::from_le_bytes([data[2], data[3]])),
            2usize,
        )
    } else {
        (
            4usize,
            usize::from(u16::from_le_bytes([data[0], data[1]])),
            1usize,
        )
    };
    let mut names = Vec::with_capacity(count.min(8192));
    for _ in 0..count.min(8192) {
        let cch = if extended {
            let Some(bytes) = data.get(pos..pos.saturating_add(2)) else {
                break;
            };
            let value = u16::from_le_bytes(bytes.try_into().ok().unwrap_or([0, 0]));
            pos = pos.saturating_add(2);
            usize::from(value)
        } else {
            let Some(&value) = data.get(pos) else { break };
            pos = pos.saturating_add(1);
            usize::from(value)
        };
        let Some(elem_len) = cch.checked_mul(char_width) else {
            break;
        };
        let Some(elem) = data.get(pos..pos.saturating_add(elem_len)) else {
            break;
        };
        names.push(parse_word_binary_font_name(elem));
        pos = pos.saturating_add(elem_len);
    }
    names
}

fn parse_word_binary_font_name(element: &[u8]) -> String {
    let units: Vec<u16> = element
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let mut best = String::new();
    let mut best_len = 0usize;
    let mut index = 0usize;
    while index < units.len() {
        let unit = units[index];
        let name_like = matches!(unit,
            0x20 | 0x21..=0x7e | 0x3040..=0x30ff | 0x3130..=0x318f |
            0x4e00..=0x9fff | 0xac00..=0xd7a3 | 0xf900..=0xfaff
        );
        if !name_like {
            index += 1;
            continue;
        }
        let start = index;
        while index < units.len() && units[index] != 0 {
            let value = units[index];
            let valid = matches!(value,
                0x20 | 0x21..=0x7e | 0x3040..=0x30ff | 0x3130..=0x318f |
                0x4e00..=0x9fff | 0xac00..=0xd7a3 | 0xf900..=0xfaff
            );
            if !valid {
                break;
            }
            index += 1;
        }
        if index < units.len() && units[index] == 0 && index.saturating_sub(start) > best_len {
            best = String::from_utf16_lossy(&units[start..index]);
            best_len = index.saturating_sub(start);
        }
        index = index.saturating_add(1);
    }
    best.trim().to_string()
}

fn parse_word_binary_piece_table(
    streams: &WordBinaryStreams,
    fib: WordBinaryFib,
) -> Option<Vec<WordBinaryPiece>> {
    let flags = fib.flags;
    let tables = if flags & 0x0200 != 0 {
        [&streams.table1, &streams.table0]
    } else {
        [&streams.table0, &streams.table1]
    };
    for table in tables.into_iter().filter(|table| !table.is_empty()) {
        if let Some(clx) = word_binary_clx(&streams.document, table, fib) {
            if let Some(pieces) = parse_word_binary_clx(clx, streams.document.len()) {
                return Some(pieces);
            }
        }
        for offset in 0..table.len().saturating_sub(4) {
            if table[offset] != 0x02 {
                continue;
            }
            let size =
                u32::from_le_bytes(table[offset + 1..offset + 5].try_into().unwrap()) as usize;
            if size > 4 && offset + 5 <= table.len().saturating_sub(size) {
                if let Some(pieces) = parse_word_binary_plcpcd(
                    &table[offset + 5..offset + 5 + size],
                    streams.document.len(),
                ) {
                    return Some(pieces);
                }
            }
        }
    }
    None
}

fn word_binary_clx<'a>(_document: &[u8], table: &'a [u8], fib: WordBinaryFib) -> Option<&'a [u8]> {
    let offset = fib.fc_clx;
    let size = fib.lcb_clx;
    (size > 0 && offset <= table.len().saturating_sub(size)).then(|| &table[offset..offset + size])
}

fn parse_word_binary_clx(clx: &[u8], document_size: usize) -> Option<Vec<WordBinaryPiece>> {
    let mut offset = 0;
    while offset < clx.len() {
        match clx[offset] {
            0x01 => {
                let size = u16::from_le_bytes(clx.get(offset + 1..offset + 3)?.try_into().unwrap())
                    as usize;
                offset = offset.checked_add(3 + size)?;
            }
            0x02 => {
                let size = u32::from_le_bytes(clx.get(offset + 1..offset + 5)?.try_into().unwrap())
                    as usize;
                if size <= 4 || offset + 5 > clx.len().saturating_sub(size) {
                    return None;
                }
                return parse_word_binary_plcpcd(
                    &clx[offset + 5..offset + 5 + size],
                    document_size,
                );
            }
            _ => offset += 1,
        }
    }
    None
}

fn parse_word_binary_plcpcd(data: &[u8], document_size: usize) -> Option<Vec<WordBinaryPiece>> {
    if data.len() < 16 || (data.len() - 4) % 12 != 0 {
        return None;
    }
    let count = (data.len() - 4) / 12;
    let cp_bytes = (count + 1) * 4;
    if cp_bytes + count * 8 != data.len() {
        return None;
    }
    let mut pieces = Vec::new();
    for index in 0..count {
        let cp_start = i32::from_le_bytes(data[index * 4..index * 4 + 4].try_into().unwrap());
        let cp_end = i32::from_le_bytes(data[index * 4 + 4..index * 4 + 8].try_into().unwrap());
        if cp_end <= cp_start {
            continue;
        }
        let pcd = &data[cp_bytes + index * 8..cp_bytes + index * 8 + 8];
        let compressed_offset = decode_word_binary_offset(&pcd[2..6], document_size);
        let compressed = compressed_offset & 0x4000_0000 != 0;
        let mut file_offset = (compressed_offset & 0x3fff_ffff) as usize;
        if compressed {
            file_offset /= 2;
        }
        pieces.push(WordBinaryPiece {
            cp_start,
            cp_end,
            file_offset,
            compressed,
            prm: u16::from_le_bytes(pcd[6..8].try_into().unwrap()),
        });
    }
    (!pieces.is_empty()).then_some(pieces)
}

fn decode_word_binary_offset(bytes: &[u8], document_size: usize) -> u32 {
    let raw = u32::from_le_bytes(bytes.try_into().unwrap());
    if word_binary_offset_in_range(raw, document_size) {
        return raw;
    }
    let swapped = u32::from_be_bytes(bytes.try_into().unwrap());
    if word_binary_offset_in_range(swapped, document_size) {
        return swapped;
    }
    if raw & 0x4000_0000 == 0 && raw % 256 == 0 {
        let shifted = raw / 256;
        if word_binary_offset_in_range(shifted, document_size) {
            return shifted;
        }
    }
    raw
}

fn decode_word_binary_paragraphs_range(
    document: &[u8],
    data: &[u8],
    pieces: &[WordBinaryPiece],
    chpx: &[WordBinaryChpxEntry],
    papx: &[WordBinaryPapxEntry],
    font_names: &[String],
    cp_start: i32,
    cp_end: i32,
) -> Vec<DocxParagraph> {
    if cp_end <= cp_start {
        return Vec::new();
    }
    let clipped = pieces
        .iter()
        .filter_map(|piece| {
            let start = piece.cp_start.max(cp_start);
            let end = piece.cp_end.min(cp_end);
            (start < end).then(|| WordBinaryPiece {
                cp_start: start,
                cp_end: end,
                file_offset: piece.file_offset.saturating_add(
                    usize::try_from(start.saturating_sub(piece.cp_start)).unwrap_or(0)
                        * if piece.compressed { 1 } else { 2 },
                ),
                compressed: piece.compressed,
                prm: piece.prm,
            })
        })
        .collect::<Vec<_>>();
    decode_word_binary_paragraphs(document, data, &clipped, chpx, papx, font_names)
}

fn word_binary_offset_in_range(value: u32, document_size: usize) -> bool {
    let mut offset = value & 0x3fff_ffff;
    if value & 0x4000_0000 != 0 {
        offset /= 2;
    }
    (offset as usize) < document_size
}

fn word_binary_run_from_props(
    text: String,
    props: WordBinaryCharProps,
    font_names: &[String],
) -> DocxRun {
    DocxRun {
        text,
        font_name: props
            .font_index
            .and_then(|index| font_names.get(index as usize))
            .cloned()
            .unwrap_or_default(),
        bold: props.bold,
        italic: props.italic,
        underline: props.underline,
        underline_style: props.underline_style,
        strike: props.strike,
        small_caps: props.small_caps,
        caps: props.caps,
        hidden: props.hidden,
        rtl: props.rtl,
        vertical_align: props.vertical_align,
        font_size: props.font_size,
        color: props.color.map(word_binary_rgb_hex).unwrap_or_default(),
        highlight: props.highlight.map(word_binary_rgb_hex).unwrap_or_default(),
        ..Default::default()
    }
}

fn word_binary_run_matches_props(
    run: &DocxRun,
    props: WordBinaryCharProps,
    font_names: &[String],
) -> bool {
    run.image.is_none()
        && run.field_instruction.is_empty()
        && run.bold == props.bold
        && run.italic == props.italic
        && run.underline == props.underline
        && run.underline_style == props.underline_style
        && run.strike == props.strike
        && run.small_caps == props.small_caps
        && run.caps == props.caps
        && run.hidden == props.hidden
        && run.rtl == props.rtl
        && run.font_name
            == props
                .font_index
                .and_then(|index| font_names.get(index as usize))
                .cloned()
                .unwrap_or_default()
        && run.vertical_align == props.vertical_align
        && run.font_size == props.font_size
        && run.color == props.color.map(word_binary_rgb_hex).unwrap_or_default()
        && run.highlight == props.highlight.map(word_binary_rgb_hex).unwrap_or_default()
}

fn word_binary_field_bounds(
    items: &[WordBinaryChar],
    start: usize,
) -> Option<(Option<usize>, usize)> {
    let mut depth = 0usize;
    let mut separator = None;
    for (index, item) in items.iter().enumerate().skip(start + 1) {
        match item.value {
            '\u{0013}' => depth = depth.saturating_add(1),
            '\u{0014}' if depth == 0 && separator.is_none() => separator = Some(index),
            '\u{0015}' if depth == 0 => return Some((separator, index)),
            '\u{0015}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    None
}

fn word_binary_field_visible_text(items: &[WordBinaryChar]) -> String {
    let mut text = String::new();
    let mut index = 0usize;
    while index < items.len() {
        let item = &items[index];
        if item.value == '\u{0013}'
            && let Some((separator, end)) = word_binary_field_bounds(items, index)
        {
            if let Some(separator) = separator {
                text.push_str(&word_binary_field_visible_text(&items[separator + 1..end]));
            }
            index = end + 1;
            continue;
        }
        if item.props.picture_offset.is_none()
            && !matches!(item.value, '\u{0013}' | '\u{0014}' | '\u{0015}')
        {
            text.push(item.value);
        }
        index += 1;
    }
    text
}

fn apply_word_binary_table_row_properties(
    paragraph: &mut DocxParagraph,
    properties: &WordBinaryParaProps,
) {
    paragraph.table_row_height = properties.table_row_height;
    paragraph.table_row_cant_split = properties.table_row_cant_split;
    paragraph.table_row_header = properties.table_row_header;
    paragraph.table_alignment = properties.table_alignment;
    paragraph.table_borders = properties.table_borders;
}

fn mark_word_binary_page_break(paragraphs: &mut Vec<DocxParagraph>, cp: i32, fc: u32) {
    if let Some(paragraph) = paragraphs.last_mut() {
        paragraph.page_break_after = true;
        return;
    }
    if paragraphs.len() < MAX_WORD_PARAGRAPHS {
        paragraphs.push(DocxParagraph {
            source_cp_start: cp,
            source_cp_end: cp,
            source_fc_start: fc,
            source_fc_end: fc,
            page_break_after: true,
            ..Default::default()
        });
    }
}

fn decode_word_binary_paragraphs(
    document: &[u8],
    data: &[u8],
    pieces: &[WordBinaryPiece],
    chpx: &[WordBinaryChpxEntry],
    papx: &[WordBinaryPapxEntry],
    font_names: &[String],
) -> Vec<DocxParagraph> {
    let mut current = Vec::new();
    let mut paragraphs: Vec<DocxParagraph> = Vec::new();
    let flush =
        |current: &mut Vec<WordBinaryChar>,
         paragraphs: &mut Vec<DocxParagraph>,
         terminator_fc: Option<u32>,
         terminator_cp: Option<i32>,
         table_cell_end: bool| {
            if current.is_empty() {
                if let Some(fc) = terminator_fc {
                    let properties = word_binary_papx_at(papx, fc);
                    if table_cell_end
                        && properties.table_cell
                        && let Some(previous) = paragraphs
                            .last_mut()
                            .filter(|paragraph| paragraph.table_cell && !paragraph.table_cell_end)
                    {
                        previous.table_cell_end = true;
                        previous.table_row_end |= properties.table_row_end;
                        apply_word_binary_table_row_properties(previous, &properties);
                        if let Some(definition) = properties.table_def.as_ref()
                            && properties.table_row_end
                        {
                            apply_word_binary_table_definition(paragraphs, definition);
                        }
                        current.clear();
                        return;
                    }
                    let row_marker_already_attached = properties.table_row_end
                        && paragraphs.last().is_some_and(|paragraph| {
                            paragraph.table_cell && paragraph.table_row_end
                        });
                    if properties.table_cell
                        && !row_marker_already_attached
                        && paragraphs.len() < MAX_WORD_PARAGRAPHS
                    {
                        paragraphs.push(DocxParagraph {
                            table_cell: true,
                            table_cell_end,
                            table_row_end: properties.table_row_end,
                            table_row_height: properties.table_row_height,
                            table_row_cant_split: properties.table_row_cant_split,
                            table_row_header: properties.table_row_header,
                            table_alignment: properties.table_alignment,
                            table_borders: properties.table_borders,
                            source_cp_start: terminator_cp.unwrap_or_default(),
                            source_cp_end: terminator_cp.unwrap_or_default(),
                            source_fc_start: terminator_fc.unwrap_or_default(),
                            source_fc_end: terminator_fc.unwrap_or_default(),
                            ..Default::default()
                        });
                        if let Some(definition) = properties.table_def.as_ref()
                            && properties.table_row_end
                        {
                            apply_word_binary_table_definition(paragraphs, definition);
                        }
                    }
                }
                current.clear();
                return;
            }
            if paragraphs.len() >= MAX_WORD_PARAGRAPHS {
                current.clear();
                return;
            }
            while current.first().is_some_and(|item| {
                item.props.picture_offset.is_none() && item.value.is_whitespace()
            }) {
                current.remove(0);
            }
            while current.last().is_some_and(|item| {
                item.props.picture_offset.is_none() && item.value.is_whitespace()
            }) {
                current.pop();
            }
            if current.is_empty() {
                return;
            }
            let fc = terminator_fc
                .or_else(|| current.first().map(|item| item.fc))
                .unwrap_or(0);
            let source_cp_start = current
                .first()
                .map(|item| item.cp)
                .or(terminator_cp)
                .unwrap_or_default();
            let source_cp_end = terminator_cp
                .or_else(|| current.last().map(|item| item.cp.saturating_add(1)))
                .unwrap_or(source_cp_start);
            let source_fc_start = current
                .first()
                .map(|item| item.fc)
                .or(terminator_fc)
                .unwrap_or_default();
            let source_fc_end = terminator_fc
                .or_else(|| current.last().map(|item| item.fc))
                .unwrap_or(source_fc_start);
            let properties = word_binary_papx_at(papx, fc);
            let mut runs = Vec::new();
            let mut text = String::new();
            let items = current.drain(..).collect::<Vec<_>>();
            let mut index = 0usize;
            while index < items.len() {
                let item = &items[index];
                if let Some(offset) = item.props.picture_offset {
                    if let Some(image) = extract_word_binary_image(data, offset as usize) {
                        runs.push(DocxRun {
                            image: Some(image),
                            ..Default::default()
                        });
                    }
                    index += 1;
                    continue;
                }
                if item.value == '\u{0013}'
                    && let Some((separator, end)) = word_binary_field_bounds(&items, index)
                {
                    let instruction_end = separator.unwrap_or(end);
                    let instruction =
                        word_binary_field_visible_text(&items[index + 1..instruction_end])
                            .trim()
                            .to_string();
                    if !instruction.is_empty() {
                        let result_start = separator.map_or(end, |position| position + 1);
                        let result_items = &items[result_start..end];
                        let result = word_binary_field_visible_text(result_items);
                        let props = result_items
                            .iter()
                            .find(|item| {
                                item.props.picture_offset.is_none()
                                    && !matches!(item.value, '\u{0013}' | '\u{0014}' | '\u{0015}')
                            })
                            .map(|item| item.props)
                            .unwrap_or(item.props);
                        text.push_str(&result);
                        let mut run = word_binary_run_from_props(result, props, font_names);
                        run.field_instruction = instruction;
                        runs.push(run);
                        index = end + 1;
                        continue;
                    }
                }
                if matches!(item.value, '\u{0013}' | '\u{0014}' | '\u{0015}') {
                    index += 1;
                    continue;
                }
                text.push(item.value);
                let props = item.props;
                if let Some(last) = runs
                    .last_mut()
                    .filter(|run| word_binary_run_matches_props(run, props, font_names))
                {
                    last.text.push(item.value);
                } else {
                    runs.push(word_binary_run_from_props(
                        item.value.to_string(),
                        props,
                        font_names,
                    ));
                }
                index += 1;
            }
            let mut paragraph = DocxParagraph {
                text: text.clone(),
                source_cp_start,
                source_cp_end,
                source_fc_start,
                source_fc_end,
                heading_level: properties.heading_level,
                list_kind: properties.list_kind,
                list_level: properties.list_level,
                list_id: properties.list_id,
                alignment: properties.alignment,
                spacing_before: properties.spacing_before,
                spacing_after: properties.spacing_after,
                // Word's default single-line paragraph spacing is 240 twentieths of a point.
                line_spacing: properties.line_spacing.max(240),
                line_spacing_rule: if properties.line_spacing_rule.is_empty() {
                    "auto"
                } else {
                    properties.line_spacing_rule
                },
                indent_left: properties.indent_left,
                indent_right: properties.indent_right,
                first_line_indent: properties.first_line_indent,
                shading: properties.shading.clone(),
                keep_next: properties.keep_next,
                keep_lines: properties.keep_lines,
                page_break_before: properties.page_break_before,
                bidi: properties.bidi,
                table_cell: properties.table_cell,
                table_cell_end,
                table_row_end: properties.table_row_end,
                table_row_height: properties.table_row_height,
                table_row_cant_split: properties.table_row_cant_split,
                table_row_header: properties.table_row_header,
                table_alignment: properties.table_alignment,
                table_borders: properties.table_borders,
                runs,
                ..Default::default()
            };
            if paragraph.heading_level == 0 && paragraph.list_kind.is_empty() {
                if let Some((kind, item)) = visible_list_marker(&paragraph.text) {
                    let removed = paragraph
                        .text
                        .chars()
                        .count()
                        .saturating_sub(item.chars().count());
                    trim_word_binary_run_prefix(&mut paragraph.runs, removed);
                    paragraph.list_kind = kind;
                    paragraph.text = item.to_string();
                }
                if paragraph.heading_level == 0 {
                    paragraph.heading_level = usize::from(word_binary_heading(&paragraph.text));
                    paragraph.bold = paragraph.heading_level > 0;
                }
            }
            if !paragraph.list_kind.is_empty() {
                if !properties.spacing_before_explicit {
                    paragraph.spacing_before = 0;
                }
                if !properties.spacing_after_explicit {
                    paragraph.spacing_after = 0;
                }
            }
            let table_def = properties.table_def.clone();
            if paragraph.table_cell
                && let Some(previous) = paragraphs
                    .last_mut()
                    .filter(|previous| previous.table_cell && !previous.table_cell_end)
            {
                append_word_binary_cell_paragraph(previous, &mut paragraph);
            } else {
                paragraphs.push(paragraph);
            }
            if let Some(definition) = table_def.as_ref().filter(|_| properties.table_row_end) {
                apply_word_binary_table_definition(paragraphs, definition);
            }
        };
    for piece in pieces {
        let count = (piece.cp_end - piece.cp_start) as usize;
        if count == 0 || piece.file_offset >= document.len() {
            continue;
        }
        for index in 0..count {
            let offset = piece
                .file_offset
                .saturating_add(index * if piece.compressed { 1 } else { 2 });
            let fc = offset.min(u32::MAX as usize) as u32;
            let mut props = word_binary_chpx_at(chpx, fc);
            apply_word_binary_prm0(&mut props, piece.prm);
            let value = if piece.compressed {
                document.get(offset).copied().map(windows_1252_char)
            } else {
                document
                    .get(offset..offset.saturating_add(2))
                    .and_then(|bytes| bytes.try_into().ok())
                    .map(u16::from_le_bytes)
                    .map(|value| char::from_u32(value as u32).unwrap_or('\u{fffd}'))
            };
            let Some(value) = value else { break };
            match value {
                '\r' | '\n' => {
                    let terminator_props = word_binary_papx_at(papx, fc);
                    if current.is_empty() && terminator_props.table_row_end {
                        if let Some(previous) = paragraphs.last_mut() {
                            previous.table_row_end = true;
                            apply_word_binary_table_row_properties(previous, &terminator_props);
                        }
                        if let Some(definition) = terminator_props.table_def.as_ref() {
                            apply_word_binary_table_definition(&mut paragraphs, definition);
                        }
                    }
                    flush(
                        &mut current,
                        &mut paragraphs,
                        Some(fc),
                        Some(piece.cp_start.saturating_add(index as i32)),
                        false,
                    )
                }
                '\u{000c}' => {
                    let terminator_props = word_binary_papx_at(papx, fc);
                    if current.is_empty() && terminator_props.table_row_end {
                        if let Some(previous) = paragraphs.last_mut() {
                            previous.table_row_end = true;
                            apply_word_binary_table_row_properties(previous, &terminator_props);
                        }
                        if let Some(definition) = terminator_props.table_def.as_ref() {
                            apply_word_binary_table_definition(&mut paragraphs, definition);
                        }
                    }
                    let cp = piece.cp_start.saturating_add(index as i32);
                    flush(&mut current, &mut paragraphs, Some(fc), Some(cp), false);
                    mark_word_binary_page_break(&mut paragraphs, cp, fc);
                }
                '\u{0007}' => {
                    let terminator_props = word_binary_papx_at(papx, fc);
                    if current.is_empty() && terminator_props.table_row_end {
                        if let Some(previous) = paragraphs.last_mut() {
                            previous.table_row_end = true;
                            previous.table_cell_end = true;
                            apply_word_binary_table_row_properties(previous, &terminator_props);
                        }
                        if let Some(definition) = terminator_props.table_def.as_ref() {
                            apply_word_binary_table_definition(&mut paragraphs, definition);
                        }
                    }
                    flush(
                        &mut current,
                        &mut paragraphs,
                        Some(fc),
                        Some(piece.cp_start.saturating_add(index as i32)),
                        true,
                    )
                }
                '\u{000b}' => current.push(WordBinaryChar {
                    value: '\n',
                    cp: piece.cp_start.saturating_add(index as i32),
                    fc,
                    props,
                }),
                '\u{0013}' | '\u{0014}' | '\u{0015}' => current.push(WordBinaryChar {
                    value,
                    cp: piece.cp_start.saturating_add(index as i32),
                    fc,
                    props,
                }),
                value if value < '\u{0020}' && value != '\t' => current.push(WordBinaryChar {
                    value: ' ',
                    cp: piece.cp_start.saturating_add(index as i32),
                    fc,
                    props,
                }),
                value => current.push(WordBinaryChar {
                    value,
                    cp: piece.cp_start.saturating_add(index as i32),
                    fc,
                    props,
                }),
            }
        }
    }
    flush(&mut current, &mut paragraphs, None, None, false);
    normalize_word_binary_table_grid_spans(&mut paragraphs);
    paragraphs
}

#[derive(Clone, Copy)]
struct WordBinaryLayoutBlock {
    start: usize,
    end: usize,
    section_index: usize,
    page_weight: u64,
}

fn word_binary_section_index(sections: &[WordBinarySection], cp: i32) -> usize {
    sections
        .iter()
        .position(|section| cp <= section.cp_end)
        .unwrap_or_else(|| sections.len().saturating_sub(1))
}

fn word_binary_page_content_width(section: DocxSection) -> u64 {
    let total = i64::from(section.page_width)
        .saturating_sub(i64::from(section.margin_left))
        .saturating_sub(i64::from(section.margin_right))
        .saturating_sub(i64::from(section.gutter))
        .max(1) as u64;
    let columns = u64::from(section.columns.max(1));
    let gaps = u64::try_from(section.column_spacing.max(0))
        .unwrap_or(0)
        .saturating_mul(columns.saturating_sub(1));
    total.saturating_sub(gaps).max(columns) / columns
}

fn word_binary_page_content_height(section: DocxSection) -> u64 {
    i64::from(section.page_height)
        .saturating_sub(i64::from(section.margin_top))
        .saturating_sub(i64::from(section.margin_bottom))
        .max(1) as u64
}

fn word_binary_paragraph_font_twips(paragraph: &DocxParagraph) -> u64 {
    let run_size = paragraph
        .runs
        .iter()
        .filter(|run| !run.hidden && run.image.is_none())
        .map(|run| run.font_size)
        .max()
        .unwrap_or(0);
    let heading_size = match paragraph.heading_level {
        1 => 32,
        2 => 28,
        3 => 24,
        4 => 22,
        _ => 20,
    };
    u64::try_from(run_size.max(heading_size)).unwrap_or(20) * 10
}

fn word_binary_text_width_units(text: &str) -> u64 {
    text.chars()
        .map(|value| match value {
            '\t' => 8,
            value if value.is_ascii() => 1,
            _ => 2,
        })
        .sum()
}

fn word_binary_paragraph_height(paragraph: &DocxParagraph, section: DocxSection) -> u64 {
    let font_twips = word_binary_paragraph_font_twips(paragraph).max(1);
    let mut width = if paragraph.table_cell_preferred_width > 0 {
        u64::from(paragraph.table_cell_preferred_width)
    } else if paragraph.table_grid_right != paragraph.table_grid_left {
        u64::from(
            paragraph
                .table_grid_right
                .abs_diff(paragraph.table_grid_left),
        )
    } else {
        word_binary_page_content_width(section)
    };
    width = width
        .saturating_sub(u64::from(paragraph.indent_left.unsigned_abs()))
        .saturating_sub(u64::from(paragraph.indent_right.unsigned_abs()))
        .max(font_twips / 2);
    let units_per_line = width
        .saturating_mul(2)
        .checked_div(font_twips)
        .unwrap_or(1)
        .max(1);
    let line_count = paragraph
        .text
        .split('\n')
        .map(|line| {
            word_binary_text_width_units(line)
                .max(1)
                .saturating_add(units_per_line - 1)
                / units_per_line
        })
        .sum::<u64>()
        .max(1);
    let natural_line_height = font_twips.saturating_mul(6) / 5;
    let line_spacing = u64::from(paragraph.line_spacing.max(240));
    let line_height = match paragraph.line_spacing_rule {
        "exact" => line_spacing,
        "atLeast" => natural_line_height.max(line_spacing),
        _ => natural_line_height.saturating_mul(line_spacing) / 240,
    }
    .max(1);
    let text_height = line_count.saturating_mul(line_height);
    let mut inline_image_height = 0u64;
    let mut floating_image_height = 0u64;
    for image in paragraph.runs.iter().filter_map(|run| run.image.as_ref()) {
        let height = image.height_emu / 635;
        if image.floating {
            let contribution = if image.wrap == "topAndBottom" {
                height
            } else {
                height / 3
            };
            floating_image_height = floating_image_height.max(contribution);
        } else {
            inline_image_height = inline_image_height.max(height);
        }
    }
    let cell_spacing = if paragraph.table_cell {
        paragraph.table_cell_margins[0]
            .unwrap_or(0)
            .max(0)
            .saturating_add(paragraph.table_cell_margins[2].unwrap_or(0).max(0)) as u64
    } else {
        0
    };
    text_height
        .max(inline_image_height)
        .saturating_add(floating_image_height)
        .saturating_add(u64::from(paragraph.spacing_before))
        .saturating_add(u64::from(paragraph.spacing_after))
        .saturating_add(cell_spacing)
        .max(line_height)
}

fn word_binary_layout_blocks(
    paragraphs: &[DocxParagraph],
    sections: &[WordBinarySection],
) -> Vec<WordBinaryLayoutBlock> {
    let mut blocks = Vec::new();
    let mut start = 0usize;
    while start < paragraphs.len() {
        let section_index = word_binary_section_index(sections, paragraphs[start].source_cp_start);
        let section = sections
            .get(section_index)
            .map(|value| value.properties)
            .unwrap_or_default();
        let mut end = start + 1;
        let height = if paragraphs[start].table_cell {
            while end < paragraphs.len()
                && paragraphs[end - 1].table_cell
                && !paragraphs[end - 1].table_row_end
                && paragraphs[end].table_cell
            {
                end += 1;
            }
            let content_height = paragraphs[start..end]
                .iter()
                .map(|paragraph| word_binary_paragraph_height(paragraph, section))
                .max()
                .unwrap_or(1);
            let row_height = paragraphs[start..end]
                .iter()
                .map(|paragraph| u64::from(paragraph.table_row_height.unsigned_abs()))
                .max()
                .unwrap_or(0);
            content_height.max(row_height)
        } else {
            word_binary_paragraph_height(&paragraphs[start], section)
        };
        let page_height = word_binary_page_content_height(section);
        blocks.push(WordBinaryLayoutBlock {
            start,
            end,
            section_index,
            page_weight: height.saturating_mul(1_000_000) / page_height.max(1),
        });
        start = end;
    }
    blocks
}

fn word_binary_page_break_offsets(text: &str, count: usize) -> Vec<usize> {
    let chars = text.chars().collect::<Vec<_>>();
    if count == 0 || chars.len() < 2 {
        return Vec::new();
    }
    let mut offsets = Vec::with_capacity(count);
    for index in 1..=count {
        let target = chars.len().saturating_mul(index) / (count + 1);
        let mut offset = target.clamp(1, chars.len() - 1);
        for distance in 0..=40usize {
            let right = target.saturating_add(distance);
            if right < chars.len() && chars[right].is_whitespace() {
                offset = (right + 1).min(chars.len() - 1);
                break;
            }
            if let Some(left) = target.checked_sub(distance + 1)
                && chars[left].is_whitespace()
            {
                offset = (left + 1).min(chars.len() - 1);
                break;
            }
        }
        if offsets.last().copied() != Some(offset) {
            offsets.push(offset);
        }
    }
    offsets
}

fn apply_word_binary_pagination(
    paragraphs: &mut [DocxParagraph],
    sections: &[WordBinarySection],
    reported_pages: Option<usize>,
) {
    if paragraphs.is_empty() || sections.is_empty() {
        return;
    }
    for paragraph in paragraphs.iter_mut() {
        if paragraph.page_break_after
            && sections[..sections.len().saturating_sub(1)]
                .iter()
                .any(|section| paragraph.source_cp_end.abs_diff(section.cp_end) <= 1)
        {
            paragraph.page_break_after = false;
        }
        paragraph.last_rendered_page_break_before = paragraph.page_break_before;
        paragraph.rendered_page_break_offsets.clear();
    }
    let blocks = word_binary_layout_blocks(paragraphs, sections);
    if blocks.is_empty() {
        return;
    }
    let mut chosen = vec![false; blocks.len() + 1];
    for boundary in 1..blocks.len() {
        let previous = blocks[boundary - 1];
        let current = blocks[boundary];
        let forced_after = paragraphs[previous.end - 1].page_break_after;
        let forced_before = paragraphs[current.start].page_break_before;
        let section_break = previous.section_index != current.section_index
            && sections
                .get(previous.section_index)
                .is_some_and(|section| section.properties.section_type != "continuous");
        chosen[boundary] = forced_after || forced_before || section_break;
        if (forced_before || section_break) && !forced_after {
            paragraphs[current.start].last_rendered_page_break_before = true;
        }
    }
    let mut positions = vec![0u64; blocks.len() + 1];
    for (index, block) in blocks.iter().enumerate() {
        positions[index + 1] = positions[index].saturating_add(block.page_weight.max(1));
    }
    let total = positions.last().copied().unwrap_or(1).max(1);
    let forced_breaks = chosen.iter().filter(|value| **value).count();
    let estimated_pages = total.saturating_add(899_999) / 900_000;
    // Auto page boundaries are usually absent, so distribute saved/estimated pages by layout weight.
    let target_pages = reported_pages
        .map(|pages| pages as u64)
        .unwrap_or(estimated_pages)
        .max(forced_breaks.saturating_add(1) as u64)
        .min(MAX_WORD_PARAGRAPHS as u64) as usize;
    let desired_breaks = target_pages.saturating_sub(1);
    if forced_breaks >= desired_breaks {
        return;
    }
    let segment_count = desired_breaks + 1;
    let targets = (1..=desired_breaks)
        .map(|index| total.saturating_mul(index as u64) / segment_count as u64)
        .collect::<Vec<_>>();
    let mut target_taken = vec![false; targets.len()];
    for boundary in (1..blocks.len()).filter(|boundary| chosen[*boundary]) {
        if let Some((target, _)) = targets
            .iter()
            .enumerate()
            .filter(|(index, _)| !target_taken[*index])
            .min_by_key(|(_, target)| positions[boundary].abs_diff(**target))
        {
            target_taken[target] = true;
        }
    }
    let keep_penalty = total / segment_count as u64;
    for (target_index, target) in targets.iter().enumerate() {
        if target_taken[target_index] {
            continue;
        }
        let Some((boundary, _)) = (1..blocks.len())
            .filter(|boundary| !chosen[*boundary])
            .map(|boundary| {
                let previous = blocks[boundary - 1];
                let keep_together = paragraphs[previous.end - 1].keep_next;
                let penalty = if keep_together { keep_penalty } else { 0 };
                (
                    boundary,
                    positions[boundary]
                        .abs_diff(*target)
                        .saturating_add(penalty),
                )
            })
            .min_by_key(|(_, score)| *score)
        else {
            break;
        };
        chosen[boundary] = true;
    }
    for boundary in 1..blocks.len() {
        if chosen[boundary] {
            let previous = blocks[boundary - 1];
            if !paragraphs[previous.end - 1].page_break_after
                || paragraphs[previous.end - 1].table_cell
                || paragraphs[blocks[boundary].start].table_cell
            {
                paragraphs[blocks[boundary].start].last_rendered_page_break_before = true;
            }
        }
    }
    let selected_boundaries = chosen.iter().filter(|value| **value).count();
    let mut missing_breaks = desired_breaks.saturating_sub(selected_boundaries);
    let mut internal_counts = vec![0usize; paragraphs.len()];
    while missing_breaks > 0 {
        let Some((paragraph_index, _)) = blocks
            .iter()
            .filter(|block| block.end == block.start + 1)
            .filter_map(|block| {
                let paragraph = &paragraphs[block.start];
                let char_count = paragraph.text.chars().count();
                let eligible = !paragraph.table_cell
                    && char_count > internal_counts[block.start] + 1
                    && paragraph
                        .runs
                        .iter()
                        .all(|run| run.field_instruction.is_empty());
                eligible.then_some((
                    block.start,
                    block.page_weight / (internal_counts[block.start] as u64 + 1),
                ))
            })
            .max_by_key(|(_, score)| *score)
        else {
            break;
        };
        internal_counts[paragraph_index] += 1;
        missing_breaks -= 1;
    }
    for (index, count) in internal_counts.into_iter().enumerate() {
        if count > 0 {
            paragraphs[index].rendered_page_break_offsets =
                word_binary_page_break_offsets(&paragraphs[index].text, count);
        }
    }
}

fn trim_word_binary_run_prefix(runs: &mut Vec<DocxRun>, mut count: usize) {
    for run in runs.iter_mut() {
        if count == 0 || run.image.is_some() {
            continue;
        }
        let chars = run.text.chars().count();
        if chars <= count {
            run.text.clear();
            count -= chars;
        } else {
            run.text = run.text.chars().skip(count).collect();
            break;
        }
    }
    runs.retain(|run| run.image.is_some() || !run.text.is_empty());
}

fn apply_word_binary_table_definition(
    paragraphs: &mut [DocxParagraph],
    definition: &WordBinaryTableDef,
) {
    if definition.cells.is_empty() {
        return;
    }
    let Some(row_end) = paragraphs
        .iter()
        .rposition(|paragraph| paragraph.table_cell)
    else {
        return;
    };
    let row_start = paragraphs[..row_end]
        .iter()
        .rposition(|paragraph| !paragraph.table_cell || paragraph.table_row_end)
        .map_or(0, |index| index + 1);
    let cells: Vec<usize> = paragraphs[row_start..]
        .iter()
        .enumerate()
        .filter_map(|(offset, paragraph)| paragraph.table_cell.then_some(row_start + offset))
        .collect();
    if cells.is_empty() {
        return;
    }

    // Word streams one paragraph per physical cell. fMerged folds a physical
    // cell into the preceding logical cell, so carry its text into that cell
    // and suppress the duplicate <w:tc>.
    let mut logical_cells: Vec<usize> = Vec::new();
    for (physical, cell) in definition.cells.iter().copied().enumerate() {
        let Some(&paragraph_index) = cells.get(physical) else {
            break;
        };
        let flags = cell.flags;
        if let (Some(&left), Some(&right)) = (
            definition.rgdxa.get(physical),
            definition.rgdxa.get(physical + 1),
        ) {
            paragraphs[paragraph_index].table_grid_left = left;
            paragraphs[paragraph_index].table_grid_right = right;
            paragraphs[paragraph_index].table_grid_bounds = definition.rgdxa.clone();
        }
        paragraphs[paragraph_index].table_cell_borders = cell.borders;
        paragraphs[paragraph_index].table_cell_borders_explicit = true;
        paragraphs[paragraph_index].table_cell_margins = cell.margins;
        paragraphs[paragraph_index].table_cell_preferred_width = if (flags >> 9) & 0x07 == 3 {
            cell.width
        } else {
            0
        };
        paragraphs[paragraph_index].table_cell_vertical_align = match (flags >> 7) & 0x03 {
            1 => "center",
            2 => "bottom",
            _ => "",
        };
        paragraphs[paragraph_index].table_cell_text_direction = if flags & 0x0004 != 0 {
            if flags & 0x0008 != 0 { "btLr" } else { "tbRl" }
        } else {
            ""
        };
        paragraphs[paragraph_index].table_cell_fit_text = flags & 0x1000 != 0;
        paragraphs[paragraph_index].table_cell_no_wrap = flags & 0x2000 != 0;
        if flags & WORD_BINARY_F_MERGED != 0 {
            if let Some(&previous_index) = logical_cells.last() {
                let (before, after) = paragraphs.split_at_mut(paragraph_index);
                append_word_binary_merged_cell(&mut before[previous_index], &mut after[0]);
                paragraphs[previous_index].table_grid_right =
                    paragraphs[paragraph_index].table_grid_right;
                paragraphs[paragraph_index].table_cell_merged = true;
                continue;
            }
        }
        logical_cells.push(paragraph_index);
        paragraphs[paragraph_index].table_grid_span = 1;
        paragraphs[paragraph_index].table_v_merge = if flags & WORD_BINARY_F_VERT_RESTART != 0 {
            "restart"
        } else if flags & WORD_BINARY_F_VERT_MERGE != 0 {
            "continue"
        } else {
            ""
        };
    }

    // A merged physical cell can carry the row terminator. Move it to the
    // logical owner so the writer closes the row at the right place.
    if let Some(&last_index) = cells.last()
        && paragraphs[last_index].table_row_end
        && let Some(&logical_index) = logical_cells.last()
    {
        paragraphs[logical_index].table_row_end = true;
    }
}

fn normalize_word_binary_table_grid_spans(paragraphs: &mut [DocxParagraph]) {
    let mut group = Vec::new();
    for index in 0..=paragraphs.len() {
        if index < paragraphs.len() && paragraphs[index].table_cell {
            group.push(index);
            continue;
        }
        if group.is_empty() {
            continue;
        }
        let mut bounds: Vec<i16> = group
            .iter()
            .flat_map(|index| paragraphs[*index].table_grid_bounds.iter().copied())
            .collect();
        bounds.sort_unstable();
        bounds.dedup();
        if bounds.len() >= 2 {
            let visible: Vec<usize> = group
                .iter()
                .copied()
                .filter(|index| !paragraphs[*index].table_cell_merged)
                .collect();
            for index in visible {
                let paragraph = &mut paragraphs[index];
                let Some(left) = bounds.binary_search(&paragraph.table_grid_left).ok() else {
                    continue;
                };
                let Some(right) = bounds.binary_search(&paragraph.table_grid_right).ok() else {
                    continue;
                };
                paragraph.table_grid_span = right.saturating_sub(left).max(1);
            }
        }
        group.clear();
    }
}

fn append_word_binary_merged_cell(target: &mut DocxParagraph, source: &mut DocxParagraph) {
    if !source.text.is_empty() {
        if !target.text.is_empty() {
            target.text.push(' ');
        }
        target.text.push_str(&source.text);
    }
    target.runs.append(&mut source.runs);
    extend_word_binary_source_range(target, source);
    target.table_grid_span = target.table_grid_span.saturating_add(1);
    if source.table_cell_borders_explicit {
        target.table_cell_borders[2] = source.table_cell_borders[2];
        target.table_cell_borders[3] = source.table_cell_borders[3];
        target.table_cell_borders_explicit = true;
    }
    target.table_cell_margins[2] = source.table_cell_margins[2];
    target.table_cell_margins[3] = source.table_cell_margins[3];
    if source.table_row_end {
        target.table_row_end = true;
        target.table_row_height = source.table_row_height;
        target.table_row_cant_split = source.table_row_cant_split;
        target.table_row_header = source.table_row_header;
        target.table_alignment = source.table_alignment;
        target.table_borders = source.table_borders;
    }
}

fn append_word_binary_cell_paragraph(target: &mut DocxParagraph, source: &mut DocxParagraph) {
    if !target.text.is_empty() && !source.text.is_empty() {
        target.text.push('\n');
        target.runs.push(DocxRun {
            text: "\n".into(),
            ..Default::default()
        });
    }
    target.text.push_str(&source.text);
    target.runs.append(&mut source.runs);
    extend_word_binary_source_range(target, source);
    target.table_cell_end = source.table_cell_end;
    target.table_row_end |= source.table_row_end;
    if source.table_row_end {
        target.table_row_height = source.table_row_height;
        target.table_row_cant_split = source.table_row_cant_split;
        target.table_row_header = source.table_row_header;
        target.table_alignment = source.table_alignment;
        target.table_borders = source.table_borders;
    }
}

fn extend_word_binary_source_range(target: &mut DocxParagraph, source: &DocxParagraph) {
    if source.source_cp_end > 0 {
        if target.source_cp_start == 0 {
            target.source_cp_start = source.source_cp_start;
        } else {
            target.source_cp_start = target.source_cp_start.min(source.source_cp_start);
        }
        target.source_cp_end = target.source_cp_end.max(source.source_cp_end);
    }
    if source.source_fc_end > 0 {
        if target.source_fc_start == 0 {
            target.source_fc_start = source.source_fc_start;
        } else {
            target.source_fc_start = target.source_fc_start.min(source.source_fc_start);
        }
        target.source_fc_end = target.source_fc_end.max(source.source_fc_end);
    }
}

fn apply_word_binary_prm0(props: &mut WordBinaryCharProps, prm: u16) {
    if prm & 1 != 0 {
        return;
    }
    let value = (prm >> 8) as u8;
    let enabled = match value {
        0 => false,
        1 => true,
        _ => return,
    };
    match ((prm >> 1) & 0x7f) as u8 {
        0x55 => props.bold = enabled,
        0x56 => props.italic = enabled,
        0x57 => props.strike = enabled,
        0x5a => props.small_caps = enabled,
        0x5b => props.caps = enabled,
        0x5c => props.hidden = enabled,
        _ => {}
    }
}

#[derive(Clone, Copy, Default)]
struct WordBinaryChpxEntry {
    fc_start: u32,
    fc_lim: u32,
    props: WordBinaryCharProps,
}

#[derive(Clone)]
struct WordBinaryPapxEntry {
    fc_start: u32,
    fc_lim: u32,
    props: WordBinaryParaProps,
}

fn parse_word_binary_chpx(
    document: &[u8],
    table: &[u8],
    fib: WordBinaryFib,
) -> Vec<WordBinaryChpxEntry> {
    let Some(plc) = table.get(fib.fc_chpx..fib.fc_chpx.saturating_add(fib.lcb_chpx)) else {
        return Vec::new();
    };
    if plc.len() < 12 || (plc.len() - 4) % 8 != 0 {
        return Vec::new();
    }
    let count = (plc.len() - 4) / 8;
    let pn_base = (count + 1) * 4;
    let mut entries = Vec::new();
    for index in 0..count {
        let Some(fc_start) = word_binary_u32(plc, index * 4) else {
            continue;
        };
        let Some(fc_lim) = word_binary_u32(plc, (index + 1) * 4) else {
            continue;
        };
        let Some(pn) = word_binary_u32(plc, pn_base + index * 4) else {
            continue;
        };
        let page_offset = (pn & 0x003f_ffff) as usize * 512;
        let Some(page) = document.get(page_offset..page_offset.saturating_add(512)) else {
            continue;
        };
        let run_count = *page.last().unwrap_or(&0) as usize;
        if run_count == 0 || run_count > 0x65 || 4 * (run_count + 1) + run_count > 511 {
            continue;
        }
        for run in 0..run_count {
            let Some(run_start) = word_binary_u32(page, run * 4) else {
                continue;
            };
            let Some(run_lim) = word_binary_u32(page, (run + 1) * 4) else {
                continue;
            };
            let start = run_start.max(fc_start);
            let lim = run_lim.min(fc_lim);
            if start >= lim {
                continue;
            }
            let rgb = 4 * (run_count + 1);
            let offset = page[rgb + run] as usize * 2;
            let props = if offset == 0 {
                WordBinaryCharProps::default()
            } else {
                parse_word_binary_chpx_props(page, offset).unwrap_or_default()
            };
            entries.push(WordBinaryChpxEntry {
                fc_start: start,
                fc_lim: lim,
                props,
            });
        }
    }
    entries.sort_by_key(|entry| entry.fc_start);
    entries
}

fn parse_word_binary_chpx_props(page: &[u8], offset: usize) -> Option<WordBinaryCharProps> {
    let cb = *page.get(offset)? as usize;
    let end = offset.checked_add(1)?.checked_add(cb)?;
    let group = page.get(offset + 1..end)?;
    let mut props = WordBinaryCharProps::default();
    let mut pos = 0;
    let mut special = false;
    while pos + 2 <= group.len() {
        let sprm = u16::from_le_bytes(group[pos..pos + 2].try_into().ok()?);
        let operand = pos + 2;
        let len = word_binary_sprm_operand_len(sprm, group, operand)?;
        let value = group.get(operand..operand + len)?;
        match sprm {
            0x0835 => props.bold = value.first().copied().is_some_and(|v| v == 1 || v == 0x81),
            0x0836 => props.italic = value.first().copied().is_some_and(|v| v == 1 || v == 0x81),
            0x0837 => props.strike = value.first().copied().is_some_and(|v| v == 1 || v == 0x81),
            0x083A => {
                props.small_caps = value.first().copied().is_some_and(|v| v == 1 || v == 0x81)
            }
            0x083B => props.caps = value.first().copied().is_some_and(|v| v == 1 || v == 0x81),
            0x083C => props.hidden = value.first().copied().is_some_and(|v| v == 1 || v == 0x81),
            0x085A => props.rtl = value.first().copied().is_some_and(|v| v == 1 || v == 0x81),
            0x2a3e => {
                let kind = value.first().copied().unwrap_or(0);
                props.underline = kind != 0;
                props.underline_style = word_binary_underline_style(kind);
            }
            0x4a43 => {
                props.font_size = u16::from_le_bytes(value.get(..2)?.try_into().ok()?) as usize
            }
            0x4a4f => {
                props.font_index = Some(u16::from_le_bytes(value.get(..2)?.try_into().ok()?));
            }
            0x2a48 => {
                props.vertical_align = match value.first().copied()? {
                    1 => "superscript",
                    2 => "subscript",
                    _ => "",
                }
            }
            0x6870 => {
                props.color = Some([value[0], value[1], value[2]]);
            }
            0x2a42 => {
                props.color = word_binary_palette_color(value.first().copied().unwrap_or(0));
            }
            0x2a0c => {
                props.highlight = word_binary_palette_color(value.first().copied().unwrap_or(0));
            }
            0x0855 => special = value.first().copied().unwrap_or(0) != 0,
            0x6a03 if value.len() >= 4 => {
                props.picture_offset = Some(u32::from_le_bytes(value[..4].try_into().ok()?));
            }
            _ => {}
        }
        pos += 2 + len;
    }
    if !special {
        props.picture_offset = None;
    }
    Some(props)
}

fn parse_word_binary_papx(
    document: &[u8],
    table: &[u8],
    fib: WordBinaryFib,
    styles: &[WordBinaryParaProps],
) -> Vec<WordBinaryPapxEntry> {
    let Some(plc) = table.get(fib.fc_papx..fib.fc_papx.saturating_add(fib.lcb_papx)) else {
        return Vec::new();
    };
    if plc.len() < 12 || (plc.len() - 4) % 8 != 0 {
        return Vec::new();
    }
    let count = (plc.len() - 4) / 8;
    let pn_base = (count + 1) * 4;
    let mut entries = Vec::new();
    for index in 0..count {
        let Some(fc_start) = word_binary_u32(plc, index * 4) else {
            continue;
        };
        let Some(fc_lim) = word_binary_u32(plc, (index + 1) * 4) else {
            continue;
        };
        let Some(pn) = word_binary_u32(plc, pn_base + index * 4) else {
            continue;
        };
        let page_offset = (pn & 0x003f_ffff) as usize * 512;
        let Some(page) = document.get(page_offset..page_offset.saturating_add(512)) else {
            continue;
        };
        let run_count = *page.last().unwrap_or(&0) as usize;
        if run_count == 0 || run_count > 0x3f || 4 * (run_count + 1) + 13 * run_count > 511 {
            continue;
        }
        for run in 0..run_count {
            let Some(run_start) = word_binary_u32(page, run * 4) else {
                continue;
            };
            let Some(run_lim) = word_binary_u32(page, (run + 1) * 4) else {
                continue;
            };
            let bx = 4 * (run_count + 1) + run * 13;
            let offset = page[bx] as usize * 2;
            let props = if offset == 0 {
                WordBinaryParaProps::default()
            } else {
                parse_word_binary_papx_props(page, offset, styles).unwrap_or_default()
            };
            entries.push(WordBinaryPapxEntry {
                fc_start: run_start.max(fc_start),
                fc_lim: run_lim.min(fc_lim),
                props,
            });
        }
    }
    entries.sort_by_key(|entry| entry.fc_lim);
    entries
}

fn parse_word_binary_papx_props(
    page: &[u8],
    offset: usize,
    styles: &[WordBinaryParaProps],
) -> Option<WordBinaryParaProps> {
    let first = *page.get(offset)? as usize;
    let (data_offset, data_len) = if first != 0 {
        (offset + 1, first * 2 - 1)
    } else {
        let second = *page.get(offset + 1)? as usize;
        (offset + 2, second * 2)
    };
    let data = page.get(data_offset..data_offset.checked_add(data_len)?)?;
    let style_id = u16::from_le_bytes(data.get(..2)?.try_into().ok()?);
    let group = data.get(2..).unwrap_or_default();
    let mut props = styles.get(style_id as usize).cloned().unwrap_or_default();
    props.style_id = style_id;
    let mut pos = 0;
    while pos + 2 <= group.len() {
        let sprm = u16::from_le_bytes(group[pos..pos + 2].try_into().ok()?);
        let operand = pos + 2;
        let len = word_binary_sprm_operand_len(sprm, group, operand)?;
        let value = group.get(operand..operand + len)?;
        match sprm {
            0x2416 => props.table_cell = value.first().copied().unwrap_or(0) != 0,
            0x2417 => props.table_row_end = value.first().copied().unwrap_or(0) != 0,
            0x3403 => props.table_row_cant_split = value.first().copied().unwrap_or(0) != 0,
            0x3404 => props.table_row_header = value.first().copied().unwrap_or(0) != 0,
            0x5400 => {
                props.table_alignment = match u16::from_le_bytes(value.get(..2)?.try_into().ok()?) {
                    1 => "center",
                    2 => "right",
                    _ => "left",
                };
            }
            0xd605 => props.table_borders = parse_word_binary_table_borders(value),
            0xd634 => {
                if let Some(padding) = parse_word_binary_cell_padding(value) {
                    props.table_cell_padding_ops.push(padding);
                }
            }
            0x9407 => {
                props.table_row_height = i16::from_le_bytes(value.get(..2)?.try_into().ok()?);
            }
            0x2405 => props.keep_lines = value.first().copied().unwrap_or(0) != 0,
            0x2406 => props.keep_next = value.first().copied().unwrap_or(0) != 0,
            0x2407 => props.page_break_before = value.first().copied().unwrap_or(0) != 0,
            0x2441 => props.bidi = value.first().copied().unwrap_or(0) != 0,
            0xD608 => props.table_def = parse_word_binary_table_def(value),
            0x2403 => props.alignment = word_binary_physical_alignment(value.first().copied()?),
            0x2461 => props.alignment = word_binary_logical_alignment(value.first().copied()?),
            0xA413 => {
                props.spacing_before = u16::from_le_bytes(value.get(..2)?.try_into().ok()?);
                props.spacing_before_explicit = true;
            }
            0xA414 => {
                props.spacing_after = u16::from_le_bytes(value.get(..2)?.try_into().ok()?);
                props.spacing_after_explicit = true;
            }
            0x6412 => {
                if let Some((line, rule)) = parse_word_binary_line_spacing(value) {
                    props.line_spacing = line;
                    props.line_spacing_rule = rule;
                }
            }
            0x845D => {
                props.indent_right = i16::from_le_bytes(value.get(..2)?.try_into().ok()?);
            }
            0x845E => {
                props.indent_left = i16::from_le_bytes(value.get(..2)?.try_into().ok()?);
            }
            0x465F => {
                let nest = i16::from_le_bytes(value.get(..2)?.try_into().ok()?);
                props.indent_left = props.indent_left.saturating_add(nest);
            }
            0x8460 => {
                props.first_line_indent = i16::from_le_bytes(value.get(..2)?.try_into().ok()?);
            }
            0x442D => {
                if let Some(color) = parse_word_binary_shading80(value) {
                    props.shading = color;
                }
            }
            0xC64D => {
                if let Some(color) = parse_word_binary_shading_operand(value) {
                    props.shading = color;
                }
            }
            0x2640 => {
                let level = value.first().copied().unwrap_or(9);
                if level < 9 {
                    props.heading_level = usize::from(level) + 1;
                }
            }
            0x260a => props.list_level = value.first().copied().unwrap_or(0) as usize,
            0x460b => {
                let list_id = u16::from_le_bytes(value.get(..2)?.try_into().ok()?);
                props.list_id = usize::from(list_id);
                if list_id != 0 {
                    props.list_kind = "decimal";
                }
            }
            _ => {}
        }
        pos += 2 + len;
    }
    if let Some(definition) = props.table_def.as_mut() {
        for padding in props.table_cell_padding_ops.iter().copied() {
            apply_word_binary_cell_padding(definition, padding);
        }
    }
    Some(props)
}

fn parse_word_binary_stylesheet(table: &[u8], fib: WordBinaryFib) -> Vec<WordBinaryParaProps> {
    let Some(stsh) = table.get(fib.fc_stshf..fib.fc_stshf.saturating_add(fib.lcb_stshf)) else {
        return Vec::new();
    };
    let (Some(cb_stshi), Some(style_count), Some(base_len)) = (
        word_binary_u16(stsh, 0).map(usize::from),
        word_binary_u16(stsh, 2).map(usize::from),
        word_binary_u16(stsh, 4).map(usize::from),
    ) else {
        return Vec::new();
    };
    let base_len = match base_len {
        10 | 18 => base_len,
        _ => return Vec::new(),
    };
    let mut pos = 2usize.saturating_add(cb_stshi);
    let mut styles = Vec::with_capacity(style_count.min(8192));
    let mut bases = Vec::with_capacity(style_count.min(8192));
    for style_index in 0..style_count.min(8192) {
        let Some(cb_bytes) = stsh.get(pos..pos.saturating_add(2)) else {
            break;
        };
        let cb = usize::from(u16::from_le_bytes(
            cb_bytes.try_into().ok().unwrap_or([0, 0]),
        ));
        pos = pos.saturating_add(2);
        if cb == 0 {
            styles.push(WordBinaryParaProps::default());
            bases.push(0x0fff);
            continue;
        }
        let Some(std) = stsh.get(pos..pos.saturating_add(cb)) else {
            break;
        };
        pos = pos.saturating_add(cb);
        let sti = word_binary_u16(std, 0).unwrap_or(0) & 0x0fff;
        let grf = word_binary_u16(std, 2).unwrap_or(0);
        let style_base = (grf >> 4) & 0x0fff;
        let style_kind = grf & 0x000f;
        let mut props = WordBinaryParaProps {
            style_id: style_index as u16,
            heading_level: (1..=9)
                .contains(&sti)
                .then_some(usize::from(sti))
                .unwrap_or(0),
            ..WordBinaryParaProps::default()
        };
        bases.push(style_base);
        if style_kind != 1 || std.len() <= base_len as usize {
            styles.push(props);
            continue;
        }
        let Some(name_len_bytes) = std.get(base_len as usize..base_len as usize + 2) else {
            styles.push(props);
            continue;
        };
        let name_len = usize::from(u16::from_le_bytes(
            name_len_bytes.try_into().ok().unwrap_or([0, 0]),
        ));
        let name_start = base_len as usize + 2;
        let name_end = name_start.saturating_add(name_len.saturating_mul(2));
        let Some(name_bytes) = std.get(name_start..name_end) else {
            styles.push(props);
            continue;
        };
        if props.heading_level == 0 {
            props.heading_level = word_binary_heading_level_from_name(&String::from_utf16_lossy(
                &name_bytes
                    .chunks_exact(2)
                    .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                    .collect::<Vec<_>>(),
            ));
        }
        let mut upx_pos = name_end.saturating_add(2);
        let Some(upx_len_bytes) = std.get(upx_pos..upx_pos.saturating_add(2)) else {
            styles.push(props);
            continue;
        };
        let upx_len = usize::from(u16::from_le_bytes(
            upx_len_bytes.try_into().ok().unwrap_or([0, 0]),
        ));
        upx_pos = upx_pos.saturating_add(2);
        let Some(upx) = std.get(upx_pos..upx_pos.saturating_add(upx_len)) else {
            styles.push(props);
            continue;
        };
        if upx.len() >= 2 {
            props = parse_word_binary_style_group(&upx[2..], props);
        }
        styles.push(props);
    }
    for index in 0..styles.len() {
        let mut base = bases.get(index).copied().unwrap_or(0x0fff);
        let mut depth = 0;
        while base != 0x0fff && depth < 64 {
            let Some(parent) = styles.get(base as usize).cloned() else {
                break;
            };
            let style = &mut styles[index];
            if style.heading_level == 0 {
                style.heading_level = parent.heading_level;
            }
            if style.alignment.is_empty() {
                style.alignment = parent.alignment;
            }
            if style.spacing_before == 0 {
                style.spacing_before = parent.spacing_before;
            }
            if style.spacing_after == 0 {
                style.spacing_after = parent.spacing_after;
            }
            if style.line_spacing == 0 {
                style.line_spacing = parent.line_spacing;
                style.line_spacing_rule = parent.line_spacing_rule;
            }
            if style.indent_left == 0 {
                style.indent_left = parent.indent_left;
            }
            if style.indent_right == 0 {
                style.indent_right = parent.indent_right;
            }
            if style.first_line_indent == 0 {
                style.first_line_indent = parent.first_line_indent;
            }
            if style.shading.is_empty() {
                style.shading = parent.shading;
            }
            base = bases.get(base as usize).copied().unwrap_or(0x0fff);
            depth += 1;
        }
    }
    styles
}

fn parse_word_binary_style_group(
    group: &[u8],
    mut props: WordBinaryParaProps,
) -> WordBinaryParaProps {
    let mut pos = 0usize;
    while pos + 2 <= group.len() {
        let sprm = u16::from_le_bytes([group[pos], group[pos + 1]]);
        let operand = pos + 2;
        let Some(len) = word_binary_sprm_operand_len(sprm, group, operand) else {
            break;
        };
        let Some(value) = group.get(operand..operand.saturating_add(len)) else {
            break;
        };
        match sprm {
            0x2405 => props.keep_lines = value[0] != 0,
            0x2406 => props.keep_next = value[0] != 0,
            0x2407 => props.page_break_before = value[0] != 0,
            0x2441 => props.bidi = value[0] != 0,
            0x2403 => {
                props.alignment = if value[0] == 0 {
                    ""
                } else {
                    word_binary_physical_alignment(value[0])
                }
            }
            0x2461 => {
                props.alignment = if value[0] == 0 {
                    ""
                } else {
                    word_binary_logical_alignment(value[0])
                }
            }
            0xA413 => {
                props.spacing_before = u16::from_le_bytes(value[..2].try_into().unwrap_or([0, 0]))
            }
            0xA414 => {
                props.spacing_after = u16::from_le_bytes(value[..2].try_into().unwrap_or([0, 0]))
            }
            0x6412 => {
                if let Some((line, rule)) = parse_word_binary_line_spacing(value) {
                    props.line_spacing = line;
                    props.line_spacing_rule = rule;
                }
            }
            0x845D => {
                props.indent_right = i16::from_le_bytes(value[..2].try_into().unwrap_or([0, 0]))
            }
            0x845E => {
                props.indent_left = i16::from_le_bytes(value[..2].try_into().unwrap_or([0, 0]))
            }
            0x465F => {
                props.indent_left = props
                    .indent_left
                    .saturating_add(i16::from_le_bytes(value[..2].try_into().unwrap_or([0, 0])))
            }
            0x8460 => {
                props.first_line_indent =
                    i16::from_le_bytes(value[..2].try_into().unwrap_or([0, 0]))
            }
            0x442D => {
                if let Some(color) = parse_word_binary_shading80(value) {
                    props.shading = color;
                }
            }
            0xC64D => {
                if let Some(color) = parse_word_binary_shading_operand(value) {
                    props.shading = color;
                }
            }
            0x2640 => {
                let level = value[0];
                if level < 9 {
                    props.heading_level = usize::from(level) + 1;
                }
            }
            _ => {}
        }
        pos = operand.saturating_add(len);
    }
    props
}

fn word_binary_heading_level_from_name(name: &str) -> usize {
    let lower = name.trim().to_ascii_lowercase();
    let digits = lower
        .strip_prefix("heading ")
        .or_else(|| lower.strip_prefix("title "))
        .and_then(|value| value.parse::<usize>().ok());
    digits.filter(|level| (1..=9).contains(level)).unwrap_or(0)
}

fn word_binary_physical_alignment(value: u8) -> &'static str {
    match value {
        0 => "left",
        1 => "center",
        2 => "right",
        3..=5 => "both",
        _ => "",
    }
}

fn word_binary_logical_alignment(value: u8) -> &'static str {
    match value {
        0 => "left",
        1 => "center",
        2 => "right",
        3..=5 | 7..=9 => "both",
        _ => "",
    }
}

fn parse_word_binary_line_spacing(value: &[u8]) -> Option<(u16, &'static str)> {
    let line = u16::from_le_bytes(value.get(..2)?.try_into().ok()?);
    let multiple = u16::from_le_bytes(value.get(2..4)?.try_into().ok()?);
    if multiple > 1 {
        return None;
    }
    if line >= 0x8440 {
        return Some((u16::MAX - line + 1, "exact"));
    }
    if line == 0 || line > 0x7BC0 {
        return None;
    }
    Some((line, if multiple == 0 { "atLeast" } else { "auto" }))
}

fn parse_word_binary_shading80(value: &[u8]) -> Option<String> {
    let raw = u16::from_le_bytes(value.get(..2)?.try_into().ok()?);
    if raw == u16::MAX {
        return None;
    }
    let foreground = word_binary_palette_color((raw & 0x1F) as u8);
    let background = word_binary_palette_color(((raw >> 5) & 0x1F) as u8);
    let pattern = (raw >> 10) & 0x3F;
    let color = match pattern {
        0 => background,
        1 => foreground,
        _ if foreground.is_some() && foreground == background => foreground,
        _ => None,
    }?;
    Some(word_binary_rgb_hex(color))
}

fn parse_word_binary_shading_operand(value: &[u8]) -> Option<String> {
    if value.len() != 11 || value.first().copied() != Some(10) {
        return None;
    }
    let foreground = if value[4] == 0 {
        Some([value[1], value[2], value[3]])
    } else {
        None
    };
    let background = if value[8] == 0 {
        Some([value[5], value[6], value[7]])
    } else {
        None
    };
    let pattern = u16::from_le_bytes([value[9], value[10]]);
    let color = match pattern {
        0 => background,
        1 => foreground,
        _ if foreground.is_some() && foreground == background => foreground,
        _ => None,
    }?;
    Some(word_binary_rgb_hex(color))
}

fn parse_word_binary_table_def(operand: &[u8]) -> Option<WordBinaryTableDef> {
    let declared = usize::from(u16::from_le_bytes([*operand.first()?, *operand.get(1)?]));
    if declared == 0 || operand.len() != declared.saturating_add(1) {
        return None;
    }
    let cell_count = usize::from(*operand.get(2)?);
    if cell_count == 0 || cell_count > 63 {
        return None;
    }
    let boundaries_start = 3usize;
    let boundaries_len = cell_count.checked_add(1)?.checked_mul(2)?;
    let cells_start = boundaries_start.checked_add(boundaries_len)?;
    let cells_end = cells_start.checked_add(cell_count.checked_mul(20)?)?;
    if cells_start > operand.len() || cells_end > operand.len() {
        return None;
    }
    let mut rgdxa = Vec::with_capacity(cell_count + 1);
    for index in 0..=cell_count {
        let offset = boundaries_start + index * 2;
        rgdxa.push(i16::from_le_bytes([
            *operand.get(offset)?,
            *operand.get(offset + 1)?,
        ]));
    }
    if rgdxa.windows(2).any(|pair| pair[0] > pair[1]) {
        return None;
    }
    let mut cells = Vec::with_capacity(cell_count);
    for index in 0..cell_count {
        let offset = cells_start + index * 20;
        let flags = u16::from_le_bytes([*operand.get(offset)?, *operand.get(offset + 1)?]);
        let width = u16::from_le_bytes([*operand.get(offset + 2)?, *operand.get(offset + 3)?]);
        let mut borders = [None; 4];
        for (border_index, border) in borders.iter_mut().enumerate() {
            let border_offset = offset + 4 + border_index * 4;
            *border =
                parse_word_binary_page_border(operand.get(border_offset..border_offset + 4)?, 8);
        }
        cells.push(WordBinaryTableCellDef {
            flags,
            width,
            borders,
            margins: [None; 4],
        });
    }
    Some(WordBinaryTableDef { rgdxa, cells })
}

fn word_binary_u32(data: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        data.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn word_binary_u16(data: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        data.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn word_binary_sprm_operand_len(sprm: u16, data: &[u8], offset: usize) -> Option<usize> {
    if sprm == 0xD608 {
        let cb = usize::from(u16::from_le_bytes(
            data.get(offset..offset + 2)?.try_into().ok()?,
        ));
        return (cb != 0).then_some(cb + 1);
    }
    match (sprm >> 13) & 7 {
        0 | 1 => Some(1),
        2 | 4 | 5 => Some(2),
        3 => Some(4),
        7 => Some(3),
        6 => Some(1 + usize::from(*data.get(offset)?)),
        _ => None,
    }
}

fn word_binary_chpx_at(entries: &[WordBinaryChpxEntry], fc: u32) -> WordBinaryCharProps {
    entries
        .iter()
        .rev()
        .find(|entry| entry.fc_start <= fc && fc < entry.fc_lim)
        .map_or_else(WordBinaryCharProps::default, |entry| entry.props)
}

fn word_binary_papx_at(entries: &[WordBinaryPapxEntry], fc: u32) -> WordBinaryParaProps {
    entries
        .iter()
        .find(|entry| entry.fc_start <= fc && fc < entry.fc_lim)
        .map_or_else(WordBinaryParaProps::default, |entry| entry.props.clone())
}

fn word_binary_rgb_hex(rgb: [u8; 3]) -> String {
    format!("{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2])
}

fn word_binary_palette_color(index: u8) -> Option<[u8; 3]> {
    match index {
        1 => Some([0, 0, 0]),
        2 => Some([0, 0, 255]),
        3 => Some([0, 255, 255]),
        4 => Some([0, 255, 0]),
        5 => Some([255, 0, 255]),
        6 => Some([255, 0, 0]),
        7 => Some([255, 255, 0]),
        8 => Some([255, 255, 255]),
        9 => Some([0, 0, 128]),
        10 => Some([0, 128, 128]),
        11 => Some([0, 128, 0]),
        12 => Some([128, 0, 128]),
        13 => Some([128, 0, 0]),
        14 => Some([128, 128, 0]),
        15 => Some([128, 128, 128]),
        16 => Some([192, 192, 192]),
        _ => None,
    }
}

fn word_binary_underline_style(kind: u8) -> &'static str {
    match kind {
        1 => "single",
        2 => "words",
        3 => "double",
        4 => "dotted",
        5 => "thick",
        6 => "dash",
        7 => "dotDash",
        8 => "dotDotDash",
        9 => "wave",
        10 => "dottedHeavy",
        11 => "dashHeavy",
        12 => "dashLongHeavy",
        13 => "dotDashHeavy",
        14 => "dotDotDashHeavy",
        15 => "waveHeavy",
        16 => "wavyDouble",
        _ => "",
    }
}

fn extract_word_binary_image(data: &[u8], start: usize) -> Option<DocxImage> {
    let limit = data.len().min(start.saturating_add(16 << 20));
    let (region_start, region_end) = match (
        data.get(start..start.saturating_add(8)),
        data.get(start..start.saturating_add(8))
            .and_then(|header| header[..4].try_into().ok())
            .map(u32::from_le_bytes),
    ) {
        (Some(header), Some(lcb)) => {
            let cb_header = usize::from(u16::from_le_bytes([header[4], header[5]]));
            let payload_start = start.saturating_add(cb_header);
            let payload_end = start.saturating_add(usize::try_from(lcb).ok()?).min(limit);
            if cb_header >= 8 && payload_start <= payload_end {
                (payload_start, payload_end)
            } else {
                (start, limit)
            }
        }
        _ => (start, limit),
    };
    let bytes = data.get(region_start..region_end)?;
    let (offset, extension, content_type) = find_word_binary_raster(bytes)?;
    let from = &bytes[offset..];
    let image_end = match extension {
        "png" => from
            .windows(8)
            .position(|window| window == [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
            .map(|value| value + 8)
            .unwrap_or(from.len()),
        "jpeg" => from
            .windows(2)
            .position(|window| window == [0xff, 0xd9])
            .map(|value| value + 2)
            .unwrap_or(from.len()),
        "gif" => from
            .iter()
            .position(|byte| *byte == 0x3b)
            .map(|value| value + 1)
            .unwrap_or(from.len()),
        "webp" => from
            .get(4..8)
            .and_then(|bytes| bytes.try_into().ok())
            .map(u32::from_le_bytes)
            .and_then(|size| usize::try_from(size).ok())
            .map(|size| size.saturating_add(8).min(from.len()))
            .unwrap_or(from.len()),
        "emf" => from
            .get(48..52)
            .and_then(|bytes| bytes.try_into().ok())
            .map(u32::from_le_bytes)
            .and_then(|size| usize::try_from(size).ok())
            .filter(|size| *size >= 88)
            .map(|size| size.min(from.len()))
            .unwrap_or(from.len()),
        "wmf" => word_binary_wmf_size(from)
            .unwrap_or(from.len())
            .min(from.len()),
        _ => from.len(),
    };
    let image = from[..image_end].to_vec();
    let (width, height) = if extension == "png" && image.len() >= 24 {
        (
            u32::from_be_bytes(image[16..20].try_into().ok()?),
            u32::from_be_bytes(image[20..24].try_into().ok()?),
        )
    } else if extension == "jpeg" {
        word_binary_jpeg_dimensions(&image).unwrap_or((800, 600))
    } else if extension == "gif" && image.len() >= 10 {
        (
            u32::from(u16::from_le_bytes([image[6], image[7]])),
            u32::from(u16::from_le_bytes([image[8], image[9]])),
        )
    } else if extension == "emf" {
        word_binary_emf_dimensions(&image).unwrap_or((800, 600))
    } else if extension == "wmf" {
        word_binary_wmf_dimensions(&image).unwrap_or((800, 600))
    } else {
        (800, 600)
    };
    Some(DocxImage {
        data: image,
        extension,
        content_type,
        width_emu: u64::from(width).saturating_mul(9525),
        height_emu: u64::from(height).saturating_mul(9525),
        ..Default::default()
    })
}

fn find_word_binary_raster(bytes: &[u8]) -> Option<(usize, &'static str, &'static str)> {
    if let Some(offset) = bytes
        .windows(4)
        .enumerate()
        .find_map(|(signature, window)| {
            if window != [0x20, b'E', b'M', b'F'] || signature < 40 {
                return None;
            }
            let start = signature - 40;
            let header = bytes.get(start..start.saturating_add(52))?;
            if header.get(..4) != Some(&[1, 0, 0, 0]) {
                return None;
            }
            let size = u32::from_le_bytes(header[48..52].try_into().ok()?) as usize;
            (size >= 88 && start.saturating_add(size) <= bytes.len()).then_some(start)
        })
    {
        return Some((offset, "emf", "image/x-emf"));
    }
    if let Some(offset) = bytes
        .windows(4)
        .position(|window| window == [0xd7, 0xcd, 0xc6, 0x9a])
    {
        if word_binary_wmf_size(&bytes[offset..]).is_some() {
            return Some((offset, "wmf", "image/x-wmf"));
        }
    }
    if let Some(offset) = bytes.windows(10).enumerate().find_map(|(offset, header)| {
        if !matches!(header.get(..2), Some([1, 0] | [2, 0]))
            || u16::from_le_bytes(header[2..4].try_into().ok()?) != 9
        {
            return None;
        }
        word_binary_wmf_size(&bytes[offset..]).map(|_| offset)
    }) {
        return Some((offset, "wmf", "image/x-wmf"));
    }
    let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if let Some(offset) = bytes.windows(png.len()).position(|window| window == png) {
        return Some((offset, "png", "image/png"));
    }
    if let Some(offset) = bytes.windows(4).position(|window| window == b"GIF8") {
        return Some((offset, "gif", "image/gif"));
    }
    if let Some(offset) = bytes
        .windows(4)
        .position(|window| window == b"RIFF")
        .filter(|offset| bytes.get(offset + 8..offset + 12) == Some(b"WEBP"))
    {
        return Some((offset, "webp", "image/webp"));
    }
    let offset = bytes.windows(4).position(|window| {
        window[0] == 0xff && window[1] == 0xd8 && window[2] == 0xff && window[3] >= 0xc0
    })?;
    Some((offset, "jpeg", "image/jpeg"))
}

fn word_binary_wmf_size(data: &[u8]) -> Option<usize> {
    let file_size_words = if data.get(..4) == Some(&[0xd7, 0xcd, 0xc6, 0x9a]) {
        u32::from_le_bytes(data.get(28..32)?.try_into().ok()?)
    } else {
        if !matches!(data.get(..2), Some([1, 0] | [2, 0]))
            || u16::from_le_bytes(data.get(2..4)?.try_into().ok()?) != 9
        {
            return None;
        }
        u32::from_le_bytes(data.get(6..10)?.try_into().ok()?)
    };
    let size = usize::try_from(file_size_words).ok()?.checked_mul(2)?;
    (size >= 18 && size <= data.len()).then_some(size)
}

fn word_binary_emf_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let left = i32::from_le_bytes(data.get(24..28)?.try_into().ok()?);
    let top = i32::from_le_bytes(data.get(28..32)?.try_into().ok()?);
    let right = i32::from_le_bytes(data.get(32..36)?.try_into().ok()?);
    let bottom = i32::from_le_bytes(data.get(36..40)?.try_into().ok()?);
    let width = u32::try_from(right.saturating_sub(left)).ok()?.max(1);
    let height = u32::try_from(bottom.saturating_sub(top)).ok()?.max(1);
    Some((width.saturating_mul(360), height.saturating_mul(360)))
}

fn word_binary_wmf_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.get(..4) != Some(&[0xd7, 0xcd, 0xc6, 0x9a]) {
        return None;
    }
    let left = i16::from_le_bytes(data.get(6..8)?.try_into().ok()?);
    let top = i16::from_le_bytes(data.get(8..10)?.try_into().ok()?);
    let right = i16::from_le_bytes(data.get(10..12)?.try_into().ok()?);
    let bottom = i16::from_le_bytes(data.get(12..14)?.try_into().ok()?);
    let inch = u16::from_le_bytes(data.get(14..16)?.try_into().ok()?);
    if inch == 0 {
        return None;
    }
    let width = u32::try_from(i32::from(right).saturating_sub(i32::from(left))).ok()?;
    let height = u32::try_from(i32::from(bottom).saturating_sub(i32::from(top))).ok()?;
    Some((
        width.saturating_mul(914_400) / u32::from(inch),
        height.saturating_mul(914_400) / u32::from(inch),
    ))
}

fn word_binary_jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut offset = 2;
    while offset + 9 < data.len() {
        if data[offset] != 0xff {
            offset += 1;
            continue;
        }
        let marker = data[offset + 1];
        let length = u16::from_be_bytes(data[offset + 2..offset + 4].try_into().ok()?) as usize;
        if (0xc0..=0xc3).contains(&marker) && length >= 7 {
            let height = u16::from_be_bytes(data[offset + 5..offset + 7].try_into().ok()?);
            let width = u16::from_be_bytes(data[offset + 7..offset + 9].try_into().ok()?);
            return Some((u32::from(width), u32::from(height)));
        }
        offset = offset.saturating_add(2 + length);
    }
    None
}

fn visible_list_marker(text: &str) -> Option<(&'static str, &str)> {
    let text = text.trim_start();
    for marker in ["•", "·", "-", "*", "–", "—"] {
        if let Some(item) = text.strip_prefix(marker) {
            let first = item.chars().next()?;
            if first.is_whitespace() || first.is_alphabetic() {
                let item = item.trim();
                if !item.is_empty() {
                    return Some(("bullet", item));
                }
            }
        }
    }
    let marker_end = text.bytes().take_while(u8::is_ascii_digit).count();
    if (1..=3).contains(&marker_end) {
        let rest = &text[marker_end..];
        if let Some(item) = rest
            .strip_prefix(". ")
            .or_else(|| rest.strip_prefix(") "))
            .or_else(|| rest.strip_prefix(".\t"))
            .or_else(|| rest.strip_prefix(")\t"))
        {
            if !item.trim().is_empty() {
                return Some(("decimal", item.trim()));
            }
        }
    }
    if text.len() >= 3 && text.as_bytes()[0].is_ascii_alphabetic() {
        let rest = &text[1..];
        if let Some(item) = rest
            .strip_prefix(". ")
            .or_else(|| rest.strip_prefix(") "))
            .or_else(|| rest.strip_prefix(".\t"))
            .or_else(|| rest.strip_prefix(")\t"))
        {
            if !item.trim().is_empty() {
                return Some(("decimal", item.trim()));
            }
        }
    }
    None
}

fn word_binary_heading(text: &str) -> bool {
    if text.is_empty() || text.chars().count() > 80 || text.contains(['\n', '\t']) {
        return false;
    }
    let lower = text.to_lowercase();
    if ["chapter ", "section ", "part ", "heading ", "title:"]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
        return true;
    }
    if text.ends_with(['.', ',', ';', ':']) {
        return false;
    }
    let letters: Vec<_> = text
        .chars()
        .filter(|character| character.is_alphabetic())
        .collect();
    letters.len() >= 3 && letters.iter().all(|character| !character.is_lowercase())
}

fn extract_msg_paragraphs(input: &[u8]) -> Result<Vec<DocxParagraph>, ConvertError> {
    if input.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(Vec::new());
    }
    let file = CompoundFile::parse(input)
        .map_err(|error| parse_error(format!("open MSG compound file: {}", error.message)))?;
    let mut values = HashMap::new();
    for entry in file
        .entries
        .iter()
        .filter(|entry| entry.kind == 2 && entry.size > 0)
    {
        let Some((property, encoding)) = parse_msg_text_property_name(&entry.name) else {
            continue;
        };
        if values.contains_key(property) {
            continue;
        }
        if let Ok(data) = file.read_stream(entry) {
            values.insert(property, decode_msg_text_property(&data, encoding));
        }
    }

    let mut paragraphs = Vec::new();
    for (property, label) in [
        ("0037", "Subject"),
        ("0C1A", "From"),
        ("0C1F", "From"),
        ("0E04", "To"),
        ("0E03", "CC"),
    ] {
        if let Some(value) = values.get(property).filter(|value| !value.is_empty()) {
            paragraphs.push(text_paragraph(format!("{label}: {value}")));
        }
    }
    if let Some(body) = values.get("1000").filter(|value| !value.is_empty()) {
        paragraphs.extend(plain_docx_paragraphs(body));
    }
    if paragraphs.is_empty() {
        return Err(parse_error(
            "MSG file has no readable text properties".into(),
        ));
    }
    paragraphs.truncate(MAX_TEXT_PARAGRAPHS);
    Ok(paragraphs)
}

fn parse_msg_text_property_name(name: &str) -> Option<(&'static str, &'static str)> {
    // ponytail: top-level text MAPI properties only; walk recipients/attachments when previews need it.
    let name = name
        .trim_matches(char::is_control)
        .trim()
        .to_ascii_uppercase();
    let value = name.strip_prefix("__SUBSTG1.0_")?;
    if value.len() < 8 {
        return None;
    }
    let property = match &value[..4] {
        "0037" => "0037",
        "0C1A" => "0C1A",
        "0C1F" => "0C1F",
        "0E03" => "0E03",
        "0E04" => "0E04",
        "1000" => "1000",
        _ => return None,
    };
    let encoding = match &value[4..8] {
        "001F" => "001F",
        "001E" => "001E",
        _ => return None,
    };
    Some((property, encoding))
}

fn decode_msg_text_property(data: &[u8], encoding: &str) -> String {
    let text = match encoding {
        "001F" => decode_utf16(data, true),
        "001E" => data.iter().map(|byte| windows_1252_char(*byte)).collect(),
        _ => return String::new(),
    };
    normalize_plain_text_line(text.trim_end_matches('\0'))
}

fn normalize_plain_text_line(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(normalize_text_line)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn convert_odf(input: &str, output: &str, source: &str, target: &str) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(input).map_err(|error| io_error(format!("stat ODF input: {error}")))?;
    if metadata.len() > MAX_PACKAGE_BYTES {
        return Err(io_error(
            "ODF input is too large for the lightweight backend".into(),
        ));
    }
    let content = if source.starts_with('f') {
        let bytes =
            fs::read(input).map_err(|error| io_error(format!("read ODF input: {error}")))?;
        decode_text(&bytes)
    } else {
        let file =
            File::open(input).map_err(|error| parse_error(format!("open ODF package: {error}")))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|error| parse_error(format!("open ODF package: {error}")))?;
        read_odf_content(&mut archive)?
    };
    match target {
        "docx" => write_docx(output, &parse_odf_text(&content)?),
        "xlsx" => {
            let sheets = parse_odf_sheets(&content)?;
            let borrowed = sheets
                .iter()
                .map(|(name, rows)| (name.as_str(), rows.as_slice()))
                .collect::<Vec<_>>();
            write_xlsx_sheets(output, &borrowed)
        }
        "pptx" => write_pptx(output, &parse_odf_slides(&content)?),
        _ => Err(parse_error(format!("unsupported ODF target: {target}"))),
    }
}

fn read_odf_content(archive: &mut ZipArchive<File>) -> Result<String, ConvertError> {
    if archive.len() > MAX_PACKAGE_ENTRIES {
        return Err(parse_error("ODF package has too many entries".into()));
    }
    let mut entry = archive
        .by_name("content.xml")
        .map_err(|error| parse_error(format!("read ODF content.xml: {error}")))?;
    if entry.size() > MAX_ENTRY_BYTES {
        return Err(parse_error("ODF content.xml is too large".into()));
    }
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| parse_error(format!("read ODF content.xml: {error}")))?;
    Ok(decode_text(&bytes))
}

fn parse_odf_text(content: &str) -> Result<Vec<DocxParagraph>, ConvertError> {
    let mut reader = Reader::from_str(content);
    let mut paragraphs = Vec::new();
    let mut block = String::new();
    let mut heading = 0usize;
    let mut list_depth = 0usize;
    let mut in_paragraph = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(value)) => match local_name(value.name().as_ref()) {
                b"list" => list_depth += 1,
                b"h" => {
                    in_paragraph = true;
                    heading = attribute(&value, b"outline-level")
                        .and_then(|value| value.parse().ok())
                        .unwrap_or(1);
                }
                b"p" => in_paragraph = true,
                b"tab" if in_paragraph => block.push('\t'),
                b"line-break" if in_paragraph => block.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(value)) => match local_name(value.name().as_ref()) {
                b"tab" if in_paragraph => block.push('\t'),
                b"line-break" if in_paragraph => block.push('\n'),
                _ => {}
            },
            Ok(Event::Text(value)) if in_paragraph => {
                block.push_str(
                    &value
                        .decode()
                        .map_err(|error| parse_error(format!("parse ODF text: {error}")))?,
                );
            }
            Ok(Event::GeneralRef(value)) if in_paragraph => {
                append_xml_reference(&mut block, &value, "parse ODF text")?;
            }
            Ok(Event::End(value)) => match local_name(value.name().as_ref()) {
                b"h" | b"p" if in_paragraph => {
                    let text = normalize_odf_text(&block);
                    block.clear();
                    if !text.is_empty() {
                        paragraphs.push(DocxParagraph {
                            text,
                            heading_level: heading,
                            list_kind: if list_depth > 0 { "bullet" } else { "" },
                            list_level: list_depth.saturating_sub(1),
                            ..Default::default()
                        });
                    }
                    heading = 0;
                    in_paragraph = false;
                }
                b"list" => list_depth = list_depth.saturating_sub(1),
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse ODF text: {error}"))),
        }
    }
    Ok(paragraphs)
}

fn normalize_odf_text(text: &str) -> String {
    text.lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn append_xml_reference(
    output: &mut String,
    value: &quick_xml::events::BytesRef<'_>,
    context: &str,
) -> Result<(), ConvertError> {
    if let Some(character) = value
        .resolve_char_ref()
        .map_err(|error| parse_error(format!("{context}: {error}")))?
    {
        output.push(character);
    } else {
        let name = value
            .decode()
            .map_err(|error| parse_error(format!("{context}: {error}")))?;
        output.push_str(
            resolve_predefined_entity(&name).ok_or_else(|| {
                parse_error(format!("{context}: invalid character entity &{name};"))
            })?,
        );
    }
    Ok(())
}

fn parse_odf_sheets(content: &str) -> Result<Vec<(String, Vec<Vec<SheetCell>>)>, ConvertError> {
    let mut reader = Reader::from_str(content);
    let mut sheets = Vec::new();
    let mut name = String::new();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell_type = String::new();
    let mut cell_value = String::new();
    let mut cell_text = String::new();
    let mut in_cell = false;
    let mut table_depth = 0usize;
    let mut row_repeat = 1usize;
    let mut cell_repeat = 1usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(value)) => match local_name(value.name().as_ref()) {
                b"table" => {
                    if table_depth == 0 {
                        name = attribute(&value, b"name")
                            .unwrap_or_else(|| format!("Sheet{}", sheets.len() + 1));
                        rows.clear();
                    }
                    table_depth += 1;
                }
                b"table-row" if table_depth == 1 => {
                    row = Vec::new();
                    row_repeat = odf_repeat(&value, b"number-rows-repeated", MAX_SHEET_ROWS);
                }
                b"table-cell" if table_depth == 1 => {
                    in_cell = true;
                    cell_repeat = odf_repeat(&value, b"number-columns-repeated", MAX_SHEET_COLUMNS);
                    cell_type = attribute(&value, b"value-type").unwrap_or_default();
                    cell_value = attribute(&value, b"value")
                        .or_else(|| attribute(&value, b"boolean-value"))
                        .or_else(|| attribute(&value, b"date-value"))
                        .unwrap_or_default();
                    cell_text.clear();
                }
                b"covered-table-cell" if table_depth == 1 => {
                    let repeat = odf_repeat(
                        &value,
                        b"number-columns-repeated",
                        MAX_SHEET_COLUMNS.saturating_sub(row.len()),
                    );
                    row.extend((0..repeat).map(|_| SheetCell::Empty));
                }
                b"tab" if in_cell => cell_text.push('\t'),
                b"line-break" if in_cell => cell_text.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(value)) if table_depth == 1 => {
                match local_name(value.name().as_ref()) {
                    b"table-cell" | b"covered-table-cell" => {
                        let repeat = odf_repeat(
                            &value,
                            b"number-columns-repeated",
                            MAX_SHEET_COLUMNS.saturating_sub(row.len()),
                        );
                        row.extend((0..repeat).map(|_| SheetCell::Empty));
                    }
                    b"table-row" => {
                        let repeat = odf_repeat(
                            &value,
                            b"number-rows-repeated",
                            MAX_SHEET_ROWS.saturating_sub(rows.len()),
                        );
                        rows.extend((0..repeat).map(|_| Vec::new()));
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(value)) if in_cell => cell_text.push_str(
                &value
                    .decode()
                    .map_err(|error| parse_error(format!("parse ODF sheet: {error}")))?,
            ),
            Ok(Event::GeneralRef(value)) if in_cell => {
                append_xml_reference(&mut cell_text, &value, "parse ODF sheet")?
            }
            Ok(Event::End(value)) => match local_name(value.name().as_ref()) {
                b"table-cell" if table_depth == 1 && in_cell => {
                    let text = normalize_odf_text(&cell_text);
                    let cell = match cell_type.as_str() {
                        "float" | "currency" | "percentage" if !cell_value.is_empty() => {
                            SheetCell::Number(cell_value.clone())
                        }
                        "boolean" => SheetCell::Bool(cell_value.eq_ignore_ascii_case("true")),
                        "date" if !cell_value.is_empty() => SheetCell::Date(cell_value.clone()),
                        _ if text.is_empty() => SheetCell::Empty,
                        _ => SheetCell::Text(text),
                    };
                    let repeat = cell_repeat.min(MAX_SHEET_COLUMNS.saturating_sub(row.len()));
                    row.extend((0..repeat).map(|_| cell.clone()));
                    in_cell = false;
                }
                b"table-row" if table_depth == 1 => {
                    let repeat = row_repeat.min(MAX_SHEET_ROWS.saturating_sub(rows.len()));
                    for _ in 0..repeat {
                        rows.push(row.clone());
                    }
                    row.clear();
                }
                b"table" if table_depth > 0 => {
                    table_depth -= 1;
                    if table_depth == 0 {
                        sheets.push((std::mem::take(&mut name), std::mem::take(&mut rows)));
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse ODF sheet: {error}"))),
        }
    }
    if sheets.is_empty() {
        sheets.push(("Sheet1".into(), Vec::new()));
    }
    Ok(sheets)
}

fn odf_repeat(value: &BytesStart<'_>, name: &[u8], limit: usize) -> usize {
    if limit == 0 {
        return 0;
    }
    attribute(value, name)
        .and_then(|value| value.parse().ok())
        .unwrap_or(1)
        .clamp(1, limit)
}

fn parse_odf_slides(content: &str) -> Result<Vec<OdfSlide>, ConvertError> {
    let mut reader = Reader::from_str(content);
    let mut slides = Vec::new();
    let mut slide: Option<OdfSlide> = None;
    let mut paragraph = String::new();
    let mut in_paragraph = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(value)) => match local_name(value.name().as_ref()) {
                b"page" => {
                    slide = Some(OdfSlide {
                        name: attribute(&value, b"name")
                            .unwrap_or_else(|| format!("Slide {}", slides.len() + 1)),
                        paragraphs: Vec::new(),
                        legacy_binary: false,
                        image: None,
                        overlay_images: Vec::new(),
                    })
                }
                b"p" | b"h" if slide.is_some() => in_paragraph = true,
                b"tab" if in_paragraph => paragraph.push('\t'),
                b"line-break" if in_paragraph => paragraph.push('\n'),
                _ => {}
            },
            Ok(Event::Text(value)) if in_paragraph => paragraph.push_str(
                &value
                    .decode()
                    .map_err(|error| parse_error(format!("parse ODF slides: {error}")))?,
            ),
            Ok(Event::GeneralRef(value)) if in_paragraph => {
                append_xml_reference(&mut paragraph, &value, "parse ODF slides")?
            }
            Ok(Event::End(value)) => match local_name(value.name().as_ref()) {
                b"p" | b"h" if in_paragraph => {
                    let text = normalize_odf_text(&paragraph);
                    paragraph.clear();
                    if !text.is_empty() {
                        slide.as_mut().unwrap().paragraphs.push(text);
                    }
                    in_paragraph = false;
                }
                b"page" => {
                    if let Some(value) = slide.take().filter(|slide| !slide.paragraphs.is_empty()) {
                        slides.push(value);
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse ODF slides: {error}"))),
        }
    }
    Ok(slides)
}

struct DbfField {
    name: String,
    kind: u8,
    length: usize,
}

fn parse_dbf_rows(input: &[u8]) -> Result<Vec<Vec<SheetCell>>, ConvertError> {
    if input.len() < 33 {
        return Err(parse_error("DBF input is too short".into()));
    }
    let record_count = u32::from_le_bytes(input[4..8].try_into().unwrap()) as usize;
    let header_length = u16::from_le_bytes(input[8..10].try_into().unwrap()) as usize;
    let record_length = u16::from_le_bytes(input[10..12].try_into().unwrap()) as usize;
    if !(33..=input.len()).contains(&header_length) {
        return Err(parse_error("DBF header length is invalid".into()));
    }
    if record_length <= 1 {
        return Err(parse_error("DBF record length is invalid".into()));
    }
    let descriptors = &input[32..header_length];
    let Some(terminator) = descriptors.iter().position(|byte| *byte == 0x0d) else {
        return Err(parse_error(
            "DBF field descriptor terminator was not found".into(),
        ));
    };
    if terminator % 32 != 0 {
        return Err(parse_error(
            "DBF field descriptor table is truncated".into(),
        ));
    }
    let windows_1252 = matches!(input[29], 0x03 | 0x57);
    let fields: Vec<_> = descriptors[..terminator]
        .chunks_exact(32)
        .take(256)
        .filter_map(|descriptor| {
            let end = descriptor[..11]
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(11);
            let name = dbf_text(&descriptor[..end], windows_1252);
            let length = descriptor[16] as usize;
            (!name.is_empty() && length > 0).then_some(DbfField {
                name,
                kind: descriptor[11],
                length,
            })
        })
        .collect();
    if fields.is_empty() {
        return Ok(Vec::new());
    }
    let mut rows = vec![
        fields
            .iter()
            .map(|field| SheetCell::Text(field.name.clone()))
            .collect(),
    ];
    let available = input.len().saturating_sub(header_length) / record_length;
    for index in 0..record_count.min(available).min(9999) {
        let start = header_length + index * record_length;
        let record = &input[start..start + record_length];
        if record.first() == Some(&b'*') {
            continue;
        }
        let mut offset = 1;
        let mut row = Vec::new();
        for field in &fields {
            if offset + field.length > record.len() {
                break;
            }
            let value = dbf_text(&record[offset..offset + field.length], windows_1252);
            row.push(match field.kind.to_ascii_uppercase() {
                b'N' | b'F' if !value.is_empty() => value
                    .parse::<f64>()
                    .map(|number| SheetCell::Number(number.to_string()))
                    .unwrap_or_else(|_| SheetCell::Text(value)),
                b'D' if value.len() == 8 && value.bytes().all(|byte| byte.is_ascii_digit()) => {
                    SheetCell::Date(format!("{}-{}-{}", &value[..4], &value[4..6], &value[6..8]))
                }
                b'L' if matches!(value.to_ascii_uppercase().as_str(), "T" | "Y") => {
                    SheetCell::Bool(true)
                }
                b'L' if matches!(value.to_ascii_uppercase().as_str(), "F" | "N") => {
                    SheetCell::Bool(false)
                }
                _ if value.is_empty() => SheetCell::Empty,
                _ => SheetCell::Text(value),
            });
            offset += field.length;
        }
        if row.iter().any(|cell| !matches!(cell, SheetCell::Empty)) {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn dbf_text(raw: &[u8], windows_1252: bool) -> String {
    let raw = raw
        .iter()
        .copied()
        .skip_while(|byte| matches!(byte, 0 | b' '))
        .collect::<Vec<_>>();
    let end = raw
        .iter()
        .rposition(|byte| !matches!(byte, 0 | b' '))
        .map_or(0, |index| index + 1);
    if windows_1252 || std::str::from_utf8(&raw[..end]).is_err() {
        raw[..end]
            .iter()
            .map(|byte| windows_1252_char(*byte))
            .collect()
    } else {
        String::from_utf8_lossy(&raw[..end]).into_owned()
    }
}

fn parse_sylk_rows(text: &str) -> Result<Vec<Vec<SheetCell>>, ConvertError> {
    if text.trim().is_empty() {
        return Err(parse_error("SYLK input is empty".into()));
    }
    let mut cells: HashMap<(usize, usize), SheetCell> = HashMap::new();
    let (mut current_row, mut current_column) = (1usize, 1usize);
    let (mut max_row, mut max_column) = (0usize, 0usize);
    for line in text.lines().map(str::trim) {
        let fields = split_sylk_fields(line);
        if fields
            .first()
            .is_none_or(|field| !field.eq_ignore_ascii_case("C"))
        {
            continue;
        }
        let mut value = None;
        for field in &fields[1..] {
            if field.len() < 2 {
                continue;
            }
            match &field[..1].to_ascii_uppercase()[..] {
                "X" => current_column = field[1..].parse().unwrap_or(current_column),
                "Y" => current_row = field[1..].parse().unwrap_or(current_row),
                "K" => value = Some(&field[1..]),
                _ => {}
            }
        }
        if let Some(value) = value {
            let cell = if value.starts_with('"') && value.ends_with('"') {
                SheetCell::Text(value[1..value.len() - 1].replace("\"\"", "\""))
            } else {
                typed_cell(value.to_string())
            };
            cells.insert((current_row - 1, current_column - 1), cell);
            max_row = max_row.max(current_row);
            max_column = max_column.max(current_column);
        }
    }
    let mut rows = Vec::new();
    for row in 0..max_row.min(10_000) {
        rows.push(
            (0..max_column.min(256))
                .map(|column| cells.remove(&(row, column)).unwrap_or(SheetCell::Empty))
                .collect(),
        );
    }
    Ok(rows)
}

fn split_sylk_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '"' {
            field.push(character);
            if quoted && chars.peek() == Some(&'"') {
                field.push(chars.next().unwrap());
            } else {
                quoted = !quoted;
            }
        } else if character == ';' && !quoted {
            fields.push(std::mem::take(&mut field));
        } else {
            field.push(character);
        }
    }
    fields.push(field);
    fields
}

fn parse_dif_rows(text: &str) -> Result<Vec<Vec<SheetCell>>, ConvertError> {
    let lines: Vec<_> = text.lines().collect();
    let Some(data) = lines
        .iter()
        .position(|line| line.trim().eq_ignore_ascii_case("DATA"))
    else {
        return Err(parse_error("DIF DATA section was not found".into()));
    };
    let mut rows = Vec::new();
    let mut current: Option<Vec<SheetCell>> = None;
    let mut index = data + 3;
    while index + 1 < lines.len() {
        let Some((kind, numeric)) = lines[index].trim().split_once(',') else {
            index += 2;
            continue;
        };
        let Ok(kind) = kind.trim().parse::<i32>() else {
            index += 2;
            continue;
        };
        let text_value = lines[index + 1]
            .trim()
            .trim_matches('"')
            .replace("\"\"", "\"");
        match (kind, text_value.to_ascii_uppercase().as_str()) {
            (-1, "BOT") => {
                if let Some(row) = current.take() {
                    rows.push(row);
                }
                current = Some(Vec::new());
            }
            (-1, "EOD") => {
                if let Some(row) = current.take() {
                    rows.push(row);
                }
                break;
            }
            (0, _) => current.get_or_insert_with(Vec::new).push(
                numeric
                    .trim()
                    .parse::<f64>()
                    .map(|value| SheetCell::Number(value.to_string()))
                    .unwrap_or_else(|_| SheetCell::Text(text_value)),
            ),
            (1, _) => current
                .get_or_insert_with(Vec::new)
                .push(SheetCell::Text(text_value)),
            _ => {}
        }
        index += 2;
    }
    if let Some(row) = current {
        rows.push(row);
    }
    Ok(rows)
}

fn parse_delimited_rows(
    text: &str,
    source: &str,
) -> Result<(String, Vec<Vec<SheetCell>>), ConvertError> {
    let (name, mut delimiter) = match source {
        "tsv" | "tab" => ("TSV", '\t'),
        "psv" => ("PSV", '|'),
        _ => ("CSV", ','),
    };
    let mut text = text.trim_start_matches('\u{feff}');
    if source == "csv" {
        if let Some((first, rest)) = text.split_once('\n') {
            if let Some(value) = first.trim().strip_prefix("sep=") {
                delimiter = match value.trim() {
                    ";" => ';',
                    "|" => '|',
                    "\\t" | "tab" => '\t',
                    _ => ',',
                };
                text = rest;
            }
        }
    }
    Ok((
        name.into(),
        parse_delimited_cells(text, delimiter, typed_cell)?,
    ))
}

#[cfg(test)]
fn parse_delimited(text: &str, delimiter: char) -> Result<Vec<Vec<String>>, ConvertError> {
    parse_delimited_cells(text, delimiter, |value| value)
}

fn parse_delimited_cells<T>(
    text: &str,
    delimiter: char,
    mut cell: impl FnMut(String) -> T,
) -> Result<Vec<Vec<T>>, ConvertError> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let bytes = text.as_bytes();
    let mut index = 0;
    let mut start = 0;
    let mut cells = 0usize;
    let mut pending = false;
    while index < bytes.len() {
        let character = bytes[index];
        match character {
            b'"' if quoted && bytes.get(index + 1) == Some(&b'"') => {
                field.push_str(&text[start..index]);
                field.push('"');
                index += 2;
                start = index;
                continue;
            }
            b'"' if quoted => {
                field.push_str(&text[start..index]);
                quoted = false;
                start = index + 1;
            }
            b'"' if index == start && field.is_empty() => {
                quoted = true;
                start = index + 1;
            }
            value if !quoted && (value == delimiter as u8 || value == b'\r' || value == b'\n') => {
                field.push_str(&text[start..index]);
                cells += 1;
                if cells > MAX_DELIMITED_CELLS || row.len() >= MAX_SHEET_COLUMNS {
                    return Err(parse_error("Delimited spreadsheet exceeds the 1,000,000-cell or 16,384-column limit; no truncated workbook was produced.".into()));
                }
                row.push(cell(std::mem::take(&mut field)));
                if value != delimiter as u8 {
                    if rows.len() >= MAX_DELIMITED_ROWS {
                        return Err(parse_error(
                            "Delimited spreadsheet exceeds the XLSX row limit.".into(),
                        ));
                    }
                    rows.push(std::mem::take(&mut row));
                    if value == b'\r' && bytes.get(index + 1) == Some(&b'\n') {
                        index += 1;
                    }
                    pending = false;
                } else {
                    pending = true;
                }
                index += 1;
                start = index;
                continue;
            }
            _ => {}
        }
        pending = true;
        index += 1;
    }
    if quoted {
        return Err(parse_error(
            "parse delimited text: unterminated quoted field".into(),
        ));
    }
    if pending {
        field.push_str(&text[start..]);
        if cells >= MAX_DELIMITED_CELLS
            || row.len() >= MAX_SHEET_COLUMNS
            || rows.len() >= MAX_DELIMITED_ROWS
        {
            return Err(parse_error("Delimited spreadsheet exceeds the cell, column or row limit; no truncated workbook was produced.".into()));
        }
        row.push(cell(field));
        rows.push(row);
    }
    Ok(rows)
}

fn typed_cell(value: String) -> SheetCell {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        SheetCell::Empty
    } else if trimmed.eq_ignore_ascii_case("true") {
        SheetCell::Bool(true)
    } else if trimmed.eq_ignore_ascii_case("false") {
        SheetCell::Bool(false)
    } else if trimmed.parse::<f64>().is_ok() {
        SheetCell::Number(trimmed.into())
    } else {
        SheetCell::Text(value)
    }
}

fn parse_json_rows(text: &str, source: &str) -> Result<Vec<Vec<SheetCell>>, ConvertError> {
    let values: Vec<serde_json::Value> = if source == "json" {
        let value: serde_json::Value = serde_json::from_str(text)
            .map_err(|error| parse_error(format!("parse JSON: {error}")))?;
        match value {
            serde_json::Value::Object(object) if object.len() == 1 => {
                match object.into_iter().next().unwrap().1 {
                    serde_json::Value::Array(values) => values,
                    value => vec![value],
                }
            }
            serde_json::Value::Array(values) => values,
            value => vec![value],
        }
    } else {
        text.lines()
            .filter(|line| !line.trim().is_empty())
            .enumerate()
            .map(|(index, line)| {
                serde_json::from_str(line).map_err(|error| {
                    parse_error(format!(
                        "parse JSON line {}: parse JSON: {error}",
                        index + 1
                    ))
                })
            })
            .collect::<Result<_, _>>()?
    };
    if values.iter().all(serde_json::Value::is_object) {
        let mut headers = Vec::new();
        for value in &values {
            for key in value.as_object().unwrap().keys() {
                if !headers.contains(key) {
                    headers.push(key.clone());
                }
            }
        }
        let mut rows = vec![headers.iter().cloned().map(SheetCell::Text).collect()];
        for value in values {
            let object = value.as_object().unwrap();
            rows.push(
                headers
                    .iter()
                    .map(|key| json_cell(object.get(key).unwrap_or(&serde_json::Value::Null)))
                    .collect(),
            );
        }
        return Ok(rows);
    }
    Ok(vec![
        vec![
            SheetCell::Text("Index".into()),
            SheetCell::Text("Value".into()),
        ],
        values
            .into_iter()
            .enumerate()
            .flat_map(|(index, value)| {
                [
                    SheetCell::Number((index + 1).to_string()),
                    json_cell(&value),
                ]
            })
            .collect(),
    ])
}

fn json_cell(value: &serde_json::Value) -> SheetCell {
    match value {
        serde_json::Value::Null => SheetCell::Empty,
        serde_json::Value::Bool(value) => SheetCell::Bool(*value),
        serde_json::Value::Number(value) => SheetCell::Number(value.to_string()),
        serde_json::Value::String(value) => typed_cell(value.clone()),
        value => SheetCell::Text(value.to_string()),
    }
}

fn write_xlsx(output: &str, sheet_name: &str, rows: &[Vec<SheetCell>]) -> Result<(), ConvertError> {
    write_xlsx_sheets(output, &[(sheet_name, rows)])
}

fn write_xlsx_sheets(
    output: &str,
    sheets: &[(&str, &[Vec<SheetCell>])],
) -> Result<(), ConvertError> {
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error(format!("create output directory: {error}")))?;
    }
    let file =
        File::create(output).map_err(|error| io_error(format!("create output file: {error}")))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let sheet_names = sheets.iter().map(|(name, _)| *name).collect::<Vec<_>>();
    let mut files = vec![
        (
            "[Content_Types].xml".into(),
            xlsx_content_types(sheets.len()),
        ),
        ("_rels/.rels".into(), xlsx_root_relationships()),
        ("xl/workbook.xml".into(), xlsx_workbook(&sheet_names)),
        (
            "xl/_rels/workbook.xml.rels".into(),
            xlsx_workbook_relationships(sheets.len()),
        ),
        ("xl/styles.xml".into(), xlsx_styles()),
    ];
    files.extend(sheets.iter().enumerate().map(|(index, (_, rows))| {
        (
            format!("xl/worksheets/sheet{}.xml", index + 1),
            xlsx_worksheet(rows),
        )
    }));
    for (name, content) in files {
        writer
            .start_file(&name, options)
            .map_err(|error| io_error(format!("create output entry {name}: {error}")))?;
        writer
            .write_all(content.as_bytes())
            .map_err(|error| io_error(format!("write output entry {name}: {error}")))?;
    }
    writer
        .finish()
        .map_err(|error| io_error(format!("close output archive: {error}")))?;
    Ok(())
}

fn write_pptx(output: &str, slides: &[OdfSlide]) -> Result<(), ConvertError> {
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error(format!("create output directory: {error}")))?;
    }
    let file =
        File::create(output).map_err(|error| io_error(format!("create output file: {error}")))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut files = vec![
        (
            "[Content_Types].xml".to_string(),
            pptx_content_types(slides),
        ),
        ("_rels/.rels".to_string(), pptx_root_relationships()),
        (
            "ppt/presentation.xml".to_string(),
            pptx_presentation(slides.len()),
        ),
        (
            "ppt/_rels/presentation.xml.rels".to_string(),
            pptx_presentation_relationships(slides.len()),
        ),
    ];
    for (index, slide) in slides.iter().enumerate() {
        files.push((
            format!("ppt/slides/slide{}.xml", index + 1),
            pptx_slide(slide),
        ));
        let images = pptx_image_layers(slide);
        if pptx_uses_layered_images(slide, &images) {
            files.push((
                format!("ppt/slides/_rels/slide{}.xml.rels", index + 1),
                pptx_image_relationships(index + 1, &images),
            ));
        } else if let Some(image) = images.first() {
            files.push((
                format!("ppt/slides/_rels/slide{}.xml.rels", index + 1),
                pptx_image_relationship(index + 1, image.extension),
            ));
        }
    }
    for (name, content) in files {
        writer
            .start_file(&name, options)
            .map_err(|error| io_error(format!("create output entry {name}: {error}")))?;
        writer
            .write_all(content.as_bytes())
            .map_err(|error| io_error(format!("write output entry {name}: {error}")))?;
    }
    for (index, slide) in slides.iter().enumerate() {
        let images = pptx_image_layers(slide);
        let layered = pptx_uses_layered_images(slide, &images);
        for (layer, image) in images.iter().enumerate() {
            let name = if layered {
                format!(
                    "ppt/media/image{}-{}.{}",
                    index + 1,
                    layer + 1,
                    image.extension
                )
            } else {
                format!("ppt/media/image{}.{}", index + 1, image.extension)
            };
            writer
                .start_file(&name, options)
                .map_err(|error| io_error(format!("create output entry {name}: {error}")))?;
            writer
                .write_all(&image.data)
                .map_err(|error| io_error(format!("write output entry {name}: {error}")))?;
        }
    }
    writer
        .finish()
        .map_err(|error| io_error(format!("close output archive: {error}")))?;
    Ok(())
}

fn pptx_content_types(slides: &[OdfSlide]) -> String {
    let mut overrides = String::new();
    for index in 1..=slides.len() {
        overrides.push_str(&format!("  <Override PartName=\"/ppt/slides/slide{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>\n"));
    }
    let mut image_defaults = String::new();
    let mut extensions = HashSet::new();
    for image in slides.iter().flat_map(pptx_image_layers) {
        if extensions.insert(image.extension) {
            image_defaults.push_str(&format!(
                "  <Default Extension=\"{}\" ContentType=\"{}\"/>\n",
                image.extension, image.content_type
            ));
        }
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
{image_defaults}  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
{overrides}</Types>"#
    )
}

fn pptx_image_relationship(slide_index: usize, extension: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image{slide_index}.{extension}"/>
</Relationships>"#
    )
}

fn pptx_image_relationships(slide_index: usize, images: &[&PptSlideImage]) -> String {
    let relationships = images
        .iter()
        .enumerate()
        .map(|(index, image)| {
            format!(
                "  <Relationship Id=\"rIdImage{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image{}-{}.{}\"/>\n",
                index + 1,
                slide_index,
                index + 1,
                image.extension
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{relationships}</Relationships>"#
    )
}

fn pptx_image_layers(slide: &OdfSlide) -> Vec<&PptSlideImage> {
    let mut images = Vec::new();
    if let Some(image) = slide.image.as_ref() {
        images.push(image);
    }
    images.extend(slide.overlay_images.iter());
    images
}

fn pptx_uses_layered_images(slide: &OdfSlide, images: &[&PptSlideImage]) -> bool {
    images.len() > 1
        || (images.len() == 1
            && slide.image.as_ref().is_some_and(|image| {
                image_dimensions(image)
                    .is_some_and(|(width, height)| width > height.saturating_mul(4))
            }))
}

fn image_dimensions(image: &PptSlideImage) -> Option<(u32, u32)> {
    if image.extension == "png" {
        return image.data.get(16..24).map(|value| {
            (
                u32::from_be_bytes(value[..4].try_into().unwrap()),
                u32::from_be_bytes(value[4..].try_into().unwrap()),
            )
        });
    }
    if image.extension != "jpeg" {
        return None;
    }
    let data = &image.data;
    let mut offset = 2usize;
    while offset + 9 <= data.len() {
        if data[offset] != 0xff {
            offset += 1;
            continue;
        }
        while offset < data.len() && data[offset] == 0xff {
            offset += 1;
        }
        let marker = *data.get(offset)?;
        offset += 1;
        if matches!(marker, 0xd8 | 0xd9) {
            continue;
        }
        let length = u16::from_be_bytes(data.get(offset..offset + 2)?.try_into().ok()?) as usize;
        if length < 2 || offset + length > data.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let height = u16::from_be_bytes(data.get(offset + 3..offset + 5)?.try_into().ok()?);
            let width = u16::from_be_bytes(data.get(offset + 5..offset + 7)?.try_into().ok()?);
            return Some((u32::from(width), u32::from(height)));
        }
        offset += length;
    }
    None
}

fn pptx_layered_image_slide(slide: &OdfSlide, images: &[&PptSlideImage]) -> String {
    const SLIDE_WIDTH: u64 = 9_144_000;
    const SLIDE_HEIGHT: u64 = 5_143_500;
    let has_background = slide.image.as_ref().is_some_and(|image| {
        image.anchor.is_some_and(|anchor| {
            anchor.left == 0 && anchor.top == 0 && anchor.right >= 7_600 && anchor.bottom >= 4_275
        }) || image_dimensions(image)
            .is_some_and(|(width, height)| width <= height.saturating_mul(4))
    });
    let mut pictures = String::new();
    for (index, image) in images.iter().enumerate() {
        let (x, mut y, width, height) = if let Some(anchor) = image.anchor {
            let box_x = u64::from(anchor.left) * SLIDE_WIDTH / 7_680;
            let box_y = u64::from(anchor.top) * SLIDE_HEIGHT / 4_320;
            let box_width =
                (u64::from(anchor.right.saturating_sub(anchor.left)) * SLIDE_WIDTH / 7_680).max(1);
            let box_height =
                (u64::from(anchor.bottom.saturating_sub(anchor.top)) * SLIDE_HEIGHT / 4_320).max(1);
            if has_background && index == 0 {
                (box_x, box_y, box_width, box_height)
            } else {
                let (source_width, source_height) = image_dimensions(image).unwrap_or((16, 9));
                let width_for_height =
                    box_height * u64::from(source_width) / u64::from(source_height);
                if width_for_height <= box_width {
                    (
                        box_x + (box_width - width_for_height) / 2,
                        box_y,
                        width_for_height.max(1),
                        box_height,
                    )
                } else {
                    let height_for_width =
                        box_width * u64::from(source_height) / u64::from(source_width);
                    (
                        box_x,
                        box_y + (box_height - height_for_width) / 2,
                        box_width,
                        height_for_width.max(1),
                    )
                }
            }
        } else if has_background && index == 0 {
            (0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
        } else {
            let overlay_index = if has_background { index - 1 } else { index };
            let (source_width, source_height) = image_dimensions(image).unwrap_or((16, 9));
            let width = 7_315_200u64;
            let height = (width * u64::from(source_height) / u64::from(source_width)).max(1);
            let y = if overlay_index == 0 {
                if source_width > source_height.saturating_mul(5) {
                    685_800
                } else {
                    1_600_200
                }
            } else if source_width > source_height.saturating_mul(5) {
                2_743_200
            } else {
                1_714_500
            };
            ((SLIDE_WIDTH - width) / 2, y, width, height)
        };
        if has_background && index > 1 {
            if let Some((source_width, source_height)) = image_dimensions(image) {
                if source_width > source_height.saturating_mul(5) {
                    y = y.max(2_743_200);
                }
            }
        }
        pictures.push_str(&format!(
            r#"      <p:pic>
        <p:nvPicPr><p:cNvPr id="{}" name="Image {}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdImage{}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
      </p:pic>
"#,
            index + 2,
            index + 1,
            index + 1,
            x,
            y,
            width,
            height
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="{}">
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
{pictures}    </p:spTree>
  </p:cSld>
</p:sld>"#,
        escape(&slide.name),
        pictures = pictures
    )
}

fn pptx_root_relationships() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#.into()
}

fn pptx_presentation(slide_count: usize) -> String {
    let mut ids = String::new();
    for index in 0..slide_count {
        ids.push_str(&format!(
            "    <p:sldId id=\"{}\" r:id=\"rId{}\"/>\n",
            256 + index,
            index + 1
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
{ids}  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#
    )
}

fn pptx_presentation_relationships(slide_count: usize) -> String {
    let mut relationships = String::new();
    for index in 1..=slide_count {
        relationships.push_str(&format!("  <Relationship Id=\"rId{index}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{index}.xml\"/>\n"));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{relationships}</Relationships>"#
    )
}

fn pptx_slide(slide: &OdfSlide) -> String {
    if slide.image.is_some() {
        let layers = pptx_image_layers(slide);
        if pptx_uses_layered_images(slide, &layers) {
            return pptx_layered_image_slide(slide, &layers);
        }
        return pptx_image_slide(slide);
    }
    if slide.legacy_binary {
        return pptx_binary_slide(slide);
    }
    let title = slide
        .paragraphs
        .first()
        .map(String::as_str)
        .unwrap_or_default();
    let mut body = String::new();
    for paragraph in slide.paragraphs.iter().skip(1) {
        body.push_str(&format!("          <a:p><a:pPr algn=\"ctr\"/><a:r><a:rPr sz=\"1600\"><a:solidFill><a:srgbClr val=\"223245\"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p>\n", escape(paragraph)));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="{}">
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/><a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2600" b="1"><a:solidFill><a:srgbClr val="223245"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1371600" y="2286000"/><a:ext cx="6400800" cy="1371600"/></a:xfrm>
          <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="E7F0FF"/></a:solidFill>
          <a:ln><a:solidFill><a:srgbClr val="2D5F9A"/></a:solidFill></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="ctr"/><a:lstStyle/>
{body}        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"#,
        escape(&slide.name),
        escape(title)
    )
}

fn pptx_image_slide(slide: &OdfSlide) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="{}">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="Slide image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
</p:sld>"#,
        escape(&slide.name)
    )
}

fn pptx_binary_slide(slide: &OdfSlide) -> String {
    let title = slide
        .paragraphs
        .first()
        .map(String::as_str)
        .unwrap_or_default();
    let mut body = String::new();
    for paragraph in slide.paragraphs.iter().skip(1) {
        body.push_str(&format!("          <a:p><a:r><a:rPr sz=\"1600\"><a:solidFill><a:srgbClr val=\"223245\"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p>\n", escape(paragraph)));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="{}">
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="685800"/><a:ext cx="7315200" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2800" b="1"><a:solidFill><a:srgbClr val="223245"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="1371600" y="2057400"/><a:ext cx="6400800" cy="2743200"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/><a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>
{body}        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"#,
        escape(&slide.name),
        escape(title)
    )
}

fn xlsx_content_types(sheet_count: usize) -> String {
    let worksheets = (1..=sheet_count)
        .map(|index| format!("  <Override PartName=\"/xl/worksheets/sheet{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\n"))
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
{worksheets}</Types>"#
    )
}

fn xlsx_root_relationships() -> String {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#.into()
}

fn xlsx_workbook(sheet_names: &[&str]) -> String {
    let sheets = sheet_names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            format!(
                "    <sheet name=\"{}\" sheetId=\"{}\" r:id=\"rId{}\"/>\n",
                escape(*name),
                index + 1,
                index + 1
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
{sheets}  </sheets>
</workbook>"#,
    )
}

fn xlsx_workbook_relationships(sheet_count: usize) -> String {
    let worksheets = (1..=sheet_count)
        .map(|index| format!("  <Relationship Id=\"rId{index}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{index}.xml\"/>\n"))
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{worksheets}
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#
    )
}

fn xlsx_styles() -> String {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>"#
        .into()
}

fn xlsx_worksheet(rows: &[Vec<SheetCell>]) -> String {
    let mut body = String::new();
    for (row_index, row) in rows.iter().enumerate() {
        if !row.iter().any(|cell| !matches!(cell, SheetCell::Empty)) {
            continue;
        }
        body.push_str(&format!("    <row r=\"{}\">\n", row_index + 1));
        for (column_index, cell) in row.iter().enumerate() {
            if matches!(cell, SheetCell::Empty) {
                continue;
            }
            let reference = format!("{}{}", spreadsheet_column(column_index + 1), row_index + 1);
            body.push_str("      ");
            match cell {
                SheetCell::Text(value) => {
                    let preserve = value.starts_with(char::is_whitespace)
                        || value.ends_with(char::is_whitespace)
                        || value.contains('\n');
                    body.push_str(&format!(
                        "<c r=\"{reference}\" t=\"inlineStr\"><is><t{}>{}</t></is></c>\n",
                        if preserve {
                            " xml:space=\"preserve\""
                        } else {
                            ""
                        },
                        escape(value)
                    ));
                }
                SheetCell::Number(value) => body.push_str(&format!(
                    "<c r=\"{reference}\"><v>{}</v></c>\n",
                    escape(value)
                )),
                SheetCell::Bool(value) => body.push_str(&format!(
                    "<c r=\"{reference}\" t=\"b\"><v>{}</v></c>\n",
                    usize::from(*value)
                )),
                SheetCell::Date(value) => body.push_str(&format!(
                    "<c r=\"{reference}\" t=\"d\"><v>{}</v></c>\n",
                    escape(value)
                )),
                SheetCell::Empty => {}
            }
        }
        body.push_str("    </row>\n");
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
{body}  </sheetData>
</worksheet>"#
    )
}

fn spreadsheet_column(mut index: usize) -> String {
    let mut value = String::new();
    while index > 0 {
        index -= 1;
        value.insert(0, (b'A' + (index % 26) as u8) as char);
        index /= 26;
    }
    value
}

fn decode_text(input: &[u8]) -> String {
    let decoded = if input.starts_with(&[0xff, 0xfe]) {
        decode_utf16(&input[2..], true)
    } else if input.starts_with(&[0xfe, 0xff]) {
        decode_utf16(&input[2..], false)
    } else if let Ok(text) = std::str::from_utf8(input) {
        text.to_string()
    } else {
        input.iter().map(|byte| windows_1252_char(*byte)).collect()
    };
    decoded
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim_end_matches(char::is_whitespace)
        .to_string()
}

fn decode_utf16(input: &[u8], little_endian: bool) -> String {
    let units = input.chunks_exact(2).map(|pair| {
        if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        }
    });
    char::decode_utf16(units)
        .map(|value| value.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

fn windows_1252_char(byte: u8) -> char {
    match byte {
        0x80 => '\u{20ac}',
        0x82 => '\u{201a}',
        0x83 => '\u{0192}',
        0x84 => '\u{201e}',
        0x85 => '\u{2026}',
        0x86 => '\u{2020}',
        0x87 => '\u{2021}',
        0x88 => '\u{02c6}',
        0x89 => '\u{2030}',
        0x8a => '\u{0160}',
        0x8b => '\u{2039}',
        0x8c => '\u{0152}',
        0x8e => '\u{017d}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201c}',
        0x94 => '\u{201d}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0x98 => '\u{02dc}',
        0x99 => '\u{2122}',
        0x9a => '\u{0161}',
        0x9b => '\u{203a}',
        0x9c => '\u{0153}',
        0x9e => '\u{017e}',
        0x9f => '\u{0178}',
        _ => char::from_u32(byte as u32).unwrap_or(char::REPLACEMENT_CHARACTER),
    }
}

fn extract_text_paragraphs(text: &str) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut block = Vec::new();
    let flush = |block: &mut Vec<&str>, paragraphs: &mut Vec<String>| {
        if block.is_empty() || paragraphs.len() >= MAX_TEXT_PARAGRAPHS {
            block.clear();
            return;
        }
        let paragraph = block
            .drain(..)
            .map(normalize_text_line)
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        if !paragraph.is_empty() {
            paragraphs.push(paragraph);
        }
    };
    for line in text.split('\n') {
        if line.trim().is_empty() {
            flush(&mut block, &mut paragraphs);
        } else {
            block.push(line);
        }
    }
    flush(&mut block, &mut paragraphs);
    paragraphs
}

fn normalize_text_line(line: &str) -> String {
    line.trim().chars().take(MAX_TEXT_LINE_CHARS).collect()
}

fn extract_markdown_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut start = 0;
    if lines.first().is_some_and(|line| line.trim() == "---") {
        if let Some(end) = lines[1..]
            .iter()
            .position(|line| matches!(line.trim(), "---" | "..."))
        {
            start = end + 2;
        }
    }

    let mut paragraphs = Vec::new();
    let mut block = Vec::new();
    let mut in_comment = false;
    let flush = |block: &mut Vec<String>, paragraphs: &mut Vec<DocxParagraph>| {
        let text = strip_inline_markdown(&block.join(" "));
        block.clear();
        if !text.is_empty() && paragraphs.len() < MAX_TEXT_PARAGRAPHS {
            paragraphs.push(DocxParagraph {
                text,
                ..Default::default()
            });
        }
    };

    for raw_line in &lines[start..] {
        if paragraphs.len() >= MAX_TEXT_PARAGRAPHS {
            break;
        }
        let line = strip_markdown_comment(raw_line, &mut in_comment);
        let line = line.trim();
        if line.is_empty() {
            flush(&mut block, &mut paragraphs);
            continue;
        }
        if let Some(level) = markdown_setext_level(line) {
            if block.len() == 1 {
                let text = strip_inline_markdown(&block.remove(0));
                if !text.is_empty() {
                    paragraphs.push(DocxParagraph {
                        text,
                        heading_level: level,
                        bold: true,
                        ..Default::default()
                    });
                }
            } else {
                flush(&mut block, &mut paragraphs);
            }
            continue;
        }
        if is_markdown_reference(line)
            || is_markdown_table_separator(line)
            || is_markdown_rule(line)
        {
            flush(&mut block, &mut paragraphs);
            continue;
        }
        if let Some((level, text)) = markdown_heading(line) {
            flush(&mut block, &mut paragraphs);
            paragraphs.push(DocxParagraph {
                text: strip_inline_markdown(text),
                heading_level: level,
                bold: true,
                ..Default::default()
            });
            continue;
        }
        if let Some((list_kind, text)) = markdown_list(line) {
            flush(&mut block, &mut paragraphs);
            paragraphs.push(DocxParagraph {
                text: strip_inline_markdown(text),
                list_kind,
                ..Default::default()
            });
            continue;
        }
        block.push(markdown_table_row(line));
    }
    flush(&mut block, &mut paragraphs);
    paragraphs
}

fn extract_subtitle_paragraphs(text: &str, source: &str) -> Vec<DocxParagraph> {
    if matches!(source, "ass" | "ssa") {
        return extract_ass_paragraphs(text);
    }
    text.split("\n\n")
        .filter_map(|block| {
            let lines: Vec<_> = block
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect();
            if lines.is_empty()
                || (source == "vtt"
                    && matches!(
                        lines[0].to_ascii_uppercase().split_whitespace().next(),
                        Some("WEBVTT" | "STYLE" | "REGION" | "NOTE")
                    ))
            {
                return None;
            }
            let timing = lines.iter().position(|line| {
                line.contains("-->") || (source == "sbv" && is_sbv_timing(line))
            })?;
            let text = lines[timing + 1..]
                .iter()
                .filter(|line| !line.bytes().all(|byte| byte.is_ascii_digit()))
                .map(|line| clean_subtitle_text(line))
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            (!text.is_empty()).then_some(DocxParagraph {
                text,
                ..Default::default()
            })
        })
        .take(MAX_TEXT_PARAGRAPHS)
        .collect()
}

fn extract_ipynb_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let Ok(notebook) = serde_json::from_str::<serde_json::Value>(text) else {
        return plain_docx_paragraphs(text);
    };
    let Some(cells) = notebook.get("cells").and_then(serde_json::Value::as_array) else {
        return plain_docx_paragraphs(text);
    };
    let mut paragraphs = Vec::new();
    for cell in cells {
        let source = notebook_text(cell.get("source"));
        if !source.trim().is_empty() {
            if cell.get("cell_type").and_then(serde_json::Value::as_str) == Some("markdown") {
                paragraphs.extend(extract_markdown_paragraphs(&source));
            } else {
                paragraphs.extend(plain_docx_paragraphs(&source));
            }
        }
        if let Some(outputs) = cell.get("outputs").and_then(serde_json::Value::as_array) {
            for output in outputs {
                let output_type = output
                    .get("output_type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                let mut value = match output_type {
                    "stream" => notebook_text(output.get("text")),
                    "execute_result" | "display_data" => output
                        .get("data")
                        .and_then(|data| data.get("text/plain"))
                        .map(|value| notebook_text(Some(value)))
                        .filter(|value| !value.trim().is_empty())
                        .or_else(|| {
                            output
                                .get("data")
                                .and_then(|data| data.get("text/html"))
                                .map(|value| strip_inline_html(&notebook_text(Some(value))))
                        })
                        .unwrap_or_default(),
                    "error" => {
                        let traceback = notebook_text(output.get("traceback"));
                        if traceback.trim().is_empty() {
                            format!(
                                "{}: {}",
                                output
                                    .get("ename")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default(),
                                output
                                    .get("evalue")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                            )
                            .trim_matches([':', ' '])
                            .to_string()
                        } else {
                            traceback
                        }
                    }
                    _ => String::new(),
                };
                value = value.trim_end().to_string();
                if !value.is_empty() {
                    paragraphs.extend(plain_docx_paragraphs(&value));
                }
            }
        }
        if paragraphs.len() >= MAX_TEXT_PARAGRAPHS {
            break;
        }
    }
    paragraphs.truncate(MAX_TEXT_PARAGRAPHS);
    if paragraphs.is_empty() {
        plain_docx_paragraphs(text)
    } else {
        paragraphs
    }
}

fn extract_xml_paragraphs(text: &str) -> Result<Vec<DocxParagraph>, ConvertError> {
    let mut reader = Reader::from_str(text);
    let mut paragraphs = Vec::new();
    let mut block = String::new();
    let mut depth = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(_)) => depth += 1,
            Ok(Event::Text(value)) => {
                let decoded = value
                    .decode()
                    .map_err(|error| parse_error(format!("parse XML text: {error}")))?;
                block.push_str(&decoded);
            }
            Ok(Event::CData(value)) => {
                let content = String::from_utf8_lossy(value.as_ref());
                block.push_str(&content);
            }
            Ok(Event::GeneralRef(value)) => {
                if let Some(character) = value
                    .resolve_char_ref()
                    .map_err(|error| parse_error(format!("parse XML text: {error}")))?
                {
                    block.push(character);
                } else {
                    let name = value
                        .decode()
                        .map_err(|error| parse_error(format!("parse XML text: {error}")))?;
                    let resolved = resolve_predefined_entity(&name).ok_or_else(|| {
                        parse_error(format!("parse XML text: invalid character entity &{name};"))
                    })?;
                    block.push_str(resolved);
                }
            }
            Ok(Event::End(_)) => {
                depth = depth.saturating_sub(1);
                let text = block.split_whitespace().collect::<Vec<_>>().join(" ");
                block.clear();
                if !text.is_empty() && paragraphs.len() < MAX_TEXT_PARAGRAPHS {
                    paragraphs.push(DocxParagraph {
                        text,
                        ..Default::default()
                    });
                }
            }
            Ok(Event::Eof) if depth == 0 => break,
            Ok(Event::Eof) => return Err(parse_error("parse XML text: unexpected EOF".into())),
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse XML text: {error}"))),
        }
    }
    Ok(paragraphs)
}

fn extract_html_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let mut paragraphs = Vec::new();
    let mut block = String::new();
    let mut skip_depth = 0usize;
    let mut lists = Vec::new();
    let mut index = 0usize;
    while index < text.len() && paragraphs.len() < MAX_TEXT_PARAGRAPHS {
        let Some(relative) = text[index..].find('<') else {
            write_html_text(&mut block, &text[index..], skip_depth);
            break;
        };
        let tag_start = index + relative;
        write_html_text(&mut block, &text[index..tag_start], skip_depth);
        let Some(tag_end) = html_tag_end(text, tag_start) else {
            write_html_text(&mut block, &text[tag_start..], skip_depth);
            break;
        };
        let raw = text[tag_start + 1..tag_end].trim();
        index = tag_end + 1;
        if raw.starts_with("!--") || raw.starts_with('!') || raw.starts_with('?') {
            continue;
        }
        let closing = raw.starts_with('/');
        let raw = raw.trim_start_matches('/').trim();
        let name = raw
            .split(|character: char| character.is_whitespace() || character == '/')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "script"
                | "style"
                | "noscript"
                | "template"
                | "svg"
                | "canvas"
                | "audio"
                | "video"
                | "iframe"
                | "object"
        ) {
            if closing {
                skip_depth = skip_depth.saturating_sub(1);
            } else {
                flush_html_paragraph(&mut block, &mut paragraphs, 0);
                skip_depth += 1;
            }
            continue;
        }
        if skip_depth > 0 {
            continue;
        }
        if closing {
            match name.as_str() {
                "title" | "h1" => flush_html_paragraph(&mut block, &mut paragraphs, 1),
                "h2" => flush_html_paragraph(&mut block, &mut paragraphs, 2),
                "h3" => flush_html_paragraph(&mut block, &mut paragraphs, 3),
                "h4" => flush_html_paragraph(&mut block, &mut paragraphs, 4),
                "h5" => flush_html_paragraph(&mut block, &mut paragraphs, 5),
                "h6" => flush_html_paragraph(&mut block, &mut paragraphs, 6),
                "p" | "div" | "section" | "article" | "header" | "footer" | "main" | "aside"
                | "blockquote" | "td" | "th" | "table" | "tr" => {
                    flush_html_paragraph(&mut block, &mut paragraphs, 0)
                }
                "li" => flush_html_list_item(&mut block, &mut paragraphs, &lists),
                "ul" | "ol" => {
                    flush_html_list_item(&mut block, &mut paragraphs, &lists);
                    lists.pop();
                }
                _ => {}
            }
        } else {
            match name.as_str() {
                "br" => block.push('\n'),
                "img" => {
                    if let Some(alt) = html_attribute(raw, "alt") {
                        write_html_text(&mut block, alt, 0);
                    }
                }
                "p" | "div" | "section" | "article" | "header" | "footer" | "main" | "aside"
                | "blockquote" | "table" | "tr" | "title" | "h1" | "h2" | "h3" | "h4" | "h5"
                | "h6" => flush_html_paragraph(&mut block, &mut paragraphs, 0),
                "ul" | "ol" => {
                    flush_html_list_item(&mut block, &mut paragraphs, &lists);
                    lists.push(if name == "ul" { "bullet" } else { "decimal" });
                }
                "li" => flush_html_list_item(&mut block, &mut paragraphs, &lists),
                _ => {}
            }
        }
    }
    flush_html_paragraph(&mut block, &mut paragraphs, 0);
    paragraphs
}

fn html_tag_end(text: &str, start: usize) -> Option<usize> {
    if text[start..].starts_with("<!--") {
        return text[start + 4..].find("-->").map(|end| start + 4 + end + 2);
    }
    let mut quote = None;
    for (offset, character) in text[start + 1..].char_indices() {
        match (quote, character) {
            (Some(current), value) if value == current => quote = None,
            (None, '\'' | '"') => quote = Some(character),
            (None, '>') => return Some(start + 1 + offset),
            _ => {}
        }
    }
    None
}

fn write_html_text(block: &mut String, value: &str, skip_depth: usize) {
    if skip_depth > 0 {
        return;
    }
    let decoded = decode_html_entities(value);
    let value = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() {
        return;
    }
    if !block.is_empty() && !block.ends_with('\n') {
        block.push(' ');
    }
    block.push_str(&value);
}

fn decode_html_entities(value: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some(start) = remaining.find('&') {
        output.push_str(&remaining[..start]);
        let entity = &remaining[start + 1..];
        let Some(end) = entity.find(';').filter(|end| *end <= 32) else {
            output.push('&');
            remaining = entity;
            continue;
        };
        let name = &entity[..end];
        let character = name
            .strip_prefix("#x")
            .or_else(|| name.strip_prefix("#X"))
            .and_then(|value| u32::from_str_radix(value, 16).ok())
            .and_then(char::from_u32)
            .or_else(|| {
                name.strip_prefix('#')
                    .and_then(|value| value.parse().ok())
                    .and_then(char::from_u32)
            });
        if let Some(character) = character {
            output.push(character);
        } else if let Some(replacement) = match name {
            "amp" => Some("&"),
            "lt" => Some("<"),
            "gt" => Some(">"),
            "quot" => Some("\""),
            "apos" => Some("'"),
            "nbsp" => Some(" "),
            "copy" => Some("\u{00a9}"),
            "reg" => Some("\u{00ae}"),
            "bull" => Some("\u{2022}"),
            "hellip" => Some("\u{2026}"),
            "ndash" => Some("\u{2013}"),
            "mdash" => Some("\u{2014}"),
            "laquo" => Some("\u{00ab}"),
            "raquo" => Some("\u{00bb}"),
            _ => None,
        } {
            output.push_str(replacement);
        } else {
            output.push('&');
            output.push_str(name);
            output.push(';');
        }
        remaining = &entity[end + 1..];
    }
    output.push_str(remaining);
    output
}

fn flush_html_paragraph(
    block: &mut String,
    paragraphs: &mut Vec<DocxParagraph>,
    heading_level: usize,
) {
    let text = block
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    block.clear();
    if !text.is_empty() && paragraphs.len() < MAX_TEXT_PARAGRAPHS {
        paragraphs.push(DocxParagraph {
            text,
            heading_level,
            bold: heading_level > 0,
            ..Default::default()
        });
    }
}

fn flush_html_list_item(
    block: &mut String,
    paragraphs: &mut Vec<DocxParagraph>,
    lists: &[&'static str],
) {
    let before = paragraphs.len();
    flush_html_paragraph(block, paragraphs, 0);
    if let Some(paragraph) = paragraphs.get_mut(before) {
        paragraph.list_kind = lists.last().copied().unwrap_or("");
        paragraph.list_level = lists.len().saturating_sub(1);
    }
}

fn extract_fb2_paragraphs(text: &str) -> Result<Vec<DocxParagraph>, ConvertError> {
    let mut reader = Reader::from_str(text);
    let mut paragraphs = Vec::new();
    let mut block = String::new();
    let mut in_body = false;
    let mut in_title = false;
    let mut skip_depth = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(value)) => match local_name(value.name().as_ref()) {
                b"body" => in_body = true,
                b"binary" | b"image" | b"stylesheet" | b"description" if in_body => skip_depth += 1,
                b"title" if in_body && skip_depth == 0 => {
                    flush_fb2_paragraph(&mut block, &mut paragraphs, in_title);
                    in_title = true;
                }
                b"p" | b"section" | b"epigraph" | b"poem" | b"stanza" | b"annotation"
                | b"history"
                    if in_body && skip_depth == 0 =>
                {
                    flush_fb2_paragraph(&mut block, &mut paragraphs, in_title)
                }
                _ => {}
            },
            Ok(Event::Text(value)) if in_body && skip_depth == 0 => {
                let decoded = value
                    .decode()
                    .map_err(|error| parse_error(format!("parse FB2 text: {error}")))?;
                block.push_str(&decoded);
            }
            Ok(Event::GeneralRef(value)) if in_body && skip_depth == 0 => {
                if let Some(character) = value
                    .resolve_char_ref()
                    .map_err(|error| parse_error(format!("parse FB2 text: {error}")))?
                {
                    block.push(character);
                } else {
                    let name = value
                        .decode()
                        .map_err(|error| parse_error(format!("parse FB2 text: {error}")))?;
                    block.push_str(resolve_predefined_entity(&name).ok_or_else(|| {
                        parse_error(format!("parse FB2 text: invalid character entity &{name};"))
                    })?);
                }
            }
            Ok(Event::End(value)) => match local_name(value.name().as_ref()) {
                b"body" => {
                    flush_fb2_paragraph(&mut block, &mut paragraphs, in_title);
                    in_body = false;
                }
                b"binary" | b"image" | b"stylesheet" | b"description" if in_body => {
                    skip_depth = skip_depth.saturating_sub(1)
                }
                b"title" if in_title => {
                    flush_fb2_paragraph(&mut block, &mut paragraphs, true);
                    in_title = false;
                }
                b"p" | b"section" | b"epigraph" | b"poem" | b"stanza" | b"annotation"
                | b"history"
                    if in_body && skip_depth == 0 =>
                {
                    flush_fb2_paragraph(&mut block, &mut paragraphs, in_title)
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse FB2 text: {error}"))),
        }
    }
    Ok(paragraphs)
}

fn flush_fb2_paragraph(block: &mut String, paragraphs: &mut Vec<DocxParagraph>, heading: bool) {
    let text = block.split_whitespace().collect::<Vec<_>>().join(" ");
    block.clear();
    if !text.is_empty() && paragraphs.len() < MAX_TEXT_PARAGRAPHS {
        paragraphs.push(DocxParagraph {
            text,
            heading_level: usize::from(heading),
            bold: heading,
            ..Default::default()
        });
    }
}

fn extract_mhtml_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let lower = text.to_ascii_lowercase();
    let boundary = lower
        .find("boundary=")
        .and_then(|start| {
            let value = text[start + 9..].trim_start();
            if let Some(value) = value.strip_prefix('"') {
                value.find('"').map(|end| &value[..end])
            } else {
                Some(value.split([';', '\n']).next().unwrap_or_default().trim())
            }
        })
        .filter(|value| !value.is_empty());
    if let Some(boundary) = boundary {
        for part in text.split(&format!("--{boundary}")) {
            let Some((headers, body)) = part.split_once("\n\n") else {
                continue;
            };
            let headers_lower = headers.to_ascii_lowercase();
            if !headers_lower.contains("content-type: text/html") {
                continue;
            }
            let body = if headers_lower.contains("content-transfer-encoding: quoted-printable") {
                decode_quoted_printable(body)
            } else if headers_lower.contains("content-transfer-encoding: base64") {
                decode_base64(body)
                    .map(|bytes| decode_text(&bytes))
                    .unwrap_or_default()
            } else {
                body.to_string()
            };
            return extract_html_paragraphs(&body);
        }
    }
    let start = lower.find("<!doctype html").or_else(|| lower.find("<html"));
    let Some(start) = start else {
        return plain_docx_paragraphs(text);
    };
    let end = lower[start..]
        .find("</html>")
        .map_or(text.len(), |end| start + end + 7);
    extract_html_paragraphs(&text[start..end])
}

fn decode_quoted_printable(text: &str) -> String {
    String::from_utf8_lossy(&decode_quoted_printable_bytes(text)).into_owned()
}

pub(crate) fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0usize;
    let mut encoded = 0usize;
    let mut padding = 0usize;
    let mut finished = false;
    for byte in text.bytes() {
        if byte.is_ascii_whitespace() {
            continue;
        }
        if byte == b'=' {
            finished = true;
            padding += 1;
            if padding > 2 {
                return None;
            }
            continue;
        }
        if finished {
            return None;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        encoded += 1;
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    if encoded % 4 == 1 || (padding > 0 && (encoded + padding) % 4 != 0) {
        return None;
    }
    Some(output)
}

fn decode_mime_header(value: &str) -> String {
    let mut output = String::new();
    let mut remaining = value;
    while let Some(start) = remaining.find("=?") {
        output.push_str(&remaining[..start]);
        let encoded = &remaining[start + 2..];
        let Some(charset_end) = encoded.find('?') else {
            output.push_str(&remaining[start..]);
            return output;
        };
        let after_charset = &encoded[charset_end + 1..];
        let Some(encoding_end) = after_charset.find('?') else {
            output.push_str(&remaining[start..]);
            return output;
        };
        let after_encoding = &after_charset[encoding_end + 1..];
        let Some(value_end) = after_encoding.find("?=") else {
            output.push_str(&remaining[start..]);
            return output;
        };
        let charset = &encoded[..charset_end];
        let encoding = &after_charset[..encoding_end];
        let payload = &after_encoding[..value_end];
        let bytes = if encoding.eq_ignore_ascii_case("b") {
            decode_base64(payload)
        } else if encoding.eq_ignore_ascii_case("q") {
            Some(decode_quoted_printable_bytes(&payload.replace('_', " ")))
        } else {
            None
        };
        let Some(bytes) = bytes else {
            output.push_str("=?");
            remaining = encoded;
            continue;
        };
        if charset.eq_ignore_ascii_case("windows-1252")
            || charset.eq_ignore_ascii_case("iso-8859-1")
        {
            output.extend(bytes.into_iter().map(windows_1252_char));
        } else {
            output.push_str(&decode_text(&bytes));
        }
        remaining = &after_encoding[value_end + 2..];
    }
    output.push_str(remaining);
    output
}

fn decode_quoted_printable_bytes(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'=' {
            if bytes.get(index + 1) == Some(&b'\n') {
                index += 2;
                continue;
            }
            if let (Some(high), Some(low)) = (bytes.get(index + 1), bytes.get(index + 2)) {
                if let (Some(high), Some(low)) = (hex_value(*high), hex_value(*low)) {
                    output.push(high * 16 + low);
                    index += 3;
                    continue;
                }
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    output
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn extract_epub_paragraphs(input: &str) -> Result<Vec<DocxParagraph>, ConvertError> {
    let file =
        File::open(input).map_err(|error| parse_error(format!("open EPUB package: {error}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| parse_error(format!("open EPUB package: {error}")))?;
    if archive.len() > MAX_PACKAGE_ENTRIES {
        return Err(parse_error("EPUB package has too many entries".into()));
    }
    let container = read_epub_entry(&mut archive, "META-INF/container.xml")?;
    let package_path = epub_rootfile(&container)?;
    let package = read_epub_entry(&mut archive, &package_path)?;
    let (manifest, spine) = epub_package_order(&package)?;
    let base = package_path.rsplit_once('/').map_or("", |(base, _)| base);
    let mut paragraphs = Vec::new();
    for id in spine {
        let Some(href) = manifest.get(&id) else {
            continue;
        };
        if href.split('/').any(|part| part == "..") {
            return Err(parse_error(format!("unsafe EPUB content path {href}")));
        }
        let path = if base.is_empty() {
            href.clone()
        } else {
            format!("{base}/{href}")
        };
        let html = read_epub_entry(&mut archive, &path)?;
        paragraphs.extend(extract_html_paragraphs(&html));
        if paragraphs.len() >= MAX_TEXT_PARAGRAPHS {
            paragraphs.truncate(MAX_TEXT_PARAGRAPHS);
            break;
        }
    }
    if paragraphs.is_empty() {
        Err(parse_error(
            "EPUB package has no readable XHTML content".into(),
        ))
    } else {
        Ok(paragraphs)
    }
}

fn read_epub_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<String, ConvertError> {
    let mut entry = archive
        .by_name(name)
        .map_err(|error| parse_error(format!("read EPUB entry {name}: {error}")))?;
    if entry.size() > MAX_ENTRY_BYTES {
        return Err(parse_error(format!("EPUB entry is too large: {name}")));
    }
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| parse_error(format!("read EPUB entry {name}: {error}")))?;
    Ok(decode_text(&bytes))
}

fn epub_rootfile(container: &str) -> Result<String, ConvertError> {
    let mut reader = Reader::from_str(container);
    loop {
        match reader.read_event() {
            Ok(Event::Start(value) | Event::Empty(value))
                if local_name(value.name().as_ref()) == b"rootfile" =>
            {
                return attribute(&value, b"full-path")
                    .filter(|path| !path.split('/').any(|part| part == ".."))
                    .ok_or_else(|| parse_error("EPUB container has no safe rootfile".into()));
            }
            Ok(Event::Eof) => return Err(parse_error("EPUB container has no rootfile".into())),
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse EPUB container: {error}"))),
        }
    }
}

fn epub_package_order(
    package: &str,
) -> Result<(HashMap<String, String>, Vec<String>), ConvertError> {
    let mut reader = Reader::from_str(package);
    let mut manifest = HashMap::new();
    let mut spine = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(value) | Event::Empty(value)) => {
                match local_name(value.name().as_ref()) {
                    b"item" => {
                        if let (Some(id), Some(href)) =
                            (attribute(&value, b"id"), attribute(&value, b"href"))
                        {
                            manifest.insert(id, href);
                        }
                    }
                    b"itemref" => {
                        if let Some(id) = attribute(&value, b"idref") {
                            spine.push(id);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(parse_error(format!("parse EPUB package: {error}"))),
        }
    }
    Ok((manifest, spine))
}

fn structured_lines(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            let continuation = line.trim_start();
            let previous = lines.last_mut().unwrap();
            if previous.ends_with('=')
                && previous[..previous.find(':').unwrap_or(0)]
                    .to_ascii_lowercase()
                    .contains("encoding=quoted-printable")
            {
                previous.pop();
            }
            previous.push_str(continuation);
        } else {
            lines.push(line.trim_end_matches('\r').to_string());
        }
    }
    lines
}

fn structured_property(line: &str) -> Option<(String, String, HashMap<String, Vec<String>>)> {
    let (left, raw_value) = line.split_once(':')?;
    let mut parts = left.split(';');
    let name = parts
        .next()?
        .rsplit('.')
        .next()?
        .trim()
        .to_ascii_uppercase();
    let mut params: HashMap<String, Vec<String>> = HashMap::new();
    for part in parts {
        if let Some((key, values)) = part.split_once('=') {
            params
                .entry(key.trim().to_ascii_uppercase())
                .or_default()
                .extend(
                    values
                        .split(',')
                        .map(|value| value.trim().trim_matches('"').to_string())
                        .filter(|value| !value.is_empty()),
                );
        } else if !part.trim().is_empty() {
            params
                .entry("TYPE".into())
                .or_default()
                .push(part.trim().to_string());
        }
    }
    let encoded = params.get("ENCODING").is_some_and(|values| {
        values.iter().any(|value| {
            value.eq_ignore_ascii_case("quoted-printable") || value.eq_ignore_ascii_case("qp")
        })
    });
    let value = if encoded {
        let bytes = decode_quoted_printable_bytes(raw_value);
        if params
            .get("CHARSET")
            .and_then(|values| values.first())
            .is_some_and(|value| value.eq_ignore_ascii_case("windows-1252"))
        {
            bytes.into_iter().map(windows_1252_char).collect()
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        }
    } else {
        raw_value.trim().to_string()
    };
    Some((name, value, params))
}

fn unescape_structured(value: &str) -> String {
    let mut output = String::new();
    let mut escaped = false;
    for character in value.chars() {
        if escaped {
            match character {
                'n' | 'N' => output.push('\n'),
                ',' | ';' | '\\' => output.push(character),
                _ => output.push(character),
            }
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else {
            output.push(character);
        }
    }
    output
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_calendar_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let mut paragraphs = Vec::new();
    let mut in_event = false;
    for line in structured_lines(text) {
        let Some((name, value, params)) = structured_property(&line) else {
            continue;
        };
        if name == "BEGIN" && value.eq_ignore_ascii_case("VEVENT") {
            in_event = true;
            continue;
        }
        if name == "END" && value.eq_ignore_ascii_case("VEVENT") {
            in_event = false;
            continue;
        }
        if !in_event {
            continue;
        }
        let formatted = match name.as_str() {
            "SUMMARY" => Some(("Summary", unescape_structured(&value))),
            "DTSTART" => Some(("Start", structured_datetime(&value, &params))),
            "DTEND" => Some(("End", structured_datetime(&value, &params))),
            "LOCATION" => Some(("Location", unescape_structured(&value))),
            "DESCRIPTION" => Some(("Description", unescape_structured(&value))),
            "ORGANIZER" => Some(("Organizer", structured_contact(&value, &params))),
            "ATTENDEE" => Some(("Attendee", structured_contact(&value, &params))),
            "STATUS" => Some(("Status", unescape_structured(&value))),
            "CATEGORIES" => Some(("Categories", joined_values(&value, ',', " / "))),
            "URL" => Some(("URL", unescape_structured(&value))),
            "RRULE" => Some(("Recurrence", unescape_structured(&value))),
            _ => None,
        };
        if let Some((label, value)) = formatted {
            paragraphs.push(text_paragraph(format!("{label}: {value}")));
        }
    }
    if paragraphs.is_empty() {
        plain_docx_paragraphs(text)
    } else {
        paragraphs
    }
}

fn structured_datetime(value: &str, params: &HashMap<String, Vec<String>>) -> String {
    if value.len() >= 8 && value[..8].bytes().all(|byte| byte.is_ascii_digit()) {
        let mut output = format!("{}-{}-{}", &value[..4], &value[4..6], &value[6..8]);
        if value.len() >= 15
            && &value[8..9] == "T"
            && value[9..15].bytes().all(|byte| byte.is_ascii_digit())
        {
            output.push_str(&format!(
                " {}:{}:{}",
                &value[9..11],
                &value[11..13],
                &value[13..15]
            ));
            if value.ends_with('Z') {
                output.push_str(" UTC");
            } else if let Some(zone) = params.get("TZID").and_then(|values| values.first()) {
                output.push(' ');
                output.push_str(zone);
            }
        }
        output
    } else {
        unescape_structured(value)
    }
}

fn structured_contact(value: &str, params: &HashMap<String, Vec<String>>) -> String {
    let address = unescape_structured(value);
    let address = address
        .get(..7)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("mailto:"))
        .then(|| address[7..].trim().to_string())
        .unwrap_or(address);
    let name = params
        .get("CN")
        .and_then(|values| values.first())
        .map(|value| unescape_structured(value))
        .unwrap_or_default();
    if name.is_empty() {
        address
    } else if address.is_empty() || name.eq_ignore_ascii_case(&address) {
        name
    } else {
        format!("{name} <{address}>")
    }
}

fn joined_values(value: &str, separator: char, joiner: &str) -> String {
    unescape_structured(value)
        .split(separator)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(joiner)
}

fn extract_vcard_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let mut paragraphs = Vec::new();
    for line in structured_lines(text) {
        let Some((name, value, params)) = structured_property(&line) else {
            continue;
        };
        let typed = |label: &str| {
            let types = params
                .get("TYPE")
                .into_iter()
                .flatten()
                .map(|value| value.to_ascii_lowercase())
                .collect::<Vec<_>>();
            if types.is_empty() {
                label.to_string()
            } else {
                format!("{label} ({})", types.join(" / "))
            }
        };
        let formatted = match name.as_str() {
            "FN" => Some(("Name".into(), unescape_structured(&value))),
            "N" => Some(("Name".into(), joined_values(&value, ';', " "))),
            "ORG" => Some(("Organization".into(), joined_values(&value, ';', " / "))),
            "TITLE" => Some(("Title".into(), unescape_structured(&value))),
            "ROLE" => Some(("Role".into(), unescape_structured(&value))),
            "NICKNAME" => Some(("Nickname".into(), joined_values(&value, ',', " / "))),
            "BDAY" | "ANNIVERSARY" => {
                let label = if name == "BDAY" {
                    "Birthday"
                } else {
                    "Anniversary"
                };
                let value = unescape_structured(&value);
                let value =
                    if value.len() >= 8 && value[..8].bytes().all(|byte| byte.is_ascii_digit()) {
                        format!("{}-{}-{}", &value[..4], &value[4..6], &value[6..8])
                    } else {
                        value
                    };
                Some((label.into(), value))
            }
            "EMAIL" => Some((typed("Email"), unescape_structured(&value))),
            "TEL" => Some((typed("Phone"), unescape_structured(&value))),
            "IMPP" => Some((typed("IM"), unescape_structured(&value))),
            "URL" => Some((typed("URL"), unescape_structured(&value))),
            "ADR" => Some((typed("Address"), joined_values(&value, ';', ", "))),
            "CATEGORIES" => Some(("Categories".into(), joined_values(&value, ',', " / "))),
            "NOTE" => Some(("Note".into(), unescape_structured(&value))),
            _ => None,
        };
        if let Some((label, value)) = formatted {
            paragraphs.push(text_paragraph(format!("{label}: {value}")));
        }
    }
    if paragraphs.is_empty() {
        plain_docx_paragraphs(text)
    } else {
        paragraphs
    }
}

fn text_paragraph(text: String) -> DocxParagraph {
    DocxParagraph {
        text,
        ..Default::default()
    }
}

fn extract_eml_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let Some((headers, body)) = parse_message(text) else {
        return plain_docx_paragraphs(text);
    };
    let mut paragraphs = Vec::new();
    for (name, label) in [
        ("subject", "Subject"),
        ("from", "From"),
        ("to", "To"),
        ("date", "Date"),
    ] {
        if let Some(value) = headers.get(name).filter(|value| !value.trim().is_empty()) {
            paragraphs.push(text_paragraph(format!(
                "{label}: {}",
                decode_mime_header(value.trim())
            )));
        }
    }
    paragraphs.extend(extract_mime_body(&headers, body));
    if paragraphs.is_empty() {
        plain_docx_paragraphs(text)
    } else {
        paragraphs
    }
}

fn parse_message(text: &str) -> Option<(HashMap<String, String>, &str)> {
    let (header_text, body) = text.split_once("\n\n")?;
    let mut headers: HashMap<String, String> = HashMap::new();
    let mut current = String::new();
    for line in header_text.lines() {
        if (line.starts_with(' ') || line.starts_with('\t')) && !current.is_empty() {
            headers
                .entry(current.clone())
                .or_default()
                .push_str(line.trim());
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        current = name.trim().to_ascii_lowercase();
        headers.insert(current.clone(), value.trim().to_string());
    }
    (!headers.is_empty()).then_some((headers, body))
}

fn extract_mime_body(headers: &HashMap<String, String>, body: &str) -> Vec<DocxParagraph> {
    let content_type = headers
        .get("content-type")
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if content_type.starts_with("multipart/") {
        let Some(boundary) = mime_parameter(headers.get("content-type"), "boundary") else {
            return Vec::new();
        };
        let mut plain = Vec::new();
        for part in body.split(&format!("--{boundary}")) {
            let Some((part_headers, part_body)) = parse_message(part.trim()) else {
                continue;
            };
            let part_type = part_headers
                .get("content-type")
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_default();
            let paragraphs = extract_mime_body(&part_headers, part_body);
            if part_type.starts_with("text/html") || part_type.starts_with("application/xhtml+xml")
            {
                if !paragraphs.is_empty() {
                    return paragraphs;
                }
            } else if plain.is_empty()
                && (part_type.is_empty() || part_type.starts_with("text/plain"))
            {
                plain = paragraphs;
            }
        }
        return plain;
    }
    let body = match headers
        .get("content-transfer-encoding")
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("quoted-printable") => decode_quoted_printable(body),
        Some("base64") => decode_base64(body)
            .map(|bytes| decode_text(&bytes))
            .unwrap_or_default(),
        _ => body.trim().to_string(),
    };
    if content_type.starts_with("text/html") || content_type.starts_with("application/xhtml+xml") {
        extract_html_paragraphs(&body)
    } else if content_type.is_empty() || content_type.starts_with("text/plain") {
        plain_docx_paragraphs(&body)
    } else {
        Vec::new()
    }
}

fn mime_parameter(header: Option<&String>, name: &str) -> Option<String> {
    header?
        .split(';')
        .skip(1)
        .find_map(|part| {
            let (key, value) = part.split_once('=')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().trim_matches('"').to_string())
        })
        .filter(|value| !value.is_empty())
}

fn extract_mbox_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let mut messages = Vec::new();
    let mut current = String::new();
    let mut saw_separator = false;
    for line in text.lines() {
        if line.starts_with("From ") {
            if !current.trim().is_empty() {
                messages.push(std::mem::take(&mut current));
            }
            saw_separator = true;
            continue;
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
    }
    if !current.trim().is_empty() {
        messages.push(current);
    }
    if !saw_separator {
        return plain_docx_paragraphs(text);
    }
    let mut paragraphs = Vec::new();
    let multiple = messages.len() > 1;
    for (index, message) in messages.iter().enumerate() {
        if multiple {
            paragraphs.push(text_paragraph(format!("Message {}", index + 1)));
        }
        paragraphs.extend(extract_eml_paragraphs(message.trim()));
    }
    paragraphs.truncate(MAX_TEXT_PARAGRAPHS);
    paragraphs
}

fn notebook_text(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect(),
        _ => String::new(),
    }
}

fn plain_docx_paragraphs(text: &str) -> Vec<DocxParagraph> {
    extract_text_paragraphs(text)
        .into_iter()
        .map(|text| DocxParagraph {
            text,
            ..Default::default()
        })
        .collect()
}

fn is_sbv_timing(line: &str) -> bool {
    let Some((start, end)) = line.split_once(',') else {
        return false;
    };
    [start, end].iter().all(|value| {
        let parts: Vec<_> = value.trim().split(':').collect();
        parts.len() == 3
            && parts[0].bytes().all(|byte| byte.is_ascii_digit())
            && parts[1].bytes().all(|byte| byte.is_ascii_digit())
            && parts[2].split_once('.').is_some_and(|(seconds, millis)| {
                millis.len() == 3
                    && seconds.bytes().all(|byte| byte.is_ascii_digit())
                    && millis.bytes().all(|byte| byte.is_ascii_digit())
            })
    })
}

fn extract_ass_paragraphs(text: &str) -> Vec<DocxParagraph> {
    let mut in_events = false;
    let mut field_count = 10;
    let mut text_index = 9;
    let mut paragraphs = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            in_events = line.eq_ignore_ascii_case("[Events]");
        } else if in_events
            && line
                .get(..7)
                .is_some_and(|value| value.eq_ignore_ascii_case("format:"))
        {
            let fields: Vec<_> = line[7..].split(',').map(str::trim).collect();
            field_count = fields.len();
            text_index = fields
                .iter()
                .position(|field| field.eq_ignore_ascii_case("text"))
                .unwrap_or(9);
        } else if in_events
            && line
                .get(..9)
                .is_some_and(|value| value.eq_ignore_ascii_case("dialogue:"))
        {
            let fields: Vec<_> = line[9..].trim().splitn(field_count, ',').collect();
            if let Some(value) = fields.get(text_index) {
                let text = clean_subtitle_text(
                    &value
                        .replace("\\N", " ")
                        .replace("\\n", " ")
                        .replace("\\h", " "),
                );
                if !text.is_empty() {
                    paragraphs.push(DocxParagraph {
                        text,
                        ..Default::default()
                    });
                }
            }
        }
    }
    paragraphs.truncate(MAX_TEXT_PARAGRAPHS);
    paragraphs
}

fn clean_subtitle_text(line: &str) -> String {
    let mut output = String::new();
    let mut brace_depth = 0;
    let mut tag_depth = 0;
    for character in line.chars() {
        match character {
            '{' if tag_depth == 0 => brace_depth += 1,
            '}' if brace_depth > 0 => brace_depth -= 1,
            '<' if brace_depth == 0 => tag_depth += 1,
            '>' if tag_depth > 0 => tag_depth -= 1,
            _ if brace_depth == 0 && tag_depth == 0 => output.push(character),
            _ => {}
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_markdown_comment<'a>(mut line: &'a str, in_comment: &mut bool) -> String {
    let mut output = String::new();
    loop {
        if *in_comment {
            let Some(end) = line.find("-->") else {
                return output;
            };
            line = &line[end + 3..];
            *in_comment = false;
        }
        let Some(start) = line.find("<!--") else {
            output.push_str(line);
            return output;
        };
        output.push_str(&line[..start]);
        line = &line[start + 4..];
        let Some(end) = line.find("-->") else {
            *in_comment = true;
            return output;
        };
        line = &line[end + 3..];
    }
}

fn markdown_setext_level(line: &str) -> Option<usize> {
    let compact = line.trim();
    let marker = compact.as_bytes().first().copied()?;
    (compact.len() >= 2
        && matches!(marker, b'=' | b'-')
        && compact.bytes().all(|byte| byte == marker))
    .then_some(if marker == b'=' { 1 } else { 2 })
}

fn is_markdown_rule(line: &str) -> bool {
    let compact: String = line.chars().filter(|character| *character != ' ').collect();
    compact.len() >= 3
        && compact.as_bytes().first().is_some_and(|marker| {
            matches!(marker, b'-' | b'*' | b'_') && compact.bytes().all(|byte| byte == *marker)
        })
}

fn is_markdown_table_separator(line: &str) -> bool {
    let compact = line.trim().trim_matches('|').replace(' ', "");
    compact.contains('-')
        && compact.contains('|')
        && compact
            .bytes()
            .all(|byte| matches!(byte, b'-' | b':' | b'|'))
}

fn is_markdown_reference(line: &str) -> bool {
    let Some(end) = line.find("]:") else {
        return false;
    };
    line.starts_with('[') && end > 1
}

fn markdown_heading(line: &str) -> Option<(usize, &str)> {
    let level = line.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&level) || line.as_bytes().get(level) != Some(&b' ') {
        return None;
    }
    Some((level, line[level..].trim().trim_end_matches('#').trim()))
}

fn markdown_list(line: &str) -> Option<(&'static str, &str)> {
    if line.len() >= 2 && matches!(&line[..2], "- " | "* " | "+ ") {
        return Some(("bullet", strip_task_marker(line[2..].trim())));
    }
    let marker_end = line.find(['.', ')'])?;
    if marker_end > 0
        && marker_end <= 9
        && line[..marker_end].bytes().all(|byte| byte.is_ascii_digit())
        && line.as_bytes().get(marker_end + 1) == Some(&b' ')
    {
        return Some(("decimal", strip_task_marker(line[marker_end + 2..].trim())));
    }
    None
}

fn strip_task_marker(text: &str) -> &str {
    if text.len() >= 4
        && text.starts_with('[')
        && text.as_bytes().get(2) == Some(&b']')
        && text.as_bytes().get(3).is_some_and(u8::is_ascii_whitespace)
    {
        text[4..].trim()
    } else {
        text
    }
}

fn markdown_table_row(line: &str) -> String {
    if !line.contains('|') {
        return line.to_string();
    }
    let values: Vec<_> = line
        .trim_matches('|')
        .split('|')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if values.len() > 1 {
        values.join(" / ")
    } else {
        line.to_string()
    }
}

fn strip_inline_markdown(text: &str) -> String {
    let mut text = text
        .replace("**", "")
        .replace("__", "")
        .replace("~~", "")
        .replace("==", "")
        .replace('`', "")
        .replace("![", "[");
    text = strip_bracket_suffix(&text, "](", ')');
    text = strip_bracket_suffix(&text, "][", ']');
    text = strip_footnotes(&text);
    text = strip_inline_html(&text);
    text.trim_matches(['*', '_'])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn strip_bracket_suffix(text: &str, separator: &str, close: char) -> String {
    let mut output = String::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        output.push_str(&rest[..open]);
        let Some(split) = rest[open + 1..].find(separator) else {
            output.push_str(&rest[open..]);
            return output;
        };
        let split = open + 1 + split;
        let Some(end) = rest[split + separator.len()..].find(close) else {
            output.push_str(&rest[open..]);
            return output;
        };
        output.push_str(&rest[open + 1..split]);
        rest = &rest[split + separator.len() + end + close.len_utf8()..];
    }
    output.push_str(rest);
    output
}

fn strip_footnotes(text: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("[^") {
        output.push_str(&rest[..start]);
        let Some(end) = rest[start + 2..].find(']') else {
            output.push_str(&rest[start..]);
            return output;
        };
        rest = &rest[start + end + 3..];
    }
    output.push_str(rest);
    output
}

fn strip_inline_html(text: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        output.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('>') else {
            output.push_str(&rest[start..]);
            return output;
        };
        let tag = &rest[start + 1..start + end];
        if tag.trim_start().starts_with("br") {
            output.push(' ');
        } else if tag.trim_start().starts_with("img") {
            if let Some(alt) = html_attribute(tag, "alt") {
                output.push_str(alt);
            }
        }
        rest = &rest[start + end + 1..];
    }
    output.push_str(rest);
    output
}

fn html_attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let start = tag.find(&format!("{name}=\""))? + name.len() + 2;
    let end = tag[start..].find('"')?;
    Some(&tag[start..start + end])
}

fn write_docx(output: &str, paragraphs: &[DocxParagraph]) -> Result<(), ConvertError> {
    write_docx_with_section(output, paragraphs, DocxSection::default())
}

fn write_docx_with_section(
    output: &str,
    paragraphs: &[DocxParagraph],
    section: DocxSection,
) -> Result<(), ConvertError> {
    write_docx_with_sections(
        output,
        paragraphs,
        &[WordBinarySection {
            cp_end: i32::MAX,
            properties: section,
        }],
    )
}

fn write_docx_with_sections(
    output: &str,
    paragraphs: &[DocxParagraph],
    sections: &[WordBinarySection],
) -> Result<(), ConvertError> {
    write_docx_with_sections_and_headers(output, paragraphs, sections, &[])
}

fn write_docx_with_sections_and_headers(
    output: &str,
    paragraphs: &[DocxParagraph],
    sections: &[WordBinarySection],
    headers: &[WordBinaryHeaderFooter],
) -> Result<(), ConvertError> {
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error(format!("create output directory: {error}")))?;
    }
    let file =
        File::create(output).map_err(|error| io_error(format!("create output file: {error}")))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let has_numbering = paragraphs
        .iter()
        .any(|paragraph| !paragraph.list_kind.is_empty());
    let images = paragraphs
        .iter()
        .flat_map(|paragraph| paragraph.runs.iter())
        .filter_map(|run| run.image.as_ref())
        .cloned()
        .collect::<Vec<_>>();
    let body_image_count = images.len();
    let mut images = images;
    for record in headers {
        images.extend(
            record
                .paragraphs
                .iter()
                .flat_map(|paragraph| paragraph.runs.iter())
                .filter_map(|run| run.image.as_ref())
                .cloned(),
        );
    }
    let mut files = vec![
        (
            "[Content_Types].xml",
            docx_content_types(has_numbering, &images, headers),
        ),
        ("_rels/.rels", docx_root_relationships()),
        (
            "word/_rels/document.xml.rels",
            docx_document_relationships(has_numbering, &images, headers),
        ),
        ("word/styles.xml", docx_styles()),
        (
            "word/document.xml",
            docx_document_with_sections_and_headers(paragraphs, sections, headers),
        ),
    ];
    if has_numbering {
        files.push(("word/numbering.xml", docx_numbering(paragraphs)));
    }
    if docx_uses_even_headers(headers) {
        files.push(("word/settings.xml", docx_settings()));
    }
    for (name, content) in files {
        writer
            .start_file(name, options)
            .map_err(|error| io_error(format!("create output entry {name}: {error}")))?;
        writer
            .write_all(content.as_bytes())
            .map_err(|error| io_error(format!("write output entry {name}: {error}")))?;
    }
    for (index, image) in images.iter().enumerate() {
        let name = format!("word/media/image{}.{}", index + 1, image.extension);
        writer
            .start_file(&name, options)
            .map_err(|error| io_error(format!("create output entry {name}: {error}")))?;
        writer
            .write_all(&image.data)
            .map_err(|error| io_error(format!("write output entry {name}: {error}")))?;
    }
    let mut header_image_start = body_image_count;
    for (index, record) in headers.iter().enumerate() {
        let part = format!(
            "word/{}{}.xml",
            if record.kind.ends_with("Header") {
                "header"
            } else {
                "footer"
            },
            index + 1
        );
        writer
            .start_file(&part, options)
            .map_err(|error| io_error(format!("create output entry {part}: {error}")))?;
        writer
            .write_all(docx_header_footer_xml(record).as_bytes())
            .map_err(|error| io_error(format!("write output entry {part}: {error}")))?;
        let image_count = docx_header_footer_image_count(record);
        if image_count > 0 {
            let rels_part = format!(
                "word/_rels/{}{}.xml.rels",
                if record.kind.ends_with("Header") {
                    "header"
                } else {
                    "footer"
                },
                index + 1
            );
            writer
                .start_file(&rels_part, options)
                .map_err(|error| io_error(format!("create output entry {rels_part}: {error}")))?;
            writer
                .write_all(docx_header_footer_relationships(record, header_image_start).as_bytes())
                .map_err(|error| io_error(format!("write output entry {rels_part}: {error}")))?;
            header_image_start = header_image_start.saturating_add(image_count);
        }
    }
    writer
        .finish()
        .map_err(|error| io_error(format!("close output archive: {error}")))?;
    Ok(())
}

fn docx_content_types(
    has_numbering: bool,
    images: &[DocxImage],
    headers: &[WordBinaryHeaderFooter],
) -> String {
    let mut image_defaults = String::new();
    let mut seen = HashSet::new();
    for image in images {
        if seen.insert(image.extension) {
            image_defaults.push_str(&format!(
                "  <Default Extension=\"{}\" ContentType=\"{}\"/>\n",
                image.extension, image.content_type
            ));
        }
    }
    let mut parts = String::new();
    for (index, record) in headers.iter().enumerate() {
        let (name, content_type) = if record.kind.ends_with("Header") {
            (
                "header",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
            )
        } else {
            (
                "footer",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
            )
        };
        parts.push_str(&format!(
            "  <Override PartName=\"/word/{}{}.xml\" ContentType=\"{}\"/>\n",
            name,
            index + 1,
            content_type
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
{image_defaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
{}{}{parts}</Types>"#,
        if has_numbering {
            "  <Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>\n"
        } else {
            ""
        },
        if docx_uses_even_headers(headers) {
            "  <Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>\n"
        } else {
            ""
        }
    )
}

fn docx_root_relationships() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#.into()
}

fn docx_document_relationships(
    has_numbering: bool,
    images: &[DocxImage],
    headers: &[WordBinaryHeaderFooter],
) -> String {
    let mut relationships = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
"#,
    );
    if has_numbering {
        relationships.push_str(
            "  <Relationship Id=\"rIdNumbering\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/>\n",
        );
    }
    if docx_uses_even_headers(headers) {
        relationships.push_str(
            "  <Relationship Id=\"rIdSettings\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>\n",
        );
    }
    for (index, image) in images.iter().enumerate() {
        relationships.push_str(&format!(
            "  <Relationship Id=\"rIdImage{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image{}.{}\"/>\n",
            index + 1,
            index + 1,
            image.extension
        ));
    }
    for (index, record) in headers.iter().enumerate() {
        let (id_prefix, target_prefix) = if record.kind.ends_with("Header") {
            ("Header", "header")
        } else {
            ("Footer", "footer")
        };
        relationships.push_str(&format!(
            "  <Relationship Id=\"rId{}{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/{}\" Target=\"{}{}.xml\"/>\n",
            id_prefix,
            index + 1,
            target_prefix,
            target_prefix,
            index + 1
        ));
    }
    relationships.push_str("</Relationships>");
    relationships
}

fn docx_uses_even_headers(headers: &[WordBinaryHeaderFooter]) -> bool {
    headers
        .iter()
        .any(|record| matches!(record.kind, "evenHeader" | "evenFooter"))
}

fn docx_settings() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:evenAndOddHeaders/>
</w:settings>"#
        .into()
}

fn docx_numbering(paragraphs: &[DocxParagraph]) -> String {
    let mut body = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
"#,
    );
    for level in 0..=8 {
        let left = 720 + level * 360;
        body.push_str(&format!(
            "    <w:lvl w:ilvl=\"{level}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/><w:lvlText w:val=\"•\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{left}\" w:hanging=\"360\"/></w:pPr></w:lvl>\n"
        ));
    }
    body.push_str(
        r#"  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:multiLevelType w:val="hybridMultilevel"/>
"#,
    );
    for level in 0..=8 {
        let left = 720 + level * 360;
        let marker = format!("%{}.", level + 1);
        body.push_str(&format!(
            "    <w:lvl w:ilvl=\"{level}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"decimal\"/><w:lvlText w:val=\"{marker}\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{left}\" w:hanging=\"360\"/></w:pPr></w:lvl>\n"
        ));
    }
    body.push_str("  </w:abstractNum>\n  <w:num w:numId=\"1\"><w:abstractNumId w:val=\"1\"/></w:num>\n  <w:num w:numId=\"2\"><w:abstractNumId w:val=\"2\"/></w:num>\n");
    let mut list_ids = paragraphs
        .iter()
        .filter(|paragraph| !paragraph.list_kind.is_empty() && paragraph.list_id > 0)
        .map(|paragraph| paragraph.list_id)
        .collect::<Vec<_>>();
    list_ids.sort_unstable();
    list_ids.dedup();
    for list_id in list_ids {
        body.push_str(&format!(
            "  <w:num w:numId=\"{}\"><w:abstractNumId w:val=\"2\"/></w:num>\n",
            list_id.saturating_add(10)
        ));
    }
    body.push_str("</w:numbering>");
    body
}

fn docx_styles() -> String {
    let mut styles = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
"#,
    );
    for level in 1..=6 {
        let size = (32 - (level - 1) * 2).max(22);
        styles.push_str(&format!(
            r#"  <w:style w:type="paragraph" w:styleId="Heading{level}">
    <w:name w:val="heading {level}"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:outlineLvl w:val="{}"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="{size}"/></w:rPr>
  </w:style>
"#,
            level - 1
        ));
    }
    styles.push_str("</w:styles>");
    styles
}

fn docx_border_xml(side: &str, border: DocxPageBorder) -> String {
    let color = border
        .color
        .map(word_binary_rgb_hex)
        .unwrap_or_else(|| "auto".into());
    format!(
        "<w:{side} w:val=\"{}\" w:sz=\"{}\" w:space=\"{}\" w:color=\"{}\"{}{}/>",
        border.style,
        border.size,
        border.space,
        color,
        if border.shadow { " w:shadow=\"1\"" } else { "" },
        if border.frame { " w:frame=\"1\"" } else { "" },
    )
}

fn docx_table_borders_xml(
    source_borders: Option<[Option<DocxPageBorder>; 6]>,
    explicit_cell_borders: bool,
) -> String {
    if let Some(source_borders) = source_borders {
        let mut xml = String::from("<w:tblBorders>");
        for (side, border) in ["top", "left", "bottom", "right", "insideH", "insideV"]
            .into_iter()
            .zip(source_borders)
        {
            if let Some(border) = border {
                xml.push_str(&docx_border_xml(side, border));
            } else {
                xml.push_str(&format!("<w:{side} w:val=\"nil\"/>"));
            }
        }
        xml.push_str("</w:tblBorders>");
        return xml;
    }
    let value = if explicit_cell_borders {
        "nil"
    } else {
        "single"
    };
    let size = if explicit_cell_borders {
        ""
    } else {
        " w:sz=\"4\""
    };
    format!(
        "<w:tblBorders><w:top w:val=\"{value}\"{size}/><w:left w:val=\"{value}\"{size}/><w:bottom w:val=\"{value}\"{size}/><w:right w:val=\"{value}\"{size}/><w:insideH w:val=\"{value}\"{size}/><w:insideV w:val=\"{value}\"{size}/></w:tblBorders>"
    )
}

fn docx_cell_borders_xml(paragraph: &DocxParagraph) -> String {
    if !paragraph.table_cell_borders_explicit {
        return String::new();
    }
    let mut xml = String::from("<w:tcBorders>");
    for (side, border) in ["top", "left", "bottom", "right"]
        .into_iter()
        .zip(paragraph.table_cell_borders)
    {
        if let Some(border) = border {
            xml.push_str(&docx_border_xml(side, border));
        } else {
            xml.push_str(&format!("<w:{side} w:val=\"nil\"/>"));
        }
    }
    xml.push_str("</w:tcBorders>");
    xml
}

fn docx_cell_margins_xml(paragraph: &DocxParagraph) -> String {
    if paragraph.table_cell_margins.iter().all(Option::is_none) {
        return String::new();
    }
    let mut xml = String::from("<w:tcMar>");
    for (side, width) in ["top", "left", "bottom", "right"]
        .into_iter()
        .zip(paragraph.table_cell_margins)
    {
        if let Some(width) = width {
            xml.push_str(&format!(
                "<w:{side} w:w=\"{}\" w:type=\"dxa\"/>",
                width.max(0)
            ));
        }
    }
    xml.push_str("</w:tcMar>");
    xml
}

fn docx_table_row_properties_xml(paragraphs: &[DocxParagraph], start: usize) -> String {
    let row = paragraphs
        .iter()
        .skip(start)
        .take_while(|paragraph| paragraph.table_cell)
        .take_while(|paragraph| !paragraph.table_row_end)
        .chain(
            paragraphs
                .iter()
                .skip(start)
                .take_while(|paragraph| paragraph.table_cell)
                .find(|paragraph| paragraph.table_row_end)
                .into_iter(),
        )
        .find(|paragraph| {
            paragraph.table_row_height != 0
                || paragraph.table_row_cant_split
                || paragraph.table_row_header
        });
    let Some(row) = row else {
        return String::new();
    };
    let mut xml = String::from("<w:trPr>");
    if row.table_row_cant_split {
        xml.push_str("<w:cantSplit/>");
    }
    if row.table_row_height != 0 {
        xml.push_str(&format!(
            "<w:trHeight w:val=\"{}\" w:hRule=\"{}\"/>",
            row.table_row_height.unsigned_abs(),
            if row.table_row_height < 0 {
                "exact"
            } else {
                "atLeast"
            },
        ));
    }
    if row.table_row_header {
        xml.push_str("<w:tblHeader/>");
    }
    xml.push_str("</w:trPr>");
    xml
}

fn docx_table_grid_xml(bounds: &[i16], fallback_width: i32, fallback_columns: usize) -> String {
    let mut grid = String::from("<w:tblGrid>");
    if bounds.len() >= 2 {
        for pair in bounds.windows(2) {
            let width = i32::from(pair[1]).saturating_sub(i32::from(pair[0])).max(1);
            grid.push_str(&format!("<w:gridCol w:w=\"{width}\"/>"));
        }
    } else {
        let columns = fallback_columns.max(1);
        let base = fallback_width.max(columns as i32) / columns as i32;
        let remainder = fallback_width.max(columns as i32) - base * columns as i32;
        for index in 0..columns {
            let width = base + if index < remainder as usize { 1 } else { 0 };
            grid.push_str(&format!("<w:gridCol w:w=\"{}\"/>", width.max(1)));
        }
    }
    grid.push_str("</w:tblGrid>");
    grid
}

fn docx_table_default_width(section: DocxSection) -> i32 {
    i32::try_from(section.page_width)
        .unwrap_or(i32::MAX)
        .saturating_sub(section.margin_left)
        .saturating_sub(section.margin_right)
        .saturating_sub(section.gutter)
        .max(1)
}

fn docx_table_column_count(paragraphs: &[DocxParagraph], start: usize) -> usize {
    let mut maximum = 0usize;
    let mut current = 0usize;
    for paragraph in paragraphs.iter().skip(start) {
        if !paragraph.table_cell {
            break;
        }
        if paragraph.table_cell_merged {
            if paragraph.table_row_end {
                maximum = maximum.max(current);
                current = 0;
            }
            continue;
        }
        current = current.saturating_add(paragraph.table_grid_span.max(1));
        if paragraph.table_row_end {
            maximum = maximum.max(current);
            current = 0;
        }
    }
    maximum.max(current).max(1)
}

fn docx_table_bounds(paragraphs: &[DocxParagraph], start: usize) -> Vec<i16> {
    let mut bounds = paragraphs
        .iter()
        .skip(start)
        .take_while(|paragraph| paragraph.table_cell)
        .filter(|paragraph| !paragraph.table_cell_merged)
        .flat_map(|paragraph| paragraph.table_grid_bounds.iter().copied())
        .collect::<Vec<_>>();
    bounds.sort_unstable();
    bounds.dedup();
    bounds
}

#[cfg(test)]
fn docx_document(paragraphs: &[DocxParagraph], section: DocxSection) -> String {
    docx_document_with_sections(
        paragraphs,
        &[WordBinarySection {
            cp_end: i32::MAX,
            properties: section,
        }],
    )
}

fn append_docx_section_breaks(
    body: &mut String,
    cp: i32,
    sections: &[WordBinarySection],
    next_section: &mut usize,
    headers: &[WordBinaryHeaderFooter],
) {
    while *next_section + 1 < sections.len() && cp > 0 && cp >= sections[*next_section].cp_end {
        body.push_str("    <w:p><w:pPr>");
        body.push_str(&docx_section_properties_xml(
            sections[*next_section].properties,
            *next_section,
            headers,
        ));
        body.push_str("</w:pPr></w:p>\n");
        *next_section += 1;
    }
}

fn docx_section_properties_xml(
    section: DocxSection,
    section_index: usize,
    headers: &[WordBinaryHeaderFooter],
) -> String {
    let orientation = if section.landscape {
        " w:orient=\"landscape\""
    } else {
        ""
    };
    let mut xml = String::from("<w:sectPr>");
    // Header/footer references precede page properties in CT_SectPr.
    for kind in [
        "evenHeader",
        "defaultHeader",
        "firstHeader",
        "evenFooter",
        "defaultFooter",
        "firstFooter",
    ] {
        let Some((index, record)) = headers
            .iter()
            .enumerate()
            .filter(|(_, record)| record.kind == kind && record.section_index <= section_index)
            .max_by_key(|(_, record)| record.section_index)
        else {
            continue;
        };
        let (tag, type_name) = if record.kind.ends_with("Header") {
            ("headerReference", record.kind.trim_end_matches("Header"))
        } else {
            ("footerReference", record.kind.trim_end_matches("Footer"))
        };
        xml.push_str(&format!(
            "<w:{} w:type=\"{}\" r:id=\"rId{}{}\"/>",
            tag,
            match type_name {
                "even" => "even",
                "first" => "first",
                _ => "default",
            },
            if record.kind.ends_with("Header") {
                "Header"
            } else {
                "Footer"
            },
            index + 1,
        ));
    }
    xml.push_str(&format!(
        "<w:type w:val=\"{}\"/><w:pgSz w:w=\"{}\" w:h=\"{}\"{} /><w:pgMar w:top=\"{}\" w:right=\"{}\" w:bottom=\"{}\" w:left=\"{}\" w:header=\"{}\" w:footer=\"{}\" w:gutter=\"{}\" />",
        section.section_type,
        section.page_width,
        section.page_height,
        orientation,
        section.margin_top,
        section.margin_right,
        section.margin_bottom,
        section.margin_left,
        section.margin_header,
        section.margin_footer,
        section.gutter,
    ));
    let borders = [
        ("top", section.page_border_top),
        ("left", section.page_border_left),
        ("bottom", section.page_border_bottom),
        ("right", section.page_border_right),
    ];
    if borders.iter().any(|(_, border)| border.is_some()) {
        xml.push_str(&format!(
            "<w:pgBorders w:display=\"{}\" w:offsetFrom=\"{}\" w:zOrder=\"{}\">",
            section.page_border_display,
            section.page_border_offset_from,
            section.page_border_z_order,
        ));
        for (side, border) in borders {
            if let Some(border) = border {
                xml.push_str(&docx_border_xml(side, border));
            }
        }
        xml.push_str("</w:pgBorders>");
    }
    if section.columns > 1 || section.column_separator || section.column_rtl {
        xml.push_str(&format!(
            "<w:cols w:num=\"{}\" w:space=\"{}\"{}{} />",
            section.columns.max(1),
            section.column_spacing.max(0),
            if section.column_separator {
                " w:sep=\"1\""
            } else {
                ""
            },
            if section.column_rtl {
                " w:rtl=\"1\""
            } else {
                ""
            },
        ));
    }
    if section.title_page {
        xml.push_str("<w:titlePg/>");
    }
    xml.push_str("</w:sectPr>");
    xml
}

#[cfg(test)]
fn docx_document_with_sections(
    paragraphs: &[DocxParagraph],
    sections: &[WordBinarySection],
) -> String {
    docx_document_with_sections_and_headers(paragraphs, sections, &[])
}

fn docx_document_with_sections_and_headers(
    paragraphs: &[DocxParagraph],
    sections: &[WordBinarySection],
    headers: &[WordBinaryHeaderFooter],
) -> String {
    let mut body = String::new();
    let mut image_id = 0usize;
    let mut table_open = false;
    let mut row_open = false;
    let mut table_columns = 1usize;
    let mut table_bounds = Vec::new();
    let mut next_section = 0usize;
    let final_section = sections
        .last()
        .map(|section| section.properties)
        .unwrap_or_default();
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        if paragraph.table_cell_merged {
            continue;
        }
        if paragraph.table_cell
            && (paragraph.last_rendered_page_break_before || paragraph.page_break_before)
        {
            if row_open {
                body.push_str("      </w:tr>\n");
                row_open = false;
            }
            if table_open {
                body.push_str("    </w:tbl>\n");
                table_open = false;
                table_columns = 1;
                table_bounds.clear();
            }
            body.push_str("    <w:p><w:r><w:lastRenderedPageBreak/></w:r></w:p>\n");
        }
        if paragraph.table_cell {
            if !table_open {
                let table_section = sections
                    .iter()
                    .find(|candidate| paragraph.source_cp_start <= candidate.cp_end)
                    .map(|candidate| candidate.properties)
                    .unwrap_or(final_section);
                let fallback_width = docx_table_default_width(table_section);
                table_bounds = docx_table_bounds(paragraphs, paragraph_index);
                let fallback_columns = docx_table_column_count(paragraphs, paragraph_index);
                table_columns = table_bounds
                    .len()
                    .saturating_sub(1)
                    .max(fallback_columns)
                    .max(1);
                let width = table_bounds
                    .first()
                    .zip(table_bounds.last())
                    .map(|(left, right)| i32::from(*right).saturating_sub(i32::from(*left)).max(1))
                    .unwrap_or(fallback_width);
                let explicit_cell_borders = paragraphs
                    .iter()
                    .skip(paragraph_index)
                    .take_while(|candidate| candidate.table_cell)
                    .any(|candidate| candidate.table_cell_borders_explicit);
                let source_table_borders = paragraphs
                    .iter()
                    .skip(paragraph_index)
                    .take_while(|candidate| candidate.table_cell)
                    .find_map(|candidate| candidate.table_borders);
                let table_alignment = paragraphs
                    .iter()
                    .skip(paragraph_index)
                    .take_while(|candidate| candidate.table_cell)
                    .find_map(|candidate| {
                        (!candidate.table_alignment.is_empty()).then_some(candidate.table_alignment)
                    })
                    .map(|alignment| format!("<w:jc w:val=\"{alignment}\"/>"))
                    .unwrap_or_default();
                let table_indent = table_bounds
                    .first()
                    .copied()
                    .filter(|value| *value != 0)
                    .map(|value| format!("<w:tblInd w:w=\"{value}\" w:type=\"dxa\"/>"))
                    .unwrap_or_default();
                body.push_str(&format!(
                    "    <w:tbl><w:tblPr><w:tblW w:w=\"{width}\" w:type=\"dxa\"/>{table_alignment}{table_indent}{}<w:tblLayout w:type=\"fixed\"/></w:tblPr>{}\n",
                    docx_table_borders_xml(source_table_borders, explicit_cell_borders),
                    docx_table_grid_xml(&table_bounds, width, table_columns)
                ));
                table_open = true;
            }
            if !row_open {
                body.push_str("      <w:tr>");
                body.push_str(&docx_table_row_properties_xml(paragraphs, paragraph_index));
                body.push('\n');
                row_open = true;
            }
            body.push_str("        <w:tc>");
            body.push_str("<w:tcPr>");
            let table_section = sections
                .iter()
                .find(|candidate| paragraph.source_cp_start <= candidate.cp_end)
                .map(|candidate| candidate.properties)
                .unwrap_or(final_section);
            let fallback_width = docx_table_default_width(table_section);
            let span = paragraph.table_grid_span.max(1);
            let cell_width = if paragraph.table_cell_preferred_width > 0 {
                i32::from(paragraph.table_cell_preferred_width)
            } else {
                paragraph
                    .table_grid_bounds
                    .first()
                    .zip(paragraph.table_grid_bounds.last())
                    .map(|(left, right)| {
                        if paragraph.table_grid_left != paragraph.table_grid_right {
                            i32::from(paragraph.table_grid_right)
                                .saturating_sub(i32::from(paragraph.table_grid_left))
                        } else {
                            i32::from(*right).saturating_sub(i32::from(*left))
                        }
                    })
                    .unwrap_or_else(|| fallback_width / table_columns.max(1) as i32 * span as i32)
                    .max(1)
            };
            body.push_str(&format!("<w:tcW w:w=\"{cell_width}\" w:type=\"dxa\"/>"));
            if span > 1 {
                body.push_str(&format!("<w:gridSpan w:val=\"{span}\"/>"));
            }
            match paragraph.table_v_merge {
                "restart" => body.push_str("<w:vMerge w:val=\"restart\"/>"),
                "continue" => body.push_str("<w:vMerge/>"),
                _ => {}
            }
            body.push_str(&docx_cell_borders_xml(paragraph));
            if paragraph.table_cell_no_wrap {
                body.push_str("<w:noWrap/>");
            }
            body.push_str(&docx_cell_margins_xml(paragraph));
            if !paragraph.table_cell_text_direction.is_empty() {
                body.push_str(&format!(
                    "<w:textDirection w:val=\"{}\"/>",
                    paragraph.table_cell_text_direction
                ));
            }
            if paragraph.table_cell_fit_text {
                body.push_str("<w:tcFitText/>");
            }
            if !paragraph.table_cell_vertical_align.is_empty() {
                body.push_str(&format!(
                    "<w:vAlign w:val=\"{}\"/>",
                    paragraph.table_cell_vertical_align
                ));
            }
            body.push_str("</w:tcPr>");
            body.push('\n');
            body.push_str(&docx_paragraph_xml(paragraph, &mut image_id, "          "));
            body.push_str("        </w:tc>\n");
            if paragraph.table_row_end {
                body.push_str("      </w:tr>\n");
                row_open = false;
            }
            continue;
        }
        if row_open {
            body.push_str("      </w:tr>\n");
            row_open = false;
        }
        if table_open {
            body.push_str("    </w:tbl>\n");
            table_open = false;
            table_columns = 1;
            table_bounds.clear();
        }
        append_docx_section_breaks(
            &mut body,
            paragraph.source_cp_start,
            sections,
            &mut next_section,
            headers,
        );
        body.push_str(&docx_paragraph_xml(paragraph, &mut image_id, "    "));
        append_docx_section_breaks(
            &mut body,
            paragraph.source_cp_end,
            sections,
            &mut next_section,
            headers,
        );
    }
    if row_open {
        body.push_str("      </w:tr>\n");
    }
    if table_open {
        body.push_str("    </w:tbl>\n");
    }
    while next_section + 1 < sections.len() {
        body.push_str("    <w:p><w:pPr>");
        body.push_str(&docx_section_properties_xml(
            sections[next_section].properties,
            next_section,
            headers,
        ));
        body.push_str("</w:pPr></w:p>\n");
        next_section += 1;
    }
    let final_section_xml =
        docx_section_properties_xml(final_section, sections.len().saturating_sub(1), headers);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
{body}    {}
</w:body>
</w:document>"#,
        final_section_xml
    )
}

fn append_docx_rendered_page_break(body: &mut String, indent: &str) {
    body.push_str(indent);
    body.push_str("  <w:r><w:lastRenderedPageBreak/></w:r>\n");
}

fn append_docx_text_run(body: &mut String, indent: &str, properties: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    body.push_str(indent);
    body.push_str("  <w:r>");
    body.push_str(properties);
    body.push_str(&word_text_xml(text));
    body.push_str("</w:r>\n");
}

fn docx_paragraph_xml(paragraph: &DocxParagraph, image_id: &mut usize, indent: &str) -> String {
    let mut body = String::new();
    body.push_str(indent);
    body.push_str("<w:p>\n");
    if paragraph.heading_level > 0
        || !paragraph.alignment.is_empty()
        || !paragraph.list_kind.is_empty()
        || paragraph.spacing_before > 0
        || paragraph.spacing_after > 0
        || paragraph.line_spacing > 0
        || paragraph.indent_left != 0
        || paragraph.indent_right != 0
        || paragraph.first_line_indent != 0
        || !paragraph.shading.is_empty()
        || paragraph.keep_next
        || paragraph.keep_lines
        || paragraph.page_break_before
        || paragraph.bidi
    {
        body.push_str(indent);
        body.push_str("  <w:pPr>");
        if !paragraph.shading.is_empty() {
            body.push_str(&format!(
                "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{}\"/>",
                paragraph.shading
            ));
        }
        if paragraph.spacing_before > 0 || paragraph.spacing_after > 0 || paragraph.line_spacing > 0
        {
            body.push_str("<w:spacing");
            if paragraph.spacing_before > 0 {
                body.push_str(&format!(" w:before=\"{}\"", paragraph.spacing_before));
            }
            if paragraph.spacing_after > 0 {
                body.push_str(&format!(" w:after=\"{}\"", paragraph.spacing_after));
            }
            if paragraph.line_spacing > 0 {
                body.push_str(&format!(
                    " w:line=\"{}\" w:lineRule=\"{}\"",
                    paragraph.line_spacing,
                    if paragraph.line_spacing_rule.is_empty() {
                        "auto"
                    } else {
                        paragraph.line_spacing_rule
                    }
                ));
            }
            body.push_str("/>");
        }
        if paragraph.keep_next {
            body.push_str("<w:keepNext/>");
        }
        if paragraph.keep_lines {
            body.push_str("<w:keepLines/>");
        }
        if paragraph.page_break_before {
            body.push_str("<w:pageBreakBefore/>");
        }
        if paragraph.bidi {
            body.push_str("<w:bidi/>");
        }
        if paragraph.indent_left != 0
            || paragraph.indent_right != 0
            || paragraph.first_line_indent != 0
        {
            body.push_str("<w:ind");
            if paragraph.indent_left != 0 {
                body.push_str(&format!(" w:left=\"{}\"", paragraph.indent_left));
            }
            if paragraph.indent_right != 0 {
                body.push_str(&format!(" w:right=\"{}\"", paragraph.indent_right));
            }
            if paragraph.first_line_indent > 0 {
                body.push_str(&format!(" w:firstLine=\"{}\"", paragraph.first_line_indent));
            } else if paragraph.first_line_indent < 0 {
                body.push_str(&format!(
                    " w:hanging=\"{}\"",
                    paragraph.first_line_indent.saturating_abs()
                ));
            }
            body.push_str("/>");
        }
        if paragraph.heading_level > 0 {
            body.push_str(&format!(
                "<w:pStyle w:val=\"Heading{}\"/>",
                paragraph.heading_level.min(6)
            ));
        }
        if !paragraph.alignment.is_empty() {
            body.push_str(&format!("<w:jc w:val=\"{}\"/>", paragraph.alignment));
        }
        if !paragraph.list_kind.is_empty() {
            let num_id = if paragraph.list_kind == "bullet" {
                1
            } else if paragraph.list_id > 0 {
                paragraph.list_id.saturating_add(10)
            } else {
                2
            };
            body.push_str(&format!(
                "<w:numPr><w:ilvl w:val=\"{}\"/><w:numId w:val=\"{}\"/></w:numPr>",
                paragraph.list_level.min(8),
                num_id
            ));
        }
        body.push_str("</w:pPr>\n");
    }
    if (paragraph.last_rendered_page_break_before || paragraph.page_break_before)
        && !paragraph.table_cell
    {
        append_docx_rendered_page_break(&mut body, indent);
    }
    let mut break_offsets = paragraph.rendered_page_break_offsets.iter().peekable();
    let mut text_offset = 0usize;
    if paragraph.runs.is_empty() {
        let properties = if paragraph.bold {
            "<w:rPr><w:b/></w:rPr>"
        } else {
            ""
        };
        let chars = paragraph.text.chars().collect::<Vec<_>>();
        let mut start = 0usize;
        while let Some(offset) = break_offsets.next_if(|offset| **offset < chars.len()) {
            let end = (*offset).max(start).min(chars.len());
            append_docx_text_run(
                &mut body,
                indent,
                properties,
                &chars[start..end].iter().collect::<String>(),
            );
            append_docx_rendered_page_break(&mut body, indent);
            start = end;
        }
        append_docx_text_run(
            &mut body,
            indent,
            properties,
            &chars[start..].iter().collect::<String>(),
        );
    } else {
        for run in &paragraph.runs {
            while break_offsets
                .peek()
                .is_some_and(|offset| **offset <= text_offset)
            {
                break_offsets.next();
                append_docx_rendered_page_break(&mut body, indent);
            }
            let run_length = run.text.chars().count();
            if !run.field_instruction.is_empty() {
                body.push_str(indent);
                body.push_str(&format!(
                    "  <w:r><w:fldChar w:fldCharType=\"begin\" w:dirty=\"true\"/></w:r><w:r><w:instrText xml:space=\"preserve\">{}</w:instrText></w:r><w:r><w:fldChar w:fldCharType=\"separate\"/></w:r><w:r>{}{}</w:r><w:r><w:fldChar w:fldCharType=\"end\"/></w:r>\n",
                    escape(&run.field_instruction),
                    docx_run_properties(run),
                    word_text_xml(&run.text),
                ));
                text_offset = text_offset.saturating_add(run_length);
                continue;
            }
            if let Some(image) = run.image.as_ref() {
                *image_id += 1;
                body.push_str(indent);
                body.push_str("  <w:r>");
                body.push_str(&docx_inline_image(image, *image_id));
                body.push_str("</w:r>\n");
                continue;
            }
            let properties = docx_run_properties(run);
            let chars = run.text.chars().collect::<Vec<_>>();
            let mut start = 0usize;
            while let Some(offset) =
                break_offsets.next_if(|offset| **offset < text_offset.saturating_add(run_length))
            {
                let end = offset
                    .saturating_sub(text_offset)
                    .max(start)
                    .min(chars.len());
                append_docx_text_run(
                    &mut body,
                    indent,
                    &properties,
                    &chars[start..end].iter().collect::<String>(),
                );
                append_docx_rendered_page_break(&mut body, indent);
                start = end;
            }
            append_docx_text_run(
                &mut body,
                indent,
                &properties,
                &chars[start..].iter().collect::<String>(),
            );
            text_offset = text_offset.saturating_add(run_length);
        }
    }
    for _ in break_offsets {
        append_docx_rendered_page_break(&mut body, indent);
    }
    if paragraph.page_break_after {
        body.push_str(indent);
        body.push_str("  <w:r><w:br w:type=\"page\"/></w:r>\n");
    }
    body.push_str(indent);
    body.push_str("</w:p>\n");
    body
}

fn docx_header_footer_xml(record: &WordBinaryHeaderFooter) -> String {
    let mut body = String::new();
    let mut image_id = 0usize;
    for paragraph in &record.paragraphs {
        body.push_str(&docx_paragraph_xml(paragraph, &mut image_id, "  "));
    }
    if body.is_empty() {
        body.push_str("  <w:p/>\n");
    }
    let root = if record.kind.ends_with("Header") {
        "hdr"
    } else {
        "ftr"
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:{root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
{body}</w:{root}>"#
    )
}

fn docx_header_footer_image_count(record: &WordBinaryHeaderFooter) -> usize {
    record
        .paragraphs
        .iter()
        .flat_map(|paragraph| paragraph.runs.iter())
        .filter(|run| run.image.is_some())
        .count()
}

fn docx_header_footer_relationships(
    record: &WordBinaryHeaderFooter,
    global_image_start: usize,
) -> String {
    let mut relationships = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
"#,
    );
    let mut local_image = 0usize;
    for run in record
        .paragraphs
        .iter()
        .flat_map(|paragraph| paragraph.runs.iter())
    {
        let Some(image) = run.image.as_ref() else {
            continue;
        };
        local_image += 1;
        relationships.push_str(&format!(
            "  <Relationship Id=\"rIdImage{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image{}.{}\"/>\n",
            local_image,
            global_image_start + local_image,
            image.extension,
        ));
    }
    relationships.push_str("</Relationships>");
    relationships
}

fn docx_inline_image(image: &DocxImage, relationship_id: usize) -> String {
    let graphic = docx_picture_graphic(image, relationship_id);
    if !image.floating {
        return format!(
            r#"<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{}" cy="{}"/><wp:docPr id="{}" name="Picture {}"/>{}</wp:inline></w:drawing>"#,
            image.width_emu, image.height_emu, relationship_id, relationship_id, graphic,
        );
    }
    let wrap = match image.wrap {
        "none" => "<wp:wrapNone/>".to_string(),
        "topAndBottom" => "<wp:wrapTopAndBottom/>".to_string(),
        "tight" => docx_wrap_polygon("wrapTight", image.wrap_side, &image.wrap_polygon),
        "through" => docx_wrap_polygon("wrapThrough", image.wrap_side, &image.wrap_polygon),
        _ => format!("<wp:wrapSquare wrapText=\"{}\"/>", image.wrap_side),
    };
    let position_h = if image.anchor_align_h.is_empty() {
        format!("<wp:posOffset>{}</wp:posOffset>", image.anchor_x_emu)
    } else {
        format!("<wp:align>{}</wp:align>", image.anchor_align_h)
    };
    let position_v = if image.anchor_align_v.is_empty() {
        format!("<wp:posOffset>{}</wp:posOffset>", image.anchor_y_emu)
    } else {
        format!("<wp:align>{}</wp:align>", image.anchor_align_v)
    };
    format!(
        r#"<w:drawing><wp:anchor distT="{}" distB="{}" distL="{}" distR="{}" simplePos="0" relativeHeight="{}" behindDoc="{}" locked="{}" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="{}">{}</wp:positionH><wp:positionV relativeFrom="{}">{}</wp:positionV><wp:extent cx="{}" cy="{}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{}<wp:docPr id="{}" name="Picture {}"/><wp:cNvGraphicFramePr/>{}</wp:anchor></w:drawing>"#,
        image.wrap_distance_top,
        image.wrap_distance_bottom,
        image.wrap_distance_left,
        image.wrap_distance_right,
        image.relative_height,
        if image.behind_doc { 1 } else { 0 },
        if image.anchor_lock { 1 } else { 0 },
        image.relative_h,
        position_h,
        image.relative_v,
        position_v,
        image.width_emu,
        image.height_emu,
        wrap,
        relationship_id,
        relationship_id,
        graphic,
    )
}

fn docx_wrap_polygon(kind: &str, side: &str, polygon: &[(i32, i32)]) -> String {
    let points = if polygon.len() >= 3 {
        polygon.to_vec()
    } else {
        vec![(0, 0), (21_600, 0), (21_600, 21_600), (0, 21_600)]
    };
    let min_x = points.iter().map(|(x, _)| *x).min().unwrap_or(0);
    let max_x = points.iter().map(|(x, _)| *x).max().unwrap_or(21_600);
    let min_y = points.iter().map(|(_, y)| *y).min().unwrap_or(0);
    let max_y = points.iter().map(|(_, y)| *y).max().unwrap_or(21_600);
    let width = i64::from(max_x.saturating_sub(min_x)).max(1);
    let height = i64::from(max_y.saturating_sub(min_y)).max(1);
    let points = points
        .into_iter()
        .map(|(x, y)| {
            (
                ((i64::from(x.saturating_sub(min_x)) * 21_600) / width) as i32,
                ((i64::from(y.saturating_sub(min_y)) * 21_600) / height) as i32,
            )
        })
        .collect::<Vec<_>>();
    let (start_x, start_y) = points.first().copied().unwrap_or((0, 0));
    let points_xml = points
        .iter()
        .skip(1)
        .map(|(x, y)| format!("<wp:lineTo x=\"{}\" y=\"{}\"/>", x, y))
        .collect::<String>();
    format!(
        r#"<wp:{kind} wrapText="{side}"><wp:wrapPolygon edited="0"><wp:start x="{start_x}" y="{start_y}"/>{points_xml}</wp:wrapPolygon></wp:{kind}>"#
    )
}

fn docx_picture_graphic(image: &DocxImage, relationship_id: usize) -> String {
    let crop = if image.crop_left != 0
        || image.crop_top != 0
        || image.crop_right != 0
        || image.crop_bottom != 0
    {
        format!(
            "<a:srcRect l=\"{}\" t=\"{}\" r=\"{}\" b=\"{}\"/>",
            image.crop_left, image.crop_top, image.crop_right, image.crop_bottom
        )
    } else {
        String::new()
    };
    let mut transform = String::new();
    if image.rotation != 0 {
        transform.push_str(&format!(" rot=\"{}\"", image.rotation));
    }
    if image.flip_h {
        transform.push_str(" flipH=\"1\"");
    }
    if image.flip_v {
        transform.push_str(" flipV=\"1\"");
    }
    let blip = if let Some(opacity) = image.opacity.filter(|value| *value < 100_000) {
        format!(
            "<a:blip r:embed=\"rIdImage{}\"><a:alphaModFix amt=\"{}\"/></a:blip>",
            relationship_id, opacity
        )
    } else {
        format!("<a:blip r:embed=\"rIdImage{}\"/>", relationship_id)
    };
    format!(
        r#"<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{}" name="image{}.{}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>{}{}<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm{}><a:off x="0" y="0"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>"#,
        relationship_id,
        relationship_id,
        image.extension,
        blip,
        crop,
        transform,
        image.width_emu,
        image.height_emu,
    )
}

fn docx_run_properties(run: &DocxRun) -> String {
    if !run.bold
        && !run.italic
        && !run.underline
        && run.underline_style.is_empty()
        && !run.strike
        && !run.small_caps
        && !run.caps
        && !run.hidden
        && !run.rtl
        && run.vertical_align.is_empty()
        && run.font_name.is_empty()
        && run.font_size == 0
        && run.color.is_empty()
        && run.highlight.is_empty()
    {
        return String::new();
    }
    let mut properties = String::from("<w:rPr>");
    if !run.font_name.is_empty() {
        let font = escape(&run.font_name);
        properties.push_str(&format!(
            "<w:rFonts w:ascii=\"{font}\" w:hAnsi=\"{font}\" w:eastAsia=\"{font}\" w:cs=\"{font}\"/>"
        ));
    }
    if run.bold {
        properties.push_str("<w:b/>");
    }
    if run.italic {
        properties.push_str("<w:i/>");
    }
    if run.underline {
        properties.push_str(&format!(
            "<w:u w:val=\"{}\"/>",
            if run.underline_style.is_empty() {
                "single"
            } else {
                run.underline_style
            }
        ));
    }
    if run.strike {
        properties.push_str("<w:strike/>");
    }
    if run.small_caps {
        properties.push_str("<w:smallCaps/>");
    }
    if run.caps {
        properties.push_str("<w:caps/>");
    }
    if run.hidden {
        properties.push_str("<w:vanish/>");
    }
    if run.rtl {
        properties.push_str("<w:rtl/>");
    }
    if !run.vertical_align.is_empty() {
        properties.push_str(&format!("<w:vertAlign w:val=\"{}\"/>", run.vertical_align));
    }
    if run.font_size > 0 {
        properties.push_str(&format!("<w:sz w:val=\"{}\"/>", run.font_size));
    }
    if !run.color.is_empty() {
        properties.push_str(&format!("<w:color w:val=\"{}\"/>", run.color));
    }
    if !run.highlight.is_empty() {
        properties.push_str(&format!(
            "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{}\"/>",
            run.highlight
        ));
    }
    properties.push_str("</w:rPr>");
    properties
}

fn word_text_xml(text: &str) -> String {
    let mut output = String::new();
    for (line_index, line) in text.split('\n').enumerate() {
        if line_index > 0 {
            output.push_str("<w:br/>");
        }
        for (segment_index, segment) in line.split('\t').enumerate() {
            if segment_index > 0 {
                output.push_str("<w:tab/>");
            }
            if !segment.is_empty() {
                if segment.starts_with(' ') || segment.ends_with(' ') || segment.contains("  ") {
                    output.push_str("<w:t xml:space=\"preserve\">");
                } else {
                    output.push_str("<w:t>");
                }
                output.push_str(&escape(segment));
                output.push_str("</w:t>");
            }
        }
    }
    if output.is_empty() {
        "<w:t></w:t>".into()
    } else {
        output
    }
}

fn normalize_package(input: &str, output: &str, target: &str) -> Result<(), ConvertError> {
    let input =
        File::open(input).map_err(|error| parse_error(format!("open OpenXML package: {error}")))?;
    let mut archive = ZipArchive::new(input)
        .map_err(|error| parse_error(format!("open OpenXML package: {error}")))?;
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error(format!("create output directory: {error}")))?;
    }
    let file =
        File::create(output).map_err(|error| io_error(format!("create output file: {error}")))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let (main_part, main_content_type) = target_contract(target).ok_or_else(|| ConvertError {
        code: "unsupported_format",
        message: format!("unsupported target format: {target}"),
    })?;
    let mut found_content_types = false;
    let mut total_bytes = 0u64;
    if archive.len() > MAX_PACKAGE_ENTRIES {
        return Err(parse_error("OpenXML package has too many entries".into()));
    }

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| io_error(format!("open OpenXML entry: {error}")))?;
        let name = safe_part(entry.name())?;
        if entry.size() > MAX_ENTRY_BYTES
            || total_bytes > MAX_PACKAGE_BYTES.saturating_sub(entry.size())
        {
            return Err(parse_error(format!(
                "OpenXML entry {name} exceeds package limits"
            )));
        }
        total_bytes += entry.size();
        if forbidden_part(&name) {
            continue;
        }
        let mut content = Vec::with_capacity(entry.size().min(usize::MAX as u64) as usize);
        entry
            .read_to_end(&mut content)
            .map_err(|error| io_error(format!("read OpenXML entry {name}: {error}")))?;
        if name.eq_ignore_ascii_case("[Content_Types].xml") {
            found_content_types = true;
            content = normalize_content_types(&content, main_part, main_content_type)?;
        } else if is_relationships_part(&name) {
            content = normalize_relationships(&content)?;
        }
        if entry.is_dir() {
            writer
                .add_directory(name, options)
                .map_err(|error| io_error(format!("create output entry: {error}")))?;
        } else {
            writer
                .start_file(&name, options)
                .map_err(|error| io_error(format!("create output entry {name}: {error}")))?;
            writer
                .write_all(&content)
                .map_err(|error| io_error(format!("write output entry {name}: {error}")))?;
        }
    }
    if !found_content_types {
        return Err(parse_error(
            "missing OpenXML entry [Content_Types].xml".into(),
        ));
    }
    writer
        .finish()
        .map_err(|error| io_error(format!("close output archive: {error}")))?;
    Ok(())
}

fn normalize_content_types(
    content: &[u8],
    main_part: &str,
    main_type: &str,
) -> Result<Vec<u8>, ConvertError> {
    rewrite_xml(
        content,
        "content types",
        |start| {
            if local_name(start.name().as_ref()) == b"Default"
                && forbidden_content_type(attribute(start, b"ContentType").as_deref().unwrap_or(""))
            {
                return Ok(Action::Skip);
            }
            if local_name(start.name().as_ref()) != b"Override" {
                return Ok(Action::Keep(start.to_owned()));
            }
            let part = content_type_part(&attribute(start, b"PartName").unwrap_or_default());
            let content_type = attribute(start, b"ContentType").unwrap_or_default();
            if part == main_part {
                return Ok(Action::Replace(set_attribute(
                    start,
                    b"ContentType",
                    main_type,
                )));
            }
            if forbidden_part(&part) || forbidden_content_type(&content_type) {
                return Ok(Action::Skip);
            }
            Ok(Action::Keep(start.to_owned()))
        },
        Some(main_part),
    )
}

fn normalize_relationships(content: &[u8]) -> Result<Vec<u8>, ConvertError> {
    rewrite_xml(
        content,
        "relationships",
        |start| {
            if local_name(start.name().as_ref()) == b"Relationship" && forbidden_relationship(start)
            {
                Ok(Action::Skip)
            } else {
                Ok(Action::Keep(start.to_owned()))
            }
        },
        None,
    )
}

enum Action {
    Keep(BytesStart<'static>),
    Replace(BytesStart<'static>),
    Skip,
}

fn rewrite_xml<F>(
    content: &[u8],
    label: &str,
    mut transform: F,
    required_part: Option<&str>,
) -> Result<Vec<u8>, ConvertError>
where
    F: FnMut(&BytesStart<'_>) -> Result<Action, ConvertError>,
{
    let mut reader = Reader::from_reader(content);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::new());
    writer
        .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
        .map_err(|error| conversion_error(format!("encode OpenXML {label}: {error}")))?;
    let mut skip_depth = 0usize;
    let mut found_required = required_part.is_none();
    loop {
        let event = reader
            .read_event()
            .map_err(|error| parse_error(format!("parse OpenXML {label}: {error}")))?;
        match event {
            Event::Eof => break,
            Event::Decl(_) => continue,
            Event::Start(start) if skip_depth > 0 => skip_depth += 1,
            Event::End(_) if skip_depth > 0 => skip_depth -= 1,
            Event::Empty(_) if skip_depth > 0 => {}
            Event::Start(start) => match transform(&start)? {
                Action::Skip => skip_depth = 1,
                Action::Keep(start) | Action::Replace(start) => {
                    if let Some(part) = required_part {
                        found_required |=
                            content_type_part(&attribute(&start, b"PartName").unwrap_or_default())
                                == part;
                    }
                    writer.write_event(Event::Start(start)).map_err(|error| {
                        conversion_error(format!("encode OpenXML {label}: {error}"))
                    })?;
                }
            },
            Event::Empty(start) => match transform(&start)? {
                Action::Skip => {}
                Action::Keep(start) | Action::Replace(start) => {
                    if let Some(part) = required_part {
                        found_required |=
                            content_type_part(&attribute(&start, b"PartName").unwrap_or_default())
                                == part;
                    }
                    writer.write_event(Event::Empty(start)).map_err(|error| {
                        conversion_error(format!("encode OpenXML {label}: {error}"))
                    })?;
                }
            },
            event if skip_depth == 0 => writer
                .write_event(event.into_owned())
                .map_err(|error| conversion_error(format!("encode OpenXML {label}: {error}")))?,
            _ => {}
        }
    }
    if !found_required {
        return Err(parse_error(format!(
            "missing OpenXML content type override for {}",
            required_part.unwrap()
        )));
    }
    Ok(writer.into_inner())
}

fn validate_output(path: &str, target: &str) -> Result<(), ConvertError> {
    if matches!(target, "jpg" | "jpeg") {
        let bytes = fs::read(path)
            .map_err(|error| conversion_error(format!("read {path} as JPEG: {error}")))?;
        best_embedded_jpeg(&bytes)
            .filter(|preview| preview.len() == bytes.len())
            .ok_or_else(|| conversion_error(format!("{path} is not a complete 8-bit JPEG")))?;
        return Ok(());
    }
    if target == "png" {
        let bytes = fs::read(path)
            .map_err(|error| conversion_error(format!("read {path} as PNG: {error}")))?;
        if png_bounds(&bytes) != Some(bytes.len()) {
            return Err(conversion_error(format!("{path} is not a complete PNG")));
        }
        return Ok(());
    }
    let input = File::open(path)
        .map_err(|error| conversion_error(format!("open {path} as OpenXML zip: {error}")))?;
    let mut archive = ZipArchive::new(input)
        .map_err(|error| conversion_error(format!("open {path} as OpenXML zip: {error}")))?;
    let required = required_entries(target);
    let mut names = HashSet::new();
    let mut content_types = None;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| conversion_error(format!("read OpenXML zip: {error}")))?;
        let name = normalize_part(entry.name());
        if forbidden_part(&name) {
            return Err(conversion_error(format!(
                "macro-enabled OpenXML part {name} is not allowed"
            )));
        }
        if name == "[Content_Types].xml" {
            let mut bytes = Vec::new();
            entry
                .by_ref()
                .take((1 << 20) + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| conversion_error(format!("read OpenXML entry {name}: {error}")))?;
            content_types = Some(bytes);
        }
        names.insert(name);
    }
    for required_name in required {
        if !names.contains(*required_name) {
            return Err(conversion_error(format!(
                "missing OpenXML entry {required_name}"
            )));
        }
    }
    let content = content_types
        .ok_or_else(|| conversion_error("missing OpenXML entry [Content_Types].xml".into()))?;
    let (main_part, main_type) = target_contract(target).unwrap();
    validate_content_types(&content, main_part, main_type)
}

fn validate_content_types(
    content: &[u8],
    main_part: &str,
    main_type: &str,
) -> Result<(), ConvertError> {
    let mut reader = Reader::from_reader(content);
    loop {
        match reader
            .read_event()
            .map_err(|error| conversion_error(format!("parse OpenXML content types: {error}")))?
        {
            Event::Eof => break,
            Event::Start(start) | Event::Empty(start)
                if local_name(start.name().as_ref()) == b"Override" =>
            {
                let part = content_type_part(&attribute(&start, b"PartName").unwrap_or_default());
                let content_type = attribute(&start, b"ContentType").unwrap_or_default();
                if forbidden_content_type(&content_type) {
                    return Err(conversion_error(format!(
                        "macro-enabled OpenXML content type {content_type} is not allowed for {part}"
                    )));
                }
                if part == main_part && content_type.eq_ignore_ascii_case(main_type) {
                    return Ok(());
                }
            }
            _ => {}
        }
    }
    Err(conversion_error(format!(
        "missing OpenXML content type {main_type} for {main_part}"
    )))
}

fn attribute(start: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    start
        .attributes()
        .with_checks(false)
        .flatten()
        .find_map(|attribute| {
            (local_name(attribute.key.as_ref()) == name).then(|| {
                String::from_utf8_lossy(attribute.value.as_ref())
                    .trim()
                    .to_string()
            })
        })
}

fn set_attribute(start: &BytesStart<'_>, name: &[u8], value: &str) -> BytesStart<'static> {
    let mut replacement =
        BytesStart::new(String::from_utf8_lossy(start.name().as_ref()).into_owned());
    for attribute in start.attributes().with_checks(false).flatten() {
        if local_name(attribute.key.as_ref()) != name {
            let key = String::from_utf8_lossy(attribute.key.as_ref());
            let value = String::from_utf8_lossy(attribute.value.as_ref());
            replacement.push_attribute((key.as_ref(), value.as_ref()));
        }
    }
    replacement.push_attribute((String::from_utf8_lossy(name).as_ref(), value));
    replacement
}

fn forbidden_relationship(start: &BytesStart<'_>) -> bool {
    let relation_type = attribute(start, b"Type")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let target =
        normalize_part(&attribute(start, b"Target").unwrap_or_default()).to_ascii_lowercase();
    relation_type.contains("vbaproject")
        || relation_type.contains("vbadata")
        || target == "vbaproject.bin"
        || target == "vbadata.xml"
        || target.ends_with("/vbaproject.bin")
        || target.ends_with("/vbadata.xml")
}

fn forbidden_content_type(value: &str) -> bool {
    let value = value.trim().replace(' ', "").to_ascii_lowercase();
    value.contains("macroenabled") || value.contains("vbaproject") || value.contains("vbadata")
}

fn forbidden_part(name: &str) -> bool {
    let name = normalize_part(name)
        .trim_start_matches('/')
        .to_ascii_lowercase();
    matches!(
        name.as_str(),
        "vbaproject.bin" | "vbaproject.bin.rels" | "vbadata.xml"
    ) || name.ends_with("/vbaproject.bin")
        || name.ends_with("/vbaproject.bin.rels")
        || name.ends_with("/vbadata.xml")
}

fn is_relationships_part(name: &str) -> bool {
    let name = normalize_part(name).to_ascii_lowercase();
    name == "_rels/.rels" || (name.contains("/_rels/") && name.ends_with(".rels"))
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn normalize_part(name: &str) -> String {
    name.trim().replace('\\', "/")
}

fn safe_part(name: &str) -> Result<String, ConvertError> {
    let normalized = normalize_part(name);
    if normalized.split('/').any(|segment| segment == "..") {
        return Err(parse_error(format!("unsafe OpenXML entry path {name}")));
    }
    Ok(normalized)
}

fn content_type_part(name: &str) -> String {
    let name = normalize_part(name);
    if name.is_empty() || name.starts_with('/') {
        name
    } else {
        format!("/{name}")
    }
}

fn normalize_format(format: &str) -> String {
    format.trim().trim_start_matches('.').to_ascii_lowercase()
}

fn target_contract(target: &str) -> Option<(&'static str, &'static str)> {
    match target {
        "docx" => Some((
            "/word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        )),
        "xlsx" => Some((
            "/xl/workbook.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        )),
        "pptx" => Some((
            "/ppt/presentation.xml",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        )),
        _ => None,
    }
}

fn required_entries(target: &str) -> &'static [&'static str] {
    match target {
        "docx" => &["[Content_Types].xml", "_rels/.rels", "word/document.xml"],
        "xlsx" => &["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"],
        "pptx" => &["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"],
        _ => &[],
    }
}

fn content_type(target: &str) -> &'static str {
    match target {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

fn parse_error(message: String) -> ConvertError {
    ConvertError {
        code: "parse_error",
        message,
    }
}
fn io_error(message: String) -> ConvertError {
    ConvertError {
        code: "io_error",
        message,
    }
}
fn conversion_error(message: String) -> ConvertError {
    ConvertError {
        code: "conversion_failed",
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_png(width: u32, height: u32) -> Vec<u8> {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        png.extend_from_slice(&[0, 0, 0, 0]);
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0, 0, 0, 0]);
        png
    }

    fn test_icns(chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let body_len: usize = chunks.iter().map(|(_, data)| 8 + data.len()).sum();
        let mut icns = Vec::with_capacity(8 + body_len);
        icns.extend_from_slice(b"icns");
        icns.extend_from_slice(&u32::try_from(8 + body_len).unwrap().to_be_bytes());
        for (kind, data) in chunks {
            icns.extend_from_slice(*kind);
            icns.extend_from_slice(&u32::try_from(8 + data.len()).unwrap().to_be_bytes());
            icns.extend_from_slice(data);
        }
        icns
    }

    fn test_jpeg(width: u16, height: u16, precision: u8, payload_size: usize) -> Vec<u8> {
        let mut jpeg = vec![
            0xff,
            0xd8,
            0xff,
            0xc0,
            0x00,
            0x11,
            precision,
            (height >> 8) as u8,
            height as u8,
            (width >> 8) as u8,
            width as u8,
            0x03,
            0x01,
            0x11,
            0x00,
            0x02,
            0x11,
            0x00,
            0x03,
            0x11,
            0x00,
            0xff,
            0xda,
            0x00,
            0x08,
            0x01,
            0x01,
            0x00,
            0x00,
            0x3f,
            0x00,
        ];
        jpeg.extend(std::iter::repeat_n(0x42, payload_size));
        jpeg.extend_from_slice(&[0xff, 0xd9]);
        jpeg
    }

    fn test_emf(width: i32, height: i32) -> Vec<u8> {
        let mut emf = vec![0u8; 88];
        let size = emf.len() as u32;
        emf[0..4].copy_from_slice(&1u32.to_le_bytes());
        emf[4..8].copy_from_slice(&size.to_le_bytes());
        emf[24..28].copy_from_slice(&0i32.to_le_bytes());
        emf[28..32].copy_from_slice(&0i32.to_le_bytes());
        emf[32..36].copy_from_slice(&width.to_le_bytes());
        emf[36..40].copy_from_slice(&height.to_le_bytes());
        emf[40..44].copy_from_slice(&0x464d4520u32.to_le_bytes());
        emf[48..52].copy_from_slice(&size.to_le_bytes());
        emf
    }

    fn test_wmf(width: i16, height: i16, inch: u16) -> Vec<u8> {
        let mut wmf = vec![0u8; 40];
        wmf[0..4].copy_from_slice(&0x9ac6cdd7u32.to_le_bytes());
        wmf[6..8].copy_from_slice(&0i16.to_le_bytes());
        wmf[8..10].copy_from_slice(&0i16.to_le_bytes());
        wmf[10..12].copy_from_slice(&width.to_le_bytes());
        wmf[12..14].copy_from_slice(&height.to_le_bytes());
        wmf[14..16].copy_from_slice(&inch.to_le_bytes());
        wmf[28..32].copy_from_slice(&20u32.to_le_bytes());
        wmf
    }

    fn test_standard_wmf() -> Vec<u8> {
        let mut wmf = vec![0u8; 40];
        wmf[0..2].copy_from_slice(&1u16.to_le_bytes());
        wmf[2..4].copy_from_slice(&9u16.to_le_bytes());
        wmf[6..10].copy_from_slice(&20u32.to_le_bytes());
        wmf
    }

    #[test]
    fn extracts_largest_embedded_raw_jpeg_preview() {
        let small = test_jpeg(320, 240, 8, 4);
        let large = test_jpeg(1600, 1200, 8, 8);
        let sensor = test_jpeg(6000, 4000, 12, 12);
        let bytes = [b"RAW".as_slice(), &small, &sensor, &large, b"TAIL"].concat();

        assert_eq!(best_embedded_jpeg(&bytes), Some(large.as_slice()));
        assert!(best_embedded_jpeg(b"RAW without preview").is_none());
        assert!(is_raw_source("nrw") && is_raw_source("3fr") && is_raw_source("iiq"));
    }

    #[test]
    fn raw_jpeg_search_rejects_false_starts_before_a_real_preview() {
        let jpeg = test_jpeg(3008, 2000, 8, 8);
        for prefix in [
            vec![0xff, 0xd8, 0x42, 0, 2],
            vec![0xff, 0xd8, 0xff, 0xe1, 0, 2],
            vec![0xff, 0xd8, 0xff, 0x00],
            vec![0xff, 0xd8, 0xff, 0xd0],
        ] {
            let bytes = [prefix, jpeg.clone()].concat();
            assert!(jpeg_bounds(&bytes, 0).is_none());
            assert_eq!(best_embedded_jpeg(&bytes), Some(jpeg.as_slice()));
        }
    }

    #[test]
    fn preserves_legacy_vector_media() {
        let emf = test_emf(2100, 2970);
        let emf_image = extract_word_binary_image(&emf, 0).unwrap();
        assert_eq!(emf_image.extension, "emf");
        assert_eq!(emf_image.content_type, "image/x-emf");
        assert_eq!(emf_image.data, emf);
        assert!(emf_image.width_emu > 0 && emf_image.height_emu > 0);

        let wmf = test_wmf(2100, 2970, 100);
        let wmf_image = extract_word_binary_image(&wmf, 0).unwrap();
        assert_eq!(wmf_image.extension, "wmf");
        assert_eq!(wmf_image.content_type, "image/x-wmf");
        assert_eq!(wmf_image.data, wmf);
        assert!(wmf_image.width_emu > 0 && wmf_image.height_emu > 0);

        let standard_wmf = test_standard_wmf();
        let standard_image = extract_word_binary_image(&standard_wmf, 0).unwrap();
        assert_eq!(standard_image.extension, "wmf");
        assert_eq!(standard_image.data, standard_wmf);
    }

    #[test]
    fn parses_legacy_officeart_shape_anchor_and_emits_floating_drawing() {
        let count = 1usize;
        let mut plc = vec![0u8; (count + 1) * 4 + count * 26];
        plc[0..4].copy_from_slice(&7u32.to_le_bytes());
        plc[4..8].copy_from_slice(&9u32.to_le_bytes());
        let record = 8;
        plc[record..record + 4].copy_from_slice(&42u32.to_le_bytes());
        plc[record + 4..record + 8].copy_from_slice(&100i32.to_le_bytes());
        plc[record + 8..record + 12].copy_from_slice(&200i32.to_le_bytes());
        plc[record + 12..record + 16].copy_from_slice(&1_100i32.to_le_bytes());
        plc[record + 16..record + 20].copy_from_slice(&1_200i32.to_le_bytes());
        let flags = (2u16 << 3) | (2u16 << 5) | (1u16 << 9) | 0x8000;
        plc[record + 20..record + 22].copy_from_slice(&flags.to_le_bytes());
        let shapes = parse_word_binary_shape_anchors(&plc, 0, plc.len(), 0);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].cp, 7);
        assert_eq!(shapes[0].relative_h, "margin");
        assert_eq!(shapes[0].relative_v, "paragraph");
        assert_eq!(shapes[0].wrap, "square");
        assert_eq!(shapes[0].wrap_side, "left");
        assert!(shapes[0].anchor_lock);

        let mut paragraphs = vec![DocxParagraph {
            source_cp_start: 5,
            source_cp_end: 10,
            runs: vec![DocxRun {
                image: Some(DocxImage {
                    data: test_png(10, 10),
                    extension: "png",
                    content_type: "image/png",
                    width_emu: 100,
                    height_emu: 100,
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        }];
        attach_word_binary_shape_anchors(&mut paragraphs, &shapes);
        let image = paragraphs[0].runs[0].image.as_ref().unwrap();
        assert!(image.floating && image.anchor_lock);
        assert_eq!(image.anchor_x_emu, 63_500);
        assert_eq!(image.anchor_y_emu, 127_000);
        assert_eq!(image.width_emu, 635_000);
        assert_eq!(image.height_emu, 635_000);
        let drawing = docx_inline_image(image, 1);
        assert!(drawing.contains("<wp:anchor "));
        assert!(
            drawing.contains("relativeFrom=\"margin\"")
                && drawing.contains("relativeFrom=\"paragraph\"")
        );
        assert!(
            drawing.contains("<wp:wrapSquare wrapText=\"left\"/>")
                && drawing.contains("<wp:posOffset>63500</wp:posOffset>")
        );
    }

    #[test]
    fn parses_officeart_shape_properties_and_blip_binding() {
        fn escher_record(options: u16, record_id: u16, payload: &[u8]) -> Vec<u8> {
            let mut record = Vec::with_capacity(8 + payload.len());
            record.extend_from_slice(&options.to_le_bytes());
            record.extend_from_slice(&record_id.to_le_bytes());
            record.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            record.extend_from_slice(payload);
            record
        }

        let png = test_png(12, 8);
        let blip = escher_record(0, 0xf01e, &png);
        let mut bse_payload = vec![0u8; 36];
        let blip_name = b"pic\0";
        bse_payload[33] = blip_name.len() as u8;
        bse_payload.extend_from_slice(blip_name);
        bse_payload.extend_from_slice(&blip);
        let bse = escher_record(0, 0xf007, &bse_payload);
        let bstore = escher_record(0x000f, 0xf001, &bse);
        let dgg = escher_record(0x000f, 0xf000, &bstore);

        let sp_flags = 0x0040u32 | 0x0080;
        let mut sp_payload = Vec::new();
        sp_payload.extend_from_slice(&42u32.to_le_bytes());
        sp_payload.extend_from_slice(&sp_flags.to_le_bytes());
        let sp = escher_record(0, 0xf00a, &sp_payload);
        let mut opt_payload = Vec::new();
        for (property, value) in [
            (0x0104u16, 1u32),
            (0x0004, 90u32.saturating_mul(65_536)),
            (0x0100, 32_768),
            (0x0101, 16_384),
            (0x0102, 8_192),
            (0x0103, 4_096),
            (0x0182, 32_768),
            (0x03aa, 7),
            (0x03ba, 1),
        ] {
            opt_payload.extend_from_slice(&property.to_le_bytes());
            opt_payload.extend_from_slice(&value.to_le_bytes());
        }
        let mut polygon = Vec::new();
        polygon.extend_from_slice(&3u16.to_le_bytes());
        polygon.extend_from_slice(&0u16.to_le_bytes());
        polygon.extend_from_slice(&8u16.to_le_bytes());
        for (x, y) in [(0i32, 0i32), (100, 0), (100, 100)] {
            polygon.extend_from_slice(&x.to_le_bytes());
            polygon.extend_from_slice(&y.to_le_bytes());
        }
        opt_payload.extend_from_slice(&(0x8000u16 | 0x0383).to_le_bytes());
        opt_payload.extend_from_slice(&(polygon.len() as u32).to_le_bytes());
        opt_payload.extend_from_slice(&polygon);
        let opt = escher_record((10u16 << 4) | 3, 0xf00b, &opt_payload);
        let mut tertiary_payload = Vec::new();
        for (property, value) in [
            (0x0384u16, 91_440u32),
            (0x0385, 45_720),
            (0x0386, 91_440),
            (0x0387, 45_720),
            (0x038f, 2),
            (0x0390, 2),
            (0x0391, 3),
            (0x0392, 1),
        ] {
            tertiary_payload.extend_from_slice(&property.to_le_bytes());
            tertiary_payload.extend_from_slice(&value.to_le_bytes());
        }
        let tertiary = escher_record((8u16 << 4) | 3, 0xf122, &tertiary_payload);
        let shape = escher_record(0x000f, 0xf004, &[sp, opt, tertiary].concat());
        let spgr = escher_record(0x000f, 0xf003, &shape);
        let dg = escher_record(0x000f, 0xf002, &spgr);
        let data = [dgg, vec![0], dg].concat();
        let fib = WordBinaryFib {
            fc_dgg_info: 0,
            lcb_dgg_info: data.len(),
            ..Default::default()
        };

        let office_art = parse_word_binary_officeart(&data, &[], fib);
        assert_eq!(office_art.blips.len(), 1);
        assert_eq!(office_art.shapes.len(), 1);
        let shape = &office_art.shapes[0];
        assert_eq!(shape.spid, 42);
        assert_eq!(shape.blip_index, Some(1));
        assert_eq!(shape.rotation, 90 * 60_000);
        assert!(shape.flip_h && shape.flip_v && shape.behind_doc == Some(true));
        assert_eq!(shape.crop_left, 12_500);
        assert_eq!(shape.crop_top, 50_000);
        assert_eq!(shape.z_order, Some(7));
        assert_eq!(shape.wrap_polygon, vec![(0, 0), (100, 0), (100, 100)]);
        assert_eq!(shape.opacity, Some(50_000));
        assert_eq!(shape.position_h, "center");
        assert_eq!(shape.position_v, "bottom");
        assert_eq!(shape.relative_h, "page");
        assert_eq!(shape.relative_v, "margin");
        assert_eq!(shape.wrap_distance_left, 91_440);
        assert_eq!(
            shape.image.as_ref().map(|image| image.extension),
            Some("png")
        );
        let mut image = shape.image.clone().unwrap();
        image.floating = true;
        image.wrap = "tight";
        image.wrap_side = "bothSides";
        apply_word_binary_shape_art(&mut image, shape);
        let drawing = docx_inline_image(&image, 1);
        assert!(drawing.contains("distT=\"45720\"") && drawing.contains("distL=\"91440\""));
        assert!(drawing.contains("relativeFrom=\"page\"><wp:align>center</wp:align>"));
        assert!(drawing.contains("relativeFrom=\"margin\"><wp:align>bottom</wp:align>"));
        assert!(
            drawing.contains("<a:alphaModFix amt=\"50000\"/>") && drawing.contains("flipH=\"1\"")
        );
        assert!(drawing.contains("<a:srcRect l=\"12500\" t=\"50000\""));
        assert!(drawing.contains("<wp:wrapTight wrapText=\"bothSides\">"));
    }

    #[test]
    fn resolves_officeart_delayed_blip_from_word_document() {
        fn escher_record(options: u16, record_id: u16, payload: &[u8]) -> Vec<u8> {
            let mut record = Vec::with_capacity(8 + payload.len());
            record.extend_from_slice(&options.to_le_bytes());
            record.extend_from_slice(&record_id.to_le_bytes());
            record.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            record.extend_from_slice(payload);
            record
        }

        let png = test_png(18, 12);
        let delayed_blip = escher_record(0, 0xf01e, &png);
        let delay_offset = 32usize;
        let mut document = vec![0u8; delay_offset];
        document.extend_from_slice(&delayed_blip);

        let mut bse_payload = vec![0u8; 36];
        bse_payload[28..32].copy_from_slice(&(delay_offset as u32).to_le_bytes());
        let bse = escher_record(0, 0xf007, &bse_payload);
        let dgg = escher_record(0x000f, 0xf000, &escher_record(0x000f, 0xf001, &bse));

        let mut sp_payload = Vec::new();
        sp_payload.extend_from_slice(&7u32.to_le_bytes());
        sp_payload.extend_from_slice(&0u32.to_le_bytes());
        let sp = escher_record(0, 0xf00a, &sp_payload);
        let mut opt_payload = Vec::new();
        opt_payload.extend_from_slice(&0x4104u16.to_le_bytes());
        opt_payload.extend_from_slice(&1u32.to_le_bytes());
        let opt = escher_record((1u16 << 4) | 3, 0xf00b, &opt_payload);
        let shape = escher_record(0x000f, 0xf004, &[sp, opt].concat());
        let dg = escher_record(0x000f, 0xf002, &escher_record(0x000f, 0xf003, &shape));
        let table = [dgg, vec![0], dg].concat();
        let fib = WordBinaryFib {
            fc_dgg_info: 0,
            lcb_dgg_info: table.len(),
            ..Default::default()
        };

        let office_art = parse_word_binary_officeart(&table, &document, fib);
        assert_eq!(office_art.blips.len(), 1);
        assert_eq!(office_art.blip_delay_offsets, vec![Some(delay_offset)]);
        assert_eq!(office_art.shapes.len(), 1);
        let image = office_art.shapes[0].image.as_ref().unwrap();
        assert_eq!(image.extension, "png");
        assert_eq!(image.data, png);
    }

    #[test]
    fn associates_unreferenced_document_media_with_its_paragraph() {
        let jpeg = test_jpeg(320, 240, 8, 4);
        let mut stream = vec![0u8; 4];
        stream.extend_from_slice(&jpeg);
        let mut paragraphs = vec![DocxParagraph {
            text: "Before image".into(),
            source_fc_start: 4,
            source_fc_end: (stream.len() - 1) as u32,
            runs: vec![DocxRun {
                text: "Before image".into(),
                ..Default::default()
            }],
            ..Default::default()
        }];

        append_unreferenced_word_binary_images(&mut paragraphs, &stream, true);

        assert_eq!(paragraphs.len(), 1);
        assert!(paragraphs[0].runs.iter().any(|run| run.image.is_some()));
    }

    #[test]
    fn parses_legacy_section_page_properties() {
        let mut grpprl = Vec::new();
        grpprl.extend_from_slice(&0x3009u16.to_le_bytes());
        grpprl.push(4);
        grpprl.extend_from_slice(&0x001du16.to_le_bytes());
        grpprl.push(1);
        for (sprm, value) in [
            (0x401fu16, 11_906i16),
            (0x4020, 16_838),
            (0x4021, 720),
            (0x4022, 840),
            (0x4023, 1_000),
            (0x4024, 1_080),
            (0x4025, 120),
            (0x4017, 600),
            (0x4018, 660),
        ] {
            grpprl.extend_from_slice(&sprm.to_le_bytes());
            grpprl.extend_from_slice(&value.to_le_bytes());
        }
        grpprl.extend_from_slice(&0x500bu16.to_le_bytes());
        grpprl.extend_from_slice(&2u16.to_le_bytes());
        grpprl.extend_from_slice(&0x900cu16.to_le_bytes());
        grpprl.extend_from_slice(&360u16.to_le_bytes());
        grpprl.extend_from_slice(&0x3019u16.to_le_bytes());
        grpprl.push(1);
        grpprl.extend_from_slice(&0x3228u16.to_le_bytes());
        grpprl.push(1);
        grpprl.extend_from_slice(&0x702bu16.to_le_bytes());
        grpprl.extend_from_slice(&[8, 1, 1, 3 | 0x20 | 0x40]);
        grpprl.extend_from_slice(&0x522fu16.to_le_bytes());
        grpprl.extend_from_slice(&[(1 | (1 << 3) | (1 << 5)), 0]);
        let section = parse_word_binary_section_properties(&grpprl);
        assert_eq!(section.section_type, "oddPage");
        assert!(section.landscape);
        assert_eq!(section.page_width, 16_838);
        assert_eq!(section.page_height, 11_906);
        assert_eq!(section.margin_left, 720);
        assert_eq!(section.margin_right, 840);
        assert_eq!(section.margin_top, 1_000);
        assert_eq!(section.margin_bottom, 1_080);
        assert_eq!(section.gutter, 120);
        assert_eq!(section.margin_header, 600);
        assert_eq!(section.margin_footer, 660);
        assert_eq!(section.columns, 3);
        assert_eq!(section.column_spacing, 360);
        assert!(section.column_separator && section.column_rtl);
        assert_eq!(
            section.page_border_top.map(|border| border.style),
            Some("single")
        );
        assert_eq!(
            section.page_border_top.and_then(|border| border.color),
            Some([0, 0, 0])
        );
        assert_eq!(section.page_border_top.map(|border| border.space), Some(3));
        assert!(
            section
                .page_border_top
                .is_some_and(|border| border.shadow && border.frame)
        );
        assert_eq!(section.page_border_display, "firstPage");
        assert_eq!(section.page_border_offset_from, "page");
        assert_eq!(section.page_border_z_order, "back");

        let document = docx_document(&[], section);
        assert!(document.contains("<w:type w:val=\"oddPage\"/>"));
        assert!(document.contains("<w:pgSz w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\" />"));
        assert!(
            document.contains("w:top=\"1000\" w:right=\"840\" w:bottom=\"1080\" w:left=\"720\"")
        );
        assert!(
            document.contains("<w:cols w:num=\"3\" w:space=\"360\" w:sep=\"1\" w:rtl=\"1\" />")
        );
        assert!(
            document.contains(
                "<w:pgBorders w:display=\"firstPage\" w:offsetFrom=\"page\" w:zOrder=\"back\">"
            ) && document.contains("w:color=\"000000\"")
        );
        assert!(
            document.contains("w:space=\"3\"") && document.contains("w:shadow=\"1\" w:frame=\"1\"")
        );

        let mut v9 = Vec::new();
        v9.extend_from_slice(&0xd234u16.to_le_bytes());
        v9.extend_from_slice(&[8, 0xff, 0x00, 0x00, 0x00, 8, 1, 5 | 0x20, 0]);
        let v9_section = parse_word_binary_section_properties(&v9);
        assert_eq!(
            v9_section.page_border_top.map(|border| border.style),
            Some("single")
        );
        assert_eq!(
            v9_section.page_border_top.and_then(|border| border.color),
            Some([255, 0, 0])
        );
        assert_eq!(
            v9_section.page_border_top.map(|border| border.space),
            Some(5)
        );
        assert!(
            v9_section
                .page_border_top
                .is_some_and(|border| border.shadow && !border.frame)
        );

        let mut automatic_v9 = Vec::new();
        automatic_v9.extend_from_slice(&0xd234u16.to_le_bytes());
        automatic_v9.extend_from_slice(&[8, 0, 0, 0, 0xff, 8, 1, 0, 0]);
        let automatic_section = parse_word_binary_section_properties(&automatic_v9);
        assert_eq!(
            automatic_section
                .page_border_top
                .and_then(|border| border.color),
            None
        );
        assert!(docx_document(&[], automatic_section).contains("w:color=\"auto\""));

        let second = DocxSection {
            page_width: 12_240,
            page_height: 15_840,
            ..DocxSection::default()
        };
        let multi_section_document = docx_document_with_sections(
            &[
                DocxParagraph {
                    text: "First".into(),
                    source_cp_start: 0,
                    source_cp_end: 10,
                    ..Default::default()
                },
                DocxParagraph {
                    text: "Second".into(),
                    source_cp_start: 10,
                    source_cp_end: 20,
                    ..Default::default()
                },
            ],
            &[
                WordBinarySection {
                    cp_end: 10,
                    properties: section,
                },
                WordBinarySection {
                    cp_end: i32::MAX,
                    properties: second,
                },
            ],
        );
        assert_eq!(multi_section_document.matches("<w:sectPr>").count(), 2);
        assert!(
            multi_section_document
                .contains("<w:pgSz w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\" />")
        );
        assert!(multi_section_document.contains("<w:pgSz w:w=\"12240\" w:h=\"15840\" />"));

        let mut section_document = vec![0u8; 64];
        let first_grpprl = [0x1du8, 0x00, 1];
        section_document[8..10].copy_from_slice(&(first_grpprl.len() as u16).to_le_bytes());
        section_document[10..13].copy_from_slice(&first_grpprl);
        let second_grpprl = [0x1du8, 0x00, 0];
        section_document[32..34].copy_from_slice(&(second_grpprl.len() as u16).to_le_bytes());
        section_document[34..37].copy_from_slice(&second_grpprl);
        let mut plc = vec![0u8; 36];
        plc[4..8].copy_from_slice(&10i32.to_le_bytes());
        plc[8..12].copy_from_slice(&20i32.to_le_bytes());
        plc[12 + 2..12 + 6].copy_from_slice(&8u32.to_le_bytes());
        plc[24 + 2..24 + 6].copy_from_slice(&32u32.to_le_bytes());
        let parsed_sections = parse_word_binary_sections(
            &section_document,
            &plc,
            WordBinaryFib {
                fc_plcf_sed: 0,
                lcb_plcf_sed: plc.len(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(parsed_sections.len(), 2);
        assert_eq!(parsed_sections[0].cp_end, 10);
        assert!(parsed_sections[0].properties.landscape);
        assert_eq!(parsed_sections[1].cp_end, 20);
        assert!(!parsed_sections[1].properties.landscape);
    }

    #[test]
    fn parses_all_six_header_footer_stories_for_the_last_section() {
        let document = b"\rB\rC\rD\rE\rF\r".to_vec();
        let mut plc = Vec::new();
        for cp in [0u32, 0, 0, 0, 0, 0, 0, 1, 3, 5, 7, 9, 11] {
            plc.extend_from_slice(&cp.to_le_bytes());
        }
        let records = parse_word_binary_header_footers(
            &document,
            &[],
            &plc,
            WordBinaryFib {
                ccp_hdd: document.len(),
                fc_plcf_hdd: 0,
                lcb_plcf_hdd: plc.len(),
                ..Default::default()
            },
            &[WordBinaryPiece {
                cp_start: 0,
                cp_end: document.len() as i32,
                file_offset: 0,
                compressed: true,
                prm: 0,
            }],
            &[],
            &[],
            &[],
        );
        assert_eq!(records.len(), 6);
        assert_eq!(records[0].kind, "evenHeader");
        assert!(records[0].paragraphs.is_empty());
        assert!(docx_header_footer_xml(&records[0]).contains("<w:p/>"));
        assert_eq!(
            records.last().map(|record| record.kind),
            Some("firstFooter")
        );
        assert_eq!(
            records
                .last()
                .map(|record| record.paragraphs[0].text.as_str()),
            Some("F")
        );
    }

    #[test]
    fn writes_legacy_header_footer_parts_and_references() {
        let headers = vec![
            WordBinaryHeaderFooter {
                section_index: 0,
                kind: "defaultHeader",
                paragraphs: vec![DocxParagraph {
                    text: "Header text".into(),
                    ..Default::default()
                }],
            },
            WordBinaryHeaderFooter {
                section_index: 0,
                kind: "defaultFooter",
                paragraphs: vec![DocxParagraph {
                    text: "Footer text".into(),
                    ..Default::default()
                }],
            },
            WordBinaryHeaderFooter {
                section_index: 0,
                kind: "evenHeader",
                paragraphs: vec![DocxParagraph {
                    text: "Even header".into(),
                    ..Default::default()
                }],
            },
        ];
        let section_xml = docx_section_properties_xml(DocxSection::default(), 0, &headers);
        assert!(
            section_xml.contains("<w:headerReference w:type=\"default\" r:id=\"rIdHeader1\"/>")
        );
        assert!(
            section_xml.contains("<w:footerReference w:type=\"default\" r:id=\"rIdFooter2\"/>")
        );
        assert!(section_xml.contains("<w:headerReference w:type=\"even\" r:id=\"rIdHeader3\"/>"));
        let header_xml = docx_header_footer_xml(&headers[0]);
        assert!(header_xml.contains("<w:hdr "));
        assert!(header_xml.contains("Header text"));
        assert!(docx_header_footer_xml(&headers[1]).contains("<w:ftr "));
        let relationships = docx_document_relationships(false, &[], &headers);
        assert!(relationships.contains("rIdHeader1") && relationships.contains("header1.xml"));
        assert!(relationships.contains("rIdFooter2") && relationships.contains("footer2.xml"));
        assert!(relationships.contains("rIdSettings") && relationships.contains("settings.xml"));
        let content_types = docx_content_types(false, &[], &headers);
        assert!(
            content_types.contains("/word/header1.xml")
                && content_types.contains("/word/footer2.xml")
        );
        assert!(content_types.contains("/word/settings.xml"));
        assert!(docx_settings().contains("<w:evenAndOddHeaders/>"));
        let image_header = WordBinaryHeaderFooter {
            section_index: 0,
            kind: "defaultHeader",
            paragraphs: vec![DocxParagraph {
                runs: vec![DocxRun {
                    image: Some(DocxImage {
                        data: test_png(2, 2),
                        extension: "png",
                        content_type: "image/png",
                        width_emu: 100,
                        height_emu: 100,
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            }],
        };
        assert_eq!(docx_header_footer_image_count(&image_header), 1);
        assert!(docx_header_footer_relationships(&image_header, 3).contains("media/image4.png"));

        let output =
            env::temp_dir().join(format!("converter-core-even-header-{}.docx", process::id()));
        write_docx_with_sections_and_headers(
            output.to_str().unwrap(),
            &[],
            &[WordBinarySection {
                cp_end: i32::MAX,
                properties: DocxSection::default(),
            }],
            &headers,
        )
        .unwrap();
        let file = File::open(&output).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert!(archive.by_name("word/settings.xml").is_ok());
        drop(archive);
        let _ = fs::remove_file(output);
    }

    #[test]
    fn copies_raw_embedded_jpeg_preview() {
        let jpeg = test_jpeg(1600, 1200, 8, 8);
        let raw = [b"RAW".as_slice(), jpeg.as_slice(), b"END"].concat();
        let base = env::temp_dir().join(format!("converter-core-raw-{}", process::id()));
        let input = base.with_extension("dng");
        let output = base.with_extension("jpg");
        fs::write(&input, raw).unwrap();

        convert_raw_preview(input.to_str().unwrap(), output.to_str().unwrap(), "jpg").unwrap();
        assert_eq!(fs::read(&output).unwrap(), jpeg);
        validate_output(output.to_str().unwrap(), "jpg").unwrap();

        for path in [input, output] {
            let _ = fs::remove_file(path);
        }
    }

    #[test]
    fn extracts_largest_embedded_icns_png_preview() {
        let small = test_png(32, 32);
        let large = test_png(128, 128);
        let bytes = test_icns(&[(b"icp5", &small), (b"ic09", &large)]);

        assert_eq!(best_icns_png(&bytes), Some(large.as_slice()));
        assert!(is_icns_source("icns"));
        assert!(!is_icns_source("ico"));
    }

    #[test]
    fn copies_icns_embedded_png_preview() {
        let png = test_png(64, 64);
        let icns = test_icns(&[(b"ic07", &png)]);
        let base = env::temp_dir().join(format!("converter-core-icns-{}", process::id()));
        let input = base.with_extension("icns");
        let output = base.with_extension("png");
        fs::write(&input, icns).unwrap();

        convert_icns_preview(input.to_str().unwrap(), output.to_str().unwrap(), "png").unwrap();
        assert_eq!(fs::read(&output).unwrap(), png);
        validate_output(output.to_str().unwrap(), "png").unwrap();

        for path in [input, output] {
            let _ = fs::remove_file(path);
        }
    }

    #[test]
    fn strips_macro_metadata_and_rewrites_main_type() {
        let input = br#"<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/><Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>"#;
        let output = normalize_content_types(
            input,
            "/word/document.xml",
            target_contract("docx").unwrap().1,
        )
        .unwrap();
        let output = String::from_utf8(output).unwrap();
        assert!(output.contains("wordprocessingml.document.main+xml"));
        assert!(!output.to_ascii_lowercase().contains("vbaproject"));
    }

    #[test]
    fn preserves_plain_text_blocks_tabs_and_spaces() {
        let paragraphs = extract_text_paragraphs("Alpha\nBeta\n \nGamma\twith  spaces\n");
        assert_eq!(paragraphs, ["Alpha\nBeta", "Gamma\twith  spaces"]);
        assert!(word_text_xml(&paragraphs[1]).contains("<w:tab/>"));
        assert!(word_text_xml(&paragraphs[1]).contains("xml:space=\"preserve\""));
    }

    #[test]
    fn maps_legacy_word_run_properties() {
        let mut page = [0u8; 512];
        let props = [
            0x35, 0x08, 1, // bold
            0x36, 0x08, 1, // italic
            0x3e, 0x2a, 1, // underline
            0x43, 0x4a, 28, 0, // 14pt
            0x70, 0x68, 255, 0, 0, 0, // red
        ];
        page[160] = props.len() as u8;
        page[161..161 + props.len()].copy_from_slice(&props);
        let parsed = parse_word_binary_chpx_props(&page, 160).unwrap();
        assert!(parsed.bold && parsed.italic && parsed.underline);
        assert_eq!(parsed.font_size, 28);
        assert_eq!(parsed.color, Some([255, 0, 0]));
    }

    #[test]
    fn preserves_legacy_word_fields_and_cached_results() {
        let document = b"\x13 PAGE \\* MERGEFORMAT \x141\x15\r";
        let paragraphs = decode_word_binary_paragraphs(
            document,
            &[],
            &[WordBinaryPiece {
                cp_start: 0,
                cp_end: document.len() as i32,
                file_offset: 0,
                compressed: true,
                prm: 0,
            }],
            &[],
            &[],
            &[],
        );
        assert_eq!(paragraphs.len(), 1);
        assert_eq!(paragraphs[0].text, "1");
        assert_eq!(paragraphs[0].runs.len(), 1);
        assert_eq!(
            paragraphs[0].runs[0].field_instruction,
            "PAGE \\* MERGEFORMAT"
        );
        let xml = docx_document(&paragraphs, DocxSection::default());
        assert!(
            xml.contains("<w:instrText xml:space=\"preserve\">PAGE \\* MERGEFORMAT</w:instrText>")
        );
        for kind in ["begin", "separate", "end"] {
            assert!(xml.contains(&format!("w:fldCharType=\"{kind}\"")));
        }
        assert!(xml.contains("<w:t>1</w:t>"));
    }

    #[test]
    fn simplifies_nested_legacy_fields_without_leaking_instructions() {
        let document = b"\x13 IF \x13 PAGE \x141\x15 = 1 \"yes\" \"no\" \x14yes\x15\r";
        let paragraphs = decode_word_binary_paragraphs(
            document,
            &[],
            &[WordBinaryPiece {
                cp_start: 0,
                cp_end: document.len() as i32,
                file_offset: 0,
                compressed: true,
                prm: 0,
            }],
            &[],
            &[],
            &[],
        );
        assert_eq!(paragraphs[0].text, "yes");
        assert_eq!(
            paragraphs[0].runs[0].field_instruction,
            "IF 1 = 1 \"yes\" \"no\""
        );
        let xml = docx_document(&paragraphs, DocxSection::default());
        assert_eq!(xml.matches("<w:instrText").count(), 1);
        assert!(!xml.contains("PAGE 1"));

        let no_cache = b"\x13 NUMPAGES \x15\r";
        let paragraphs = decode_word_binary_paragraphs(
            no_cache,
            &[],
            &[WordBinaryPiece {
                cp_start: 0,
                cp_end: no_cache.len() as i32,
                file_offset: 0,
                compressed: true,
                prm: 0,
            }],
            &[],
            &[],
            &[],
        );
        assert_eq!(paragraphs[0].runs[0].field_instruction, "NUMPAGES");
        assert!(
            docx_document(&paragraphs, DocxSection::default()).contains(">NUMPAGES</w:instrText>")
        );
    }

    #[test]
    fn writes_legacy_embedded_image_relationship() {
        let image = test_jpeg(320, 240, 8, 4);
        let base = env::temp_dir().join(format!("converter-core-image-{}", process::id()));
        let output = base.with_extension("docx");
        let paragraphs = vec![DocxParagraph {
            runs: vec![DocxRun {
                image: Some(DocxImage {
                    data: image,
                    extension: "jpeg",
                    content_type: "image/jpeg",
                    width_emu: 3_048_000,
                    height_emu: 2_286_000,
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        }];
        write_docx(output.to_str().unwrap(), &paragraphs).unwrap();
        let file = File::open(&output).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert!(archive.by_name("word/media/image1.jpeg").is_ok());
        let mut rels = String::new();
        archive
            .by_name("word/_rels/document.xml.rels")
            .unwrap()
            .read_to_string(&mut rels)
            .unwrap();
        assert!(rels.contains("rIdImage1") && rels.contains("media/image1.jpeg"));
        let _ = fs::remove_file(output);
    }

    #[test]
    fn writes_legacy_table_cells_and_rows() {
        let document = docx_document(
            &[
                DocxParagraph {
                    text: "A".into(),
                    table_cell: true,
                    ..Default::default()
                },
                DocxParagraph {
                    text: "B".into(),
                    table_cell: true,
                    table_row_end: true,
                    ..Default::default()
                },
                DocxParagraph {
                    text: "C".into(),
                    table_cell: true,
                    table_row_end: true,
                    ..Default::default()
                },
            ],
            DocxSection::default(),
        );
        assert_eq!(document.matches("<w:tbl>").count(), 1);
        assert_eq!(document.matches("<w:tr>").count(), 2);
        assert_eq!(document.matches("<w:tc>").count(), 3);
        assert!(document.contains("<w:tblW w:w=\"10080\" w:type=\"dxa\"/>"));
        assert_eq!(document.matches("<w:gridCol").count(), 2);
        assert_eq!(document.matches("<w:tcW").count(), 3);
    }

    #[test]
    fn parses_legacy_table_definition_merge_flags() {
        let mut operand = vec![0x30, 0x00, 2, 0x00, 0x00, 0xE8, 0x03, 0xD0, 0x07];
        operand.extend_from_slice(&[0x60, 0x00]);
        operand.extend(std::iter::repeat_n(0, 18));
        operand.extend_from_slice(&[0x02, 0x00]);
        operand.extend(std::iter::repeat_n(0, 18));
        let definition = parse_word_binary_table_def(&operand).unwrap();
        assert_eq!(definition.rgdxa, [0, 1000, 2000]);
        assert_eq!(
            definition
                .cells
                .iter()
                .map(|cell| cell.flags)
                .collect::<Vec<_>>(),
            [0x60, 0x0002]
        );
    }

    #[test]
    fn preserves_legacy_table_cell_borders_and_layout() {
        let mut operand = vec![0x1a, 0x00, 1, 0x00, 0x00, 0xe8, 0x03];
        operand.extend_from_slice(&0x3684u16.to_le_bytes());
        operand.extend_from_slice(&900u16.to_le_bytes());
        operand.extend_from_slice(&[8, 1, 6, 2]);
        operand.extend_from_slice(&[0, 0, 0, 0]);
        operand.extend_from_slice(&[4, 3, 2, 0x20]);
        operand.extend_from_slice(&[8, 7, 9, 0]);
        let definition = parse_word_binary_table_def(&operand).unwrap();
        assert_eq!(definition.cells[0].width, 900);
        assert_eq!(
            definition.cells[0].borders[0].and_then(|border| border.color),
            Some([255, 0, 0])
        );
        assert!(definition.cells[0].borders[1].is_none());

        let mut paragraphs = vec![DocxParagraph {
            text: "Cell".into(),
            table_cell: true,
            table_row_end: true,
            ..Default::default()
        }];
        apply_word_binary_table_definition(&mut paragraphs, &definition);
        let document = docx_document(&paragraphs, DocxSection::default());
        assert!(document.contains("<w:tblBorders><w:top w:val=\"nil\""));
        assert!(document.contains("<w:tcW w:w=\"900\" w:type=\"dxa\"/>"));
        assert!(
            document
                .contains("<w:top w:val=\"single\" w:sz=\"8\" w:space=\"2\" w:color=\"FF0000\"")
        );
        assert!(document.contains("<w:left w:val=\"nil\"/>"));
        assert!(document.contains("<w:bottom w:val=\"double\" w:sz=\"4\" w:space=\"0\" w:color=\"0000FF\" w:shadow=\"1\"/>"));
        assert!(document.contains(
            "<w:noWrap/><w:textDirection w:val=\"tbRl\"/><w:tcFitText/><w:vAlign w:val=\"center\"/>"
        ));
    }

    #[test]
    fn preserves_legacy_table_row_height_and_pagination() {
        let mut page = [0u8; 128];
        let data = [
            0, 0, // style id
            0x03, 0x34, 1, // do not split the row
            0x04, 0x34, 1, // repeat as a header row
            0x07, 0x94, 0x2c, 0x01, // 300 twips
        ];
        page[32] = 0;
        page[33] = (data.len() / 2) as u8;
        page[34..34 + data.len()].copy_from_slice(&data);
        let properties = parse_word_binary_papx_props(&page, 32, &[]).unwrap();
        assert!(properties.table_row_cant_split && properties.table_row_header);
        assert_eq!(properties.table_row_height, 300);

        let document = docx_document(
            &[DocxParagraph {
                text: "Header".into(),
                table_cell: true,
                table_row_end: true,
                table_row_height: -300,
                table_row_cant_split: true,
                table_row_header: true,
                ..Default::default()
            }],
            DocxSection::default(),
        );
        assert!(document.contains(
            "<w:trPr><w:cantSplit/><w:trHeight w:val=\"300\" w:hRule=\"exact\"/><w:tblHeader/></w:trPr>"
        ));
    }

    #[test]
    fn preserves_legacy_table_borders_alignment_and_cell_padding() {
        let mut table_definition = vec![0x1a, 0x00, 1, 0x00, 0x00, 0xe8, 0x03];
        table_definition.extend(std::iter::repeat_n(0, 20));
        let mut data = vec![0, 0];
        data.extend_from_slice(&0x5400u16.to_le_bytes());
        data.extend_from_slice(&1u16.to_le_bytes());
        data.extend_from_slice(&0xd605u16.to_le_bytes());
        data.push(24);
        for border in [
            [8, 1, 6, 0],
            [0, 0, 0, 0],
            [4, 3, 2, 0],
            [0, 0, 0, 0],
            [2, 6, 9, 0],
            [2, 7, 13, 0],
        ] {
            data.extend_from_slice(&border);
        }
        // Padding appears before TDef to cover the ordering used by some producers.
        data.extend_from_slice(&0xd634u16.to_le_bytes());
        data.extend_from_slice(&[6, 0, 1, 0x0f, 3, 120, 0]);
        data.extend_from_slice(&0xd608u16.to_le_bytes());
        data.extend_from_slice(&table_definition);
        assert_eq!(data.len(), 71);
        let mut page = [0u8; 128];
        page[32] = 36;
        page[33..33 + data.len()].copy_from_slice(&data);

        let properties = parse_word_binary_papx_props(&page, 32, &[]).unwrap();
        assert_eq!(properties.table_alignment, "center");
        assert_eq!(
            properties
                .table_borders
                .and_then(|borders| borders[0])
                .and_then(|border| border.color),
            Some([255, 0, 0])
        );
        let definition = properties.table_def.as_ref().unwrap();
        assert_eq!(definition.cells[0].margins, [Some(120); 4]);

        let mut paragraphs = vec![DocxParagraph {
            text: "Cell".into(),
            table_cell: true,
            table_row_end: true,
            table_alignment: properties.table_alignment,
            table_borders: properties.table_borders,
            ..Default::default()
        }];
        apply_word_binary_table_definition(&mut paragraphs, definition);
        let document = docx_document(&paragraphs, DocxSection::default());
        assert!(document.contains("<w:jc w:val=\"center\"/>"));
        assert!(
            document
                .contains("<w:top w:val=\"single\" w:sz=\"8\" w:space=\"0\" w:color=\"FF0000\"/>")
        );
        assert!(document.contains("<w:insideH w:val=\"dotted\""));
        assert!(document.contains("<w:tcMar><w:top w:w=\"120\" w:type=\"dxa\"/><w:left w:w=\"120\" w:type=\"dxa\"/><w:bottom w:w=\"120\" w:type=\"dxa\"/><w:right w:w=\"120\" w:type=\"dxa\"/></w:tcMar>"));
    }

    #[test]
    fn writes_legacy_table_merge_properties() {
        let document = docx_document(
            &[
                DocxParagraph {
                    text: "A".into(),
                    table_cell: true,
                    table_grid_span: 2,
                    table_v_merge: "restart",
                    table_row_end: true,
                    ..Default::default()
                },
                DocxParagraph {
                    text: "B".into(),
                    table_cell: true,
                    table_v_merge: "continue",
                    table_row_end: true,
                    ..Default::default()
                },
            ],
            DocxSection::default(),
        );
        assert!(document.contains("<w:gridSpan w:val=\"2\"/>"));
        assert!(document.contains("<w:vMerge w:val=\"restart\"/>"));
        assert!(document.contains("<w:vMerge/>"));
    }

    #[test]
    fn writes_table_grid_from_all_rows() {
        let document = docx_document(
            &[
                DocxParagraph {
                    text: "A".into(),
                    table_cell: true,
                    table_grid_span: 3,
                    table_grid_left: 0,
                    table_grid_right: 6872,
                    table_grid_bounds: vec![0, 6872, 9302],
                    ..Default::default()
                },
                DocxParagraph {
                    text: "B".into(),
                    table_cell: true,
                    table_grid_span: 2,
                    table_grid_left: 6872,
                    table_grid_right: 9302,
                    table_grid_bounds: vec![0, 6872, 9302],
                    table_row_end: true,
                    ..Default::default()
                },
                DocxParagraph {
                    text: "C".into(),
                    table_cell: true,
                    table_grid_left: 0,
                    table_grid_right: 1062,
                    table_grid_bounds: vec![0, 1062, 5738, 6872, 8148, 9302],
                    table_row_end: true,
                    ..Default::default()
                },
            ],
            DocxSection::default(),
        );
        assert_eq!(document.matches("<w:gridCol").count(), 5);
        assert!(document.contains("<w:gridSpan w:val=\"3\"/>"));
        assert!(document.contains("<w:gridSpan w:val=\"2\"/>"));
    }

    #[test]
    fn writes_legacy_table_indent_from_grid_origin() {
        let document = docx_document(
            &[DocxParagraph {
                text: "Indented".into(),
                table_cell: true,
                table_row_end: true,
                table_grid_left: 720,
                table_grid_right: 1720,
                table_grid_bounds: vec![720, 1720],
                ..Default::default()
            }],
            DocxSection::default(),
        );
        assert!(document.contains("<w:tblInd w:w=\"720\" w:type=\"dxa\"/>"));
    }

    #[test]
    fn writes_paragraph_layout_properties_as_valid_siblings() {
        let document = docx_document(
            &[DocxParagraph {
                text: "Styled".into(),
                spacing_before: 120,
                spacing_after: 240,
                line_spacing: 360,
                line_spacing_rule: "auto",
                keep_next: true,
                keep_lines: true,
                page_break_before: true,
                bidi: true,
                ..Default::default()
            }],
            DocxSection::default(),
        );
        assert!(document.contains(
            "<w:spacing w:before=\"120\" w:after=\"240\" w:line=\"360\" w:lineRule=\"auto\"/><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:bidi/>"
        ));
        assert!(!document.contains("<w:spacing <w:keepNext"));
    }

    #[test]
    fn preserves_legacy_manual_page_breaks() {
        let document = b"First\x0cSecond\r";
        let paragraphs = decode_word_binary_paragraphs(
            document,
            &[],
            &[WordBinaryPiece {
                cp_start: 0,
                cp_end: document.len() as i32,
                file_offset: 0,
                compressed: true,
                prm: 0,
            }],
            &[],
            &[],
            &[],
        );
        assert_eq!(paragraphs.len(), 2);
        assert!(paragraphs[0].page_break_after);
        assert_eq!(
            docx_document(&paragraphs, DocxSection::default())
                .matches("<w:br w:type=\"page\"/>")
                .count(),
            1
        );
    }

    #[test]
    fn reads_legacy_reported_page_count() {
        let mut dop = vec![0u8; 48];
        dop[46..48].copy_from_slice(&10u16.to_le_bytes());
        assert_eq!(
            parse_word_binary_page_count(
                &dop,
                WordBinaryFib {
                    lcb_dop: dop.len(),
                    ..Default::default()
                }
            ),
            Some(10)
        );
    }

    #[test]
    fn distributes_legacy_rendered_page_breaks() {
        let mut paragraphs = (0..12)
            .map(|index| DocxParagraph {
                text: format!("Paragraph {index} {}", "content ".repeat(40)),
                source_cp_start: index * 100,
                source_cp_end: index * 100 + 99,
                line_spacing: 240,
                line_spacing_rule: "auto",
                ..Default::default()
            })
            .collect::<Vec<_>>();
        let sections = [WordBinarySection {
            cp_end: i32::MAX,
            properties: DocxSection::default(),
        }];
        apply_word_binary_pagination(&mut paragraphs, &sections, Some(3));
        assert_eq!(
            paragraphs
                .iter()
                .filter(|paragraph| paragraph.last_rendered_page_break_before)
                .count(),
            2
        );
        assert_eq!(
            docx_document_with_sections(&paragraphs, &sections)
                .matches("<w:lastRenderedPageBreak/>")
                .count(),
            2
        );
    }

    #[test]
    fn estimates_legacy_pages_when_document_properties_are_missing() {
        let mut paragraphs = (0..6)
            .map(|index| DocxParagraph {
                text: format!("Paragraph {index} {}", "content ".repeat(300)),
                source_cp_start: index * 1_000,
                source_cp_end: index * 1_000 + 999,
                line_spacing: 240,
                line_spacing_rule: "auto",
                ..Default::default()
            })
            .collect::<Vec<_>>();
        let sections = [WordBinarySection {
            cp_end: i32::MAX,
            properties: DocxSection::default(),
        }];
        apply_word_binary_pagination(&mut paragraphs, &sections, None);
        assert!(
            paragraphs
                .iter()
                .filter(|paragraph| paragraph.last_rendered_page_break_before)
                .count()
                >= 2
        );
    }

    #[test]
    fn paginates_inside_a_long_legacy_paragraph() {
        let text = "Long paragraph content ".repeat(500);
        let mut paragraphs = vec![DocxParagraph {
            text: text.clone(),
            source_cp_end: text.chars().count() as i32,
            line_spacing: 240,
            line_spacing_rule: "auto",
            runs: vec![DocxRun {
                text,
                ..Default::default()
            }],
            ..Default::default()
        }];
        let sections = [WordBinarySection {
            cp_end: i32::MAX,
            properties: DocxSection::default(),
        }];
        apply_word_binary_pagination(&mut paragraphs, &sections, Some(3));
        assert_eq!(paragraphs[0].rendered_page_break_offsets.len(), 2);
        assert_eq!(
            docx_document_with_sections(&paragraphs, &sections)
                .matches("<w:lastRenderedPageBreak/>")
                .count(),
            2
        );
    }

    #[test]
    fn splits_legacy_tables_at_rendered_page_breaks() {
        let document = docx_document(
            &[
                DocxParagraph {
                    text: "Row 1".into(),
                    table_cell: true,
                    table_row_end: true,
                    ..Default::default()
                },
                DocxParagraph {
                    text: "Row 2".into(),
                    table_cell: true,
                    table_row_end: true,
                    last_rendered_page_break_before: true,
                    ..Default::default()
                },
            ],
            DocxSection::default(),
        );
        assert_eq!(document.matches("<w:tbl>").count(), 2);
        assert_eq!(document.matches("<w:lastRenderedPageBreak/>").count(), 1);
    }

    #[test]
    fn extracts_markdown_structure_without_markup_noise() {
        let input = "---\ntitle: Hidden\n---\n<!-- hidden -->\n# Heading\n\n- [x] Done\n\n| Name | Value |\n| --- | ---: |\n| Alpha | 42 |\n\nA [link][paper] and note[^1].\n[paper]: https://example.test\n[^1]: hidden";
        let paragraphs = extract_markdown_paragraphs(input);
        let values: Vec<_> = paragraphs
            .iter()
            .map(|paragraph| paragraph.text.as_str())
            .collect();
        assert_eq!(
            values,
            [
                "Heading",
                "Done",
                "Name / Value",
                "Alpha / 42",
                "A link and note."
            ]
        );
        assert_eq!(paragraphs[0].heading_level, 1);
        assert_eq!(paragraphs[1].list_kind, "bullet");
    }

    #[test]
    fn parses_quoted_delimited_rows() {
        let rows = parse_delimited("Name;Note\nFixture;\"one;two\"\n", ';').unwrap();
        assert_eq!(rows[1], ["Fixture", "one;two"]);
    }

    #[test]
    fn preserves_delimited_line_endings_quotes_unicode_and_empty_fields() {
        let rows = parse_delimited(
            "\"中文\",\"one\r\ntwo\",\"a\"\"b\"\r\nlast,\"\",\rnext,done,\"\"",
            ',',
        )
        .unwrap();
        assert_eq!(
            rows,
            vec![
                vec!["中文", "one\r\ntwo", "a\"b"],
                vec!["last", "", ""],
                vec!["next", "done", ""]
            ]
        );
        assert!(parse_delimited("a,\"unterminated", ',').is_err());
        assert_eq!(
            parse_delimited_rows("\u{feff}sep=;\r\nA;B\r\n", "csv")
                .unwrap()
                .1
                .len(),
            1
        );
    }

    #[test]
    fn preserves_delimited_rows_and_columns_beyond_old_preview_caps() {
        let text = (0..20_000)
            .map(|row| format!("{row},end\n"))
            .collect::<String>();
        let (_, rows) = parse_delimited_rows(&text, "csv").unwrap();
        assert_eq!(rows.len(), 20_000);
        assert!(matches!(&rows[19_999][0], SheetCell::Number(value) if value == "19999"));
        let (_, rows) = parse_delimited_rows(&vec!["value"; 1025].join(","), "csv").unwrap();
        assert_eq!(rows[0].len(), 1025);
        assert!(parse_delimited_rows(&vec![""; MAX_SHEET_COLUMNS + 1].join(","), "csv").is_err());
        assert!(parse_delimited_rows(&"0\n".repeat(MAX_DELIMITED_CELLS + 1), "csv").is_err());
    }

    #[test]
    fn extracts_subtitle_cues_without_timing_or_styles() {
        let paragraphs = extract_subtitle_paragraphs(
            "1\n00:00:00,000 --> 00:00:02,000\n{\\an8}<i>Fixture subtitle</i>\n",
            "srt",
        );
        assert_eq!(paragraphs[0].text, "Fixture subtitle");
    }

    #[test]
    fn extracts_notebook_sources_and_outputs() {
        let paragraphs = extract_ipynb_paragraphs(
            r##"{"cells":[{"cell_type":"markdown","source":["# Heading"]},{"cell_type":"code","source":["x = 1"],"outputs":[{"output_type":"stream","text":"1"}]}]}"##,
        );
        let values: Vec<_> = paragraphs
            .iter()
            .map(|paragraph| paragraph.text.as_str())
            .collect();
        assert_eq!(values, ["Heading", "x = 1", "1"]);
        assert_eq!(paragraphs[0].heading_level, 1);
    }

    #[test]
    fn extracts_xml_leaf_text_and_rejects_broken_xml() {
        let paragraphs =
            extract_xml_paragraphs("<root><title>A &amp; B</title><body>Text</body></root>")
                .unwrap();
        let values: Vec<_> = paragraphs
            .iter()
            .map(|paragraph| paragraph.text.as_str())
            .collect();
        assert_eq!(values, ["A & B", "Text"]);
        assert!(extract_xml_paragraphs("<root>").is_err());
    }

    #[test]
    fn extracts_html_and_fb2_readable_content() {
        let html = extract_html_paragraphs(
            "<title>Meta</title><style>hidden</style><!-- hidden > text --><h1>Heading</h1><p>Body &amp; more&nbsp;text &#x2014;</p><img alt=\"Chart\"><ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><ol><li>Three</li></ol>",
        );
        assert_eq!(
            html.iter()
                .map(|paragraph| paragraph.text.as_str())
                .collect::<Vec<_>>(),
            [
                "Meta",
                "Heading",
                "Body & more text \u{2014}",
                "Chart",
                "One",
                "Nested",
                "Two",
                "Three"
            ]
        );
        assert_eq!(html[0].heading_level, 1);
        assert_eq!(html[4].list_kind, "bullet");
        assert_eq!(html[5].list_kind, "bullet");
        assert_eq!(html[5].list_level, 1);
        assert_eq!(html[6].list_kind, "bullet");
        assert_eq!(html[7].list_kind, "decimal");

        let fb2 = extract_fb2_paragraphs(
            "<FictionBook><description>Hidden</description><body><section><title><p>Chapter</p></title><p>Body</p><binary>hidden</binary></section></body></FictionBook>",
        )
        .unwrap();
        assert_eq!(
            fb2.iter()
                .map(|paragraph| paragraph.text.as_str())
                .collect::<Vec<_>>(),
            ["Chapter", "Body"]
        );
        assert_eq!(fb2[0].heading_level, 1);
    }

    #[test]
    fn extracts_mhtml_html_part_and_decodes_quoted_printable() {
        let input = "Content-Type: multipart/related; boundary=fixture\n\n--fixture\nContent-Type: text/html\nContent-Transfer-Encoding: quoted-printable\n\n<h1>Fixture=20MHTML</h1>\n--fixture--";
        let paragraphs = extract_mhtml_paragraphs(input);
        assert_eq!(paragraphs[0].text, "Fixture MHTML");
        assert_eq!(paragraphs[0].heading_level, 1);
    }

    #[test]
    fn extracts_structured_contacts_and_multipart_mail() {
        let card = extract_vcard_paragraphs(
            "BEGIN:VCARD\nFN:Fixture\nTITLE;CHARSET=windows-1252;ENCODING=QUOTED-PRINTABLE:A=96B\nEND:VCARD",
        );
        assert_eq!(card[1].text, "Title: A–B");

        let mail = extract_eml_paragraphs(
            "Subject: =?UTF-8?B?5rWL6K+V?=\nContent-Type: multipart/alternative; boundary=x\n\n--x\nContent-Type: text/plain\n\nPlain\n--x\nContent-Type: text/html\nContent-Transfer-Encoding: base64\n\nPHA+SFRNTCBib2R5PC9wPg==\n--x--",
        );
        assert_eq!(
            mail.iter()
                .map(|paragraph| paragraph.text.as_str())
                .collect::<Vec<_>>(),
            ["Subject: \u{6d4b}\u{8bd5}", "HTML body"]
        );
        assert_eq!(
            decode_base64("U3BsaXQg\r\nbGluZXM=").unwrap(),
            b"Split lines"
        );
        assert!(decode_base64("invalid!").is_none());
        assert_eq!(decode_mime_header("=?UTF-8?Q?Hello_World?="), "Hello World");
    }

    #[test]
    fn parses_msg_text_properties() {
        assert_eq!(
            parse_msg_text_property_name("__substg1.0_0037001f\0"),
            Some(("0037", "001F"))
        );
        let utf16 = "Subject\r\nLine\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        assert_eq!(decode_msg_text_property(&utf16, "001F"), "Subject\nLine");
        assert_eq!(
            decode_msg_text_property(&[b'A', 0x96, b'B', 0], "001E"),
            "A–B"
        );
    }

    #[test]
    fn extracts_rtf_runs_and_list_markers() {
        let paragraphs = extract_rtf_paragraphs(
            br"{\rtf1\ansi{\colortbl;\red255\green0\blue0;\red255\green255\blue0;}\fs24 \b Bold\b0 , \i italic\i0\line Next\tab Cell\par\strike Deleted\strike0 \super 2\nosupersub\par\cf1\highlight2 Styled\par\bullet Item\par}",
        )
        .unwrap();
        assert_eq!(paragraphs[0].runs[0].text, "Bold");
        assert!(paragraphs[0].runs[0].bold);
        assert!(paragraphs[0].runs[2].italic);
        assert!(
            paragraphs[0]
                .runs
                .iter()
                .any(|run| run.text.contains("\nNext\tCell"))
        );
        assert!(paragraphs[1].runs[0].strike);
        assert_eq!(paragraphs[1].runs[1].vertical_align, "superscript");
        assert!(docx_run_properties(&paragraphs[1].runs[0]).contains("<w:strike/>"));
        assert!(docx_run_properties(&paragraphs[1].runs[1]).contains("w:val=\"superscript\""));
        assert_eq!(paragraphs[2].runs[0].color, "FF0000");
        assert_eq!(paragraphs[2].runs[0].highlight, "FFFF00");
        let properties = docx_run_properties(&paragraphs[2].runs[0]);
        assert!(properties.contains("<w:color w:val=\"FF0000\"/>"));
        assert!(properties.contains("w:fill=\"FFFF00\""));
        assert_eq!(paragraphs[3].list_kind, "bullet");
        assert_eq!(paragraphs[3].runs[0].text, "Item");
    }

    #[test]
    fn extracts_sylk_and_dif_cells() {
        let sylk = parse_sylk_rows("ID;P\nC;X1;Y1;K\"Name\"\nC;X2;Y1;K42\nE").unwrap();
        assert!(matches!(&sylk[0][0], SheetCell::Text(value) if value == "Name"));
        assert!(matches!(&sylk[0][1], SheetCell::Number(value) if value == "42"));

        let dif =
            parse_dif_rows("DATA\n0,0\n\"\"\n-1,0\n\"BOT\"\n1,0\n\"Name\"\n-1,0\n\"EOD\"").unwrap();
        assert!(matches!(&dif[0][0], SheetCell::Text(value) if value == "Name"));
    }

    #[test]
    fn parses_biff_label_and_number_cells() {
        let mut workbook = Vec::new();
        let mut add_record = |id: u16, data: &[u8]| {
            workbook.extend_from_slice(&id.to_le_bytes());
            workbook.extend_from_slice(&(data.len() as u16).to_le_bytes());
            workbook.extend_from_slice(data);
        };
        add_record(0x0809, &[0; 4]);
        let mut label = vec![0, 0, 0, 0, 0, 0, 4, 0, 0];
        label.extend_from_slice(b"Name");
        add_record(0x0204, &label);
        let mut number = vec![0, 0, 1, 0, 0, 0];
        number.extend_from_slice(&42.5f64.to_bits().to_le_bytes());
        add_record(0x0203, &number);
        let rows = &parse_biff_sheets(&workbook).unwrap()[0].1;
        assert!(matches!(&rows[0][0], SheetCell::Text(value) if value == "Name"));
        assert!(matches!(&rows[0][1], SheetCell::Number(value) if value == "42.5"));
    }

    #[test]
    fn preserves_multiple_biff_worksheets() {
        fn add_record(workbook: &mut Vec<u8>, id: u16, data: &[u8]) {
            workbook.extend_from_slice(&id.to_le_bytes());
            workbook.extend_from_slice(&(data.len() as u16).to_le_bytes());
            workbook.extend_from_slice(data);
        }

        let mut workbook = Vec::new();
        add_record(&mut workbook, 0x0809, &[0; 4]);
        let first_boundsheet = workbook.len() + 4;
        add_record(
            &mut workbook,
            0x0085,
            &[0, 0, 0, 0, 0, 0, 5, 0, b'F', b'i', b'r', b's', b't'],
        );
        let second_boundsheet = workbook.len() + 4;
        add_record(
            &mut workbook,
            0x0085,
            &[0, 0, 0, 0, 0, 0, 6, 0, b'S', b'e', b'c', b'o', b'n', b'd'],
        );

        let first_offset = workbook.len() as u32;
        add_record(&mut workbook, 0x0809, &[0; 4]);
        let mut first_label = vec![0, 0, 0, 0, 0, 0, 3, 0, 0];
        first_label.extend_from_slice(b"One");
        add_record(&mut workbook, 0x0204, &first_label);
        add_record(&mut workbook, 0x000a, &[]);

        let second_offset = workbook.len() as u32;
        add_record(&mut workbook, 0x0809, &[0; 4]);
        let mut second_label = vec![0, 0, 0, 0, 0, 0, 3, 0, 0];
        second_label.extend_from_slice(b"Two");
        add_record(&mut workbook, 0x0204, &second_label);
        add_record(&mut workbook, 0x000a, &[]);

        workbook[first_boundsheet..first_boundsheet + 4]
            .copy_from_slice(&first_offset.to_le_bytes());
        workbook[second_boundsheet..second_boundsheet + 4]
            .copy_from_slice(&second_offset.to_le_bytes());

        let sheets = parse_biff_sheets(&workbook).unwrap();
        assert_eq!(sheets.len(), 2);
        assert_eq!(sheets[0].0, "First");
        assert!(matches!(&sheets[0].1[0][0], SheetCell::Text(value) if value == "One"));
        assert_eq!(sheets[1].0, "Second");
        assert!(matches!(&sheets[1].1[0][0], SheetCell::Text(value) if value == "Two"));
        assert!(xlsx_content_types(2).contains("sheet2.xml"));
        assert!(xlsx_workbook(&["First", "Second"]).contains("r:id=\"rId2\""));
    }

    #[test]
    fn extracts_nested_powerpoint_text_records() {
        let text = "Fixture title"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        let mut atom = Vec::new();
        atom.extend_from_slice(&0u16.to_le_bytes());
        atom.extend_from_slice(&4000u16.to_le_bytes());
        atom.extend_from_slice(&(text.len() as u32).to_le_bytes());
        atom.extend_from_slice(&text);
        let mut container = Vec::new();
        container.extend_from_slice(&0x000fu16.to_le_bytes());
        container.extend_from_slice(&1000u16.to_le_bytes());
        container.extend_from_slice(&(atom.len() as u32).to_le_bytes());
        container.extend_from_slice(&atom);
        let mut items = Vec::new();
        walk_ppt_records(&container, &mut 0, &mut items, &mut Vec::new()).unwrap();
        assert_eq!(items, ["Fixture title"]);
    }

    #[test]
    fn preserves_powerpoint_slide_containers() {
        fn record(record_type: u16, container: bool, payload: &[u8]) -> Vec<u8> {
            let mut value = Vec::new();
            value.extend_from_slice(&(if container { 0x000fu16 } else { 0 }).to_le_bytes());
            value.extend_from_slice(&record_type.to_le_bytes());
            value.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            value.extend_from_slice(payload);
            value
        }

        let first_text = "First"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        let second_text = "Second"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        let mut document = record(1006, true, &record(4000, false, &first_text));
        document.extend_from_slice(&record(1006, true, &record(4000, false, &second_text)));

        let mut loose = Vec::new();
        let mut slides = Vec::new();
        walk_ppt_records(&document, &mut 0, &mut loose, &mut slides).unwrap();
        assert!(loose.is_empty());
        assert_eq!(slides, [["First"], ["Second"]]);
    }

    #[test]
    fn resolves_compound_root_streams_without_embedded_name_collisions() {
        fn directory_record(name: &str, kind: u8, left: u32, right: u32, child: u32) -> [u8; 128] {
            let mut record = [0u8; 128];
            let encoded = name
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            for (index, value) in encoded.iter().enumerate() {
                record[index * 2..index * 2 + 2].copy_from_slice(&value.to_le_bytes());
            }
            record[0x40..0x42].copy_from_slice(&((encoded.len() * 2) as u16).to_le_bytes());
            record[0x42] = kind;
            record[0x44..0x48].copy_from_slice(&left.to_le_bytes());
            record[0x48..0x4c].copy_from_slice(&right.to_le_bytes());
            record[0x4c..0x50].copy_from_slice(&child.to_le_bytes());
            record
        }

        let directory = [
            directory_record("Root Entry", 5, CFB_FREE, CFB_FREE, 1),
            directory_record("WordDocument", 2, CFB_FREE, 2, CFB_FREE),
            directory_record("ObjectPool", 1, CFB_FREE, CFB_FREE, 3),
            directory_record("WordDocument", 2, CFB_FREE, CFB_FREE, CFB_FREE),
        ]
        .concat();
        let entries = parse_compound_directory(&directory).unwrap();
        assert!(entries.iter().any(|entry| entry.path == "WordDocument"));
        assert!(
            entries
                .iter()
                .any(|entry| entry.path == "ObjectPool/WordDocument")
        );
        assert_eq!(
            entries
                .iter()
                .filter(|entry| entry.path == "WordDocument")
                .count(),
            1
        );
    }

    #[test]
    fn extracts_powerpoint_blip_ids_and_picture_payloads() {
        let jpeg = test_jpeg(1280, 720, 8, 4);
        let mut picture_payload = vec![0u8; 17];
        picture_payload.extend_from_slice(&jpeg);
        let mut picture_stream = Vec::new();
        picture_stream.extend_from_slice(&0x46a0u16.to_le_bytes());
        picture_stream.extend_from_slice(&0xf01du16.to_le_bytes());
        picture_stream.extend_from_slice(&(picture_payload.len() as u32).to_le_bytes());
        picture_stream.extend_from_slice(&picture_payload);
        let png = test_png(640, 120);
        let mut png_payload = vec![0u8; 17];
        png_payload.extend_from_slice(&png);
        png_payload.extend_from_slice(&[0xff, 0xd8, 0x12, 0x34]);
        picture_stream.extend_from_slice(&0x6e00u16.to_le_bytes());
        picture_stream.extend_from_slice(&0xf01eu16.to_le_bytes());
        picture_stream.extend_from_slice(&(png_payload.len() as u32).to_le_bytes());
        picture_stream.extend_from_slice(&png_payload);
        let pictures = parse_ppt_picture_stream(&picture_stream);
        assert_eq!(pictures.len(), 2);
        assert_eq!(pictures[0].as_ref().unwrap().data, jpeg);
        assert_eq!(pictures[1].as_ref().unwrap().extension, "png");
        assert!(
            pictures[1]
                .as_ref()
                .unwrap()
                .data
                .starts_with(b"\x89PNG\r\n\x1a\n")
        );

        let mut fopt = Vec::new();
        fopt.extend_from_slice(&0x0013u16.to_le_bytes());
        fopt.extend_from_slice(&0xf00bu16.to_le_bytes());
        fopt.extend_from_slice(&6u32.to_le_bytes());
        fopt.extend_from_slice(&0x4104u16.to_le_bytes());
        fopt.extend_from_slice(&1u32.to_le_bytes());
        assert_eq!(find_ppt_blip_ids(&fopt), [1]);
        let mut second_fopt = fopt.clone();
        second_fopt[10..14].copy_from_slice(&2u32.to_le_bytes());
        let records = [fopt, second_fopt].concat();
        assert_eq!(find_ppt_blip_ids(&records), [1, 2]);

        let mut anchor = Vec::new();
        anchor.extend_from_slice(&0u16.to_le_bytes());
        anchor.extend_from_slice(&0xf010u16.to_le_bytes());
        anchor.extend_from_slice(&8u32.to_le_bytes());
        for value in [120u16, 240, 7_200, 4_000] {
            anchor.extend_from_slice(&value.to_le_bytes());
        }
        let shape_payload = [records[..14].to_vec(), anchor].concat();
        let mut shape = Vec::new();
        shape.extend_from_slice(&0x000fu16.to_le_bytes());
        shape.extend_from_slice(&0xf004u16.to_le_bytes());
        shape.extend_from_slice(&(shape_payload.len() as u32).to_le_bytes());
        shape.extend_from_slice(&shape_payload);
        let layers = find_ppt_blip_layers(&shape);
        assert_eq!(layers.len(), 1);
        let layer_anchor = layers[0].1.unwrap();
        assert_eq!((layer_anchor.left, layer_anchor.top), (120, 240));
        assert_eq!((layer_anchor.right, layer_anchor.bottom), (7_200, 4_000));
    }

    #[test]
    fn renders_powerpoint_image_layers_on_the_same_slide() {
        let slide = OdfSlide {
            name: "Layered slide".into(),
            paragraphs: Vec::new(),
            legacy_binary: true,
            image: Some(PptSlideImage {
                extension: "jpeg",
                content_type: "image/jpeg",
                data: test_jpeg(1600, 900, 8, 4),
                anchor: None,
            }),
            overlay_images: vec![PptSlideImage {
                extension: "png",
                content_type: "image/png",
                data: test_png(1200, 180),
                anchor: None,
            }],
        };
        let xml = pptx_slide(&slide);
        let relationships = pptx_image_relationships(1, &pptx_image_layers(&slide));
        assert!(xml.contains("rIdImage1") && xml.contains("rIdImage2"));
        assert!(relationships.contains("image1-1.jpeg"));
        assert!(relationships.contains("image1-2.png"));
    }

    #[test]
    fn extracts_flat_odf_document_sheet_and_slides() {
        let document = parse_odf_text(
            r#"<office:document xmlns:office="o" xmlns:text="t"><text:h text:outline-level="2">Heading</text:h><text:list><text:list-item><text:p>Item</text:p></text:list-item></text:list></office:document>"#,
        )
        .unwrap();
        assert_eq!(document[0].heading_level, 2);
        assert_eq!(document[1].list_kind, "bullet");

        let sheets = parse_odf_sheets(
            r#"<office:document xmlns:office="o" xmlns:table="t" xmlns:text="x"><table:table table:name="First"><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>Merged</text:p></table:table-cell><table:covered-table-cell/><table:table-cell office:value-type="string"><text:p>After</text:p></table:table-cell></table:table-row></table:table><table:table table:name="Second"><table:table-row><table:table-cell office:value-type="string"><text:p>Done</text:p></table:table-cell></table:table-row></table:table></office:document>"#,
        )
        .unwrap();
        assert_eq!(sheets.len(), 2);
        assert_eq!(sheets[0].0, "First");
        assert_eq!(sheets[0].1.len(), 3);
        assert!(matches!(&sheets[0].1[0][0], SheetCell::Empty));
        assert!(matches!(&sheets[0].1[0][1], SheetCell::Empty));
        assert!(matches!(&sheets[0].1[0][2], SheetCell::Number(value) if value == "42"));
        assert!(matches!(&sheets[0].1[1][2], SheetCell::Number(value) if value == "42"));
        assert!(matches!(&sheets[0].1[2][0], SheetCell::Text(value) if value == "Merged"));
        assert!(matches!(&sheets[0].1[2][1], SheetCell::Empty));
        assert!(matches!(&sheets[0].1[2][2], SheetCell::Text(value) if value == "After"));
        assert_eq!(sheets[1].0, "Second");
        assert!(matches!(&sheets[1].1[0][0], SheetCell::Text(value) if value == "Done"));

        let slides = parse_odf_slides(
            r#"<office:document xmlns:office="o" xmlns:draw="d" xmlns:text="t"><draw:page draw:name="Slide"><text:p>Title</text:p><text:p>Body</text:p></draw:page></office:document>"#,
        )
        .unwrap();
        assert_eq!(slides[0].paragraphs, ["Title", "Body"]);
    }
}
