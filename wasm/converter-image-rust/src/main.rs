use jpeg_encoder::{ColorType, Encoder};
use rawloader::{RawImage, RawImageData};
use serde::{Deserialize, Serialize};
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

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewOptions {
    /// Calibrated stitching must retain the complete, unrotated sensor raster.
    #[serde(default)]
    preserve_sensor_geometry: bool,
}

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
                read_preview_options(&request.options).and_then(|options| {
                    convert_raw_preview_with_options(
                        &request.input,
                        &request.output,
                        &request.target,
                        &options,
                    )
                }),
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

fn read_preview_options(path: &str) -> Result<PreviewOptions, ConvertError> {
    if path.is_empty() {
        return Ok(PreviewOptions::default());
    }
    let bytes = fs::read(path).map_err(|error| io_error(format!("read image options: {error}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| parse_error(format!("parse image options: {error}")))
}

fn convert_raw_preview_with_options(
    input: &str,
    output: &str,
    target: &str,
    options: &PreviewOptions,
) -> Result<(), ConvertError> {
    if target != "jpg" {
        return Err(ConvertError {
            code: "unsupported_format",
            message: format!("unsupported RAW target format: {target}"),
        });
    }
    let bytes = fs::read(input).map_err(|error| io_error(format!("read RAW input: {error}")))?;
    let preview = raw_preview_bytes(&bytes, options).map_err(parse_error)?;
    fs::write(output, preview).map_err(|error| io_error(format!("write RAW JPEG preview: {error}")))
}

fn raw_preview_bytes<'a>(
    bytes: &'a [u8],
    options: &PreviewOptions,
) -> Result<std::borrow::Cow<'a, [u8]>, String> {
    if let Some(preview) = best_embedded_jpeg(&bytes).filter(|_| !options.preserve_sensor_geometry)
    {
        return Ok(std::borrow::Cow::Borrowed(preview));
    }
    develop_raw_sensor_preview_with_options(bytes, options)
        .map(std::borrow::Cow::Owned)
        .map_err(|error| format!("RAW sensor preview could not be developed: {error}"))
}

// The browser can call the same conversion core directly without copying a
// large RAW through a virtual filesystem. CLI/wazero keep their WASI entrypoint.
// Allocations are owned by the caller until filens_image_free(ptr, len).
#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn filens_image_alloc(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    Box::into_raw(vec![0u8; length as usize].into_boxed_slice()) as *mut u8 as u32
}

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn filens_image_free(pointer: u32, length: u32) {
    if pointer != 0 && length != 0 {
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                pointer as *mut u8,
                length as usize,
            )));
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn filens_image_preview(pointer: u32, length: u32) -> u64 {
    if pointer == 0 || length == 0 {
        return 0;
    }
    let input = unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) };
    let converted = raw_preview_bytes(input, &PreviewOptions::default());
    let (metadata, image) = match converted {
        Ok(image) => {
            let metadata = serde_json::json!({"ok": true, "targetFormat": "jpg", "contentType": "image/jpeg", "backend": RAW_PREVIEW_BACKEND, "warnings": [RAW_PREVIEW_WARNING]});
            (metadata, image)
        }
        Err(message) => (
            serde_json::json!({"ok": false, "errorCode": "parse_error", "errorMessage": message}),
            std::borrow::Cow::Borrowed(&[] as &[u8]),
        ),
    };
    let json = serde_json::to_vec(&metadata).expect("image result serializes");
    let mut result = Vec::with_capacity(4 + json.len() + image.len());
    result.extend_from_slice(&(json.len() as u32).to_le_bytes());
    result.extend_from_slice(&json);
    result.extend_from_slice(&image);
    let length = result.len() as u32;
    let pointer = Box::into_raw(result.into_boxed_slice()) as *mut u8 as u32;
    (u64::from(length) << 32) | u64::from(pointer)
}

fn develop_raw_sensor_preview_with_options(
    bytes: &[u8],
    options: &PreviewOptions,
) -> Result<Vec<u8>, String> {
    let mut reader = Cursor::new(bytes);
    let raw = rawloader::decode(&mut reader).map_err(|error| error.to_string())?;
    encode_raw_sensor_preview(&raw, options)
}

