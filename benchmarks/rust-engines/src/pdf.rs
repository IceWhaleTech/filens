//! Experimental PDF core: built to WASI and executed in the benchmark host.
use hayro::hayro_interpret::{self as interpret, Context, Device, InterpreterCache};
use hayro::kurbo::{Affine, BezPath, Rect};
use hayro::{PixmapSettings, RenderCache, RenderSettings, hayro_syntax::Pdf};
use serde_json::json;
use std::{env, fs, time::Instant};

fn main() {
    if let Err(error) = run() {
        println!("{}", json!({"success": false, "error": error}));
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = env::args().collect();
    let input = args.get(1).ok_or("input required")?;
    let output = args.get(2).ok_or("output RGBA required")?;
    let page_index: usize = args
        .get(3)
        .map_or("0", String::as_str)
        .parse()
        .map_err(|_| "invalid page")?;
    let dpi: f32 = args
        .get(4)
        .map_or("96", String::as_str)
        .parse()
        .map_err(|_| "invalid DPI")?;
    let start = Instant::now();
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    let pdf = Pdf::new(bytes).map_err(|e| format!("{e:?}"))?;
    let page = pdf.pages().get(page_index).ok_or("page unavailable")?;
    let (width, height) = page.render_dimensions();
    let scale = dpi / 72.0;
    if width * height * scale * scale > 32_000_000.0 {
        return Err("pixel limit".into());
    }
    let parsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let render_start = Instant::now();
    let pixmap = hayro::render(
        page,
        &RenderCache::new(),
        &Default::default(),
        &RenderSettings::default(),
        &PixmapSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: hayro::vello_cpu::color::palette::css::WHITE,
        },
    );
    let render_ms = render_start.elapsed().as_secs_f64() * 1000.0;
    fs::write(output, pixmap.data_as_u8_slice()).map_err(|e| e.to_string())?;
    let cache = InterpreterCache::new();
    let mut context = Context::new(
        Affine::IDENTITY,
        Rect::new(-1e8, -1e8, 1e8, 1e8),
        &cache,
        page.xref(),
        Default::default(),
    );
    let mut text = TextDevice::default();
    interpret::interpret_page(page, &mut context, &mut text);
    println!(
        "{}",
        json!({"success": true, "pages": pdf.pages().len(), "width": pixmap.width(), "height": pixmap.height(), "parseMs": parsed_ms, "renderMs": render_ms, "text": text.text, "unmappedGlyphs": text.unmapped})
    );
    Ok(())
}

#[derive(Default)]
struct TextDevice {
    text: String,
    unmapped: usize,
}

impl<'a> Device<'a> for TextDevice {
    fn draw_path(&mut self, _: &BezPath, _: interpret::DrawProps<'a>, _: &interpret::DrawMode) {}
    fn push_clip_path(&mut self, _: &interpret::ClipPath) {}
    fn push_transparency_group(
        &mut self,
        _: f32,
        _: Option<interpret::SoftMask<'a>>,
        _: interpret::BlendMode,
    ) {
    }
    fn draw_glyph_run(
        &mut self,
        run: &interpret::font::GlyphRun<'_, 'a>,
        _: interpret::DrawProps<'a>,
        _: &interpret::DrawMode,
    ) {
        for glyph in run.glyphs() {
            match glyph.as_unicode() {
                Some(hayro_cmap::BfString::Char(c)) => self.text.push(c),
                Some(hayro_cmap::BfString::String(s)) => self.text.push_str(&s),
                None => self.unmapped += 1,
            }
        }
    }
    fn draw_image(&mut self, _: interpret::Image<'a, '_>, _: interpret::ImageDrawProps<'a>) {}
    fn pop_clip(&mut self) {}
    fn pop_transparency_group(&mut self) {}
}
