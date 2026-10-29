//! Recover font-specific ToUnicode errors before asking PDFium to extract text.
//! No document-wide Chinese substitutions; correctly mapped 多 remains 多.
use lopdf::{Dictionary, Document, LoadOptions, Object, Stream};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

const MAX_PDF: u64 = 32 << 20;
const MAX_STREAM: usize = 16 << 20;
const MAX_FONTS: usize = 256;

#[derive(Default)]
pub(super) struct Prepared {
    pub path: Option<PathBuf>,
    pub ocr_pages: BTreeSet<u64>,
    pub repaired_fonts: usize,
}

// Recovery is optional. Unsupported, encrypted and damaged PDFs still go to
// PDFium, which owns their existing extraction/error behavior.
pub(super) fn prepare(input: &str, work: &Path) -> Prepared {
    prepare_inner(input, work).unwrap_or_default()
}

// A nonempty extraction can still be glyph IDs masquerading as Unicode.
// Keep normal line breaks/tabs and occasional control characters; sustained
// invalid controls indicate that the remaining mappings cannot be trusted.
pub(super) fn unusable_text(text: &str) -> bool {
    let mut total = 0;
    let mut invalid = 0;
    for c in text.chars() {
        total += 1;
        if c.is_control() && !matches!(c, '\r' | '\n' | '\t') {
            invalid += 1;
        }
    }
    invalid >= 3 && invalid * 50 > total
}