fn encode_raw_sensor_preview(raw: &RawImage, options: &PreviewOptions) -> Result<Vec<u8>, String> {
    if raw.width == 0
        || raw.height == 0
        || raw
            .width
            .checked_mul(raw.height)
            .is_none_or(|pixels| pixels > 150_000_000)
    {
        return Err("RAW sensor dimensions exceed the preview limit".into());
    }
    let crops = if options.preserve_sensor_geometry {
        [0; 4]
    } else {
        raw.crops
    };
    let top = crops[0].min(raw.height.saturating_sub(1));
    let right = crops[1].min(raw.width.saturating_sub(1));
    let bottom = crops[2].min(raw.height.saturating_sub(top + 1));
    let left = crops[3].min(raw.width.saturating_sub(right + 1));
    let width = raw.width.saturating_sub(left + right).max(1);
    let height = raw.height.saturating_sub(top + bottom).max(1);
    let scale = width
        .max(height)
        .div_ceil(if options.preserve_sensor_geometry {
            4096
        } else {
            RAW_FALLBACK_MAX_DIMENSION
        })
        .max(1);
    let sampled_width = width.div_ceil(scale).min(usize::from(u16::MAX));
    let sampled_height = height.div_ceil(scale).min(usize::from(u16::MAX));
    let (transpose, flip_x, flip_y) = if options.preserve_sensor_geometry {
        (false, false, false)
    } else {
        raw.orientation.to_flips()
    };
    let (output_width, output_height) = if transpose {
        (sampled_height, sampled_width)
    } else {
        (sampled_width, sampled_height)
    };
    let color_matrix = camera_to_srgb(raw)?;
    let brightness = baseline_exposure_brightness(raw.baseline_exposure);
    let normalization = RawNormalization::new(raw);
    let sampler = BayerSampler::new(raw, &normalization);
    let rgb_sampler = IntegerRgbSampler::new(raw, &normalization);
    let srgb = SrgbEncoder::new();
    let mut pixels = vec![0u8; output_width.saturating_mul(output_height).saturating_mul(3)];

    for output_y in 0..output_height {
        let row = &mut pixels[output_y * output_width * 3..(output_y + 1) * output_width * 3];
        for (output_x, pixel) in row.chunks_exact_mut(3).enumerate() {
            let (x, y) = if transpose {
                (output_y, output_x)
            } else {
                (output_x, output_y)
            };
            let x = if flip_x { sampled_width - 1 - x } else { x };
            let y = if flip_y { sampled_height - 1 - y } else { y };
            let source_x = left + (x * scale + scale / 2).min(width - 1);
            let source_y = top + (y * scale + scale / 2).min(height - 1);
            let rgb = rgb_sampler
                .as_ref()
                .map(|sampler| sampler.sample(source_x, source_y))
                .or_else(|| {
                    sampler
                        .as_ref()
                        .and_then(|sampler| sampler.sample(source_x, source_y))
                })
                .unwrap_or_else(|| raw_sensor_rgb(raw, &normalization, source_x, source_y));
            pixel.copy_from_slice(&encode_camera_rgb(rgb, color_matrix, brightness, &srgb));
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

#[cfg(test)]
fn encode_srgb_reference(value: f32) -> u8 {
    let value = value.clamp(0.0, 1.0);
    let value = if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    (value * 255.0 + 0.5) as u8
}

struct SrgbEncoder;

impl SrgbEncoder {
    fn new() -> Self {
        Self
    }

    fn encode(&self, value: f32) -> u8 {
        static TABLE: &[u8; 65536] = include_bytes!(concat!(env!("OUT_DIR"), "/srgb-u16.bin"));
        if value.is_nan() || value <= 0.0 {
            return 0;
        }
        if value >= 1.0 {
            return 255;
        }
        TABLE[(value * 65535.0 + 0.5) as usize]
    }
}

fn baseline_exposure_brightness(ev: f32) -> f32 {
    if !ev.is_finite() || ev == -999.0 {
        1.0
    } else {
        ev.clamp(-4.0, 4.0).exp2()
    }
}

fn encode_camera_rgb(
    rgb: [f32; 3],
    matrix: [[f32; 3]; 3],
    brightness: f32,
    srgb: &SrgbEncoder,
) -> [u8; 3] {
    // Photos / LibRaw highlight=0: clip white-balanced camera channels before
    // conversion, then apply metadata exposure and the fixed sRGB transfer curve.
    let rgb = rgb.map(|value| value.clamp(0.0, 1.0));
    std::array::from_fn(|channel| {
        let row = &matrix[channel];
        srgb.encode((row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]) * brightness)
    })
}

fn camera_to_srgb(raw: &RawImage) -> Result<[[f32; 3]; 3], String> {
    if (0..3).any(|channel| raw.whitelevels[channel] <= raw.blacklevels[channel]) {
        return Err("RAW sensor color calibration has invalid black/white levels".into());
    }
    // Normalize the camera-to-sRGB basis as dcraw/LibRaw do, rather than
    // normalizing the XYZ basis and scaling the rows after inversion.
    let rgb_to_xyz = [
        [0.412453, 0.357580, 0.180423],
        [0.212671, 0.715160, 0.072169],
        [0.019334, 0.119193, 0.950227],
    ];
    let mut rgb_to_cam = [[0.0; 3]; 4];
    for (channel, row) in rgb_to_cam.iter_mut().enumerate().take(3) {
        for (column, value) in row.iter_mut().enumerate() {
            *value = (0..3)
                .map(|k| raw.xyz_to_cam[channel][k] * rgb_to_xyz[k][column])
                .sum();
        }
        let sum: f32 = row.iter().sum();
        if !sum.is_finite() || sum <= 1e-6 {
            return Err("RAW sensor color calibration has an invalid matrix".into());
        }
        for value in row {
            *value /= sum;
        }
    }
    let inverse = RawImage::pseudoinverse(rgb_to_cam);
    let matrix = inverse.map(|row| [row[0], row[1], row[2]]);
    if matrix.iter().flatten().any(|value| !value.is_finite()) {
        return Err("RAW sensor color calibration has a singular matrix".into());
    }
    Ok(matrix)
}

struct RawNormalization {
    black: [f32; 4],
    range: [f32; 4],
    balance: [f32; 4],
}

#[derive(Default)]
struct SensorKernel {
    offsets: [[isize; 9]; 3],
    counts: [usize; 3],
}

// CFA phases and u16 normalization repeat across millions of output samples.
// Resolve them once, retaining the general sampler at borders and for floats,
// non-Bayer arrays and interleaved RGB sensors. Addition order stays identical.
struct BayerSampler<'a> {
    values: &'a [u16],
    width: usize,
    height: usize,
    kernels: [SensorKernel; 4],
    normalized: [Vec<f32>; 3],
}

struct IntegerRgbSampler<'a> {
    values: &'a [u16],
    width: usize,
    cpp: usize,
    normalized: [Vec<f32>; 3],
}

