use crate::decoders::*;
use std::collections::HashMap;
use std::convert::TryInto;

// Sensor compression layout: Roland Karlsson's BSD-licensed x3f_tools,
// maintained by LibRaw. See X3F-LICENSE.txt and FILENS-CHANGES.md.
const CORRUPT: &str = "X3F: Invalid or truncated sensor data";

pub fn is_x3f(buf: &[u8]) -> bool { buf.starts_with(b"FOVb") }

fn word(buf: &[u8], offset: usize) -> Result<usize, String> {
  let bytes = buf.get(offset..offset.checked_add(4).ok_or(CORRUPT)?).ok_or(CORRUPT)?;
  Ok(u32::from_le_bytes(bytes.try_into().unwrap()) as usize)
}

fn short(buf: &[u8], offset: usize) -> Result<u16, String> {
  let bytes = buf.get(offset..offset.checked_add(2).ok_or(CORRUPT)?).ok_or(CORRUPT)?;
  Ok(u16::from_le_bytes(bytes.try_into().unwrap()))
}

struct Section<'a> { id: &'a [u8], data: &'a [u8] }

pub struct X3fDecoder<'a> {
  buffer: &'a [u8],
  rawloader: &'a RawLoader,
  sections: Vec<Section<'a>>,
}

impl<'a> X3fDecoder<'a> {
  pub fn new(buf: &'a Buffer, rawloader: &'a RawLoader) -> Result<Self, String> {
    // Exclude Buffer's decoder padding from all bounds checks.
    let buffer = buf.buf.get(..buf.size).ok_or(CORRUPT)?;
    if buffer.len() < 40 || !is_x3f(buffer) { return Err(CORRUPT.into()); }
    let end = buffer.len() - 4;
    let offset = word(buffer, end)?;
    let directory = buffer.get(offset..end).ok_or(CORRUPT)?;
    if directory.get(..4) != Some(b"SECd") || word(directory, 4)? < 0x20000 {
      return Err("X3F: Invalid section directory".into());
    }
    let count = word(directory, 8)?;
    let end = count.checked_mul(12).and_then(|len| len.checked_add(12)).ok_or(CORRUPT)?;
    let entries = directory.get(12..end).ok_or(CORRUPT)?;
    let mut sections = Vec::new();
    for entry in entries.chunks_exact(12) {
      let start = word(entry, 0)?;
      let len = word(entry, 4)?;
      let end = start.checked_add(len).ok_or(CORRUPT)?;
      if start < 40 || end > offset || len < 8 { return Err(CORRUPT.into()); }
      sections.push(Section { id: &entry[8..12], data: &buffer[start..end] });
    }
    Ok(Self { buffer, rawloader, sections })
  }

  fn properties(&self) -> Result<HashMap<String, String>, String> {
    let mut properties = HashMap::new();
    for section in self.sections.iter().filter(|section| section.id == b"PROP") {
      let data = section.data;
      if data.get(..4) != Some(b"SECp") { return Err(CORRUPT.into()); }
      let count = word(data, 8)?;
      let end = count.checked_mul(8).and_then(|len| len.checked_add(24)).ok_or(CORRUPT)?;
      let entries = data.get(24..end).ok_or(CORRUPT)?;
      let text = data.get(end..).ok_or(CORRUPT)?;
      for entry in entries.chunks_exact(8) {
        properties.insert(property_string(text, word(entry, 0)?)?, property_string(text, word(entry, 4)?)?);
      }
    }
    Ok(properties)
  }
}

fn property_string(data: &[u8], offset: usize) -> Result<String, String> {
  let start = offset.checked_mul(2).ok_or(CORRUPT)?;
  let mut units = Vec::new();
  for bytes in data.get(start..).ok_or(CORRUPT)?.chunks_exact(2).take(4096) {
    let unit = u16::from_le_bytes(bytes.try_into().unwrap());
    if unit == 0 { return String::from_utf16(&units).map_err(|_| CORRUPT.into()); }
    units.push(unit);
  }
  Err(CORRUPT.into())
}

