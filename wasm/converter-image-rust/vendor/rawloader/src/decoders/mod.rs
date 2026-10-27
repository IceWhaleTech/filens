use std::io::{Read, BufReader};
use std::fs::File;
use std::panic;
use std::path::Path;
use toml::Value;

macro_rules! fetch_tag {
  ($tiff:expr, $tag:expr) => (
    $tiff.find_entry($tag).ok_or(
      format!("Couldn't find tag {}",stringify!($tag)).to_string()
    )?
  );
}

macro_rules! fetch_ifd {
  ($tiff:expr, $tag:expr) => (
    $tiff.find_first_ifd($tag).ok_or(
      format!("Couldn't find ifd with tag {}",stringify!($tag)).to_string()
    )?
  );
}

macro_rules! alloc_image_plain {
  ($width:expr, $height:expr, $dummy: expr) => (
    {
      if $width * $height > 500000000 || $width > 50000 || $height > 50000 {
        panic!("rawloader: surely there's no such thing as a >500MP or >50000 px wide/tall image!");
      }
      if $dummy {
        vec![0]
      } else {
        vec![0; $width * $height]
      }
    }
  );
}

macro_rules! alloc_image {
  ($width:expr, $height:expr, $dummy: expr) => (
    {
      let out = alloc_image_plain!($width, $height, $dummy);
      if $dummy {
        return out
      }
      out
    }
  );
}

macro_rules! alloc_image_ok {
  ($width:expr, $height:expr, $dummy: expr) => (
    {
      let out = alloc_image_plain!($width, $height, $dummy);
      if $dummy {
        return Ok(out)
      }
      out
    }
  );
}

mod image;
mod basics;
mod packed;
mod pumps;
mod ljpeg;
pub mod cfa;
mod tiff;
mod ciff;
mod mrw;
mod arw;
mod mef;
mod orf;
mod srw;
mod erf;
mod kdc;
mod dcs;
mod rw2;
mod raf;
mod dcr;
mod dng;
mod pef;
mod crw;
mod nkd;
mod mos;
mod iiq;
mod tfr;
mod nef;
mod nrw;
mod cr2;
mod ari;
mod x3f;
use self::tiff::*;
pub use self::image::*;
mod unwrapped;

#[cfg(test)]
pub static CAMERAS_TOML: &'static str = include_str!(concat!(env!("OUT_DIR"), "/all.toml"));
pub static SAMPLE: &'static str = "\nPlease submit samples at https://raw.pixls.us/";
pub static BUG: &'static str = "\nPlease file a bug with a sample file at https://github.com/pedrocr/rawloader/issues/new";

pub trait Decoder {
  fn image(&self, dummy: bool) -> Result<RawImage, String>;
}

/// Buffer to hold an image in memory with enough extra space at the end for speed optimizations
#[derive(Debug, Clone)]
pub struct Buffer {
  buf: Vec<u8>,
  size: usize,
}

impl Buffer {
  /// Creates a new buffer from anything that can be read
  pub fn new(reader: &mut dyn Read) -> Result<Buffer, String> {
    let mut buffer = Vec::new();
    if let Err(err) = reader.read_to_end(&mut buffer) {
      return Err(format!("IOError: {}", err).to_string())
    }
    let size = buffer.len();
    buffer.extend([0;16].iter().cloned());
    Ok(Buffer {
      buf: buffer,
      size: size,
    })
  }
}

/// Contains sanitized information about the raw image's properties
#[derive(Debug, Clone)]
pub struct Camera {
  pub make: String,
  pub model: String,
  pub mode: String,
  pub clean_make: String,
  pub clean_model: String,
  pub filesize: usize,
  pub raw_width: usize,
  pub raw_height: usize,
  pub orientation: Orientation,
  whitelevels: [u16;4],
  blacklevels: [u16;4],
  blackareah: (usize, usize),
  blackareav: (usize, usize),
  xyz_to_cam: [[f32;3];4],
  cfa: cfa::CFA,
  crops: [usize;4],
  bps: usize,
  wb_offset: usize,
  highres_width: usize,
  hints: Vec<String>,
}

impl Camera {
  pub fn find_hint(&self, hint: &str) -> bool {
    self.hints.contains(&(hint.to_string()))
  }

