//! Resolve a uniform length unit from the contexts actually used by shapes.
//! Mixed-unit geometry must be converted per representation; reject it here.
use std::collections::{BTreeMap, BTreeSet};
use truck_stepio::r#in::ruststep::ast::{EntityInstance, Exchange, Name, Parameter, Record};

fn params(record: &Record) -> Option<&[Parameter]> {
    match &record.parameter {
        Parameter::List(p) => Some(p),
        _ => None,
    }
}
fn reference(p: &Parameter) -> Option<u64> {
    match p {
        Parameter::Ref(Name::Entity(id)) => Some(*id),
        _ => None,
    }
}
fn number(p: &Parameter) -> Option<f64> {
    match p {
        Parameter::Real(n) => Some(*n),
        Parameter::Integer(n) => Some(*n as f64),
        Parameter::Typed { parameter, .. } => number(parameter),
        _ => None,
    }
}

pub fn millimetres_per_unit(exchange: &Exchange) -> Result<f64, String> {
    let mut records: BTreeMap<u64, Vec<&Record>> = BTreeMap::new();
    for entity in exchange.data.iter().flat_map(|d| &d.entities) {
        match entity {
            EntityInstance::Simple { id, record } => {
                records.insert(*id, vec![record]);
            }
            EntityInstance::Complex { id, subsuper } => {
                records.insert(*id, subsuper.0.iter().collect());
            }
        }
    }
    let mut contexts = BTreeSet::new();
    for rows in records.values() {
        for record in rows {
            if matches!(
                record.name.as_str(),
                "SHAPE_REPRESENTATION"
                    | "ADVANCED_BREP_SHAPE_REPRESENTATION"
                    | "MANIFOLD_SURFACE_SHAPE_REPRESENTATION"
                    | "GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION"
                    | "FACETED_BREP_SHAPE_REPRESENTATION"
                    | "GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION"
                    | "EDGE_BASED_WIREFRAME_SHAPE_REPRESENTATION"
            ) {
                if let Some(id) = params(record).and_then(|p| p.last()).and_then(reference) {
                    contexts.insert(id);
                }
            }
        }
    }
    let mut scales = Vec::new();
    for context in contexts {
        let Some(assignment) = records.get(&context).and_then(|rows| {
            rows.iter()
                .find(|r| r.name.as_str() == "GLOBAL_UNIT_ASSIGNED_CONTEXT")
        }) else {
            return Err(format!(
                "STEP shape context #{context} has no unit assignment"
            ));
        };
        let Some(Parameter::List(units)) = params(assignment).and_then(|p| p.first()) else {
            return Err("invalid STEP unit assignment".into());
        };
        let mut lengths = Vec::new();
        for unit in units {
            let Some(id) = reference(unit) else {
                return Err("invalid STEP unit reference".into());
            };
            if records
                .get(&id)
                .is_some_and(|rows| rows.iter().any(|r| r.name.as_str() == "LENGTH_UNIT"))
            {
                lengths.push(length_scale(id, &records, &mut BTreeSet::new())?);
            }
        }
        if lengths.len() != 1 {
            return Err(format!("STEP context #{context} must have one length unit"));
        }
        scales.push(lengths[0]);
    }
    let scale = *scales.first().ok_or("STEP shape length unit is missing")?;
    if scales.iter().any(|s| (s / scale - 1.0).abs() > 1e-10) {
        return Err("mixed STEP length units require per-representation conversion".into());
    }
    Ok(scale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use truck_stepio::r#in::ruststep::ast::DataSection;

    fn exchange(definitions: &str) -> Exchange {
        Exchange {
            header: vec![], anchor: vec![], reference: vec![], signature: vec![],
            data: vec![DataSection::from_str(&format!("DATA;
                #1=SHAPE_REPRESENTATION('',(#2),#3);
                #2=AXIS2_PLACEMENT_3D('',#4,$,$); #4=CARTESIAN_POINT('',(0.,0.,0.));
                #3=(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#10)) REPRESENTATION_CONTEXT('','3D'));
                {definitions} ENDSEC;")).unwrap()],
        }
    }

    #[test]
    fn metre_centimetre_and_millimetre() {
        for (prefix, scale) in [("$", 1000.), (".CENTI.", 10.), (".MILLI.", 1.)] {
            assert_eq!(
                millimetres_per_unit(&exchange(&format!(
                    "#10=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT({prefix},.METRE.));"
                )))
                .unwrap(),
                scale
            );
        }
    }

    #[test]
    fn conversion_uses_referenced_base_unit_without_selecting_it_as_context_unit() {
        let source = "#10=(CONVERSION_BASED_UNIT('INCH',#11) LENGTH_UNIT() NAMED_UNIT(*));
            #11=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#12);
            #12=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));";
        assert_eq!(millimetres_per_unit(&exchange(source)).unwrap(), 25.4);
    }

    #[test]
    fn nested_conversion_is_resolved() {
        let source = "#10=(CONVERSION_BASED_UNIT('FOOT',#11) LENGTH_UNIT() NAMED_UNIT(*));
            #11=LENGTH_MEASURE_WITH_UNIT(12.,#12);
            #12=(CONVERSION_BASED_UNIT('INCH',#13) LENGTH_UNIT() NAMED_UNIT(*));
            #13=LENGTH_MEASURE_WITH_UNIT(25.4,#14);
            #14=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));";
        assert!((millimetres_per_unit(&exchange(source)).unwrap() - 304.8).abs() < 1e-10);
    }

    #[test]
    fn mixed_context_units_are_rejected() {
        let source = "#10=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));
            #20=SHAPE_REPRESENTATION('',(#2),#21);
            #21=(GLOBAL_UNIT_ASSIGNED_CONTEXT((#22)) REPRESENTATION_CONTEXT('','3D'));
            #22=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.));";
        assert!(
            millimetres_per_unit(&exchange(source))
                .unwrap_err()
                .contains("mixed")
        );
    }

    #[test]
    fn cyclic_unit_definitions_are_rejected() {
        let source = "#10=(CONVERSION_BASED_UNIT('loop',#11) LENGTH_UNIT() NAMED_UNIT(*)); #11=LENGTH_MEASURE_WITH_UNIT(1.,#10);";
        assert!(
            millimetres_per_unit(&exchange(source))
                .unwrap_err()
                .contains("cyclic")
        );
    }

    #[test]
    fn zero_and_negative_factors_are_rejected() {
        for factor in [0., -1.] {
            let source = format!(
                "#10=(CONVERSION_BASED_UNIT('invalid',#11) LENGTH_UNIT() NAMED_UNIT(*)); #11=LENGTH_MEASURE_WITH_UNIT({factor:?},#12); #12=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));"
            );
            assert!(millimetres_per_unit(&exchange(&source)).is_err());
        }
    }

    #[test]
    fn missing_context_unit_is_not_guessed() {
        let source = "#10=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.)); #20=SHAPE_REPRESENTATION('',(#2),#21); #21=REPRESENTATION_CONTEXT('','3D');";
        assert!(
            millimetres_per_unit(&exchange(source))
                .unwrap_err()
                .contains("no unit assignment")
        );
    }
}

fn length_scale(
    id: u64,
    records: &BTreeMap<u64, Vec<&Record>>,
    visiting: &mut BTreeSet<u64>,
) -> Result<f64, String> {
    if visiting.len() >= 32 || !visiting.insert(id) {
        return Err("cyclic or too-deep STEP unit definition".into());
    }
    let rows = records
        .get(&id)
        .ok_or_else(|| format!("missing STEP unit #{id}"))?;
    let scale = if let Some(si) = rows.iter().find(|r| r.name.as_str() == "SI_UNIT") {
        let p = params(si).ok_or("invalid SI_UNIT")?;
        if !matches!(p.get(1), Some(Parameter::Enumeration(s)) if s == "METRE") {
            return Err("length SI_UNIT must be METRE".into());
        }
        match p.first() {
            Some(Parameter::NotProvided) => 1000.0,
            Some(Parameter::Enumeration(prefix)) => {
                1000.0
                    * match prefix.as_str() {
                        "EXA" => 1e18,
                        "PETA" => 1e15,
                        "TERA" => 1e12,
                        "GIGA" => 1e9,
                        "MEGA" => 1e6,
                        "KILO" => 1e3,
                        "HECTO" => 1e2,
                        "DECA" => 1e1,
                        "DECI" => 1e-1,
                        "CENTI" => 1e-2,
                        "MILLI" => 1e-3,
                        "MICRO" => 1e-6,
                        "NANO" => 1e-9,
                        "PICO" => 1e-12,
                        "FEMTO" => 1e-15,
                        "ATTO" => 1e-18,
                        _ => return Err(format!("unsupported STEP SI prefix {prefix}")),
                    }
            }
            _ => return Err("invalid SI_UNIT prefix".into()),
        }
    } else if let Some(conversion) = rows
        .iter()
        .find(|r| r.name.as_str() == "CONVERSION_BASED_UNIT")
    {
        let measure = params(conversion)
            .and_then(|p| p.get(1))
            .and_then(reference)
            .and_then(|id| records.get(&id))
            .and_then(|rows| {
                rows.iter().find(|r| {
                    matches!(
                        r.name.as_str(),
                        "LENGTH_MEASURE_WITH_UNIT" | "MEASURE_WITH_UNIT"
                    )
                })
            })
            .and_then(|r| params(r))
            .ok_or("invalid STEP length conversion factor")?;
        let factor = measure
            .first()
            .and_then(number)
            .ok_or("invalid STEP length measure")?;
        let base = measure
            .get(1)
            .and_then(reference)
            .ok_or("invalid STEP base unit")?;
        factor * length_scale(base, records, visiting)?
    } else {
        return Err(format!("unsupported STEP length unit #{id}"));
    };
    visiting.remove(&id);
    if !scale.is_finite() || scale <= 0.0 {
        return Err("STEP length scale must be positive and finite".into());
    }
    Ok(scale)
}
