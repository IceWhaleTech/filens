use std::{collections::BTreeMap, env, fs, path::Path};
use toml::Value;

fn main() {
    println!("cargo:rerun-if-changed=data/cameras.toml");
    println!("cargo:rerun-if-changed=data/nikon-d3s.toml");
    println!("cargo:rerun-if-changed=data/sigma.toml");
    println!("cargo:rustc-check-cfg=cfg(needs_chunks_exact)");
    let input = fs::read_to_string("data/cameras.toml").unwrap()
        + &fs::read_to_string("data/nikon-d3s.toml").unwrap()
        + &fs::read_to_string("data/sigma.toml").unwrap();
    let parsed: Value = input.parse().unwrap();
    let mut profiles = BTreeMap::new();
    let mut naked = BTreeMap::new();
    for camera in parsed["cameras"].as_array().unwrap() {
        let base = camera.as_table().unwrap();
        let mut names = vec![(base["model"].as_str().unwrap(), base["clean_model"].as_str().unwrap())];
        if let Some(aliases) = base.get("model_aliases") {
            for alias in aliases.as_array().unwrap() {
                names.push((alias[0].as_str().unwrap(), alias[1].as_str().unwrap()));
            }
        }
        let mut modes = vec![None];
        if let Some(overrides) = base.get("modes") {
            modes.extend(overrides.as_array().unwrap().iter().map(Some));
        }
        for (model, clean_model) in names {
            for overrides in &modes {
                let mut table = base.clone();
                table.remove("model_aliases");
                table.remove("modes");
                if let Some(overrides) = overrides {
                    table.extend(overrides.as_table().unwrap().clone());
                }
                table.insert("model".into(), Value::String(model.into()));
                table.insert("clean_model".into(), Value::String(clean_model.into()));
                let key = (table["make"].as_str().unwrap().to_string(), model.to_string(),
                    table.get("mode").and_then(Value::as_str).unwrap_or("").to_string());
                if let Some(size) = table.get("filesize").and_then(Value::as_integer).filter(|size| *size > 0) {
                    naked.insert(size, key.clone());
                }
                profiles.insert(key, table);
            }
        }
    }
    let mut generated = String::from("static CAMERA_PROFILES: &[(&str, &str, &str, &str)] = &[\n");
    for ((make, model, mode), table) in &profiles {
        let text = toml::to_string(table).unwrap();
        generated.push_str(&format!("({:?}, {:?}, {:?}, {:?}),\n", make, model, mode, text));
    }
    generated.push_str("];\nstatic NAKED_PROFILES: &[(usize, usize)] = &[\n");
    // Preserve upstream's last-profile-wins behavior for duplicate file sizes.
    let indices: BTreeMap<_, _> = profiles.keys().enumerate().map(|(index, key)| (key, index)).collect();
    for (size, key) in naked { generated.push_str(&format!("({}, {}),\n", size, indices[&key])); }
    generated.push_str("];\n");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("camera-profiles.rs"), generated).unwrap();
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("all.toml"), input).unwrap();
}