  pub fn update_from_toml(&mut self, ct: &toml::value::Table) {
    for (name, val) in ct {
      match name.as_ref() {
        "make" => {self.make = val.as_str().unwrap().to_string().clone();},
        "model" => {self.model = val.as_str().unwrap().to_string().clone();},
        "mode" => {self.mode = val.as_str().unwrap().to_string().clone();},
        "clean_make" => {self.clean_make = val.as_str().unwrap().to_string().clone();},
        "clean_model" => {self.clean_model = val.as_str().unwrap().to_string().clone();},
        "whitepoint" => {let white = val.as_integer().unwrap() as u16; self.whitelevels = [white, white, white, white];},
        "blackpoint" => {let black = val.as_integer().unwrap() as u16; self.blacklevels = [black, black, black, black];},
        "blackareah" => {
          let vals = val.as_array().unwrap();
          self.blackareah = (vals[0].as_integer().unwrap() as usize,
                             vals[1].as_integer().unwrap() as usize);
        },
        "blackareav" => {
          let vals = val.as_array().unwrap();
          self.blackareav = (vals[0].as_integer().unwrap() as usize,
                             vals[1].as_integer().unwrap() as usize);
        },
        "color_matrix" => {
          let matrix = val.as_array().unwrap();
          for (i, val) in matrix.into_iter().enumerate() {
            self.xyz_to_cam[i/3][i%3] = val.as_integer().unwrap() as f32;
          }
        },
        "crops" => {
          let crop_vals = val.as_array().unwrap();
          for (i, val) in crop_vals.into_iter().enumerate() {
            self.crops[i] = val.as_integer().unwrap() as usize;
          }
        },
        "color_pattern" => {self.cfa = cfa::CFA::new(&val.as_str().unwrap().to_string());},
        "bps" => {self.bps = val.as_integer().unwrap() as usize;},
        "wb_offset" => {self.wb_offset = val.as_integer().unwrap() as usize;},
        "filesize" => {self.filesize = val.as_integer().unwrap() as usize;},
        "raw_width" => {self.raw_width = val.as_integer().unwrap() as usize;},
        "raw_height" => {self.raw_height = val.as_integer().unwrap() as usize;},
        "highres_width" => {self.highres_width = val.as_integer().unwrap() as usize;},
        "hints" => {
          self.hints = Vec::new();
          for hint in val.as_array().unwrap() {
            self.hints.push(hint.as_str().unwrap().to_string());
          }
        },
        _ => {},
      }
    }
  }

  pub fn new() -> Camera {
    Camera {
      make: "".to_string(),
      model: "".to_string(),
      mode: "".to_string(),
      clean_make: "".to_string(),
      clean_model: "".to_string(),
      filesize: 0,
      raw_width: 0,
      raw_height: 0,
      whitelevels: [0;4],
      blacklevels: [0;4],
      blackareah: (0,0),
      blackareav: (0,0),
      xyz_to_cam : [[0.0;3];4],
      cfa: cfa::CFA::new(""),
      crops: [0,0,0,0],
      bps: 0,
      wb_offset: 0,
      highres_width: usize::max_value(),
      hints: Vec::new(),
      orientation: Orientation::Unknown,
    }
  }
}

/// Possible orientations of an image
///
/// Values are taken from the IFD tag Orientation (0x0112) in most cases but they can be
/// obtained from other metadata in the file.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
#[allow(missing_docs)]
pub enum Orientation {
  Normal,
  HorizontalFlip,
  Rotate180,
  VerticalFlip,
  Transpose,
  Rotate90,
  Transverse,
  Rotate270,
  Unknown,
}

impl Orientation {
  /// Convert a u16 from the IFD tag Orientation (0x0112) into its corresponding
  /// enum value
  pub fn from_u16(orientation: u16) -> Orientation {
    match orientation {
      1 => Orientation::Normal,
      2 => Orientation::HorizontalFlip,
      3 => Orientation::Rotate180,
      4 => Orientation::VerticalFlip,
      5 => Orientation::Transpose,
      6 => Orientation::Rotate90,
      7 => Orientation::Transverse,
      8 => Orientation::Rotate270,
      _ => Orientation::Unknown,
    }
  }

  /// Extract orienation from a TiffIFD. If the given TiffIFD has an invalid
  /// value or contains no orientation data `Orientation::Unknown` is returned
  fn from_tiff(tiff: &TiffIFD) -> Orientation {
    match tiff.find_entry(Tag::Orientation) {
      Some(entry) => Orientation::from_u16(entry.get_usize(0) as u16),
      None => Orientation::Unknown,
    }
  }

