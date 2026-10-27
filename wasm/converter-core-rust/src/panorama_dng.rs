//! Bounded, sparse TIFF metadata inspection. RAW pixels are decoded by converter-image.
use super::{InspectError, InspectOutcome, RequiredRange, SparseFile, invalid};
use serde_json::{Value, json};
use std::borrow::Cow;

enum ReadError {
    Range(RequiredRange),
    Invalid(InspectError),
}
type ReadResult<T> = Result<T, ReadError>;

struct Tiff<'a> {
    file: &'a SparseFile,
    little: bool,
}

impl Tiff<'_> {
    fn read(&self, offset: u64, length: usize) -> ReadResult<Cow<'_, [u8]>> {
        if length > 1 << 20
            || offset
                .checked_add(length as u64)
                .is_none_or(|end| end > self.file.size)
        {
            return Err(ReadError::Invalid(invalid(
                "DNG metadata is outside the file or exceeds 1 MiB",
            )));
        }
        self.file
            .read(offset, length)
            .ok_or_else(|| ReadError::Range(self.file.need(offset, length as u64)))
    }
    fn u16(&self, b: &[u8]) -> u16 {
        let b = [b[0], b[1]];
        if self.little {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        }
    }
    fn u32(&self, b: &[u8]) -> u32 {
        let b = [b[0], b[1], b[2], b[3]];
        if self.little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        }
    }
    fn values<'a>(&'a self, entry: &'a [u8]) -> ReadResult<Cow<'a, [u8]>> {
        let unit = match self.u16(&entry[2..]) {
            1 | 2 | 7 => 1,
            3 => 2,
            4 | 13 => 4,
            _ => return Ok(Cow::Borrowed(&[])),
        };
        let length = (self.u32(&entry[4..]) as usize)
            .checked_mul(unit)
            .ok_or_else(|| ReadError::Invalid(invalid("DNG tag length overflow")))?;
        if length <= 4 {
            Ok(Cow::Borrowed(&entry[8..8 + length]))
        } else {
            self.read(self.u32(&entry[8..]) as u64, length)
        }
    }
    fn integers<'a>(&'a self, entry: &[u8], bytes: &'a [u8]) -> impl Iterator<Item = u32> + 'a {
        let kind = self.u16(&entry[2..]);
        let bytes = if matches!(kind, 3 | 4 | 13) {
            bytes
        } else {
            &[]
        };
        bytes
            .chunks_exact(if kind == 3 { 2 } else { 4 })
            .map(move |b| {
                if kind == 3 {
                    u32::from(self.u16(b))
                } else {
                    self.u32(b)
                }
            })
    }
}

pub(super) fn inspect(file: &SparseFile) -> Result<InspectOutcome, InspectError> {
    match read_metadata(file) {
        Ok(metadata) => Ok(InspectOutcome::Complete(manifest(metadata))),
        Err(ReadError::Range(range)) => Ok(InspectOutcome::NeedRanges(vec![range])),
        Err(ReadError::Invalid(error)) => Err(error),
    }
}

#[derive(Default)]
struct Metadata {
    model: String,
    comment: String,
    width: u32,
    height: u32,
    raw: bool,
}

