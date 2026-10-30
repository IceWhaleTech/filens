//! STEP semantic preparation inside the experimental WASM core.
use ruststep::{
    ast::{EntityInstance, Name, Parameter},
    tables::{IntoOwned, PlaceHolder},
};
use std::collections::{BTreeMap, BTreeSet};
use truck_stepio::r#in::{
    step_geometry::{InnerSpace, Vector3},
    *,
};

pub fn prepare(
    source: &str,
    prefer_3d: bool,
    reviewed: bool,
) -> Result<(Table, serde_json::Value), String> {
    let mut exchange =
        ruststep::parser::parse(source).map_err(|e| format!("STEP parse failed: {e}"))?;
    let unit_scale = if reviewed {
        crate::step_units::millimetres_per_unit(&exchange)?
    } else {
        1.0
    };
    let repaired_curves = analytic_recoveries(
        &exchange
            .data
            .iter()
            .flat_map(|d| &d.entities)
            .collect::<Vec<_>>(),
    );
    let mut annotation_ids = BTreeSet::new();
    let mut wire_ids = BTreeSet::new();
    let mut preferred_3d = 0;
    let mut omitted_descriptions = 0;
    for entity in exchange.data.iter_mut().flat_map(|d| &mut d.entities) {
        let (id, names) = match entity {
            EntityInstance::Simple { id, record } => {
                if reviewed {
                    let description = match record.name.as_str() {
                        "PRODUCT" | "NEXT_ASSEMBLY_USAGE_OCCURRENCE" => Some(2),
                        "PRODUCT_DEFINITION"
                        | "PRODUCT_DEFINITION_SHAPE"
                        | "PRODUCT_DEFINITION_FORMATION"
                        | "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE"
                        | "ITEM_DEFINED_TRANSFORMATION"
                        | "SHAPE_REPRESENTATION_RELATIONSHIP" => Some(1),
                        _ => None,
                    };
                    if let (Some(index), Parameter::List(p)) = (description, &mut record.parameter)
                    {
                        if matches!(p.get(index), Some(Parameter::NotProvided)) {
                            p[index] = Parameter::String(String::new());
                            omitted_descriptions += 1;
                        }
                    }
                }
                if (prefer_3d || repaired_curves.contains(id))
                    && matches!(record.name.as_str(), "SURFACE_CURVE" | "SEAM_CURVE")
                {
                    if let Parameter::List(params) = &mut record.parameter {
                        if let Some(last) = params.last_mut() {
                            *last = Parameter::Enumeration("CURVE_3D".into());
                            preferred_3d += 1;
                        }
                    }
                }
                (*id, vec![record.name.as_str()])
            }
            EntityInstance::Complex { id, subsuper } => {
                (*id, subsuper.0.iter().map(|r| r.name.as_str()).collect())
            }
        };
        if names.iter().any(|name| {
            name.starts_with("ANNOTATION_")
                || matches!(
                    *name,
                    "TEXT_LITERAL" | "COMPOSITE_TEXT" | "LEADER_DIRECTED_CALLOUT"
                )
        }) {
            annotation_ids.insert(id);
        }
        if reviewed
            && names
                .iter()
                .any(|name| *name == "GEOMETRIC_CURVE_SET")
        {
            wire_ids.insert(id);
        }
    }
    let mut table = Table::from_iter(exchange.data.iter().flat_map(|d| &d.entities));
    let mut normalized_directions = 0;
    for direction in table.direction.values_mut() {
        let length = direction
            .direction_ratios
            .iter()
            .map(|x| x * x)
            .sum::<f64>()
            .sqrt();
        if !length.is_finite() || length == 0.0 {
            return Err("invalid STEP direction".into());
        }
        if (length - 1.0).abs() > 1e-12 {
            normalized_directions += 1;
        }
        for value in &mut direction.direction_ratios {
            *value /= length;
        }
    }
    let mut axes = std::mem::take(&mut table.axis2_placement_3d);
    let mut default_reference_axes = 0;
    for axis in axes.values_mut() {
        if axis.ref_direction.is_none() {
            let z = match &axis.axis {
                Some(z) => Vector3::from(&z.clone().into_owned(&table).map_err(|e| e.to_string())?),
                None => Vector3::unit_z(),
            };
            // STEP first_proj_axis: choose Y when the normal is parallel to X.
            if z.cross(Vector3::unit_x()).magnitude2() < 1e-20 {
                axis.ref_direction = Some(PlaceHolder::Owned(DirectionHolder {
                    label: String::new(),
                    direction_ratios: vec![0.0, 1.0, 0.0],
                }));
                default_reference_axes += 1;
            }
        }
    }
    table.axis2_placement_3d = axes;
    let mut ignored_annotations = 0;
    let mut ignored_wire_geometry = 0;
    for representation in table.shape_representation.values_mut() {
        representation.items.retain(|item| {
            let annotation =
                matches!(item, PlaceHolder::Ref(Name::Entity(id)) if annotation_ids.contains(id));
            ignored_annotations += usize::from(annotation);
            let wire = matches!(item, PlaceHolder::Ref(Name::Entity(id)) if wire_ids.contains(id));
            ignored_wire_geometry += usize::from(wire);
            !annotation && !wire
        });
    }
    let linked_shapes = if reviewed {
        link_shape_representations(&mut table)
    } else {
        0
    };
    Ok((
        table,
        serde_json::json!({"normalizedDirections": normalized_directions, "defaultReferenceAxes": default_reference_axes, "ignoredAnnotations": ignored_annotations, "preferred3dCurves": preferred_3d, "recoveredAnalyticCurves": repaired_curves.len(), "millimetresPerUnit": unit_scale, "omittedDescriptions": omitted_descriptions, "ignoredWireGeometry": ignored_wire_geometry, "linkedShapes": linked_shapes}),
    ))
}