impl<'a> IntegerRgbSampler<'a> {
    fn new(raw: &'a RawImage, normalization: &RawNormalization) -> Option<Self> {
        let RawImageData::Integer(values) = &raw.data else {
            return None;
        };
        if raw.cpp < 3 || values.len() < raw.width.checked_mul(raw.height)?.checked_mul(raw.cpp)? {
            return None;
        }
        Some(Self {
            values,
            width: raw.width,
            cpp: raw.cpp,
            normalized: std::array::from_fn(|channel| {
                (0..=u16::MAX)
                    .map(|value| normalization.sample(channel, f32::from(value)))
                    .collect()
            }),
        })
    }

    fn sample(&self, x: usize, y: usize) -> [f32; 3] {
        let index = (y * self.width + x) * self.cpp;
        std::array::from_fn(|channel| {
            self.normalized[channel][usize::from(self.values[index + channel])]
        })
    }
}

impl<'a> BayerSampler<'a> {
    fn new(raw: &'a RawImage, normalization: &RawNormalization) -> Option<Self> {
        let RawImageData::Integer(values) = &raw.data else {
            return None;
        };
        if raw.cpp != 1
            || raw.cfa.width != 2
            || raw.cfa.height != 2
            || raw.width < 3
            || raw.height < 3
            || values.len() < raw.width.checked_mul(raw.height)?
        {
            return None;
        }
        let kernels = std::array::from_fn(|phase| {
            let mut kernel = SensorKernel::default();
            for dy in -1isize..=1 {
                for dx in -1isize..=1 {
                    let channel = raw.cfa.color_at(
                        (2 + phase / 2).wrapping_add_signed(dy),
                        (2 + phase % 2).wrapping_add_signed(dx),
                    );
                    if channel < 3 {
                        kernel.offsets[channel][kernel.counts[channel]] =
                            dy * raw.width as isize + dx;
                        kernel.counts[channel] += 1;
                    }
                }
            }
            kernel
        });
        Some(Self {
            values,
            width: raw.width,
            height: raw.height,
            kernels,
            normalized: std::array::from_fn(|channel| {
                (0..=u16::MAX)
                    .map(|value| normalization.sample(channel, f32::from(value)))
                    .collect()
            }),
        })
    }

