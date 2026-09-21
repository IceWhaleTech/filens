<script setup lang="ts">
import JSZip from 'jszip';
import { computed, ref, shallowRef, watch } from 'vue';
import AppleLivePhotoPreview from './components/AppleLivePhotoPreview.vue';
import { createWasmConverterClient } from '@filens/converter-client';
import { createWasmPanoramaProcessor } from '@filens/panorama';
import { createZipArchiveResourceIndex, type ZipArchiveResource } from '@filens/archive';
import { createVueDefaultPreviewRoutes, IworkPreview, Preview, PptxPreview } from '@filens/vue';
import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';
import {
  createFileSetResourceResolver,
  createPreviewAcceptAttribute,
  inferExtensionFromName,
  listPreviewFormats,
  type PreviewFamily,
  type PreviewFontResolver,
  type PagedPreviewState,
  type WorkbookPreviewState,
  type EbookPreviewState,
  type DiagramPreviewState,
  type PreviewItemState,
  type Model3dPreviewState,
  type PreviewResourceResolver,
  type PreviewSource
} from '@filens/core';

type DemoKind =
  | 'pptx'
  | 'key'
  | 'pages'
  | 'numbers'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'ppt'
  | 'cad'
  | 'model3d'
  | 'mindmap'
  | 'diagram'
  | 'image'
  | 'panorama'
  | 'text'
  | 'code'
  | 'html'
  | 'epub'
  | 'cbz'
  | 'zip'
  | 'audio'
  | 'video';
type SourceMode = 'sample' | 'url' | 'upload' | 'generated';

interface DemoSource {
  kind: DemoKind;
  label: string;
  name: string;
  source: PreviewSource;
  extension?: string;
  contentType?: string;
  mode?: SourceMode;
  catalogId?: string;
  livePhoto?: {
    photoSrc: string;
    videoSrc: string;
    originalPhotoSrc?: string;
    originalVideoSrc?: string;
  };
  resourceResolver?: PreviewResourceResolver;
}

type ConversionManifestEntry = { sourceFormat: string; targetFormat: string };

const conversionKindBySource = new Map<string, DemoKind>(
  [...conversionManifest as ConversionManifestEntry[]].reverse().map((entry) => [entry.sourceFormat, demoKindForConversionTarget(entry.targetFormat)])
);
const converterCoreWasmUrl = new URL('../../../wasm/converter-core/dist/converter-core.wasm', import.meta.url).href;

const staticSamples: DemoSource[] = [
  {
    kind: 'pptx',
    label: 'PPTX',
    name: 'vue-office-test.pptx',
    source: '/samples/vue-office-test.pptx'
  },
  {
    kind: 'pptx',
    label: 'PPTX Shapes',
    name: 'rich-pptx-shapes.pptx',
    source: '/samples/rich-pptx-shapes.pptx'
  },
  {
    kind: 'pptx',
    label: 'PPTX Pictures',
    name: 'rich-pptx-pictures.pptx',
    source: '/samples/rich-pptx-pictures.pptx'
  },
  {
    kind: 'key',
    label: 'Keynote',
    name: 'a.key',
    source: '/samples/a.key'
  },
  {
    kind: 'pages',
    label: 'Pages',
    name: 'a.pages',
    source: '/samples/a.pages'
  },
  {
    kind: 'numbers',
    label: 'Numbers',
    name: 'a.numbers',
    source: '/samples/a.numbers'
  },
  {
    kind: 'pdf',
    label: 'PDF',
    name: 'generated.pdf',
    source: new Uint8Array(),
    contentType: 'application/pdf',
    mode: 'generated'
  },
  {
    kind: 'image',
    label: 'AI Neon Poster -> SVG',
    name: 'neon-orbit.ai.svg',
    source: createVectorPosterDataUrl('NEON ORBIT', 'ADOBE ILLUSTRATOR SHOWCASE', '#22d3ee'),
    contentType: 'image/svg+xml',
    mode: 'generated',
    catalogId: 'ai'
  },
  {
    kind: 'image',
    label: 'PSD Chromatic Layers -> SVG',
    name: 'chromatic-layers.psd.svg',
    source: createVectorPosterDataUrl('CHROMATIC', 'PHOTOSHOP LAYER COMPOSITION', '#fb923c'),
    contentType: 'image/svg+xml',
    mode: 'generated',
    catalogId: 'psd'
  },
  {
    kind: 'image',
    label: 'EPS Signal Poster -> SVG',
    name: 'signal-void.eps.svg',
    source: createVectorPosterDataUrl('SIGNAL VOID', 'ENCAPSULATED POSTSCRIPT SHOWCASE', '#f43f8b'),
    contentType: 'image/svg+xml',
    mode: 'generated',
    catalogId: 'eps'
  },
  {
    kind: 'image',
    label: 'PS Future Poster -> SVG',
    name: 'future-grid.ps.svg',
    source: createVectorPosterDataUrl('FUTURE GRID', 'POSTSCRIPT SHOWCASE', '#c7f52e'),
    contentType: 'image/svg+xml',
    mode: 'generated',
    catalogId: 'ps'
  },
  {
    kind: 'docx',
    label: 'DOCX',
    name: 'generated.docx',
    source: new Uint8Array(),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'DOCX Images',
    name: 'rich-docx-images.docx',
    source: '/samples/rich-docx-images.docx'
  },
  {
    kind: 'docx',
    label: 'DOCX Tables',
    name: 'rich-docx-tables.docx',
    source: '/samples/rich-docx-tables.docx'
  },
  {
    kind: 'docx',
    label: 'DOCM Report -> DOCX',
    name: 'office-showcase.docm',
    source: new Uint8Array(),
    contentType: 'application/vnd.ms-word.document.macroEnabled.12',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'DOT Project Template -> DOCX',
    name: 'project-brief.dot',
    source: '/samples/legacy-project-workflow.doc',
    contentType: 'application/msword',
    mode: 'sample'
  },
  {
    kind: 'docx',
    label: 'DOTX Report Template -> DOCX',
    name: 'office-showcase.dotx',
    source: new Uint8Array(),
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'DOTM Macro Template -> DOCX',
    name: 'office-showcase.dotm',
    source: new Uint8Array(),
    contentType: 'application/vnd.ms-word.template.macroEnabled.12',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'DOC Project Report -> DOCX',
    name: 'legacy-project-workflow.doc',
    source: '/samples/legacy-project-workflow.doc',
    contentType: 'application/msword',
    mode: 'sample'
  },
  {
    kind: 'docx',
    label: 'Rich RTF -> DOCX',
    name: 'rich-text.rtf',
    source: '/samples/rich-text.rtf',
    contentType: 'application/rtf',
    mode: 'sample'
  },
  {
    kind: 'docx',
    label: 'WPS Compatibility -> DOCX',
    name: 'project-brief.wps',
    source: '/samples/legacy-project-workflow.doc',
    contentType: 'application/vnd.ms-works',
    mode: 'sample'
  },
  {
    kind: 'docx',
    label: 'WPT Project Template -> DOCX',
    name: 'project-brief.wpt',
    source: '/samples/legacy-project-workflow.doc',
    contentType: 'application/vnd.ms-works',
    mode: 'sample'
  },
  {
    kind: 'docx',
    label: 'ODT Product Brief -> DOCX',
    name: 'product-brief.odt',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.text',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'OTT Product Template -> DOCX',
    name: 'product-brief.ott',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.text-template',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'FODT Product Brief -> DOCX',
    name: 'product-brief.fodt',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.text-flat-xml',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'SXW Writer Project Brief -> DOCX',
    name: 'openoffice-project.sxw',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.writer',
    mode: 'generated'
  },
  {
    kind: 'docx',
    label: 'STW Writer Template -> DOCX',
    name: 'openoffice-project.stw',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.writer.template',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'XLSX',
    name: 'generated.xlsx',
    source: new Uint8Array(),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'XLSX Formulas',
    name: 'rich-xlsx-formulas.xlsx',
    source: '/samples/rich-xlsx-formulas.xlsx'
  },
  {
    kind: 'xlsx',
    label: 'XLSX Data Types',
    name: 'rich-xlsx-data-types.xlsx',
    source: '/samples/rich-xlsx-data-types.xlsx'
  },
  {
    kind: 'xlsx',
    label: 'XLSX Many Columns',
    name: 'rich-xlsx-many-columns.xlsx',
    source: '/samples/rich-xlsx-many-columns.xlsx'
  },
  {
    kind: 'xlsx',
    label: 'XLS Solver Workbook -> XLSX',
    name: 'SOLVSAMP.XLS',
    source: new URL('../../../examples/go-wazero-converter/fixtures/xls/SOLVSAMP.XLS', import.meta.url).href,
    contentType: 'application/vnd.ms-excel',
    mode: 'sample'
  },
  {
    kind: 'xlsx',
    label: 'XLSM Finance Dashboard -> XLSX',
    name: 'finance-dashboard.xlsm',
    source: new Uint8Array(),
    contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'XLT Solver Template -> XLSX',
    name: 'finance-model.xlt',
    source: new URL('../../../examples/go-wazero-converter/fixtures/xls/SOLVSAMP.XLS', import.meta.url).href,
    contentType: 'application/vnd.ms-excel',
    mode: 'sample'
  },
  {
    kind: 'xlsx',
    label: 'XLTX Dashboard Template -> XLSX',
    name: 'finance-dashboard.xltx',
    source: new Uint8Array(),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'XLTM Macro Template -> XLSX',
    name: 'finance-dashboard.xltm',
    source: new Uint8Array(),
    contentType: 'application/vnd.ms-excel.template.macroEnabled.12',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'ET Compatibility -> XLSX',
    name: 'finance-model.et',
    source: new URL('../../../examples/go-wazero-converter/fixtures/xls/SOLVSAMP.XLS', import.meta.url).href,
    contentType: 'application/vnd.ms-excel',
    mode: 'sample'
  },
  {
    kind: 'xlsx',
    label: 'ETT Solver Template -> XLSX',
    name: 'finance-model.ett',
    source: new URL('../../../examples/go-wazero-converter/fixtures/xls/SOLVSAMP.XLS', import.meta.url).href,
    contentType: 'application/vnd.ms-excel',
    mode: 'sample'
  },
  {
    kind: 'xlsx',
    label: 'ODS Styled Sheets -> XLSX',
    name: 'rich-spreadsheet.ods',
    source: '/samples/rich-spreadsheet.ods',
    contentType: 'application/vnd.oasis.opendocument.spreadsheet',
    mode: 'sample'
  },
  {
    kind: 'xlsx',
    label: 'OTS Styled Template -> XLSX',
    name: 'operations-dashboard.ots',
    source: '/samples/rich-spreadsheet.ods',
    contentType: 'application/vnd.oasis.opendocument.spreadsheet-template',
    mode: 'sample'
  },
  {
    kind: 'xlsx',
    label: 'FODS Operations Dashboard -> XLSX',
    name: 'operations-dashboard.fods',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.spreadsheet-flat-xml',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'SXC Calc Dashboard -> XLSX',
    name: 'openoffice-dashboard.sxc',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.calc',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'STC Calc Template -> XLSX',
    name: 'openoffice-dashboard.stc',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.calc.template',
    mode: 'generated'
  },
  {
    kind: 'csv',
    label: 'CSV',
    name: 'sales.csv',
    source: createCsvFixture(),
    contentType: 'text/csv',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'TSV Sales Matrix -> XLSX',
    name: 'sales-matrix.tsv',
    source: new TextEncoder().encode('Region\tQ1\tQ2\tQ3\tQ4\nNorth\t42500\t58750.5\t49300\t68120.75\nSouth\t31800\t-725.5\t44200\t51900\nTotal\t74300\t58025\t93500\t120020.75'),
    contentType: 'text/tab-separated-values',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'TAB Capacity Plan -> XLSX',
    name: 'capacity-plan.tab',
    source: new TextEncoder().encode('Team\tCapacity\tAllocated\tRemaining\nPlatform\t120\t96\t24\nViewer\t90\t72\t18\nQA\t64\t51\t13'),
    contentType: 'text/tab-separated-values',
    mode: 'generated'
  },
  {
    kind: 'xlsx',
    label: 'PSV Pipeline -> XLSX',
    name: 'delivery-pipeline.psv',
    source: new TextEncoder().encode('Stage|Owner|Status|Budget\nDiscovery|Ava|Done|12500\nBuild|Noah|Active|48200\nLaunch|Mia|Planned|19000'),
    contentType: 'text/plain',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'PPT Multi-slide -> PPTX',
    name: 'legacy-sample-show.ppt',
    source: '/samples/legacy-sample-show.ppt',
    contentType: 'application/vnd.ms-powerpoint',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'PPS Multi-slide -> PPTX',
    name: 'legacy-sample-show.pps',
    source: '/samples/legacy-sample-show.pps',
    contentType: 'application/vnd.ms-powerpoint',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'POT Strategy Template -> PPTX',
    name: 'legacy-strategy.pot',
    source: '/samples/legacy-sample-show.ppt',
    contentType: 'application/vnd.ms-powerpoint',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'PPTM Visual Story -> PPTX',
    name: 'visual-story.pptm',
    source: '/samples/rich-pptx-shapes.pptx',
    contentType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'PPSX Visual Story -> PPTX',
    name: 'visual-story.ppsx',
    source: '/samples/rich-pptx-shapes.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'PPSM Visual Story -> PPTX',
    name: 'visual-story.ppsm',
    source: '/samples/rich-pptx-shapes.pptx',
    contentType: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'POTX Visual Template -> PPTX',
    name: 'visual-story.potx',
    source: '/samples/rich-pptx-shapes.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.template',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'POTM Visual Template -> PPTX',
    name: 'visual-story.potm',
    source: '/samples/rich-pptx-shapes.pptx',
    contentType: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'DPS Multi-slide -> PPTX',
    name: 'legacy-strategy.dps',
    source: '/samples/legacy-sample-show.ppt',
    contentType: 'application/vnd.ms-powerpoint',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'DPT Strategy Template -> PPTX',
    name: 'legacy-strategy.dpt',
    source: '/samples/legacy-sample-show.ppt',
    contentType: 'application/vnd.ms-powerpoint',
    mode: 'sample'
  },
  {
    kind: 'ppt',
    label: 'ODP Quarterly Review -> PPTX',
    name: 'quarterly-review.odp',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.presentation',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'OTP Quarterly Template -> PPTX',
    name: 'quarterly-review.otp',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.presentation-template',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'FODP Quarterly Review -> PPTX',
    name: 'quarterly-review.fodp',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.presentation-flat-xml',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'SXI Impress Review -> PPTX',
    name: 'openoffice-review.sxi',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.impress',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'STI Impress Template -> PPTX',
    name: 'openoffice-review.sti',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.impress.template',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'ODG Design Boards -> PPTX',
    name: 'design-boards.odg',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.graphics',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'OTG Design Template -> PPTX',
    name: 'design-boards.otg',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.graphics-template',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'FODG Design Boards -> PPTX',
    name: 'design-boards.fodg',
    source: new Uint8Array(),
    contentType: 'application/vnd.oasis.opendocument.graphics-flat-xml',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'SXD Draw Boards -> PPTX',
    name: 'design-boards.sxd',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.draw',
    mode: 'generated'
  },
  {
    kind: 'ppt',
    label: 'STD Draw Template -> PPTX',
    name: 'design-boards.std',
    source: new Uint8Array(),
    contentType: 'application/vnd.sun.xml.draw.template',
    mode: 'generated'
  },
  {
    kind: 'cad',
    label: 'DXF',
    name: 'floorplan.dxf',
    source: createDxfFixture(),
    contentType: 'image/vnd.dxf',
    mode: 'generated'
  },
  {
    kind: 'cad',
    label: 'Neon City DXF',
    name: 'neon-city.dxf',
    source: createNeonCityDxfFixture(),
    contentType: 'image/vnd.dxf',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'STL',
    name: 'printed-part.stl',
    source: createStlFixture(),
    contentType: 'model/stl',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'OBJ',
    name: 'low-poly-part.obj',
    source: createObjFixture(),
    contentType: 'model/obj',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'Crystal Crown OBJ',
    name: 'crystal-crown.obj',
    source: createCrystalCrownObjFixture(),
    contentType: 'model/obj',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'PLY',
    name: 'scan-mesh.ply',
    source: createPlyFixture(),
    contentType: 'model/ply',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'GLB',
    name: 'scene.glb',
    source: createGlbFixture(),
    contentType: 'model/gltf-binary',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'glTF',
    name: 'scene.gltf',
    source: createGltfFixture(),
    contentType: 'model/gltf+json',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: '3MF',
    name: 'printer-job.3mf',
    source: new Uint8Array(),
    contentType: 'model/3mf',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'VTK',
    name: 'surface.vtk',
    source: createVtkFixture(),
    contentType: 'model/vtk',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'VOX',
    name: 'voxel.vox',
    source: createVoxFixture(),
    contentType: 'application/x-magica-voxel',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'LDraw',
    name: 'brick.ldr',
    source: createLDrawFixture(),
    contentType: 'model/vnd.ldraw',
    mode: 'generated'
  },
  {
    kind: 'model3d',
    label: 'KMZ',
    name: 'scene.kmz',
    source: new Uint8Array(),
    contentType: 'application/vnd.google-earth.kmz',
    mode: 'generated'
  },
  {
    kind: 'mindmap',
    label: 'FreeMind',
    name: 'launch-plan.mm',
    source: createMmFixture(),
    contentType: 'application/xml',
    mode: 'generated'
  },
  {
    kind: 'mindmap',
    label: 'Moonshot 2035',
    name: 'moonshot-2035.mm',
    source: createMoonshotMmFixture(),
    contentType: 'application/xml',
    mode: 'generated'
  },
  {
    kind: 'mindmap',
    label: 'XMind',
    name: 'brainstorm.xmind',
    source: new Uint8Array(),
    contentType: 'application/x-xmind',
    mode: 'generated'
  },
  {
    kind: 'diagram',
    label: 'draw.io',
    name: 'flow.drawio',
    source: createDrawioFixture(),
    contentType: 'application/xml',
    mode: 'generated'
  },
  {
    kind: 'diagram',
    label: 'AI Command Center',
    name: 'ai-command-center.drawio',
    source: createCommandCenterDrawioFixture(),
    contentType: 'application/xml',
    mode: 'generated'
  },
  {
    kind: 'diagram',
    label: 'VSDX',
    name: 'flow.vsdx',
    source: new Uint8Array(),
    contentType: 'application/vnd.visio',
    mode: 'generated'
  },
  {
    kind: 'diagram',
    label: 'VDX',
    name: 'flow.vdx',
    source: createVdxFixture(),
    contentType: 'application/xml',
    mode: 'generated'
  },
  {
    kind: 'image',
    label: 'PNG · Transparency',
    name: 'photo-transparency.png',
    source: '/samples/photo-transparency.png',
    contentType: 'image/png',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'JPEG · Alpine Lake',
    name: 'photo-alpine-lake.jpg',
    source: '/samples/photo-alpine-lake.jpg',
    contentType: 'image/jpeg',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'GIF · Animated Earth',
    name: 'photo-animated-earth.gif',
    source: '/samples/photo-animated-earth.gif',
    contentType: 'image/gif',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'WebP · Gallery',
    name: 'photo-gallery.webp',
    source: '/samples/photo-gallery.webp',
    contentType: 'image/webp',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'AVIF · Alpine Lake',
    name: 'photo-alpine-lake.avif',
    source: '/samples/photo-alpine-lake.avif',
    contentType: 'image/avif',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'APNG · Animated Earth',
    name: 'photo-animated-earth.apng',
    source: '/samples/photo-animated-earth.apng',
    contentType: 'image/apng',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'ICO · Transparency',
    name: 'photo-transparency.ico',
    source: '/samples/photo-transparency.ico',
    contentType: 'image/x-icon',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'BMP · Camera Sample',
    name: 'photo-sample.bmp',
    source: '/samples/photo-sample.bmp',
    contentType: 'image/bmp',
    mode: 'sample'
  },
  {
    kind: 'image',
    label: 'Canon CR2 RAW',
    name: 'canon-40d-sraw.cr2',
    source: '/samples/raw/canon-40d-sraw.cr2',
    mode: 'sample',
    catalogId: 'cr2'
  },
  {
    kind: 'image',
    label: 'Canon R6 CR3 RAW',
    name: 'canon-r6.cr3',
    source: '/samples/raw/canon-r6.cr3',
    mode: 'sample',
    catalogId: 'cr3'
  },
  {
    kind: 'image',
    label: 'Nikon NEF RAW',
    name: 'nikon-iss.nef',
    source: '/samples/raw/nikon-iss.nef',
    mode: 'sample',
    catalogId: 'nef'
  },
  {
    kind: 'image',
    label: 'Olympus ORF RAW',
    name: 'olympus-stylus.orf',
    source: '/samples/raw/olympus-stylus.orf',
    mode: 'sample',
    catalogId: 'orf'
  },
  {
    kind: 'image',
    label: 'Pentax PEF RAW',
    name: 'pentax-k-r.pef',
    source: '/samples/raw/pentax-k-r.pef',
    mode: 'sample',
    catalogId: 'pef'
  },
  {
    kind: 'image',
    label: 'Pentax DNG RAW',
    name: 'pentax-k-r.dng',
    source: '/samples/raw/pentax-k-r.dng',
    mode: 'sample',
    catalogId: 'dng'
  },
  {
    kind: 'panorama',
    label: 'Panorama',
    name: 'kochelsee-16k.panorama',
    source: '/samples/kochelsee-panorama.jpg',
    contentType: 'image/jpeg',
    mode: 'sample'
  },
  {
    kind: 'panorama',
    label: 'Insta360 One RS · Stitched JPEG',
    name: 'insta360-oners-tallinn.jpg',
    source: '/samples/panorama/insta360-oners-tallinn.jpg',
    extension: 'pano',
    contentType: 'image/jpeg',
    mode: 'sample',
    catalogId: 'insta360-photo'
  },
  {
    kind: 'panorama',
    label: 'DJI Osmo 360 · Stitched JPEG',
    name: 'osmo-360-leipzig.jpg',
    source: '/samples/panorama/osmo-360-leipzig.jpg',
    extension: 'pano',
    contentType: 'image/jpeg',
    mode: 'sample',
    catalogId: 'osmo360-photo'
  },
  {
    kind: 'panorama',
    label: '360 Video · NASA Black Hole',
    name: 'nasa-black-hole-360.webm',
    source: '/samples/panorama/nasa-black-hole-360.webm',
    extension: '360v',
    contentType: 'video/webm',
    mode: 'sample',
    catalogId: '360v'
  },
  {
    kind: 'panorama',
    label: 'Pano',
    name: 'kochelsee-16k.pano',
    source: '/samples/kochelsee-panorama.jpg',
    contentType: 'image/jpeg',
    mode: 'sample'
  },
  {
    kind: 'panorama',
    label: '360',
    name: 'kochelsee-16k.360',
    source: '/samples/kochelsee-panorama.jpg',
    contentType: 'image/jpeg',
    mode: 'sample'
  },
  {
    kind: 'video',
    label: 'Apple · iPhone 15',
    name: 'apple-iphone-15-live-photo.HEIC + MOV',
    source: '/samples/live-photo/apple-iphone-15-live-photo.mp4',
    contentType: 'video/mp4',
    mode: 'sample',
    catalogId: 'apple-live-photo',
    livePhoto: {
      photoSrc: '/samples/live-photo/apple-iphone-15-live-photo.jpg',
      videoSrc: '/samples/live-photo/apple-iphone-15-live-photo.mp4',
      originalPhotoSrc: '/samples/live-photo/apple-iphone-15-live-photo.HEIC',
      originalVideoSrc: '/samples/live-photo/apple-iphone-15-live-photo.MOV'
    }
  },
  {
    kind: 'image',
    label: 'Google · Pixel 9 Pro XL',
    name: 'pixel-9-pro-xl-ultra-hdr-motion-photo.jpg',
    source: '/samples/live-photo/pixel-9-pro-xl-ultra-hdr-motion-photo.jpg',
    contentType: 'image/jpeg',
    mode: 'sample',
    catalogId: 'google-motion-photo'
  },
  {
    kind: 'image',
    label: 'Samsung · Galaxy A34',
    name: 'galaxy-a34-motion-photo.jpg',
    source: '/samples/live-photo/galaxy-a34-motion-photo.jpg',
    contentType: 'image/jpeg',
    mode: 'sample',
    catalogId: 'samsung-a34-motion-photo'
  },
  {
    kind: 'image',
    label: 'Samsung · Galaxy S20 FE',
    name: 'galaxy-s20fe-motion-photo.jpg',
    source: '/samples/live-photo/galaxy-s20fe-motion-photo.jpg',
    contentType: 'image/jpeg',
    mode: 'sample',
    catalogId: 'samsung-s20fe-motion-photo'
  },
  {
    kind: 'image',
    label: 'Samsung · Galaxy Tab S9',
    name: 'galaxy-tab-s9-motion-photo.jpg',
    source: '/samples/live-photo/galaxy-tab-s9-motion-photo.jpg',
    contentType: 'image/jpeg',
    mode: 'sample',
    catalogId: 'samsung-tab-s9-motion-photo'
  },
  {
    kind: 'text',
    label: 'Text',
    name: 'notes.txt',
    source: createTextFixture(),
    contentType: 'text/plain',
    mode: 'generated'
  },
  {
    kind: 'text',
    label: 'Log',
    name: 'preview.log',
    source: new TextEncoder().encode('[info] preview started\n[warn] missing optional font\n[info] preview completed in 42ms\n'),
    contentType: 'text/plain',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'Code',
    name: 'preview.ts',
    source: createCodeFixture(),
    contentType: 'text/plain',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'Markdown',
    name: 'README.md',
    source: new TextEncoder().encode('# filens\n\n- Browser-native preview\n- Multiple text formats\n- No server conversion required\n'),
    contentType: 'text/markdown',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'JSON',
    name: 'preview.json',
    source: new TextEncoder().encode('{\n  "name": "filens",\n  "formats": ["txt", "markdown", "json"]\n}\n'),
    contentType: 'application/json',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'YAML',
    name: 'preview.yaml',
    source: new TextEncoder().encode('name: filens\nformats:\n  - txt\n  - markdown\n  - yaml\n'),
    contentType: 'application/yaml',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'TOML',
    name: 'preview.toml',
    source: new TextEncoder().encode('name = "filens"\nformats = ["txt", "markdown", "toml"]\n'),
    contentType: 'application/toml',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'XML',
    name: 'preview.xml',
    source: new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>\n<previewer><format>xml</format></previewer>\n'),
    contentType: 'application/xml',
    mode: 'generated'
  },
  {
    kind: 'code',
    label: 'Python',
    name: 'preview.py',
    source: new TextEncoder().encode('def preview(file_name: str) -> str:\n    return f"Previewing {file_name}"\n'),
    contentType: 'text/x-python',
    mode: 'generated'
  },
  {
    kind: 'html',
    label: 'HTML',
    name: 'converted.html',
    source: createHtmlFixture(),
    contentType: 'text/html',
    mode: 'generated'
  },
  {
    kind: 'epub',
    label: 'EPUB',
    name: 'fixture-book.epub',
    source: new Uint8Array(),
    contentType: 'application/epub+zip',
    mode: 'generated'
  },
  {
    kind: 'cbz',
    label: 'CBZ',
    name: 'comic.cbz',
    source: new Uint8Array(),
    contentType: 'application/vnd.comicbook+zip',
    mode: 'generated'
  },
  {
    kind: 'zip',
    label: 'ZIP',
    name: 'preview-bundle.zip',
    source: new Uint8Array(),
    contentType: 'application/zip',
    mode: 'generated'
  },
  {
    kind: 'zip',
    label: 'TAR',
    name: 'sample-archive.tar',
    source: '/samples/sample-archive.tar',
    contentType: 'application/x-tar'
  },
  {
    kind: 'zip',
    label: 'TAR.GZ',
    name: 'sample-archive.tgz',
    source: '/samples/sample-archive.tgz',
    contentType: 'application/gzip'
  },
  {
    kind: 'zip',
    label: 'GZIP',
    name: 'sample-readme.md.gz',
    source: Uint8Array.from(atob('H4sIAAAAAAAACnMsSs7ILEtVKChKLctMLVdwj/IMUChOzC3ISeUCAIad+SEcAAAA'), (character) => character.charCodeAt(0)),
    contentType: 'application/gzip'
  },
  {
    kind: 'zip',
    label: 'TAR.GZ Alias',
    name: 'sample-archive.tar.gz',
    source: '/samples/sample-archive-tar-gz.bin',
    contentType: 'application/gzip',
    catalogId: 'tar-gz'
  },
  {
    kind: 'zip',
    label: 'JAR',
    name: 'sample-library.jar',
    source: '/samples/sample-library.jar',
    contentType: 'application/java-archive'
  },
  {
    kind: 'zip',
    label: 'WAR',
    name: 'sample-webapp.war',
    source: '/samples/sample-webapp.war',
    contentType: 'application/zip'
  },
  {
    kind: 'zip',
    label: 'EAR',
    name: 'sample-enterprise.ear',
    source: '/samples/sample-enterprise.ear',
    contentType: 'application/zip'
  },
  {
    kind: 'zip',
    label: 'APK',
    name: 'sample-app.apk',
    source: '/samples/sample-app.apk',
    contentType: 'application/vnd.android.package-archive'
  },
  {
    kind: 'zip',
    label: 'Nested Archives',
    name: 'sample-nested-archives.zip',
    source: '/samples/sample-nested-archives.zip',
    contentType: 'application/zip',
    catalogId: 'nested-zip'
  },
  {
    kind: 'audio',
    label: 'Audio',
    name: 'tone.wav',
    source: createToneWav(),
    contentType: 'audio/wav',
    mode: 'generated'
  },
  {
    kind: 'audio',
    label: 'MP3 URL',
    name: 't-rex-roar.mp3',
    source: '/external-samples/mdn-audio/t-rex-roar.mp3',
    contentType: 'audio/mpeg',
    mode: 'url'
  },
  {
    kind: 'audio',
    label: 'Ogg URL',
    name: 'example.ogg',
    source: '/external-samples/wikimedia/c/c8/Example.ogg',
    contentType: 'audio/ogg',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'Video URL',
    name: 'sample-video.mp4',
    source: '/external-samples/mdn-video/flower.mp4',
    contentType: 'video/mp4',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'WebM URL',
    name: 'flower.webm',
    source: '/external-samples/mdn-video/flower.webm',
    contentType: 'video/webm',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'MOV URL',
    name: 'sample.mov',
    source: '/external-samples/filesamples/video/mov/sample_640x360.mov',
    contentType: 'video/quicktime',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'M4V URL',
    name: 'sample.m4v',
    source: '/external-samples/filesamples/video/m4v/sample_640x360.m4v',
    contentType: 'video/x-m4v',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'Ogg Video URL',
    name: 'sample.ogv',
    source: '/external-samples/filesamples/video/ogv/sample_640x360.ogv',
    contentType: 'video/ogg',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'Matroska URL',
    name: 'sample.mkv',
    source: '/external-samples/filesamples/video/mkv/sample_640x360.mkv',
    contentType: 'video/x-matroska',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'AVI URL',
    name: 'sample.avi',
    source: '/external-samples/filesamples/video/avi/sample_640x360.avi',
    contentType: 'video/x-msvideo',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'MPEG URL',
    name: 'sample.mpeg',
    source: '/external-samples/filesamples/video/mpeg/sample_640x360.mpeg',
    contentType: 'video/mpeg',
    mode: 'url'
  },
  {
    kind: 'video',
    label: 'MPG URL',
    name: 'sample.mpg',
    source: '/external-samples/filesamples/video/mpeg/sample_640x360.mpeg',
    contentType: 'video/mpeg',
    mode: 'url'
  },
  {
    kind: 'video',
    label: '3GP URL',
    name: 'sample.3gp',
    source: '/external-samples/filesamples/video/3gp/sample_640x360.3gp',
    contentType: 'video/3gpp',
    mode: 'url'
  }
];

