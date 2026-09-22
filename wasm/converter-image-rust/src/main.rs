use jpeg_encoder::{ColorType, Encoder};
use rawloader::{RawImage, RawImageData};
use serde::Serialize;
use std::env;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use std::process;
use std::time::Instant;

const FIDELITY: &str = "lightweight";
const RAW_PREVIEW_BACKEND: &str = "raw-preview";
const RAW_PREVIEW_WARNING: &str = "Image converter uses the largest embedded JPEG when available and otherwise generates a lightweight sensor preview; full-resolution sensor data, custom picture profiles, and edits are not preserved.";
const ICNS_PREVIEW_BACKEND: &str = "icns-preview";
const ICNS_PREVIEW_WARNING: &str = "Image converter extracted the largest embedded PNG icon; legacy raw icon planes and JPEG 2000 icon chunks are not decoded.";
const MAX_INPUT_BYTES: u64 = 256 << 20;
const RAW_FALLBACK_MAX_DIMENSION: usize = 2048;

#[derive(Default)]
struct Request {
    input: String,
    output: String,
    source: String,
    target: String,
    options: String,
    result: String,
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
    let input_size = fs::metadata(&request.input)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map_or(0, |metadata| metadata.len());

    let result = if let Some(message) = parse_error {
        failure(&request, "io_error", message, input_size, None)
    } else if let Err(error) = validate_input(&request, input_size) {
        failure(&request, error.code, error.message, input_size, None)
    } else {
        let (backend, warning, conversion) = if is_raw_source(&request.source) {
            (
                RAW_PREVIEW_BACKEND,
                RAW_PREVIEW_WARNING,
                convert_raw_preview(&request.input, &request.output, &request.target),
            )
        } else {
            (
                ICNS_PREVIEW_BACKEND,
                ICNS_PREVIEW_WARNING,
                convert_icns_preview(&request.input, &request.output, &request.target),
            )
        };
        match conversion.and_then(|()| validate_output(&request.output, &request.target)) {
            Ok(()) => success(&request, input_size, backend, warning),
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

fn parse_request(request: &mut Request) -> Result<(), String> {
    let mut args = env::args().skip(1);
    while let Some(flag) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for {flag}"))?;
        match flag.as_str() {
            "--input" => request.input = value,
            "--output" => request.output = value,
            "--source" => request.source = normalize_format(&value),
            "--target" => request.target = normalize_format(&value),
            "--options" => request.options = value,
            "--result" => request.result = value,
            _ => return Err(format!("flag provided but not defined: {flag}")),
        }
    }
    for (value, message) in [
        (&request.input, "missing --input"),
        (&request.output, "missing --output"),
        (&request.source, "missing --source"),
        (&request.target, "missing --target"),
        (&request.result, "missing --result"),
    ] {
        if value.is_empty() {
            return Err(message.into());
        }
    }
    Ok(())
}

fn validate_input(request: &Request, input_size: u64) -> Result<(), ConvertError> {
    let metadata =
        fs::metadata(&request.input).map_err(|error| io_error(format!("stat input: {error}")))?;
    if !metadata.is_file() {
        return Err(io_error(format!("input is a directory: {}", request.input)));
    }
    if input_size > MAX_INPUT_BYTES {
        return Err(io_error("image input is too large for conversion".into()));
    }
    let supported = (is_raw_source(&request.source) && request.target == "jpg")
        || (request.source == "icns" && request.target == "png");
    if supported {
        return Ok(());
    }
    if !is_raw_source(&request.source) && request.source != "icns" {
        return Err(ConvertError {
            code: "unsupported_format",
            message: format!("unsupported source format: {}", request.source),
        });
    }
    Err(ConvertError {
        code: "unsupported_format",
        message: format!(
            "unsupported conversion pair: {} -> {}",
            request.source, request.target
        ),
    })
}

fn success(request: &Request, input_size: u64, backend: &str, warning: &str) -> ResultContract {
    ResultContract {
        ok: true,
        source_format: request.source.clone(),
        target_format: request.target.clone(),
        backend: backend.into(),
        fidelity: FIDELITY.into(),
        content_type: content_type(&request.target).into(),
        warnings: vec![warning.into()],
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

fn convert_raw_preview(input: &str, output: &str, target: &str) -> Result<(), ConvertError> {
    if target != "jpg" {
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
    let developed = develop_raw_sensor_preview(&bytes).map_err(|error| {
        parse_error(format!(
            "RAW sensor preview could not be developed: {error}"
        ))
    })?;
    fs::write(output, developed)
        .map_err(|error| io_error(format!("write developed RAW JPEG preview: {error}")))
}

fn develop_raw_sensor_preview(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader = Cursor::new(bytes);
    let raw = rawloader::decode(&mut reader).map_err(|error| error.to_string())?;
    encode_raw_sensor_preview(&raw)
}

fn encode_raw_sensor_preview(raw: &RawImage) -> Result<Vec<u8>, String> {
    let top = raw.crops[0].min(raw.height);
    let right = raw.crops[1].min(raw.width.saturating_sub(1));
    let bottom = raw.crops[2].min(raw.height.saturating_sub(top + 1));
    let left = raw.crops[3].min(raw.width.saturating_sub(right + 1));
    let width = raw.width.saturating_sub(left + right).max(1);
    let height = raw.height.saturating_sub(top + bottom).max(1);
    let scale = width
        .max(height)
        .div_ceil(RAW_FALLBACK_MAX_DIMENSION)
        .max(1);
    let output_width = width.div_ceil(scale).min(usize::from(u16::MAX));
    let output_height = height.div_ceil(scale).min(usize::from(u16::MAX));
    let mut pixels =
        Vec::with_capacity(output_width.saturating_mul(output_height).saturating_mul(3));

    for output_y in 0..output_height {
        let source_y = top + (output_y * scale + scale / 2).min(height - 1);
        for output_x in 0..output_width {
            let source_x = left + (output_x * scale + scale / 2).min(width - 1);
            let rgb = raw_sensor_rgb(raw, source_x, source_y);
            pixels.extend(rgb.map(|value| {
                let value = value.clamp(0.0, 1.0).powf(1.0 / 2.2);
                (value * 255.0 + 0.5) as u8
            }));
        }
    }

    let mut output = Vec::new();
    Encoder::new(&mut output, 85)
        .encode(
            &pixels,
            output_width as u16,
            output_height as u16,
            ColorType::Rgb,
        )
        .map_err(|error| error.to_string())?;
    Ok(output)
}

fn raw_sensor_rgb(raw: &RawImage, x: usize, y: usize) -> [f32; 3] {
    if raw.cpp >= 3 {
        return [0, 1, 2].map(|channel| {
            let index = (y * raw.width + x)
                .saturating_mul(raw.cpp)
                .saturating_add(channel);
            raw_data_value(&raw.data, index)
                .map(|value| normalize_raw_value(raw, channel, value))
                .unwrap_or(0.0)
        });
    }

    if !raw.cfa.is_valid() {
        let value = raw_data_value(&raw.data, y * raw.width + x)
            .map(|value| normalize_raw_value(raw, 1, value))
            .unwrap_or(0.0);
        return [value; 3];
    }

    [0, 1, 2].map(|channel| {
        let mut total = 0.0;
        let mut count = 0u32;
        for dy in -1i32..=1 {
            for dx in -1i32..=1 {
                let sample_x = x as i32 + dx;
                let sample_y = y as i32 + dy;
                if sample_x < 0
                    || sample_y < 0
                    || sample_x >= raw.width as i32
                    || sample_y >= raw.height as i32
                    || raw.cfa.color_at(sample_y as usize, sample_x as usize) != channel
                {
                    continue;
                }
                let index = sample_y as usize * raw.width + sample_x as usize;
                if let Some(value) = raw_data_value(&raw.data, index) {
                    total += normalize_raw_value(raw, channel, value);
                    count += 1;
                }
            }
        }
        if count > 0 { total / count as f32 } else { 0.0 }
    })
}

fn raw_data_value(data: &RawImageData, index: usize) -> Option<f32> {
    match data {
        RawImageData::Integer(values) => values.get(index).map(|value| f32::from(*value)),
        RawImageData::Float(values) => values.get(index).copied(),
    }
}

fn normalize_raw_value(raw: &RawImage, channel: usize, value: f32) -> f32 {
    let channel = channel.min(3);
    let black = f32::from(raw.blacklevels[channel]);
    let white = f32::from(raw.whitelevels[channel]).max(black + 1.0);
    let mut value = ((value - black) / (white - black)).clamp(0.0, 1.0);
    let green = raw.wb_coeffs[1];
    let white_balance = raw.wb_coeffs[channel];
    if green.is_finite() && green > 0.0 && white_balance.is_finite() && white_balance > 0.0 {
        value *= (white_balance / green).clamp(0.25, 4.0);
    }
    value
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
        while bytes.get(cursor) == Some(&0xff) {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        match marker {
            0x00 | 0xd8 | 0xd0..=0xd7 => continue,
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

fn validate_output(path: &str, target: &str) -> Result<(), ConvertError> {
    let bytes = fs::read(path)
        .map_err(|error| conversion_error(format!("read converted image {path}: {error}")))?;
    let valid = match target {
        "jpg" => best_embedded_jpeg(&bytes).is_some_and(|image| image.len() == bytes.len()),
        "png" => png_bounds(&bytes) == Some(bytes.len()),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(conversion_error(format!(
            "{path} is not a complete {} image",
            target.to_uppercase()
        )))
    }
}

fn normalize_format(format: &str) -> String {
    format.trim().trim_start_matches('.').to_ascii_lowercase()
}

fn content_type(format: &str) -> &'static str {
    match format {
        "jpg" => "image/jpeg",
        "png" => "image/png",
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

fn is_zero(value: &u64) -> bool {
    *value == 0
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

    #[test]
    fn selects_largest_embedded_eight_bit_jpeg() {
        let small = test_jpeg(320, 240, 8, 4);
        let large = test_jpeg(1600, 1200, 8, 8);
        let sensor = test_jpeg(6000, 4000, 12, 12);
        let bytes = [b"RAW".as_slice(), &small, &sensor, &large, b"TAIL"].concat();

        assert_eq!(best_embedded_jpeg(&bytes), Some(large.as_slice()));
    }

    #[test]
    fn selects_largest_icns_png() {
        let small = test_png(32, 32);
        let large = test_png(128, 128);
        let bytes = test_icns(&[(b"icp5", &small), (b"ic09", &large)]);

        assert_eq!(best_icns_png(&bytes), Some(large.as_slice()));
    }

    #[test]
    fn develops_sensor_preview_without_embedded_jpeg() {
        let mut raw =
            include_bytes!("../../../apps/demo/public/samples/raw/pentax-k-r.dng").to_vec();
        let mut cursor = 0usize;
        while cursor + 1 < raw.len() {
            let Some(offset) = raw[cursor..]
                .windows(2)
                .position(|pair| pair == [0xff, 0xd8])
            else {
                break;
            };
            let start = cursor + offset;
            if let Some((end, _, _)) = jpeg_bounds(&raw, start) {
                raw[start..end].fill(0);
                cursor = end;
            } else {
                cursor = start + 2;
            }
        }

        assert!(best_embedded_jpeg(&raw).is_none());
        let preview = develop_raw_sensor_preview(&raw).expect("sensor preview should decode");
        assert!(best_embedded_jpeg(&preview).is_some_and(|jpeg| jpeg.len() == preview.len()));
    }
}
