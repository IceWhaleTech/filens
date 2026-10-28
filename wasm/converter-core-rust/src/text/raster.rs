//! Decode scientific raster containers inside WASM, then inject OCR on PNG.
//! Floating/scientific samples are projected to visible contrast for indexing;
//! this is not a general-purpose scientific image conversion API.
use super::*;
use raster_codec::ImageDecoder;
use std::io::{BufRead, BufReader};

const MAX_PIXELS: usize = 32_000_000;
const MAX_SAMPLES: usize = 32_000_000;

fn unsupported(message: &str) -> ConvertError {
    ConvertError {
        code: "unsupported_format",
        message: message.into(),
    }
}
fn dimensions(width: usize, height: usize, bands: usize) -> Result<usize, ConvertError> {
    let pixels = width
        .checked_mul(height)
        .filter(|&n| n > 0 && n <= MAX_PIXELS)
        .ok_or_else(|| parse_error("raster exceeds 32 million pixels".into()))?;
    let samples = pixels
        .checked_mul(bands)
        .filter(|&n| n <= MAX_SAMPLES)
        .ok_or_else(|| parse_error("scientific raster exceeds sample budget".into()))?;
    if width > 32_768 || height > 32_768 || !matches!(bands, 1..=4) {
        return Err(unsupported(
            "raster needs 1–4 bands and dimensions at most 32768",
        ));
    }
    Ok(samples)
}

pub(super) fn png(input: &str, format: &str) -> Result<Vec<u8>, ConvertError> {
    let (width, height, rgb) = match format {
        "mat" => matlab(input)?,
        "fits" | "fit" | "fts" => fits(input)?,
        "v" | "vips" => vips(input)?,
        "pfm" => pfm(input)?,
        _ => {
            let format = match format {
                "hdr" => raster_codec::ImageFormat::Hdr,
                "exr" => raster_codec::ImageFormat::OpenExr,
                _ => raster_codec::ImageFormat::Pnm,
            };
            let mut reader = raster_codec::ImageReader::with_format(
                BufReader::new(File::open(input).map_err(|e| io_error(e.to_string()))?),
                format,
            );
            let mut limits = raster_codec::Limits::default();
            limits.max_alloc = Some(256 << 20);
            limits.max_image_width = Some(32_768);
            limits.max_image_height = Some(32_768);
            reader.limits(limits);
            let decoder = reader
                .into_decoder()
                .map_err(|e| parse_error(e.to_string()))?;
            let (width, height) = decoder.dimensions();
            dimensions(width as usize, height as usize, 1)?;
            let decoded = raster_codec::DynamicImage::from_decoder(decoder)
                .map_err(|e| parse_error(e.to_string()))?;
            let rgb = match decoded {
                raster_codec::DynamicImage::ImageRgb32F(values) => {
                    dimensions(width as usize, height as usize, 3)?;
                    visible(values.as_raw(), 3)
                }
                raster_codec::DynamicImage::ImageRgba32F(values) => {
                    dimensions(width as usize, height as usize, 4)?;
                    visible(values.as_raw(), 4)
                }
                other => other.to_rgb8().into_raw(),
            };
            (width, height, rgb)
        }
    };
    encode(width, height, &rgb)
}

fn encode(width: u32, height: u32, rgb: &[u8]) -> Result<Vec<u8>, ConvertError> {
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| parse_error(e.to_string()))?;
        writer
            .write_image_data(rgb)
            .map_err(|e| parse_error(e.to_string()))?;
    }
    Ok(output)
}

// Inputs are interleaved. Ignore alpha and map finite physical sample values
// together, preserving contrast for signed/HDR data and writing no-data white.
fn visible<T: Copy + Into<f64>>(values: &[T], bands: usize) -> Vec<u8> {
    let mut low = f64::INFINITY;
    let mut high = f64::NEG_INFINITY;
    let channels = if bands <= 2 { 1 } else { 3 };
    for pixel in values.chunks_exact(bands) {
        for &value in &pixel[..channels] {
            let value: f64 = value.into();
            if value.is_finite() {
                low = low.min(value);
                high = high.max(value);
            }
        }
    }
    let range = high - low;
    let sample = |value: T| -> u8 {
        let value: f64 = value.into();
        if !value.is_finite() || !range.is_finite() || range <= 0.0 {
            255
        } else {
            ((value - low) / range * 255.0).round().clamp(0.0, 255.0) as u8
        }
    };
    let mut rgb = Vec::with_capacity(values.len() / bands * 3);
    for pixel in values.chunks_exact(bands) {
        if channels == 1 {
            rgb.extend_from_slice(&[sample(pixel[0]); 3]);
        } else {
            rgb.extend(pixel[..3].iter().map(|&v| sample(v)));
        }
    }
    rgb
}

