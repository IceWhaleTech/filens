import JSZip from 'jszip';
import { createGlbFixture } from './mesh.mjs';

export function createTexturedGlbFixture(textureUri) {
  const original = createGlbFixture(), view = new DataView(original.buffer), length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + length)));
  const uv = new Float32Array([0, 0, 1, 0, 0.5, 1]), binary = new Uint8Array(36 + uv.byteLength);
  binary.set(original.subarray(28 + length)); binary.set(new Uint8Array(uv.buffer), 36);
  json.buffers[0].byteLength = binary.length;
  json.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: uv.byteLength, target: 34962 });
  json.accessors.push({ bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' });
  json.meshes[0].primitives[0].attributes.TEXCOORD_0 = 1; json.meshes[0].primitives[0].material = 0;
  json.images = [{ uri: textureUri }]; json.textures = [{ source: 0 }];
  json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }];
  const encoded = new TextEncoder().encode(JSON.stringify(json)), jsonLength = (encoded.length + 3) & ~3;
  const bytes = new Uint8Array(28 + jsonLength + binary.length), output = new DataView(bytes.buffer);
  output.setUint32(0, 0x46546c67, true); output.setUint32(4, 2, true); output.setUint32(8, bytes.length, true);
  output.setUint32(12, jsonLength, true); output.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength); bytes.set(encoded, 20);
  output.setUint32(20 + jsonLength, binary.length, true); output.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(binary, 28 + jsonLength);
  return bytes;
}

export async function createCancellation3mfFixture() {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>
</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
<build><item objectid="1"/></build></model>`, { date, createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
