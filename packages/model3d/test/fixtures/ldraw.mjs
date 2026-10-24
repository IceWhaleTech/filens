export const ldrawReference = (name, x = 0, y = 0, color = 16) => `1 ${color} ${x} ${y} 0 1 0 0 0 1 0 0 0 1 ${name}\n`;
export function createLDrawPartsFixture() {
  const face = '0 !LDRAW_ORG Subpart\n0 BFC CERTIFY CCW\n4 16 0 0 0 4 0 0 4 4 0 0 4 0\n2 24 0 0 0 4 0 0\n5 24 4 0 0 4 4 0 0 0 0 0 4 0\n';
  const part = '0 !LDRAW_ORG Part\n0 BFC CERTIFY CCW\n' + ldrawReference('s/face.dat', 2, 3);
  const source = '0 FILE main.ldr\n0 !LDRAW_ORG Model\n0 !COLOUR Red CODE 4 VALUE #FF0000 EDGE #333333\n0 BFC CERTIFY CCW\n'
    + ldrawReference('parts/box.dat', 10, 0, 4) + ldrawReference('parts/box.dat', 30, 0, 4);
  const packed = source + '0 FILE parts/box.dat\n' + part + '0 FILE parts/s/face.dat\n' + face;
  const expectedPositions = [12, 32].flatMap(x => [x, 3, 0, x + 4, 3, 0, x + 4, 7, 0, x, 3, 0, x + 4, 7, 0, x, 7, 0]);
  return { source, part, face, packed, expectedPositions, expectedNormals: Array.from({ length: 12 }, () => [0, 0, 1]).flat() };
}

// Every triangle contributes visible geometry; no padding or ignored comments.
export function createLDrawBenchmarkFixture(triangles = 10000) {
  const width = Math.ceil(Math.sqrt(triangles)), lines = ['0 !LDRAW_ORG Part', '0 BFC CERTIFY CCW'];
  const positions = new Float32Array(triangles * 9), normals = new Float32Array(triangles * 9);
  for (let i = 0; i < triangles; i++) {
    const x = i % width * 2, y = Math.floor(i / width) * 2;
    const values = [x, y, 0, x + 1, y, 0, x, y + 1, 0];
    lines.push('3 16 ' + values.join(' ')); positions.set(values, i * 9); normals.set([0, -0, 1, 0, -0, 1, 0, -0, 1], i * 9);
  }
  return { source: '0 FILE main.ldr\n0 !LDRAW_ORG Model\n' + ldrawReference('parts/mesh.dat'),
    part: lines.join('\n') + '\n', positions, normals, triangles };
}

export function createLDrawSmoothingFixture(mode = 'curved') {
  const lines = ['0 !LDRAW_ORG Subpart', '0 BFC CERTIFY CCW'];
  const point = (x, y, shift = 0) => [x + shift, y, mode === 'sharp' ? (x < 2 ? 0 : (x - 2) * 4) : Math.sin(x * 0.5) + Math.cos(y * 0.3)];
  const faces = [];
  for (let block = 0; block < (mode === 'disconnected' ? 8 : 1); block++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const a = point(x, y, block * 6), b = point(x + 1, y, block * 6), c = point(x + 1, y + 1, block * 6), d = point(x, y + 1, block * 6);
    const color = mode === 'multicolor' && (x + y) % 2 ? '0x23388CC' : '16';
    if (mode === 'quads') faces.push(`4 ${color} ${[...a, ...b, ...c, ...d].join(' ')}`);
    else {
      faces.push(`3 ${color} ${[...a, ...b, ...c].join(' ')}`);
      faces.push(`3 ${color} ${[...a, ...c, ...d].join(' ')}`);
    }
    if (mode === 'hard' || mode === 'multicolor') lines.push(`2 24 ${[...a, ...c].join(' ')}`);
  }
  if (mode === 'reordered') faces.reverse();
  if (mode === 'duplicates') faces.push(...faces.slice(0, 4));
  lines.push(...faces);
  return '0 FILE main.ldr\n0 !LDRAW_ORG Part\n0 BFC CERTIFY CCW\n' + ldrawReference('sheet.dat') + '0 FILE sheet.dat\n' + lines.join('\n') + '\n';
}