fn matlab(input: &str) -> Result<(u32, u32, Vec<u8>), ConvertError> {
    let file = matfile::MatFile::parse(File::open(input).map_err(|e| io_error(e.to_string()))?)
        .map_err(|e| parse_error(e.to_string()))?;
    for array in file.arrays() {
        let dims = array.size();
        if dims.len() < 2 || dims.len() > 3 || dims[0] < 2 || dims[1] < 2 {
            continue;
        }
        let (height, width) = (dims[0], dims[1]);
        let bands = dims.get(2).copied().unwrap_or(1);
        let count = dimensions(width, height, bands)?;
        macro_rules! samples {
            ($real:expr, $imag:expr) => {{
                if $imag.is_some() {
                    return Err(unsupported("complex MATLAB arrays are not raster images"));
                }
                $real.iter().map(|&v| v as f64).collect::<Vec<_>>()
            }};
        }
        use matfile::NumericData::*;
        let planar = match array.data() {
            Int8 { real, imag } => samples!(real, imag),
            UInt8 { real, imag } => samples!(real, imag),
            Int16 { real, imag } => samples!(real, imag),
            UInt16 { real, imag } => samples!(real, imag),
            Int32 { real, imag } => samples!(real, imag),
            UInt32 { real, imag } => samples!(real, imag),
            Int64 { real, imag } => samples!(real, imag),
            UInt64 { real, imag } => samples!(real, imag),
            Single { real, imag } => samples!(real, imag),
            Double { real, imag } => samples!(real, imag),
        };
        if planar.len() != count {
            return Err(parse_error("MATLAB raster sample count mismatch".into()));
        }
        let mut interleaved = Vec::with_capacity(count);
        for y in 0..height {
            for x in 0..width {
                for band in 0..bands {
                    interleaved.push(planar[band * width * height + x * height + y]);
                }
            }
        }
        return Ok((width as u32, height as u32, visible(&interleaved, bands)));
    }
    Err(unsupported(
        "MATLAB file contains no two-dimensional numeric raster",
    ))
}

fn fits(input: &str) -> Result<(u32, u32, Vec<u8>), ConvertError> {
    use fitsrs::{Fits, HDU, Pixels};
    let mut hdus = Fits::from_reader(BufReader::new(
        File::open(input).map_err(|e| io_error(e.to_string()))?,
    ));
    for _ in 0..200 {
        let Some(hdu) = hdus.next() else { break };
        let hdu = hdu.map_err(|e| parse_error(e.to_string()))?;
        if let HDU::Primary(hdu) | HDU::XImage(hdu) = hdu {
            let header = hdu.get_header();
            let axes = header.get_xtension().get_naxis();
            if axes.is_empty() || axes.contains(&0) {
                continue;
            }
            if axes.len() != 2 && !(axes.len() == 3 && matches!(axes[2], 1 | 3)) {
                return Err(unsupported(
                    "FITS raster requires two axes or three RGB planes",
                ));
            }
            let (width, height) = (
                usize::try_from(axes[0]).unwrap_or(usize::MAX),
                usize::try_from(axes[1]).unwrap_or(usize::MAX),
            );
            let bands = axes.get(2).copied().unwrap_or(1) as usize;
            let count = dimensions(width, height, bands)?;
            let scale = header.get_parsed::<f64>("BSCALE").unwrap_or(1.0);
            let zero = header.get_parsed::<f64>("BZERO").unwrap_or(0.0);
            let blank = header.get_parsed::<i64>("BLANK").ok();
            macro_rules! samples {
                ($it:expr, $integer:expr) => {
                    $it.take(count + 1)
                        .map(|v| {
                            let value = v as f64;
                            if $integer && blank.is_some_and(|b| b as f64 == value) {
                                f64::NAN
                            } else {
                                value * scale + zero
                            }
                        })
                        .collect::<Vec<_>>()
                };
            }
            let values = match hdus.get_data(&hdu).pixels() {
                Pixels::U8(it) => samples!(it, true),
                Pixels::I16(it) => samples!(it, true),
                Pixels::I32(it) => samples!(it, true),
                Pixels::I64(it) => samples!(it, true),
                Pixels::F32(it) => samples!(it, false),
                Pixels::F64(it) => samples!(it, false),
            };
            if values.len() != count {
                return Err(parse_error("truncated FITS raster".into()));
            }
            // FITS axis 2 increases bottom-to-top, unlike PNG scanlines.
            let mut interleaved = Vec::new();
            let values = if bands == 3 {
                interleaved.reserve(count);
                let pixels = width * height;
                for pixel in 0..pixels {
                    for band in 0..bands {
                        interleaved.push(values[band * pixels + pixel]);
                    }
                }
                &interleaved
            } else {
                &values
            };
            let mut rgb = visible(values, bands);
            flip_rows(&mut rgb, width, height);
            return Ok((width as u32, height as u32, rgb));
        }
    }
    Err(unsupported("FITS contains no supported image HDU"))
}