const defaultRemoteUrl = 'https://501351981.github.io/vue-office/examples/dist/static/test-files/test.pptx';
const demoRoutes = createDemoPreviewRoutes();
const uploadAccept = createPreviewAcceptAttribute({ routes: demoRoutes });
const supportedFormats = listPreviewFormats({ routes: demoRoutes });
const formatSupportByExtension = new Map(supportedFormats.map((format) => [format.extension, format]));
const sampleByExtension = new Map(
  staticSamples.map((sample) => [sample.catalogId ?? inferExtensionFromName(sample.name) ?? '', sample])
);
const catalogOnlyFormats: Array<[string, PreviewFamily]> = [
  ...['dwg', 'dgn'].map((extension) => [extension, 'cad'] as [string, PreviewFamily]),
  ['fcstd', 'model3d'],
  ...['iges', 'igs', 'brep', 'brp'].map((extension) => [extension, 'model3d'] as [string, PreviewFamily]),
  ['ifc', 'model3d'],
  ['jpeg', 'panorama'],
  ['mp4', 'panorama'],
  ...['jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'dib', 'tif', 'tiff', 'ico', 'cur', 'heic', 'heif', 'avif', 'jxl', 'apng', 'tga', 'pcx', 'ppm', 'pgm', 'pbm', 'pnm', 'psd', 'psb', 'ai', 'eps', 'ps', 'dds', 'exr', 'hdr', 'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'orf', 'rw2', 'rwl', 'raf', 'kdc', 'x3f', 'pef', 'srw', 'erf', 'mef', 'mos', 'mrw', '3fr', 'iiq']
    .map((extension) => [extension, 'image'] as [string, PreviewFamily]),
  ...['zipx', 'rar', '7z', 'tar', 'gz', 'bz', 'bz2', 'xz', 'z', 'zst', 'tgz', 'tbz', 'tbz2', 'txz', 'lz', 'lzma', 'cab', 'iso', 'ar', 'cpio', 'ace', 'lha', 'lzh', 'zoo', 'xar', 'sit', 'sitx', 'apk', 'jar', 'war', 'ear', 'xpi', 'crx', 'deb', 'rpm', 'dmg', 'img', 'wim', 'swm', 'esd', 'pak', '001', 'cbr', 'cb7', 'cbt']
    .map((extension) => [extension, 'archive'] as [string, PreviewFamily])
];
const catalogFormatLabels = new Map([
  ['panorama:jpeg', 'JPEG (Osmo 360)'],
  ['panorama:mp4', 'MP4 (HEVC)'],
  ['image:ai', 'AI'],
  ['image:eps', 'EPS'],
  ['image:ps', 'PS']
]);
const livePhotoFormats = [
  ['apple-live-photo', 'Apple · iPhone 15'],
  ['google-motion-photo', 'Google · Pixel 9 Pro XL'],
  ['samsung-a34-motion-photo', 'Samsung · Galaxy A34'],
  ['samsung-s20fe-motion-photo', 'Samsung · Galaxy S20 FE'],
  ['samsung-tab-s9-motion-photo', 'Samsung · Galaxy Tab S9']
] as const;
const panoramaSampleFormats = [
  ['insta360-photo', 'Insta360 One RS'],
  ['osmo360-photo', 'Osmo 360']
] as const;
const externalPanoramaSamples = [
  {
    kind: 'panorama',
    format: 'INSP',
    label: 'Insta360 One RS 1-inch',
    name: 'IMG_20220701_170732_00_018.insp',
    source: '/external-samples/insta360/insp',
    contentType: 'image/jpeg',
    mode: 'url',
    size: '5.7 MB',
    sourcePage: 'https://drive.google.com/file/d/1H_7MHubgvRnRbBwT5gn2dCBwghqEqaDZ/view',
    note: 'Personal viewing only · embedded-calibration dual-fisheye'
  },
  {
    kind: 'panorama',
    format: 'INSV',
    label: 'Insta360 One RS calibrated raw pair',
    name: 'VID_20220625_140410_00_008.insv',
    source: '/external-samples/insta360/insv-00',
    contentType: 'video/mp4',
    mode: 'url',
    resourceResolver: async ({ relation }) => relation === 'companion'
      ? { source: '/external-samples/insta360/insv-10' }
      : undefined,
    size: '356 MB + 360 MB',
    sourcePage: 'https://drive.google.com/drive/folders/1Vwgjf1sy5DLiyZOhjMV8f1kx2iF67AhO',
    note: 'Personal viewing only · experimental calibrated dual-fisheye'
  },
  {
    kind: 'panorama',
    format: 'LRV',
    label: 'Insta360 One RS low-resolution proxy',
    name: 'LRV_20220625_140410_11_008.insv',
    source: '/external-samples/insta360/lrv',
    contentType: 'video/mp4',
    mode: 'url',
    size: '41 MB',
    sourcePage: 'https://drive.google.com/drive/folders/1Vwgjf1sy5DLiyZOhjMV8f1kx2iF67AhO',
    note: 'Personal viewing only · low-res calibrated dual-fisheye proxy'
  },
  {
    kind: 'panorama',
    format: 'OSV + LRF',
    label: 'DJI Osmo 360 experimental LRF proxy',
    name: 'CAM_20260728172420_0008_D.OSV',
    source: '/external-samples/osmo/CAM_20260728172420_0008_D.OSV',
    contentType: 'video/mp4',
    mode: 'url',
    resourceResolver: async () => ({
      source: '/external-samples/osmo/CAM_20260728172420_0008_D.LRF'
    }),
    size: '4.75 GB + 344 MB',
    sourcePage: 'https://huggingface.co/datasets/SamuelLDX/osmo360-lidar-preview',
    note: 'Source proxy contains visible seams'
  }
] as const satisfies ReadonlyArray<DemoSource & {
  format: string;
  size: string;
  sourcePage: string;
  note: string;
}>;
for (const sample of externalPanoramaSamples) {
  sampleByExtension.set(sample.format.split(' ')[0]!.toLowerCase(), sample);
}
const livePhotoFormatIds = new Set<string>(livePhotoFormats.map(([id]) => id));
type BusinessFormatFamilyId = 'office' | 'design' | 'media' | 'archive' | 'text';
const businessFormatFamilyLabels: Record<BusinessFormatFamilyId, string> = {
  office: 'Office',
  design: 'Design',
  media: 'Media',
  archive: 'Archive',
  text: 'Text'
};
const businessFormatFamilyOrder: BusinessFormatFamilyId[] = ['office', 'design', 'media', 'archive', 'text'];
const businessFormatCategoryOrder: Record<BusinessFormatFamilyId, string[]> = {
  office: ['word', 'excel', 'powerpoint', 'pdf', 'opendocument', 'iwork'],
  design: ['cad', 'model3d', 'diagram', 'mindmap', 'draft'],
  media: ['image', 'live-photo', 'panorama', 'audio', 'video'],
  archive: ['archive'],
  text: ['plain-text', 'markdown', 'code', 'config', 'log', 'ebook']
};
const wordFormats = new Set(['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'rtf', 'wps', 'wpt']);
const spreadsheetFormats = new Set(['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm', 'csv', 'tsv', 'tab', 'psv', 'et', 'ett']);
const presentationFormats = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'dps', 'dpt']);
const openDocumentFormats = new Set(['odt', 'ott', 'fodt', 'ods', 'ots', 'fods', 'odp', 'otp', 'fodp', 'odg', 'otg', 'fodg', 'odf', 'sxw', 'stw', 'sxc', 'stc', 'sxi', 'sti', 'sxd', 'std']);
const iworkFormats = new Set(['pages', 'numbers', 'key']);
const designDraftFormats = new Set(['psd', 'psb', 'ai', 'eps', 'ps']);
const convertedDesignSampleFormats = new Set(['psd', 'ai', 'eps', 'ps']);
const comicFormats = new Set(['cbz', 'cbr', 'cb7', 'cbt']);
const markdownFormats = new Set(['md', 'markdown', 'mkd', 'mkdn', 'mdown', 'mdx', 'rmd', 'qmd']);
const configFormats = new Set(['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'cnf', 'properties', 'xml']);

function getBusinessFormatCategory(extension: string, family: PreviewFamily): { familyId: BusinessFormatFamilyId; id: string; label: string } {
  if (livePhotoFormatIds.has(extension)) return { familyId: 'media', id: 'live-photo', label: '实况图' };
  if (wordFormats.has(extension)) return { familyId: 'office', id: 'word', label: 'Word' };
  if (spreadsheetFormats.has(extension)) return { familyId: 'office', id: 'excel', label: 'Excel' };
  if (presentationFormats.has(extension)) return { familyId: 'office', id: 'powerpoint', label: 'PPT' };
  if (extension === 'pdf') return { familyId: 'office', id: 'pdf', label: 'PDF' };
  if (openDocumentFormats.has(extension)) return { familyId: 'office', id: 'opendocument', label: 'OpenDocument' };
  if (iworkFormats.has(extension)) return { familyId: 'office', id: 'iwork', label: 'iWork' };
  if (designDraftFormats.has(extension)) return { familyId: 'design', id: 'draft', label: '设计稿' };
  if (family === 'cad') return { familyId: 'design', id: 'cad', label: 'CAD' };
  if (family === 'model3d') return { familyId: 'design', id: 'model3d', label: '3D 模型' };
  if (family === 'diagram') return { familyId: 'design', id: 'diagram', label: '流程图' };
  if (family === 'mindmap') return { familyId: 'design', id: 'mindmap', label: '思维导图' };
  if (family === 'image') return { familyId: 'media', id: 'image', label: '图片' };
  if (family === 'panorama' || family === 'panorama-video') return { familyId: 'media', id: 'panorama', label: '全景图' };
  if (family === 'audio') return { familyId: 'media', id: 'audio', label: '音频' };
  if (family === 'video') return { familyId: 'media', id: 'video', label: '视频' };
  if (comicFormats.has(extension) || family === 'ebook') return { familyId: 'text', id: 'ebook', label: '电子书' };
  if (family === 'archive') return { familyId: 'archive', id: 'archive', label: '压缩文件' };
  if (extension === 'log') return { familyId: 'text', id: 'log', label: '日志' };
  if (markdownFormats.has(extension)) return { familyId: 'text', id: 'markdown', label: 'Markdown' };
  if (configFormats.has(extension)) return { familyId: 'text', id: 'config', label: '配置' };
  if (family === 'code' || family === 'html') return { familyId: 'text', id: 'code', label: '代码' };
  return { familyId: 'text', id: 'plain-text', label: 'TXT' };
}

const formatCatalog = [
  ...supportedFormats.filter((format) => !(format.family === 'image' && ['jpeg', 'svg'].includes(format.extension))).map((format) => ({
    extension: format.extension,
    family: format.family,
    label: format.extension.toUpperCase(),
    supported: true,
    sampleOnly: false
  })),
  ...catalogOnlyFormats
    .filter(([extension, family]) => !supportedFormats.some((format) => format.extension === extension && format.family === family))
    .map(([extension, family]) => ({
      extension,
      family,
      label: catalogFormatLabels.get(`${family}:${extension}`) ?? extension.toUpperCase(),
      supported: false,
      sampleOnly: convertedDesignSampleFormats.has(extension)
    })),
  ...livePhotoFormats.map(([extension, label]) => ({
    extension,
    family: 'image' as PreviewFamily,
    label,
    supported: true,
    sampleOnly: false
  })),
  ...panoramaSampleFormats.map(([extension, label]) => ({
    extension,
    family: 'panorama' as PreviewFamily,
    label,
    supported: true,
    sampleOnly: false
  }))
];
const current = shallowRef<DemoSource>(
  staticSamples.find((sample) => sample.name === 'rich-pptx-shapes.pptx') ?? staticSamples[0]!
);
const initialFormat = formatSupportByExtension.get(inferExtensionFromName(current.value.name) ?? '');
const selectedFormatFamilyId = ref<BusinessFormatFamilyId>(
  initialFormat ? getBusinessFormatCategory(initialFormat.extension, initialFormat.family).familyId : 'office'
);
const sourceMode = ref<SourceMode>('sample');
const remoteUrl = ref(defaultRemoteUrl);
const renderedState = ref<PreviewItemState | null>(null);
const lastError = ref<string | null>(null);
const uploadResourceResolver = shallowRef<PreviewResourceResolver | undefined>(undefined);
const converter = createWasmConverterClient({ wasm: converterCoreWasmUrl });
const panoramaProcessor = createWasmPanoramaProcessor({ wasm: converterCoreWasmUrl });
type PreviewExposed = InstanceType<typeof Preview> & { goToIndex?: (index: number) => void };
const previewRef = ref<PreviewExposed | null>(null);
type LayoutMode = 'workbench' | 'compare';
const layoutMode = ref<LayoutMode>('workbench');
type SidebarTab = 'navigator' | 'samples';
const sidebarTab = ref<SidebarTab>('navigator');
const compareRef = ref<PreviewExposed | null>(null);
const compareSource = shallowRef<DemoSource>(staticSamples.find((sample) => sample.kind !== 'pptx') ?? staticSamples[0]!);
const compareRenderedState = ref<PreviewItemState | null>(null);
const compareError = ref<string | null>(null);

function demoKindForConversionTarget(targetFormat: string): DemoKind {
  switch (targetFormat) {
    case 'jpg':
    case 'jpeg':
    case 'webp':
      return 'image';
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'xlsx';
    default:
      return 'ppt';
  }
}
function createDemoPreviewRoutes() {
  return createVueDefaultPreviewRoutes();
}

const viewerLabel = computed(() => `${current.value.label} (${current.value.name})`);
const familyLabel = computed(() => renderedState.value?.family ?? detectKind(current.value.name) ?? current.value.kind);
const warningCount = computed(() => renderedState.value?.warnings.length ?? 0);
const activeKind = computed<DemoKind>(() => current.value.kind);
const layoutTabs = computed(() => [
  { mode: 'workbench' as const, label: '预览' },
  { mode: 'compare' as const, label: '对比' }
]);
const layoutBodyClass = computed(() => `wb-body is-${layoutMode.value}`);
const showSideTabs = computed(() => true);
const showNavigatorPanel = computed(() => sidebarTab.value === 'navigator' && Boolean(navigatorKind.value));
const showSamplesPanel = computed(() => sidebarTab.value !== 'navigator' || !navigatorKind.value);
const staticSamplesByKind = computed(() => {
  const entries = new Map<DemoKind, DemoSource[]>();
  for (const sample of staticSamples) {
    const list = entries.get(sample.kind) ?? [];
    list.push(sample);
    entries.set(sample.kind, list);
  }
  return entries;
});
const kindTabs = computed(() => {
  const available = staticSamplesByKind.value;
  const tabOrder: Array<{ kind: DemoKind; label: string }> = [
    { kind: 'pptx', label: 'PPTX' },
    { kind: 'docx', label: 'DOCX' },
    { kind: 'xlsx', label: 'XLSX' },
    { kind: 'pdf', label: 'PDF' },
    { kind: 'key', label: 'Keynote' },
    { kind: 'pages', label: 'Pages' },
    { kind: 'numbers', label: 'Numbers' },
    { kind: 'ppt', label: 'PPT -> PPTX' },
    { kind: 'csv', label: 'CSV' },
    { kind: 'cad', label: 'CAD/DXF' },
    { kind: 'model3d', label: '3D' },
    { kind: 'mindmap', label: 'Mindmap' },
    { kind: 'diagram', label: 'Diagram' },
    { kind: 'image', label: 'Image' },
    { kind: 'panorama', label: 'Panorama' },
    { kind: 'text', label: 'Text' },
    { kind: 'code', label: 'Code' },
    { kind: 'html', label: 'HTML' },
    { kind: 'epub', label: 'EPUB' },
    { kind: 'cbz', label: 'CBZ' },
    { kind: 'zip', label: 'Archive' },
    { kind: 'audio', label: 'Audio' },
    { kind: 'video', label: 'Video' }
  ];
  return tabOrder.filter((tab) => available.has(tab.kind));
});
const businessFormatFamilies = computed(() => {
  const families = new Map(businessFormatFamilyOrder.map((id) => [id, {
    id,
    label: businessFormatFamilyLabels[id],
    categories: new Map<string, { id: string; label: string; formats: typeof formatCatalog }>()
  }]));
  for (const format of formatCatalog) {
    const category = getBusinessFormatCategory(format.extension, format.family);
    const family = families.get(category.familyId)!;
    const currentCategory = family.categories.get(category.id) ?? { id: category.id, label: category.label, formats: [] };
    currentCategory.formats.push(format);
    family.categories.set(category.id, currentCategory);
  }
  return [...families.values()].map((family) => ({
    ...family,
    categories: [...family.categories.values()].sort(
      (left, right) => businessFormatCategoryOrder[family.id].indexOf(left.id) - businessFormatCategoryOrder[family.id].indexOf(right.id)
    )
  }));
});
const selectedFormatFamily = computed(() => businessFormatFamilies.value.find((family) => family.id === selectedFormatFamilyId.value));
const activeFormatExtension = computed(() => current.value.catalogId ?? inferExtensionFromName(current.value.name) ?? '');
const activeKindSamples = computed(() => staticSamplesByKind.value.get(activeKind.value) ?? []);
const hasCurrentSample = computed(() =>
  (staticSamplesByKind.value.get(current.value.kind) ?? []).some((sample) => sample.name === current.value.name)
);
const navigatorKind = computed<'page' | 'sheet' | 'chapter' | null>(() => {
  const state = renderedState.value;
  if (!state) return null;
  if (state.family === 'paged') return 'page';
  if (state.family === 'diagram') return 'page';
  if (state.family === 'workbook') return 'sheet';
  if (state.family === 'ebook') return 'chapter';
  return null;
});
const navigatorTitle = computed(() => {
  switch (navigatorKind.value) {
    case 'page':
      return 'Pages';
    case 'sheet':
      return 'Sheets';
    case 'chapter':
      return 'Chapters';
    default:
      return '';
  }
});

watch(
  () => [current.value.name, current.value.contentType],
  () => {
    if (current.value.catalogId) {
      selectedFormatFamilyId.value = getBusinessFormatCategory(current.value.catalogId, 'image').familyId;
      return;
    }
    const support = formatSupportByExtension.get(activeFormatExtension.value)
      ?? supportedFormats.find((format) => current.value.contentType && format.contentTypes.includes(current.value.contentType));
    if (support) selectedFormatFamilyId.value = getBusinessFormatCategory(support.extension, support.family).familyId;
  },
  { immediate: true }
);

function selectFormatFamily(id: BusinessFormatFamilyId): void {
  selectedFormatFamilyId.value = id;
}

function useFormatSample(extension: string): void {
  const sample = sampleByExtension.get(extension);
  if (sample) void useSample(sample);
}
const navigatorActiveIndex = computed(() => {
  const state = renderedState.value;
  if (!state) return 0;
  if (state.family === 'paged') return (state as PagedPreviewState).pageIndex ?? 0;
  if (state.family === 'diagram') return (state as DiagramPreviewState).pageIndex ?? 0;
  if (state.family === 'workbook') return (state as WorkbookPreviewState).activeSheetIndex ?? 0;
  if (state.family === 'ebook') return (state as EbookPreviewState).chapterIndex ?? 0;
  return 0;
});
const navigatorItems = computed(() => {
  const state = renderedState.value;
  if (!state) return [] as Array<{ index: number; label: string; meta?: string }>;

  if (state.family === 'paged') {
    const paged = state as PagedPreviewState;
    return Array.from({ length: Math.max(paged.pageCount ?? 0, 0) }, (_, index) => ({
      index,
      label: `Page ${index + 1}`
    }));
  }

  if (state.family === 'diagram') {
    const diagram = state as DiagramPreviewState;
    return Array.from({ length: Math.max(diagram.pageCount ?? 0, 0) }, (_, index) => ({
      index,
      label: `Page ${index + 1}`
    }));
  }

  if (state.family === 'workbook') {
    const workbook = state as WorkbookPreviewState;
    return (workbook.sheets ?? []).map((sheet, index) => ({
      index,
      label: sheet.name || `Sheet ${index + 1}`
    }));
  }

  if (state.family === 'ebook') {
    const ebook = state as EbookPreviewState;
    return (ebook.chapters ?? []).map((chapter, index) => ({
      index,
      label: chapter.title || `Chapter ${index + 1}`
    }));
  }

  return [] as Array<{ index: number; label: string; meta?: string }>;
});

function goToNavigator(index: number): void {
  previewRef.value?.goToIndex?.(index);
}

function onCompareError(error: Error): void {
  compareError.value = error.message;
}

function activateCompareKind(kind: DemoKind): void {
  const sample = staticSamplesByKind.value.get(kind)?.[0];
  if (!sample) {
    return;
  }
  compareRenderedState.value = null;
  compareError.value = null;
  void (async () => {
    compareSource.value = await materializeSample(sample);
  })();
}

function ensureCompareKindDifferent(): void {
  if (layoutMode.value !== 'compare') {
    return;
  }
  if (compareSource.value.kind !== activeKind.value) {
    return;
  }
  for (const tab of kindTabs.value) {
    if (tab.kind === activeKind.value) continue;
    activateCompareKind(tab.kind);
    return;
  }
}

watch(
  () => [layoutMode.value, activeKind.value],
  () => {
    ensureCompareKindDifferent();
  }
);
const model3dSummary = computed(() => {
  if (renderedState.value?.family !== 'model3d') {
    return [];
  }
  const metadata = (renderedState.value as Model3dPreviewState).metadata;
  if (!metadata) {
    return [];
  }
  const rows: Array<{ label: string; value: string }> = [];
  if (metadata.format) rows.push({ label: 'Format', value: metadata.format.toUpperCase() });
  if (typeof metadata.meshCount === 'number') rows.push({ label: 'Meshes', value: String(metadata.meshCount) });
  if (typeof metadata.lineCount === 'number') rows.push({ label: 'Lines', value: String(metadata.lineCount) });
  if (typeof metadata.pointCount === 'number') rows.push({ label: 'Points', value: String(metadata.pointCount) });
  if (typeof metadata.materialCount === 'number') rows.push({ label: 'Materials', value: String(metadata.materialCount) });
  if (typeof metadata.triangleCount === 'number') rows.push({ label: 'Triangles', value: String(metadata.triangleCount) });
  if (typeof metadata.vertexCount === 'number') rows.push({ label: 'Vertices', value: String(metadata.vertexCount) });
  if (metadata.bounds?.size) rows.push({ label: 'Size', value: metadata.bounds.size.map(formatCompactNumber).join(' x ') });
  return rows;
});
const fontResolver: PreviewFontResolver = ({ family, fontFile }) => {
  if (family === 'cad' && fontFile?.toLowerCase() === 'romans.shx') {
    return {
      fontFamily: 'system-ui',
      warnings: ['Demo mapped CAD SHX font romans.shx to the browser system UI fallback.']
    };
  }
};

async function useSample(sample: DemoSource): Promise<void> {
  renderedState.value = null;
  lastError.value = null;
  current.value = await materializeSample(sample);
  uploadResourceResolver.value = sample.resourceResolver;
  sourceMode.value = current.value.mode ?? 'sample';
}

function activateKind(kind: DemoKind): void {
  const sample = staticSamplesByKind.value.get(kind)?.[0];
  if (!sample) {
    return;
  }
  void useSample(sample);
}

async function previewRemote(): Promise<void> {
  const kind = detectKind(remoteUrl.value) ?? 'pptx';
  current.value = {
    kind,
    label: kind.toUpperCase(),
    name: inferName(remoteUrl.value),
    source: remoteUrl.value,
    mode: 'url'
  };
  sourceMode.value = 'url';
  renderedState.value = null;
  lastError.value = null;
  uploadResourceResolver.value = undefined;
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  const file = chooseUploadPrimaryFile(files);
  if (!file) {
    return;
  }

  sourceMode.value = 'upload';
  renderedState.value = null;
  lastError.value = null;

  try {
    if (files.length === 1 && isZipBundleCandidate(file.name)) {
      const bundle = await materializeZipBundleUpload(file);
      if (bundle) {
        current.value = bundle.source;
        uploadResourceResolver.value = bundle.resourceResolver;
        input.value = '';
        return;
      }
    }

    const kind = detectKind(file.name) ?? 'text';
    current.value = {
      kind,
      label: kind.toUpperCase(),
      name: file.name,
      source: file,
      contentType: file.type || undefined,
      mode: 'upload'
    };
    uploadResourceResolver.value = files.length > 1 ? createFileSetResourceResolver(files) : undefined;
  } catch (error) {
    lastError.value = error instanceof Error ? error.message : String(error);
  } finally {
    input.value = '';
  }
}

function onRendered(state: PreviewItemState): void {
  renderedState.value = state;
  lastError.value = null;
}

function onError(error: Error): void {
  lastError.value = error.message;
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

async function materializeSample(sample: DemoSource): Promise<DemoSource> {
  const extension = inferExtensionFromName(sample.name) ?? '';
  if (conversionKindBySource.has(extension) && typeof sample.source === 'string') {
    const response = await fetch(sample.source);
    if (!response.ok) {
      throw new Error(`Failed to load ${sample.name}: ${response.status} ${response.statusText}`.trim());
    }
    return {
      ...sample,
      source: await response.arrayBuffer()
    };
  }
  if (sample.kind === 'pdf' && sample.mode === 'generated') {
    return {
      ...sample,
      source: createMinimalPdf(),
      mode: 'generated'
    };
  }
  if (sample.mode === 'generated' && ['odt', 'ott', 'sxw', 'stw'].includes(extension)) {
    return { ...sample, source: await createOdfPackage(sample.contentType ?? 'application/vnd.oasis.opendocument.text', createOdfTextContent()) };
  }
  if (sample.mode === 'generated' && extension === 'fodt') {
    return { ...sample, source: new TextEncoder().encode(createOdfTextContent()) };
  }
  if (sample.mode === 'generated' && ['odp', 'otp'].includes(extension)) {
    return { ...sample, source: await createOdfPackage(sample.contentType ?? 'application/vnd.oasis.opendocument.presentation', createOdfPresentationContent()) };
  }
  if (sample.mode === 'generated' && extension === 'fodp') {
    return { ...sample, source: new TextEncoder().encode(createOdfPresentationContent()) };
  }
  if (sample.mode === 'generated' && extension === 'fods') {
    return { ...sample, source: new TextEncoder().encode(createOdfSpreadsheetContent()) };
  }
  if (sample.mode === 'generated' && ['sxc', 'stc'].includes(extension)) {
    return { ...sample, source: await createOdfPackage(sample.contentType ?? 'application/vnd.sun.xml.calc', createOdfSpreadsheetContent()) };
  }
  if (sample.mode === 'generated' && ['sxi', 'sti'].includes(extension)) {
    return { ...sample, source: await createOdfPackage(sample.contentType ?? 'application/vnd.sun.xml.impress', createOdfPresentationContent()) };
  }
  if (sample.mode === 'generated' && ['odg', 'otg', 'sxd', 'std'].includes(extension)) {
    return { ...sample, source: await createOdfPackage(sample.contentType ?? 'application/vnd.oasis.opendocument.graphics', createOdfDrawingContent()) };
  }
  if (sample.mode === 'generated' && extension === 'fodg') {
    return { ...sample, source: new TextEncoder().encode(createOdfDrawingContent()) };
  }
  if (sample.kind === 'docx' && sample.mode === 'generated') {
    return {
      ...sample,
      source: await createDocxFixture(),
      mode: 'generated'
    };
  }
  if (sample.kind === 'xlsx' && sample.mode === 'generated') {
    return {
      ...sample,
      source: await createWorkbookFixture(),
      mode: 'generated'
    };
  }
  if (sample.kind === 'zip' && sample.mode === 'generated') {
    return {
      ...sample,
      source: await createArchiveFixture(),
      mode: 'generated'
    };
  }
  if (sample.kind === 'epub') {
    return {
      ...sample,
      source: await createEpubFixture(),
      mode: 'generated'
    };
  }
  if (sample.kind === 'cbz') {
    return {
      ...sample,
      source: await createCbzFixture(),
      mode: 'generated'
    };
  }
  if (sample.name.toLowerCase().endsWith('.vsdx')) {
    return {
      ...sample,
      source: await createVsdxFixture(),
      mode: 'generated'
    };
  }
  if (sample.name.toLowerCase().endsWith('.xmind')) {
    return {
      ...sample,
      source: await createXmindFixture(),
      mode: 'generated'
    };
  }
  if (sample.name.toLowerCase().endsWith('.3mf')) {
    return {
      ...sample,
      source: await create3mfFixture(),
      mode: 'generated'
    };
  }
  if (sample.name.toLowerCase().endsWith('.kmz')) {
    return {
      ...sample,
      source: await createKmzFixture(),
      mode: 'generated'
    };
  }
  return sample;
}

function detectKind(name: string): DemoKind | null {
  const normalized = name.toLowerCase().split(/[?#]/, 1)[0] ?? '';
  if (normalized.endsWith('.pptx')) return 'pptx';
  if (/\.dxf$/.test(normalized)) return 'cad';
  if (/\.(step|stp|stl|obj|gltf|glb|3mf|amf|dae|fbx|ply|3ds|usdz|gcode|gco|nc|wrl|vrml|pcd|xyz|vtk|vox|ldr|mpd|kmz|md2|lwo|bvh|pdb|nrrd|nhdr)$/.test(normalized)) return 'model3d';
  if (/\.(xmind|mm|opml)$/.test(normalized)) return 'mindmap';
  if (/\.(drawio|dio|vdx|vsdx)$/.test(normalized)) return 'diagram';
  if (normalized.endsWith('.key')) return 'key';
  if (normalized.endsWith('.pages')) return 'pages';
  if (normalized.endsWith('.numbers')) return 'numbers';
  if (normalized.endsWith('.pdf')) return 'pdf';
  if (normalized.endsWith('.docx')) return 'docx';
  if (normalized.endsWith('.xlsx')) return 'xlsx';
  if (normalized.endsWith('.csv')) return 'csv';
  if (/\.(png|jpg|jpeg|gif|webp|avif|apng|ico|svg|bmp)$/.test(normalized)) return 'image';
  if (/\.(pano|panorama|360|insp|360v|vr360|insv|osv)$/.test(normalized)) return 'panorama';
  if (/\.(html?|shtml|xhtml)$/.test(normalized)) return 'html';
  if (/\.epub$/.test(normalized)) return 'epub';
  if (/\.cbz$/.test(normalized)) return 'cbz';
  if (/\.(zip|jar|war|ear|apk|tar|tgz|gz)$/.test(normalized)) return 'zip';
  if (/\.(mp3|wav|aac|m4a|flac|ogg|oga|opus)$/.test(normalized)) return 'audio';
  if (/\.(mp4|webm|mov|m4v|ogv|mkv|avi|mpeg|mpg|3gp)$/.test(normalized)) return 'video';
  if (/\.(ts|tsx|js|jsx|vue|css|json|md|py|go|rs)$/.test(normalized)) return 'code';
  if (/\.(txt|log|text)$/.test(normalized)) return 'text';
  const conversionKind = conversionKindBySource.get(extensionFromNormalizedName(normalized));
  if (conversionKind) return conversionKind;
  return null;
}

function extensionFromNormalizedName(name: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  return dotIndex >= 0 ? lastSegment.slice(dotIndex + 1) : '';
}

function chooseUploadPrimaryFile(files: File[]): File | undefined {
  return files
    .filter((file) => isLikelyPrimaryUpload(file.name))
    .sort(compareBundlePrimaryEntries)[0]
    ?? files[0];
}

async function materializeZipBundleUpload(
  file: File
): Promise<{ source: DemoSource; resourceResolver: PreviewResourceResolver } | undefined> {
  const context = {
    descriptor: {
      source: file,
      name: file.name,
      extension: 'zip',
      contentType: file.type || 'application/zip'
    },
    route: {
      sourceFormat: 'zip',
      targetFormat: 'zip',
      family: 'archive' as const,
      driverId: 'archive'
    }
  };
  const index = await createZipArchiveResourceIndex(file, context);
  const entry = chooseZipBundlePrimaryEntry(index.files);
  if (!entry) {
    return undefined;
  }
  const kind = detectKind(entry.name);
  if (!kind || kind === 'zip') {
    return undefined;
  }
  return {
    source: {
      kind,
      label: `${kind.toUpperCase()} bundle`,
      name: entry.name,
      source: await entry.readAsArrayBuffer(),
      contentType: entry.contentType,
      mode: 'upload'
    },
    resourceResolver: index.resolve
  };
}

function chooseZipBundlePrimaryEntry(entries: ZipArchiveResource[]): ZipArchiveResource | undefined {
  return entries
    .filter((entry) => isLikelyPrimaryUpload(entry.name) && !isLikelyGeneratedPreviewArtifact(entry.name))
    .sort(compareBundlePrimaryEntries)[0];
}

function compareBundlePrimaryEntries(left: { name: string }, right: { name: string }): number {
  return bundlePrimaryScore(right.name) - bundlePrimaryScore(left.name) || left.name.localeCompare(right.name);
}

function bundlePrimaryScore(name: string): number {
  const normalized = name.toLowerCase();
  if (conversionKindBySource.has(extensionFromNormalizedName(normalized))) return 85;
  if (/\.(gltf|glb|3mf|kmz)$/.test(normalized)) return 100;
  if (/\.(dxf|drawio|dio|xmind|mm|opml)$/.test(normalized)) return 90;
  if (/\.(html?|xhtml)$/.test(normalized)) return 80;
  if (/\.(obj|stl|ply|vtk|vox|ldr|mpd|md2|lwo|bvh|pdb|nrrd|nhdr)$/.test(normalized)) return 70;
  if (/\.png$/.test(normalized)) return 40;
  if (/\.(txt|md|json|xml)$/.test(normalized)) return 20;
  return 10;
}

function isLikelyPrimaryUpload(name: string): boolean {
  const kind = detectKind(name);
  if (!kind) {
    return false;
  }
  return !isLikelySidecarUpload(name);
}

function isLikelySidecarUpload(name: string): boolean {
  const normalized = name.toLowerCase().split(/[?#]/, 1)[0] ?? '';
  return /\.(bin|css|mtl|ttf|otf|woff2?|ktx2|wasm|json|xml|rels)$/.test(normalized)
    && !/\.(drawio|dio|gltf|xmind|vsdx|docx|pptx|xlsx|epub|cbz|3mf)$/.test(normalized);
}

function isLikelyGeneratedPreviewArtifact(name: string): boolean {
  return /(^|\/)(index|preview)\.html?$/i.test(name) || /(^|\/)(thumbnail|thumb|preview)\.png$/i.test(name);
}

function isZipBundleCandidate(name: string): boolean {
  return /\.zip$/i.test(name);
}

function createHtmlFixture(): Uint8Array {
  return new TextEncoder().encode(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>HTML preview</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; color: #1f2937; background: #f8fafc; }
      main { padding: 42px; }
      h1 { margin: 0 0 12px; font-size: 34px; }
      p { max-width: 56ch; line-height: 1.6; }
      table { border-collapse: collapse; margin-top: 24px; }
      th, td { border: 1px solid #94a3b8; padding: 8px 12px; text-align: left; }
    </style>
  </head>
  <body>
    <main>
      <h1>Sandboxed HTML preview</h1>
      <p>Converted HTML or plain HTML files can be mounted through the same generic preview route.</p>
      <h2>Coverage checklist</h2>
      <ul><li><strong>Bold</strong>, <em>italic</em>, and <code>inline code</code></li><li>Unicode: café, 中文, العربية, 😀</li></ul>
      <table><thead><tr><th>Format</th><th>Count</th></tr></thead><tbody><tr><td>Documents</td><td>12</td></tr><tr><td>Models</td><td>8</td></tr></tbody></table>
      <details><summary>Expandable content</summary><p>A final paragraph inside a native details element.</p></details>
    </main>
  </body>
</html>`);
}

function createTextFixture(): Uint8Array {
  return new TextEncoder().encode(`File preview regression notes
================================

Generic preview can render text files without a converter.

- Unicode: café, 中文, العربية, emoji 😀
- Numbers: -42, 3.14159, 6.02e23, 50%
- Date: 2026-08-03T14:30:00+08:00
- Punctuation: <tag attr="A&B"> 'single' "double" \\ / |

Columns:
name\tvalue\tactive
alpha\t42\ttrue
empty\t\tfalse

This intentionally long line exercises wrapping: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.
`);
}

function createCodeFixture(): Uint8Array {
  return new TextEncoder().encode(`import { Preview } from '@filens/vue';

type Format = 'pptx' | 'pdf' | 'docx' | 'xlsx';

export async function previewAll(files: readonly File[]): Promise<Map<Format, number>> {
  const totals = new Map<Format, number>();
  for (const file of files) {
    const format = file.name.split('.').pop()?.toLowerCase() as Format | undefined;
    if (!format) continue;
    totals.set(format, (totals.get(format) ?? 0) + file.size);
  }
  await Promise.resolve(Preview);
  return totals;
}

export const label = ['pptx', 'pdf', 'docx', 'xlsx', '中文'].join(', ');
`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function createCsvFixture(): Uint8Array {
  return new TextEncoder().encode('\uFEFFName,Revenue,Active,Date,Note\r\nAlice,42.5,true,2026-08-03,"hello, world"\r\nBob,-7,false,1999-12-31,"quoted ""value"""\r\n"Café 中文",0,true,,"line one\nline two"\r\nEmpty,,false,2026-02-29,');
}

function createMmFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node ID="root" TEXT="Launch Plan">
    <node ID="research" TEXT="Research">
      <node ID="references" TEXT="Collect references"/>
      <node ID="formats" TEXT="Choose direct formats"/>
    </node>
    <node ID="build" TEXT="Build">
      <node ID="driver" TEXT="Preview driver"/>
      <node ID="tests" TEXT="Unit and Vue tests"/>
    </node>
    <node ID="ship" TEXT="Ship">
      <node ID="docs" TEXT="Docs"/>
      <node ID="demo" TEXT="Demo sample"/>
    </node>
  </node>
</map>`);
}

function createMoonshotMmFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node ID="root" TEXT="MOONSHOT 2035">
    <node ID="mission" TEXT="Mission Control">
      <node ID="orbit" TEXT="Orbital insertion"/>
      <node ID="landing" TEXT="Autonomous landing"/>
      <node ID="return" TEXT="Earth return corridor"/>
    </node>
    <node ID="vehicle" TEXT="Starship Systems">
      <node ID="propulsion" TEXT="Methalox propulsion"/>
      <node ID="thermal" TEXT="Thermal shield"/>
      <node ID="navigation" TEXT="Optical navigation"/>
    </node>
    <node ID="habitat" TEXT="Lunar Habitat">
      <node ID="power" TEXT="Polar solar array"/>
      <node ID="life" TEXT="Closed-loop life support"/>
      <node ID="lab" TEXT="Regolith science lab"/>
    </node>
    <node ID="crew" TEXT="Crew Experience">
      <node ID="training" TEXT="Analog mission training"/>
      <node ID="health" TEXT="Radiation health"/>
      <node ID="story" TEXT="Live story from the Moon"/>
    </node>
    <node ID="legacy" TEXT="Earth Legacy">
      <node ID="climate" TEXT="Climate instruments"/>
      <node ID="materials" TEXT="New materials"/>
      <node ID="inspiration" TEXT="One billion inspired"/>
    </node>
  </node>
</map>`);
}

async function createXmindFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([
    {
      id: 'sheet-1',
      title: 'Brainstorm',
      rootTopic: {
        id: 'brainstorm-root',
        title: 'Brainstorm',
        children: {
          attached: [
            {
              id: 'formats',
              title: 'Direct formats',
              children: {
                attached: [
                  {
                    id: 'xmind',
                    title: 'XMind ZIP'
                  },
                  {
                    id: 'opml',
                    title: 'OPML'
                  }
                ]
              }
            },
            {
              id: 'viewer',
              title: 'Viewer',
              children: {
                attached: [
                  {
                    id: 'outline',
                    title: 'Outline'
                  },
                  {
                    id: 'selection',
                    title: 'Selection'
                  }
                ]
              }
            }
          ]
        }
      }
    }
  ]));
  return zip.generateAsync({ type: 'uint8array' });
}

function createDrawioFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="flow" name="Flow">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="start" value="Upload" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="50" width="130" height="64" as="geometry"/>
        </mxCell>
        <mxCell id="route" value="Resolve route" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="250" y="50" width="150" height="64" as="geometry"/>
        </mxCell>
        <mxCell id="render" value="Render preview" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="480" y="50" width="150" height="64" as="geometry"/>
        </mxCell>
        <mxCell id="edge-1" value="" edge="1" parent="1" source="start" target="route">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge-2" value="" edge="1" parent="1" source="route" target="render">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`);
}

function createCommandCenterDrawioFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="command-center" name="AI Command Center">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="signal" value="GLOBAL SIGNALS" style="shape=ellipse;whiteSpace=wrap;html=1;fillColor=#071A2B;strokeColor=#22D3EE;fontColor=#E6FCFF;strokeWidth=3;" vertex="1" parent="1">
          <mxGeometry x="50" y="205" width="150" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="fusion" value="DATA FUSION" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#102A43;strokeColor=#38BDF8;fontColor=#F0F9FF;strokeWidth=3;" vertex="1" parent="1">
          <mxGeometry x="270" y="70" width="170" height="84" as="geometry"/>
        </mxCell>
        <mxCell id="model" value="AI CORE" style="shape=rhombus;whiteSpace=wrap;html=1;fillColor=#3B0764;strokeColor=#E879F9;fontColor=#FDF4FF;strokeWidth=4;" vertex="1" parent="1">
          <mxGeometry x="520" y="170" width="180" height="150" as="geometry"/>
        </mxCell>
        <mxCell id="simulation" value="SIMULATION" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#172554;strokeColor=#818CF8;fontColor=#EEF2FF;strokeWidth=3;" vertex="1" parent="1">
          <mxGeometry x="270" y="350" width="170" height="84" as="geometry"/>
        </mxCell>
        <mxCell id="actions" value="AUTONOMOUS ACTIONS" style="shape=ellipse;whiteSpace=wrap;html=1;fillColor=#052E2B;strokeColor=#2DD4BF;fontColor=#F0FDFA;strokeWidth=3;" vertex="1" parent="1">
          <mxGeometry x="790" y="205" width="190" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="human" value="HUMAN AUTHORITY" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#451A03;strokeColor=#FBBF24;fontColor=#FFFBEB;strokeWidth=3;" vertex="1" parent="1">
          <mxGeometry x="540" y="390" width="140" height="74" as="geometry"/>
        </mxCell>
        <mxCell id="e1" value="stream" style="endArrow=block;strokeColor=#22D3EE;strokeWidth=3;" edge="1" parent="1" source="signal" target="fusion"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e2" value="context" style="endArrow=block;strokeColor=#38BDF8;strokeWidth=3;" edge="1" parent="1" source="fusion" target="model"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e3" value="forecast" style="endArrow=block;strokeColor=#818CF8;strokeWidth=3;" edge="1" parent="1" source="simulation" target="model"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e4" value="decide" style="endArrow=block;strokeColor=#E879F9;strokeWidth=4;" edge="1" parent="1" source="model" target="actions"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e5" value="approve" style="endArrow=block;strokeColor=#FBBF24;strokeWidth=3;dashed=1;" edge="1" parent="1" source="human" target="model"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e6" value="rehearse" style="endArrow=block;strokeColor=#2DD4BF;strokeWidth=2;dashed=1;" edge="1" parent="1" source="actions" target="simulation"><mxGeometry relative="1" as="geometry"/></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`);
}

function createVdxFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core">
  <Pages>
    <Page ID="0" NameU="Page 1">
      <PageSheet>
        <Cell N="PageWidth" V="8.5"/>
        <Cell N="PageHeight" V="5"/>
      </PageSheet>
      <Shapes>
        <Shape ID="1" Type="Shape" NameU="Process">
          <Text>Upload</Text>
          <Cell N="PinX" V="1.5"/>
          <Cell N="PinY" V="3.5"/>
          <Cell N="Width" V="1.3"/>
          <Cell N="Height" V="0.65"/>
          <Cell N="FillForegnd" V="#DAE8FC"/>
          <Cell N="LineColor" V="#6C8EBF"/>
        </Shape>
        <Shape ID="2" Type="Shape" NameU="Process">
          <Text>Preview</Text>
          <Cell N="PinX" V="4.5"/>
          <Cell N="PinY" V="3.5"/>
          <Cell N="Width" V="1.3"/>
          <Cell N="Height" V="0.65"/>
          <Cell N="FillForegnd" V="#D5E8D4"/>
          <Cell N="LineColor" V="#82B366"/>
        </Shape>
        <Shape ID="3" Type="OneD" NameU="Dynamic connector">
          <Text>route</Text>
          <Cell N="BeginX" V="2.15"/>
          <Cell N="BeginY" V="3.5"/>
          <Cell N="EndX" V="3.85"/>
          <Cell N="EndY" V="3.5"/>
        </Shape>
      </Shapes>
      <Connects>
        <Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/>
        <Connect FromSheet="3" FromCell="EndX" ToSheet="2"/>
      </Connects>
    </Page>
  </Pages>
</VisioDocument>`);
}

async function createVsdxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('visio/pages/pages.xml', `<?xml version="1.0" encoding="UTF-8"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Page ID="10" NameU="Preview Flow" Name="Preview Flow">
    <Rel r:id="rId1"/>
  </Page>
</Pages>`);
  zip.file('visio/pages/_rels/pages.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="page1.xml"/>
</Relationships>`);
  zip.file('visio/pages/page1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
  <PageSheet>
    <Cell N="PageWidth" V="8.5"/>
    <Cell N="PageHeight" V="5"/>
  </PageSheet>
  <Shapes>
    <Shape ID="1" Type="Shape" NameU="Process">
      <Text>Upload</Text>
      <Cell N="PinX" V="1.5"/>
      <Cell N="PinY" V="3.5"/>
      <Cell N="Width" V="1.3"/>
      <Cell N="Height" V="0.65"/>
      <Cell N="FillForegnd" V="#DAE8FC"/>
      <Cell N="LineColor" V="#6C8EBF"/>
    </Shape>
    <Shape ID="2" Type="Shape" NameU="Process">
      <Text>Preview</Text>
      <Cell N="PinX" V="4.5"/>
      <Cell N="PinY" V="3.5"/>
      <Cell N="Width" V="1.3"/>
      <Cell N="Height" V="0.65"/>
      <Cell N="FillForegnd" V="#D5E8D4"/>
      <Cell N="LineColor" V="#82B366"/>
    </Shape>
    <Shape ID="3" Type="OneD" NameU="Dynamic connector">
      <Text>route</Text>
      <Cell N="BeginX" V="2.15"/>
      <Cell N="BeginY" V="3.5"/>
      <Cell N="EndX" V="3.85"/>
      <Cell N="EndY" V="3.5"/>
    </Shape>
  </Shapes>
  <Connects>
    <Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/>
    <Connect FromSheet="3" FromCell="EndX" ToSheet="2"/>
  </Connects>
</PageContents>`);
  return zip.generateAsync({ type: 'uint8array' });
}

function createStlFixture(): Uint8Array {
  return new TextEncoder().encode(`solid demo_part
facet normal 0 -1 0
  outer loop
    vertex -26 -18 0
    vertex 26 -18 0
    vertex 0 -18 34
  endloop
endfacet
facet normal 1 0 0
  outer loop
    vertex 26 -18 0
    vertex 26 18 0
    vertex 0 -18 34
  endloop
endfacet
facet normal 0 1 0
  outer loop
    vertex 26 18 0
    vertex -26 18 0
    vertex 0 -18 34
  endloop
endfacet
facet normal -1 0 0
  outer loop
    vertex -26 18 0
    vertex -26 -18 0
    vertex 0 -18 34
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex -26 -18 0
    vertex -26 18 0
    vertex 26 18 0
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex -26 -18 0
    vertex 26 18 0
    vertex 26 -18 0
  endloop
endfacet
endsolid demo_part`);
}

function createObjFixture(): Uint8Array {
  return new TextEncoder().encode(`# low-poly preview part
v -28 -20 0
v 28 -20 0
v 28 20 0
v -28 20 0
v 0 -20 36
v 0 20 24
vn 0 0 -1
vn 0 -1 0
vn 1 0 0
vn 0 1 0
vn -1 0 0
f 1//1 4//1 3//1 2//1
f 1//2 2//2 5//2
f 2//3 3//3 6//3 5//3
f 3//4 4//4 6//4
f 4//5 1//5 5//5 6//5`);
}

function createCrystalCrownObjFixture(): Uint8Array {
  return new TextEncoder().encode(`# faceted crystal crown
o Crystal_Crown
v 0 0 58
v 34 0 0
v 14.56 10.58 0
v 10.51 32.36 0
v -5.56 17.12 0
v -27.51 19.98 0
v -18 0 0
v -27.51 -19.98 0
v -5.56 -17.12 0
v 10.51 -32.36 0
v 14.56 -10.58 0
v 0 0 -42
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 6
f 1 6 7
f 1 7 8
f 1 8 9
f 1 9 10
f 1 10 11
f 1 11 2
f 12 3 2
f 12 4 3
f 12 5 4
f 12 6 5
f 12 7 6
f 12 8 7
f 12 9 8
f 12 10 9
f 12 11 10
f 12 2 11`);
}

function createPlyFixture(): Uint8Array {
  return new TextEncoder().encode(`ply
format ascii 1.0
element vertex 5
property float x
property float y
property float z
element face 5
property list uchar int vertex_indices
end_header
-24 -18 0
24 -18 0
24 18 0
-24 18 0
0 0 32
4 0 1 2 3
3 0 1 4
3 1 2 4
3 2 3 4
3 3 0 4`);
}

function createGlbFixture(): Uint8Array {
  const geometry = createTriangleGltfGeometry();
  const json = JSON.stringify({ ...geometry.document, buffers: [{ byteLength: geometry.bytes.byteLength }] });
  const jsonBytes = new TextEncoder().encode(json);
  const paddedJsonLength = align4(jsonBytes.byteLength);
  const paddedBinLength = align4(geometry.bytes.byteLength);
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedJsonLength);
  const binOffset = 20 + paddedJsonLength;
  view.setUint32(binOffset, paddedBinLength, true);
  view.setUint32(binOffset + 4, 0x004e4942, true);
  bytes.set(geometry.bytes, binOffset + 8);
  return bytes;
}

function createGltfFixture(): Uint8Array {
  const geometry = createTriangleGltfGeometry();
  const uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...geometry.bytes))}`;
  return new TextEncoder().encode(JSON.stringify({ ...geometry.document, buffers: [{ byteLength: geometry.bytes.byteLength, uri }] }, null, 2));
}

function createTriangleGltfGeometry() {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(index * 4, value, true));
  [0, 1, 2].forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  return {
    bytes,
    document: {
      asset: { version: '2.0', generator: 'file-previewer demo' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Colored Triangle', mesh: 0, translation: [0.25, 0.1, 0] }],
      meshes: [{ name: 'Triangle Mesh', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ name: 'Safety Orange', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.32, 0.08, 1], metallicFactor: 0.1, roughnessFactor: 0.7 } }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] }
      ]
    }
  };
}

function createVtkFixture(): Uint8Array {
  return new TextEncoder().encode(`# vtk DataFile Version 3.0
Simple quad
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 0
1 0 0
1 1 0
0 1 0
POLYGONS 1 5
4 0 1 2 3
`);
}

function createVoxFixture(): Uint8Array {
  const bytes = new Uint8Array(68);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'VOX ');
  view.setUint32(4, 150, true);
  writeAscii(view, 8, 'MAIN');
  view.setUint32(12, 0, true);
  view.setUint32(16, 48, true);
  writeAscii(view, 20, 'SIZE');
  view.setUint32(24, 12, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 2, true);
  view.setUint32(36, 2, true);
  view.setUint32(40, 2, true);
  writeAscii(view, 44, 'XYZI');
  view.setUint32(48, 12, true);
  view.setUint32(52, 0, true);
  view.setUint32(56, 2, true);
  bytes[60] = 0; bytes[61] = 0; bytes[62] = 0; bytes[63] = 1;
  bytes[64] = 1; bytes[65] = 1; bytes[66] = 1; bytes[67] = 2;
  return bytes;
}

function createLDrawFixture(): Uint8Array {
  return new TextEncoder().encode(`0 FILE brick.ldr
0 Simple LDraw quad
0 BFC CERTIFY CCW
4 16 0 0 0 40 0 0 40 24 0 0 24 0
2 24 0 0 0 40 0 0
2 24 40 0 0 40 24 0
2 24 40 24 0 0 24 0
2 24 0 24 0 0 0 0
`);
}

async function createKmzFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('doc.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <Model>
      <Link>
        <href>models/scene.dae</href>
      </Link>
    </Model>
  </Placemark>
</kml>`);
  zip.file('models/scene.dae', `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene"/>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function create3mfFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="-22" y="-16" z="0"/>
          <vertex x="22" y="-16" z="0"/>
          <vertex x="22" y="16" z="0"/>
          <vertex x="-22" y="16" z="0"/>
          <vertex x="0" y="0" z="34"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="2" v3="3"/>
          <triangle v1="0" v2="1" v3="4"/>
          <triangle v1="1" v2="2" v3="4"/>
          <triangle v1="2" v2="3" v3="4"/>
          <triangle v1="3" v2="0" v3="4"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'uint8array' });
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function inferName(source: string): string {
  return source.split(/[?#]/, 1)[0]?.split('/').pop() || 'remote-source';
}

function createPngDataUrl(): string {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = 'rgba(47, 107, 255, 0.92)';
      context.beginPath();
      context.arc(260, 260, 140, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#19a974';
      context.fillRect(420, 150, 320, 220);
      context.fillStyle = '#ffffff';
      context.font = '44px system-ui, sans-serif';
      context.fillText('PNG Preview', 480, 285);
      return canvas.toDataURL('image/png');
    }
  }
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8NVLwAAAABJRU5ErkJggg==';
}

function createSvgDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#f8fafc"/>
  <circle cx="260" cy="260" r="140" fill="#2f6bff" fill-opacity="0.9"/>
  <rect x="420" y="150" width="320" height="220" rx="18" fill="#19a974"/>
  <text x="480" y="285" font-family="system-ui, sans-serif" font-size="44" fill="#fff">Image Preview</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createDxfFixture(): Uint8Array {
  return new TextEncoder().encode(`0
SECTION
2
TABLES
0
TABLE
2
STYLE
0
STYLE
2
ARCH
3
romans.shx
0
ENDTAB
0
TABLE
2
LAYER
0
LAYER
2
WALLS
62
7
0
LAYER
2
ROOMS
62
4
0
LAYER
2
FURNITURE
62
3
0
LAYER
2
DOORS
62
2
0
LAYER
2
LABELS
62
5
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
WALLS
10
0
20
0
11
180
21
0
0
LINE
8
WALLS
10
180
20
0
11
180
21
110
0
LINE
8
WALLS
10
180
20
110
11
0
21
110
0
LINE
8
WALLS
10
0
20
110
11
0
21
0
0
LWPOLYLINE
8
ROOMS
70
1
10
20
20
20
10
82
20
20
10
82
20
92
10
20
20
92
0
LWPOLYLINE
8
ROOMS
70
1
10
98
20
20
10
160
20
20
10
160
20
92
10
98
20
92
0
CIRCLE
8
FURNITURE
62
6
10
50
20
56
40
13
0
ARC
8
DOORS
10
98
20
20
40
22
50
0
51
90
0
TEXT
8
LABELS
62
1
7
ARCH
10
28
20
56
40
7
41
0.92
50
0
72
1
73
2
1
Room A
0
TEXT
8
LABELS
62
5
7
ARCH
10
106
20
56
40
7
41
0.92
50
0
72
1
73
2
1
Room B
0
ENDSEC
0
EOF`);
}

function createNeonCityDxfFixture(): Uint8Array {
  return new TextEncoder().encode(`0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
SKYLINE
62
4
0
LAYER
2
ENERGY
62
6
0
LAYER
2
ORBIT
62
5
0
LAYER
2
BEACONS
62
2
0
LAYER
2
LABELS
62
3
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
SKYLINE
70
1
10
-140
20
-70
10
-140
20
10
10
-112
20
10
10
-112
20
62
10
-82
20
62
10
-82
20
22
10
-54
20
22
10
-54
20
92
10
-20
20
92
10
-20
20
30
10
18
20
30
10
18
20
118
10
48
20
118
10
48
20
48
10
78
20
48
10
78
20
78
10
108
20
78
10
108
20
18
10
140
20
18
10
140
20
-70
0
LINE
8
ENERGY
10
-140
20
-45
11
140
21
45
0
LINE
8
ENERGY
10
-140
20
45
11
140
21
-45
0
LINE
8
ENERGY
10
0
20
-70
11
0
21
138
0
CIRCLE
8
ORBIT
10
0
20
30
40
72
0
CIRCLE
8
ORBIT
10
0
20
30
40
52
0
CIRCLE
8
ORBIT
10
0
20
30
40
30
0
ARC
8
BEACONS
10
0
20
30
40
88
50
18
51
162
0
ARC
8
BEACONS
10
0
20
30
40
96
50
198
51
342
0
CIRCLE
8
BEACONS
10
0
20
30
40
7
0
CIRCLE
8
BEACONS
10
-112
20
74
40
5
0
CIRCLE
8
BEACONS
10
48
20
130
40
5
0
CIRCLE
8
BEACONS
10
108
20
90
40
5
0
TEXT
8
LABELS
10
-62
20
-96
40
12
1
NEON CITY  //  2099
0
ENDSEC
0
EOF`);
}

function createVectorPosterDataUrl(title: string, subtitle: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
  <defs>
    <radialGradient id="glow"><stop stop-color="${accent}" stop-opacity=".42"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse"><path d="M54 0H0V54" fill="none" stroke="${accent}" stroke-opacity=".12"/></pattern>
  </defs>
  <rect width="1440" height="900" fill="#060914"/>
  <rect width="1440" height="900" fill="url(#grid)"/>
  <circle cx="1040" cy="450" r="390" fill="url(#glow)"/>
  <g fill="none" stroke="${accent}">
    <circle cx="1040" cy="450" r="260" stroke-width="2"/><circle cx="1040" cy="450" r="190" stroke-opacity=".6"/>
    <path d="M1040 130 1295 620H785Z" stroke-width="4"/><path d="M1040 210 1225 575H855Z" stroke-opacity=".6"/>
    <path d="M80 760H1360M80 110H1360" stroke-opacity=".55" stroke-width="2"/>
  </g>
  <circle cx="1040" cy="450" r="22" fill="${accent}"/>
  <text x="82" y="330" fill="#f8fafc" font-family="Impact, sans-serif" font-size="112" letter-spacing="-2">${escapeHtml(title)}</text>
  <text x="88" y="382" fill="${accent}" font-family="system-ui, sans-serif" font-size="22" font-weight="800" letter-spacing="5">${escapeHtml(subtitle)}</text>
  <text x="88" y="690" fill="#94a3b8" font-family="monospace" font-size="18">VECTOR / TYPE / SIGNAL / 2035</text>
  <text x="88" y="810" fill="#64748b" font-family="monospace" font-size="15">FILES PREVIEWER — DESIGN SOURCE CONVERTED TO SVG</text>
  <rect x="82" y="430" width="330" height="9" fill="${accent}"/><rect x="82" y="455" width="210" height="9" fill="${accent}" opacity=".45"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createMinimalPdf(label = 'Generic PDF preview'): Uint8Array {
  const safeLabel = label.replace(/[()\\]/g, '');
  const streams = [
    `q 0.08 0.16 0.24 rg 0 610 612 182 re f Q
BT /F2 34 Tf 48 710 Td (File Preview) Tj 0 -44 Td (Regression Report) Tj /F1 14 Tf 0 -42 Td (${safeLabel}) Tj ET
q 0.95 0.45 0.12 rg 48 548 128 8 re f Q
BT /F2 18 Tf 48 500 Td (Coverage goals) Tj /F1 12 Tf 0 -30 Td (1. Multi-page navigation and zoom) Tj 0 -22 Td (2. Vector graphics, fills, and rules) Tj 0 -22 Td (3. Tables, long text, and numeric data) Tj 0 -22 Td (4. Multiple fonts and font sizes) Tj ET
BT /F1 10 Tf 48 80 Td (Generated 2026-08-03  |  Page 1 of 4) Tj ET`,
    `BT /F2 24 Tf 48 730 Td (Quarterly dashboard) Tj /F1 11 Tf 0 -24 Td (Values include positive, negative, zero, and percentages.) Tj ET
q 0.92 0.95 0.98 rg 48 590 156 92 re f 228 590 156 92 re f 408 590 156 92 re f Q
BT /F1 11 Tf 64 650 Td (Revenue) Tj /F2 24 Tf 0 -34 Td ($128.4K) Tj /F1 11 Tf 180 34 Td (Margin) Tj /F2 24 Tf 0 -34 Td (42.5%) Tj /F1 11 Tf 180 34 Td (Returns) Tj /F2 24 Tf 0 -34 Td (-7.2%) Tj ET
q 0.12 0.55 0.42 rg 70 180 64 300 re f 0.18 0.42 0.76 rg 166 180 64 238 re f 0.95 0.45 0.12 rg 262 180 64 348 re f 0.55 0.34 0.72 rg 358 180 64 185 re f 0.78 0.22 0.22 rg 454 180 64 272 re f Q
0.65 G 1 w 48 180 m 552 180 l S
BT /F1 10 Tf 82 160 Td (Q1) Tj 96 0 Td (Q2) Tj 96 0 Td (Q3) Tj 96 0 Td (Q4) Tj 96 0 Td (Q5) Tj ET
BT /F1 10 Tf 48 80 Td (Dashboard vectors  |  Page 2 of 4) Tj ET`,
    `BT /F2 24 Tf 48 730 Td (Transaction table) Tj /F1 10 Tf 0 -24 Td (Grid lines, aligned columns, blank values, and long labels.) Tj ET
q 0.08 0.16 0.24 rg 48 650 516 34 re f Q
BT /F2 10 Tf 58 663 Td (DATE) Tj 92 0 Td (CUSTOMER) Tj 180 0 Td (STATUS) Tj 92 0 Td (AMOUNT) Tj ET
0.75 G 0.7 w 48 650 m 48 402 l 564 402 l 564 650 l S 48 616 m 564 616 l S 48 582 m 564 582 l S 48 548 m 564 548 l S 48 514 m 564 514 l S 48 480 m 564 480 l S 48 446 m 564 446 l S 140 650 m 140 402 l S 320 650 m 320 402 l S 412 650 m 412 402 l S
BT /F1 10 Tf 58 629 Td (2026-08-01) Tj 92 0 Td (Alice & Co.) Tj 180 0 Td (Paid) Tj 92 0 Td (42,500.00) Tj
-364 -34 Td (2026-08-02) Tj 92 0 Td (Bob Industries) Tj 180 0 Td (Pending) Tj 92 0 Td (-725.50) Tj
-364 -34 Td (2026-08-03) Tj 92 0 Td (Cafe International) Tj 180 0 Td (Paid) Tj 92 0 Td (0.00) Tj
-364 -34 Td (2026-08-04) Tj 92 0 Td (Very Long Customer Name Ltd.) Tj 180 0 Td (Review) Tj 92 0 Td (6.02E+23) Tj
-364 -34 Td (2026-08-05) Tj 92 0 Td (Blank amount) Tj 180 0 Td (Draft) Tj
-272 -34 Td (2026-08-06) Tj 92 0 Td (Quoted value) Tj 180 0 Td (Paid) Tj 92 0 Td (3.14159) Tj ET
BT /F1 10 Tf 48 80 Td (Structured table  |  Page 3 of 4) Tj ET`,
    `BT /F2 24 Tf 48 730 Td (Typography and edge cases) Tj ET
BT /F1 9 Tf 48 690 Td (Small text: 0123456789 !@#$%^&*\\(\\) [] {} <> / \\ |) Tj /F1 12 Tf 0 -28 Td (Regular text with mixed CASE and punctuation.) Tj /F2 16 Tf 0 -34 Td (Bold heading inside the page) Tj /F1 12 Tf 0 -30 Td (A deliberately long line checks clipping and horizontal scaling across the available page width without relying on automatic wrapping.) Tj 0 -24 Td (Second line after explicit positioning.) Tj ET
q 0.94 0.95 0.97 rg 48 410 516 120 re f Q
BT /F2 13 Tf 64 500 Td (Callout) Tj /F1 11 Tf 0 -24 Td (Negative: -42.5   Decimal: 3.14159   Scientific: 6.02E23) Tj 0 -20 Td (Date: 2026-08-03T14:30:00+08:00   Percent: 50%) Tj 0 -20 Td (Blank field follows: [          ]) Tj ET
q 0.95 0.45 0.12 rg 48 350 516 4 re f Q
BT /F1 10 Tf 48 80 Td (Typography matrix  |  Page 4 of 4) Tj ET`
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R] /Count 4 >>',
    ...streams.flatMap((stream, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + index * 2} 0 R /Resources << /Font << /F1 11 0 R /F2 12 0 R >> >> >>`,
      `<< /Length ${stream.length} >> stream\n${stream}\nendstream`
    ]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj ${object} endobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function createToneWav(): Uint8Array {
  const sampleRate = 16000;
  const samples = sampleRate;
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples; index += 1) {
    const edgeFade = Math.min(index / 400, (samples - index - 1) / 400, 1);
    const value = Math.sin((index / sampleRate) * Math.PI * 2 * 440) * edgeFade;
    view.setInt16(44 + index * 2, Math.round(value * 12000), true);
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

async function createOdfPackage(mimetype: string, content: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', mimetype, { compression: 'STORE' });
  zip.file('content.xml', content);
  zip.file(
    'META-INF/manifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

function createOdfTextContent(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.3">
  <office:body><office:text>
    <text:h text:outline-level="1">Product Launch Brief</text:h>
    <text:p>Prepared for the September launch review. This sample exercises headings, paragraphs, lists, tables, dates, percentages, and multilingual text.</text:p>
    <text:h text:outline-level="2">Executive summary</text:h>
    <text:p>Revenue target: 128,400 USD. Forecast margin: 42.5%. Risk reserve: -7.2%.</text:p>
    <text:list><text:list-item><text:p>Finalize onboarding and accessibility review</text:p></text:list-item><text:list-item><text:p>Validate Office conversion in browser WASM</text:p></text:list-item><text:list-item><text:p>Publish support and fallback notes</text:p></text:list-item></text:list>
    <text:h text:outline-level="2">Delivery matrix</text:h>
    <table:table table:name="Milestones"><table:table-row><table:table-cell><text:p>Milestone</text:p></table:table-cell><table:table-cell><text:p>Owner</text:p></table:table-cell><table:table-cell><text:p>Status</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Design freeze</text:p></table:table-cell><table:table-cell><text:p>Mia</text:p></table:table-cell><table:table-cell><text:p>Done</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Release candidate</text:p></table:table-cell><table:table-cell><text:p>Noah</text:p></table:table-cell><table:table-cell><text:p>Active</text:p></table:table-cell></table:table-row></table:table>
    <text:h text:outline-level="2">International readiness</text:h>
    <text:p>English, Chinese: \u6587\u4ef6\u9884\u89c8, Arabic: \u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0645\u0644\u0641\u0627\u062a, emoji: \ud83d\ude80.</text:p>
  </office:text></office:body>
</office:document-content>`;
}

function createOdfPresentationContent(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
  <office:body><office:presentation>
    <draw:page draw:name="Quarterly Review"><text:p>Quarterly Review</text:p><text:p>Growth, quality, and delivery confidence</text:p><text:p>FY2026 / Q3</text:p></draw:page>
    <draw:page draw:name="Scorecard"><text:p>Executive Scorecard</text:p><text:p>Revenue 128.4K / Margin 42.5%</text:p><text:p>Conversion coverage 256 formats</text:p><text:p>Browser-first Rust WASM core</text:p></draw:page>
    <draw:page draw:name="Roadmap"><text:p>Delivery Roadmap</text:p><text:p>1. Improve document fidelity</text:p><text:p>2. Expand realistic regression samples</text:p><text:p>3. Keep bundle size visible</text:p></draw:page>
    <draw:page draw:name="Closing"><text:p>Ready for Review</text:p><text:p>Questions, risks, and next decisions</text:p><text:p>filens</text:p></draw:page>
  </office:presentation></office:body>
</office:document-content>`;
}

function createOdfSpreadsheetContent(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
  <office:body><office:spreadsheet>
    <table:table table:name="Dashboard"><table:table-row><table:table-cell office:value-type="string"><text:p>Metric</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Q1</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Q2</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Q3</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Q4</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Revenue</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42500"><text:p>42500</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="58750.5"><text:p>58750.5</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="49300"><text:p>49300</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="68120.75"><text:p>68120.75</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Growth</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="0.125"><text:p>12.5%</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="-0.0725"><text:p>-7.25%</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="0"><text:p>0%</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="0.314"><text:p>31.4%</text:p></table:table-cell></table:table-row></table:table>
    <table:table table:name="Transactions"><table:table-row><table:table-cell office:value-type="string"><text:p>Date</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Customer</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Status</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Amount</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="date" office:date-value="2026-08-01"><text:p>2026-08-01</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Alice &amp; Co.</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Paid</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42500"><text:p>42500</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="date" office:date-value="2026-08-02"><text:p>2026-08-02</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>International \u4e2d\u6587</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Review</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="-725.5"><text:p>-725.5</text:p></table:table-cell></table:table-row></table:table>
  </office:spreadsheet></office:body>
</office:document>`;
}

function createOdfDrawingContent(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
  <office:body><office:drawing>
    <draw:page draw:name="Brand System"><text:p>Brand System</text:p><text:p>Color, typography, spacing, and component foundations</text:p><text:p>Primary: Ocean Blue / Accent: Signal Orange</text:p></draw:page>
    <draw:page draw:name="User Journey"><text:p>User Journey</text:p><text:p>Import -> Convert in Rust WASM -> Preview -> Review</text:p><text:p>Designed for fast browser-first document workflows</text:p></draw:page>
    <draw:page draw:name="Delivery Board"><text:p>Delivery Board</text:p><text:p>Ready: Office samples and conversion routes</text:p><text:p>Next: richer vector geometry and embedded media</text:p></draw:page>
  </office:drawing></office:body>
</office:document-content>`;
}

async function createWorkbookFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  const inline = (ref: string, value: string, style = 0) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${escapeHtml(value)}</t></is></c>`;
  const customers = ['Alice & Co.', 'Bob Industries', 'Café 中文', 'Delta Labs', 'Echo Retail', 'Foxtrot Studio'];
  const categories = ['Software', 'Services', 'Hardware'];
  const transactionRows = Array.from({ length: 24 }, (_, index) => {
    const row = index + 2;
    const units = index % 7 === 0 ? 0 : (index % 5) + 1;
    const price = index % 6 === 0 ? -7.25 : 19.95 + index * 3.5;
    return `<row r="${row}"><c r="A${row}" s="5"><v>${46237 + index}</v></c>${inline(`B${row}`, customers[index % customers.length] ?? '')}${inline(`C${row}`, categories[index % categories.length] ?? '')}<c r="D${row}"><v>${units}</v></c><c r="E${row}" s="3"><v>${price}</v></c><c r="F${row}" s="3"><f>D${row}*E${row}</f><v>${units * price}</v></c><c r="G${row}" t="b"><v>${index % 3 === 0 ? 0 : 1}</v></c>${inline(`H${row}`, index % 4 === 0 ? 'Long note with café, 中文, and wrapping text' : index % 4 === 1 ? '' : `Batch ${index + 1}`, 7)}</row>`;
  }).join('');

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/><sheet name="Transactions" sheetId="2" r:id="rId2"/><sheet name="Edge Cases 中文" sheetId="3" r:id="rId3"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00;[Red]-$#,##0.00"/></numFmts>
  <fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FF17324D"/><sz val="18"/><name val="Aptos Display"/></font></fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4CC"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
</styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="6" width="16" customWidth="1"/></cols><sheetData>
  <row r="1" ht="34" customHeight="1">${inline('A1', 'FY2026 Preview Dashboard', 1)}</row>
  <row r="3">${inline('A3', 'Metric', 2)}${inline('B3', 'Q1', 2)}${inline('C3', 'Q2', 2)}${inline('D3', 'Q3', 2)}${inline('E3', 'Q4', 2)}${inline('F3', 'Total', 2)}</row>
  <row r="4">${inline('A4', 'Revenue')}<c r="B4" s="3"><v>42500</v></c><c r="C4" s="3"><v>58750.5</v></c><c r="D4" s="3"><v>49300</v></c><c r="E4" s="3"><v>68120.75</v></c><c r="F4" s="3"><f>SUM(B4:E4)</f><v>218671.25</v></c></row>
  <row r="5">${inline('A5', 'Growth')}<c r="B5" s="4"><v>0.125</v></c><c r="C5" s="4"><v>-0.0725</v></c><c r="D5" s="4"><v>0</v></c><c r="E5" s="4"><v>0.314</v></c><c r="F5" s="4"><f>AVERAGE(B5:E5)</f><v>0.091625</v></c></row>
  <row r="6">${inline('A6', 'Orders')}<c r="B6"><v>128</v></c><c r="C6"><v>164</v></c><c r="D6"><v>151</v></c><c r="E6"><v>203</v></c><c r="F6"><f>SUM(B6:E6)</f><v>646</v></c></row>
  <row r="8">${inline('A8', 'Status note', 6)}${inline('B8', 'Mixed formulas, dates, percentages, negative currency, Unicode, merged cells, and sparse ranges.', 7)}</row>
</sheetData><mergeCells count="2"><mergeCell ref="A1:F1"/><mergeCell ref="B8:F9"/></mergeCells></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="3" width="22" customWidth="1"/><col min="4" max="7" width="14" customWidth="1"/><col min="8" max="8" width="42" customWidth="1"/></cols><sheetData><row r="1">${inline('A1', 'Date', 2)}${inline('B1', 'Customer', 2)}${inline('C1', 'Category', 2)}${inline('D1', 'Units', 2)}${inline('E1', 'Unit Price', 2)}${inline('F1', 'Total', 2)}${inline('G1', 'Active', 2)}${inline('H1', 'Note', 2)}</row>${transactionRows}<row r="27">${inline('E27', 'Grand total', 2)}<c r="F27" s="3"><f>SUM(F2:F25)</f><v>4200.1</v></c></row></sheetData><autoFilter ref="A1:H25"/></worksheet>`);
  zip.file('xl/worksheets/sheet3.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/></cols><sheetData>
  <row r="1">${inline('A1', 'Case', 2)}${inline('B1', 'Value', 2)}</row>
  <row r="2">${inline('A2', 'Boolean true')}<c r="B2" t="b"><v>1</v></c></row><row r="3">${inline('A3', 'Boolean false')}<c r="B3" t="b"><v>0</v></c></row>
  <row r="4">${inline('A4', 'Scientific')}<c r="B4"><v>6.02E23</v></c></row><row r="5">${inline('A5', 'Negative currency')}<c r="B5" s="3"><v>-725.5</v></c></row>
  <row r="6">${inline('A6', 'Date')}<c r="B6" s="5"><v>46237</v></c></row><row r="7">${inline('A7', 'Formula')}<c r="B7"><f>1/3</f><v>0.333333333333333</v></c></row>
  <row r="8">${inline('A8', 'Error')}<c r="B8" t="e"><v>#DIV/0!</v></c></row><row r="9">${inline('A9', 'Blank middle cell')}<c r="D9" t="inlineStr"><is><t>Trailing cell D9</t></is></c></row>
  <row r="10">${inline('A10', 'Multiline', 7)}${inline('B10', 'line one\nline two\n中文 العربية 😀', 7)}</row>
</sheetData><mergeCells count="1"><mergeCell ref="A12:D13"/></mergeCells></worksheet>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function createDocxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/filens" TargetMode="External"/>
</Relationships>`
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="17324D"/><w:sz w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="C75B12"/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="475569"/></w:rPr></w:style>
</w:styles>`
  );
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>File Preview Regression Report</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="24"/></w:rPr><w:t>Four pages of typography, tables, lists, links, and edge cases</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Executive summary</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Rich text:</w:t></w:r><w:r><w:t xml:space="preserve"> bold, </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r><w:r><w:t xml:space="preserve">, </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>underline</w:t></w:r><w:r><w:t xml:space="preserve">, </w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>highlight</w:t></w:r><w:r><w:t xml:space="preserve">, and </w:t></w:r><w:r><w:rPr><w:color w:val="C75B12"/></w:rPr><w:t>colored text</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>A realistic sample should make layout failures obvious before users find them.</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Multiple paragraphs and explicit spacing</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Mixed Unicode: café, 中文, العربية, emoji 😀</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Numbers: -42, 3.14159, 6.02E23, 50%</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Structured table</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="64748B"/><w:left w:val="single" w:sz="8" w:color="64748B"/><w:bottom w:val="single" w:sz="8" w:color="64748B"/><w:right w:val="single" w:sz="8" w:color="64748B"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders></w:tblPr>
      <w:tr><w:tc><w:tcPr><w:shd w:fill="17324D"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t>Date</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="17324D"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t>Customer</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="17324D"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t>Status</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="17324D"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t>Amount</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>2026-08-01</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Alice &amp; Co.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Paid</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42,500.00</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>2026-08-02</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Bob Industries</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Pending</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>-725.50</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>2026-08-03</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Café 中文</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Review</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3.14159</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/><w:shd w:fill="FFF4E8"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Formula-style total</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="FFF4E8"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>41,777.64159</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Multilingual and directionality</w:t></w:r></w:p>
    <w:p><w:r><w:t>Latin: The quick brown fox jumps over the lazy dog. Accents: café, naïve, résumé.</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/></w:rPr><w:t>中文：文件预览需要正确处理字体、换行、标点和表格。</w:t></w:r></w:p>
    <w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>العربية: معاينة المستندات تحتاج إلى اتجاه صحيح للنص.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Emoji and symbols: 😀 🚀 ✓ ★ → © ™ € ¥</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Layout edge cases</w:t></w:r></w:p>
    <w:p><w:r><w:t>Before tab</w:t></w:r><w:r><w:tab/><w:t>after tab</w:t></w:r><w:r><w:br/><w:t>after line break</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="rIdLink"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t>External hyperlink fixture</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>This deliberately long justified paragraph checks line wrapping, spacing, and page-width calculations across a realistic sentence containing dates such as 2026-08-03T14:30:00+08:00, percentages such as 50%, scientific values such as 6.02E23, and punctuation such as &lt;tag attr=&quot;A&amp;B&quot;&gt;.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Final paragraph after blank spacing.</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

async function createArchiveFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('README.txt', 'Generated archive preview sample\n\nContains nested folders, Unicode names, an empty file, JSON, source code, and SVG.\n');
  zip.file('src/preview.ts', "export const family = 'archive';\nexport const formats = ['zip', 'cbz', 'epub'] as const;\n");
  zip.file('data/manifest.json', JSON.stringify({ version: 1, active: true, values: [42, -7.25, null], label: 'café 中文' }, null, 2));
  zip.file('empty/.keep', '');
  zip.file('assets/image.svg', decodeURIComponent(createSvgDataUrl().split(',', 2)[1] ?? ''));
  return zip.generateAsync({ type: 'uint8array' });
}

async function createEpubFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Generated EPUB Preview</dc:title>
    <dc:creator>filens</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
    <itemref idref="chapter-3"/>
  </spine>
</package>`
  );
  zip.file(
    'OPS/chapter1.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Opening</title></head><body><main style="font-family: system-ui, sans-serif; padding: 32px;"><h1>Opening</h1><p>This EPUB is generated in the demo and rendered by the generic ebook driver.</p><p>Unicode coverage: café, 中文, العربية, and emoji 😀.</p><blockquote>A block quote checks nested flow content and margins.</blockquote></main></body></html>`
  );
  zip.file(
    'OPS/chapter2.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Next Chapter</title></head><body><main style="font-family: system-ui, sans-serif; padding: 32px;"><h1>Next Chapter</h1><p>Prev and Next switch between spine chapters.</p><ol><li>First list item</li><li>Second item with <strong>bold</strong> and <em>italic</em> text.</li></ol><table border="1"><tr><th>Name</th><th>Value</th></tr><tr><td>Alice</td><td>42.5</td></tr></table></main></body></html>`
  );
  zip.file(
    'OPS/chapter3.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Closing</title></head><body><main style="font-family: system-ui, sans-serif; padding: 32px;"><h1>Closing</h1><p>A short final chapter checks three-item navigation and end-of-spine behavior.</p><pre>name\tvalue\nalpha\t42\nempty\t</pre></main></body></html>`
  );
  return zip.generateAsync({ type: 'uint8array' });
}

