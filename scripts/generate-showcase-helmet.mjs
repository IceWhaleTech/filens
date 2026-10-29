// Author a stylized horned Viking helmet. No external model or texture is used.
// Run: node scripts/generate-showcase-helmet.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BufferGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute,
  CatmullRomCurve3, Matrix4, Quaternion, Shape, SphereGeometry, Vector3
} from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = [
  '# filens: original stylized Viking horned helmet',
  '# Vertex colors and explicit normals; no companion textures or materials.',
  '# Fantasy costume design, not a historical reconstruction.'
];
const steel = [0.19, 0.255, 0.30];
const brass = [0.49, 0.285, 0.115];
const leather = [0.055, 0.035, 0.023];
let vertexOffset = 0;
let triangleCount = 0;
const number = value => Math.abs(value) < 0.000005 ? '0' : Number(value.toFixed(5)).toString();

function add(name, geometry, color, matrix = new Matrix4()) {
  geometry.applyMatrix4(matrix);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  lines.push(`o ${name}`, 's 1');
  for (let i = 0; i < positions.count; i++) {
    const position = new Vector3().fromBufferAttribute(positions, i);
    const rgb = typeof color === 'function' ? color(position, i) : color;
    lines.push(`v ${[position.x, position.y, position.z, ...rgb].map(number).join(' ')}`);
  }
  for (let i = 0; i < normals.count; i++) {
    lines.push(`vn ${[normals.getX(i), normals.getY(i), normals.getZ(i)].map(number).join(' ')}`);
  }
  const indices = geometry.getIndex();
  const count = indices ? indices.count : positions.count;
  for (let i = 0; i < count; i += 3) {
    const face = [0, 1, 2].map(offset => indices ? indices.getX(i + offset) : i + offset);
    const [a, b, c] = face.map(index => new Vector3().fromBufferAttribute(positions, index));
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-10) continue;
    lines.push(`f ${face.map(index => `${index + vertexOffset + 1}//${index + vertexOffset + 1}`).join(' ')}`);
    triangleCount++;
  }
  vertexOffset += positions.count;
  geometry.dispose();
}

function surface(rows, columns, point, reverse = true) {
  const positions = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) positions.push(...point(row / rows, column / columns));
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      if (reverse) indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rivet(name, position, radius = 1.25) {
  add(name, new SphereGeometry(radius, 10, 6), [0.65, 0.43, 0.20], new Matrix4().makeTranslation(...position));
}

// An open steel shell, with a dark inner surface visible beneath the rim.
add('Steel_dome', new SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), (position) => {
  const panel = Math.floor((Math.atan2(position.z, position.x) + Math.PI) / (Math.PI / 4));
  const variation = panel % 2 ? 1.07 : 0.95;
  return steel.map(channel => channel * variation);
}, new Matrix4().makeScale(37, 43, 32));
const inner = new SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2);
const innerIndex = inner.getIndex();
for (let i = 0; i < innerIndex.count; i += 3) {
  const first = innerIndex.getX(i);
  innerIndex.setX(i, innerIndex.getX(i + 2));
  innerIndex.setX(i + 2, first);
}
inner.deleteAttribute('normal');
add('Dark_inner_lining', inner, leather, new Matrix4().makeScale(35.5, 41.5, 30.5));

// A substantial bronze brow band with bevelled edges.
const bandProfile = [[-1.2, -1], [0.9, -1], [1.8, 0.1], [1.8, 5.8], [0.9, 7], [-1.2, 7]];
add('Bronze_brow_band', surface(64, bandProfile.length, (u, v) => {
  const angle = u * Math.PI * 2;
  const [offset, y] = bandProfile[Math.round(v * bandProfile.length) % bandProfile.length];
  return [(37 + offset) * Math.cos(angle), y, (32 + offset) * Math.sin(angle)];
}), brass);
for (let i = 0; i < 18; i++) {
  const angle = i * Math.PI * 2 / 18;
  rivet(`Brow_rivet_${i + 1}`, [39 * Math.cos(angle), 3, 34 * Math.sin(angle)]);
}

