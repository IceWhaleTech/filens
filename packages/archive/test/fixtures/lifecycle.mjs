import JSZip from 'jszip';
import { createHash } from 'node:crypto';

export async function createArchiveFixture(files, compression = 'DEFLATE') {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  for (const [name, data] of Object.entries(files)) zip.file(name, data, { date, createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression });
}

export function createArchiveBitmap() {
  const bytes = new Uint8Array(70), view = new DataView(bytes.buffer);
  bytes.set([66, 77]); view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, 2, true); view.setInt32(22, 2, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, 16, true);
  // BMP rows run bottom to top, in BGR order, padded to four bytes.
  bytes.set([255, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0], 54);
  return { bytes, pixels: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255] };
}

export function createArchiveWav() {
  const frames = 800, bytes = new Uint8Array(44 + frames * 2), view = new DataView(bytes.buffer);
  const text = (offset, value) => bytes.set(new TextEncoder().encode(value), offset);
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(1000 * Math.sin(i * 2 * Math.PI * 440 / 8000)), true);
  return bytes;
}

export function createArchiveTexturedGltf() {
  const binary = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 1]);
  return { json: JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ uri: `data:application/octet-stream;base64,${Buffer.from(binary.buffer).toString('base64')}`, byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 24, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    images: [{ uri: '../textures/色%20图.bmp' }], textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }]
  }), positions: [...binary.subarray(0, 9)], uv: [...binary.subarray(9)] };
}

export async function createArchiveNavigationFixture(count, directories = 0) {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(directories) || directories < 0 || directories > count) throw new Error('Invalid archive fixture size');
  const files = {};
  for (let i = 0; i < count; i++) {
    const directory = directories ? `dir${String(i % directories).padStart(3, '0')}/` : '';
    files[`${directory}file${String(i).padStart(6, '0')}.txt`] = `Archive file ${i}\n`;
  }
  const contents = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => ({ name, text }));
  return { bytes: await createArchiveFixture(files, 'STORE'), count, directories,
    contentSha256: createHash('sha256').update(JSON.stringify(contents)).digest('hex') };
}
