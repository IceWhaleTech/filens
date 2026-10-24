// Deterministic binary STL grid; accepts any positive triangle count.
export function createBinaryStlFixture(triangles = 1000) {
  if (!Number.isSafeInteger(triangles) || triangles < 1) throw new Error('Invalid triangle count');
  const bytes = new Uint8Array(84 + triangles * 50), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('filens generated terrain grid')); view.setUint32(80, triangles, true);
  const width = Math.ceil(Math.sqrt(triangles / 2));
  const vertex = (x, y) => [x / 8, y / 8, Math.sin(x / 12) * Math.cos(y / 14) / 2];
  for (let i = 0; i < triangles; i++) {
    const cell = i >> 1, x = cell % width, y = Math.floor(cell / width);
    const a = vertex(x, y), b = i % 2 ? vertex(x + 1, y + 1) : vertex(x + 1, y), c = i % 2 ? vertex(x, y + 1) : vertex(x + 1, y + 1);
    const u = b.map((v, n) => v - a[n]), v = c.map((v, n) => v - a[n]);
    const normal = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], length = Math.hypot(...normal);
    let offset = 84 + i * 50;
    for (const number of [...normal.map(v => v / length), ...a, ...b, ...c]) { view.setFloat32(offset, number, true); offset += 4; }
  }
  return bytes;
}

export function createGlbFixture() {
  const positions = new Float32Array([-1,-1,0,1,-1,0,0,1,0]);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Triangle' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,-1,0], max: [1,1,0] }] }));
  const jsonLength = (json.length + 3) & ~3, bytes = new Uint8Array(12 + 8 + jsonLength + 8 + positions.byteLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32,20,20+jsonLength); bytes.set(json,20);
  view.setUint32(20+jsonLength, positions.byteLength, true); view.setUint32(24+jsonLength, 0x004e4942, true); bytes.set(new Uint8Array(positions.buffer),28+jsonLength); return bytes;
}