fn flip_rows(rgb: &mut [u8], width: usize, height: usize) {
    let stride = width * 3;
    for y in 0..height / 2 {
        let (before, after) = rgb.split_at_mut((height - 1 - y) * stride);
        before[y * stride..(y + 1) * stride].swap_with_slice(&mut after[..stride]);
    }
}

fn pfm(input: &str) -> Result<(u32, u32, Vec<u8>), ConvertError> {
    let mut reader = BufReader::new(File::open(input).map_err(|e| io_error(e.to_string()))?);
    let mut header = Vec::new();
    let mut bytes = 0;
    while header.len() < 3 {
        let mut line = String::new();
        let n = reader
            .by_ref()
            .take(4097)
            .read_line(&mut line)
            .map_err(|e| parse_error(e.to_string()))?;
        bytes += n;
        if n == 0 || bytes > 4096 {
            return Err(parse_error("invalid PFM header".into()));
        }
        let line = line.trim();
        if !line.is_empty() && !line.starts_with('#') {
            header.push(line.to_owned());
        }
    }
    let bands = match header[0].as_str() {
        "PF" => 3,
        "Pf" => 1,
        _ => return Err(parse_error("invalid PFM magic".into())),
    };
    let dims = header[1]
        .split_whitespace()
        .map(str::parse::<usize>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| parse_error(e.to_string()))?;
    if dims.len() != 2 {
        return Err(parse_error("invalid PFM dimensions".into()));
    }
    let (width, height) = (dims[0], dims[1]);
    let count = dimensions(width, height, bands)?;
    let scale: f32 = header[2]
        .parse()
        .map_err(|_| parse_error("invalid PFM scale".into()))?;
    if !scale.is_finite() || scale == 0.0 {
        return Err(parse_error("invalid PFM scale".into()));
    }
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let mut bytes = [0; 4];
        reader
            .read_exact(&mut bytes)
            .map_err(|e| parse_error(e.to_string()))?;
        let value = if scale < 0.0 {
            f32::from_le_bytes(bytes)
        } else {
            f32::from_be_bytes(bytes)
        };
        values.push((value * scale.abs()) as f64);
    }
    let mut rgb = visible(&values, bands);
    flip_rows(&mut rgb, width, height);
    Ok((width as u32, height as u32, rgb))
}