fn read_metadata(file: &SparseFile) -> ReadResult<Metadata> {
    let header = file.read(0, 8).ok_or_else(|| {
        if file.size < 8 {
            ReadError::Invalid(invalid("DNG TIFF header is truncated"))
        } else {
            ReadError::Range(file.need(0, 8))
        }
    })?;
    let little = match &header[..2] {
        b"II" => true,
        b"MM" => false,
        _ => {
            return Err(ReadError::Invalid(invalid(
                "DNG does not contain a TIFF header",
            )));
        }
    };
    let tiff = Tiff { file, little };
    if tiff.u16(&header[2..]) != 42 {
        return Err(ReadError::Invalid(invalid(
            "Only classic TIFF DNG metadata is supported",
        )));
    }
    let mut pending = vec![tiff.u32(&header[4..])];
    let mut visited = [0; 32];
    let mut visited_count = 0;
    let mut metadata = Metadata::default();
    while let Some(offset) = pending.pop() {
        if offset == 0 || visited[..visited_count].contains(&offset) {
            continue;
        }
        if visited_count == visited.len() {
            return Err(ReadError::Invalid(invalid(
                "DNG contains too many TIFF directories",
            )));
        }
        visited[visited_count] = offset;
        visited_count += 1;
        let count_bytes = tiff.read(u64::from(offset), 2)?;
        let count = usize::from(tiff.u16(&count_bytes));
        if count > 1024 {
            return Err(ReadError::Invalid(invalid(
                "DNG TIFF directory exceeds 1024 entries",
            )));
        }
        let table = tiff.read(u64::from(offset) + 2, count * 12 + 4)?;
        let (mut width, mut height, mut photometric) = (0, 0, 0);
        for entry in table[..count * 12].chunks_exact(12) {
            let tag = tiff.u16(entry);
            if !matches!(tag, 256 | 257 | 262 | 272 | 330 | 34665 | 37510) {
                continue;
            }
            let bytes = tiff.values(entry)?;
            if matches!(tag, 272 | 37510) {
                let text = comment_text(&bytes);
                if tag == 272 && !text.is_empty() {
                    metadata.model = text;
                } else if tag == 37510 && !text.is_empty() {
                    metadata.comment = text;
                }
            } else {
                let mut values = tiff.integers(entry, &bytes);
                if matches!(tag, 330 | 34665) {
                    pending.extend(values);
                } else if let Some(value) = values.next() {
                    match tag {
                        256 => width = value,
                        257 => height = value,
                        262 => photometric = value,
                        _ => unreachable!(),
                    }
                }
            }
        }
        let raw = matches!(photometric, 32803 | 34892);
        if width > 0
            && height > 0
            && ((raw && !metadata.raw)
                || (raw == metadata.raw
                    && u64::from(width) * u64::from(height)
                        > u64::from(metadata.width) * u64::from(metadata.height)))
        {
            metadata.width = width;
            metadata.height = height;
            metadata.raw = raw;
        }
        pending.push(tiff.u32(&table[count * 12..]));
    }
    Ok(metadata)
}

fn comment_text(bytes: &[u8]) -> String {
    let bytes = if bytes.starts_with(b"ASCII\0\0\0") {
        &bytes[8..]
    } else {
        bytes
    };
    String::from_utf8_lossy(bytes)
        .trim_matches(char::from(0))
        .trim()
        .to_string()
}

fn manifest(metadata: Metadata) -> Value {
    let insta = metadata.model.to_ascii_lowercase().contains("insta360");
    let calibration = if insta && metadata.model.eq_ignore_ascii_case("Insta360 X5") {
        x5_lenses(&metadata.comment, metadata.width, metadata.height)
    } else if insta && metadata.model.to_ascii_lowercase().contains("oners") {
        one_rs_lenses(&metadata.comment, metadata.width, metadata.height)
    } else {
        None
    };
    let (projection, lenses) = calibration.unwrap_or(("unknown", Vec::new()));
    let calibrated = lenses.len() == 2;
    json!({
        "format": "dng", "vendor": if insta { "insta360" } else { "unknown" },
        "cameraModel": metadata.model, "width": metadata.width, "height": metadata.height,
        "textureOrigin": "top-left", "projection": projection,
        "calibrationSource": if calibrated { "embedded" } else { "unavailable" },
        "confidence": if calibrated { "experimental" } else { "low" },
        "tracks": [], "lenses": lenses,
        "warnings": if insta && !calibrated { vec!["DNG lens calibration is missing or unsupported; showing a flat RAW preview."] } else { vec![] },
    })
}

