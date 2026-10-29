fn main() {
    println!("cargo:rerun-if-changed=src/fts.c");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/fts.c").compile("filens_fts");
    }
}