// A raised crest follows the dome from the nose to the nape.
const crestProfile = [[-2.8, 0], [2.8, 0], [2.8, 1.4], [-2.8, 1.4]];
add('Bronze_crown_crest', surface(48, 4, (u, v) => {
  const angle = u * Math.PI;
  const [x, offset] = crestProfile[Math.round(v * 4) % 4];
  return [x, (43.2 + offset) * Math.sin(angle), (32.3 + offset) * Math.cos(angle)];
}), brass);
for (let i = 1; i < 8; i++) {
  const angle = i * Math.PI / 8;
  rivet(`Crest_rivet_${i}`, [0, 45 * Math.sin(angle), 34.2 * Math.cos(angle)], 1.1);
}

// The pointed nasal guard leaves the face open on either side.
const nasal = new Shape();
nasal.moveTo(-4.2, 6);
nasal.lineTo(4.2, 6);
nasal.lineTo(3.2, -21);
nasal.lineTo(0, -28);
nasal.lineTo(-3.2, -21);
nasal.closePath();
add('Bronze_nasal_guard', new ExtrudeGeometry(nasal, {
  depth: 2.4, bevelEnabled: true, bevelSize: 0.75, bevelThickness: 0.65, bevelSegments: 1, steps: 1
}), brass, new Matrix4().makeTranslation(0, 0, 32.4));
rivet('Nasal_rivet', [0, -5, 36], 1.1);

// Curved cheek plates, open below the face, are part of the same mesh asset.
for (const side of [-1, 1]) {
  add(`Steel_cheek_${side < 0 ? 'left' : 'right'}`, surface(8, 18, (u, v) => {
    const angle = side * (0.84 + v * 0.98);
    const length = 19 + 5 * Math.sin(v * Math.PI);
    const radius = 1 - u * 0.09;
    return [37 * Math.sin(angle) * radius, 0.8 - u * length, 32 * Math.cos(angle) * radius];
  }, side < 0), steel.map(channel => channel * 0.86));
}

// Tapered horns sweep out and then turn upwards. Frenet frames keep their
// cross-sections round throughout the bend; explicit normals keep them smooth.
for (const side of [-1, 1]) {
  const sideName = side < 0 ? 'left' : 'right';
  const curve = new CatmullRomCurve3([
    [31, 23, 0], [46, 27, 0], [62, 39, 1], [72, 57, 1], [73, 75, 0], [65, 92, -2]
  ].map(([x, y, z]) => new Vector3(side * x, y, z)));
  const segments = 48;
  const frames = curve.computeFrenetFrames(segments, false);
  function hornPoint(u, v) {
    const index = Math.round(u * segments);
    const center = curve.getPointAt(u);
    const angle = v * Math.PI * 2;
    const grain = 1 + 0.017 * Math.cos(angle * 12) * (1 - u);
    const radius = (10.5 * Math.pow(1 - u, 0.82) + 0.04) * grain;
    return center.addScaledVector(frames.normals[index], Math.cos(angle) * radius)
      .addScaledVector(frames.binormals[index], Math.sin(angle) * radius).toArray();
  }
  add(`Ivory_horn_${sideName}`, surface(segments, 24, (u, v) => hornPoint(u, v)), (position) => {
    const height = Math.max(0, Math.min(1, (position.y - 23) / 69));
    return [0.61 + height * 0.16, 0.43 + height * 0.20, 0.23 + height * 0.26];
  });
  // Collar cylinders follow the first horn tangent and hide the open base.
  const tangent = curve.getTangentAt(0);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), tangent);
  const center = curve.getPointAt(0.055);
  const matrix = new Matrix4().compose(center, rotation, new Vector3(1, 1, 1));
  add(`Bronze_horn_socket_${sideName}`, new CylinderGeometry(11.5, 12, 5.5, 24), brass, matrix);
}

const output = path.join(root, 'apps/demo/public/samples/viking-helmet.obj');
await writeFile(output, `${lines.join('\n')}\n`);
console.log(`Generated viking-helmet.obj: ${vertexOffset} vertices, ${triangleCount} triangles.`);
