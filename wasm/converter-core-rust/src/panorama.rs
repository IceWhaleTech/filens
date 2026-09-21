use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;

const MAX_RANGE_BYTES: u64 = 64 << 20;
const MAX_TRACKS: usize = 32;
const MAX_SAMPLES: usize = 200_000;
const MAX_METADATA_SAMPLES: usize = 120;
const MAX_METADATA_BYTES: u64 = 8 << 20;

#[derive(Debug)]
pub struct InspectError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectOptions {
    logical_size: u64,
    #[serde(default)]
    ranges: Vec<SparseRange>,
    #[serde(default)]
    sidecar_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SparseRange {
    offset: u64,
    path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequiredRange {
    pub offset: u64,
    pub length: u64,
}

pub enum InspectOutcome {
    Complete(Value),
    NeedRanges(Vec<RequiredRange>),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeamOptions {
    width: usize,
    height: usize,
    costs: Vec<u16>,
    #[serde(default)]
    previous: Vec<u32>,
    #[serde(default = "default_temporal_weight")]
    temporal_weight: u32,
    #[serde(default = "default_max_step")]
    max_step: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataOptions {
    vendor: String,
    samples: Vec<MetadataSample>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataSample {
    path: String,
    pts: i64,
    timescale: u32,
}

fn default_temporal_weight() -> u32 { 2 }
fn default_max_step() -> usize { 1 }

pub fn decode_metadata(options: &Value) -> Result<Value, InspectError> {
    let options: MetadataOptions = serde_json::from_value(options.clone()).map_err(|error| InspectError {
        code: "invalid_panorama_metadata",
        message: format!("parse panorama metadata options: {error}"),
    })?;
    if options.vendor != "dji" {
        return Err(invalid("only DJI panorama metadata is currently supported"));
    }
    if options.samples.len() > MAX_METADATA_SAMPLES {
        return Err(InspectError { code: "resource_limit", message: format!("panorama metadata batch exceeds {MAX_METADATA_SAMPLES} samples") });
    }
    let mut total = 0u64;
    let mut decoded = Vec::with_capacity(options.samples.len());
    for sample in options.samples {
        if sample.timescale == 0 { return Err(invalid("panorama metadata timescale must be positive")); }
        let bytes = fs::read(&sample.path).map_err(|error| InspectError {
            code: "range_unavailable",
            message: format!("read panorama metadata sample: {error}"),
        })?;
        total = total.checked_add(bytes.len() as u64).ok_or_else(|| invalid("panorama metadata byte count overflow"))?;
        if total > MAX_METADATA_BYTES {
            return Err(InspectError { code: "resource_limit", message: "panorama metadata batch exceeds 8 MiB".into() });
        }
        let mut value = decode_dji_perframe(&bytes).ok_or_else(|| invalid("invalid DJI per-frame metadata sample"))?;
        value["pts"] = json!(sample.pts);
        value["timescale"] = json!(sample.timescale);
        decoded.push(value);
    }
    Ok(json!({ "samples": decoded }))
}

pub fn compute_seam(options: &Value) -> Result<Value, InspectError> {
    let options: SeamOptions = serde_json::from_value(options.clone()).map_err(|error| InspectError {
        code: "invalid_panorama_seam",
        message: format!("parse panorama seam options: {error}"),
    })?;
    let cells = options.width.checked_mul(options.height).ok_or_else(|| invalid("panorama seam dimensions overflow"))?;
    if options.width == 0 || options.height == 0 || options.width > 512 || options.height > 256 || cells != options.costs.len() {
        return Err(InspectError { code: "resource_limit", message: "panorama seam grid must be at most 512x256 with one cost per cell".into() });
    }
    if !options.previous.is_empty() && options.previous.len() != options.height {
        return Err(invalid("previous panorama seam length does not match height"));
    }
    let max_step = options.max_step.clamp(1, 8);
    let mut previous_row = vec![0u32; options.width];
    let mut current_row = vec![0u32; options.width];
    let mut parents = vec![0i8; cells];
    for x in 0..options.width {
        previous_row[x] = options.costs[x] as u32 + temporal_cost(&options, 0, x);
    }
    for y in 1..options.height {
        for x in 0..options.width {
            let start = x.saturating_sub(max_step);
            let end = (x + max_step).min(options.width - 1);
            let (parent, best) = (start..=end).map(|candidate| (candidate, previous_row[candidate])).min_by_key(|item| item.1).unwrap();
            current_row[x] = best.saturating_add(options.costs[y * options.width + x] as u32).saturating_add(temporal_cost(&options, y, x));
            parents[y * options.width + x] = (parent as isize - x as isize) as i8;
        }
        std::mem::swap(&mut previous_row, &mut current_row);
    }
    let (mut x, cost) = previous_row.iter().copied().enumerate().min_by_key(|item| item.1).unwrap();
    let mut seam = vec![0u32; options.height];
    for y in (0..options.height).rev() {
        seam[y] = x as u32;
        if y > 0 { x = (x as isize + parents[y * options.width + x] as isize) as usize; }
    }
    Ok(json!({ "seam": seam, "cost": cost }))
}

fn temporal_cost(options: &SeamOptions, y: usize, x: usize) -> u32 {
    options.previous.get(y).map_or(0, |previous| previous.abs_diff(x as u32).saturating_mul(options.temporal_weight))
}

struct Segment {
    offset: u64,
    bytes: Vec<u8>,
}

struct SparseFile {
    size: u64,
    segments: Vec<Segment>,
}

#[derive(Default)]
struct Track {
    id: u32,
    handler: String,
    codec: String,
    width: u32,
    height: u32,
    timescale: u32,
    decoder_config: Vec<u8>,
    samples: Vec<Sample>,
}

#[derive(Clone, Default)]
struct Sample {
    offset: u64,
    size: u32,
    pts: i64,
    duration: u32,
    key: bool,
}

#[derive(Default)]
struct SampleTable {
    sizes: Vec<u32>,
    chunk_offsets: Vec<u64>,
    sample_to_chunk: Vec<(u32, u32, u32)>,
    durations: Vec<(u32, u32)>,
    composition_offsets: Vec<(u32, i32)>,
    sync_samples: Vec<u32>,
}

pub fn inspect(source: &str, options: &Value) -> Result<InspectOutcome, InspectError> {
    let options: InspectOptions = serde_json::from_value(options.clone()).map_err(|error| InspectError {
        code: "invalid_panorama_options",
        message: format!("parse panorama inspection options: {error}"),
    })?;
    if options.logical_size == 0 {
        return Err(invalid("logical source size must be greater than zero"));
    }
    let sidecar_path = options.sidecar_path.clone();
    let sparse = SparseFile::load(options)?;
    if source == "insp" {
        return inspect_insp(&sparse);
    }
    if !matches!(source, "osv" | "insv") {
        return Err(InspectError {
            code: "unsupported_panorama_format",
            message: format!("unsupported panorama inspection format: {source}"),
        });
    }
    inspect_iso_bmff(source, &sparse, sidecar_path.as_deref())
}

impl SparseFile {
    fn load(options: InspectOptions) -> Result<Self, InspectError> {
        let mut segments = Vec::new();
        for range in options.ranges {
            let bytes = fs::read(&range.path).map_err(|error| InspectError {
                code: "range_unavailable",
                message: format!("read panorama range {}: {error}", range.path),
            })?;
            if bytes.len() as u64 > MAX_RANGE_BYTES || range.offset.saturating_add(bytes.len() as u64) > options.logical_size {
                return Err(InspectError {
                    code: "resource_limit",
                    message: "panorama range exceeds inspection limits".into(),
                });
            }
            segments.push(Segment { offset: range.offset, bytes });
        }
        segments.sort_by_key(|segment| segment.offset);
        Ok(Self { size: options.logical_size, segments })
    }

    fn read(&self, offset: u64, length: usize) -> Option<Vec<u8>> {
        let end = offset.checked_add(length as u64)?;
        if end > self.size {
            return None;
        }
        for segment in &self.segments {
            let segment_end = segment.offset + segment.bytes.len() as u64;
            if offset >= segment.offset && end <= segment_end {
                let start = (offset - segment.offset) as usize;
                return Some(segment.bytes[start..start + length].to_vec());
            }
        }
        None
    }

    fn need(&self, offset: u64, length: u64) -> RequiredRange {
        RequiredRange { offset, length: length.min(self.size.saturating_sub(offset)).min(MAX_RANGE_BYTES) }
    }
}

fn inspect_insp(file: &SparseFile) -> Result<InspectOutcome, InspectError> {
    let Some(bytes) = file.read(0, file.size.min(1 << 20) as usize) else {
        return Ok(InspectOutcome::NeedRanges(vec![file.need(0, file.size.min(1 << 20))]));
    };
    let (width, height) = jpeg_dimensions(&bytes).ok_or_else(|| InspectError {
        code: "unsupported_projection",
        message: "INSP is not a readable JPEG panorama".into(),
    })?;
    let insta_info = match inspect_insta_info(file)? {
        InstaInfoOutcome::Complete(value) => Some(value),
        InstaInfoOutcome::NeedRange(range) => return Ok(InspectOutcome::NeedRanges(vec![range])),
        InstaInfoOutcome::Unavailable => None,
    };
    let raw_dual_fisheye = insta_info.is_some() && width > 0 && height > 0
        && (width as f64 / height as f64 - 2.0).abs() <= 0.1;
    let calibration = insta_info.as_ref().and_then(|info| {
        let model = info.get("cameraModel").and_then(Value::as_str);
        let crop = json_size(info.get("windowCropInfo"), "dstWidth", "dstHeight")?;
        let image_size = (u32::from(width) / 2, u32::from(height));
        info.get("offsetV3").and_then(Value::as_str).and_then(|offset| {
            (raw_dual_fisheye && insta_embedded_offset_supported(model))
                .then(|| decode_insta_offset_v3(offset, model, image_size, crop)).flatten()
        })
    });
    let (camera_model, firmware, texture_origin, mut lenses) = calibration.as_ref().map(|value| (
        value.get("model").cloned().unwrap_or(Value::Null),
        insta_info.as_ref().and_then(|info| info.get("firmware")).cloned().unwrap_or(Value::Null),
        value.get("textureOrigin").cloned().unwrap_or(Value::Null),
        value.get("lenses").cloned().unwrap_or_else(|| json!([])),
    )).unwrap_or_else(|| (
        insta_info.as_ref().and_then(|info| info.get("cameraModel")).cloned().unwrap_or(Value::Null),
        insta_info.as_ref().and_then(|info| info.get("firmware")).cloned().unwrap_or(Value::Null),
        Value::Null,
        json!([]),
    ));
    if raw_dual_fisheye { bind_image_lens_sources(&mut lenses); }
    let calibrated = lenses.as_array().is_some_and(|items| items.len() >= 2);
    let equirectangular = !raw_dual_fisheye && width > 0 && height > 0
        && (width as f64 / height as f64 - 2.0).abs() <= 0.2;
    Ok(InspectOutcome::Complete(json!({
        "vendor": "insta360",
        "cameraModel": camera_model,
        "firmware": firmware,
        "format": "insp",
        "textureOrigin": texture_origin,
        "projection": if calibrated { "mei-extended" } else if equirectangular { "equirectangular" } else { "unknown" },
        "calibrationSource": if calibrated { "embedded" } else if equirectangular { "not-required" } else { "unavailable" },
        "confidence": if calibrated { "experimental" } else if equirectangular { "high" } else { "low" },
        "width": width,
        "height": height,
        "tracks": [],
        "lenses": lenses,
        "warnings": if calibrated || equirectangular { Vec::<String>::new() } else if raw_dual_fisheye {
            vec!["INSP contains a raw dual-fisheye image, but supported embedded calibration was not found.".into()]
        } else {
            vec!["INSP is not a supported stitched panorama and no lens calibration was found.".into()]
        }
    })))
}

fn bind_image_lens_sources(lenses: &mut Value) {
    let Some(items) = lenses.as_array_mut() else { return; };
    if items.len() != 2 { return; }
    for (lens, (x, width)) in items.iter_mut().zip([(0.0, 0.5), (0.5, 0.5)]) {
        lens["sourceRect"] = json!({ "x": x, "y": 0.0, "width": width, "height": 1.0 });
    }
}

fn inspect_iso_bmff(source: &str, file: &SparseFile, sidecar_path: Option<&str>) -> Result<InspectOutcome, InspectError> {
    let insta_info = if source == "insv" {
        match inspect_insta_info(file)? {
            InstaInfoOutcome::Complete(value) => Some(value),
            InstaInfoOutcome::NeedRange(range) => return Ok(InspectOutcome::NeedRanges(vec![range])),
            InstaInfoOutcome::Unavailable => None,
        }
    } else { None };
    let mut offset = 0u64;
    let mut moov = None;
    let mut required = Vec::new();
    while offset + 8 <= file.size {
        let Some(header) = file.read(offset, 16.min((file.size - offset) as usize)) else {
            required.push(file.need(offset, 16));
            break;
        };
        let Some((size, kind, header_size)) = box_header(&header, file.size - offset) else {
            return Err(invalid("invalid ISO-BMFF top-level box"));
        };
        if kind == b"moov" {
            moov = Some((offset, size, header_size));
            break;
        }
        if size == 0 || offset.saturating_add(size) > file.size {
            return Err(invalid("ISO-BMFF box exceeds logical source size"));
        }
        offset += size;
    }
    if !required.is_empty() {
        return Ok(InspectOutcome::NeedRanges(required));
    }
    let Some((moov_offset, moov_size, header_size)) = moov else {
        return Err(InspectError { code: "unsupported_container", message: "ISO-BMFF moov box was not found".into() });
    };
    if moov_size > MAX_RANGE_BYTES {
        return Err(InspectError { code: "resource_limit", message: "ISO-BMFF moov box exceeds 64 MiB inspection limit".into() });
    }
    let Some(moov_bytes) = file.read(moov_offset + header_size as u64, (moov_size - header_size as u64) as usize) else {
        return Ok(InspectOutcome::NeedRanges(vec![file.need(moov_offset, moov_size)]));
    };
    let mut tracks = parse_tracks(&moov_bytes)?;
    if tracks.len() > MAX_TRACKS {
        return Err(InspectError { code: "resource_limit", message: "panorama container has too many tracks".into() });
    }
    let djmd = tracks.iter().find(|track| track.codec == "djmd").and_then(|track| track.samples.first()).cloned();
    let metadata_track = tracks.iter().find(|track| track.codec == "djmd").map(track_json).unwrap_or(Value::Null);
    let mut dji_sample_bytes = None;
    let insta_sidecar = source != "osv" && sidecar_path.is_some();
    let insta_dimension = insta_info.as_ref().and_then(|info| json_size(info.get("dimension"), "width", "height"));
    let insta_crop = insta_info.as_ref().and_then(|info| json_size(info.get("windowCropInfo"), "dstWidth", "dstHeight"));
    let calibration = if source == "osv" {
        if let Some(sample) = djmd {
            let Some(bytes) = file.read(sample.offset, sample.size as usize) else {
                return Ok(InspectOutcome::NeedRanges(vec![file.need(sample.offset, sample.size as u64)]));
            };
            let calibration = decode_dji_calibration(&bytes);
            dji_sample_bytes = Some(bytes);
            calibration
        } else {
            None
        }
    } else if let Some(path) = sidecar_path {
        match (insta_info.as_ref().and_then(|info| info.get("cameraModel")).and_then(Value::as_str), insta_dimension, insta_crop) {
            (Some("Insta360 X5"), Some(dimension), Some(crop)) => decode_insta_x5_sidecar(path, dimension, crop)?,
            _ => None,
        }
    } else if let Some(info) = insta_info.as_ref() {
        let model = info.get("cameraModel").and_then(Value::as_str);
        if model == Some("Insta360 X5") {
            info.get("extendedCalibration").and_then(Value::as_str)
                .and_then(extended_calibration_values)
                .and_then(|values| decode_insta_x5_values(&values, insta_dimension?, insta_crop?))
        } else {
            info.get("offsetV3").and_then(Value::as_str).and_then(|offset| {
                insta_embedded_offset_supported(model).then(|| decode_insta_offset_v3(offset, model, insta_dimension?, insta_crop?)).flatten()
            })
        }
    } else {
        None
    };
    let imu = dji_sample_bytes.as_deref().and_then(decode_dji_perframe).unwrap_or(Value::Null);
    tracks.retain(|track| track.handler == "vide");
    let video_tracks: Vec<Value> = tracks.iter().map(track_json).collect();
    let (mut camera_model, mut firmware, texture_origin, mut lenses) = calibration.as_ref().map(|value| {
        (
            value.get("model").cloned().unwrap_or(Value::Null),
            value.get("firmware").cloned().unwrap_or(Value::Null),
            value.get("textureOrigin").cloned().unwrap_or(Value::Null),
            value.get("lenses").cloned().unwrap_or_else(|| json!([])),
        )
    }).unwrap_or((Value::Null, Value::Null, Value::Null, json!([])));
    if let Some(info) = &insta_info {
        camera_model = info.get("cameraModel").cloned().filter(|value| !value.is_null()).unwrap_or(camera_model);
        firmware = info.get("firmware").cloned().filter(|value| !value.is_null()).unwrap_or(firmware);
    }
    if source == "osv" && lenses.as_array().is_some_and(|items| !items.is_empty()) && firmware.as_str() != Some("10.00.25.29") {
        return Err(InspectError {
            code: "firmware_unknown",
            message: format!("DJI OSV firmware {} has not been validated for accurate stitching", firmware.as_str().unwrap_or("unknown")),
        });
    }
    bind_lens_sources(&mut lenses, &tracks);
    let lens_count = lenses.as_array().map_or(0, Vec::len);
    let calibrated = lens_count >= 2;
    let partial_calibration = source == "insv" && lens_count == 1;
    let stitched_proxy = !calibrated && source == "insv" && tracks.len() == 1 && tracks[0].width > 0 && tracks[0].height > 0
        && ((tracks[0].width as f64 / tracks[0].height as f64) - 2.0).abs() <= 0.2;
    Ok(InspectOutcome::Complete(json!({
        "vendor": if source == "osv" { "dji" } else { "insta360" },
        "cameraModel": camera_model,
        "firmware": firmware,
        "format": source,
        "textureOrigin": texture_origin,
        "projection": if calibrated && source == "osv" { "dji-fisheye-lut" } else if calibrated { "mei-extended" } else if stitched_proxy { "equirectangular" } else { "unknown" },
        "calibrationSource": if (calibrated || partial_calibration) && (source == "osv" || !insta_sidecar) { "embedded" } else if calibrated || partial_calibration { "sidecar" } else if stitched_proxy { "not-required" } else { "unavailable" },
        "confidence": if calibrated || partial_calibration { "experimental" } else if stitched_proxy { "high" } else { "low" },
        "proxyPreview": stitched_proxy,
        "tracks": video_tracks,
        "metadataTrack": metadata_track,
        "imu": imu,
        "fileGroup": insta_info.as_ref().and_then(|value| value.get("fileGroup")).cloned().unwrap_or(Value::Null),
        "lenses": lenses,
        "warnings": if calibrated { Vec::<String>::new() } else if partial_calibration { vec!["This INSV contains one calibrated lens; open its matching companion file to stitch the panorama.".into()] } else if stitched_proxy { vec!["INSV contains a single 2:1 pre-stitched proxy track; lens seams are already embedded and this is not an accurate raw stitch.".into()] } else if source == "insv" { vec!["INSV calibration was not found; X5 requires its matching .insv.pb sidecar plus dimension and window_crop_info metadata.".into()] } else { vec![format!("{} calibration was not found; accurate stitching is unavailable.", source.to_uppercase())] }
    })))
}

fn bind_lens_sources(lenses: &mut Value, tracks: &[Track]) {
    let Some(items) = lenses.as_array_mut() else { return; };
    if tracks.len() >= items.len() {
        for (lens, track) in items.iter_mut().zip(tracks) {
            lens["sourceTrackId"] = json!(track.id);
        }
        return;
    }
    let Some(track) = tracks.first() else { return; };
    if items.len() == 1 {
        items[0]["sourceTrackId"] = json!(track.id);
        return;
    }
    if items.len() != 2 { return; }
    let dimensions: Option<Vec<(f64, f64)>> = items.iter().map(|lens| {
        Some((lens.get("width")?.as_f64()?, lens.get("height")?.as_f64()?))
    }).collect();
    let Some(dimensions) = dimensions else { return; };
    if dimensions[0] != dimensions[1] { return; }
    let (width, height) = dimensions[0];
    let matches = |actual: u32, expected: f64| expected.is_finite() && expected > 0.0 && (actual as f64 - expected).abs() < 0.5;
    let (rects, scale) = if matches(track.width, width * 2.0) && matches(track.height, height) {
        ([(0.0, 0.0, 0.5, 1.0), (0.5, 0.0, 0.5, 1.0)], None)
    } else if matches(track.width, width) && matches(track.height, height * 2.0) {
        ([(0.0, 0.0, 1.0, 0.5), (0.0, 0.5, 1.0, 0.5)], None)
    } else {
        let scale_x = track.width as f64 / (width * 2.0);
        let scale_y = track.height as f64 / height;
        let proportional = scale_x.is_finite() && scale_y.is_finite()
            && (0.01..=1.0).contains(&scale_x) && (0.01..=1.0).contains(&scale_y)
            && (scale_x - scale_y).abs() <= 0.02 * scale_x.max(scale_y);
        if !proportional { return; }
        ([(0.0, 0.0, 0.5, 1.0), (0.5, 0.0, 0.5, 1.0)], Some((scale_x + scale_y) * 0.5))
    };
    if let Some(scale) = scale {
        for lens in items.iter_mut() {
            scale_lens_calibration(lens, scale);
        }
    }
    for (lens, (x, y, width, height)) in items.iter_mut().zip(rects) {
        lens["sourceTrackId"] = json!(track.id);
        lens["sourceRect"] = json!({ "x": x, "y": y, "width": width, "height": height });
    }
}

fn scale_lens_calibration(lens: &mut Value, scale: f64) {
    for key in ["width", "height", "fx", "fy", "cx", "cy"] {
        if let Some(value) = lens.get(key).and_then(Value::as_f64) {
            lens[key] = json!(value * scale);
        }
    }
}

enum InstaInfoOutcome {
    Complete(Value),
    NeedRange(RequiredRange),
    Unavailable,
}

fn inspect_insta_info(file: &SparseFile) -> Result<InstaInfoOutcome, InspectError> {
    const HEADER_SIZE: usize = 72;
    const SIGNATURE: &[u8; 32] = b"8db42d694ccc418790edff439fe026bf";
    if file.size < HEADER_SIZE as u64 { return Ok(InstaInfoOutcome::Unavailable); }
    let header_offset = file.size - HEADER_SIZE as u64;
    let Some(header) = file.read(header_offset, HEADER_SIZE) else {
        return Ok(InstaInfoOutcome::NeedRange(file.need(header_offset, HEADER_SIZE as u64)));
    };
    if header.get(40..72) != Some(SIGNATURE.as_slice()) { return Ok(InstaInfoOutcome::Unavailable); }
    let metadata_size = le_u32(&header, 32).ok_or_else(|| invalid("invalid INSV metadata size"))? as u64;
    let version = le_u32(&header, 36).ok_or_else(|| invalid("invalid INSV metadata version"))?;
    if version != 3 { return Err(InspectError { code: "firmware_unknown", message: format!("unsupported INSV metadata version {version}") }); }
    if metadata_size < HEADER_SIZE as u64 || metadata_size > MAX_RANGE_BYTES || metadata_size > file.size {
        return Err(InspectError { code: "resource_limit", message: "INSV metadata exceeds inspection limits".into() });
    }
    let metadata_offset = file.size - metadata_size;
    let Some(metadata) = file.read(metadata_offset, metadata_size as usize) else {
        return Ok(InstaInfoOutcome::NeedRange(file.need(metadata_offset, metadata_size)));
    };
    let Some(info) = find_insta_info_frame(&metadata) else { return Ok(InstaInfoOutcome::Unavailable); };
    let fields = protobuf_fields(info).ok_or_else(|| invalid("invalid INSV INFO protobuf"))?;
    let file_group = field_bytes(&fields, 26).and_then(protobuf_fields).map(|group| json!({
        "type": field_varint(&group, 1),
        "index": field_varint(&group, 2),
        "identify": field_string(&group, 3)
    })).unwrap_or(Value::Null);
    let dimension = insta_dimension(&fields, 19).map(|(width, height)| json!({ "width": width, "height": height })).unwrap_or(Value::Null);
    let window_crop = insta_window_crop(&fields, 27).map(|(src_width, src_height, dst_width, dst_height)| json!({
        "srcWidth": src_width, "srcHeight": src_height, "dstWidth": dst_width, "dstHeight": dst_height
    })).unwrap_or(Value::Null);
    Ok(InstaInfoOutcome::Complete(json!({
        "cameraModel": field_string(&fields, 2),
        "firmware": field_string(&fields, 3),
        "serialNumberPresent": field_string(&fields, 1).is_some(),
        "offsetV3": field_string(&fields, 54),
        "extendedCalibration": insta_x5_embedded_calibration(&fields),
        "dimension": dimension,
        "windowCropInfo": window_crop,
        "fileGroup": file_group
    })))
}

fn insta_x5_embedded_calibration(fields: &ProtoFields) -> Option<String> {
    [111, 112].into_iter().find_map(|number| {
        let value = field_string(fields, number)?;
        extended_calibration_values(&value).is_some().then_some(value)
    })
}

fn insta_dimension(fields: &ProtoFields, number: u32) -> Option<(u32, u32)> {
    let value = field_bytes(fields, number).and_then(protobuf_fields)?;
    let size = (u32::try_from(field_varint(&value, 1)?).ok()?, u32::try_from(field_varint(&value, 2)?).ok()?);
    valid_insta_size(size).then_some(size)
}

fn insta_window_crop(fields: &ProtoFields, number: u32) -> Option<(u32, u32, u32, u32)> {
    let value = field_bytes(fields, number).and_then(protobuf_fields)?;
    let crop = (
        u32::try_from(field_varint(&value, 1)?).ok()?,
        u32::try_from(field_varint(&value, 2)?).ok()?,
        u32::try_from(field_varint(&value, 3)?).ok()?,
        u32::try_from(field_varint(&value, 4)?).ok()?,
    );
    (valid_insta_size((crop.0, crop.1)) && valid_insta_size((crop.2, crop.3))).then_some(crop)
}

fn valid_insta_size(size: (u32, u32)) -> bool {
    (1..=32_768).contains(&size.0) && (1..=32_768).contains(&size.1)
}

fn json_size(value: Option<&Value>, width: &str, height: &str) -> Option<(u32, u32)> {
    let value = value?;
    let size = (
        u32::try_from(value.get(width)?.as_u64()?).ok()?,
        u32::try_from(value.get(height)?.as_u64()?).ok()?,
    );
    valid_insta_size(size).then_some(size)
}

fn insta_embedded_offset_supported(model: Option<&str>) -> bool {
    matches!(model, Some("Insta360 OneRS"))
}

fn find_insta_info_frame(metadata: &[u8]) -> Option<&[u8]> {
    if metadata.len() < 78 { return None; }
    let mut cursor = metadata.len() - 72;
    for _ in 0..64 {
        if cursor < 6 { break; }
        let header = &metadata[cursor - 6..cursor];
        let frame_type = header[1];
        let size = le_u32(header, 2)? as usize;
        let start = cursor.checked_sub(size + 6)?;
        if frame_type == 1 { return metadata.get(start..start + size); }
        if frame_type == 0 {
            let index = metadata.get(start..start + size)?;
            for entry in index.chunks_exact(10) {
                if entry[0] != 1 { continue; }
                let frame_size = le_u32(entry, 2)? as usize;
                let offset = le_u32(entry, 6)? as usize;
                return metadata.get(offset..offset + frame_size);
            }
        }
        cursor = start;
    }
    None
}

fn decode_insta_offset_v3(text: &str, model: Option<&str>, image_size: (u32, u32), crop_size: (u32, u32)) -> Option<Value> {
    let values = longest_float_run(text);
    let lens_count = values.first().copied()? as usize;
    const LENS_FIELDS: usize = 19;
    if !(1..=2).contains(&lens_count) || values[0] != lens_count as f64 || values.len() < 2 + lens_count * LENS_FIELDS
        || image_size.0 == 0 || image_size.1 == 0 || crop_size.0 == 0 || crop_size.1 == 0 { return None; }
    let focal_scale = (image_size.0 as f64 / crop_size.0 as f64, image_size.1 as f64 / crop_size.1 as f64);
    if !(0.1..=10.0).contains(&focal_scale.0) || !(0.1..=10.0).contains(&focal_scale.1) { return None; }
    let mut lenses = Vec::new();
    for lens_index in 0..lens_count {
        let start = 1 + lens_index * LENS_FIELDS;
        let xi = values[start];
        let fx = values[start + 1];
        let fy = values[start + 2];
        let width = values[start + 16];
        let height = values[start + 17];
        let lens_width = width / lens_count as f64;
        if !(0.01..4.0).contains(&xi) || !(100.0..10_000.0).contains(&fx) || !(100.0..10_000.0).contains(&fy)
            || !(256.0..40_000.0).contains(&width) || !(256.0..20_000.0).contains(&height)
            || !(256.0..20_000.0).contains(&lens_width) { return None; }
        let fx = fx * focal_scale.0;
        let fy = fy * focal_scale.1;
        let cx = insta_local_principal_x(values[start + 3], lens_width)? * image_size.0 as f64 / lens_width;
        let cy = values[start + 4] * image_size.1 as f64 / height;
        if ![fx, fy, cx, cy].into_iter().all(f64::is_finite)
            || !(0.0..image_size.0 as f64).contains(&cx) || !(0.0..image_size.1 as f64).contains(&cy) { return None; }
        let yaw = values[start + 5].to_radians() + if lens_index == 1 { std::f64::consts::PI } else { 0.0 };
        let pitch = values[start + 6].to_radians();
        lenses.push(json!({
            "width": image_size.0, "height": image_size.1,
            "xi": xi, "fx": fx, "fy": fy, "cx": cx, "cy": cy,
            "radial": [values[start + 11], values[start + 12], values[start + 13], 0.0],
            "tangential": [values[start + 14], values[start + 15]],
            "thinPrism": [0.0, 0.0, 0.0, 0.0],
            "translation": [values[start + 8], values[start + 9], values[start + 10]],
            "extrinsicQuaternion": euler_yx_quaternion(yaw, pitch),
            "projection": { "kind": "mei-extended", "xi": xi }
        }));
    }
    Some(json!({ "model": model, "firmware": null, "textureOrigin": "bottom-left", "lenses": lenses }))
}

fn longest_float_run(text: &str) -> Vec<f64> {
    let mut best = Vec::new();
    let mut current = Vec::new();
    for token in text.split('_') {
        if let Ok(value) = token.parse() {
            current.push(value);
        } else {
            if current.len() > best.len() { best = std::mem::take(&mut current); }
            current.clear();
        }
    }
    if current.len() > best.len() { current } else { best }
}

fn decode_insta_x5_sidecar(path: &str, image_size: (u32, u32), crop_size: (u32, u32)) -> Result<Option<Value>, InspectError> {
    let bytes = fs::read(path).map_err(|error| InspectError { code: "sidecar_missing", message: format!("read Insta360 sidecar: {error}") })?;
    if bytes.len() > 8 << 20 {
        return Err(InspectError { code: "resource_limit", message: "Insta360 sidecar exceeds 8 MiB".into() });
    }
    let Some(values) = find_extended_calibration(&bytes) else { return Ok(None); };
    Ok(decode_insta_x5_values(&values, image_size, crop_size))
}

fn decode_insta_x5_values(values: &[f64], image_size: (u32, u32), crop_size: (u32, u32)) -> Option<Value> {
    if !valid_extended_calibration(values) { return None; }
    let focal_scale = (image_size.0 as f64 / crop_size.0 as f64, image_size.1 as f64 / crop_size.1 as f64);
    if !valid_insta_size(image_size) || !valid_insta_size(crop_size)
        || !(0.1..=10.0).contains(&focal_scale.0) || !(0.1..=10.0).contains(&focal_scale.1) { return None; }
    let mut lenses = Vec::new();
    for lens_index in 0..2 {
        let start = 1 + lens_index * 27;
        let (sensor_width, sensor_height) = insta_x5_sensor_size(values, start)?;
        let cx_sensor = insta_local_principal_x(values[start + 3], sensor_width)?;
        let yaw = values[start + 5].to_radians() + if lens_index == 1 { std::f64::consts::PI } else { 0.0 };
        let pitch = values[start + 6].to_radians();
        let coefficients = &values[start + 11..start + 24];
        lenses.push(json!({
            "width": image_size.0, "height": image_size.1,
            "fx": values[start + 1] * focal_scale.0,
            "fy": values[start + 2] * focal_scale.1,
            "cx": cx_sensor * image_size.0 as f64 / sensor_width,
            "cy": values[start + 4] * image_size.1 as f64 / sensor_height,
            "xi": values[start],
            "distortion": coefficients,
            "radial": [coefficients[0], coefficients[1], coefficients[2], coefficients[3]],
            "tangential": [coefficients[5], coefficients[6]],
            "thinPrism": [coefficients[7], coefficients[8], coefficients[9], coefficients[10]],
            "sensorTilt": [coefficients[11], coefficients[12]],
            "translation": [values[start + 8], values[start + 9], values[start + 10]],
            "extrinsicQuaternion": euler_yx_quaternion(yaw, pitch),
            "projection": { "kind": "mei-extended", "xi": values[start] }
        }));
    }
    Some(json!({ "model": "X5", "firmware": null, "textureOrigin": "top-left", "lenses": lenses }))
}

fn insta_x5_sensor_size(values: &[f64], start: usize) -> Option<(f64, f64)> {
    let width = values.get(start + 24)? / 2.0;
    let height = *values.get(start + 25)?;
    (width.is_finite() && height.is_finite() && (256.0..=20_000.0).contains(&width)
        && (256.0..=20_000.0).contains(&height) && (width / height - 1.0).abs() <= 0.1).then_some((width, height))
}

fn insta_local_principal_x(value: f64, sensor_width: f64) -> Option<f64> {
    if (0.0..sensor_width).contains(&value) { Some(value) }
    else if (sensor_width..=sensor_width * 2.0).contains(&value) { Some(value - sensor_width) }
    else { None }
}

fn find_extended_calibration(bytes: &[u8]) -> Option<Vec<f64>> {
    let mut start = 0usize;
    for index in 0..=bytes.len() {
        let valid = index < bytes.len() && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'+' | b'/' | b'='));
        if valid { continue; }
        if index - start >= 100 {
            let encoded = std::str::from_utf8(&bytes[start..index]).ok()?;
            if let Some(decoded) = crate::decode_base64(encoded) {
                if let Some(values) = extended_calibration_values(&String::from_utf8_lossy(&decoded)) { return Some(values); }
            }
        }
        start = index + 1;
    }
    None
}

fn extended_calibration_values(text: &str) -> Option<Vec<f64>> {
    for (start, _) in text.match_indices("2_") {
        let values: Vec<f64> = text[start..].split('_').map_while(|token| token.parse().ok()).collect();
        if valid_extended_calibration(&values) { return Some(values); }
    }
    None
}

fn valid_extended_calibration(values: &[f64]) -> bool {
    if values.len() < 55 || !values[..55].iter().all(|value| value.is_finite()) { return false; }
    [1usize, 28].into_iter().all(|start| {
        let Some((sensor_width, sensor_height)) = insta_x5_sensor_size(values, start) else { return false; };
        let Some(cx) = insta_local_principal_x(values[start + 3], sensor_width) else { return false; };
        (0.01..4.0).contains(&values[start])
            && (100.0..10_000.0).contains(&values[start + 1])
            && (100.0..10_000.0).contains(&values[start + 2])
            && (0.0..=sensor_width).contains(&cx)
            && (0.0..=sensor_height).contains(&values[start + 4])
    })
}

fn euler_yx_quaternion(yaw: f64, pitch: f64) -> [f64; 4] {
    let (sy, cy) = (yaw * 0.5).sin_cos();
    let (sx, cx) = (pitch * 0.5).sin_cos();
    [cy * cx, cy * sx, sy * cx, -sy * sx]
}

fn parse_tracks(moov: &[u8]) -> Result<Vec<Track>, InspectError> {
    let mut tracks = Vec::new();
    for (kind, body) in child_boxes(moov)? {
        if kind == b"trak" {
            tracks.push(parse_track(body)?);
        }
    }
    Ok(tracks)
}

fn parse_track(trak: &[u8]) -> Result<Track, InspectError> {
    let mut track = Track::default();
    let mut table = SampleTable::default();
    for (kind, body) in descendants(trak)? {
        match kind {
            b"tkhd" => {
                let version = body.first().copied().unwrap_or(0);
                let id_offset = if version == 1 { 20 } else { 12 };
                track.id = be_u32(body, id_offset).unwrap_or(0);
                if body.len() >= 8 {
                    track.width = be_u32(body, body.len() - 8).unwrap_or(0) >> 16;
                    track.height = be_u32(body, body.len() - 4).unwrap_or(0) >> 16;
                }
            }
            b"hdlr" => track.handler = fourcc(body, 8).unwrap_or_default(),
            b"mdhd" => {
                let version = body.first().copied().unwrap_or(0);
                track.timescale = be_u32(body, if version == 1 { 20 } else { 12 }).unwrap_or(0);
            }
            b"stsd" => parse_stsd(body, &mut track),
            b"stsz" => parse_stsz(body, &mut table)?,
            b"stco" => parse_chunk_offsets(body, false, &mut table)?,
            b"co64" => parse_chunk_offsets(body, true, &mut table)?,
            b"stsc" => parse_stsc(body, &mut table)?,
            b"stts" => parse_time_entries(body, false, &mut table)?,
            b"ctts" => parse_time_entries(body, true, &mut table)?,
            b"stss" => parse_stss(body, &mut table)?,
            _ => {}
        }
    }
    track.samples = build_samples(&table)?;
    Ok(track)
}

fn parse_stsd(body: &[u8], track: &mut Track) {
    if body.len() < 16 { return; }
    track.codec = fourcc(body, 12).unwrap_or_default();
    if body.len() >= 44 {
        track.width = be_u16(body, 40).unwrap_or(track.width as u16) as u32;
        track.height = be_u16(body, 42).unwrap_or(track.height as u16) as u32;
    }
    let config_kind = if matches!(track.codec.as_str(), "hvc1" | "hev1") { b"hvcC" } else { b"avcC" };
    if let Some(position) = find_box(body, config_kind) {
        if let Some((size, _, header)) = box_header(&body[position..], (body.len() - position) as u64) {
            let start = position + header;
            let end = position + size as usize;
            if end <= body.len() { track.decoder_config = body[start..end].to_vec(); }
        }
    }
}

fn parse_stsz(body: &[u8], table: &mut SampleTable) -> Result<(), InspectError> {
    let fixed = be_u32(body, 4).ok_or_else(|| invalid("invalid stsz"))?;
    let count = be_u32(body, 8).ok_or_else(|| invalid("invalid stsz count"))? as usize;
    if count > MAX_SAMPLES { return Err(InspectError { code: "resource_limit", message: "video track has too many samples".into() }); }
    if fixed != 0 { table.sizes = vec![fixed; count]; return Ok(()); }
    table.sizes = (0..count).map(|index| be_u32(body, 12 + index * 4).ok_or_else(|| invalid("truncated stsz"))).collect::<Result<_, _>>()?;
    Ok(())
}

fn parse_chunk_offsets(body: &[u8], wide: bool, table: &mut SampleTable) -> Result<(), InspectError> {
    let count = be_u32(body, 4).ok_or_else(|| invalid("invalid chunk offset table"))? as usize;
    let stride = if wide { 8 } else { 4 };
    table.chunk_offsets = (0..count).map(|index| {
        let offset = 8 + index * stride;
        if wide { be_u64(body, offset) } else { be_u32(body, offset).map(u64::from) }.ok_or_else(|| invalid("truncated chunk offsets"))
    }).collect::<Result<_, _>>()?;
    Ok(())
}

fn parse_stsc(body: &[u8], table: &mut SampleTable) -> Result<(), InspectError> {
    let count = be_u32(body, 4).ok_or_else(|| invalid("invalid stsc"))? as usize;
    table.sample_to_chunk = (0..count).map(|index| {
        let base = 8 + index * 12;
        Ok((be_u32(body, base).ok_or_else(|| invalid("truncated stsc"))?, be_u32(body, base + 4).ok_or_else(|| invalid("truncated stsc"))?, be_u32(body, base + 8).ok_or_else(|| invalid("truncated stsc"))?))
    }).collect::<Result<_, InspectError>>()?;
    Ok(())
}

fn parse_time_entries(body: &[u8], composition: bool, table: &mut SampleTable) -> Result<(), InspectError> {
    let count = be_u32(body, 4).ok_or_else(|| invalid("invalid time table"))? as usize;
    let signed = composition && body.first().copied() == Some(1);
    let entries = (0..count).map(|index| {
        let base = 8 + index * 8;
        let samples = be_u32(body, base).ok_or_else(|| invalid("truncated time table"))?;
        let raw = be_u32(body, base + 4).ok_or_else(|| invalid("truncated time table"))?;
        Ok((samples, if signed { raw as i32 } else { raw.min(i32::MAX as u32) as i32 }))
    }).collect::<Result<Vec<_>, InspectError>>()?;
    if composition { table.composition_offsets = entries; } else { table.durations = entries.into_iter().map(|(a, b)| (a, b.max(0) as u32)).collect(); }
    Ok(())
}

fn parse_stss(body: &[u8], table: &mut SampleTable) -> Result<(), InspectError> {
    let count = be_u32(body, 4).ok_or_else(|| invalid("invalid stss"))? as usize;
    table.sync_samples = (0..count).map(|index| be_u32(body, 8 + index * 4).ok_or_else(|| invalid("truncated stss"))).collect::<Result<_, _>>()?;
    Ok(())
}

fn build_samples(table: &SampleTable) -> Result<Vec<Sample>, InspectError> {
    if table.sizes.is_empty() { return Ok(Vec::new()); }
    let mut offsets = Vec::with_capacity(table.sizes.len());
    let mut sample_index = 0usize;
    for (chunk_index, chunk_offset) in table.chunk_offsets.iter().enumerate() {
        let chunk_number = chunk_index as u32 + 1;
        let entry = table.sample_to_chunk.iter().rev().find(|entry| entry.0 <= chunk_number).copied().ok_or_else(|| invalid("missing stsc entry"))?;
        let mut offset = *chunk_offset;
        for _ in 0..entry.1 {
            if sample_index >= table.sizes.len() { break; }
            offsets.push(offset);
            offset += table.sizes[sample_index] as u64;
            sample_index += 1;
        }
    }
    if offsets.len() != table.sizes.len() { return Err(invalid("sample table does not cover all samples")); }
    let durations = expand_u32(&table.durations, table.sizes.len(), 0);
    let compositions = expand_i32(&table.composition_offsets, table.sizes.len(), 0);
    let sync: std::collections::HashSet<u32> = table.sync_samples.iter().copied().collect();
    let all_sync = sync.is_empty();
    let mut dts = 0i64;
    Ok(table.sizes.iter().enumerate().map(|(index, size)| {
        let duration = durations[index];
        let sample = Sample { offset: offsets[index], size: *size, pts: dts + compositions[index] as i64, duration, key: all_sync || sync.contains(&(index as u32 + 1)) };
        dts += duration as i64;
        sample
    }).collect())
}

fn track_json(track: &Track) -> Value {
    json!({
        "id": track.id,
        "codec": track.codec,
        "width": track.width,
        "height": track.height,
        "timescale": track.timescale,
        "decoderConfig": hex(&track.decoder_config),
        "samples": track.samples.iter().map(|sample| json!({
            "offset": sample.offset, "size": sample.size, "pts": sample.pts,
            "duration": sample.duration, "key": sample.key
        })).collect::<Vec<_>>()
    })
}

fn decode_dji_calibration(bytes: &[u8]) -> Option<Value> {
    let top = protobuf_fields(bytes)?;
    let mut model = Value::Null;
    let mut firmware = Value::Null;
    if let Some(header) = field_bytes(&top, 1).and_then(protobuf_fields) {
        if let Some(device) = field_bytes(&header, 1).and_then(protobuf_fields) {
            model = field_string(&device, 10).map(Value::String).unwrap_or(Value::Null);
            firmware = field_string(&device, 6).or_else(|| field_string(&device, 2)).map(Value::String).unwrap_or(Value::Null);
        }
    }
    let calibration_block = field_bytes(&top, 2).and_then(protobuf_fields)?;
    let calibration = field_bytes(&calibration_block, 6).and_then(protobuf_fields)?;
    let mut lenses = Vec::new();
    for values in calibration.values() {
        for value in values {
            let Some(lens) = value.bytes.as_deref().and_then(protobuf_fields) else { continue; };
            if !lens.contains_key(&1) { continue; }
            lenses.push(json!({
                "width": field_f32(&lens, 10), "height": field_f32(&lens, 11),
                "fx": field_f32(&lens, 1), "fy": field_f32(&lens, 2),
                "cx": field_f32(&lens, 3), "cy": field_f32(&lens, 4),
                "distortion": [field_f32(&lens, 5), field_f32(&lens, 6), field_f32(&lens, 7), field_f32(&lens, 8)],
                "yawDeg": field_f32(&lens, 12), "pitchDeg": field_f32(&lens, 13),
                "extrinsicQuaternion": field_f32_array(&lens, 21),
                "radialLut1": field_f32_array(&lens, 22), "radialLut2": field_f32_array(&lens, 23),
                "projection": { "kind": "dji-fisheye-lut", "linearExtensionDeg": 85.0, "validHalfFovDeg": 96.0 }
            }));
            if lenses.len() == 2 { break; }
        }
        if lenses.len() == 2 { break; }
    }
    Some(json!({ "model": model, "firmware": firmware, "textureOrigin": "top-left", "lenses": lenses }))
}

fn decode_dji_perframe(bytes: &[u8]) -> Option<Value> {
    let top = protobuf_fields(bytes)?;
    let inner = field_bytes(&top, 3).and_then(protobuf_fields)?;
    let timestamp = field_bytes(&inner, 1).and_then(protobuf_fields).and_then(|header| field_varint(&header, 2));
    let metadata = field_bytes(&inner, 2).and_then(protobuf_fields);
    let camera_rotation = metadata.as_ref().and_then(|value| field_bytes(value, 9)).and_then(protobuf_fields).map(|value| {
        [field_f32(&value, 1), field_f32(&value, 2), field_f32(&value, 3), field_f32(&value, 4)]
    });
    Some(json!({
        "coordinateSystem": "dji-body-x-right-y-forward-z-up",
        "timestamp": timestamp,
        "cameraRotation": camera_rotation,
        "imuToCameraConfirmed": false,
        "stabilizationDefault": "off"
    }))
}

#[derive(Default)]
struct ProtoValue { bytes: Option<Vec<u8>>, fixed32: Option<u32>, varint: Option<u64> }
type ProtoFields = BTreeMap<u32, Vec<ProtoValue>>;

fn protobuf_fields(bytes: &[u8]) -> Option<ProtoFields> {
    let mut fields = BTreeMap::new();
    let mut offset = 0usize;
    while offset < bytes.len() {
        let (tag, used) = varint(&bytes[offset..])?; offset += used;
        let number = (tag >> 3) as u32; let wire = (tag & 7) as u8;
        if number == 0 { return None; }
        let mut value = ProtoValue::default();
        match wire {
            0 => { let (v, used) = varint(&bytes[offset..])?; offset += used; value.varint = Some(v); }
            1 => { if offset + 8 > bytes.len() { return None; } value.bytes = Some(bytes[offset..offset+8].to_vec()); offset += 8; }
            2 => { let (len, used) = varint(&bytes[offset..])?; offset += used; let len = len as usize; if offset + len > bytes.len() { return None; } value.bytes = Some(bytes[offset..offset+len].to_vec()); offset += len; }
            5 => { value.fixed32 = Some(u32::from_le_bytes(bytes.get(offset..offset+4)?.try_into().ok()?)); offset += 4; }
            _ => return None,
        }
        fields.entry(number).or_insert_with(Vec::new).push(value);
    }
    Some(fields)
}

fn field_bytes(fields: &ProtoFields, number: u32) -> Option<&[u8]> { fields.get(&number)?.first()?.bytes.as_deref() }
fn field_string(fields: &ProtoFields, number: u32) -> Option<String> { String::from_utf8(field_bytes(fields, number)?.to_vec()).ok() }
fn field_f32(fields: &ProtoFields, number: u32) -> Option<f32> { fields.get(&number)?.first()?.fixed32.map(f32::from_bits) }
fn field_varint(fields: &ProtoFields, number: u32) -> Option<u64> { fields.get(&number)?.first()?.varint }
fn field_f32_array(fields: &ProtoFields, number: u32) -> Vec<f32> {
    let Some(bytes) = field_bytes(fields, number) else { return Vec::new(); };
    bytes.chunks_exact(4).map(|part| f32::from_le_bytes(part.try_into().unwrap())).collect()
}

fn descendants(bytes: &[u8]) -> Result<Vec<(&[u8; 4], &[u8])>, InspectError> {
    let mut result = Vec::new();
    for (kind, body) in child_boxes(bytes)? {
        result.push((kind, body));
        if matches!(kind, b"mdia" | b"minf" | b"stbl") { result.extend(descendants(body)?); }
    }
    Ok(result)
}

fn child_boxes(mut bytes: &[u8]) -> Result<Vec<(&[u8; 4], &[u8])>, InspectError> {
    let mut result = Vec::new();
    while bytes.len() >= 8 {
        let (size, kind, header) = box_header(bytes, bytes.len() as u64).ok_or_else(|| invalid("invalid child box"))?;
        if size < header as u64 || size as usize > bytes.len() { return Err(invalid("child box exceeds parent")); }
        let kind: &[u8; 4] = kind.try_into().unwrap();
        result.push((kind, &bytes[header..size as usize]));
        bytes = &bytes[size as usize..];
    }
    Ok(result)
}

fn box_header(bytes: &[u8], remaining: u64) -> Option<(u64, &[u8], usize)> {
    if bytes.len() < 8 { return None; }
    let short = be_u32(bytes, 0)? as u64;
    let kind = bytes.get(4..8)?;
    if short == 1 { Some((be_u64(bytes, 8)?, kind, 16)) } else if short == 0 { Some((remaining, kind, 8)) } else { Some((short, kind, 8)) }
}

fn find_box(bytes: &[u8], kind: &[u8; 4]) -> Option<usize> { bytes.windows(4).position(|window| window == kind).and_then(|pos| pos.checked_sub(4)) }
fn fourcc(bytes: &[u8], offset: usize) -> Option<String> { Some(String::from_utf8_lossy(bytes.get(offset..offset+4)?).into_owned()) }
fn be_u16(bytes: &[u8], offset: usize) -> Option<u16> { Some(u16::from_be_bytes(bytes.get(offset..offset+2)?.try_into().ok()?)) }
fn be_u32(bytes: &[u8], offset: usize) -> Option<u32> { Some(u32::from_be_bytes(bytes.get(offset..offset+4)?.try_into().ok()?)) }
fn be_u64(bytes: &[u8], offset: usize) -> Option<u64> { Some(u64::from_be_bytes(bytes.get(offset..offset+8)?.try_into().ok()?)) }
fn le_u32(bytes: &[u8], offset: usize) -> Option<u32> { Some(u32::from_le_bytes(bytes.get(offset..offset+4)?.try_into().ok()?)) }
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|byte| format!("{byte:02x}")).collect() }
fn invalid(message: &str) -> InspectError { InspectError { code: "invalid_panorama_metadata", message: message.into() } }
fn varint(bytes: &[u8]) -> Option<(u64, usize)> { let mut value=0u64; for (index, byte) in bytes.iter().copied().take(10).enumerate() { value |= ((byte & 0x7f) as u64) << (index*7); if byte & 0x80 == 0 { return Some((value,index+1)); } } None }
fn expand_u32(entries: &[(u32,u32)], count: usize, default: u32) -> Vec<u32> { let mut out=Vec::with_capacity(count); for (n,v) in entries { for _ in 0..*n { if out.len()==count { break; } out.push(*v); } } out.resize(count,default); out }
fn expand_i32(entries: &[(u32,i32)], count: usize, default: i32) -> Vec<i32> { let mut out=Vec::with_capacity(count); for (n,v) in entries { for _ in 0..*n { if out.len()==count { break; } out.push(*v); } } out.resize(count,default); out }

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u16, u16)> {
    if bytes.get(..2)? != [0xff, 0xd8] { return None; }
    let mut offset = 2usize;
    while offset + 4 <= bytes.len() {
        if bytes[offset] != 0xff { offset += 1; continue; }
        let marker = bytes[offset + 1]; offset += 2;
        if marker == 0xd9 || marker == 0xda { break; }
        let length = be_u16(bytes, offset)? as usize;
        if length < 2 || offset + length > bytes.len() { return None; }
        if matches!(marker, 0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf) {
            return Some((be_u16(bytes, offset + 5)?, be_u16(bytes, offset + 3)?));
        }
        offset += length;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_jpeg_dimensions() {
        let jpeg = [0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x04,0x00,0x08,0x00,0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00];
        assert_eq!(jpeg_dimensions(&jpeg), Some((2048,1024)));
    }

    #[test]
    fn rejects_ranges_past_logical_size() {
        let file = SparseFile { size: 10, segments: vec![Segment { offset: 0, bytes: vec![0; 4] }] };
        assert!(file.read(8, 4).is_none());
        assert_eq!(file.need(8, 20), RequiredRange { offset: 8, length: 2 });
    }

    #[test]
    fn binds_packed_dual_fisheye_lenses_to_frame_regions() {
        let track = Track { id: 7, width: 1920, height: 3840, ..Track::default() };
        let mut lenses = json!([
            { "width": 1920.0, "height": 1920.0 },
            { "width": 1920.0, "height": 1920.0 }
        ]);
        bind_lens_sources(&mut lenses, &[track]);

        assert_eq!(lenses[0]["sourceTrackId"], 7);
        assert_eq!(lenses[0]["sourceRect"], json!({ "x": 0.0, "y": 0.0, "width": 1.0, "height": 0.5 }));
        assert_eq!(lenses[1]["sourceRect"], json!({ "x": 0.0, "y": 0.5, "width": 1.0, "height": 0.5 }));

        let track = Track { id: 8, width: 3840, height: 1920, ..Track::default() };
        bind_lens_sources(&mut lenses, &[track]);
        assert_eq!(lenses[0]["sourceRect"], json!({ "x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0 }));
        assert_eq!(lenses[1]["sourceRect"], json!({ "x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0 }));
    }

    #[test]
    fn binds_downscaled_packed_dual_fisheye_lenses_and_scales_intrinsics() {
        let track = Track { id: 11, width: 768, height: 384, ..Track::default() };
        let mut lenses = json!([
            { "width": 3072.0, "height": 3072.0, "fx": 2872.0, "fy": 2872.0, "cx": 1512.0, "cy": 1536.0 },
            { "width": 3072.0, "height": 3072.0, "fx": 2872.0, "fy": 2872.0, "cx": 1512.0, "cy": 1536.0 }
        ]);
        bind_lens_sources(&mut lenses, &[track]);

        assert_eq!(lenses[0]["sourceTrackId"], 11);
        assert_eq!(lenses[0]["sourceRect"], json!({ "x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0 }));
        assert_eq!(lenses[1]["sourceRect"], json!({ "x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0 }));
        assert_eq!(lenses[0]["width"], 384.0);
        assert_eq!(lenses[0]["height"], 384.0);
        assert_eq!(lenses[0]["fx"], 359.0);
        assert_eq!(lenses[0]["cx"], 189.0);
        assert_eq!(lenses[0]["cy"], 192.0);
    }

    #[test]
    fn decodes_basic_protobuf_fields() {
        let fields = protobuf_fields(&[0x0d, 0x00, 0x00, 0x80, 0x3f, 0x12, 0x03, b'a', b'b', b'c']).unwrap();
        assert_eq!(field_f32(&fields, 1), Some(1.0));
        assert_eq!(field_string(&fields, 2).as_deref(), Some("abc"));
    }

    #[test]
    fn decodes_dji_metadata_batch() {
        fn field(number: u8, bytes: Vec<u8>) -> Vec<u8> {
            let mut out = vec![number << 3 | 2, bytes.len() as u8];
            out.extend(bytes);
            out
        }
        fn f32_field(number: u8, value: f32) -> Vec<u8> {
            let mut out = vec![number << 3 | 5];
            out.extend(value.to_le_bytes());
            out
        }
        let header = vec![0x10, 42];
        let rotation = [1.0, 0.0, 0.0, 0.0].into_iter().enumerate().flat_map(|(index, value)| f32_field(index as u8 + 1, value)).collect();
        let metadata = field(9, rotation);
        let inner = [field(1, header), field(2, metadata)].concat();
        let bytes = field(3, inner);
        let path = std::env::temp_dir().join(format!("panorama-djmd-{}.bin", std::process::id()));
        fs::write(&path, bytes).unwrap();
        let result = decode_metadata(&json!({
            "vendor": "dji",
            "samples": [{ "path": path, "pts": 7, "timescale": 30 }]
        })).unwrap();
        let _ = fs::remove_file(path);
        assert_eq!(result["samples"][0]["timestamp"], 42);
        assert_eq!(result["samples"][0]["cameraRotation"], json!([1.0, 0.0, 0.0, 0.0]));
        assert_eq!(result["samples"][0]["pts"], 7);
    }

    #[test]
    fn marks_dji_video_frames_as_top_left_origin() {
        fn field(number: u8, bytes: Vec<u8>) -> Vec<u8> {
            let mut out = vec![number << 3 | 2, bytes.len() as u8];
            out.extend(bytes);
            out
        }
        fn f32_field(number: u8, value: f32) -> Vec<u8> {
            let mut out = vec![number << 3 | 5];
            out.extend(value.to_le_bytes());
            out
        }
        let lens = f32_field(1, 1000.0);
        let lenses = [field(1, lens.clone()), field(1, lens)].concat();
        let bytes = field(2, field(6, lenses));
        let calibration = decode_dji_calibration(&bytes).expect("DJI calibration");
        assert_eq!(calibration["textureOrigin"], "top-left");
        assert_eq!(calibration["lenses"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn parses_x5_extended_sidecar_calibration() {
        let mut calibration = vec![0.0; 55];
        calibration[0] = 2.0;
        for (start, cx) in [(1usize, 2688.0), (28, 8064.0)] {
            calibration[start] = 2.0;
            calibration[start + 1] = 4200.0;
            calibration[start + 2] = 4200.0;
            calibration[start + 3] = cx;
            calibration[start + 4] = 2688.0;
            calibration[start + 24] = 10752.0;
            calibration[start + 25] = 5376.0;
        }
        let calibration = calibration.iter().map(ToString::to_string).collect::<Vec<_>>().join("_");
        let values = extended_calibration_values(&format!("prefix {calibration}_suffix")).expect("extended calibration");
        assert_eq!(values.len(), 55);
        assert_eq!(values[28], 2.0);
        assert_eq!(euler_yx_quaternion(0.0, 0.0), [1.0, 0.0, 0.0, -0.0]);
    }

    #[test]
    fn parses_x5_extended_calibration_embedded_in_info() {
        let mut values = vec![0.0; 55];
        values[0] = 2.0;
        for (start, cx) in [(1usize, 2688.0), (28, 8064.0)] {
            values[start] = 2.0;
            values[start + 1] = 4200.0;
            values[start + 2] = 4200.0;
            values[start + 3] = cx;
            values[start + 4] = 2688.0;
            values[start + 18] = 0.01;
            values[start + 22] = 0.02;
            values[start + 24] = 10752.0;
            values[start + 25] = 5376.0;
        }
        let text = values.iter().map(ToString::to_string).collect::<Vec<_>>().join("_");
        let mut fields = ProtoFields::new();
        fields.insert(111, vec![ProtoValue { bytes: Some(text.as_bytes().to_vec()), ..Default::default() }]);
        let embedded = insta_x5_embedded_calibration(&fields).expect("embedded X5 calibration");
        let values = extended_calibration_values(&embedded).expect("extended values");
        let calibration = decode_insta_x5_values(&values, (2880, 2880), (5312, 5312)).expect("X5 calibration");
        assert_eq!(calibration["textureOrigin"], "top-left");
        assert_eq!(calibration["lenses"].as_array().unwrap().len(), 2);
        assert!((calibration["lenses"][0]["fx"].as_f64().unwrap() - 4200.0 * 2880.0 / 5312.0).abs() < 1e-9);
        assert_eq!(calibration["lenses"][0]["thinPrism"][0], 0.01);
        assert_eq!(calibration["lenses"][0]["sensorTilt"][0], 0.02);
    }

    #[test]
    fn finds_temporally_stable_minimum_cost_seam() {
        let mut costs = vec![40u16; 6 * 4];
        for y in 0..4 { costs[y * 6 + 3] = 1; }
        let result = compute_seam(&json!({
            "width": 6, "height": 4, "costs": costs,
            "previous": [2, 2, 2, 2], "temporalWeight": 1, "maxStep": 1
        })).unwrap();
        assert_eq!(result["seam"], json!([3, 3, 3, 3]));
    }

    #[test]
    fn scales_insta_offset_v3_into_video_coordinates() {
        let mut values = vec![0.0f64; 40];
        values[0] = 2.0;
        for (lens, start) in [1usize, 20].into_iter().enumerate() {
            values[start] = 0.8;
            values[start + 1] = 1200.0;
            values[start + 2] = 1200.0;
            values[start + 3] = 3987.5 + lens as f64 * 8000.0;
            values[start + 4] = 3000.0;
            values[start + 16] = 16000.0;
            values[start + 17] = 6000.0;
            values[start + 18] = 62.0;
        }
        let encoded = values.iter().map(ToString::to_string).collect::<Vec<_>>().join("_");
        let calibration = decode_insta_offset_v3(&encoded, Some("Insta360 X5"), (1920, 1920), (1536, 1536)).expect("offset_v3 calibration");
        assert_eq!(calibration["lenses"].as_array().unwrap().len(), 2);
        assert_eq!(calibration["lenses"][0]["projection"]["kind"], "mei-extended");
        assert_eq!(calibration["lenses"][0]["width"], 1920);
        assert_eq!(calibration["lenses"][0]["fx"], 1500.0);
        assert_eq!(calibration["lenses"][0]["cx"], 957.0);
        assert_eq!(calibration["lenses"][0]["cy"], 960.0);
        assert_eq!(calibration["lenses"][1]["cx"], 957.0);
        assert!((calibration["lenses"][1]["extrinsicQuaternion"][2].as_f64().unwrap() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn parses_single_lens_insta_offset_v3_for_companion_files() {
        assert!(insta_embedded_offset_supported(Some("Insta360 OneRS")));
        assert!(!insta_embedded_offset_supported(Some("Insta360 X5")));
        let mut values = vec![0.0f64; 21];
        values[0] = 1.0;
        values[1] = 0.8;
        values[2] = 1200.0;
        values[3] = 1200.0;
        values[4] = 1900.0;
        values[5] = 1900.0;
        values[6] = 90.0;
        values[8] = 179.0;
        values[17] = 3840.0;
        values[18] = 3840.0;
        values[19] = 62.0;
        let encoded = values.iter().map(ToString::to_string).collect::<Vec<_>>().join("_");
        let calibration = decode_insta_offset_v3(&encoded, Some("Insta360 OneRS"), (1920, 1920), (1920, 1920)).expect("single lens offset_v3 calibration");
        assert_eq!(calibration["textureOrigin"], "bottom-left");
        assert_eq!(calibration["lenses"].as_array().unwrap().len(), 1);
        assert_eq!(calibration["lenses"][0]["cx"], 950.0);
        let quaternion = calibration["lenses"][0]["extrinsicQuaternion"].as_array().unwrap();
        assert!((quaternion[0].as_f64().unwrap() - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-12);
        assert_eq!(quaternion[1], 0.0);
        assert!((quaternion[2].as_f64().unwrap() - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-12);
        assert_eq!(quaternion[3], 0.0);
    }

    #[test]
    fn parses_insta_video_and_crop_dimensions() {
        let dimension = protobuf_fields(&[0x08, 0x80, 0x0f, 0x10, 0x80, 0x0f]).unwrap();
        let crop = protobuf_fields(&[0x08, 0x80, 0x2a, 0x10, 0x80, 0x2a, 0x18, 0x80, 0x0c, 0x20, 0x80, 0x0c]).unwrap();
        let mut fields = ProtoFields::new();
        fields.insert(19, vec![ProtoValue { bytes: Some([0x08, 0x80, 0x0f, 0x10, 0x80, 0x0f].to_vec()), ..Default::default() }]);
        fields.insert(27, vec![ProtoValue { bytes: Some([0x08, 0x80, 0x2a, 0x10, 0x80, 0x2a, 0x18, 0x80, 0x0c, 0x20, 0x80, 0x0c].to_vec()), ..Default::default() }]);
        assert_eq!(field_varint(&dimension, 1), Some(1920));
        assert_eq!(field_varint(&crop, 3), Some(1536));
        assert_eq!(insta_dimension(&fields, 19), Some((1920, 1920)));
        assert_eq!(insta_window_crop(&fields, 27), Some((5376, 5376, 1536, 1536)));
    }

    #[test]
    fn accepts_local_and_combined_x5_principal_points() {
        assert_eq!(insta_local_principal_x(2688.0, 5376.0), Some(2688.0));
        assert_eq!(insta_local_principal_x(8064.0, 5376.0), Some(2688.0));
        assert_eq!(insta_local_principal_x(12_000.0, 5376.0), None);
    }

    #[test]
    fn finds_x5_calibration_after_a_longer_base64_decoy() {
        let invalid = "Ml8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMV8xXzFfMQ==";
        let valid = "Ml8yXzQyMDBfNDIwMF8yNjg4XzI2ODhfMF8wXzkwXzBfMF8wXzBfMF8wXzBfMF8wXzBfMF8wXzBfMF8wXzBfMTA3NTJfNTM3Nl8xMTNfMl80MjAwXzQyMDBfODA2NF8yNjg4XzBfMF85MF8wXzBfMF8wXzBfMF8wXzBfMF8wXzBfMF8wXzBfMF8wXzEwNzUyXzUzNzZfMTEz";
        let sidecar = format!("{}!{invalid}!{valid}", "A".repeat(200));
        let values = find_extended_calibration(sidecar.as_bytes()).expect("extended calibration");
        assert_eq!(values.len(), 55);
        assert_eq!(values[0], 2.0);
        assert_eq!(values[2], 4200.0);
        let path = std::env::temp_dir().join(format!("panorama-x5-sidecar-{}.pb", std::process::id()));
        fs::write(&path, sidecar).unwrap();
        let calibration = decode_insta_x5_sidecar(path.to_str().unwrap(), (3840, 2160), (5000, 4000)).unwrap().unwrap();
        let _ = fs::remove_file(path);
        assert_eq!(calibration["lenses"][0]["width"], 3840.0);
        assert_eq!(calibration["lenses"][0]["height"], 2160.0);
        assert_eq!(calibration["lenses"][0]["cy"], 1080.0);
        assert!((calibration["lenses"][0]["fx"].as_f64().unwrap() - 4200.0 * 3840.0 / 5000.0).abs() < 1e-9);
        assert!((calibration["lenses"][0]["fy"].as_f64().unwrap() - 4200.0 * 2160.0 / 4000.0).abs() < 1e-9);
    }
}
