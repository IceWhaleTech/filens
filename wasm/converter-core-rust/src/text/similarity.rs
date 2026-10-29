//! Czkawka-style directory inspection. Parsing, hashing and grouping stay in WASM.
use super::*;
use raster_codec::{ImageDecoder, ImageReader};
use std::collections::BTreeMap;

const MAX_HASH_BYTES: u64 = 16 << 30;
const MAX_COMPARISONS: usize = 20_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    mode: String,
    threshold: u32,
    max_results: usize,
    format: String,
    files: Vec<Source>,
}
#[derive(Deserialize)]
struct Source {
    path: String,
    bytes: u64,
    #[serde(default)]
    identity: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Fingerprint {
    path: String,
    bytes: u64,
    width: u32,
    height: u32,
    hash: String,
    #[serde(skip)]
    bits: u64,
    #[serde(skip)]
    flat: bool,
    #[serde(skip)]
    color: [f64; 3],
}
#[derive(Default)]
struct Progress {
    errors: Vec<Value>,
    error_count: usize,
    hashed_bytes: u64,
    processed: usize,
    skipped_hard_links: usize,
    comparisons: usize,
    limited: bool,
}
impl Progress {
    fn error(&mut self, path: &str, message: impl ToString) {
        self.error_count += 1;
        if self.errors.len() < 64 {
            self.errors
                .push(json!({"path":path,"message":message.to_string()}));
        }
    }
}

fn open(source: &Source) -> Result<File, String> {
    let path = Path::new(&source.path);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
        || path.as_os_str().is_empty()
    {
        return Err("source must be a relative file path".into());
    }
    // Refuse symbolic links in every component, including links introduced
    // after directory discovery. WASI also confines resolution to /scan.
    let mut local = PathBuf::from("/scan");
    for component in path.components() {
        local.push(component);
        if fs::symlink_metadata(&local)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("symbolic links are excluded".into());
        }
    }
    let file = File::open(local).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() != source.bytes {
        return Err("source changed since directory discovery".into());
    }
    Ok(file)
}

