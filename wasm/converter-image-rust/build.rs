use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    // At 16-bit linear precision, sRGB quantization differs from the exact
    // transfer function by at most one 8-bit output level, including shadows.
    let table: Vec<u8> = (0..=u16::MAX)
        .map(|index| {
            let value = f32::from(index) / f32::from(u16::MAX);
            let encoded = if value <= 0.0031308 {
                value * 12.92
            } else {
                1.055 * value.powf(1.0 / 2.4) - 0.055
            };
            (encoded * 255.0 + 0.5) as u8
        })
        .collect();
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("srgb-u16.bin"),
        table,
    )
    .unwrap();
}
