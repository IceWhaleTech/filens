//! P3/P6 PPM decoding and PNG encoding, shared by browser and backend WASM hosts.
use crate::{ConvertError, conversion_error, io_error};
use std::fs;

const MAX_RASTER_BYTES: usize = 128 << 20;

pub fn convert(input: &str, output: &str) -> Result<(), ConvertError> {
    let bytes = fs::read(input).map_err(|e| io_error(format!("read PPM: {e}")))?;
    let (width, height, depth, pixels) = decode(&bytes)?;
    let file = fs::File::create(output).map_err(|e| io_error(format!("create PNG: {e}")))?;
    let mut encoder = png::Encoder::new(file, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(depth);
    let mut writer = encoder
        .write_header()
        .map_err(|e| invalid(&e.to_string()))?;
    writer
        .write_image_data(&pixels)
        .map_err(|e| invalid(&e.to_string()))?;
    writer.finish().map_err(|e| invalid(&e.to_string()))
}

fn invalid(message: &str) -> ConvertError {
    conversion_error(format!("PPM: {message}"))
}

fn whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\r' | b'\n' | 11 | 12)
}

struct Tokens<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Tokens<'_> {
    fn token(&mut self) -> Result<&[u8], ConvertError> {
        loop {
            while self.bytes.get(self.at).is_some_and(|b| whitespace(*b)) {
                self.at += 1;
            }
            if self.bytes.get(self.at) != Some(&b'#') {
                break;
            }
            while self
                .bytes
                .get(self.at)
                .is_some_and(|b| !matches!(b, b'\r' | b'\n'))
            {
                self.at += 1;
            }
        }
        let start = self.at;
        while self
            .bytes
            .get(self.at)
            .is_some_and(|b| !whitespace(*b) && *b != b'#')
        {
            self.at += 1;
        }
        if self.at == start {
            return Err(invalid("truncated header or raster"));
        }
        Ok(&self.bytes[start..self.at])
    }

    fn number(&mut self) -> Result<u32, ConvertError> {
        let token = self.token()?;
        let mut value = 0u32;
        for &byte in token {
            if !byte.is_ascii_digit() {
                return Err(invalid("expected an unsigned decimal number"));
            }
            value = value
                .checked_mul(10)
                .and_then(|v| v.checked_add((byte - b'0') as u32))
                .ok_or_else(|| invalid("number is too large"))?;
        }
        Ok(value)
    }
}

fn decode(bytes: &[u8]) -> Result<(u32, u32, png::BitDepth, Vec<u8>), ConvertError> {
    if !matches!(bytes.get(..2), Some(b"P3" | b"P6"))
        || !bytes.get(2).is_some_and(|b| whitespace(*b))
    {
        return Err(invalid("expected P3 or P6 magic"));
    }
    let binary = bytes[1] == b'6';
    let mut tokens = Tokens { bytes, at: 2 };
    let width = tokens.number()?;
    let height = tokens.number()?;
    let maxval = tokens.number()?;
    if width == 0 || height == 0 || !(1..=65535).contains(&maxval) {
        return Err(invalid("invalid dimensions or maximum sample value"));
    }
    let sample_bytes = if maxval > 255 { 2usize } else { 1 };
    let size = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(3 * sample_bytes))
        .filter(|n| *n <= MAX_RASTER_BYTES)
        .ok_or_else(|| invalid("image exceeds the raster size limit"))?;
    if binary {
        // Consume only the header separator: whitespace and '#' can be pixel bytes.
        let separator = *bytes
            .get(tokens.at)
            .filter(|b| whitespace(**b))
            .ok_or_else(|| invalid("missing binary raster separator"))?;
        tokens.at += 1;
        if separator == b'\r' && bytes.get(tokens.at) == Some(&b'\n') {
            tokens.at += 1;
        }
        if bytes.len() - tokens.at < size {
            return Err(invalid("truncated binary raster"));
        }
    } else if size / sample_bytes > bytes.len() - tokens.at {
        // Each sample requires at least one byte, even before its separators.
        return Err(invalid("truncated text raster"));
    }
    let mut pixels = Vec::with_capacity(size);
    let output_max = if sample_bytes == 2 { 65535 } else { 255 };
    for _ in 0..size / sample_bytes {
        let value = if !binary {
            tokens.number()?
        } else if sample_bytes == 1 {
            let value = bytes[tokens.at] as u32;
            tokens.at += 1;
            value
        } else {
            let value = u16::from_be_bytes([bytes[tokens.at], bytes[tokens.at + 1]]) as u32;
            tokens.at += 2;
            value
        };
        if value > maxval {
            return Err(invalid("sample exceeds the maximum value"));
        }
        let value = (value * output_max + maxval / 2) / maxval;
        if sample_bytes == 2 {
            pixels.extend_from_slice(&(value as u16).to_be_bytes());
        } else {
            pixels.push(value as u8);
        }
    }
    let depth = if sample_bytes == 2 {
        png::BitDepth::Sixteen
    } else {
        png::BitDepth::Eight
    };
    Ok((width, height, depth, pixels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p3_comments_and_sample_scaling() {
        let (w, h, depth, pixels) =
            decode(b"P3\n# comment\r\n2\t1\n15\n15 0 0 # red\n0 7 15\n").unwrap();
        assert_eq!((w, h, depth), (2, 1, png::BitDepth::Eight));
        assert_eq!(pixels, [255, 0, 0, 0, 119, 255]);
    }

    #[test]
    fn p6_preserves_binary_whitespace_and_hash() {
        for first in [b'\n', b'\r', b' ', b'\t', b'#', 0, 255] {
            let mut input = b"P6\n1 1\n255\n".to_vec();
            input.extend_from_slice(&[first, 0, 255]);
            assert_eq!(decode(&input).unwrap().3, [first, 0, 255]);
        }
        assert_eq!(
            decode(b"P6\r\n1 1\r\n255\r\n\x23\x20\x0a").unwrap().3,
            [35, 32, 10]
        );
    }

    #[test]
    fn preserves_sixteen_bit_samples_and_normalizes_maxval() {
        let (_, _, depth, pixels) = decode(b"P6\n1 1\n1023\n\x03\xff\x00\x00\x02\x00").unwrap();
        assert_eq!(depth, png::BitDepth::Sixteen);
        assert_eq!(pixels, [255, 255, 0, 0, 128, 32]);
        assert_eq!(
            decode(b"P3 1 1 65535 65535 256 0").unwrap().3,
            [255, 255, 1, 0, 0, 0]
        );
    }

    #[test]
    fn rejects_malformed_and_oversized_images() {
        for input in [
            &b"P2 1 1 255 0"[..],
            b"P31 1 255 0 0 0",
            b"P6 0 1 255\n",
            b"P3 1 1 0 0 0 0",
            b"P3 1 1 65536 0 0 0",
            b"P3 1 1 255 -1 0 0",
            b"P3 1 1 255 0 0",
            b"P6 1 1 255\n\0\0",
            b"P6 1 1 15\n\xff\0\0",
            b"P3 1 1 15 16 0 0",
            b"P3 4294967296 1 255 0 0 0",
            b"P6 4294967295 4294967295 255\n",
            b"P6 999999 999999 255\n",
        ] {
            assert!(decode(input).is_err(), "accepted {input:?}");
        }
    }
}