    fn sample(&self, x: usize, y: usize) -> Option<[f32; 3]> {
        if x == 0 || y == 0 || x >= self.width - 1 || y >= self.height - 1 {
            return None;
        }
        let kernel = &self.kernels[(y & 1) * 2 + (x & 1)];
        let center = y * self.width + x;
        Some(std::array::from_fn(|channel| {
            let count = kernel.counts[channel];
            let mut total = 0.0;
            for &offset in &kernel.offsets[channel][..count] {
                let value = self.values[center.wrapping_add_signed(offset)];
                total += self.normalized[channel][usize::from(value)];
            }
            if count == 0 {
                0.0
            } else {
                total / count as f32
            }
        }))
    }
}

impl RawNormalization {
    fn new(raw: &RawImage) -> Self {
        let black = raw.blacklevels.map(f32::from);
        let range = std::array::from_fn(|channel| {
            f32::from(raw.whitelevels[channel]).max(black[channel] + 1.0) - black[channel]
        });
        let coefficients = if raw.wb_coeffs[..3]
            .iter()
            .all(|value| value.is_finite() && *value > 0.0)
        {
            raw.wb_coeffs
        } else {
            raw.neutralwb()
        };
        let balance = coefficients.map(|white_balance| {
            let green = coefficients[1];
            if green.is_finite() && green > 0.0 && white_balance.is_finite() && white_balance > 0.0
            {
                white_balance / green
            } else {
                1.0
            }
        });
        Self {
            black,
            range,
            balance,
        }
    }

    fn sample(&self, channel: usize, value: f32) -> f32 {
        ((value - self.black[channel]) / self.range[channel]).clamp(0.0, 1.0)
            * self.balance[channel]
    }
}

fn raw_sensor_rgb(
    raw: &RawImage,
    normalization: &RawNormalization,
    x: usize,
    y: usize,
) -> [f32; 3] {
    if raw.cpp >= 3 {
        return [0, 1, 2].map(|channel| {
            let index = (y * raw.width + x)
                .saturating_mul(raw.cpp)
                .saturating_add(channel);
            raw_data_value(&raw.data, index)
                .map(|value| normalization.sample(channel, value))
                .unwrap_or(0.0)
        });
    }

    if !raw.cfa.is_valid() {
        let value = raw_data_value(&raw.data, y * raw.width + x)
            .map(|value| normalization.sample(1, value))
            .unwrap_or(0.0);
        return [value; 3];
    }

    // Visit each neighboring sensor sample once. Per-channel accumulation
    // order is unchanged, preserving the previous floating-point result.
    let mut totals = [0.0; 3];
    let mut counts = [0u32; 3];
    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            let sample_x = x as i32 + dx;
            let sample_y = y as i32 + dy;
            if sample_x < 0
                || sample_y < 0
                || sample_x >= raw.width as i32
                || sample_y >= raw.height as i32
            {
                continue;
            }
            let channel = raw.cfa.color_at(sample_y as usize, sample_x as usize);
            if channel >= 3 {
                continue;
            }
            let index = sample_y as usize * raw.width + sample_x as usize;
            if let Some(value) = raw_data_value(&raw.data, index) {
                totals[channel] += normalization.sample(channel, value);
                counts[channel] += 1;
            }
        }
    }
    std::array::from_fn(|channel| {
        if counts[channel] > 0 {
            totals[channel] / counts[channel] as f32
        } else {
            0.0
        }
    })
}

fn raw_data_value(data: &RawImageData, index: usize) -> Option<f32> {
    match data {
        RawImageData::Integer(values) => values.get(index).map(|value| f32::from(*value)),
        RawImageData::Float(values) => values.get(index).copied(),
    }
}