fn prepare_inner(input: &str, work: &Path) -> Option<Prepared> {
    if std::fs::metadata(input).ok()?.len() > MAX_PDF {
        return None;
    }
    let mut doc =
        Document::load_with_options(input, LoadOptions::with_max_decompressed_size(MAX_STREAM))
            .ok()?;
    if doc.is_encrypted() || doc.objects.len() > 100_000 {
        return None;
    }
    let mut result = Prepared::default();
    for (number, id) in doc.get_pages() {
        if page_needs_ocr(&doc, id) {
            result.ocr_pages.insert(u64::from(number - 1));
        }
    }
    let fonts: Vec<_> = doc
        .objects
        .iter()
        .filter_map(|(id, value)| {
            let font = value.as_dict().ok()?;
            (font.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Type0")).then_some(*id)
        })
        .take(MAX_FONTS + 1)
        .collect();
    if fonts.len() > MAX_FONTS {
        return Some(result);
    }
    for id in fonts {
        let Some(content) = repair_font(&doc, doc.get_object(id).ok()?.as_dict().ok()?) else {
            continue;
        };
        // A shared original CMap may belong to several fonts with different
        // glyph programs. Attach a new map to this font only.
        let cmap = doc.add_object(Stream::new(Dictionary::new(), content));
        doc.get_object_mut(id)
            .ok()?
            .as_dict_mut()
            .ok()?
            .set("ToUnicode", cmap);
        result.repaired_fonts += 1;
    }
    if result.repaired_fonts > 0 {
        let path = work.join("pdf-unicode-recovered.pdf");
        doc.save(&path).ok()?;
        result.path = Some(path);
    }
    Some(result)
}

fn page_needs_ocr(doc: &Document, id: lopdf::ObjectId) -> bool {
    let Ok(fonts) = doc.get_page_fonts(id) else {
        return false;
    };
    let opaque: BTreeSet<_> = fonts
        .into_iter()
        .filter_map(|(name, font)| opaque_type3(doc, font).then_some(name))
        .collect();
    if opaque.is_empty() {
        return false;
    }
    let Ok(content) = doc.get_page_content_with_limit(id, MAX_STREAM) else {
        return false;
    };
    content_uses_opaque_font(&content, &opaque)
}

fn content_uses_opaque_font(content: &[u8], opaque: &BTreeSet<Vec<u8>>) -> bool {
    let Ok(content) = lopdf::content::Content::decode(content) else {
        return false;
    };
    let mut selected = false;
    let mut stack = Vec::new();
    for operation in content.operations {
        match operation.operator.as_str() {
            "q" => stack.push(selected),
            "Q" => selected = stack.pop().unwrap_or(false),
            "Tf" => {
                selected = operation
                    .operands
                    .first()
                    .and_then(|o| o.as_name().ok())
                    .is_some_and(|name| opaque.contains(name))
            }
            "Tj" | "TJ" | "'" | "\"" if selected => return true,
            _ => (),
        }
    }
    false
}

fn opaque_type3(doc: &Document, font: &Dictionary) -> bool {
    if font.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Type3")
        || font.has(b"ToUnicode")
    {
        return false;
    }
    // Numeric glyph names carry no text semantics. Ordinary Type3 fonts with
    // meaningful Adobe glyph names (A, alpha, uni4E00, etc.) remain extractable.
    let Some(differences) = font
        .get_deref(b"Encoding", doc)
        .ok()
        .and_then(|o| o.as_dict().ok())
        .and_then(|d| d.get(b"Differences").ok())
        .and_then(|o| o.as_array().ok())
    else {
        return false;
    };
    let names: Vec<_> = differences
        .iter()
        .filter_map(|v| v.as_name().ok())
        .collect();
    !names.is_empty()
        && names.iter().all(|name| {
            *name == b".notdef"
                || name.iter().all(u8::is_ascii_digit)
                || name
                    .strip_prefix(b"i")
                    .is_some_and(|s| !s.is_empty() && s.iter().all(u8::is_ascii_digit))
        })
}

fn repair_font(doc: &Document, font: &Dictionary) -> Option<Vec<u8>> {
    if !matches!(
        font.get(b"Encoding").and_then(Object::as_name).ok(),
        Some(b"Identity-H" | b"Identity-V")
    ) {
        return None;
    }
    let stream = font.get_deref(b"ToUnicode", doc).ok()?.as_stream().ok()?;
    let content = stream.get_plain_content_with_limit(2 << 20).ok()?;
    let map = parse_cmap(&content)?;
    let inverse = embedded_unicode(doc, font);
    let mut pairs = Vec::new();
    let mut changed = map.malformed_syntax;
    for (code, mut value) in map.mappings {
        if let Some(recovered) = inverse.as_ref().and_then(|m| m.get(&code)) {
            // Preserve semantic multi-character mappings such as fi ligatures.
            if value.len() == 1 && value[0] != *recovered {
                value[0] = *recovered;
                changed = true;
            }
        }
        if let Some(recovered) = duplicate_radical(&value) {
            value = vec![recovered];
            changed = true;
        }
        pairs.push((code, value));
    }
    changed.then(|| encode_cmap(&pairs))
}

#[derive(Clone, Copy)]
enum Token<'a> {
    Word(&'a [u8]),
    Hex(&'a [u8]),
    Open,
    Close,
}

struct ParsedCMap {
    mappings: BTreeMap<u16, Vec<u16>>,
    malformed_syntax: bool,
}

// Only two-byte Identity maps are supported. Bound range expansion before
// allocating entries; an apparent four-byte range must never expand billions
// of entries while inspecting an optional recovery candidate.
fn parse_cmap(bytes: &[u8]) -> Option<ParsedCMap> {
    let mut tokens = Vec::new();
    let mut malformed_syntax = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b if b.is_ascii_whitespace() => i += 1,
            b'[' => {
                tokens.push(Token::Open);
                i += 1;
            }
            b']' => {
                tokens.push(Token::Close);
                i += 1;
            }
            b'<' if bytes.get(i + 1) != Some(&b'<') => {
                let start = i + 1;
                i = start;
                while i < bytes.len() && bytes[i] != b'>' {
                    i += 1;
                }
                if i == bytes.len() {
                    return None;
                }
                tokens.push(Token::Hex(&bytes[start..i]));
                i += 1;
            }
            _ => {
                let start = i;
                i += 1;
                while i < bytes.len()
                    && !bytes[i].is_ascii_whitespace()
                    && !b"[]<>%".contains(&bytes[i])
                {
                    i += 1;
                }
                // Treat the dictionary delimiter as an ordinary wrapper token.
                if bytes[start] == b'<' && bytes.get(i) == Some(&b'<') {
                    i += 1;
                }
                let word = &bytes[start..i];
                // A second broken header seen in the same public sample
                // treats CIDSystemInfo as a variable rather than a name.
                if word == b"CIDSystemInfo" {
                    malformed_syntax = true;
                }
                // Some generators omit whitespace before the next block's
                // count: endbfchar100, endcodespacerange100, or def1. PDFium
                // ignores these maps even when their Unicode values are right.
                let split = [
                    b"endbfchar".as_slice(),
                    b"endbfrange",
                    b"endcodespacerange",
                    b"def",
                ]
                .into_iter()
                .find(|operator| {
                    word.strip_prefix(*operator).is_some_and(|tail| {
                        (!tail.is_empty() && tail.iter().all(u8::is_ascii_digit))
                            || (operator.starts_with(b"end") && tail == b"endcmap")
                    })
                });
                if let Some(operator) = split {
                    tokens.push(Token::Word(&word[..operator.len()]));
                    tokens.push(Token::Word(&word[operator.len()..]));
                    malformed_syntax = true;
                } else {
                    tokens.push(Token::Word(word));
                }
            }
        }
        if tokens.len() > 262_144 {
            return None;
        }
    }
    let mut map = BTreeMap::new();
    let mut i = 0;
    let mut expanded = 0;
    while i < tokens.len() {
        let range = match tokens[i] {
            Token::Word(b"usecmap") => return None,
            Token::Word(b"beginbfchar") => false,
            Token::Word(b"beginbfrange") => true,
            _ => {
                i += 1;
                continue;
            }
        };
        i += 1;
        loop {
            if matches!(tokens.get(i), Some(Token::Word(b"endbfchar")) if !range)
                || matches!(tokens.get(i), Some(Token::Word(b"endbfrange")) if range)
            {
                i += 1;
                break;
            }
            let start = cmap_code(*tokens.get(i)?)?;
            i += 1;
            let end = if range {
                let n = cmap_code(*tokens.get(i)?)?;
                i += 1;
                n
            } else {
                start
            };
            if end < start {
                return None;
            }
            expanded += usize::from(end - start) + 1;
            if expanded > 131_072 {
                return None;
            }
            if matches!(tokens.get(i), Some(Token::Open)) {
                i += 1;
                for code in start..=end {
                    map.insert(code, cmap_value(*tokens.get(i)?)?);
                    i += 1;
                }
                if !matches!(tokens.get(i), Some(Token::Close)) {
                    return None;
                }
                i += 1;
            } else {
                let mut value = cmap_value(*tokens.get(i)?)?;
                i += 1;
                for code in start..=end {
                    map.insert(code, value.clone());
                    // PDF bfrange increments the big-endian destination string.
                    for unit in value.iter_mut().rev() {
                        let (next, carry) = unit.overflowing_add(1);
                        *unit = next;
                        if !carry {
                            break;
                        }
                    }
                }
            }
        }
    }
    (!map.is_empty()).then_some(ParsedCMap {
        mappings: map,
        malformed_syntax,
    })
}