fn x5_lenses(text: &str, width: u32, height: u32) -> Option<(&'static str, Vec<Value>)> {
    let text = text.strip_prefix("INSTA360").unwrap_or(text).trim();
    let values = text
        .split('_')
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if !matches!(values.len(), 39 | 40)
        || values[0] != 2.0
        || !values.iter().all(|v| v.is_finite())
        || height <= 256
        || width != height.checked_mul(2)?
    {
        return None;
    }
    let mut lenses = Vec::new();
    for index in 0..2 {
        let v = &values[1 + index * 19..20 + index * 19];
        let crop_width = v[16] / 2.0;
        let crop_height = v[17];
        let cx = super::insta_local_principal_x(v[3], crop_width)?;
        if crop_width <= 256.0
            || !(0.0..crop_width).contains(&cx)
            || crop_width != crop_height
            || crop_height > f64::from(height)
            || !(0.01..4.0).contains(&v[0])
            || !(100.0..10_000.0).contains(&v[1])
            || !(100.0..10_000.0).contains(&v[2])
            || !(0.0..crop_height).contains(&v[4])
        {
            return None;
        }
        let pad = (f64::from(height) - crop_height) / 2.0;
        lenses.push(json!({
            "width": height, "height": height, "fx": v[1], "fy": v[2], "cx": cx + pad, "cy": v[4] + pad,
            "xi": v[0], "radial": [v[11], v[12], v[13], 0.0], "tangential": [v[14], v[15]],
            "translation": [v[8], v[9], v[10]],
            "extrinsicQuaternion": super::insta_x5_rotation_quaternion(v[5], v[6], v[7], index),
            "sourceRect": {"x": index as f64 / 2.0, "y": 0, "width": 0.5, "height": 1},
            "projection": {"kind": "mei-extended", "xi": v[0]},
        }));
    }
    Some(("mei-extended", lenses))
}

