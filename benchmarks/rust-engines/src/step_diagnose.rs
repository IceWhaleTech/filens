//! Per-face diagnostics using the same STEP preparation and tessellator as WASM.
use serde_json::json;
use std::{env, fs};
use truck_meshalgo::prelude::*;
use truck_stepio::r#in::{ruststep::tables::PlaceHolder, *};

mod step_prepare;
mod step_units;

fn main() {
    let args: Vec<_> = env::args().collect();
    let source = fs::read_to_string(&args[1]).unwrap();
    let (table, preparation) = step_prepare::prepare(&source, false, true).unwrap();
    let scale = preparation["millimetresPerUnit"].as_f64().unwrap();
    let tolerance = args.get(3).map_or("0.1", String::as_str).parse::<f64>().unwrap() / scale;
    let mut shells: Vec<_> = table.shell.iter().collect();
    shells.sort_by_key(|(id, _)| **id);
    let mut results = Vec::new();
    for (id, holder) in shells {
        let shell = table.to_compressed_shell(holder).unwrap();
        let mesh = shell.robust_triangulation(tolerance);
        let faces: Vec<_> = mesh.faces.iter().enumerate().map(|(index, face)| {
            let mut polygon = face.surface.clone().unwrap_or_default();
            if !face.orientation { polygon.invert(); }
            let positions: Vec<[f64; 3]> = polygon.faces().triangle_iter().flat_map(|tri| {
                tri.map(|v| { let p = polygon.positions()[v.pos]; [p.x * scale, p.y * scale, p.z * scale] })
            }).collect();
            let source_id = match &holder.cfs_faces[index] {
                PlaceHolder::Ref(ruststep::ast::Name::Entity(id)) => Some(*id),
                _ => None,
            };
            json!({"index": index, "sourceId": source_id, "surface": shell.faces[index].surface,
                "positions": positions, "orientation": face.orientation, "boundaries": face.boundaries})
        }).collect();
        let edges: Vec<_> = shell.edges.iter().map(|edge| {
            let range = edge.curve.range_tuple();
            let samples: Vec<[f64; 3]> = [range.0, (range.0+range.1)/2.0, range.1].into_iter().map(|t| {
                let p = edge.curve.subs(t); [p.x * scale, p.y * scale, p.z * scale]
            }).collect();
            json!({"vertices": edge.vertices, "samples": samples, "curve": edge.curve})
        }).collect();
        results.push(json!({"sourceId": id, "faces": faces, "edges": edges}));
    }
    fs::write(&args[2], serde_json::to_vec(&json!({"preparation": preparation, "shells": results})).unwrap()).unwrap();
}
