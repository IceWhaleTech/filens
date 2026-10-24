// Valid non-indexed glTF terrain: every sidecar byte contributes to geometry.
export function createGltfSidecarFixture(triangles = 1000) {
  if (!Number.isSafeInteger(triangles) || triangles < 1) throw new Error('Invalid triangle count');
  const values = triangles * 9;
  const bytes = new Uint8Array(values * 4 * 2);
  const positions = new Float32Array(bytes.buffer, 0, values);
  const normals = new Float32Array(bytes.buffer, values * 4, values);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const width = Math.ceil(Math.sqrt(triangles / 2));
  const vertex = (x, y) => [x / 8, y / 8, Math.sin(x / 12) * Math.cos(y / 14) / 2];
  for (let i = 0; i < triangles; i++) {
    const cell = i >> 1, x = cell % width, y = Math.floor(cell / width);
    const a = vertex(x, y), b = i % 2 ? vertex(x + 1, y + 1) : vertex(x + 1, y), c = i % 2 ? vertex(x, y + 1) : vertex(x + 1, y + 1);
    positions.set([...a, ...b, ...c], i * 9);
    const u = b.map((v, axis) => v - a[axis]), v = c.map((v, axis) => v - a[axis]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...normal);
    for (let j = 0; j < 9; j++) {
      normals[i * 9 + j] = normal[j % 3] / length;
      const number = positions[i * 9 + j], axis = j % 3;
      min[axis] = Math.min(min[axis], number); max[axis] = Math.max(max[axis], number);
    }
  }
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Terrain' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.25, 0.7, 0.45, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
    buffers: [{ uri: 'terrain.bin', byteLength: bytes.byteLength }],
    bufferViews: [0, 1].map(index => ({ buffer: 0, byteOffset: index * values * 4, byteLength: values * 4, target: 34962 })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: triangles * 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: triangles * 3, type: 'VEC3' }
    ]
  };
  return { json, bytes, positions, normals, min, max };
}