fn one_rs_lenses(text: &str, width: u32, height: u32) -> Option<(&'static str, Vec<Value>)> {
    let text = text.strip_prefix("INSTA360")?.split_whitespace().next()?;
    let v = text
        .split('_')
        .map(str::parse::<f64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if v.len() != 16
        || v[0] != 2.0
        || !v.iter().all(|v| v.is_finite())
        || width.min(height) <= 256
        || (width != height.checked_mul(2)? && height != width.checked_mul(2)?)
        || v[13] != f64::from(width)
        || v[14] != f64::from(height)
    {
        return None;
    }
    let vertical = height > width;
    let size = f64::from(width.min(height));
    let focal = size / 196.0_f64.to_radians();
    let mut lenses = Vec::new();
    for index in 0..2 {
        let lens = &v[1 + index * 6..7 + index * 6];
        let cx = lens[1] - if vertical { 0.0 } else { index as f64 * size };
        let cy = lens[2] - if vertical { index as f64 * size } else { 0.0 };
        if !(0.0..size).contains(&cx) || !(0.0..size).contains(&cy) {
            return None;
        }
        // Retain Photos' simplified vendor Euler interpretation and -Z camera basis.
        let [yaw, pitch, roll] = [lens[5], lens[3], lens[4]].map(|v| v.to_radians() / 2.0);
        let (sy, cyaw) = yaw.sin_cos();
        let (sp, cp) = pitch.sin_cos();
        let (sr, cr) = roll.sin_cos();
        let q = [
            cyaw * cp * cr + sy * sp * sr,
            cyaw * cp * sr - sy * sp * cr,
            sy * cp * sr + cyaw * sp * cr,
            sy * cp * cr - cyaw * sp * sr,
        ];
        lenses.push(json!({
            "width": size, "height": size, "fx": focal, "fy": focal, "cx": cx, "cy": cy,
            "extrinsicQuaternion": q, "projection": { "kind": "equidistant" },
            "sourceRect": { "x": if vertical {0.0} else {index as f64 / 2.0}, "y": if vertical {index as f64 / 2.0} else {0.0}, "width": if vertical {1.0} else {0.5}, "height": if vertical {0.5} else {1.0} },
        }));
    }
    Some(("equidistant", lenses))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiff_fixture(little: bool) -> Vec<u8> {
        fn short(bytes: &mut [u8], offset: usize, v: u16, little: bool) {
            bytes[offset..offset + 2].copy_from_slice(&if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            });
        }
        fn long(bytes: &mut [u8], offset: usize, v: u32, little: bool) {
            bytes[offset..offset + 4].copy_from_slice(&if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            });
        }
        let fixture: Value =
            serde_json::from_str(include_str!("testdata/insta360_x5_dng_calibration.json"))
                .unwrap();
        let comment = format!(
            "ASCII\0\0\0{}\0",
            fixture["vendor"]["parameters"].as_str().unwrap()
        );
        let model = b"Insta360 X5\0";
        let mut bytes = vec![0; 8192];
        bytes[..2].copy_from_slice(if little { b"II" } else { b"MM" });
        short(&mut bytes, 2, 42, little);
        long(&mut bytes, 4, 8, little);
        let directories = [
            (
                8,
                vec![
                    (256, 4, 1, 320),
                    (257, 4, 1, 160),
                    (262, 3, 1, 2),
                    (272, 2, model.len() as u32, 3000),
                    (330, 4, 1, 2048),
                    (34665, 4, 1, 1024),
                ],
            ),
            (1024, vec![(37510, 7, comment.len() as u32, 4096)]),
            (
                2048,
                vec![(256, 4, 1, 11904), (257, 4, 1, 5952), (262, 3, 1, 32803)],
            ),
        ];
        for (offset, tags) in directories {
            short(&mut bytes, offset, tags.len() as u16, little);
            for (index, (tag, kind, count, value)) in tags.iter().enumerate() {
                let cursor = offset + 2 + index * 12;
                short(&mut bytes, cursor, *tag, little);
                short(&mut bytes, cursor + 2, *kind, little);
                long(&mut bytes, cursor + 4, *count, little);
                if *kind == 3 {
                    short(&mut bytes, cursor + 8, *value as u16, little);
                } else {
                    long(&mut bytes, cursor + 8, *value, little);
                }
            }
        }
        bytes[3000..3000 + model.len()].copy_from_slice(model);
        bytes[4096..4096 + comment.len()].copy_from_slice(comment.as_bytes());
        bytes
    }

    #[test]
    fn follows_exif_and_raw_subifds_in_both_byte_orders() {
        for little in [true, false] {
            let bytes = tiff_fixture(little);
            let file = SparseFile {
                size: bytes.len() as u64,
                segments: vec![super::super::Segment { offset: 0, bytes }],
            };
            let InspectOutcome::Complete(value) = inspect(&file).unwrap() else {
                panic!("metadata should be complete");
            };
            assert_eq!(value["cameraModel"], "Insta360 X5");
            assert_eq!(value["width"], 11904);
            assert_eq!(value["height"], 5952);
            assert_eq!(value["projection"], "mei-extended");
            assert_eq!(value["lenses"][0]["cx"], 2984.74);
        }
    }

    #[test]
    fn requests_missing_comment_bytes_without_reading_sensor_data() {
        let bytes = tiff_fixture(true);
        let file = SparseFile {
            size: bytes.len() as u64,
            segments: vec![super::super::Segment {
                offset: 0,
                bytes: bytes[..4096].to_vec(),
            }],
        };
        let InspectOutcome::NeedRanges(ranges) = inspect(&file).unwrap() else {
            panic!("comment should require a range");
        };
        assert_eq!(ranges[0].offset, 4096);
        assert!(ranges[0].length < 1024);
    }

    #[test]
    fn rejects_truncated_and_out_of_bounds_tiff_metadata() {
        for bytes in [vec![73, 73], vec![73, 73, 42, 0, 255, 255, 255, 255]] {
            let file = SparseFile {
                size: bytes.len() as u64,
                segments: vec![super::super::Segment { offset: 0, bytes }],
            };
            assert!(inspect(&file).is_err());
        }
        let mut bytes = tiff_fixture(true);
        bytes[8..10].copy_from_slice(&1025u16.to_le_bytes());
        let file = SparseFile {
            size: bytes.len() as u64,
            segments: vec![super::super::Segment { offset: 0, bytes }],
        };
        assert!(inspect(&file).is_err());
    }

    #[test]
    fn bounds_tiff_directories_and_stops_on_cycles() {
        for (count, cycle, accepted) in [(32, false, true), (32, true, true), (33, false, false)] {
            let mut bytes = vec![0; 8 + count * 6];
            bytes[..8].copy_from_slice(&[73, 73, 42, 0, 8, 0, 0, 0]);
            for index in 0..count {
                let next = if index + 1 < count {
                    8 + (index + 1) * 6
                } else if cycle {
                    8
                } else {
                    0
                };
                let offset = 8 + index * 6;
                bytes[offset + 2..offset + 6].copy_from_slice(&(next as u32).to_le_bytes());
            }
            let file = SparseFile {
                size: bytes.len() as u64,
                segments: vec![super::super::Segment { offset: 0, bytes }],
            };
            assert_eq!(inspect(&file).is_ok(), accepted);
        }
    }

    #[test]
    fn retains_the_last_numeric_tag_and_ignores_later_empty_tags() {
        let mut bytes = tiff_fixture(true);
        // The root has room for four extra entries before any referenced data.
        bytes[8..10].copy_from_slice(&10u16.to_le_bytes());
        for (index, (tag, count, value)) in [
            (256u16, 1u32, 12345u32),
            (256, 0, 0),
            (257, 1, 7000),
            (262, 1, 32803),
        ]
        .into_iter()
        .enumerate()
        {
            let offset = 10 + (6 + index) * 12;
            bytes[offset..offset + 2].copy_from_slice(&tag.to_le_bytes());
            bytes[offset + 2..offset + 4].copy_from_slice(&4u16.to_le_bytes());
            bytes[offset + 4..offset + 8].copy_from_slice(&count.to_le_bytes());
            bytes[offset + 8..offset + 12].copy_from_slice(&value.to_le_bytes());
        }
        let file = SparseFile {
            size: bytes.len() as u64,
            segments: vec![super::super::Segment { offset: 0, bytes }],
        };
        let InspectOutcome::Complete(value) = inspect(&file).unwrap() else {
            panic!("metadata should be complete");
        };
        assert_eq!(value["width"], 12345);
        assert_eq!(value["height"], 7000);
    }

    #[test]
    fn x5_preserves_sensor_focal_and_border() {
        let fixture: Value =
            serde_json::from_str(include_str!("testdata/insta360_x5_dng_calibration.json"))
                .unwrap();
        let text = fixture["vendor"]["parameters"].as_str().unwrap();
        let (_, lenses) = x5_lenses(text, 11904, 5952).unwrap();
        assert_eq!(lenses[0]["fx"], 4284.29);
        assert_eq!(lenses[0]["cx"], 2984.74);
        assert_eq!(lenses[0]["cy"], 2966.94);
        assert_eq!(lenses[1]["cx"], 2985.76);
        assert_eq!(lenses[1]["translation"][2], -0.032238);
        assert!(x5_lenses(text, 10752, 5952).is_none());
        assert!(x5_lenses(&text.replace("4284.290", "NaN"), 11904, 5952).is_none());
    }

    #[test]
    fn one_rs_uses_vertical_sensor_coordinates_and_lens_yaw() {
        let (_, lenses) = one_rs_lenses("INSTA3602_1632.300_1605.970_1629.610_-0.045_-0.138_179.385_1629.170_1606.500_4891.020_0.150_-0.366_0.672_3264_6528_3134 31744_32765", 3264, 6528).unwrap();
        assert_eq!(lenses[0]["cx"], 1605.97);
        assert!((lenses[1]["cy"].as_f64().unwrap() - 1627.02).abs() < 1e-8);
        assert_eq!(lenses[1]["sourceRect"]["y"], 0.5);
        assert!(lenses[0]["extrinsicQuaternion"][3].as_f64().unwrap().abs() > 0.99);
    }
}
