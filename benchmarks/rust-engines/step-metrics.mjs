import path from 'node:path';
import { fileURLToPath } from 'node:url';
const work = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tmp/rust-engines');
const THREE = await import(path.join(work, 'tools/node_modules/three/build/three.module.js'));
const { MeshBVH } = await import(path.join(work, 'tools/node_modules/three-mesh-bvh/src/index.js'));

export function geometryStats({ positions: p }) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let area = 0, volume = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (const v of p) for (let k = 0; k < 3; k++) { if (!Number.isFinite(v[k])) throw new Error('Nonfinite geometry'); min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  for (let i = 0; i < p.length; i += 3) {
    a.fromArray(p[i]); b.fromArray(p[i + 1]); c.fromArray(p[i + 2]);
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    volume += a.dot(ab.crossVectors(b, c)) / 6;
  }
  return { min, max, diagonal: Math.hypot(...min.map((v, i) => max[i] - v)), area, signedVolume: volume, triangles: p.length / 3 };
}

export function compareGeometry(a, b) {
  const sa = geometryStats(a), sb = geometryStats(b);
  const diag = Math.max(sa.diagonal, 1e-12);
  return {
    boundsRelativeError: Math.max(...sa.min.map((v, i) => Math.abs(v - sb.min[i])), ...sa.max.map((v, i) => Math.abs(v - sb.max[i]))) / diag,
    areaRelativeError: Math.abs(sa.area - sb.area) / Math.max(sa.area, 1e-12),
    volumeRelativeError: Math.abs(sa.signedVolume - sb.signedVolume) / Math.max(Math.abs(sa.signedVolume), 1e-9 * diag ** 3),
    referenceToCandidate: surfaceDistance(a, b), candidateToReference: surfaceDistance(b, a),
  };
}

function surfaceDistance(source, target) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.positions.flat(), 3));
  const bvh = new MeshBVH(geometry);
  const point = new THREE.Vector3(), distances = [];
  const n = source.positions.length / 3;
  for (let sample = 0; sample < Math.min(1024, n); sample++) {
    const index = Math.floor(sample * n / Math.min(1024, n)) * 3;
    const vertices = source.positions.slice(index, index + 3);
    for (const coords of [vertices[0], [0, 1, 2].map(k => (vertices[0][k] + vertices[1][k] + vertices[2][k]) / 3)]) {
      const hit = bvh.closestPointToPoint(point.fromArray(coords));
      distances.push(hit.distance);
    }
  }
  distances.sort((a, b) => a - b);
  geometry.dispose();
  return { samples: distances.length, p95: distances[Math.floor(distances.length * 0.95)], max: distances.at(-1) };
}