  /// Convert orientation to an image flip operation tuple. The first field is
  /// if x and y coordinates should be swapped (transposed). The second and
  /// third field is horizontal and vertical flipping respectively. For a
  /// correct result, flipping must be done before transposing.
  pub fn to_flips(&self) -> (bool, bool, bool) {
    match *self {
      Orientation::Normal
      | Orientation::Unknown => (false, false, false),
      Orientation::VerticalFlip => (false, false, true),
      Orientation::HorizontalFlip => (false, true, false),
      Orientation::Rotate180 => (false, true, true),
      Orientation::Transpose => (true, false, false),
      Orientation::Rotate90 => (true, false, true),
      Orientation::Rotate270 => (true, true, false),
      Orientation::Transverse => (true, true, true),
    }
  }

  /// Does the opposite of to_flips()
  pub fn from_flips(flips: (bool, bool, bool)) -> Self {
    match flips {
      (false, false, false) => Orientation::Normal,
      (false, false, true)  => Orientation::VerticalFlip,
      (false, true,  false) => Orientation::HorizontalFlip,
      (false, true,  true)  => Orientation::Rotate180,
      (true,  false, false) => Orientation::Transpose,
      (true,  false, true)  => Orientation::Rotate90,
      (true,  true,  false) => Orientation::Rotate270,
      (true,  true,  true)  => Orientation::Transverse,
    }
  }

  /// Convert orientation to the Tiff Orientation value
  pub fn to_u16(&self) -> u16 {
    match *self {
      Orientation::Unknown =>        0,
      Orientation::Normal =>         1,
      Orientation::HorizontalFlip => 2,
      Orientation::Rotate180 =>      3,
      Orientation::VerticalFlip =>   4,
      Orientation::Transpose =>      5,
      Orientation::Rotate90 =>       6,
      Orientation::Transverse =>     7,
      Orientation::Rotate270 =>      8,
    }
  }
}

pub fn ok_image(camera: Camera, width: usize, height: usize, wb_coeffs: [f32;4], image: Vec<u16>) -> Result<RawImage,String> {
  Ok(RawImage::new(camera, width, height, wb_coeffs, image, false))
}

pub fn ok_image_with_blacklevels(camera: Camera, width: usize, height: usize, wb_coeffs: [f32;4], blacks: [u16;4], image: Vec<u16>) -> Result<RawImage,String> {
  let mut img = RawImage::new(camera, width, height, wb_coeffs, image, false);
  img.blacklevels = blacks;
  Ok(img)
}

pub fn ok_image_with_black_white(camera: Camera, width: usize, height: usize, wb_coeffs: [f32;4], black: u16, white: u16, image: Vec<u16>) -> Result<RawImage,String> {
  let mut img = RawImage::new(camera, width, height, wb_coeffs, image, false);
  img.blacklevels = [black, black, black, black];
  img.whitelevels = [white, white, white, white];
  Ok(img)
}

/// The struct that holds all the info about the cameras and is able to decode a file
#[derive(Debug, Clone)]
#[derive(Copy)]
pub struct RawLoader;

include!(concat!(env!("OUT_DIR"), "/camera-profiles.rs"));

fn camera_from_profile(profile: &str) -> Camera {
  let parsed: Value = profile.parse().expect("build-validated camera profile");
  let mut camera = Camera::new();
  camera.update_from_toml(parsed.as_table().unwrap());
  camera
}

impl RawLoader {
  /// Creates a loader; camera profiles are decoded only when selected.
  pub fn new() -> RawLoader {
    RawLoader
  }