impl<'a> Decoder for X3fDecoder<'a> {
  fn image(&self, dummy: bool) -> Result<RawImage, String> {
    let properties = self.properties()?;
    let model = properties.get("CAMMODEL").ok_or("X3F: Missing camera model in property directory")?;
    let model = model.trim().to_ascii_uppercase();
    let model = model.strip_prefix("SIGMA ").unwrap_or(&model);
    let image = self.sections.iter().find(|section| {
      (section.id == b"IMA2" || section.id == b"IMAG") &&
      section.data.get(..4) == Some(b"SECi") &&
      matches!(word(section.data, 8), Ok(1) | Ok(3))
    }).ok_or("X3F: Couldn't find sensor image")?;
    let format = word(image.data, 12)?;
    let width = word(image.data, 16)?;
    let height = word(image.data, 20)?;
    let stride = word(image.data, 24)?;
    let count = width.checked_mul(height).and_then(|pixels| pixels.checked_mul(3)).ok_or(CORRUPT)?;
    if width == 0 || height == 0 || width > 50000 || height > 50000 || count > 150_000_000 {
      return Err("X3F: Sensor dimensions exceed the preview limit".into());
    }
    if !matches!(format, 6 | 30) {
      return Err(format!("X3F: Sensor compression format {} is not supported", format));
    }
    let mode = format!("{}x{}", width, height);
    let calibrated = self.rawloader.check_supported_with_everything("SIGMA", model, &mode);
    let has_geometry = calibrated.is_ok();
    let mut camera = calibrated.or_else(|_| self.rawloader.check_supported_with_everything("SIGMA", model, ""))?;
    camera.orientation = match word(self.buffer, 36)? {
      0 => Orientation::Normal, 90 => Orientation::Rotate90,
      180 => Orientation::Rotate180, 270 => Orientation::Rotate270,
      _ => return Err("X3F: Invalid sensor rotation".into()),
    };
    let src = image.data.get(28..).ok_or(CORRUPT)?;
    let data = if dummy { vec![0] } else if format == 6 {
      decode_huffman(src, width, height, stride)?
    } else { decode_true(src, width, height)? };
    // Known modes have calibrated active rectangles. Other sizes use the
    // file's visible dimensions and the model's masked-border origin.
    let visible_width = if has_geometry { width - camera.crops[1] - camera.crops[3] } else { word(self.buffer, 28)? };
    let visible_height = if has_geometry { height - camera.crops[0] - camera.crops[2] } else { word(self.buffer, 32)? };
    let top = camera.crops[0];
    let left = camera.crops[3];
    if visible_width == 0 || visible_height == 0 ||
       visible_width.checked_add(left).map_or(true, |end| end > width) ||
       visible_height.checked_add(top).map_or(true, |end| end > height) {
      return Err("X3F: Invalid active sensor rectangle".into());
    }
    camera.crops = [top, width - left - visible_width, height - top - visible_height, left];
    let mut raw = RawImage::new(camera, width, height, [std::f32::NAN; 4], data, dummy);
    raw.cpp = 3;
    Ok(raw)
  }
}

#[derive(Default)]
struct Node { children: [Option<usize>; 2], value: Option<i32> }
struct Huffman { nodes: Vec<Node> }

impl Huffman {
  fn new() -> Self { Self { nodes: vec![Node::default()] } }
  fn insert(&mut self, length: usize, code: u32, value: i32) -> Result<(), String> {
    if length == 0 || length > 27 || code >> length != 0 { return Err(CORRUPT.into()); }
    let mut index = 0;
    for shift in (0..length).rev() {
      if self.nodes[index].value.is_some() { return Err(CORRUPT.into()); }
      let bit = ((code >> shift) & 1) as usize;
      let next = match self.nodes[index].children[bit] {
        Some(next) => next,
        None => {
          let next = self.nodes.len();
          self.nodes.push(Node::default());
          self.nodes[index].children[bit] = Some(next);
          next
        }
      };
      index = next;
    }
    if self.nodes[index].value.is_some() || self.nodes[index].children != [None, None] { return Err(CORRUPT.into()); }
    self.nodes[index].value = Some(value);
    Ok(())
  }
  fn read(&self, bits: &mut Bits) -> Result<i32, String> {
    let mut index = 0;
    loop {
      let node = &self.nodes[index];
      if let Some(value) = node.value { return Ok(value); }
      index = node.children[bits.read()? as usize].ok_or(CORRUPT)?;
    }
  }
}

