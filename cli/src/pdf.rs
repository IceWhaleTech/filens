//! Thin bindings to the pinned PDFium WASM C API. Page selection, Unicode
//! recovery, coordinate transforms and OCR policy belong to converter-text.
use anyhow::{Result, bail, ensure};
use serde_json::{Value, json};
use std::{fs::File, path::Path};
use wasmi::{
    Caller, Engine, ExternType, Instance, Linker, Memory, Module, Store, StoreLimits, Val,
};
use wasmi_wasi::{WasiCtx, WasiCtxBuilder};

struct State {
    wasi: WasiCtx,
    limits: StoreLimits,
}
pub struct Pdf {
    store: Store<State>,
    instance: Instance,
    memory: Memory,
    document: i32,
    data: i32,
}

impl Pdf {
    pub fn new(path: &Path) -> Result<Self> {
        let engine = Engine::default();
        let module = Module::new(&engine, &crate::runtime::read_wasm(path)?[..])?;
        let mut store = Store::new(
            &engine,
            State {
                wasi: WasiCtxBuilder::new().build(),
                limits: crate::runtime::limits(),
            },
        );
        store.limiter(|s| &mut s.limits);
        let mut linker = Linker::<State>::new(&engine);
        wasmi_wasi::add_to_linker(&mut linker, |s| &mut s.wasi)?;
        for import in module.imports().filter(|i| i.module() == "env") {
            let ExternType::Func(ty) = import.ty() else {
                bail!("unsupported PDFium import");
            };
            let name = import.name().to_owned();
            // In-memory loading uses no file/form callbacks. Unused callbacks
            // trap explicitly rather than pretending a capability succeeded.
            linker.func_new(
                "env",
                import.name(),
                ty.clone(),
                move |mut caller: Caller<'_, State>, params, results| match name.as_str() {
                    "emscripten_notify_memory_growth" => Ok(()),
                    "_emscripten_throw_longjmp" => {
                        Err(wasmi::Error::new("_emscripten_throw_longjmp"))
                    }
                    n if n.starts_with("invoke_") => {
                        let index = params[0].i32().unwrap() as u32;
                        let table = caller
                            .get_export("__indirect_function_table")
                            .and_then(|t| t.into_table())
                            .ok_or_else(|| wasmi::Error::new("missing PDFium function table"))?;
                        let function = table
                            .get(&caller, index.into())
                            .and_then(|v| v.funcref().and_then(|r| r.func()).copied())
                            .ok_or_else(|| wasmi::Error::new("invalid PDFium function pointer"))?;
                        let save = caller
                            .get_export("emscripten_stack_get_current")
                            .and_then(|f| f.into_func())
                            .unwrap();
                        let mut stack = [Val::I32(0)];
                        save.call(&mut caller, &[], &mut stack)?;
                        match function.call(&mut caller, &params[1..], results) {
                            Err(e) if e.to_string() == "_emscripten_throw_longjmp" => {
                                let restore = caller
                                    .get_export("_emscripten_stack_restore")
                                    .and_then(|f| f.into_func())
                                    .unwrap();
                                restore.call(&mut caller, &stack, &mut [])?;
                                let threw = caller
                                    .get_export("setThrew")
                                    .and_then(|f| f.into_func())
                                    .unwrap();
                                threw.call(&mut caller, &[Val::I32(1), Val::I32(0)], &mut [])?;
                                Ok(())
                            }
                            result => result,
                        }
                    }
                    _ => Err(wasmi::Error::new(format!(
                        "unsupported PDFium callback {name}"
                    ))),
                },
            )?;
        }
        let instance = linker.instantiate(&mut store, &module)?.start(&mut store)?;
        let memory = instance
            .get_memory(&store, "memory")
            .ok_or_else(|| anyhow::anyhow!("missing PDFium memory"))?;
        let mut pdf = Self {
            store,
            instance,
            memory,
            document: 0,
            data: 0,
        };
        pdf.call_raw("_initialize", &[])?;
        pdf.call_raw("FPDF_InitLibrary", &[])?;
        Ok(pdf)
    }
    fn call_raw(&mut self, name: &str, args: &[Val]) -> Result<Vec<Val>> {
        let f = self
            .instance
            .get_func(&self.store, name)
            .ok_or_else(|| anyhow::anyhow!("missing PDFium export {name}"))?;
        let mut output: Vec<_> = f
            .ty(&self.store)
            .results()
            .iter()
            .map(|t| Val::default(*t))
            .collect();
        f.call(&mut self.store, args, &mut output)?;
        Ok(output)
    }
    fn ints(&mut self, name: &str, args: &[i32]) -> Result<i32> {
        Ok(self
            .call_raw(
                name,
                &args.iter().copied().map(Val::I32).collect::<Vec<_>>(),
            )?
            .first()
            .and_then(Val::i32)
            .unwrap_or(0))
    }
    fn double(&mut self, name: &str, args: &[i32]) -> Result<f64> {
        Ok(self.call_raw(
            name,
            &args.iter().copied().map(Val::I32).collect::<Vec<_>>(),
        )?[0]
            .f64()
            .unwrap()
            .into())
    }
    fn alloc(&mut self, n: usize) -> Result<i32> {
        ensure!(n <= 256 << 20, "PDFium allocation exceeds limit");
        let ptr = self.ints("malloc", &[n as i32])?;
        ensure!(ptr != 0, "PDFium allocation failed");
        Ok(ptr)
    }
    fn read(&self, ptr: i32, n: usize) -> Result<Vec<u8>> {
        let mut data = vec![0; n];
        self.memory
            .read(&self.store, ptr as u32 as usize, &mut data)?;
        Ok(data)
    }
    fn f64_at(&self, ptr: i32) -> Result<f64> {
        Ok(f64::from_le_bytes(self.read(ptr, 8)?.try_into().unwrap()))
    }
    fn i32_at(&self, ptr: i32) -> Result<i32> {
        Ok(i32::from_le_bytes(self.read(ptr, 4)?.try_into().unwrap()))
    }
    fn utf16(&self, ptr: i32, count: usize) -> Result<String> {
        let bytes = self.read(ptr, count * 2)?;
        let words: Vec<_> = bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .take_while(|c| *c != 0)
            .collect();
        Ok(String::from_utf16_lossy(&words))
    }
    pub fn call(&mut self, op: &str, path: Option<&Path>, index: i32, dpi: i32) -> Result<Value> {
        if op == "pdf_open" {
            self.close_document();
            let data = std::fs::read(path.ok_or_else(|| anyhow::anyhow!("PDF path required"))?)?;
            self.data = self.alloc(data.len())?;
            self.memory
                .write(&mut self.store, self.data as usize, &data)?;
            self.document =
                self.ints("FPDF_LoadMemDocument64", &[self.data, data.len() as i32, 0])?;
            if self.document == 0 {
                let code = self.ints("FPDF_GetLastError", &[])?;
                bail!(
                    "{}: PDFium error {code}",
                    if code == 4 {
                        "password_required"
                    } else {
                        "parse_error"
                    }
                );
            }
            return Ok(json!({"pages":self.ints("FPDF_GetPageCount", &[self.document])?}));
        }
        ensure!(self.document != 0, "PDF is not open");
        let page = self.ints("FPDF_LoadPage", &[self.document, index])?;
        ensure!(page != 0, "PDF page unavailable");
        let result = self.page(op, page, path, dpi);
        let closed = self.ints("FPDF_ClosePage", &[page]);
        let value = result?;
        closed?;
        Ok(value)
    }
    fn page(&mut self, op: &str, page: i32, path: Option<&Path>, dpi: i32) -> Result<Value> {
        let width = self.double("FPDF_GetPageWidth", &[page])?;
        let height = self.double("FPDF_GetPageHeight", &[page])?;
        ensure!(
            width.is_finite()
                && height.is_finite()
                && width > 0.0
                && height > 0.0
                && width <= 1e6
                && height <= 1e6,
            "invalid PDF page geometry"
        );
        if op == "pdf_render" {
            return self.render(page, path.unwrap(), dpi, width, height);
        }
        let text_page = self.ints("FPDFText_LoadPage", &[page])?;
        ensure!(text_page != 0, "PDF text page unavailable");
        let result = (|| -> Result<Value> {
            let count = self.ints("FPDFText_CountChars", &[text_page])?;
            ensure!((0..=16_000_000).contains(&count), "PDF text exceeds limit");
            if op == "pdf_text" {
                let mut text = String::new();
                for i in 0..count {
                    let c = self.ints("FPDFText_GetUnicode", &[text_page, i])? as u32;
                    if c != 0 {
                        text.push(char::from_u32(c).unwrap_or('\u{fffd}'));
                    }
                }
                return Ok(json!({"text":text}));
            }
            self.layout(page, text_page, count, width, height)
        })();
        let close = self.ints("FPDFText_ClosePage", &[text_page]);
        let value = result?;
        close?;
        Ok(value)
    }
    fn layout(
        &mut self,
        page: i32,
        text: i32,
        count: i32,
        width: f64,
        height: f64,
    ) -> Result<Value> {
        let scratch = self.alloc(40)?;
        let buffer_len = (count as usize + 1) * 2;
        let buffer = self.alloc(buffer_len)?;
        let result = (|| -> Result<Value> {
            let mut basis = vec![];
            for (x, y) in [(0.0, 0.0), (1000.0, 0.0), (0.0, 1000.0)] {
                self.call_raw(
                    "FPDF_PageToDevice",
                    &[
                        Val::I32(page),
                        Val::I32(0),
                        Val::I32(0),
                        Val::I32((width * 100.0).ceil() as i32),
                        Val::I32((height * 100.0).ceil() as i32),
                        Val::I32(0),
                        Val::F64(x.into()),
                        Val::F64(y.into()),
                        Val::I32(scratch),
                        Val::I32(scratch + 4),
                    ],
                )?;
                basis.push(
                    json!({"DeviceX":self.i32_at(scratch)?,"DeviceY":self.i32_at(scratch+4)?}),
                );
            }
            let n = self.ints("FPDFText_CountRects", &[text, 0, count])?;
            ensure!(
                (0..=20000).contains(&n),
                "PDF layout exceeds rectangle limit"
            );
            let mut rects = vec![];
            for i in 0..n {
                self.ints(
                    "FPDFText_GetRect",
                    &[text, i, scratch, scratch + 8, scratch + 16, scratch + 24],
                )?;
                let (left, top, right, bottom) = (
                    self.f64_at(scratch)?,
                    self.f64_at(scratch + 8)?,
                    self.f64_at(scratch + 16)?,
                    self.f64_at(scratch + 24)?,
                );
                let written = self.call_raw(
                    "FPDFText_GetBoundedText",
                    &[
                        Val::I32(text),
                        Val::F64(left.into()),
                        Val::F64(top.into()),
                        Val::F64(right.into()),
                        Val::F64(bottom.into()),
                        Val::I32(buffer),
                        Val::I32(count + 1),
                    ],
                )?[0]
                    .i32()
                    .unwrap();
                ensure!(
                    (0..=count + 1).contains(&written),
                    "invalid PDF text length"
                );
                let content = self.utf16(buffer, written as usize)?;
                let char_index = self.call_raw(
                    "FPDFText_GetCharIndexAtPos",
                    &[
                        Val::I32(text),
                        Val::F64(left.into()),
                        Val::F64(top.into()),
                        Val::F64(5.0.into()),
                        Val::F64(5.0.into()),
                    ],
                )?[0]
                    .i32()
                    .unwrap();
                let size = self.double("FPDFText_GetFontSize", &[text, char_index])?;
                let name_len = self.ints(
                    "FPDFText_GetFontInfo",
                    &[text, char_index, 0, 0, scratch + 32],
                )?;
                let mut font_name = String::new();
                if (1..=65536).contains(&name_len) {
                    let name = self.alloc(name_len as usize)?;
                    let read = (|| -> Result<String> {
                        self.ints(
                            "FPDFText_GetFontInfo",
                            &[text, char_index, name, name_len, scratch + 32],
                        )?;
                        Ok(
                            String::from_utf8_lossy(&self.read(name, name_len as usize)?)
                                .trim_end_matches('\0')
                                .into(),
                        )
                    })();
                    self.ints("free", &[name])?;
                    font_name = read?;
                }
                rects.push(json!({"Text":content,"PointPosition":{"Left":left,"Top":top,"Right":right,"Bottom":bottom},"FontInformation":{"Size":size,"Name":font_name,"Flags":self.i32_at(scratch+32)?}}));
            }
            Ok(
                json!({"width":width,"height":height,"deviceBasis":basis,"structured":{"Rects":rects}}),
            )
        })();
        let _ = self.ints("free", &[buffer]);
        let _ = self.ints("free", &[scratch]);
        result
    }
    fn render(
        &mut self,
        page: i32,
        path: &Path,
        dpi: i32,
        width: f64,
        height: f64,
    ) -> Result<Value> {
        ensure!((1..=300).contains(&dpi), "invalid PDF render DPI");
        let (w, h) = (
            (width * dpi as f64 / 72.0).ceil() as i32,
            (height * dpi as f64 / 72.0).ceil() as i32,
        );
        ensure!(
            w > 0 && h > 0 && (w as u64) * (h as u64) <= 32_000_000,
            "PDF render exceeds pixel limit"
        );
        let bitmap = self.ints("FPDFBitmap_Create", &[w, h, 0])?;
        ensure!(bitmap != 0, "PDF bitmap allocation failed");
        let result = (|| -> Result<Value> {
            self.ints("FPDFBitmap_FillRect", &[bitmap, 0, 0, w, h, -1])?;
            self.ints("FPDF_RenderPageBitmap", &[bitmap, page, 0, 0, w, h, 0, 1])?;
            let ptr = self.ints("FPDFBitmap_GetBuffer", &[bitmap])?;
            let stride = self.ints("FPDFBitmap_GetStride", &[bitmap])?;
            ensure!(
                stride >= w * 4 && stride <= w * 4 + 1024,
                "invalid PDF bitmap stride"
            );
            let bgra = self.read(ptr, stride as usize * h as usize)?;
            let mut rgb = Vec::with_capacity(w as usize * h as usize * 3);
            for row in bgra.chunks_exact(stride as usize) {
                for pixel in row[..w as usize * 4].chunks_exact(4) {
                    rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
                }
            }
            let mut encoder = png::Encoder::new(File::create(path)?, w as u32, h as u32);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::Fastest);
            let mut writer = encoder.write_header()?;
            writer.write_image_data(&rgb)?;
            writer.finish()?;
            Ok(json!({"ok":true}))
        })();
        let closed = self.ints("FPDFBitmap_Destroy", &[bitmap]);
        let value = result?;
        closed?;
        Ok(value)
    }
    fn close_document(&mut self) {
        if self.document != 0 {
            let _ = self.ints("FPDF_CloseDocument", &[self.document]);
            self.document = 0;
        }
        if self.data != 0 {
            let _ = self.ints("free", &[self.data]);
            self.data = 0;
        }
    }
}
impl Drop for Pdf {
    fn drop(&mut self) {
        self.close_document();
        let _ = self.call_raw("FPDF_DestroyLibrary", &[]);
    }
}
