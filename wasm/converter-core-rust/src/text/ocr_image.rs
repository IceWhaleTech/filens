//! Image normalization belongs to WASM. NCNN handles detector scaling, padding
//! and text-line orientation; transparent PNGs need a white document canvas.
use super::*;
use std::{borrow::Cow, io::Cursor};

pub(super) fn prepare(bytes: &[u8]) -> Result<Cow<'_, [u8]>, ConvertError> {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(Cow::Borrowed(bytes));
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: 256 << 20 });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| parse_error(e.to_string()))?;
    let info = reader.info();
    if info.width > 32768
        || info.height > 32768
        || u64::from(info.width) * u64::from(info.height) > 32_000_000
    {
        return Err(parse_error(
            "OCR image exceeds 32 million pixels or 32768 per side".into(),
        ));
    }
    let alpha = matches!(
        info.color_type,
        png::ColorType::Rgba | png::ColorType::GrayscaleAlpha
    ) || info.trns.is_some();
    if !alpha {
        return Ok(Cow::Borrowed(bytes));
    }
    let size = reader
        .output_buffer_size()
        .filter(|&n| n <= 256 << 20)
        .ok_or_else(|| parse_error("OCR image exceeds decoded byte budget".into()))?;
    let mut decoded = vec![0; size];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|e| parse_error(e.to_string()))?;
    let channels = match frame.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::GrayscaleAlpha => 2,
        _ => return Ok(Cow::Borrowed(bytes)),
    };
    let mut rgb = Vec::with_capacity(frame.width as usize * frame.height as usize * 3);
    for pixel in decoded[..frame.buffer_size()].chunks_exact(channels) {
        let alpha = u32::from(pixel[channels - 1]);
        for channel in 0..3 {
            let value = u32::from(pixel[if channels == 2 { 0 } else { channel }]);
            rgb.push(((value * alpha + 255 * (255 - alpha) + 127) / 255) as u8);
        }
    }
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, frame.width, frame.height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .map_err(|e| parse_error(e.to_string()))?
            .write_image_data(&rgb)
            .map_err(|e| parse_error(e.to_string()))?;
    }
    Ok(Cow::Owned(output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composites_transparent_hidden_rgb_and_partial_alpha_over_white() {
        let mut input = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut input, 3, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[0, 0, 0, 0, 0, 0, 0, 255, 0, 100, 200, 128])
                .unwrap();
        }
        let output = prepare(&input).unwrap();
        let mut reader = png::Decoder::new(Cursor::new(output.as_ref()))
            .read_info()
            .unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut pixels).unwrap();
        assert_eq!(info.color_type, png::ColorType::Rgb);
        assert_eq!(pixels, [255, 255, 255, 0, 0, 0, 127, 177, 227]);
    }
}