struct Bits<'a> { data: &'a [u8], offset: usize }
impl<'a> Bits<'a> {
  fn read(&mut self) -> Result<u32, String> {
    let byte = self.data.get(self.offset / 8).ok_or(CORRUPT)?;
    let value = (byte >> (7 - self.offset % 8)) & 1;
    self.offset += 1;
    Ok(u32::from(value))
  }
}

fn decode_huffman(src: &[u8], width: usize, height: usize, stride: usize) -> Result<Vec<u16>, String> {
  let mut mapping = Vec::with_capacity(1024);
  for index in 0..1024 { mapping.push(short(src, index * 2)?); }
  let src = src.get(2048..).ok_or(CORRUPT)?;
  let mut output = vec![0u16; width * height * 3];
  if stride != 0 {
    let row_bytes = width.checked_mul(4).ok_or(CORRUPT)?;
    if stride < row_bytes { return Err(CORRUPT.into()); }
    for (y, row) in output.chunks_exact_mut(width * 3).enumerate() {
      let start = y.checked_mul(stride).ok_or(CORRUPT)?;
      let data = src.get(start..start.checked_add(row_bytes).ok_or(CORRUPT)?).ok_or(CORRUPT)?;
      let mut accumulators = [0u16; 3];
      for (x, pixel) in row.chunks_exact_mut(3).enumerate() {
        let packed = word(data, x * 4)?;
        for channel in 0..3 {
          accumulators[channel] = accumulators[channel].wrapping_add(mapping[(packed >> (channel * 10)) & 1023]);
          pixel[channel] = (accumulators[channel] as i16).max(0) as u16;
        }
      }
    }
    return Ok(output);
  }
  let mut tree = Huffman::new();
  for (index, value) in mapping.iter().enumerate() {
    let entry = word(src, index * 4)? as u32;
    if entry != 0 { tree.insert((entry >> 27) as usize, entry & 0x07ffffff, *value as i16 as i32)?; }
  }
  let data = src.get(4096..).ok_or(CORRUPT)?;
  let footer = data.len().checked_sub(height.checked_mul(4).ok_or(CORRUPT)?).ok_or(CORRUPT)?;
  let offsets = &data[footer..];
  let data = &data[..footer];
  let mut minimum = 0i16;
  for (y, row) in output.chunks_exact_mut(width * 3).enumerate() {
    let start = word(offsets, y * 4)?;
    let end = if y + 1 == height { data.len() } else { word(offsets, (y + 1) * 4)? };
    let mut bits = Bits { data: data.get(start..end).ok_or(CORRUPT)?, offset: 0 };
    let mut accumulators = [0i16; 3];
    for pixel in row.chunks_exact_mut(3) {
      for channel in 0..3 {
        accumulators[channel] = accumulators[channel].wrapping_add(tree.read(&mut bits)? as i16);
        minimum = minimum.min(accumulators[channel]);
        pixel[channel] = accumulators[channel] as u16;
      }
    }
  }
  for value in &mut output { *value = ((*value as i16 as i32) - i32::from(minimum)).max(0).min(65535) as u16; }
  Ok(output)
}