#[cfg(test)]
fn normalize_raw_value(raw: &RawImage, channel: usize, value: f32) -> f32 {
    let channel = channel.min(3);
    let black = f32::from(raw.blacklevels[channel]);
    let white = f32::from(raw.whitelevels[channel]).max(black + 1.0);
    let mut value = ((value - black) / (white - black)).clamp(0.0, 1.0);
    let coefficients = if raw.wb_coeffs[..3]
        .iter()
        .all(|value| value.is_finite() && *value > 0.0)
    {
        raw.wb_coeffs
    } else {
        raw.neutralwb()
    };
    let green = coefficients[1];
    let white_balance = coefficients[channel];
    if green.is_finite() && green > 0.0 && white_balance.is_finite() && white_balance > 0.0 {
        value *= white_balance / green;
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
        let Some(offset) = jpeg_start(&bytes[start..]) else {
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

// Search seven adjacent byte pairs per load. This stays portable to scalar
// WASM runtimes while avoiding a byte-at-a-time search over large RAW files.
fn jpeg_start(bytes: &[u8]) -> Option<usize> {
    let mut offset = 0;
    while offset + 8 <= bytes.len() {
        let block = u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let pairs = !block | ((block >> 8) ^ 0xd8d8_d8d8_d8d8_d8d8);
        let mut matches =
            pairs.wrapping_sub(0x0101_0101_0101_0101) & !pairs & 0x8080_8080_8080_8080;
        while matches != 0 {
            let index = (matches.trailing_zeros() / 8) as usize;
            if bytes[offset + index..offset + index + 2] == [0xff, 0xd8] {
                return Some(offset + index);
            }
            matches &= matches - 1;
        }
        offset += 7;
    }
    bytes[offset..]
        .windows(2)
        .position(|pair| pair == [0xff, 0xd8])
        .map(|index| offset + index)
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
                cursor += memchr::memchr(0xff, &bytes[cursor..])?;
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
        "jpg" => jpeg_bounds(&bytes, 0).is_some_and(|(end, _, _)| end == bytes.len()),
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
        assert_eq!(
            raw_preview_bytes(&bytes, &PreviewOptions::default())
                .unwrap()
                .as_ref(),
            large.as_slice()
        );
    }

    #[test]
    fn jpeg_pair_search_handles_every_alignment_and_truncated_inputs() {
        for length in 0..80 {
            for position in 0..length {
                let mut bytes = vec![0; length];
                bytes[position] = 0xff;
                if position + 1 < length {
                    bytes[position + 1] = 0xd8;
                }
                assert_eq!(
                    jpeg_start(&bytes),
                    bytes.windows(2).position(|pair| pair == [0xff, 0xd8])
                );
            }
        }
        let bytes = (0..65536)
            .flat_map(|word: u32| word.to_le_bytes())
            .collect::<Vec<_>>();
        for offset in 0..8 {
            let tail = &bytes[offset..];
            assert_eq!(
                jpeg_start(tail),
                tail.windows(2).position(|pair| pair == [0xff, 0xd8])
            );
        }
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
        let preview = raw_preview_bytes(&raw, &PreviewOptions::default())
            .expect("sensor preview should decode");
        assert!(best_embedded_jpeg(&preview).is_some_and(|jpeg| jpeg.len() == preview.len()));
    }

    fn synthetic_raw() -> RawImage {
        RawImage {
            baseline_exposure: 0.0,
            make: "Synthetic".into(),
            model: "Synthetic".into(),
            clean_make: "Synthetic".into(),
            clean_model: "Synthetic".into(),
            width: 8,
            height: 4,
            cpp: 1,
            wb_coeffs: [1.0; 4],
            whitelevels: [65535; 4],
            blacklevels: [0; 4],
            xyz_to_cam: [
                [3.2404542, -1.5371385, -0.4985314],
                [-0.969266, 1.8760108, 0.041556],
                [0.0556434, -0.2040259, 1.0572252],
                [0.0; 3],
            ],
            cfa: rawloader::CFA::new("RGGB"),
            crops: [1, 1, 1, 1],
            blackareas: vec![],
            orientation: rawloader::Orientation::Rotate90,
            data: RawImageData::Integer(vec![30000; 32]),
        }
    }

    // Same independent color contract as Photos' nativeGrayDNGFixture: 18%
    // sensor gray, calibrated sRGB primaries, no JPEG and signed exposure EV.
    fn gray_dng(ev: Option<i32>, with_matrix: bool) -> Vec<u8> {
        let short = |value: u16| value.to_le_bytes().to_vec();
        let long = |value: u32| value.to_le_bytes().to_vec();
        let mut entries: Vec<(u16, u16, u32, Vec<u8>)> = vec![
            (254, 4, 1, long(0)),
            (256, 4, 1, long(32)),
            (257, 4, 1, long(32)),
            (258, 3, 1, short(16)),
            (259, 3, 1, short(1)),
            (262, 3, 1, short(32803)),
            (271, 2, 5, b"Test\0".to_vec()),
            (272, 2, 7, b"Camera\0".to_vec()),
            (273, 4, 1, long(0)),
            (277, 3, 1, short(1)),
            (278, 4, 1, long(32)),
            (279, 4, 1, long(32 * 32 * 2)),
            (33421, 3, 2, vec![2, 0, 2, 0]),
            (33422, 1, 4, vec![0, 1, 1, 2]),
            (50706, 1, 4, vec![1, 4, 0, 0]),
            (50714, 4, 1, long(1000)),
            (50717, 4, 1, long(11000)),
            (
                50728,
                5,
                3,
                [1u32.to_le_bytes(), 1u32.to_le_bytes()].concat().repeat(3),
            ),
        ];
        if with_matrix {
            let matrix: Vec<u8> = [
                3.2404542f32,
                -1.5371385,
                -0.4985314,
                -0.969266,
                1.8760108,
                0.041556,
                0.0556434,
                -0.2040259,
                1.0572252,
            ]
            .iter()
            .flat_map(|value| {
                [
                    ((*value * 1_000_000.0).round() as i32).to_le_bytes(),
                    1_000_000i32.to_le_bytes(),
                ]
                .concat()
            })
            .collect();
            entries.push((50721, 10, 9, matrix));
        }
        if let Some(ev) = ev {
            entries.push((
                50730,
                10,
                1,
                [ev.to_le_bytes(), 1i32.to_le_bytes()].concat(),
            ));
        }
        entries.sort_by_key(|entry| entry.0);
        let mut bytes = vec![0; 8 + 2 + entries.len() * 12 + 4];
        bytes[..8].copy_from_slice(&[b'I', b'I', 42, 0, 8, 0, 0, 0]);
        bytes[8..10].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        let mut strip_offset = 0;
        for (index, (tag, kind, count, value)) in entries.into_iter().enumerate() {
            let start = 10 + index * 12;
            bytes[start..start + 2].copy_from_slice(&tag.to_le_bytes());
            bytes[start + 2..start + 4].copy_from_slice(&kind.to_le_bytes());
            bytes[start + 4..start + 8].copy_from_slice(&count.to_le_bytes());
            if value.len() <= 4 {
                bytes[start + 8..start + 8 + value.len()].copy_from_slice(&value);
            } else {
                let offset = bytes.len() as u32;
                bytes[start + 8..start + 12].copy_from_slice(&offset.to_le_bytes());
                bytes.extend(value);
                if bytes.len() % 2 != 0 {
                    bytes.push(0);
                }
            }
            if tag == 273 {
                strip_offset = start + 8;
            }
        }
        let offset = bytes.len() as u32;
        bytes[strip_offset..strip_offset + 4].copy_from_slice(&offset.to_le_bytes());
        bytes.extend(2800u16.to_le_bytes().repeat(32 * 32));
        bytes
    }

    #[test]
    fn sensor_color_matches_photos_gray_and_signed_exposure_contract() {
        let encoder = SrgbEncoder::new();
        for (ev, expected) in [
            (None, 118u8),
            (Some(0), 118),
            (Some(-1), 85),
            (Some(1), 162),
        ] {
            let raw = rawloader::decode(&mut Cursor::new(gray_dng(ev, true))).unwrap();
            assert_eq!(raw.baseline_exposure, ev.unwrap_or(0) as f32);
            let normalization = RawNormalization::new(&raw);
            let rgb = raw_sensor_rgb(&raw, &normalization, 10, 10);
            let color = encode_camera_rgb(
                rgb,
                camera_to_srgb(&raw).unwrap(),
                baseline_exposure_brightness(raw.baseline_exposure),
                &encoder,
            );
            assert!(
                color.iter().all(|value| value.abs_diff(expected) <= 1),
                "EV {ev:?}: {color:?}"
            );
            assert!(encode_raw_sensor_preview(&raw, &PreviewOptions::default()).is_ok());
        }
        for ev in [f32::NAN, f32::INFINITY, -999.0] {
            assert_eq!(baseline_exposure_brightness(ev), 1.0);
        }
        assert_eq!(baseline_exposure_brightness(100.0), 16.0);
        assert_eq!(baseline_exposure_brightness(-100.0), 1.0 / 16.0);
        assert!(rawloader::decode(&mut Cursor::new(gray_dng(None, false))).is_err());
    }

    #[test]
    fn camera_matrix_preserves_known_colors_and_neutral_clipped_highlights() {
        let mut raw = synthetic_raw();
        let identity = raw.xyz_to_cam;
        let basis = [[0.8, 0.15, 0.05], [0.1, 0.8, 0.1], [0.05, 0.15, 0.8]];
        for (channel, row) in basis.iter().enumerate() {
            for column in 0..3 {
                raw.xyz_to_cam[channel][column] =
                    (0..3).map(|i| row[i] * identity[i][column]).sum();
            }
        }
        let matrix = camera_to_srgb(&raw).unwrap();
        let color = [0.2, 0.4, 0.6];
        let sensor = basis.map(|row| row.iter().zip(color).map(|(a, b)| a * b).sum());
        let srgb = SrgbEncoder::new();
        let actual = encode_camera_rgb(sensor, matrix, 1.0, &srgb);
        let expected = color.map(|value| srgb.encode(value));
        assert!(
            actual.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1),
            "{actual:?} {expected:?}"
        );
        assert_eq!(
            encode_camera_rgb([2.0, 1.0, 1.5], matrix, 1.0, &srgb),
            [255; 3]
        );
        raw.xyz_to_cam = [[0.0; 3]; 4];
        assert!(camera_to_srgb(&raw).is_err());
        raw.xyz_to_cam = identity;
        raw.whitelevels[0] = raw.blacklevels[0];
        assert!(camera_to_srgb(&raw).is_err());
    }

    #[test]
    fn integer_rgb_lookup_matches_general_normalization() {
        let mut raw = synthetic_raw();
        for cpp in [3, 4] {
            raw.cpp = cpp;
            raw.data = RawImageData::Integer(
                (0..raw.width * raw.height * cpp)
                    .map(|index| (index * 1979) as u16)
                    .collect(),
            );
            raw.wb_coeffs = [2.2, 1.0, 1.6, 1.0];
            let normalization = RawNormalization::new(&raw);
            let sampler = IntegerRgbSampler::new(&raw, &normalization).unwrap();
            for y in 0..raw.height {
                for x in 0..raw.width {
                    assert_eq!(
                        sampler.sample(x, y).map(f32::to_bits),
                        raw_sensor_rgb(&raw, &normalization, x, y).map(f32::to_bits)
                    );
                }
            }
        }
        raw.data = RawImageData::Integer(vec![0]);
        assert!(IntegerRgbSampler::new(&raw, &RawNormalization::new(&raw)).is_none());
    }

    #[test]
    fn sensor_sampling_matches_the_previous_three_pass_results_bit_for_bit() {
        for pattern in ["RGGB", "BGGR", "GRBG", "GBRG"] {
            let mut raw = synthetic_raw();
            raw.cfa = rawloader::CFA::new(pattern);
            raw.blacklevels = [17, 29, 43, 0];
            raw.whitelevels = [40000, 35000, 32000, 0];
            for floating in [false, true] {
                raw.data = if floating {
                    RawImageData::Float(
                        (0..32).map(|index| index as f32 * 1411.7 - 800.0).collect(),
                    )
                } else {
                    RawImageData::Integer((0..32).map(|index| (index * 1979) as u16).collect())
                };
                for balance in [[2.2, 1.0, 1.6, 1.0], [f32::NAN, -1.0, f32::INFINITY, 0.0]] {
                    raw.wb_coeffs = balance;
                    let normalization = RawNormalization::new(&raw);
                    let sampler = BayerSampler::new(&raw, &normalization);
                    for y in 0..raw.height {
                        for x in 0..raw.width {
                            let reference = [0, 1, 2].map(|channel| {
                                let mut total = 0.0;
                                let mut count = 0u32;
                                for dy in -1i32..=1 {
                                    for dx in -1i32..=1 {
                                        let sx = x as i32 + dx;
                                        let sy = y as i32 + dy;
                                        if sx < 0
                                            || sy < 0
                                            || sx >= raw.width as i32
                                            || sy >= raw.height as i32
                                            || raw.cfa.color_at(sy as usize, sx as usize) != channel
                                        {
                                            continue;
                                        }
                                        if let Some(value) = raw_data_value(
                                            &raw.data,
                                            sy as usize * raw.width + sx as usize,
                                        ) {
                                            total += normalize_raw_value(&raw, channel, value);
                                            count += 1;
                                        }
                                    }
                                }
                                if count > 0 { total / count as f32 } else { 0.0 }
                            });
                            assert_eq!(
                                raw_sensor_rgb(&raw, &normalization, x, y).map(f32::to_bits),
                                reference.map(f32::to_bits)
                            );
                            if let Some(fast) =
                                sampler.as_ref().and_then(|sampler| sampler.sample(x, y))
                            {
                                assert_eq!(fast.map(f32::to_bits), reference.map(f32::to_bits));
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn nikon_d3s_without_embedded_jpeg_decodes_the_sensor() {
        let bytes = include_bytes!("../../../apps/demo/public/samples/raw/nikon-iss.nef");
        let mut without_jpeg = bytes.to_vec();
        let mut cursor = 0;
        while let Some(offset) = jpeg_start(&without_jpeg[cursor..]) {
            let start = cursor + offset;
            if let Some((end, _, _)) = jpeg_bounds(&without_jpeg, start) {
                without_jpeg[start..end].fill(0);
                cursor = end;
            } else {
                cursor = start + 2;
            }
        }
        assert!(best_embedded_jpeg(&without_jpeg).is_none());
        let mut original = Cursor::new(bytes);
        let expected = rawloader::decode(&mut original).expect("original Nikon sensor");
        let actual =
            rawloader::decode(&mut Cursor::new(&without_jpeg)).expect("Nikon sensor without JPEG");
        assert_eq!(
            (actual.width, actual.height),
            (expected.width, expected.height)
        );
        match (&actual.data, &expected.data) {
            (RawImageData::Integer(actual), RawImageData::Integer(expected)) => {
                assert_eq!(actual, expected)
            }
            _ => panic!("expected integer sensor data"),
        }
        let preview = raw_preview_bytes(&without_jpeg, &PreviewOptions::default())
            .expect("Nikon JPEG preview");
        let (_, width, height) = jpeg_bounds(&preview, 0).unwrap();
        assert!(width > 1000 && height > 500);
    }

    #[test]
    fn srgb_lookup_stays_within_one_byte_for_shadows_extremes_and_random_samples() {
        let encoder = SrgbEncoder::new();
        for index in 0..=65535 {
            let value = index as f32 / 65535.0;
            assert!(encoder.encode(value).abs_diff(encode_srgb_reference(value)) <= 1);
            for delta in [-0.5f32, 0.5] {
                let between = (index as f32 + delta) / 65535.0;
                assert!(
                    encoder
                        .encode(between)
                        .abs_diff(encode_srgb_reference(between))
                        <= 1
                );
            }
        }
        for value in [
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
            -0.0,
            0.0,
            -1.0,
            1.0,
            2.0,
        ] {
            assert_eq!(encoder.encode(value), encode_srgb_reference(value));
        }
        let mut seed = 12345u32;
        for _ in 0..1_000_000 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let value = seed as f32 / u32::MAX as f32;
            assert!(
                encoder.encode(value).abs_diff(encode_srgb_reference(value)) <= 1,
                "sample {value}"
            );
        }
    }

    #[test]
    fn calibrated_preview_keeps_full_sensor_and_normal_preview_applies_crop_and_orientation() {
        let raw = synthetic_raw();
        let ordinary = encode_raw_sensor_preview(&raw, &PreviewOptions::default()).unwrap();
        let sensor = encode_raw_sensor_preview(
            &raw,
            &PreviewOptions {
                preserve_sensor_geometry: true,
            },
        )
        .unwrap();
        let (_, width, height) = jpeg_bounds(&ordinary, 0).unwrap();
        assert_eq!((width, height), (2, 6));
        let (_, width, height) = jpeg_bounds(&sensor, 0).unwrap();
        assert_eq!((width, height), (8, 4));
    }
}
