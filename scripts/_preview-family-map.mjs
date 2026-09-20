import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conversionManifest = JSON.parse(
  readFileSync(path.join(rootDir, 'wasm/converter-core/manifest/conversions.json'), 'utf8')
);
const previewFormatsSource = readFileSync(path.join(rootDir, 'packages/core/src/preview/formats.ts'), 'utf8');
const conversionExtsByTarget = conversionManifest.reduce((map, pair) => {
  const sourceFormat = String(pair.sourceFormat || '').toLowerCase();
  const targetFormat = String(pair.targetFormat || '').toLowerCase();
  if (!sourceFormat || !targetFormat) return map;
  const list = map.get(targetFormat) ?? [];
  list.push(sourceFormat);
  map.set(targetFormat, list);
  return map;
}, new Map());
const conversionPagedExts = conversionExtsByTarget.get('pptx') ?? [];
const conversionFlowExts = conversionExtsByTarget.get('docx') ?? [];
const conversionWorkbookExts = conversionExtsByTarget.get('xlsx') ?? [];
const conversionSourceExts = [...conversionPagedExts, ...conversionFlowExts, ...conversionWorkbookExts];

const directFamilies = parseDirectFamilies(previewFormatsSource);

function expectedFamilyForExt(ext) {
  const e = String(ext || '').toLowerCase();
  const directFamily = directFamilies.get(e);
  if (directFamily) return directFamily;
  if (['pptx', ...conversionPagedExts].includes(e)) return 'paged';
  if (['key', 'pages', 'numbers'].includes(e)) return 'paged';
  if (['pdf'].includes(e)) return 'paged';
  if (conversionFlowExts.includes(e)) return 'flow';
  if (conversionWorkbookExts.includes(e)) return 'workbook';
  if (['dxf'].includes(e)) return 'cad';
  if (['xmind', 'mm', 'opml'].includes(e)) return 'mindmap';
  if (['drawio', 'dio', 'vdx', 'vsdx'].includes(e)) return 'diagram';
  if (['zip'].includes(e)) return 'archive';
  if (['epub', 'cbz'].includes(e)) return 'ebook';
  if (['png'].includes(e)) return 'image';
  if (['stl', 'obj', 'ply', 'gltf', 'glb', '3mf', 'amf', 'dae', 'fbx', '3ds', 'usdz', 'gcode', 'gco', 'nc', 'wrl', 'vrml', 'pcd', 'xyz', 'vtk', 'vox', 'ldr', 'mpd', 'kmz', 'md2', 'lwo', 'bvh', 'pdb', 'nrrd', 'nhdr'].includes(e)) return 'model3d';
  return null;
}

function parseDirectFamilies(source) {
  const routeBlock = source.match(/export const DIRECT_FORMAT_ROUTES:[\s\S]*?\];/)?.[0] ?? '';
  const families = new Map();
  for (const match of routeBlock.matchAll(/defineRoute\(\s*\[([^\]]+)\]\s*,\s*'([^']+)'/g)) {
    const family = match[2];
    for (const extMatch of match[1].matchAll(/'([^']+)'/g)) {
      const ext = extMatch[1].trim().toLowerCase();
      if (ext) families.set(ext, family);
    }
  }
  return families;
}

export { conversionSourceExts, expectedFamilyForExt };
