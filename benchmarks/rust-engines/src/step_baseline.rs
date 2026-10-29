//! Original benchmark baseline. Keep independent of compatibility fixes.
use serde_json::json;
use std::{env, fs, time::Instant};
use truck_assembly::assy::*;
use truck_meshalgo::prelude::*;
use truck_stepio::r#in::{convert::*, *};

fn main() {
    if let Err(error) = run() {
        println!("{}", json!({"success": false, "error": error}));
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = env::args().collect();
    let source =
        fs::read_to_string(args.get(1).ok_or("input required")?).map_err(|e| e.to_string())?;
    let tolerance: f64 = args
        .get(3)
        .map_or("0.1", String::as_str)
        .parse()
        .map_err(|_| "invalid tolerance")?;
    let start = Instant::now();
    let table = Table::from_step(&source).ok_or("STEP parse failed")?;
    let assy = table.step_assy().map_err(|e| format!("{e:?}"))?;
    let parsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let meshing_start = Instant::now();
    let node_map = |ProductEntity { shape, attrs }: &ProductEntity| {
        let shape = shape
            .iter()
            .filter_map(|shape| {
                let shells = match shape {
                    ProductShape::Solid(solid) => &solid.boundaries,
                    ProductShape::Shells(shells) => shells,
                    _ => return None,
                };
                Some(
                    shells
                        .iter()
                        .map(|shell| shell.robust_triangulation(tolerance))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>();
        NodeEntity {
            shape,
            attrs: attrs.clone(),
        }
    };
    let edge_map = |EdgeEntity { matrix, .. }: &AssembleEntity| EdgeEntity {
        matrix: Matrix4::try_from(matrix).unwrap(),
        attrs: (),
    };
    let meshed = assy.par_map(node_map, edge_map);
    let mut positions: Vec<[f64; 3]> = Vec::new();
    let mut normals: Vec<[f64; 3]> = Vec::new();
    let mut instances = 0usize;
    let mut missing_faces = 0usize;
    let mut faces = 0usize;
    let source_face_references: usize = table.shell.values().map(|s| s.cfs_faces.len()).sum();
    for top in meshed.top_nodes() {
        for path in meshed.paths_iter(top.index()) {
            let matrix = path.matrix();
            for shell in path.terminal_node().shape().iter().flatten() {
                instances += 1;
                missing_faces += shell.faces.iter().filter(|f| f.surface.is_none()).count();
                faces += shell.faces.len();
                let mut poly = shell.to_polygon();
                poly.transform_by(matrix);
                append_mesh(&poly, &mut positions, &mut normals);
            }
        }
    }
    // The released truck example imports shells directly. Retain that route
    // when the assembly API resolves no geometry; mark it in the result so
    // flattening cannot be mistaken for correct assembly handling.
    let shell_fallback = instances == 0;
    if shell_fallback {
        let mut shells = table.shell.iter().collect::<Vec<_>>();
        shells.sort_by_key(|(index, _)| **index);
        for (_, shell) in shells {
            let shell = table
                .to_compressed_shell(shell)
                .map_err(|e| format!("{e:?}"))?;
            let shell = shell.robust_triangulation(tolerance);
            instances += 1;
            missing_faces += shell.faces.iter().filter(|f| f.surface.is_none()).count();
            faces += shell.faces.len();
            append_mesh(&shell.to_polygon(), &mut positions, &mut normals);
        }
    }
    let meshing_ms = meshing_start.elapsed().as_secs_f64() * 1000.0;
    let geometry = json!({"positions": positions, "normals": normals});
    fs::write(
        args.get(2).ok_or("output required")?,
        serde_json::to_vec(&geometry).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{}",
        json!({"success": !positions.is_empty(), "instances": instances, "shellFallback": shell_fallback, "sourceFaceReferences": source_face_references, "faces": faces, "missingFaces": missing_faces, "triangles": positions.len()/3, "parseMs": parsed_ms, "meshMs": meshing_ms})
    );
    Ok(())
}

fn append_mesh(poly: &PolygonMesh, positions: &mut Vec<[f64; 3]>, normals: &mut Vec<[f64; 3]>) {
    for tri in poly.faces().triangle_iter() {
        let pts = tri.map(|v| poly.positions()[v.pos]);
        let normal = (pts[1] - pts[0]).cross(pts[2] - pts[0]);
        let normal = if normal.magnitude2() > 0.0 {
            normal.normalize()
        } else {
            Vector3::new(0.0, 0.0, 0.0)
        };
        for (point, vertex) in pts.into_iter().zip(tri) {
            positions.push(point.into());
            normals.push(
                vertex
                    .nor
                    .and_then(|index| poly.normals().as_slice().get(index))
                    .copied()
                    .unwrap_or(normal)
                    .into(),
            );
        }
    }
}