  /// Returns a decoder for a given buffer
  pub fn get_decoder<'b>(&'b self, buf: &'b Buffer) -> Result<Box<dyn Decoder+'b>, String> {
    let buffer = &buf.buf;

    if mrw::is_mrw(buffer) {
      let dec = Box::new(mrw::MrwDecoder::new(buffer, &self));
      return Ok(dec as Box<dyn Decoder>);
    }

    if ciff::is_ciff(buffer) {
      let ciff = ciff::CiffIFD::new_file(buf)?;
      let dec = Box::new(crw::CrwDecoder::new(buffer, ciff, &self));
      return Ok(dec as Box<dyn Decoder>);
    }

    if ari::is_ari(buffer) {
      let dec = Box::new(ari::AriDecoder::new(buffer, &self));
      return Ok(dec as Box<dyn Decoder>);
    }

    if x3f::is_x3f(buffer) {
      let dec = Box::new(x3f::X3fDecoder::new(buf, &self)?);
      return Ok(dec as Box<dyn Decoder>);
    }

    if let Ok(tiff) = TiffIFD::new_file(buffer) {
      if tiff.has_entry(Tag::DNGVersion) {
        return Ok(Box::new(dng::DngDecoder::new(buffer, tiff, self)))
      }

      // The DCS560C is really a CR2 camera so we just special case it here
      if tiff.has_entry(Tag::Model) && fetch_tag!(tiff, Tag::Model).get_str() == "DCS560C" {
        return Ok(Box::new(cr2::Cr2Decoder::new(buffer, tiff, self)))
      }

      if tiff.has_entry(Tag::Make) {
        macro_rules! use_decoder {
            ($dec:ty, $buf:ident, $tiff:ident, $rawdec:ident) => (Ok(Box::new(<$dec>::new($buf, $tiff, $rawdec)) as Box<dyn Decoder>));
        }

        return match fetch_tag!(tiff, Tag::Make).get_str().to_string().as_ref() {
          "SONY"                        => use_decoder!(arw::ArwDecoder, buffer, tiff, self),
          "Mamiya-OP Co.,Ltd."          => use_decoder!(mef::MefDecoder, buffer, tiff, self),
          "OLYMPUS IMAGING CORP."       => use_decoder!(orf::OrfDecoder, buffer, tiff, self),
          "OLYMPUS CORPORATION"         => use_decoder!(orf::OrfDecoder, buffer, tiff, self),
          "OLYMPUS OPTICAL CO.,LTD"     => use_decoder!(orf::OrfDecoder, buffer, tiff, self),
          "SAMSUNG"                     => use_decoder!(srw::SrwDecoder, buffer, tiff, self),
          "SEIKO EPSON CORP."           => use_decoder!(erf::ErfDecoder, buffer, tiff, self),
          "EASTMAN KODAK COMPANY"       => use_decoder!(kdc::KdcDecoder, buffer, tiff, self),
          "Eastman Kodak Company"       => use_decoder!(kdc::KdcDecoder, buffer, tiff, self),
          "KODAK"                       => use_decoder!(dcs::DcsDecoder, buffer, tiff, self),
          "Kodak"                       => use_decoder!(dcr::DcrDecoder, buffer, tiff, self),
          "Panasonic"                   => use_decoder!(rw2::Rw2Decoder, buffer, tiff, self),
          "LEICA"                       => use_decoder!(rw2::Rw2Decoder, buffer, tiff, self),
          "FUJIFILM"                    => use_decoder!(raf::RafDecoder, buffer, tiff, self),
          "PENTAX Corporation"          => use_decoder!(pef::PefDecoder, buffer, tiff, self),
          "RICOH IMAGING COMPANY, LTD." => use_decoder!(pef::PefDecoder, buffer, tiff, self),
          "PENTAX"                      => use_decoder!(pef::PefDecoder, buffer, tiff, self),
          "Leaf"                        => use_decoder!(iiq::IiqDecoder, buffer, tiff, self),
          "Hasselblad"                  => use_decoder!(tfr::TfrDecoder, buffer, tiff, self),
          "NIKON CORPORATION"           => use_decoder!(nef::NefDecoder, buffer, tiff, self),
          "NIKON"                       => use_decoder!(nrw::NrwDecoder, buffer, tiff, self),
          "Canon"                       => use_decoder!(cr2::Cr2Decoder, buffer, tiff, self),
          "Phase One A/S"               => use_decoder!(iiq::IiqDecoder, buffer, tiff, self),
          make => Err(format!("Couldn't find a decoder for make \"{}\".{}", make, SAMPLE).to_string()),
        };
      } else if tiff.has_entry(Tag::Software) {
        // Last ditch effort to identify Leaf cameras without Make and Model
        if fetch_tag!(tiff, Tag::Software).get_str() == "Camera Library" {
          return Ok(Box::new(mos::MosDecoder::new(buffer, tiff, self)))
        }
      }
    }

    // If all else fails see if we match by filesize to one of those CHDK style files
    if let Ok(index) = NAKED_PROFILES.binary_search_by_key(&buf.size, |entry| entry.0) {
      let camera = camera_from_profile(CAMERA_PROFILES[NAKED_PROFILES[index].1].3);
      return Ok(Box::new(nkd::NakedDecoder::new(buffer, camera, self)))
    }

    Err(format!("Couldn't find a decoder for this file.{}", SAMPLE).to_string())
  }