async function createCbzFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('page-1.svg', createComicPageSvg('Page 1', '#2d5f9a', '#f7c948'));
  zip.file('page-2.svg', createComicPageSvg('Page 2', '#1f7a5c', '#f6f8fb'));
  zip.file('page-3.svg', createComicPageSvg('Page 3', '#7c3aed', '#fef3c7'));
  return zip.generateAsync({ type: 'uint8array' });
}

function createComicPageSvg(title: string, background: string, foreground: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1280" viewBox="0 0 900 1280">
  <rect width="900" height="1280" fill="${background}"/>
  <rect x="80" y="90" width="740" height="1020" fill="none" stroke="${foreground}" stroke-width="18"/>
  <circle cx="450" cy="430" r="180" fill="${foreground}" opacity="0.92"/>
  <text x="450" y="735" text-anchor="middle" font-family="system-ui, sans-serif" font-size="86" font-weight="700" fill="${foreground}">${title}</text>
  <text x="450" y="835" text-anchor="middle" font-family="system-ui, sans-serif" font-size="42" fill="${foreground}">CBZ comic preview</text>
</svg>`;
}

const genericSnippet = `<Preview
  :src="file"
  :name="file.name"
  :font-resolver="fontResolver"
  :resource-resolver="resourceResolver"
  fit="contain"
/>`;

const compatibilitySnippet = `<PptxPreview :src="'/samples/sample-deck.pptx'" fit="contain" />
<IworkPreview :src="'/samples/a.key'" type="key" />`;
</script>

<template>
  <main class="workbench" :data-layout="layoutMode">
    <header class="wb-header">
      <div class="wb-brand">
        <span class="wb-brand-mark" aria-hidden="true"></span>
        <div>
          <p class="wb-eyebrow">REAL FILE PREVIEW <span>5.6</span></p>
          <h1 class="wb-title">文件预览台</h1>
          <p class="wb-subtitle" :title="current.name">{{ viewerLabel }}</p>
        </div>
      </div>

      <div class="wb-header-right">
        <div class="wb-status" aria-live="polite">
          <span class="wb-status-dot" aria-hidden="true"></span>
          <strong>{{ familyLabel }}</strong>
          <small>{{ sourceMode }}</small>
        </div>

        <label class="wb-upload">
          <span aria-hidden="true">+</span>
          导入文件
          <input class="visually-hidden" type="file" :accept="uploadAccept" multiple @change="onFileChange" />
        </label>

        <form class="wb-remote" @submit.prevent="previewRemote">
          <input v-model="remoteUrl" type="url" class="wb-remote-input" placeholder="粘贴远程文件 URL" />
          <button type="submit" class="wb-remote-button">预览 <span aria-hidden="true">&rarr;</span></button>
        </form>
      </div>
    </header>

    <section class="wb-commandbar" aria-label="视图模式">
      <span class="wb-command-label">视图</span>
      <nav class="wb-layouts" aria-label="界面布局">
        <button
          v-for="tab in layoutTabs"
          :key="tab.mode"
          type="button"
          class="wb-layout"
          :class="{ 'is-active': layoutMode === tab.mode }"
          :aria-pressed="layoutMode === tab.mode"
          @click="layoutMode = tab.mode"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="wb-command-file">
        <span>ACTIVE</span>
        <strong>{{ current.name }}</strong>
      </div>
    </section>

    <nav class="wb-tabs" aria-label="格式分类">
      <span class="wb-command-label">格式</span>
      <button
        v-for="family in businessFormatFamilies"
        :key="family.id"
        type="button"
        class="wb-tab"
        :class="{ 'is-active': selectedFormatFamilyId === family.id }"
        :aria-pressed="selectedFormatFamilyId === family.id"
        @click="selectFormatFamily(family.id)"
      >
        {{ family.label }}
      </button>
    </nav>

    <div :class="layoutBodyClass">
      <aside class="wb-sidebar" aria-label="文件导航与样例">
        <header class="wb-sidebar-head">
          <span class="wb-file-badge">{{ current.label }}</span>
          <div>
            <p>当前文件</p>
            <h2 :title="current.name">{{ current.name }}</h2>
          </div>
        </header>

        <div class="wb-file-facts">
          <span>
            <small>驱动</small>
            <strong>{{ familyLabel }}</strong>
          </span>
          <span>
            <small>来源</small>
            <strong>{{ sourceMode }}</strong>
          </span>
        </div>

        <p v-if="warningCount" class="wb-note">{{ warningCount }} warning{{ warningCount > 1 ? 's' : '' }}</p>
        <p v-if="lastError" class="wb-note is-error">{{ lastError }}</p>
        <p v-if="layoutMode === 'compare' && compareError" class="wb-note is-error">{{ compareError }}</p>

        <section v-if="selectedFormatFamily" class="wb-section wb-subformat-section">
          <h2 class="wb-section-title">{{ selectedFormatFamily.label }}</h2>
          <p class="wb-format-hint">实线：已支持 · 双线：转换后展示 · 虚线：已归类，待支持</p>
          <div v-for="category in selectedFormatFamily.categories" :key="category.id" class="wb-format-category">
            <h3>{{ category.label }}</h3>
            <div class="wb-subformats">
              <button
                v-for="format in category.formats"
                :key="`${format.family}:${format.extension}`"
                type="button"
                class="wb-subformat"
                :class="{ 'is-active': activeFormatExtension === format.extension, 'is-sample-only': format.sampleOnly, 'is-unavailable': !format.supported && !format.sampleOnly }"
                :disabled="(!format.supported && !format.sampleOnly) || !sampleByExtension.has(format.extension)"
                :title="format.sampleOnly ? '转换后 SVG 展示示例；暂不支持直接上传原格式' : !format.supported ? '已归类，暂未支持预览' : sampleByExtension.has(format.extension) ? `预览 ${format.label} 示例` : '支持上传预览，暂无内置示例'"
                @click="useFormatSample(format.extension)"
              >
                {{ format.label }}
              </button>
            </div>
          </div>
        </section>

        <div v-if="showSideTabs" class="wb-side-tabs" role="tablist" aria-label="侧边栏内容">
          <button
            type="button"
            class="wb-side-tab"
            :class="{ 'is-active': sidebarTab === 'navigator' }"
            :disabled="!navigatorKind"
            :aria-selected="sidebarTab === 'navigator'"
            @click="sidebarTab = 'navigator'"
          >
            导航
          </button>
          <button
            type="button"
            class="wb-side-tab"
            :class="{ 'is-active': sidebarTab === 'samples' || !navigatorKind }"
            :aria-selected="sidebarTab === 'samples' || !navigatorKind"
            @click="sidebarTab = 'samples'"
          >
            样例
          </button>
        </div>

        <section v-if="showNavigatorPanel" class="wb-section">
          <h2 class="wb-section-title">{{ navigatorTitle }}</h2>
          <div class="wb-navigator">
            <button
              v-for="item in navigatorItems"
              :key="navigatorKind + ':' + item.index"
              type="button"
              class="wb-nav-item"
              :class="{ 'is-active': item.index === navigatorActiveIndex }"
              :aria-current="item.index === navigatorActiveIndex ? 'page' : undefined"
              @click="goToNavigator(item.index)"
            >
              <span class="wb-nav-index">{{ String(item.index + 1).padStart(2, '0') }}</span>
              <span class="wb-nav-label">{{ item.label }}</span>
            </button>
          </div>
        </section>

        <section v-else-if="showSamplesPanel" class="wb-section">
          <h2 class="wb-section-title">格式样例</h2>
          <div class="wb-variants">
            <button
              v-for="sample in activeKindSamples"
              :key="sample.kind + ':' + sample.name"
              type="button"
              class="wb-variant"
              :class="{ 'is-active': sample.name === current.name && hasCurrentSample }"
              @click="useSample(sample)"
            >
              <span>{{ sample.label }}</span>
              <small class="wb-variant-meta">{{ sample.name }}</small>
            </button>
          </div>
          <div v-if="activeKind === 'panorama'" class="wb-external-samples">
            <h3 class="wb-section-title">External raw samples</h3>
            <div
              v-for="sample in externalPanoramaSamples"
              :key="sample.format"
              class="wb-external-sample"
            >
              <button type="button" @click="useSample(sample)">
                <strong>{{ sample.format }}</strong>
                <span>{{ sample.label }}</span>
                <small>{{ sample.size }} · {{ sample.note }}</small>
              </button>
              <a :href="sample.sourcePage" target="_blank" rel="noreferrer">Source</a>
            </div>
          </div>
        </section>

        <section v-if="model3dSummary.length" class="wb-section">
          <h2 class="wb-section-title">3D 元数据</h2>
          <div class="wb-meta-grid">
            <div v-for="row in model3dSummary" :key="row.label" class="wb-meta-item">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>

        <section v-if="layoutMode === 'compare'" class="wb-section">
          <h2 class="wb-section-title">对比对象</h2>
          <div class="wb-variants">
            <button
              v-for="tab in kindTabs"
              :key="'compare:' + tab.kind"
              type="button"
              class="wb-variant"
              :class="{ 'is-active': tab.kind === compareSource.kind }"
              @click="activateCompareKind(tab.kind)"
            >
              <span>{{ tab.label }}</span>
              <small class="wb-variant-meta">{{ (staticSamplesByKind.get(tab.kind)?.[0]?.name) ?? '' }}</small>
            </button>
          </div>
        </section>
      </aside>

      <section class="wb-preview" :aria-label="current.name + ' 预览'">
        <header class="wb-preview-head">
          <div class="wb-window-dots" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="wb-preview-title">
            <span>{{ current.label }}</span>
            <strong :title="current.name">{{ current.name }}</strong>
          </div>
          <span class="wb-preview-mode">{{ layoutMode }}</span>
        </header>

        <div class="wb-preview-stage">
          <div v-if="layoutMode === 'compare'" class="wb-compare">
            <div class="wb-compare-pane">
              <div class="wb-compare-title"><span>A</span>{{ viewerLabel }}</div>
              <AppleLivePhotoPreview
                v-if="current.livePhoto"
                :photo-src="current.livePhoto.photoSrc"
                :video-src="current.livePhoto.videoSrc"
                :original-photo-src="current.livePhoto.originalPhotoSrc"
                :original-video-src="current.livePhoto.originalVideoSrc"
                :title="current.label"
              />
              <Preview
                v-else
                ref="previewRef"
                :src="current.source"
                :name="current.name"
                :extension="current.extension"
                :content-type="current.contentType"
                :converter="converter"
                :panorama-processor="panoramaProcessor"
                :font-resolver="fontResolver"
                :resource-resolver="uploadResourceResolver"
                fit="contain"
                :toolbar="true"
                style="height: 100%;"
                @rendered="onRendered"
                @state-change="renderedState = $event"
                @error="onError"
              />
            </div>
            <div class="wb-compare-pane">
              <div class="wb-compare-title"><span>B</span>{{ compareSource.label + ' (' + compareSource.name + ')' }}</div>
              <Preview
                ref="compareRef"
                :src="compareSource.source"
                :name="compareSource.name"
                :extension="compareSource.extension"
                :content-type="compareSource.contentType"
                :converter="converter"
                :panorama-processor="panoramaProcessor"
                :font-resolver="fontResolver"
                fit="contain"
                :toolbar="true"
                style="height: 100%;"
                @rendered="compareRenderedState = $event"
                @state-change="compareRenderedState = $event"
                @error="onCompareError"
              />
            </div>
          </div>

          <AppleLivePhotoPreview
            v-else-if="current.livePhoto"
            :photo-src="current.livePhoto.photoSrc"
            :video-src="current.livePhoto.videoSrc"
            :original-photo-src="current.livePhoto.originalPhotoSrc"
            :original-video-src="current.livePhoto.originalVideoSrc"
            :title="current.label"
          />
          <Preview
            v-else
            :key="current.name"
            ref="previewRef"
            :src="current.source"
            :name="current.name"
            :extension="current.extension"
            :content-type="current.contentType"
            :converter="converter"
            :panorama-processor="panoramaProcessor"
            :font-resolver="fontResolver"
            :resource-resolver="uploadResourceResolver"
            fit="contain"
            :toolbar="true"
            style="height: 100%;"
            @rendered="onRendered"
            @state-change="renderedState = $event"
            @error="onError"
          />
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
:global(html) {
  min-width: 320px;
  background: #e8e7df;
}

:global(body) {
  margin: 0;
  min-width: 320px;
  background: #e8e7df;
}

.workbench,
.workbench * {
  box-sizing: border-box;
}

.workbench {
  --ink: #151713;
  --muted: #6f7369;
  --paper: #f4f2e9;
  --panel: rgba(255, 255, 255, 0.84);
  --line: rgba(21, 23, 19, 0.13);
  --lime: #c8ff3d;
  --coral: #ff6847;
  --blue: #3164ff;
  min-height: 100vh;
  min-height: 100dvh;
  color: var(--ink);
  background:
    radial-gradient(circle at 10% 0%, rgba(200, 255, 61, 0.3), transparent 27rem),
    radial-gradient(circle at 100% 16%, rgba(49, 100, 255, 0.12), transparent 30rem),
    linear-gradient(135deg, #efeee7 0%, #e4e4dc 54%, #edede6 100%);
  font-family: "Bahnschrift", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  isolation: isolate;
}

.workbench::before {
  position: fixed;
  z-index: -1;
  right: -8rem;
  bottom: -12rem;
  width: 32rem;
  height: 32rem;
  border: 1px solid rgba(21, 23, 19, 0.08);
  border-radius: 42%;
  transform: rotate(18deg);
  content: "";
}

.workbench button,
.workbench input {
  font: inherit;
}

.wb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px clamp(18px, 3vw, 44px) 18px;
}

.wb-brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 15px;
}

.wb-brand-mark {
  position: relative;
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  border-radius: 15px;
  background: var(--ink);
  box-shadow: 0 12px 28px rgba(21, 23, 19, 0.2);
  transform: rotate(-3deg);
}

.wb-brand-mark::before,
.wb-brand-mark::after {
  position: absolute;
  content: "";
}

.wb-brand-mark::before {
  inset: 9px 20px 9px 9px;
  border-radius: 8px;
  background: var(--lime);
}

.wb-brand-mark::after {
  right: 8px;
  bottom: 8px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--coral);
}

.wb-eyebrow {
  margin: 0 0 3px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.wb-eyebrow span {
  display: inline-block;
  margin-left: 5px;
  padding: 2px 6px;
  border-radius: 99px;
  background: var(--ink);
  color: var(--lime);
  letter-spacing: 0.08em;
}

.wb-title {
  margin: 0;
  font-family: Georgia, "Microsoft YaHei UI", serif;
  font-size: clamp(24px, 2.6vw, 38px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
}

.wb-subtitle {
  max-width: min(46vw, 620px);
  margin: 7px 0 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.wb-status,
.wb-upload,
.wb-remote {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.68);
  box-shadow: 0 8px 24px rgba(21, 23, 19, 0.05);
  backdrop-filter: blur(16px);
}

.wb-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
}

.wb-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lime);
  box-shadow: 0 0 0 4px rgba(200, 255, 61, 0.2);
}

.wb-status strong {
  font-size: 11px;
  text-transform: uppercase;
}

.wb-status small {
  padding-left: 7px;
  border-left: 1px solid var(--line);
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
}

.wb-upload {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition: transform 160ms ease, background 160ms ease;
}

.wb-upload > span {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 7px;
  background: var(--ink);
  color: white;
  font-size: 18px;
  line-height: 1;
}

.wb-upload:hover {
  background: white;
  transform: translateY(-1px);
}

.wb-remote {
  display: grid;
  grid-template-columns: minmax(180px, 26vw) auto;
  overflow: hidden;
}

.wb-remote-input {
  min-width: 0;
  padding: 0 14px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
}

.wb-remote-input::placeholder {
  color: #979b91;
}

.wb-remote-button {
  padding: 0 16px;
  border: 0;
  background: var(--ink);
  color: white;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition: background 160ms ease;
}

.wb-remote-button:hover {
  background: var(--blue);
}

.wb-commandbar,
.wb-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-inline: clamp(12px, 2vw, 28px);
  border: 1px solid var(--line);
  background: rgba(247, 246, 240, 0.76);
  backdrop-filter: blur(18px);
}

.wb-commandbar {
  min-height: 54px;
  padding: 7px 8px 7px 14px;
  border-radius: 18px 18px 0 0;
}

.wb-command-label {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.wb-layouts {
  display: flex;
  gap: 5px;
}

.wb-layout,
.wb-tab {
  flex: 0 0 auto;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  font-weight: 800;
  white-space: nowrap;
  transition: color 160ms ease, background 160ms ease, transform 160ms ease;
}

.wb-layout {
  min-height: 34px;
  padding: 0 14px;
  border-radius: 11px;
  background: transparent;
  font-size: 11px;
}

.wb-layout:hover,
.wb-tab:hover {
  color: var(--ink);
  transform: translateY(-1px);
}

.wb-layout.is-active {
  background: var(--ink);
  color: white;
  box-shadow: 0 8px 18px rgba(21, 23, 19, 0.14);
}

.wb-command-file {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: auto;
  padding: 0 8px;
}

.wb-command-file span {
  color: var(--coral);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.wb-command-file strong {
  max-width: 260px;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-tabs {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px 12px 9px 14px;
  border-top: 0;
  border-radius: 0 0 18px 18px;
  overflow-x: auto;
  scrollbar-width: none;
}

.wb-tabs::-webkit-scrollbar {
  display: none;
}

.wb-tab {
  flex: 0 0 auto;
  min-height: 31px;
  padding: 0 11px;
  border-radius: 99px;
  background: transparent;
  font-size: 10px;
}

.wb-tab.is-active {
  background: var(--lime);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px rgba(21, 23, 19, 0.08);
}

.wb-subformat-section {
  margin-top: 16px;
}

.wb-subformats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wb-format-category + .wb-format-category {
  margin-top: 12px;
}

.wb-format-category h3 {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.wb-format-hint {
  margin: -4px 0 10px;
  color: var(--muted);
  font-size: 9px;
}

.wb-subformat {
  min-width: 48px;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper);
  color: var(--ink);
  font-size: 10px;
  font-weight: 800;
}

.wb-subformat.is-active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--lime);
}

.wb-subformat:disabled {
  cursor: default;
  opacity: 0.58;
}

.wb-subformat.is-unavailable {
  border-style: dashed;
}

.wb-subformat.is-sample-only {
  border-style: double;
  border-width: 3px;
}

.wb-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(250px, 310px) minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  padding: 14px clamp(12px, 2vw, 28px) clamp(14px, 2vw, 28px);
}

.wb-body.is-compare {
  grid-template-columns: minmax(250px, 290px) minmax(0, 1fr);
}

.wb-sidebar,
.wb-preview {
  min-height: 0;
  border: 1px solid var(--line);
  box-shadow: 0 18px 50px rgba(21, 23, 19, 0.09);
}

.wb-sidebar {
  padding: 16px;
  border-radius: 24px;
  background: var(--panel);
  overflow: auto;
  backdrop-filter: blur(20px);
}

.wb-sidebar-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.wb-file-badge {
  display: grid;
  min-width: 50px;
  height: 50px;
  padding-inline: 8px;
  place-items: center;
  border-radius: 15px;
  background: var(--ink);
  color: var(--lime);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.wb-sidebar-head p {
  margin: 0 0 3px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.wb-sidebar-head h2 {
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-file-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 12px;
}

.wb-file-facts > span {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 13px;
  background: rgba(21, 23, 19, 0.045);
}

.wb-file-facts small {
  color: var(--muted);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.wb-file-facts strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.wb-note {
  margin: 10px 0 0;
  padding: 9px 11px;
  border-radius: 11px;
  background: rgba(255, 190, 47, 0.15);
  color: #725100;
  font-size: 11px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.wb-note.is-error {
  background: rgba(255, 104, 71, 0.13);
  color: #9b2e17;
}

.wb-side-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-top: 14px;
  padding: 4px;
  border-radius: 14px;
  background: rgba(21, 23, 19, 0.06);
}

.wb-side-tab {
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
}

.wb-side-tab.is-active {
  background: white;
  color: var(--ink);
  box-shadow: 0 5px 14px rgba(21, 23, 19, 0.08);
}

.wb-side-tab:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.wb-section {
  margin-top: 16px;
}

.wb-section-title {
  margin: 0 0 9px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.wb-navigator,
.wb-variants {
  display: grid;
  gap: 7px;
}

.wb-external-samples {
  display: grid;
  gap: 7px;
  margin-top: 16px;
}

.wb-external-sample {
  display: flex;
  align-items: stretch;
  border: 1px solid rgba(21, 23, 19, 0.08);
  border-radius: 14px;
  background: rgba(21, 23, 19, 0.035);
  color: var(--ink);
  font-size: 11px;
  overflow: hidden;
}

.wb-external-sample:hover {
  border-color: rgba(21, 23, 19, 0.13);
  background: white;
}

.wb-external-sample button {
  display: grid;
  flex: 1;
  gap: 3px;
  padding: 11px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.wb-external-sample small,
.wb-external-sample a {
  color: var(--muted);
}

.wb-external-sample a {
  display: grid;
  place-items: center;
  padding: 0 10px;
  border-left: 1px solid rgba(21, 23, 19, 0.08);
  font-size: 9px;
  font-weight: 800;
  text-decoration: none;
}

.wb-nav-item,
.wb-variant {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 14px;
  background: rgba(21, 23, 19, 0.035);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.wb-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  font-size: 11px;
  font-weight: 800;
}

.wb-variant {
  display: grid;
  gap: 3px;
  padding: 11px 12px;
  font-size: 11px;
  font-weight: 900;
}

.wb-nav-item:hover,
.wb-variant:hover {
  border-color: rgba(21, 23, 19, 0.13);
  background: white;
  transform: translateX(2px);
}

.wb-nav-item.is-active,
.wb-variant.is-active {
  border-color: rgba(21, 23, 19, 0.14);
  background: var(--lime);
}

.wb-nav-index {
  display: grid;
  flex: 0 0 auto;
  width: 31px;
  height: 31px;
  place-items: center;
  border-radius: 10px;
  background: var(--ink);
  color: white;
  font-family: Consolas, monospace;
  font-size: 10px;
}

.wb-nav-label,
.wb-variant-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-nav-label {
  flex: 1 1 auto;
}

.wb-variant-meta {
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
}

.wb-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.wb-meta-item {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 13px;
  background: rgba(49, 100, 255, 0.08);
}

.wb-meta-item span {
  color: var(--muted);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
}

.wb-meta-item strong {
  font-size: 11px;
}

.wb-preview {
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  min-height: 640px;
  border-radius: 26px;
  background: #191b18;
  overflow: hidden;
}

.wb-preview-head {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  color: #f5f3eb;
}

.wb-window-dots {
  display: flex;
  gap: 5px;
}

.wb-window-dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4a4d46;
}

.wb-window-dots i:first-child {
  background: var(--coral);
}

.wb-window-dots i:nth-child(2) {
  background: #ffc64c;
}

.wb-window-dots i:last-child {
  background: var(--lime);
}

.wb-preview-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.wb-preview-title span,
.wb-preview-mode {
  color: #aeb2a8;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.wb-preview-title strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-preview-mode {
  padding: 5px 8px;
  border: 1px solid #42453f;
  border-radius: 99px;
}

.wb-preview-stage {
  min-width: 0;
  min-height: 0;
  padding: 7px;
  background:
    linear-gradient(rgba(21, 23, 19, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(21, 23, 19, 0.04) 1px, transparent 1px),
    #d7d8d0;
  background-size: 24px 24px;
  overflow: hidden;
}

.wb-preview-stage > :deep(.pptxv-shell),
.wb-compare-pane > :deep(.pptxv-shell) {
  --pptxv-panel: #fbfaf5;
  --pptxv-border: rgba(21, 23, 19, 0.12);
  --pptxv-border-strong: rgba(21, 23, 19, 0.25);
  --pptxv-text: #151713;
  --pptxv-muted: #74786e;
  --pptxv-accent: #3164ff;
  --pptxv-surface: #e6e8e3;
  border: 0;
  border-radius: 17px;
  overflow: hidden;
  font-family: inherit;
}

.wb-preview :deep(.pptxv-toolbar) {
  min-height: 48px;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(250, 249, 244, 0.96);
}

.wb-preview :deep(.pptxv-toolbar-group) {
  gap: 5px;
}

.wb-preview :deep(.pptxv-button) {
  min-height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: white;
  box-shadow: inset 0 0 0 1px rgba(21, 23, 19, 0.13);
  color: var(--ink);
  font-family: inherit;
  font-size: 10px;
  font-weight: 800;
}

.wb-preview :deep(.pptxv-button:hover) {
  background: var(--lime);
  box-shadow: inset 0 0 0 1px rgba(21, 23, 19, 0.12);
}

.wb-preview :deep(.pptxv-button.is-active) {
  background: var(--ink);
  color: white;
}

.wb-preview :deep(.pptxv-status) {
  color: #5f635a;
  font-family: Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
}

.wb-preview :deep(.pptxv-sidebar) {
  background: #f1f0e9;
}

.wb-compare {
  height: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.wb-compare-pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr);
  border-radius: 18px;
  background: white;
  overflow: hidden;
}

.wb-compare-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-compare-title span {
  display: grid;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 7px;
  background: var(--ink);
  color: var(--lime);
  font-size: 9px;
}

.workbench button:focus-visible,
.workbench input:focus-visible,
.wb-upload:has(input:focus-visible) {
  outline: 3px solid rgba(49, 100, 255, 0.35);
  outline-offset: 2px;
}

.wb-sidebar::-webkit-scrollbar {
  width: 9px;
}

.wb-sidebar::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 99px;
  background: rgba(21, 23, 19, 0.22);
  background-clip: padding-box;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .wb-header,
  .wb-commandbar,
  .wb-tabs,
  .wb-body {
    animation: wb-rise 420ms both;
  }

  .wb-commandbar {
    animation-delay: 60ms;
  }

  .wb-tabs {
    animation-delay: 100ms;
  }

  .wb-body {
    animation-delay: 140ms;
  }
}

@keyframes wb-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1080px) {
  .wb-header {
    align-items: flex-start;
  }

  .wb-header-right {
    max-width: 58%;
  }

  .wb-status {
    display: none;
  }

  .wb-body,
  .wb-body.is-compare {
    grid-template-columns: minmax(220px, 270px) minmax(0, 1fr);
  }

  .wb-compare {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .wb-compare-pane {
    min-height: 520px;
  }
}

@media (max-width: 780px) {
  .workbench {
    display: block;
    min-height: 100vh;
  }

  .wb-header {
    align-items: stretch;
    flex-direction: column;
    padding: 18px;
  }

  .wb-header-right {
    max-width: none;
    justify-content: stretch;
  }

  .wb-upload {
    flex: 0 0 auto;
  }

  .wb-remote {
    flex: 1 1 320px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .wb-commandbar,
  .wb-tabs {
    margin-inline: 10px;
  }

  .wb-command-file {
    display: none;
  }

  .wb-body,
  .wb-body.is-compare {
    grid-template-columns: 1fr;
    padding: 10px;
  }

  .wb-sidebar {
    max-height: 360px;
  }

  .wb-preview {
    min-height: 72vh;
  }
}

@media (max-width: 520px) {
  .wb-header-right {
    display: grid;
    grid-template-columns: 1fr;
  }

  .wb-upload {
    justify-content: center;
  }

  .wb-remote {
    width: 100%;
  }

  .wb-commandbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .wb-layouts {
    width: 100%;
  }

  .wb-layout {
    flex: 1 1 0;
  }

  .wb-tabs {
    border-radius: 16px;
  }

  .wb-preview-head {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .wb-preview-mode {
    display: none;
  }

  .wb-preview {
    min-height: 68vh;
    border-radius: 20px;
  }
}
</style>