fn cmap_hex(token: Token<'_>) -> Option<Vec<u8>> {
    let Token::Hex(bytes) = token else {
        return None;
    };
    let mut nibbles = Vec::new();
    for b in bytes.iter().copied().filter(|b| !b.is_ascii_whitespace()) {
        nibbles.push((b as char).to_digit(16)? as u8);
        if nibbles.len() > 256 {
            return None;
        }
    }
    if nibbles.len() % 2 != 0 {
        nibbles.push(0);
    }
    Some(nibbles.chunks_exact(2).map(|n| n[0] << 4 | n[1]).collect())
}

fn cmap_code(token: Token<'_>) -> Option<u16> {
    let bytes = cmap_hex(token)?;
    (bytes.len() == 2).then(|| u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn cmap_value(token: Token<'_>) -> Option<Vec<u16>> {
    let bytes = cmap_hex(token)?;
    if bytes.is_empty() || bytes.len() % 2 != 0 {
        return None;
    }
    Some(
        bytes
            .chunks_exact(2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]))
            .collect(),
    )
}

fn embedded_unicode(doc: &Document, font: &Dictionary) -> Option<BTreeMap<u16, u16>> {
    let descendants = font
        .get_deref(b"DescendantFonts", doc)
        .ok()?
        .as_array()
        .ok()?;
    if descendants.len() != 1 {
        return None;
    }
    let (_, descendant) = doc.dereference(&descendants[0]).ok()?;
    let descendant = descendant.as_dict().ok()?;
    if descendant.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"CIDFontType2") {
        return None;
    }
    let descriptor = descendant
        .get_deref(b"FontDescriptor", doc)
        .ok()?
        .as_dict()
        .ok()?;
    let data = descriptor
        .get_deref(b"FontFile2", doc)
        .ok()?
        .as_stream()
        .ok()?
        .get_plain_content_with_limit(MAX_STREAM)
        .ok()?;
    let face = ttf_parser::Face::parse(&data, 0).ok()?;
    let mut glyphs: BTreeMap<u16, Option<u16>> = BTreeMap::new();
    let subtables: Vec<_> = face
        .tables()
        .cmap?
        .subtables
        .into_iter()
        .filter(|s| s.is_unicode())
        .take(9)
        .collect();
    if subtables.len() > 8 {
        return None;
    }
    for subtable in subtables {
        // Query only the supported BMP range. Enumerating a format 12/13
        // subtable's declared ranges could visit billions of bogus codepoints;
        // returning early from its callback would not stop that enumeration.
        for point in 0x20..=u32::from(u16::MAX) {
            let Some(c) = char::from_u32(point).filter(|c| !c.is_control()) else {
                continue;
            };
            if ('\u{e000}'..='\u{f8ff}').contains(&c) {
                continue;
            }
            let Some(glyph) = subtable.glyph_index(point).filter(|g| g.0 != 0) else {
                continue;
            };
            let point = point as u16;
            glyphs
                .entry(glyph.0)
                .and_modify(|v| {
                    if *v != Some(point) {
                        *v = None;
                    }
                })
                .or_insert(Some(point));
        }
    }
    let explicit = match descendant.get_deref(b"CIDToGIDMap", doc) {
        Ok(Object::Name(name)) if name == b"Identity" => None,
        Err(_) => None,
        Ok(Object::Stream(stream)) => Some(stream.get_plain_content_with_limit(131_072).ok()?),
        _ => return None,
    };
    let mut inverse = BTreeMap::new();
    for code in 0..=u16::MAX {
        let glyph = if let Some(data) = &explicit {
            let start = usize::from(code) * 2;
            let Some(bytes) = data.get(start..start + 2) else {
                continue;
            };
            u16::from_be_bytes([bytes[0], bytes[1]])
        } else {
            code
        };
        if let Some(Some(point)) = glyphs.get(&glyph) {
            inverse.insert(code, *point);
        }
    }
    Some(inverse)
}