fn hash(source: &Source, sample: bool, progress: &mut Progress) -> Result<String, String> {
    let mut file = open(source)?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    let cost = if sample {
        source.bytes.min(4096)
    } else {
        source.bytes
    };
    if progress.hashed_bytes.saturating_add(cost) > MAX_HASH_BYTES {
        progress.limited = true;
        return Err("16 GiB hashing budget reached; scan a smaller directory".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0; 65536];
    let mut remaining = cost;
    while remaining > 0 {
        let size = remaining.min(buffer.len() as u64) as usize;
        file.read_exact(&mut buffer[..size])
            .map_err(|e| e.to_string())?;
        digest.update(&buffer[..size]);
        remaining -= size as u64;
        progress.hashed_bytes += size as u64;
    }
    if !sample {
        let mut extra = [0];
        if file.read(&mut extra).map_err(|e| e.to_string())? != 0 {
            return Err("source grew while hashing".into());
        }
    }
    let after = file.metadata().map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("source changed while hashing".into());
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn duplicates(files: &[Source], progress: &mut Progress) -> Vec<Value> {
    let mut sizes: BTreeMap<u64, Vec<&Source>> = BTreeMap::new();
    for source in files {
        sizes.entry(source.bytes).or_default().push(source);
    }
    let mut groups = vec![];
    for candidates in sizes.values().filter(|v| v.len() > 1) {
        let mut samples: BTreeMap<String, Vec<&Source>> = BTreeMap::new();
        for source in candidates {
            match hash(source, true, progress) {
                Ok(value) => samples.entry(value).or_default().push(source),
                Err(error) => progress.error(&source.path, error),
            }
            if progress.limited {
                break;
            }
        }
        for candidates in samples.values().filter(|v| v.len() > 1) {
            let mut full: BTreeMap<String, Vec<Value>> = BTreeMap::new();
            for source in candidates {
                match hash(source, false, progress) {
                    Ok(value) => {
                        progress.processed += 1;
                        full.entry(value.clone())
                            .or_default()
                            .push(json!({"path":source.path,"bytes":source.bytes,"sha256":value}));
                    }
                    Err(error) => progress.error(&source.path, error),
                }
                if progress.limited {
                    break;
                }
            }
            for (sha256, files) in full.into_iter().filter(|(_, v)| v.len() > 1) {
                groups.push(json!({"kind":"duplicate","sha256":sha256,"files":files}));
            }
            if progress.limited {
                break;
            }
        }
        if progress.limited {
            break;
        }
    }
    groups
}

fn fingerprint(source: &Source) -> Result<Fingerprint, String> {
    if source.bytes > MAX_INPUT {
        return Err("image exceeds 256 MiB".into());
    }
    let file = open(source)?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    let mut reader = ImageReader::new(std::io::BufReader::new(file))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = raster_codec::Limits::default();
    limits.max_image_width = Some(32768);
    limits.max_image_height = Some(32768);
    limits.max_alloc = Some(192 << 20);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || width as u64 * height as u64 > 32_000_000 {
        return Err("image exceeds 32 million pixels".into());
    }
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut decoded =
        raster_codec::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    decoded.apply_orientation(orientation);
    let (width, height) = (decoded.width(), decoded.height());
    let small = decoded
        .resize_exact(32, 32, raster_codec::imageops::FilterType::Triangle)
        .to_rgba8();
    let after = fs::metadata(Path::new("/scan").join(&source.path)).map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("source changed while decoding".into());
    }
    let (bits, flat, color) = perceptual(&small);
    Ok(Fingerprint {
        path: source.path.clone(),
        bytes: source.bytes,
        width,
        height,
        hash: format!("{bits:016x}"),
        bits,
        flat,
        color,
    })
}

fn perceptual(small: &raster_codec::RgbaImage) -> (u64, bool, [f64; 3]) {
    let mut pixels = [0.0; 1024];
    let mut color = [0.0; 3];
    for (i, pixel) in small.pixels().enumerate() {
        let alpha = pixel[3] as f64 / 255.0;
        let rgb: [f64; 3] =
            std::array::from_fn(|c| pixel[c] as f64 * alpha + 255.0 * (1.0 - alpha));
        for c in 0..3 {
            color[c] += rgb[c] / 1024.0;
        }
        pixels[i] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    }
    let mean = pixels.iter().sum::<f64>() / 1024.0;
    let flat = pixels.iter().map(|p| (p - mean).powi(2)).sum::<f64>() / 1024.0 < 1.0;
    let cosine: [[f64; 32]; 8] = std::array::from_fn(|u| {
        std::array::from_fn(|x| ((2 * x + 1) as f64 * u as f64 * std::f64::consts::PI / 64.0).cos())
    });
    let mut horizontal = [[0.0; 8]; 32];
    for y in 0..32 {
        for u in 0..8 {
            horizontal[y][u] = (0..32).map(|x| pixels[y * 32 + x] * cosine[u][x]).sum();
        }
    }
    let mut coefficients = vec![];
    for v in 0..8 {
        for u in 0..8 {
            if u != 0 || v != 0 {
                coefficients.push(
                    (0..32)
                        .map(|y| horizontal[y][u] * cosine[v][y])
                        .sum::<f64>(),
                );
            }
        }
    }
    let mut sorted = coefficients.clone();
    sorted.sort_by(f64::total_cmp);
    let median = sorted[sorted.len() / 2];
    let mut bits = 0;
    for (i, value) in coefficients.into_iter().enumerate() {
        if value > median + 1e-7 {
            bits |= 1 << i;
        }
    }
    (bits, flat, color)
}

// A BK-tree bounds candidate lookup by Hamming distance. Equal hashes share a
// node so large duplicate collections do not make the tree a linked list.
struct Node {
    bits: u64,
    files: Vec<usize>,
    children: BTreeMap<u32, usize>,
}
fn tree(files: &[Fingerprint]) -> Vec<Node> {
    let mut nodes: Vec<Node> = vec![];
    for (index, file) in files.iter().enumerate() {
        if nodes.is_empty() {
            nodes.push(Node {
                bits: file.bits,
                files: vec![index],
                children: BTreeMap::new(),
            });
            continue;
        }
        let mut at = 0;
        loop {
            let distance = (nodes[at].bits ^ file.bits).count_ones();
            if distance == 0 {
                nodes[at].files.push(index);
                break;
            }
            if let Some(next) = nodes[at].children.get(&distance) {
                at = *next;
            } else {
                let next = nodes.len();
                nodes[at].children.insert(distance, next);
                nodes.push(Node {
                    bits: file.bits,
                    files: vec![index],
                    children: BTreeMap::new(),
                });
                break;
            }
        }
    }
    nodes
}
fn compatible(a: &Fingerprint, b: &Fingerprint) -> bool {
    if a.flat != b.flat {
        return false;
    }
    !a.flat || (0..3).all(|c| (a.color[c] - b.color[c]).abs() <= 8.0)
}
fn image_groups(files: &[Fingerprint], threshold: u32, progress: &mut Progress) -> Vec<Value> {
    let nodes = tree(files);
    let mut assigned = vec![false; files.len()];
    let mut groups = vec![];
    for (reference, image) in files.iter().enumerate() {
        if assigned[reference] {
            continue;
        }
        let mut stack = if nodes.is_empty() { vec![] } else { vec![0] };
        let mut matches = vec![];
        while let Some(at) = stack.pop() {
            progress.comparisons += 1;
            if progress.comparisons > MAX_COMPARISONS {
                progress.limited = true;
                break;
            }
            let node = &nodes[at];
            let distance = (image.bits ^ node.bits).count_ones();
            if distance <= threshold {
                matches.extend(
                    node.files
                        .iter()
                        .copied()
                        .filter(|i| !assigned[*i] && compatible(image, &files[*i])),
                );
            }
            stack.extend(
                node.children
                    .range(distance.saturating_sub(threshold)..=distance + threshold)
                    .map(|(_, next)| *next),
            );
        }
        if progress.limited {
            break;
        }
        if matches.len() < 2 {
            continue;
        }
        matches.sort_unstable();
        let members: Vec<_> = matches
            .into_iter()
            .map(|i| {
                assigned[i] = true;
                let mut value = serde_json::to_value(&files[i]).unwrap();
                value["distanceToReference"] = json!((image.bits ^ files[i].bits).count_ones());
                value
            })
            .collect();
        groups.push(json!({"kind":"similar-image","reference":image.path,"files":members}));
    }
    groups
}

fn render(groups: &[Value], format: &str) -> (String, String) {
    let mut text = String::new();
    for (i, group) in groups.iter().enumerate() {
        text.push_str(&format!(
            "Group {} ({})\n",
            i + 1,
            group["kind"].as_str().unwrap()
        ));
        for file in group["files"].as_array().unwrap() {
            let dimensions = file.get("width").map_or(String::new(), |w| {
                format!(
                    " {}x{} distance={}",
                    w, file["height"], file["distanceToReference"]
                )
            });
            text.push_str(&format!(
                "  {} ({} bytes){}\n",
                file["path"].as_str().unwrap(),
                file["bytes"],
                dimensions
            ));
        }
    }
    if text.is_empty() {
        text.push_str("No matching groups in the scanned scope.\n");
    }
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let rendered = match format {
        "html" => format!(
            "<!doctype html>\n<html><meta charset=\"utf-8\"><body><pre>{}</pre></body></html>\n",
            escape(&text)
        ),
        "markdown" => text.lines().map(|line| format!("    {line}\n")).collect(),
        "csv" | "tsv" => {
            let sep = if format == "csv" { "," } else { "\t" };
            let mut output = [
                "group",
                "kind",
                "path",
                "bytes",
                "width",
                "height",
                "distanceToReference",
                "sha256",
            ]
            .iter()
            .map(|s| format!("\"{s}\""))
            .collect::<Vec<_>>()
            .join(sep)
                + "\n";
            for (i, group) in groups.iter().enumerate() {
                for file in group["files"].as_array().unwrap() {
                    let row = [
                        json!(i + 1),
                        group["kind"].clone(),
                        file["path"].clone(),
                        file["bytes"].clone(),
                        file["width"].clone(),
                        file["height"].clone(),
                        file["distanceToReference"].clone(),
                        file["sha256"].clone(),
                    ];
                    output.push_str(
                        &row.iter()
                            .map(|v| {
                                let value = if v.is_null() {
                                    String::new()
                                } else if let Some(s) = v.as_str() {
                                    s.into()
                                } else {
                                    v.to_string()
                                };
                                format!("\"{}\"", value.replace('"', "\"\""))
                            })
                            .collect::<Vec<_>>()
                            .join(sep),
                    );
                    output.push('\n');
                }
            }
            output
        }
        _ => text.clone(),
    };
    (text, rendered)
}
fn evaluate(manifest: Manifest) -> Result<Value, String> {
    if !["duplicates", "images"].contains(&manifest.mode.as_str())
        || manifest.threshold > 24
        || !(1..=1000).contains(&manifest.max_results)
        || manifest.files.len() > 20000
    {
        return Err("invalid similarity mode, threshold, group limit or file count".into());
    }
    let mut progress = Progress::default();
    let mut identities = HashSet::new();
    let mut files: Vec<_> = manifest
        .files
        .into_iter()
        .filter(|source| {
            if source.identity.is_empty() || identities.insert(source.identity.clone()) {
                true
            } else {
                progress.skipped_hard_links += 1;
                false
            }
        })
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut groups = if manifest.mode == "duplicates" {
        duplicates(&files, &mut progress)
    } else {
        let mut images = vec![];
        for source in &files {
            match fingerprint(source) {
                Ok(image) => {
                    images.push(image);
                    progress.processed += 1;
                }
                Err(error) => progress.error(&source.path, error),
            }
        }
        image_groups(&images, manifest.threshold, &mut progress)
    };
    groups.sort_by(|a, b| {
        a["files"][0]["path"]
            .as_str()
            .cmp(&b["files"][0]["path"].as_str())
    });
    let matched_groups = groups.len();
    let matched_files: usize = groups
        .iter()
        .map(|g| g["files"].as_array().unwrap().len())
        .sum();
    let truncated = matched_groups > manifest.max_results || progress.limited;
    groups.truncate(manifest.max_results);
    let complete = progress.error_count == 0 && !truncated;
    let (text, rendered) = render(&groups, &manifest.format);
    Ok(json!({
        "similarity":{"version":"filens-similarity-v1","mode":manifest.mode,"method":if manifest.mode == "duplicates" {"size-prefix-sha256"} else {"phash-dct-63"},
            "requiresModel":false,"threshold":if manifest.mode == "images" {Some(manifest.threshold)} else {None},"grouping":"reference","complete":complete,"truncated":truncated,
            "matchedGroups":matched_groups,"matchedFiles":matched_files,"returnedGroups":groups.len(),"groups":groups,
            "processing":{"fullHashedFiles":if manifest.mode == "duplicates" {progress.processed} else {0},"decodedImages":if manifest.mode == "images" {progress.processed} else {0},
                "hashedBytes":progress.hashed_bytes,"comparisons":progress.comparisons,"skippedHardLinks":progress.skipped_hard_links,"errorCount":progress.error_count,"errors":progress.errors,"budgetReached":progress.limited}},
        "content":{"text":text,"rendered":rendered,"complete":complete,"truncated":truncated,"warnings":[]}
    }))
}
pub(super) fn execute(request: &Request, started: Instant) {
    let result = (|| {
        let mut bytes = vec![];
        File::open(&request.input)
            .map_err(|e| e.to_string())?
            .take((16 << 20) + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 16 << 20 {
            return Err("similarity manifest exceeds 16 MiB".into());
        }
        evaluate(serde_json::from_slice(&bytes).map_err(|e| e.to_string())?)
    })();
    let wire = match result {
        Ok(payload) => ResultContract {
            ok: true,
            backend: "wasm-similarity".into(),
            payload: Some(payload),
            ..Default::default()
        },
        Err(message) => ResultContract {
            error_code: "invalid_similarity".into(),
            error_message: message,
            ..Default::default()
        },
    };
    if let Err(error) = write_result(&request.result, wire, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn image(path: &str, bits: u64) -> Fingerprint {
        Fingerprint {
            path: path.into(),
            bytes: 1,
            width: 32,
            height: 32,
            hash: format!("{bits:016x}"),
            bits,
            flat: false,
            color: [0.0; 3],
        }
    }
    #[test]
    fn groups_are_direct_matches_without_transitive_chaining() {
        let files = vec![image("a", 0), image("b", 3), image("c", 15)];
        let groups = image_groups(&files, 2, &mut Progress::default());
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0]["files"].as_array().unwrap().len(), 2);
        assert_eq!(groups[0]["files"][1]["path"], "b");
    }
    #[test]
    fn bk_tree_matches_exhaustive_reference_groups() {
        let mut seed = 123456789u64;
        let mut files = vec![];
        for i in 0..200 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            files.push(image(&format!("{i}"), seed));
            files.push(image(&format!("{i}-copy"), seed ^ 7));
        }
        let groups = image_groups(&files, 4, &mut Progress::default());
        assert_eq!(groups.len(), 200);
        assert!(
            groups
                .iter()
                .all(|g| g["files"].as_array().unwrap().len() == 2)
        );
    }
    #[test]
    fn flat_images_of_different_colors_are_not_grouped() {
        let mut black = image("black", 0);
        black.flat = true;
        let mut white = image("white", 0);
        white.flat = true;
        white.color = [255.0; 3];
        assert!(image_groups(&[black, white], 8, &mut Progress::default()).is_empty());
    }
    #[test]
    fn resized_and_reencoded_images_keep_close_fingerprints() {
        use raster_codec::{DynamicImage, ImageBuffer, ImageFormat, Rgb};
        let original = DynamicImage::ImageRgb8(ImageBuffer::from_fn(256, 192, |x, y| {
            if (52..154).contains(&x) && (58..154).contains(&y) {
                Rgb([200, 60, 40])
            } else {
                Rgb([(x * 140 / 256) as u8, (y * 180 / 192) as u8, 100])
            }
        }));
        let bits = |image: DynamicImage| {
            perceptual(
                &image
                    .resize_exact(32, 32, raster_codec::imageops::FilterType::Triangle)
                    .to_rgba8(),
            )
            .0
        };
        let expected = bits(original.clone());
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::WebP,
            ImageFormat::Gif,
            ImageFormat::Bmp,
            ImageFormat::Tiff,
        ] {
            let mut encoded = std::io::Cursor::new(vec![]);
            original
                .resize_exact(64, 48, raster_codec::imageops::FilterType::Triangle)
                .write_to(&mut encoded, format)
                .unwrap();
            let decoded = raster_codec::load_from_memory(encoded.get_ref()).unwrap();
            let distance = (expected ^ bits(decoded)).count_ones();
            // Palette quantization is a larger change than JPEG/lossless
            // re-encoding. Exercise the documented adjustable threshold.
            let threshold = if format == ImageFormat::Gif { 12 } else { 8 };
            assert!(distance <= threshold, "{format:?} distance={distance}");
        }
    }
}
