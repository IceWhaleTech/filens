// Filens STEP preview adapter. OCCT and occt-import-js licenses accompany the
// generated runtime. No XCAF document, styling, or assembly tree is created.
#include "importer-utils.hpp"

#include <STEPControl_Reader.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <UnitsMethods.hxx>
#include <emscripten/bind.h>

using emscripten::val;

static ImportParams PreviewParams (const val& options)
{
    ImportParams params;
    if (options.isNull () || options.isUndefined ()) return params;
    if (options.hasOwnProperty ("linearUnit")) {
        const std::string unit = options["linearUnit"].as<std::string> ();
        if (unit == "centimeter") params.linearUnit = ImportParams::LinearUnit::Centimeter;
        else if (unit == "meter") params.linearUnit = ImportParams::LinearUnit::Meter;
        else if (unit == "inch") params.linearUnit = ImportParams::LinearUnit::Inch;
        else if (unit == "foot") params.linearUnit = ImportParams::LinearUnit::Foot;
    }
    if (options.hasOwnProperty ("linearDeflectionType")
        && options["linearDeflectionType"].as<std::string> () == "absolute_value") {
        params.linearDeflectionType = ImportParams::LinearDeflectionType::AbsoluteValue;
    }
    if (options.hasOwnProperty ("linearDeflection")) params.linearDeflection = options["linearDeflection"].as<double> ();
    if (options.hasOwnProperty ("angularDeflection")) params.angularDeflection = options["angularDeflection"].as<double> ();
    return params;
}

static val PreviewMesh (const TopoDS_Shape& shape)
{
    val positions = val::array ();
    val normals = val::array ();
    val indices = val::array ();
    int vertexCount = 0, normalCount = 0, indexCount = 0;
    for (TopExp_Explorer it (shape, TopAbs_FACE); it.More (); it.Next ()) {
        const TopoDS_Face& source = TopoDS::Face (it.Current ());
        OcctFace face (source);
        const int vertexOffset = vertexCount;
        face.EnumerateVertices ([&](double x, double y, double z) {
            positions.set (vertexCount * 3, x);
            positions.set (vertexCount * 3 + 1, y);
            positions.set (vertexCount * 3 + 2, z);
            ++vertexCount;
        });
        face.EnumerateNormals ([&](double x, double y, double z) {
            normals.set (normalCount * 3, x);
            normals.set (normalCount * 3 + 1, y);
            normals.set (normalCount * 3 + 2, z);
            ++normalCount;
        });
        face.EnumerateTriangles ([&](int a, int b, int c) {
            indices.set (indexCount++, vertexOffset + a);
            indices.set (indexCount++, vertexOffset + b);
            indices.set (indexCount++, vertexOffset + c);
        });
    }
    if (!indexCount) return val::null ();
    val mesh = val::object (), attributes = val::object ();
    val position = val::object (), normal = val::object (), index = val::object ();
    position.set ("array", positions);
    attributes.set ("position", position);
    if (vertexCount == normalCount) {
        normal.set ("array", normals);
        attributes.set ("normal", normal);
    }
    index.set ("array", indices);
    mesh.set ("attributes", attributes);
    mesh.set ("index", index);
    return mesh;
}

static val ReadStepFile (const val& buffer, const val& options)
{
    val result = val::object ();
    result.set ("success", false);
    const std::vector<std::uint8_t> bytes = emscripten::vecFromJSArray<std::uint8_t> (buffer);
    if (bytes.empty ()) return result;
    const ImportParams params = PreviewParams (options);
    try {
        STEPControl_Reader reader;
        VectorBuffer input (bytes);
        std::istream stream (&input);
        if (reader.ReadStream ("preview.stp", stream) != IFSelect_RetDone) return result;
        reader.SetSystemLengthUnit (UnitsMethods::GetLengthUnitScale (
            LinearUnitToLengthUnit (params.linearUnit), UnitsMethods_LengthUnit_Millimeter));
        if (!reader.TransferRoots ()) return result;

        val meshes = val::array (), references = val::array ();
        int meshCount = 0;
        for (int i = 1; i <= reader.NbShapes (); ++i) {
            // OCCT resolves assembly placements into these shapes. Flattening
            // the document must not discard or duplicate placed instances.
            TopoDS_Shape shape = reader.Shape (i);
            if (shape.IsNull () || !TriangulateShape (shape, params)) continue;
            val mesh = PreviewMesh (shape);
            if (mesh.isNull ()) continue;
            meshes.set (meshCount, mesh);
            references.set (meshCount, meshCount);
            ++meshCount;
        }
        if (!meshCount) return result;
        val root = val::object ();
        root.set ("meshes", references);
        result.set ("root", root);
        result.set ("meshes", meshes);
        result.set ("success", true);
    } catch (const Standard_Failure&) {
        // A malformed model must leave the reusable WASM instance available.
    }
    return result;
}

EMSCRIPTEN_BINDINGS (filens_step_preview)
{
    emscripten::function ("ReadStepFile", &ReadStepFile);
}