  fn check_supported_with_everything<'a>(&'a self, make: &str, model: &str, mode: &str) -> Result<Camera, String> {
    match CAMERA_PROFILES.binary_search_by(|entry| (entry.0, entry.1, entry.2).cmp(&(make, model, mode))) {
      Ok(index) => Ok(camera_from_profile(CAMERA_PROFILES[index].3)),
      Err(_) => Err(format!("Couldn't find camera \"{}\" \"{}\" mode \"{}\".{}", make, model, mode, SAMPLE)),
    }
  }

  fn check_supported_with_mode<'a>(&'a self, tiff: &'a TiffIFD, mode: &str) -> Result<Camera, String> {
    let make = fetch_tag!(tiff, Tag::Make).get_str();
    let model = fetch_tag!(tiff, Tag::Model).get_str();

    // Get a default instance to modify
    let mut camera = self.check_supported_with_everything(make, model, mode)?;

    // Lookup the orientation of the image for later image rotation
    camera.orientation = Orientation::from_tiff(tiff);

    Ok(camera)
  }

  fn check_supported<'a>(&'a self, tiff: &'a TiffIFD) -> Result<Camera, String> {
    self.check_supported_with_mode(tiff, "")
  }

  fn decode_unsafe(&self, buffer: &Buffer, dummy: bool) -> Result<RawImage,String> {
    let decoder = self.get_decoder(&buffer)?;
    decoder.image(dummy)
  }

  /// Decodes an input into a RawImage
  pub fn decode(&self, reader: &mut dyn Read, dummy: bool) -> Result<RawImage,String> {
    let buffer = Buffer::new(reader)?;

    match panic::catch_unwind(|| {
      self.decode_unsafe(&buffer, dummy)
    }) {
      Ok(val) => val,
      Err(_) => Err(format!("Caught a panic while decoding.{}", BUG).to_string()),
    }
  }

  /// Decodes a file into a RawImage
  pub fn decode_file(&self, path: &Path) -> Result<RawImage,String> {
    let file = match File::open(path) {
      Ok(val) => val,
      Err(e) => {return Err(e.to_string())},
    };
    let mut buffered_file = BufReader::new(file);
    self.decode(&mut buffered_file, false)
  }

  // Decodes an unwrapped input (just the image data with minimal metadata) into a RawImage
  // This is only useful for fuzzing really
  #[doc(hidden)]
  pub fn decode_unwrapped(&self, reader: &mut dyn Read) -> Result<RawImageData,String> {
    let buffer = Buffer::new(reader)?;

    match panic::catch_unwind(|| {
      unwrapped::decode_unwrapped(&buffer)
    }) {
      Ok(val) => val,
      Err(_) => Err(format!("Caught a panic while decoding.{}", BUG).to_string()),
    }
  }
}

#[cfg(test)]
mod lazy_profile_tests {
  use super::*;
  use std::collections::HashMap;

  #[test]
  fn lazy_profiles_match_the_original_registry() {
    let parsed: Value = CAMERAS_TOML.parse().unwrap();
    let mut cameras = HashMap::new();
    let mut naked = HashMap::new();
    for value in parsed["cameras"].as_array().unwrap() {
      let base = value.as_table().unwrap();
      let mut modes = vec![base];
      if let Some(overrides) = base.get("modes") {
        modes.extend(overrides.as_array().unwrap().iter().map(|mode| mode.as_table().unwrap()));
      }
      let mut camera = Camera::new();
      camera.update_from_toml(base);
      let mut names = vec![(camera.model.clone(), camera.clean_model.clone())];
      if let Some(aliases) = base.get("model_aliases") {
        names.extend(aliases.as_array().unwrap().iter().map(|alias|
          (alias[0].as_str().unwrap().to_string(), alias[1].as_str().unwrap().to_string())));
      }
      for (model, clean_model) in names {
        for mode in &modes {
          let mut selected = camera.clone();
          selected.update_from_toml(mode);
          selected.model = model.clone(); selected.clean_model = clean_model.clone();
          let key = (selected.make.clone(), selected.model.clone(), selected.mode.clone());
          if selected.filesize > 0 { naked.insert(selected.filesize, format!("{:?}", selected)); }
          cameras.insert(key, selected);
        }
      }
    }
    assert_eq!(cameras.len(), CAMERA_PROFILES.len());
    for (key, expected) in cameras {
      let actual = RawLoader::new().check_supported_with_everything(&key.0, &key.1, &key.2).unwrap();
      assert_eq!(format!("{:?}", actual), format!("{:?}", expected), "{:?}", key);
    }
    assert_eq!(naked.len(), NAKED_PROFILES.len());
    for &(size, index) in NAKED_PROFILES {
      assert_eq!(format!("{:?}", camera_from_profile(CAMERA_PROFILES[index].3)), naked[&size]);
    }
  }
}