// Shape-only preview: follow equality relationships in the same coordinate
// frame. Assembly relationships carrying a transform stay on the assembly DAG.
fn link_shape_representations(table: &mut Table) -> usize {
    let mut adjacent: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for relation in table.shape_representation_relationship.values() {
        if let (PlaceHolder::Ref(Name::Entity(a)), PlaceHolder::Ref(Name::Entity(b))) =
            (&relation.rep_1, &relation.rep_2)
        {
            adjacent.entry(*a).or_default().push(*b);
            adjacent.entry(*b).or_default().push(*a);
        }
    }
    let mut additions = Vec::new();
    for (&id, original) in &table.shape_representation {
        let mut visited = BTreeSet::from([id]);
        let mut seen: BTreeSet<u64> = original
            .items
            .iter()
            .filter_map(|i| match i {
                PlaceHolder::Ref(Name::Entity(id)) => Some(*id),
                _ => None,
            })
            .collect();
        let mut pending = vec![id];
        let mut items = Vec::new();
        while let Some(current) = pending.pop() {
            for &next in adjacent.get(&current).into_iter().flatten() {
                if !visited.insert(next) {
                    continue;
                }
                pending.push(next);
                if let Some(representation) = table.shape_representation.get(&next) {
                    for item in &representation.items {
                        if let PlaceHolder::Ref(Name::Entity(index)) = item {
                            if (table.manifold_solid_brep.contains_key(index)
                                || table.shell_based_surface_model.contains_key(index))
                                && seen.insert(*index)
                            {
                                items.push(item.clone());
                            }
                        }
                    }
                }
            }
        }
        additions.push((id, items));
    }
    let mut count = 0;
    for (id, items) in additions {
        count += items.len();
        table
            .shape_representation
            .get_mut(&id)
            .unwrap()
            .items
            .extend(items);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use ruststep::ast::DataSection;
    use std::str::FromStr;

    fn linked_table(relationships: &str) -> Table {
        Table::from_data_section(
            &DataSection::from_str(&format!(
                "DATA;
            #1=SHAPE_REPRESENTATION('',(#9),#20);
            #2=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#11),#20);
            #9=AXIS2_PLACEMENT_3D('',#10,$,$); #10=CARTESIAN_POINT('',(0.,0.,0.));
            #11=MANIFOLD_SOLID_BREP('',#12); #12=CLOSED_SHELL('',(#13));
            {relationships} ENDSEC;"
            ))
            .unwrap(),
        )
    }

    #[test]
    fn equality_relationship_restores_linked_solid_once() {
        let mut table = linked_table(
            "#3=SHAPE_REPRESENTATION_RELATIONSHIP('','',#1,#2); #4=SHAPE_REPRESENTATION_RELATIONSHIP('','',#2,#1);",
        );
        assert_eq!(link_shape_representations(&mut table), 1);
        assert_eq!(table.shape_representation[&1].items.len(), 2);
        assert_eq!(link_shape_representations(&mut table), 0);
    }

    #[test]
    fn transformed_relationship_does_not_flatten_an_assembly_child() {
        let mut table = linked_table(
            "#3=(REPRESENTATION_RELATIONSHIP('','',#1,#2) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#30) SHAPE_REPRESENTATION_RELATIONSHIP());",
        );
        assert_eq!(link_shape_representations(&mut table), 0);
        assert_eq!(table.shape_representation[&1].items.len(), 1);
    }

    #[test]
    fn cyclic_relationship_graph_without_geometry_terminates() {
        let mut table = linked_table("#3=SHAPE_REPRESENTATION_RELATIONSHIP('','',#1,#1);");
        assert_eq!(link_shape_representations(&mut table), 0);
    }
}

// truck imports bounded PCurves without trimming to EDGE_CURVE's vertices and
// uses the first/last knot as its range. Non-clamped periodic curves can then
// evaluate to NaN outside their valid domain and never finish subdivision.
// Only recover this known case when STEP also supplies an analytic 3D curve;
// truck's normal conic path trims that curve using the actual edge vertices.
// For analytic conics on periodic surfaces, inverse UV endpoint projection also
// loses the angular branch across a seam. Use the supplied 3D conic there too.
fn analytic_recoveries(entities: &[&EntityInstance]) -> BTreeSet<u64> {
    use ruststep::ast::Record;
    let records: BTreeMap<_, Vec<&Record>> = entities
        .iter()
        .map(|entity| match entity {
            EntityInstance::Simple { id, record } => (*id, vec![record]),
            EntityInstance::Complex { id, subsuper } => (*id, subsuper.0.iter().collect()),
        })
        .collect();
    let record = |id, name: &str| {
        records
            .get(&id)?
            .iter()
            .find(|r| r.name.as_str() == name)
            .copied()
    };
    fn params(r: &Record) -> Option<&[Parameter]> {
        match &r.parameter {
            Parameter::List(p) => Some(p),
            _ => None,
        }
    }
    let reference = |p: &Parameter| match p {
        Parameter::Ref(Name::Entity(id)) => Some(*id),
        _ => None,
    };
    let mut result = BTreeSet::new();
    for (&id, rows) in &records {
        let Some(r) = rows
            .iter()
            .find(|r| matches!(r.name.as_str(), "SURFACE_CURVE" | "SEAM_CURVE"))
        else {
            continue;
        };
        let Some(p) = params(r) else { continue };
        let Some(curve) = p.get(1).and_then(reference).and_then(|id| records.get(&id)) else {
            continue;
        };
        if !curve
            .iter()
            .any(|r| matches!(r.name.as_str(), "LINE" | "CIRCLE" | "ELLIPSE"))
        {
            continue;
        }
        let index = match p.last() {
            Some(Parameter::Enumeration(s)) if s == "PCURVE_S1" => 0,
            Some(Parameter::Enumeration(s)) if s == "PCURVE_S2" => 1,
            _ => continue,
        };
        let Some(Parameter::List(associated)) = p.get(2) else {
            continue;
        };
        let selected = associated
            .get(index)
            .and_then(reference)
            .and_then(|id| record(id, "PCURVE"))
            .and_then(params);
        let periodic_surface = selected
            .as_ref()
            .and_then(|p| p.get(1))
            .and_then(reference)
            .and_then(|id| records.get(&id))
            .is_some_and(|rows| {
                rows.iter().any(|r| {
                    matches!(
                        r.name.as_str(),
                        "CYLINDRICAL_SURFACE"
                            | "CONICAL_SURFACE"
                            | "SPHERICAL_SURFACE"
                            | "TOROIDAL_SURFACE"
                            | "SURFACE_OF_REVOLUTION"
                    )
                })
            });
        if periodic_surface
            && curve
                .iter()
                .any(|r| matches!(r.name.as_str(), "CIRCLE" | "ELLIPSE"))
        {
            result.insert(id);
            continue;
        }
        let representation = selected
            .as_ref()
            .and_then(|p| p.get(2))
            .and_then(reference)
            .and_then(|id| record(id, "DEFINITIONAL_REPRESENTATION"))
            .and_then(params);
        let Some(Parameter::List(items)) = representation.as_ref().and_then(|p| p.get(1)) else {
            continue;
        };
        let Some(curve_id) = items.first().and_then(reference) else {
            continue;
        };
        let Some(base) = record(curve_id, "B_SPLINE_CURVE").and_then(params) else {
            continue;
        };
        let Some(knots) = record(curve_id, "B_SPLINE_CURVE_WITH_KNOTS").and_then(params) else {
            continue;
        };
        let Some(Parameter::Integer(degree)) = base.first() else {
            continue;
        };
        let Some(Parameter::List(multiplicities)) = knots.first() else {
            continue;
        };
        let unclamped = [multiplicities.first(), multiplicities.last()]
            .iter()
            .any(|m| matches!(m, Some(Parameter::Integer(n)) if n <= degree));
        if unclamped {
            result.insert(id);
        }
    }
    result
}