fn decode_true(src: &[u8], width: usize, height: usize) -> Result<Vec<u16>, String> {
  let seeds = [short(src, 0)?, short(src, 2)?, short(src, 4)?];
  let mut cursor = 8;
  let mut tree = Huffman::new();
  for value in 0..=17 {
    let length = *src.get(cursor).ok_or(CORRUPT)? as usize;
    let code = *src.get(cursor + 1).ok_or(CORRUPT)?;
    cursor += 2;
    if length == 0 { break; }
    if length > 8 || value == 17 { return Err(CORRUPT.into()); }
    tree.insert(length, u32::from(code >> (8 - length)), value)?;
  }
  let sizes = [word(src, cursor)?, word(src, cursor + 4)?, word(src, cursor + 8)?];
  cursor += 12;
  let mut output = vec![0u16; width * height * 3];
  for channel in 0..3 {
    let end = cursor.checked_add(sizes[channel]).ok_or(CORRUPT)?;
    let mut bits = Bits { data: src.get(cursor..end).ok_or(CORRUPT)?, offset: 0 };
    cursor = cursor.checked_add(sizes[channel].checked_add(15).ok_or(CORRUPT)? & !15).ok_or(CORRUPT)?;
    let mut row_starts = [[i32::from(seeds[channel]); 2]; 2];
    for y in 0..height {
      let mut accumulators = [0i32; 2];
      for x in 0..width {
        let length = tree.read(&mut bits)? as usize;
        let mut delta = 0i32;
        if length != 0 {
          let first = bits.read()?;
          delta = first as i32;
          for _ in 1..length { delta = (delta << 1) | bits.read()? as i32; }
          if first == 0 { delta -= (1 << length) - 1; }
        }
        let previous = if x < 2 { row_starts[y % 2][x % 2] } else { accumulators[x % 2] };
        let value = previous.checked_add(delta).ok_or(CORRUPT)?;
        accumulators[x % 2] = value;
        if x < 2 { row_starts[y % 2][x % 2] = value; }
        output[(y * width + x) * 3 + channel] = value as u16;
      }
    }
  }
  Ok(output)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn legacy_huffman_restores_signed_deltas_resets_rows_and_applies_the_global_offset() {
    let mut src = vec![0u8; 6144];
    src[..2].copy_from_slice(&3u16.to_le_bytes());
    src[2..4].copy_from_slice(&(-2i16).to_le_bytes());
    src[2048..2052].copy_from_slice(&(1u32 << 27).to_le_bytes());
    src[2052..2056].copy_from_slice(&((1u32 << 27) | 1).to_le_bytes());
    src.extend_from_slice(&[0x1c, 0xe0]);
    src.extend_from_slice(&0u32.to_le_bytes());
    src.extend_from_slice(&1u32.to_le_bytes());
    assert_eq!(decode_huffman(&src, 2, 2, 0).unwrap(), [5,5,5, 3,3,3, 0,0,0, 3,3,3]);
    for end in 0..src.len() { assert!(decode_huffman(&src[..end], 2, 2, 0).is_err()); }
    src[2052..2056].copy_from_slice(&(1u32 << 27).to_le_bytes());
    assert!(decode_huffman(&src, 2, 2, 0).is_err());
  }

  #[test]
  fn true_planes_preserve_signed_differences_and_four_parity_predictors() {
    let mut src = vec![100, 0, 200, 0, 44, 1, 0, 0];
    // Values 0/1/2 use prefix codes 0/10/11; a zero length terminates the table.
    src.extend_from_slice(&[1, 0, 2, 0x80, 2, 0xc0, 0, 0]);
    for _ in 0..3 { src.extend_from_slice(&5u32.to_le_bytes()); }
    for _ in 0..3 {
      src.extend_from_slice(&[0x59, 0xda, 0xb2, 0xa7, 0x00]);
      src.extend_from_slice(&[0; 11]);
    }
    let actual = decode_true(&src, 4, 3).unwrap();
    let expected: Vec<u16> = [0i32, 1, -1, 3, -2, 0, -1, -1, 1, 1, 0, 3].iter()
      .flat_map(|delta| [100, 200, 300].iter().map(move |seed| (seed + delta) as u16)).collect();
    assert_eq!(actual, expected);
    assert!(decode_true(&src[..src.len() - 12], 4, 3).is_err());
    src[8] = 9;
    assert!(decode_true(&src, 4, 3).is_err());
  }
}
