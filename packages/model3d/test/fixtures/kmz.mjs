import JSZip from 'jszip';
import { createObjTexture } from './obj.mjs';

export function createKmzDae({ texture = 'textures/color.png', offset = 0, materials = 1 } = {}) {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const images = texture ? `<library_images><image id="image"><init_from>${escape(texture)}</init_from></image></library_images>` : '';
  const effects = Array.from({ length: materials }, (_, i) => `<effect id="effect${i}"><profile_COMMON>${texture ? '<newparam sid="surface"><surface type="2D"><init_from>image</init_from></surface></newparam><newparam sid="sampler"><sampler2D><source>surface</source></sampler2D></newparam>' : ''}<technique sid="common"><phong><diffuse>${texture ? '<texture texture="sampler" texcoord="UVMap"/>' : '<color>1 0 0 1</color>'}</diffuse></phong></technique></profile_COMMON></effect>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><created>2026-10-24T00:00:00Z</created><modified>2026-10-24T00:00:00Z</modified><unit meter="1"/><up_axis>Y_UP</up_axis></asset>
${images}<library_effects>${effects}</library_effects>
<library_materials>${Array.from({ length: materials }, (_, i) => `<material id="material${i}" name="底色${i}"><instance_effect url="#effect${i}"/></material>`).join('')}</library_materials>
<library_geometries><geometry id="quad"><mesh>
<source id="positions"><float_array id="positions-array" count="12">0 0 0 1 0 0 1 1 0 0 1 0</float_array><technique_common><accessor source="#positions-array" count="4" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="normals"><float_array id="normals-array" count="3">0 0 1</float_array><technique_common><accessor source="#normals-array" count="1" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="uv"><float_array id="uv-array" count="8">0 0 1 0 1 1 0 1</float_array><technique_common><accessor source="#uv-array" count="4" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<vertices id="vertices"><input semantic="POSITION" source="#positions"/></vertices>
<triangles count="2" material="surface"><input semantic="VERTEX" source="#vertices" offset="0"/><input semantic="NORMAL" source="#normals" offset="1"/><input semantic="TEXCOORD" source="#uv" offset="2" set="0"/><p>0 0 0 1 0 1 2 0 2 0 0 0 2 0 2 3 0 3</p></triangles>
</mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="scene">${Array.from({ length: materials }, (_, i) => `<node id="node${i}"><translate>${offset + i * 2} 0 0</translate><instance_geometry url="#quad"><bind_material><technique_common><instance_material symbol="surface" target="#material${i}"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material></instance_geometry></node>`).join('')}</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene></COLLADA>`;
}

export async function createKmzFixture({ nested = false, unused = 0, unusedSide = 512, texture = true, materials = 1 } = {}) {
  const zip = new JSZip(), image = createObjTexture(8);
  const modelName = nested ? 'package/models/模型 one.dae' : 'model.dae';
  const kmlName = nested ? 'package/maps/doc.kml' : 'doc.kml';
  const textureName = nested ? 'package/textures/颜色 #1.png' : 'textures/color.png';
  const href = nested ? '../models/%E6%A8%A1%E5%9E%8B%20one.dae' : modelName;
  const textureHref = nested ? '..\\textures\\%E9%A2%9C%E8%89%B2%20%231.png' : 'textures/color.png';
  const dae = createKmzDae({ texture: texture ? textureHref : null, materials });
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Model><Link><href>${href}</href></Link></Model></Placemark></kml>`;
  zip.file(kmlName, kml); zip.file(modelName, dae);
  if (texture) zip.file(textureName, image.png);
  let unusedImage;
  if (unused) {
    unusedImage = createObjTexture(unusedSide);
    for (let i = 0; i < unused; i++) zip.file(`unreferenced/photo-${i}.png`, unusedImage.png);
  }
  for (const entry of Object.values(zip.files)) entry.date = new Date('2026-10-24T00:00:00Z');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, zip, dae, kml, modelName, kmlName, textureName, textureHref, image,
    unused, unusedDecodedBytes: unused * (unusedImage?.png.length ?? 0),
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
    normals: Array.from({ length: 6 }, () => [0, 0, 1]).flat(), uv: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] };
}