// Quartz can map one glyph to both a Kangxi radical and its identical unified
// ideograph (⼦子, ⼤大). Collapse only that exact compatibility duplicate;
// ordinary repeated Chinese characters and other Unicode sequences survive.
fn duplicate_radical(value: &[u16]) -> Option<u16> {
    if value.len() != 2 || !(0x2f00..=0x2fd5).contains(&value[0]) {
        return None;
    }
    let normalized: String = char::from_u32(u32::from(value[0]))?
        .to_string()
        .nfkc()
        .collect();
    (normalized.chars().count() == 1 && normalized.chars().next()? as u32 == u32::from(value[1]))
        .then_some(value[1])
}

fn encode_cmap(pairs: &[(u16, Vec<u16>)]) -> Vec<u8> {
    let mut out = String::from(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FiLensRecovered def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
    );
    for chunk in pairs.chunks(100) {
        writeln!(out, "{} beginbfchar", chunk.len()).unwrap();
        for (code, value) in chunk {
            write!(out, "<{code:04X}> <").unwrap();
            for unit in value {
                write!(out, "{unit:04X}").unwrap();
            }
            out.push_str(">\n");
        }
        out.push_str("endbfchar\n");
    }
    out.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Encoding, dictionary};

    fn fixture_font(
        doc: &mut Document,
        pairs: &[(u16, Vec<u16>)],
        explicit: bool,
    ) -> lopdf::ObjectId {
        let data = include_bytes!("../../testdata/pdf-unicode-font.ttf");
        let program = doc.add_object(Stream::new(Dictionary::new(), data.to_vec()));
        let descriptor = doc.add_object(dictionary! { "FontFile2" => program });
        let mut descendant = dictionary! {
            "Subtype" => "CIDFontType2", "FontDescriptor" => descriptor,
        };
        if explicit {
            // Reverse the two glyph IDs to exercise a non-identity CIDToGIDMap.
            let data = vec![0, 0, 0, 2, 0, 1, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8];
            let map = doc.add_object(Stream::new(Dictionary::new(), data));
            descendant.set("CIDToGIDMap", map);
        }
        let descendant = doc.add_object(descendant);
        let map = doc.add_object(Stream::new(Dictionary::new(), encode_cmap(pairs)));
        doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type0", "Encoding" => "Identity-H",
            "DescendantFonts" => vec![Object::Reference(descendant)], "ToUnicode" => map,
        })
    }

    #[test]
    fn recover_actual_glyphs_without_corrupting_duo_or_chaining_replacements() {
        let mut doc = Document::with_version("1.4");
        let values = ['多', '大', '徆', '丌', '不', '収', '发', '子'];
        let pairs: Vec<_> = values
            .iter()
            .enumerate()
            .map(|(i, c)| ((i + 1) as u16, vec![*c as u16]))
            .collect();
        let font = fixture_font(&mut doc, &pairs, false);
        let content = repair_font(&doc, doc.get_object(font).unwrap().as_dict().unwrap()).unwrap();
        let cmap = doc.add_object(Stream::new(Dictionary::new(), content));
        doc.get_object_mut(font)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("ToUnicode", cmap);
        let font = doc.get_object(font).unwrap().as_dict().unwrap();
        let Encoding::UnicodeMapEncoding(map) = font.get_font_encoding(&doc).unwrap() else {
            panic!()
        };
        let text: Vec<_> = (1..=8).map(|code| map.get(code, 2).unwrap()[0]).collect();
        assert_eq!(String::from_utf16(&text).unwrap(), "多大很不与发变子");
        // A second pass is a no-op; 収→发 must not become 发→变.
        assert!(repair_font(&doc, font).is_none());
    }

    #[test]
    fn untrusted_font_ranges_cannot_expand_beyond_supported_unicode() {
        let mut doc = Document::with_version("1.4");
        let font = fixture_font(&mut doc, &[(1, vec!['多' as u16])], false);
        let mut data = include_bytes!("../../testdata/pdf-unicode-font.ttf").to_vec();
        // Replace the cmap with a format 12 group claiming the entire u32
        // range. A range-enumerating callback would never finish this input.
        let offset = data.len();
        let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12];
        cmap.extend_from_slice(&[0, 12, 0, 0]);
        for value in [28_u32, 0, 1, 0, u32::MAX, 1] {
            cmap.extend_from_slice(&value.to_be_bytes());
        }
        let count = u16::from_be_bytes([data[4], data[5]]) as usize;
        let record = (0..count)
            .map(|i| 12 + i * 16)
            .find(|i| &data[*i..*i + 4] == b"cmap")
            .unwrap();
        data[record + 8..record + 12].copy_from_slice(&(offset as u32).to_be_bytes());
        data[record + 12..record + 16].copy_from_slice(&(cmap.len() as u32).to_be_bytes());
        data.extend(cmap);
        let font_dictionary = doc.get_dictionary(font).unwrap();
        let descendant = font_dictionary
            .get(b"DescendantFonts")
            .unwrap()
            .as_array()
            .unwrap()[0]
            .as_reference()
            .unwrap();
        let descriptor = doc
            .get_dictionary(descendant)
            .unwrap()
            .get(b"FontDescriptor")
            .unwrap()
            .as_reference()
            .unwrap();
        let program = doc
            .get_dictionary(descriptor)
            .unwrap()
            .get(b"FontFile2")
            .unwrap()
            .as_reference()
            .unwrap();
        *doc.get_object_mut(program).unwrap() =
            Object::Stream(Stream::new(Dictionary::new(), data));
        let map = embedded_unicode(&doc, doc.get_dictionary(font).unwrap()).unwrap();
        assert_eq!(map[&34], '!' as u16);
        assert!(map.len() <= u16::MAX as usize);
    }

    #[test]
    fn honor_explicit_cid_to_gid_and_preserve_multi_character_mappings() {
        let mut doc = Document::with_version("1.4");
        let font = fixture_font(
            &mut doc,
            &[
                (1, vec!['多' as u16]),
                (2, vec!['大' as u16]),
                (3, vec![0x0066, 0x0069]),
                (4, vec![0xd840, 0xdc00]),
            ],
            true,
        );
        let original = doc.get_object(font).unwrap().as_dict().unwrap().clone();
        let original_cmap = original.get(b"ToUnicode").unwrap().clone();
        let content = repair_font(&doc, &original).unwrap();
        let cmap = doc.add_object(Stream::new(Dictionary::new(), content));
        let mut recovered = original.clone();
        recovered.set("ToUnicode", cmap);
        let Encoding::UnicodeMapEncoding(map) = recovered.get_font_encoding(&doc).unwrap() else {
            panic!()
        };
        assert_eq!(map.get(1, 2), Some(vec!['大' as u16]));
        assert_eq!(map.get(2, 2), Some(vec!['多' as u16]));
        assert_eq!(map.get(3, 2), Some(vec![0x0066, 0x0069]));
        assert_eq!(map.get(4, 2), Some(vec![0xd840, 0xdc00]));
        // Updating this font must not mutate a shared map for another font.
        let mut untouched = recovered.clone();
        untouched.set("ToUnicode", original_cmap);
        let Encoding::UnicodeMapEncoding(map) = untouched.get_font_encoding(&doc).unwrap() else {
            panic!()
        };
        assert_eq!(map.get(1, 2), Some(vec!['多' as u16]));
    }

    #[test]
    fn request_ocr_only_for_type3_without_text_semantics() {
        let doc = Document::with_version("1.4");
        let mut font = dictionary! {
            "Subtype" => "Type3",
            "Encoding" => dictionary! { "Differences" => vec![0.into(), Object::Name(b"0".to_vec()), Object::Name(b"i255".to_vec())] },
        };
        assert!(opaque_type3(&doc, &font));
        font.set(
            "Encoding",
            dictionary! { "Differences" => vec![0.into(), Object::Name(b"uni4E00".to_vec())] },
        );
        assert!(!opaque_type3(&doc, &font));
        font.set("ToUnicode", Object::Null);
        assert!(!opaque_type3(&doc, &font));
    }

    #[test]
    fn unused_type3_resources_do_not_trigger_ocr() {
        let opaque = BTreeSet::from([b"Opaque".to_vec()]);
        assert!(!content_uses_opaque_font(
            b"BT /Readable 12 Tf (readable) Tj ET",
            &opaque
        ));
        assert!(!content_uses_opaque_font(
            b"BT /Opaque 12 Tf /Readable 12 Tf (readable) Tj ET",
            &opaque
        ));
        assert!(!content_uses_opaque_font(
            b"q /Opaque 12 Tf Q BT (readable) Tj ET",
            &opaque
        ));
        assert!(content_uses_opaque_font(
            b"BT /Opaque 12 Tf <0102> Tj ET",
            &opaque
        ));
        assert!(content_uses_opaque_font(
            b"BT /Opaque 12 Tf [<0102> -10 <0304>] TJ ET",
            &opaque
        ));
    }

    #[test]
    fn nonempty_glyph_ids_need_ocr_but_normal_whitespace_does_not() {
        assert!(unusable_text(
            "报价表\u{10}\u{17}\n\u{15}\u{1c}\u{1b}\u{14}\u{18}\u{15}"
        ));
        assert!(!unusable_text("正常文字\t12345\r\n多大很不与发变子"));
        assert!(!unusable_text("偶尔出现\u{0c}换页符\n"));
        assert!(!unusable_text(&format!(
            "{}\u{1}\u{2}\u{3}",
            "正文".repeat(100)
        )));
    }

    #[test]
    fn collapse_only_compatibility_radical_duplicates() {
        assert_eq!(duplicate_radical(&[0x2f26, 0x5b50]), Some(0x5b50));
        assert_eq!(duplicate_radical(&[0x2f24, 0x5927]), Some(0x5927));
        for text in ["多大", "人人", "子子", "fi", "⼦大"] {
            assert_eq!(
                duplicate_radical(&text.encode_utf16().collect::<Vec<_>>()),
                None
            );
        }
    }

    #[test]
    fn parse_bounded_identity_ranges_and_arrays() {
        let map = parse_cmap(b"% comment\n2 beginbfrange\n<0001> <0002> <591A>\n<0003> <0004> [<5F88> <00660069>]\nendbfrange").unwrap().mappings;
        assert_eq!(map[&1], vec![0x591a]);
        assert_eq!(map[&2], vec![0x591b]);
        assert_eq!(map[&3], vec![0x5f88]);
        assert_eq!(map[&4], vec![0x0066, 0x0069]);
        for bad in [
            b"1 beginbfrange <00000000> <FFFFFFFF> <0041> endbfrange".as_slice(),
            b"1 beginbfrange <0004> <0001> <0041> endbfrange",
            b"1 beginbfrange <0001> <0004> [<0041>] endbfrange",
            b"/Identity-H usecmap",
        ] {
            assert!(parse_cmap(bad).is_none());
        }
    }

    #[test]
    fn rebuild_glued_operators_even_when_unicode_values_are_correct() {
        let mut doc = Document::with_version("1.4");
        let font = fixture_font(
            &mut doc,
            &[(1, vec!['多' as u16]), (2, vec!['大' as u16])],
            false,
        );
        let broken = b"/CMapType 2 def1 begincodespacerange <0000> <FFFF> endcodespacerange1 beginbfchar<0001><591A>endbfchar1 beginbfchar<0002><5927>endbfcharendcmap";
        let parsed = parse_cmap(broken).unwrap();
        assert!(parsed.malformed_syntax);
        assert_eq!(parsed.mappings[&1], vec!['多' as u16]);
        let cmap = doc.add_object(Stream::new(Dictionary::new(), broken.to_vec()));
        doc.get_object_mut(font)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("ToUnicode", cmap);
        let content = repair_font(&doc, doc.get_object(font).unwrap().as_dict().unwrap()).unwrap();
        let parsed = parse_cmap(&content).unwrap();
        assert!(!parsed.malformed_syntax);
        assert_eq!(parsed.mappings[&1], vec!['多' as u16]);
        assert_eq!(parsed.mappings[&2], vec!['大' as u16]);
    }
}
