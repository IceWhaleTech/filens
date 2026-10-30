//! Frontend STEP core, following truck's step-to-mesh example.
use serde_json::json;
use std::{env, fs, time::Instant};
use truck_assembly::assy::*;
use truck_meshalgo::prelude::*;
use truck_stepio::r#in::{convert::*, *};
use truck_topology::compress::CompressedShell;

mod step_prepare;
mod step_units;
type InputShell = CompressedShell<Point3, step_geometry::Curve3D, step_geometry::Surface>;
type MeshShell = CompressedShell<Point3, PolylineCurve<Point3>, Option<PolygonMesh>>;

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
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err("tolerance must be positive and finite".into());
    }
    let start = Instant::now();
    let trace = args.iter().any(|arg| arg == "--trace");
    let reviewed = args.iter().any(|arg| arg == "--reviewed");
    let (table, preparation) = step_prepare::prepare(
        &source,
        args.iter().any(|arg| arg == "--prefer-3d"),
        reviewed,
    )?;
    let unit_scale = preparation["millimetresPerUnit"].as_f64().unwrap_or(1.0);
    let tolerance = tolerance / unit_scale;
    if trace {
        eprintln!("prepared: {preparation}");
    }
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
                        .map(|shell| mesh_shell(shell, tolerance, trace))
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
                missing_faces += unmeshed_faces(shell);
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
            let shell = mesh_shell(&shell, tolerance, trace);
            instances += 1;
            missing_faces += unmeshed_faces(&shell);
            faces += shell.faces.len();
            append_mesh(&shell.to_polygon(), &mut positions, &mut normals);
        }
    }
    let meshing_ms = meshing_start.elapsed().as_secs_f64() * 1000.0;
    for position in &mut positions {
        for value in position {
            *value *= unit_scale;
            if !value.is_finite() {
                return Err("nonfinite STEP mesh coordinate".into());
            }
        }
    }
    let geometry = json!({"positions": positions, "normals": normals});
    fs::write(
        args.get(2).ok_or("output required")?,
        serde_json::to_vec(&geometry).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{}",
        json!({"success": !positions.is_empty(), "instances": instances, "shellFallback": shell_fallback, "sourceFaceReferences": source_face_references, "faces": faces, "missingFaces": missing_faces, "triangles": positions.len()/3, "parseMs": parsed_ms, "meshMs": meshing_ms, "preparation": preparation})
    );
    Ok(())
}

fn mesh_shell(shell: &InputShell, tolerance: f64, trace: bool) -> MeshShell {
    if trace {
        eprintln!(
            "shell: {} edges, {} faces",
            shell.edges.len(),
            shell.faces.len()
        );
        for (index, edge) in shell.edges.iter().enumerate() {
            eprintln!("edge {index}: start");
            let curve = &edge.curve;
            let range = curve.range_tuple();
            eprintln!(
                "edge {index}: range {range:?}, samples {:?}",
                [0.0, 0.25, 0.5, 0.75, 1.0].map(|t| curve.subs(range.0 * (1.0 - t) + range.1 * t))
            );
            let poly = PolylineCurve::from_curve(curve, curve.range_tuple(), tolerance);
            eprintln!("edge {index}: {} samples", poly.len());
        }
        for (index, face) in shell.faces.iter().enumerate() {
            eprintln!("face {index}: start");
            let mut single = shell.clone();
            single.faces = vec![face.clone()];
            let mesh = single.robust_triangulation(tolerance);
            eprintln!(
                "face {index}: {} triangles",
                mesh.to_polygon().faces().triangle_iter().count()
            );
        }
    }
    shell.robust_triangulation(tolerance)
}

fn unmeshed_faces(shell: &MeshShell) -> usize {
    shell
        .faces
        .iter()
        .filter(|f| {
            f.surface
                .as_ref()
                .is_none_or(|mesh| mesh.faces().triangle_iter().next().is_none())
        })
        .count()
}

fn append_mesh(poly: &PolygonMesh, positions: &mut Vec<[f64; 3]>, normals: &mut Vec<[f64; 3]>) {
    for tri in poly.faces().triangle_iter() {
        let pts = tri.map(|v| poly.positions()[v.pos]);
        let normal = (pts[1] - pts[0]).cross(pts[2] - pts[0]);
        let length2 = normal.magnitude2();
        let normal = if length2.is_finite() && length2 > 0.0 {
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
                    .filter(|normal| {
                        normal.x.is_finite()
                            && normal.y.is_finite()
                            && normal.z.is_finite()
                            && normal.magnitude2() > 0.0
                    })
                    .unwrap_or(normal)
                    .into(),
            );
        }
    }
}