fn vips(input: &str) -> Result<(u32, u32, Vec<u8>), ConvertError> {
    let mut reader = BufReader::new(File::open(input).map_err(|e| io_error(e.to_string()))?);
    let mut header = [0; 64];
    reader
        .read_exact(&mut header)
        .map_err(|e| parse_error(e.to_string()))?;
    let little = match &header[..4] {
        [0xb6, 0xa6, 0xf2, 0x08] => true,
        [0x08, 0xf2, 0xa6, 0xb6] => false,
        _ => return Err(parse_error("invalid VIPS magic".into())),
    };
    let integer = |offset| {
        let bytes = header[offset..offset + 4].try_into().unwrap();
        if little {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        }
    };
    let (width, height, bands) = (
        integer(4) as usize,
        integer(8) as usize,
        integer(12) as usize,
    );
    let count = dimensions(width, height, bands)?;
    if integer(24) != 0 {
        return Err(unsupported("coded VIPS pixels require an uncoded raster"));
    }
    let interpretation = integer(28);
    let format = integer(20);
    // Ignoring CMYK's fourth band loses text printed with black ink.
    match interpretation {
        0 => {}
        1 | 26 if bands <= 2 => {}
        17 | 22 | 25 | 28 if bands >= 3 => {}
        15 if bands == 4 && matches!(format, 0 | 2) => {}
        _ => return Err(unsupported("unsupported VIPS color interpretation")),
    }
    let size = match format {
        0 | 1 => 1,
        2 | 3 => 2,
        4 | 5 | 6 => 4,
        8 => 8,
        _ => return Err(unsupported("complex VIPS samples are not supported")),
    };
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        let mut b = [0; 8];
        reader
            .read_exact(&mut b[..size])
            .map_err(|e| parse_error(e.to_string()))?;
        if !little {
            b[..size].reverse();
        }
        let value = match format {
            0 => b[0] as f64,
            1 => (b[0] as i8) as f64,
            2 => u16::from_le_bytes(b[..2].try_into().unwrap()) as f64,
            3 => i16::from_le_bytes(b[..2].try_into().unwrap()) as f64,
            4 => u32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            5 => i32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            6 => f32::from_le_bytes(b[..4].try_into().unwrap()) as f64,
            _ => f64::from_le_bytes(b),
        };
        values.push(value);
    }
    let rgb = if interpretation == 15 {
        let maximum = if format == 0 { 255.0 } else { 65535.0 };
        let mut rgb = Vec::with_capacity(width * height * 3);
        for pixel in values.chunks_exact(4) {
            for channel in &pixel[..3] {
                rgb.push(
                    ((1.0 - channel / maximum) * (1.0 - pixel[3] / maximum) * 255.0)
                        .round()
                        .clamp(0.0, 255.0) as u8,
                );
            }
        }
        rgb
    } else {
        visible(&values, bands)
    };
    Ok((width as u32, height as u32, rgb))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new(bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "filens-raster-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::write(&path, bytes).unwrap();
            Self(path)
        }
        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    #[test]
    fn pfm_endian_scale_and_bottom_up() {
        for little in [true, false] {
            let mut bytes = format!(
                "Pf\n# comment\n2 2\n{}\n",
                if little { "-2.0" } else { "2.0" }
            )
            .into_bytes();
            for value in [2.0f32, 3.0, 0.0, 1.0] {
                bytes.extend(if little {
                    value.to_le_bytes()
                } else {
                    value.to_be_bytes()
                });
            }
            let (w, h, rgb) = pfm(Fixture::new(&bytes).path()).unwrap();
            assert_eq!((w, h), (2, 2));
            assert_eq!(rgb, [0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255]);
            bytes.pop();
            assert!(pfm(Fixture::new(&bytes).path()).is_err());
        }
        assert!(pfm(Fixture::new(b"Pf\n2 2\nNaN\n").path()).is_err());
        assert!(pfm(Fixture::new(b"Pf\n99999999 2\n-1\n").path()).is_err());
    }
    fn vips_bytes(
        little: bool,
        bands: u32,
        interpretation: u32,
        format: u32,
        coding: u32,
        pixels: &[u8],
    ) -> Vec<u8> {
        let mut b = vec![0u8; 64];
        for (offset, value) in [
            (0, 0x08f2a6b6u32),
            (4, 2),
            (8, 2),
            (12, bands),
            (20, format),
            (24, coding),
            (28, interpretation),
        ] {
            b[offset..offset + 4].copy_from_slice(&if little {
                value.to_le_bytes()
            } else {
                value.to_be_bytes()
            });
        }
        b.extend_from_slice(pixels);
        b
    }
    #[test]
    fn vips_endian_cmyk_and_invalid_rasters() {
        for little in [true, false] {
            let mut data = Vec::new();
            for n in [0u16, 1, 2, 3] {
                data.extend(if little {
                    n.to_le_bytes()
                } else {
                    n.to_be_bytes()
                });
            }
            let b = vips_bytes(little, 1, 26, 2, 0, &data);
            assert_eq!(
                vips(Fixture::new(&b).path()).unwrap().2,
                [0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255]
            );
        }
        let b = vips_bytes(
            true,
            4,
            15,
            0,
            0,
            &[0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0],
        );
        assert_eq!(
            vips(Fixture::new(&b).path()).unwrap().2,
            [0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255]
        );
        for b in [
            vips_bytes(true, 3, 13, 0, 0, &[0; 12]),
            vips_bytes(true, 3, 22, 0, 2, &[0; 12]),
            vips_bytes(true, 1, 1, 0, 0, &[0; 3]),
        ] {
            assert!(vips(Fixture::new(&b).path()).is_err());
        }
    }
    #[test]
    fn contrast_and_resource_limits() {
        assert_eq!(
            visible(&[-1.0, 0.0, 1.0, f64::NAN], 1),
            [0, 0, 0, 128, 128, 128, 255, 255, 255, 255, 255, 255]
        );
        assert_eq!(visible(&[10.0f32, 11.0], 1), [0, 0, 0, 255, 255, 255]);
        assert!(dimensions(usize::MAX, 2, 1).is_err());
        assert!(dimensions(4000, 4000, 3).is_err());
        assert!(dimensions(0, 10, 1).is_err());
    }
}
