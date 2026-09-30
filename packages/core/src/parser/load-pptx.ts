import JSZip from 'jszip';
import type {
  BorderBox,
  ChartItem,
  FillStyle,
  ImageItem,
  InsetBox,
  ItemTransform,
  LineStyle,
  MediaAsset,
  MediaItem,
  ParsedPresentation,
  PlaceholderRef,
  PptxSource,
  ShadowStyle,
  ShapeItem,
  SlideBackground,
  SlideItem,
  SlideModel,
  TableCell,
  TableItem,
  TextFrame,
  TextItem,
  TextParagraph,
  TextRun,
  ThemeModel,
  UnsupportedItem
} from '../types';
import { applyLumMod, applyLumOff, applyShade, applyTint, resolveThemeColor } from '../utils/colors';
import { asArray, clamp, createId, deepClone, resolvePartPath, toNumber } from '../utils/common';
import { angleToDegrees, emuToPx } from '../utils/units';
import { loadSourceBytes, type LoadSourceOptions } from './load-source';
import { parseXmlFile, parseXmlFileOrdered, type OrderedXmlNode, type XmlNode } from './xml';

type XmlRecord = Record<string, any>;
type OrderedXmlEntry = Record<string, unknown>;

interface RelationshipEntry {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
}

interface ContentTypes {
  overrides: Record<string, string>;
  defaults: Record<string, string>;
}

interface GroupContext {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  matrix: AffineMatrix;
  groupPath: string[];
  fill?: FillStyle;
}

interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface SlideItemDraft {
  item: SlideItem;
  placeholderKey?: string;
  hasTransform: boolean;
  hasText: boolean;
  hasFill: boolean;
  hasLine: boolean;
  textFrameStyleFlags?: TextFrameStyleFlags;
}

interface MasterBundle {
  fixedItems: SlideItemDraft[];
  placeholders: Map<string, SlideItemDraft>;
  background: SlideBackground;
  theme: ThemeModel;
  themeFormatScheme: ThemeFormatScheme;
  textStyles: TextStyleRegistry;
  colorMap: Record<string, string>;
}

interface LayoutBundle {
  fixedItems: SlideItemDraft[];
  placeholders: Map<string, SlideItemDraft>;
  background: SlideBackground;
  theme: ThemeModel;
  themeFormatScheme: ThemeFormatScheme;
  textStyles: TextStyleRegistry;
  colorMap: Record<string, string>;
}

interface ThemeFillStyleEntry {
  tag: 'a:solidFill' | 'a:gradFill' | 'a:noFill' | 'a:pattFill';
  node: XmlRecord;
}

interface ThemeFormatScheme {
  fills: ThemeFillStyleEntry[];
  backgroundFills: ThemeFillStyleEntry[];
  lines: XmlRecord[];
  effects: XmlRecord[];
}

interface ThemeBundle {
  theme: ThemeModel;
  formatScheme: ThemeFormatScheme;
}

interface ParseCaches {
  masters: Map<string, Promise<MasterBundle>>;
  layouts: Map<string, Promise<LayoutBundle>>;
  themes: Map<string, Promise<ThemeBundle>>;
  tableStyles?: Promise<TableStyleRegistry>;
  media: Record<string, MediaAsset>;
  presentationDefaultTextStyle?: XmlRecord;
}

interface TableStyleRegistry {
  defaultStyleId?: string;
  styles: Record<string, TableStyleDefinition>;
}

interface TextStyleRegistry {
  textBox: ListStyleDefaults;
  title: ListStyleDefaults;
  body: ListStyleDefaults;
  other: ListStyleDefaults;
}

interface TableStyleDefinition {
  styleId: string;
  wholeTbl?: XmlRecord;
  band1H?: XmlRecord;
  band2H?: XmlRecord;
  band1V?: XmlRecord;
  band2V?: XmlRecord;
  firstRow?: XmlRecord;
  lastRow?: XmlRecord;
  firstCol?: XmlRecord;
  lastCol?: XmlRecord;
  nwCell?: XmlRecord;
  neCell?: XmlRecord;
  swCell?: XmlRecord;
  seCell?: XmlRecord;
}

interface ResolvedTableStylePart {
  fill?: FillStyle;
  borders?: TableStyleBorderBox;
  textStyle?: {
    run?: TextRunStyle;
    paragraphAlign?: TextParagraph['align'];
  };
}

interface TableStyleBorderBox extends BorderBox {
  insideH?: LineStyle;
  insideV?: LineStyle;
}

type TextRunStyle = Omit<Partial<TextRun>, 'text' | 'href' | 'slideIndex' | 'navigationAction'>;

interface ParagraphStyleDefaults {
  align?: TextParagraph['align'];
  bullet?: TextParagraph['bullet'] | null;
  marginLeft?: number;
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
  lineHeightUnit?: TextParagraph['lineHeightUnit'];
  tabStops?: number[];
  run: TextRunStyle;
}

interface ListStyleDefaults {
  default: ParagraphStyleDefaults;
  levels: Partial<Record<number, ParagraphStyleDefaults>>;
}

interface TextFrameStyleFlags {
  verticalAlign: boolean;
  direction: boolean;
  wrap: boolean;
  anchorCenter: boolean;
  padding: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
}

interface ParseContext {
  theme: ThemeModel;
  themeFormatScheme: ThemeFormatScheme;
  tableStyles: TableStyleRegistry;
  textStyles: TextStyleRegistry;
  placeholderSources?: Map<string, SlideItemDraft>;
  colorMap: Record<string, string>;
  relationships: Record<string, RelationshipEntry>;
  slideIndexByPath: Record<string, number>;
  contentTypes: ContentTypes;
  slidePath: string;
  warnings: string[];
  group: GroupContext;
  orderedTextFrames: Map<string, OrderedXmlNode>;
  orderedShapeNodes: Map<string, OrderedXmlNode>;
  orderedNodeOrders: Map<string, number>;
  diagramDataModels: Record<string, XmlRecord | null>;
  diagramDrawings: Record<string, XmlRecord | null>;
  chartSpaces: Record<string, XmlRecord | null>;
  inDiagram?: boolean;
  caches: ParseCaches;
  zip: JSZip;
}

interface FillParseContext {
  relationships: Record<string, RelationshipEntry>;
  warnings: string[];
  slidePath: string;
  groupFill?: FillStyle;
}

const REL_TYPES = {
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  video: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video',
  audio: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio',
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  diagramData: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData',
  diagramDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
  chart: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'
};

const DEFAULT_THEME: ThemeModel = {
  name: 'Default',
  colors: {
    dk1: '#111827',
    lt1: '#FFFFFF',
    dk2: '#334155',
    lt2: '#F8FAFC',
    accent1: '#2563EB',
    accent2: '#F97316',
    accent3: '#10B981',
    accent4: '#F59E0B',
    accent5: '#8B5CF6',
    accent6: '#0EA5E9',
    hlink: '#2563EB',
    folHlink: '#8B5CF6'
  },
  fonts: {
    major: 'Aptos',
    minor: 'Calibri',
    majorScripts: {},
    minorScripts: {}
  }
};

const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink'
};

const ROOT_GROUP: GroupContext = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  flipH: false,
  flipV: false,
  matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  groupPath: [],
  fill: undefined
};
const SOFT_HYPHEN = '\u00AD';
const NO_BREAK_HYPHEN = '\u2011';

function createEmptyThemeFormatScheme(): ThemeFormatScheme {
  return {
    fills: [],
    backgroundFills: [],
    lines: [],
    effects: []
  };
}

export async function loadPptx(source: PptxSource, options: LoadSourceOptions = {}): Promise<ParsedPresentation> {
  const bytes = await loadSourceBytes(source, options);
  const zip = await JSZip.loadAsync(bytes);
  const warnings: string[] = [];
  const caches: ParseCaches = {
    masters: new Map(),
    layouts: new Map(),
    themes: new Map(),
    media: {}
  };

  const contentTypes = await parseContentTypes(zip);
  const presentationXml = await parseXmlFile(zip, 'ppt/presentation.xml');
  if (!presentationXml?.['p:presentation']) {
    throw new Error('Invalid PPTX: presentation.xml is missing.');
  }

  const presentationRels = await parseRelationships(zip, 'ppt/_rels/presentation.xml.rels');
  const presentationNode = presentationXml['p:presentation'] as XmlRecord;
  caches.presentationDefaultTextStyle = asXmlRecordNode(presentationNode['p:defaultTextStyle']);
  const slideSizeNode = presentationNode['p:sldSz'] as XmlRecord | undefined;
  const size = {
    width: emuToPx(toNumber(slideSizeNode?.cx, 9144000)),
    height: emuToPx(toNumber(slideSizeNode?.cy, 5143500))
  };

  const slideIds = asArray(presentationNode['p:sldIdLst']?.['p:sldId']);
  const slideIndexByPath = Object.fromEntries(
    slideIds.flatMap((slideId, index) => {
      const relId = slideId['r:id'] as string | undefined;
      const relationship = relId ? presentationRels[relId] : undefined;
      return relationship ? [[relationship.target, index]] : [];
    })
  );
  const slides: SlideModel[] = [];
  let activeTheme = DEFAULT_THEME;

  for (const slideId of slideIds) {
    const relId = slideId['r:id'] as string | undefined;
    if (!relId) {
      continue;
    }

    const relationship = presentationRels[relId];
    if (!relationship) {
      warnings.push(`Missing relationship ${relId} in presentation.xml.rels.`);
      continue;
    }

    const slideWarnings: string[] = [];
    const parsed = await parseSlide(
      zip,
      relationship.target,
      size,
      contentTypes,
      caches,
      slideWarnings,
      slideIndexByPath
    );
    activeTheme = parsed.theme;
    warnings.push(...slideWarnings);
    slides.push({
      ...parsed.slide,
      index: slides.length
    });
  }

  return {
    size,
    theme: activeTheme,
    slides,
    media: caches.media,
    warnings
  };
}

async function parseContentTypes(zip: JSZip): Promise<ContentTypes> {
  const xml = await parseXmlFile(zip, '[Content_Types].xml');
  const root = xml?.Types as XmlRecord | undefined;
  const overrides: Record<string, string> = {};
  const defaults: Record<string, string> = {};

  for (const override of asArray(root?.Override)) {
    overrides[String(override.PartName ?? '').replace(/^\//, '')] = String(override.ContentType ?? '');
  }

  for (const entry of asArray(root?.Default)) {
    defaults[String(entry.Extension ?? '')] = String(entry.ContentType ?? '');
  }

  return { overrides, defaults };
}

async function parseRelationships(zip: JSZip, relPath: string): Promise<Record<string, RelationshipEntry>> {
  const xml = await parseXmlFile(zip, relPath);
  const root = xml?.Relationships as XmlRecord | undefined;
  const entries = asArray(root?.Relationship);
  const relationships: Record<string, RelationshipEntry> = {};
  const sourcePartPath = relationshipSourcePath(relPath);

  for (const entry of entries) {
    const targetMode = entry.TargetMode ? String(entry.TargetMode) : undefined;
    const rawTarget = String(entry.Target ?? '');
    relationships[String(entry.Id)] = {
      id: String(entry.Id),
      type: String(entry.Type),
      target: isExternalTarget(rawTarget, targetMode) ? rawTarget : resolvePartPath(sourcePartPath, rawTarget),
      targetMode
    };
  }

  return relationships;
}

async function parseTheme(zip: JSZip, themePath: string, caches: ParseCaches): Promise<ThemeBundle> {
  const existing = caches.themes.get(themePath);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const xml = await parseXmlFile(zip, themePath);
    const orderedXml = await parseXmlFileOrdered(zip, themePath);
    const node = xml?.['a:theme'] as XmlRecord | undefined;
    if (!node) {
      return {
        theme: DEFAULT_THEME,
        formatScheme: createEmptyThemeFormatScheme()
      };
    }

    const themeElements = node['a:themeElements'] as XmlRecord | undefined;
    const orderedTheme = orderedXml ? getOrderedChild(orderedXml, 'a:theme') : undefined;
    const orderedThemeElements = orderedTheme ? getOrderedChild(orderedTheme, 'a:themeElements') : undefined;
    const scheme = themeElements?.['a:clrScheme'] as XmlRecord | undefined;
    const fontScheme = themeElements?.['a:fontScheme'] as XmlRecord | undefined;
    const formatScheme = parseThemeFormatScheme(
      themeElements?.['a:fmtScheme'] as XmlRecord | undefined,
      orderedThemeElements ? getOrderedChild(orderedThemeElements, 'a:fmtScheme') : undefined
    );
    const colors = { ...DEFAULT_THEME.colors };

    if (scheme) {
      for (const key of Object.keys(colors)) {
        const entry = scheme[`a:${key}`] as XmlRecord | undefined;
        if (!entry) {
          continue;
        }

        const srgb = entry['a:srgbClr'] as XmlRecord | undefined;
        const sys = entry['a:sysClr'] as XmlRecord | undefined;
        if (srgb?.val) {
          colors[key] = `#${String(srgb.val)}`.toUpperCase();
        } else if (sys?.lastClr) {
          colors[key] = `#${String(sys.lastClr)}`.toUpperCase();
        }
      }
    }

    return {
      theme: {
        name: typeof node.name === 'string' ? node.name : DEFAULT_THEME.name,
        colors,
        fonts: {
          major: fontScheme?.['a:majorFont']?.['a:latin']?.typeface
            ? String(fontScheme['a:majorFont']['a:latin'].typeface)
            : DEFAULT_THEME.fonts.major,
          minor: fontScheme?.['a:minorFont']?.['a:latin']?.typeface
            ? String(fontScheme['a:minorFont']['a:latin'].typeface)
            : DEFAULT_THEME.fonts.minor,
          majorScripts: parseThemeScriptFonts(fontScheme?.['a:majorFont'] as XmlRecord | undefined),
          minorScripts: parseThemeScriptFonts(fontScheme?.['a:minorFont'] as XmlRecord | undefined)
        }
      },
      formatScheme
    };
  })();

  caches.themes.set(themePath, promise);
  return promise;
}

async function parseTableStyles(zip: JSZip, caches: ParseCaches): Promise<TableStyleRegistry> {
  if (caches.tableStyles) {
    return caches.tableStyles;
  }

  const promise = (async () => {
    const xml = await parseXmlFile(zip, 'ppt/tableStyles.xml');
    const root = xml?.['a:tblStyleLst'] as XmlRecord | undefined;
    if (!root) {
      return {
        styles: {}
      };
    }

    const styles: TableStyleRegistry['styles'] = {};
    for (const styleNode of asArray(root['a:tblStyle'])) {
      const styleId = typeof styleNode?.styleId === 'string' ? String(styleNode.styleId) : '';
      if (!styleId) {
        continue;
      }

      styles[styleId] = {
        styleId,
        wholeTbl: asXmlRecordNode(styleNode['a:wholeTbl']),
        band1H: asXmlRecordNode(styleNode['a:band1H']),
        band2H: asXmlRecordNode(styleNode['a:band2H']),
        band1V: asXmlRecordNode(styleNode['a:band1V']),
        band2V: asXmlRecordNode(styleNode['a:band2V']),
        firstRow: asXmlRecordNode(styleNode['a:firstRow']),
        lastRow: asXmlRecordNode(styleNode['a:lastRow']),
        firstCol: asXmlRecordNode(styleNode['a:firstCol']),
        lastCol: asXmlRecordNode(styleNode['a:lastCol']),
        nwCell: asXmlRecordNode(styleNode['a:nwCell']),
        neCell: asXmlRecordNode(styleNode['a:neCell']),
        swCell: asXmlRecordNode(styleNode['a:swCell']),
        seCell: asXmlRecordNode(styleNode['a:seCell'])
      };
    }

    return {
      defaultStyleId: typeof root.def === 'string' ? String(root.def) : undefined,
      styles
    };
  })();

  caches.tableStyles = promise;
  return promise;
}

function parseThemeScriptFonts(node: XmlRecord | undefined): Record<string, string> {
  if (!node) {
    return {};
  }

  const scripts: Record<string, string> = {};
  for (const entry of asArray(node['a:font'])) {
    const script = typeof entry?.script === 'string' ? String(entry.script).trim() : '';
    const typeface = typeof entry?.typeface === 'string' ? String(entry.typeface).trim() : '';
    if (!script || !typeface) {
      continue;
    }
    scripts[script] = typeface;
  }

  return scripts;
}

async function parseMaster(zip: JSZip, masterPath: string, contentTypes: ContentTypes, caches: ParseCaches): Promise<MasterBundle> {
  const existing = caches.masters.get(masterPath);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const xml = await parseXmlFile(zip, masterPath);
    const orderedXml = await parseXmlFileOrdered(zip, masterPath);
    const relsPath = toRelationshipPath(masterPath);
    const relationships = await parseRelationships(zip, relsPath);
    const tableStyles = await parseTableStyles(zip, caches);
    const node = xml?.['p:sldMaster'] as XmlRecord | undefined;
    if (!node) {
      return {
        fixedItems: [],
        placeholders: new Map(),
        background: { type: 'solid' as const, color: DEFAULT_THEME.colors.lt1 },
        theme: DEFAULT_THEME,
        themeFormatScheme: createEmptyThemeFormatScheme(),
        textStyles: createTextStyleRegistry(),
        colorMap: { ...DEFAULT_CLR_MAP }
      };
    }

    const themeRel = Object.values(relationships).find((entry) => entry.type === REL_TYPES.theme);
    const themeBundle = themeRel
      ? await parseTheme(zip, themeRel.target, caches)
      : {
          theme: DEFAULT_THEME,
          formatScheme: createEmptyThemeFormatScheme()
        };
    const theme = themeBundle.theme;
    const themeFormatScheme = themeBundle.formatScheme;
    const colorMap = {
      ...DEFAULT_CLR_MAP,
      ...(node['p:clrMap'] ? node['p:clrMap'] : {})
    };
    const warnings: string[] = [];
    const baseContext: ParseContext = {
      theme,
      themeFormatScheme,
      tableStyles,
      textStyles: createTextStyleRegistry(),
      colorMap,
      relationships,
      slideIndexByPath: {},
      contentTypes,
      slidePath: masterPath,
      warnings,
      group: ROOT_GROUP,
      orderedTextFrames: buildOrderedTextFrameMap(orderedXml),
      orderedShapeNodes: buildOrderedShapeNodeMap(orderedXml),
      orderedNodeOrders: buildOrderedNodeOrderMap(orderedXml),
      diagramDataModels: {},
      diagramDrawings: {},
      chartSpaces: {},
      caches,
      zip
    };
    const presentationDefaultTextStyle = parseListStyleDefaults(caches.presentationDefaultTextStyle, baseContext);
    const textStyles = parseTextStyleRegistry(
      node['p:txStyles'] as XmlRecord | undefined,
      baseContext,
      createTextStyleRegistry(presentationDefaultTextStyle)
    );
    const context: ParseContext = {
      ...baseContext,
      textStyles
    };

    const background = parseBackground(node['p:cSld'], theme, colorMap, themeFormatScheme, context) ?? {
      type: 'solid',
      color: theme.colors.lt1
    };
    const itemDrafts = parseSpTree(node['p:cSld']?.['p:spTree'], context);
    const placeholders = new Map<string, SlideItemDraft>();
    const fixedItems: SlideItemDraft[] = [];

    for (const draft of itemDrafts) {
      if (draft.placeholderKey) {
        placeholders.set(draft.placeholderKey, draft);
      } else {
        fixedItems.push(draft);
      }
    }

    return {
      fixedItems,
      placeholders,
      background,
      theme,
      themeFormatScheme,
      textStyles,
      colorMap
    };
  })();

  caches.masters.set(masterPath, promise);
  return promise;
}

async function parseLayout(zip: JSZip, layoutPath: string, contentTypes: ContentTypes, caches: ParseCaches): Promise<LayoutBundle> {
  const existing = caches.layouts.get(layoutPath);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const xml = await parseXmlFile(zip, layoutPath);
    const orderedXml = await parseXmlFileOrdered(zip, layoutPath);
    const relsPath = toRelationshipPath(layoutPath);
    const relationships = await parseRelationships(zip, relsPath);
    const tableStyles = await parseTableStyles(zip, caches);
    const node = xml?.['p:sldLayout'] as XmlRecord | undefined;
    const masterRel = Object.values(relationships).find((entry) => entry.type === REL_TYPES.slideMaster);
    const master = masterRel ? await parseMaster(zip, masterRel.target, contentTypes, caches) : null;
    const theme = master?.theme ?? DEFAULT_THEME;
    const themeFormatScheme = master?.themeFormatScheme ?? createEmptyThemeFormatScheme();
    const colorMap = master?.colorMap ?? { ...DEFAULT_CLR_MAP };

    if (!node) {
      return {
        fixedItems: master?.fixedItems ?? [],
        placeholders: master?.placeholders ?? new Map(),
        background: master?.background ?? { type: 'solid' as const, color: theme.colors.lt1 },
        theme,
        themeFormatScheme,
        textStyles: master?.textStyles ?? createTextStyleRegistry(),
        colorMap
      };
    }

    const warnings: string[] = [];
    const context: ParseContext = {
      theme,
      themeFormatScheme,
      tableStyles,
      textStyles: master?.textStyles ?? createTextStyleRegistry(),
      placeholderSources: master?.placeholders,
      colorMap,
      relationships,
      slideIndexByPath: {},
      contentTypes,
      slidePath: layoutPath,
      warnings,
      group: ROOT_GROUP,
      orderedTextFrames: buildOrderedTextFrameMap(orderedXml),
      orderedShapeNodes: buildOrderedShapeNodeMap(orderedXml),
      orderedNodeOrders: buildOrderedNodeOrderMap(orderedXml),
      diagramDataModels: {},
      diagramDrawings: {},
      chartSpaces: {},
      caches,
      zip
    };

    const background = parseBackground(node['p:cSld'], theme, colorMap, themeFormatScheme, context) ?? master?.background ?? {
      type: 'solid',
      color: theme.colors.lt1
    };
    const layoutDrafts = parseSpTree(node['p:cSld']?.['p:spTree'], context);
    const placeholderMap = new Map<string, SlideItemDraft>();
    const fixedItems = [...(master?.fixedItems ?? [])];

    for (const draft of layoutDrafts) {
      if (draft.placeholderKey) {
        const merged = mergeDraft(resolvePlaceholderDraft(master?.placeholders, draft.item.placeholder), draft);
        placeholderMap.set(draft.placeholderKey, merged);
      } else {
        fixedItems.push(draft);
      }
    }

    if (master) {
      for (const [key, value] of master.placeholders.entries()) {
        if (!placeholderMap.has(key)) {
          placeholderMap.set(key, value);
        }
      }
    }

    return {
      fixedItems,
      placeholders: placeholderMap,
      background,
      theme,
      themeFormatScheme,
      textStyles: master?.textStyles ?? createTextStyleRegistry(),
      colorMap
    };
  })();

  caches.layouts.set(layoutPath, promise);
  return promise;
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  size: { width: number; height: number },
  contentTypes: ContentTypes,
  caches: ParseCaches,
  warnings: string[],
  slideIndexByPath: Record<string, number>
): Promise<{ slide: SlideModel; theme: ThemeModel }> {
  const xml = await parseXmlFile(zip, slidePath);
  const orderedXml = await parseXmlFileOrdered(zip, slidePath);
  const relsPath = toRelationshipPath(slidePath);
  const relationships = await parseRelationships(zip, relsPath);
  const node = xml?.['p:sld'] as XmlRecord | undefined;
  if (!node) {
    return {
      slide: {
        id: createId('slide'),
        index: 0,
        title: 'Untitled slide',
        background: { type: 'solid', color: DEFAULT_THEME.colors.lt1 },
        width: size.width,
        height: size.height,
        items: [],
        warnings: [...warnings]
      },
      theme: DEFAULT_THEME
    };
  }

  const layoutRel = Object.values(relationships).find((entry) => entry.type === REL_TYPES.slideLayout);
  const layout = layoutRel ? await parseLayout(zip, layoutRel.target, contentTypes, caches) : null;
  const tableStyles = await parseTableStyles(zip, caches);
  const theme = layout?.theme ?? DEFAULT_THEME;
  const themeFormatScheme = layout?.themeFormatScheme ?? createEmptyThemeFormatScheme();
  const colorMap = layout?.colorMap ?? { ...DEFAULT_CLR_MAP };
  const diagramParts = await preloadDiagramParts(zip, relationships);
  const chartSpaces = await preloadChartParts(zip, relationships);
  const slideWarnings = warnings;
  const context: ParseContext = {
    theme,
    themeFormatScheme,
    tableStyles,
    textStyles: layout?.textStyles ?? createTextStyleRegistry(),
    placeholderSources: layout?.placeholders,
    colorMap,
    relationships,
    slideIndexByPath,
    contentTypes,
    slidePath,
    warnings: slideWarnings,
    group: ROOT_GROUP,
    orderedTextFrames: buildOrderedTextFrameMap(orderedXml),
    orderedShapeNodes: buildOrderedShapeNodeMap(orderedXml),
    orderedNodeOrders: buildOrderedNodeOrderMap(orderedXml),
    diagramDataModels: diagramParts.dataModels,
    diagramDrawings: diagramParts.drawings,
    chartSpaces,
    caches,
    zip
  };

  const background = parseBackground(node['p:cSld'], theme, colorMap, themeFormatScheme, context) ?? layout?.background ?? {
    type: 'solid',
    color: theme.colors.lt1
  };
  const slideDrafts = parseSpTree(node['p:cSld']?.['p:spTree'], context);
  const items: SlideItem[] = [];
  const usedPlaceholders = new Set<string>();
  const runtimeSlideIndex = slideIndexByPath[slidePath] ?? 0;

  for (const fixedItem of layout?.fixedItems ?? []) {
    items.push(deepClone(fixedItem.item));
  }

  for (const draft of slideDrafts) {
    const merged = draft.placeholderKey ? mergeDraft(resolvePlaceholderDraft(layout?.placeholders, draft.item.placeholder), draft) : draft;
    if (draft.placeholderKey) {
      usedPlaceholders.add(draft.placeholderKey);
    }

    items.push(merged.item);
  }

  for (const [key, placeholder] of layout?.placeholders.entries() ?? []) {
    if (usedPlaceholders.has(key)) {
      continue;
    }

    if (
      hasRenderableText(placeholder.item) &&
      !isPlaceholderPromptItem(placeholder.item) &&
      !isGenericTemplatePlaceholderPromptItem(placeholder.item) &&
      !isMasterStylePlaceholderPromptItem(placeholder.item) &&
      !isMetadataPlaceholderItem(placeholder.item)
    ) {
      items.push(deepClone(placeholder.item));
    }
  }

  const visibleItems = items.filter((item) => !isHiddenFooterPlaceholderItem(item));
  resolveRuntimePlaceholderFields(visibleItems, runtimeSlideIndex);
  applyThemeScriptFontFallbacksToItems(visibleItems, theme);

  const mediaIds = new Set<string>();
  collectPictureFillMediaIds(background, mediaIds);
  for (const item of visibleItems) {
    collectItemMediaIds(item, mediaIds);
  }

  for (const mediaId of mediaIds) {
    await loadMediaAsset(zip, mediaId, contentTypes, caches);
  }

  const title =
    extractItemText(visibleItems.find((item) => item.placeholder?.type === 'title' && hasRenderableText(item))) ??
    extractFirstText(visibleItems) ??
    'Untitled slide';

  return {
    slide: {
      id: createId('slide'),
      index: 0,
      title,
      background,
      width: size.width,
      height: size.height,
      items: visibleItems,
      warnings: [...slideWarnings]
    },
    theme
  };
}

function parseSpTree(treeNode: XmlRecord | undefined, context: ParseContext, applyRootTransform = true): SlideItemDraft[] {
  if (!treeNode) {
    return [];
  }

  const transformedGroup =
    applyRootTransform && treeNode['p:grpSpPr']?.['a:xfrm'] !== undefined
      ? composeGroupContext(treeNode['p:grpSpPr']?.['a:xfrm'], context.group, undefined, false)
      : context.group;
  const scopedContext =
    transformedGroup !== context.group
      ? {
          ...context,
          group: {
            ...transformedGroup,
            fill: resolveGroupFill(treeNode['p:grpSpPr'] as XmlRecord | undefined, context)
          }
        }
      : context;

  const entries: Array<{ type: string; node: XmlRecord; order: number }> = [];
  const pushEntries = (type: string) => {
    for (const node of asArray(treeNode[type])) {
      entries.push({
        type,
        node,
        order: getNodeOrder(node, scopedContext.orderedNodeOrders)
      });
    }
  };

  pushEntries('p:sp');
  pushEntries('p:pic');
  pushEntries('p:graphicFrame');
  pushEntries('p:cxnSp');
  pushEntries('p:grpSp');

  entries.sort((left, right) => left.order - right.order);

  const items: SlideItemDraft[] = [];
  for (const entry of entries) {
    switch (entry.type) {
      case 'p:sp':
        items.push(parseShapeDraft(entry.node, scopedContext));
        break;
      case 'p:pic':
        items.push(parseImageDraft(entry.node, scopedContext));
        break;
      case 'p:graphicFrame':
        items.push(...parseGraphicFrameDrafts(entry.node, scopedContext));
        break;
      case 'p:cxnSp':
        items.push(parseConnectorDraft(entry.node, scopedContext));
        break;
      case 'p:grpSp':
        items.push(...parseGroupDrafts(entry.node, scopedContext));
        break;
      default:
        break;
    }
  }

  return items;
}

function buildOrderedTextFrameMap(root: OrderedXmlNode | null): Map<string, OrderedXmlNode> {
  const map = new Map<string, OrderedXmlNode>();
  if (!root) {
    return map;
  }

  collectOrderedTextFrames(root, map);
  return map;
}

function buildOrderedShapeNodeMap(root: OrderedXmlNode | null): Map<string, OrderedXmlNode> {
  const map = new Map<string, OrderedXmlNode>();
  if (!root) {
    return map;
  }

  collectOrderedShapeNodes(root, map);
  return map;
}

function buildOrderedNodeOrderMap(root: OrderedXmlNode | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!root) {
    return map;
  }

  const state = {
    nextOrder: 0
  };
  collectOrderedNodeOrders(root, map, state);
  return map;
}

function collectOrderedTextFrames(nodes: OrderedXmlNode, map: Map<string, OrderedXmlNode>): void {
  for (const entry of nodes) {
    for (const [tag, value] of Object.entries(entry)) {
      if (tag === ':@' || tag === '#text' || !Array.isArray(value)) {
        continue;
      }

      const children = value as OrderedXmlNode;
      if (tag === 'p:sp') {
        const nodeId = getOrderedShapeNodeId(children);
        const textFrame = getOrderedChild(children, 'p:txBody');
        if (nodeId && textFrame) {
          map.set(nodeId, textFrame);
        }
      }

      collectOrderedTextFrames(children, map);
    }
  }
}

function collectOrderedShapeNodes(nodes: OrderedXmlNode, map: Map<string, OrderedXmlNode>): void {
  for (const entry of nodes) {
    for (const [tag, value] of Object.entries(entry)) {
      if (tag === ':@' || tag === '#text' || !Array.isArray(value)) {
        continue;
      }

      const children = value as OrderedXmlNode;
      if (tag === 'p:sp') {
        const nodeId = getOrderedShapeNodeId(children);
        if (nodeId) {
          map.set(nodeId, children);
        }
      }

      collectOrderedShapeNodes(children, map);
    }
  }
}

function collectOrderedNodeOrders(
  nodes: OrderedXmlNode,
  map: Map<string, number>,
  state: { nextOrder: number }
): void {
  for (const entry of nodes) {
    for (const [tag, value] of Object.entries(entry)) {
      if (tag === ':@' || tag === '#text' || !Array.isArray(value)) {
        continue;
      }

      const children = value as OrderedXmlNode;
      const nodeId = getOrderedDrawingNodeId(tag, children);
      if (nodeId) {
        map.set(nodeId, state.nextOrder);
        state.nextOrder += 1;
      }

      collectOrderedNodeOrders(children, map, state);
    }
  }
}

function getOrderedShapeNodeId(nodes: OrderedXmlNode): string | undefined {
  const nonVisual = getOrderedChild(nodes, 'p:nvSpPr');
  const propsEntry = nonVisual ? findOrderedEntry(nonVisual, 'p:cNvPr') : undefined;
  const attributes = getOrderedEntryAttributes(propsEntry);
  return attributes?.id != null ? String(attributes.id) : undefined;
}

function getOrderedDrawingNodeId(tag: string, nodes: OrderedXmlNode): string | undefined {
  switch (tag) {
    case 'p:sp':
      return getOrderedShapeNodeId(nodes);
    case 'p:pic':
      return getOrderedNodeIdByNvTag(nodes, 'p:nvPicPr');
    case 'p:graphicFrame':
      return getOrderedNodeIdByNvTag(nodes, 'p:nvGraphicFramePr');
    case 'p:cxnSp':
      return getOrderedNodeIdByNvTag(nodes, 'p:nvCxnSpPr');
    case 'p:grpSp':
      return getOrderedNodeIdByNvTag(nodes, 'p:nvGrpSpPr');
    default:
      return undefined;
  }
}

function getOrderedNodeIdByNvTag(nodes: OrderedXmlNode, nvTag: string): string | undefined {
  const nonVisual = getOrderedChild(nodes, nvTag);
  const propsEntry = nonVisual ? findOrderedEntry(nonVisual, 'p:cNvPr') : undefined;
  const attributes = getOrderedEntryAttributes(propsEntry);
  return attributes?.id != null ? String(attributes.id) : undefined;
}

function getOrderedChild(nodes: OrderedXmlNode, tag: string): OrderedXmlNode | undefined {
  const entry = findOrderedEntry(nodes, tag);
  if (!entry) {
    return undefined;
  }

  const value = entry[tag];
  return Array.isArray(value) ? (value as OrderedXmlNode) : undefined;
}

function getOrderedChildren(nodes: OrderedXmlNode, tag: string): OrderedXmlNode[] {
  const matches: OrderedXmlNode[] = [];
  for (const entry of nodes) {
    const value = entry[tag];
    if (Array.isArray(value)) {
      matches.push(value as OrderedXmlNode);
    }
  }
  return matches;
}

function findOrderedEntry(nodes: OrderedXmlNode, tag: string): OrderedXmlEntry | undefined {
  return nodes.find((entry) => Object.prototype.hasOwnProperty.call(entry, tag));
}

function getOrderedEntryAttributes(entry: OrderedXmlEntry | undefined): XmlRecord | undefined {
  return asXmlRecordNode(entry?.[':@']);
}

function parseGroupDrafts(node: XmlRecord, context: ParseContext): SlideItemDraft[] {
  const groupName = getName(node, ['p:nvGrpSpPr', 'p:cNvPr']);
  const childGroup = createChildGroupContext(node['p:grpSpPr']?.['a:xfrm'], context.group, groupName || createId('group'));
  const nextContext: ParseContext = {
    ...context,
    group: {
      ...childGroup,
      fill: resolveGroupFill(node['p:grpSpPr'] as XmlRecord | undefined, context)
    }
  };
  return parseSpTree(node, nextContext, false);
}

function parseShapeDraft(node: XmlRecord, context: ParseContext): SlideItemDraft {
  const placeholder = extractPlaceholder(node['p:nvSpPr']?.['p:nvPr']);
  const nodeId = getShapeNodeId(node);
  const orderedShapeNode = nodeId ? context.orderedShapeNodes.get(nodeId) : undefined;
  const orderedShapeProps = orderedShapeNode ? getOrderedChild(orderedShapeNode, 'p:spPr') : undefined;
  const textLanguage = inferTextBodyLanguage(node['p:txBody'] as XmlRecord | undefined);
  const transformInfo = parseTransform(node['p:spPr']?.['a:xfrm'], context.group);
  const shadowInfo = parseShadowInfo(node['p:spPr'], context.theme, context.colorMap);
  const fillInfo = parseFillInfo(
    node['p:spPr'],
    context.theme,
    context.colorMap,
    undefined,
    createFillParseContext(context)
  );
  const lineInfo = parseLineInfo(node['p:spPr']?.['a:ln'], context.theme, context.colorMap);
  const styleLineInfo = resolveStyleLine(
    node['p:style'] as XmlRecord | undefined,
    context.theme,
    context.colorMap,
    context.themeFormatScheme
  );
  const styleFillInfo = shouldResolveStyleFill(fillInfo)
    ? resolveStyleFill(node['p:style'] as XmlRecord | undefined, context.theme, context.colorMap, context.themeFormatScheme)
    : undefined;
  const styleShadowInfo = !shadowInfo
    ? resolveStyleEffect(node['p:style'] as XmlRecord | undefined, context.theme, context.colorMap, context.themeFormatScheme)
    : undefined;
  const styleTextRunDefaults = resolveStyleFont(
    node['p:style'] as XmlRecord | undefined,
    context.theme,
    context.colorMap,
    textLanguage
  );
  const isTextBox = node['p:nvSpPr']?.['p:cNvSpPr']?.txBox === '1';
  const inheritedPlaceholder = resolvePlaceholderDraft(context.placeholderSources, placeholder);
  const inheritedTextStyle = inheritedPlaceholder
    ? undefined
    : resolveTextStyleDefaults(context.textStyles, placeholder, isTextBox);
  const isTitlePlaceholder = placeholder?.type === 'title' || placeholder?.type === 'ctrTitle';
  const allowImplicitDefaultFont =
    !inheritedPlaceholder ||
    (!isTitlePlaceholder && !placeholderHasMeaningfulFontDefaults(inheritedPlaceholder, context.theme));
  const textFrame = parseTextFrame(
    node['p:txBody'],
    context,
    nodeId ? context.orderedTextFrames.get(nodeId) : undefined,
    styleTextRunDefaults,
    undefined,
    inheritedTextStyle,
    placeholder != null,
    allowImplicitDefaultFont
  );
  const hyperlink = parseHyperlink(node['p:nvSpPr']?.['p:cNvPr']?.['a:hlinkClick'] as XmlRecord | undefined, context);
  const presetGeometry = node['p:spPr']?.['a:prstGeom'] as XmlRecord | undefined;
  const customGeometry = parseCustomShapeGeometry(
    node['p:spPr']?.['a:custGeom'] as XmlRecord | undefined,
    orderedShapeProps ? getOrderedChild(orderedShapeProps, 'a:custGeom') : undefined
  );
  const geometry = parsePresetShapeGeometry(presetGeometry, context) ?? customGeometry;
  const hasCustomGeometry = geometry?.type === 'custom';
  const rawShapeType = typeof presetGeometry?.prst === 'string' ? presetGeometry.prst : hasCustomGeometry ? 'customGeom' : 'rect';
  const shapeType = hasCustomGeometry ? 'unknown' : normalizeShapeType(rawShapeType);
  const explicitTextBounds = parseExplicitTextBounds(
    asXmlRecordNode(node['p:spPr']?.['a:xfrm']),
    asXmlRecordNode(node['p:txXfrm']),
    context.group
  );
  const order = getNodeOrder(node, context.orderedNodeOrders);
  const name = getName(node, ['p:nvSpPr', 'p:cNvPr']) ?? rawShapeType;
  const base = {
    id: createId('shape'),
    name,
    transform: transformInfo.transform,
    fill: resolveAppliedFill(fillInfo, styleFillInfo),
    line: mergeResolvedLineStyles(lineInfo.line, styleLineInfo?.line, lineInfo.hasLine),
    shadow: styleShadowInfo ?? shadowInfo,
    placeholder,
    order,
    groupPath: [...context.group.groupPath],
    ...hyperlink
  };

  const item: TextItem | ShapeItem | UnsupportedItem = isTextBox
      ? {
          ...base,
          kind: 'text',
          textFrame: textFrame.frame ?? emptyTextFrame(context.theme, styleTextRunDefaults, textLanguage)
        }
    : shapeType === 'unknown' && !hasCustomGeometry
      ? {
          ...base,
          kind: 'unsupported',
          unsupportedType: rawShapeType,
          label: 'Unsupported shape'
        }
      : {
          ...base,
          kind: 'shape',
          shapeType,
          geometry,
          textBounds: explicitTextBounds,
          textFrame: textFrame.frame
        };

  if (!isTextBox && shapeType === 'unknown' && !hasCustomGeometry) {
    context.warnings.push(`Unsupported shape ${name} (${rawShapeType}).`);
  }

  return {
    item,
    placeholderKey: placeholder ? getPlaceholderKey(placeholder) : undefined,
    hasTransform: transformInfo.hasTransform,
    hasText: textFrame.hasText,
    hasFill: fillInfo.hasFill || styleFillInfo?.hasFill === true,
    hasLine: lineInfo.hasLine || styleLineInfo?.hasLine === true,
    textFrameStyleFlags: textFrame.styleFlags
  };
}

function parsePresetShapeGeometry(
  node: XmlRecord | undefined,
  context: Pick<ParseContext, 'warnings'>
): ShapeItem['geometry'] | undefined {
  if (!node || typeof node.prst !== 'string') {
    return undefined;
  }

  const adjustments = parseGeometryAdjustments(node['a:avLst'], context);
  return {
    type: 'preset',
    preset: String(node.prst),
    adjustments
  };
}

function parseCustomShapeGeometry(
  node: XmlRecord | undefined,
  orderedNode?: OrderedXmlNode
): ShapeItem['geometry'] | undefined {
  if (!node && !orderedNode) {
    return undefined;
  }

  const orderedPathList = orderedNode ? getOrderedChild(orderedNode, 'a:pathLst') : undefined;
  const orderedPaths = orderedPathList ? getOrderedChildren(orderedPathList, 'a:path') : [];
  const pathNodes = asArray(node?.['a:pathLst']?.['a:path']);
  const pathCount = Math.max(pathNodes.length, orderedPaths.length);
  const paths = Array.from({ length: pathCount }, (_, index) =>
    parseCustomShapePath(pathNodes[index] as XmlRecord | undefined, orderedPaths[index])
  )
    .filter((path): path is NonNullable<Extract<ShapeItem['geometry'], { type: 'custom' }>>['paths'][number] => Boolean(path));

  if (!paths.length) {
    return undefined;
  }

  return {
    type: 'custom',
    paths
  };
}

function parseCustomShapePath(
  node: XmlRecord | undefined,
  orderedNode?: OrderedXmlNode
): NonNullable<Extract<ShapeItem['geometry'], { type: 'custom' }>>['paths'][number] | undefined {
  if (!node && !orderedNode) {
    return undefined;
  }

  const commands: NonNullable<Extract<ShapeItem['geometry'], { type: 'custom' }>>['paths'][number]['commands'] = [];

  if (orderedNode) {
    for (const entry of orderedNode) {
      for (const [tag, value] of Object.entries(entry)) {
        if (tag === ':@' || tag === '#text' || !Array.isArray(value)) {
          continue;
        }

        const children = value as OrderedXmlNode;
        switch (tag) {
          case 'a:moveTo': {
            const point = parseOrderedCustomShapePoints(children)[0];
            if (point) {
              commands.push({
                type: 'M',
                ...point
              });
            }
            break;
          }
          case 'a:lnTo': {
            const point = parseOrderedCustomShapePoints(children)[0];
            if (point) {
              commands.push({
                type: 'L',
                ...point
              });
            }
            break;
          }
          case 'a:quadBezTo': {
            const points = parseOrderedCustomShapePoints(children);
            if (points.length >= 2) {
              commands.push({
                type: 'Q',
                x1: points[0].x,
                y1: points[0].y,
                x: points[1].x,
                y: points[1].y
              });
            }
            break;
          }
          case 'a:cubicBezTo': {
            const points = parseOrderedCustomShapePoints(children);
            if (points.length >= 3) {
              commands.push({
                type: 'C',
                x1: points[0].x,
                y1: points[0].y,
                x2: points[1].x,
                y2: points[1].y,
                x: points[2].x,
                y: points[2].y
              });
            }
            break;
          }
          case 'a:close':
            commands.push({
              type: 'Z'
            });
            break;
          default:
            break;
        }
      }
    }
  } else {
    for (const moveNode of asArray(node?.['a:moveTo'])) {
      const point = parseCustomShapePoint((moveNode as XmlRecord)?.['a:pt'] as XmlRecord | undefined);
      if (point) {
        commands.push({
          type: 'M',
          ...point
        });
      }
    }

    for (const lineNode of asArray(node?.['a:lnTo'])) {
      const point = parseCustomShapePoint((lineNode as XmlRecord)?.['a:pt'] as XmlRecord | undefined);
      if (point) {
        commands.push({
          type: 'L',
          ...point
        });
      }
    }

    for (const quadNode of asArray(node?.['a:quadBezTo'])) {
      const points = asArray((quadNode as XmlRecord)?.['a:pt'])
        .map((pointNode) => parseCustomShapePoint(pointNode as XmlRecord | undefined))
        .filter((point): point is { x: number; y: number } => Boolean(point));
      if (points.length >= 2) {
        commands.push({
          type: 'Q',
          x1: points[0].x,
          y1: points[0].y,
          x: points[1].x,
          y: points[1].y
        });
      }
    }

    for (const cubicNode of asArray(node?.['a:cubicBezTo'])) {
      const points = asArray((cubicNode as XmlRecord)?.['a:pt'])
        .map((pointNode) => parseCustomShapePoint(pointNode as XmlRecord | undefined))
        .filter((point): point is { x: number; y: number } => Boolean(point));
      if (points.length >= 3) {
        commands.push({
          type: 'C',
          x1: points[0].x,
          y1: points[0].y,
          x2: points[1].x,
          y2: points[1].y,
          x: points[2].x,
          y: points[2].y
        });
      }
    }

    if (node?.['a:close'] != null) {
      commands.push({
        type: 'Z'
      });
    }
  }

  if (!commands.length) {
    return undefined;
  }

  return {
    width: Math.max(toNumber(node?.w, 0), 1),
    height: Math.max(toNumber(node?.h, 0), 1),
    fill: node?.fill === 'none' ? 'none' : 'norm',
    stroke:
      node?.stroke === '0' || node?.stroke === 'false' || node?.stroke === 'none'
        ? 'none'
        : 'norm',
    commands
  };
}

function parseOrderedCustomShapePoints(nodes: OrderedXmlNode): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const entry of nodes) {
    if (!Object.prototype.hasOwnProperty.call(entry, 'a:pt')) {
      continue;
    }

    const attributes = getOrderedEntryAttributes(entry);
    if (!attributes) {
      continue;
    }

    points.push({
      x: toNumber(attributes.x, 0),
      y: toNumber(attributes.y, 0)
    });
  }

  return points;
}

function parseCustomShapePoint(node: XmlRecord | undefined): { x: number; y: number } | undefined {
  if (!node) {
    return undefined;
  }

  return {
    x: toNumber(node.x, 0),
    y: toNumber(node.y, 0)
  };
}

function parseExplicitTextBounds(
  shapeXfrmNode: XmlRecord | undefined,
  textXfrmNode: XmlRecord | undefined,
  group: GroupContext
): InsetBox | undefined {
  if (!shapeXfrmNode || !textXfrmNode) {
    return undefined;
  }

  const shapeTransform = parseTransform(shapeXfrmNode, group).transform;
  const textTransform = parseTransform(textXfrmNode, group).transform;
  if (shapeTransform.width <= 0 || shapeTransform.height <= 0 || textTransform.width <= 0 || textTransform.height <= 0) {
    return undefined;
  }

  const left = textTransform.x - shapeTransform.x;
  const top = textTransform.y - shapeTransform.y;
  const right = shapeTransform.width - left - textTransform.width;
  const bottom = shapeTransform.height - top - textTransform.height;

  if (![left, top, right, bottom].every(Number.isFinite)) {
    return undefined;
  }

  const maxHorizontalOverflow = shapeTransform.width * 0.5;
  const maxVerticalOverflow = shapeTransform.height * 0.5;
  if (
    left < -maxHorizontalOverflow ||
    right < -maxHorizontalOverflow ||
    top < -maxVerticalOverflow ||
    bottom < -maxVerticalOverflow
  ) {
    return undefined;
  }

  return {
    left: Number(Math.max(left, 0).toFixed(3)),
    top: Number(Math.max(top, 0).toFixed(3)),
    right: Number(Math.max(right, 0).toFixed(3)),
    bottom: Number(Math.max(bottom, 0).toFixed(3))
  };
}

function parseGeometryAdjustments(
  node: XmlRecord | undefined,
  context: Pick<ParseContext, 'warnings'>
): Record<string, number> {
  if (!node) {
    return {};
  }

  const formulas = new Map<string, string>();
  for (const entry of asArray(node['a:gd'])) {
    const name = typeof entry?.name === 'string' ? entry.name : undefined;
    const formula = typeof entry?.fmla === 'string' ? entry.fmla.trim() : '';
    if (!name || !formula) {
      continue;
    }

    formulas.set(name, formula);
  }

  const adjustments: Record<string, number> = {};
  const cache = new Map<string, number>();
  const resolving = new Set<string>();
  const warned = new Set<string>();

  const warnFormula = (name: string, formula: string): void => {
    const key = `${name}:${formula}`;
    if (warned.has(key)) {
      return;
    }

    warned.add(key);
    context.warnings.push(`Unsupported geometry adjustment formula: ${formula}.`);
  };

  const resolveAdjustment = (name: string): number | undefined => {
    const cached = cache.get(name);
    if (cached != null) {
      return cached;
    }

    const formula = formulas.get(name);
    if (!formula) {
      return undefined;
    }

    if (resolving.has(name)) {
      warnFormula(name, formula);
      return undefined;
    }

    resolving.add(name);
    const resolved = parseGeometryAdjustmentFormula(formula, resolveToken);
    resolving.delete(name);
    if (resolved == null) {
      warnFormula(name, formula);
      return undefined;
    }

    cache.set(name, resolved);
    adjustments[name] = resolved;
    return resolved;
  };

  const resolveToken = (token: string): number | undefined => {
    if (GEOMETRY_ADJUSTMENT_NUMBER_PATTERN.test(token)) {
      const value = Number(token);
      return Number.isFinite(value) ? normalizeGeometryAdjustmentNumber(value) : undefined;
    }

    const builtin = GEOMETRY_ADJUSTMENT_BUILTINS[token];
    if (builtin != null) {
      return builtin;
    }

    return resolveAdjustment(token);
  };

  for (const name of formulas.keys()) {
    resolveAdjustment(name);
  }

  return adjustments;
}

const GEOMETRY_ADJUSTMENT_ANGLE_UNITS = 60000;
const GEOMETRY_ADJUSTMENT_NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GEOMETRY_ADJUSTMENT_BUILTINS: Record<string, number> = {
  cd2: 10800000,
  cd4: 5400000,
  cd8: 2700000,
  '3cd4': 16200000,
  '3cd8': 8100000,
  '5cd8': 13500000,
  '7cd8': 18900000
};

function parseGeometryAdjustmentFormula(
  formula: string,
  resolveToken: (token: string) => number | undefined
): number | undefined {
  const [operation, ...args] = formula.trim().split(/\s+/);
  if (!operation) {
    return undefined;
  }

  const read = (index: number): number | undefined => {
    const token = args[index];
    return typeof token === 'string' ? resolveToken(token) : undefined;
  };
  const readArgs = (...indices: number[]): number[] | undefined => {
    const values = indices.map((index) => read(index));
    return values.every((value) => value != null) ? (values as number[]) : undefined;
  };

  switch (operation.toLowerCase()) {
    case 'val': {
      if (args.length !== 1) {
        return undefined;
      }

      return read(0);
    }
    case '+-': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(values[0] + values[1] - values[2]);
    }
    case '*/': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return divideGeometryAdjustment(values[0] * values[1], values[2]);
    }
    case '+/': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return divideGeometryAdjustment(values[0] + values[1], values[2]);
    }
    case '?:': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(values[0] > 0 ? values[1] : values[2]);
    }
    case 'abs': {
      const value = read(0);
      return value == null ? undefined : normalizeGeometryAdjustmentNumber(Math.abs(value));
    }
    case 'at2': {
      const values = readArgs(0, 1);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber((Math.atan2(values[1], values[0]) * 180 * GEOMETRY_ADJUSTMENT_ANGLE_UNITS) / Math.PI);
    }
    case 'cat2': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return scaleGeometryAdjustmentByTriangle(values[0], values[1], values[2], 'adjacent');
    }
    case 'cos': {
      const values = readArgs(0, 1);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(values[0] * Math.cos(toGeometryAdjustmentRadians(values[1])));
    }
    case 'max': {
      const values = readArgs(0, 1);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(Math.max(values[0], values[1]));
    }
    case 'min': {
      const values = readArgs(0, 1);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(Math.min(values[0], values[1]));
    }
    case 'mod': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(Math.hypot(values[0], values[1], values[2]));
    }
    case 'pin': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(Math.min(Math.max(values[1], values[0]), values[2]));
    }
    case 'sat2': {
      const values = readArgs(0, 1, 2);
      if (!values) {
        return undefined;
      }

      return scaleGeometryAdjustmentByTriangle(values[0], values[1], values[2], 'opposite');
    }
    case 'sin': {
      const values = readArgs(0, 1);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(values[0] * Math.sin(toGeometryAdjustmentRadians(values[1])));
    }
    case 'sqrt': {
      const value = read(0);
      return value == null ? undefined : normalizeGeometryAdjustmentNumber(Math.sqrt(Math.max(0, value)));
    }
    case 'tan': {
      const values = readArgs(0, 1);
      if (!values) {
        return undefined;
      }

      return normalizeGeometryAdjustmentNumber(values[0] * Math.tan(toGeometryAdjustmentRadians(values[1])));
    }
    default:
      return undefined;
  }
}

function divideGeometryAdjustment(numerator: number, denominator: number): number {
  if (Math.abs(denominator) < 1e-9) {
    return 0;
  }

  return normalizeGeometryAdjustmentNumber(numerator / denominator);
}

function scaleGeometryAdjustmentByTriangle(
  value: number,
  adjacent: number,
  opposite: number,
  mode: 'adjacent' | 'opposite'
): number {
  const hypotenuse = Math.hypot(adjacent, opposite);
  if (hypotenuse < 1e-9) {
    return 0;
  }

  const component = mode === 'adjacent' ? adjacent : opposite;
  return normalizeGeometryAdjustmentNumber((value * component) / hypotenuse);
}

function toGeometryAdjustmentRadians(angle: number): number {
  return ((angle / GEOMETRY_ADJUSTMENT_ANGLE_UNITS) * Math.PI) / 180;
}

function normalizeGeometryAdjustmentNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const roundedInteger = Math.round(value);
  if (Math.abs(value - roundedInteger) < 1e-6) {
    return roundedInteger;
  }

  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseConnectorDraft(node: XmlRecord, context: ParseContext): SlideItemDraft {
  const transformInfo = parseTransform(node['p:spPr']?.['a:xfrm'], context.group);
  const lineInfo = parseLineInfo(node['p:spPr']?.['a:ln'], context.theme, context.colorMap);
  const shadowInfo = parseShadowInfo(node['p:spPr'], context.theme, context.colorMap);
  const styleLineInfo = resolveStyleLine(
    node['p:style'] as XmlRecord | undefined,
    context.theme,
    context.colorMap,
    context.themeFormatScheme
  );
  const styleShadowInfo = !shadowInfo
    ? resolveStyleEffect(node['p:style'] as XmlRecord | undefined, context.theme, context.colorMap, context.themeFormatScheme)
    : undefined;
  const hyperlink = parseHyperlink(node['p:nvCxnSpPr']?.['p:cNvPr']?.['a:hlinkClick'] as XmlRecord | undefined, context);
  const item: ShapeItem = {
    id: createId('connector'),
    name: getName(node, ['p:nvCxnSpPr', 'p:cNvPr']) ?? 'connector',
    kind: 'shape',
    shapeType: 'line',
    transform: transformInfo.transform,
    fill: { type: 'none' },
    line: mergeResolvedLineStyles(lineInfo.line, styleLineInfo?.line, lineInfo.hasLine),
    shadow: styleShadowInfo ?? shadowInfo,
    order: getNodeOrder(node, context.orderedNodeOrders),
    groupPath: [...context.group.groupPath],
    ...hyperlink
  };

  return {
    item,
    hasTransform: transformInfo.hasTransform,
    hasText: false,
    hasFill: false,
    hasLine: lineInfo.hasLine || styleLineInfo?.hasLine === true
  };
}

function parseImageDraft(node: XmlRecord, context: ParseContext): SlideItemDraft {
  const transformInfo = parseTransform(node['p:spPr']?.['a:xfrm'], context.group);
  const crop = parseImageCrop(node['p:blipFill']?.['a:srcRect']);
  const opacity = parseBlipOpacity(asXmlRecordNode(node['p:blipFill']?.['a:blip']));
  const shadowInfo = parseShadowInfo(node['p:spPr'], context.theme, context.colorMap);
  const fillInfo = parseFillInfo(node['p:spPr'], context.theme, context.colorMap, undefined, context);
  const lineInfo = parseLineInfo(node['p:spPr']?.['a:ln'], context.theme, context.colorMap);
  const styleLineInfo = resolveStyleLine(
    node['p:style'] as XmlRecord | undefined,
    context.theme,
    context.colorMap,
    context.themeFormatScheme
  );
  const styleFillInfo = shouldResolveStyleFill(fillInfo)
    ? resolveStyleFill(node['p:style'] as XmlRecord | undefined, context.theme, context.colorMap, context.themeFormatScheme)
    : undefined;
  const styleShadowInfo = !shadowInfo
    ? resolveStyleEffect(node['p:style'] as XmlRecord | undefined, context.theme, context.colorMap, context.themeFormatScheme)
    : undefined;
  const hyperlink = parseHyperlink(node['p:nvPicPr']?.['p:cNvPr']?.['a:hlinkClick'] as XmlRecord | undefined, context);
  const itemName = getName(node, ['p:nvPicPr', 'p:cNvPr']) ?? 'image';
  const posterEmbedId = node['p:blipFill']?.['a:blip']?.['r:embed'] as string | undefined;
  const posterMediaId = resolveInternalRelationshipTarget(
    posterEmbedId,
    [REL_TYPES.image],
    context,
    `poster image for ${itemName}`
  );
  const mediaSource = resolveEmbeddedMediaSource(node['p:nvPicPr']?.['p:nvPr'] as XmlRecord | undefined, context, itemName);

  if (mediaSource?.mediaId) {
    const item: MediaItem = {
      id: createId('media'),
      name: itemName,
      kind: 'media',
      mediaType: mediaSource.mediaType,
      transform: transformInfo.transform,
      fill: resolveAppliedFill(fillInfo, styleFillInfo),
      line: mergeResolvedLineStyles(lineInfo.line, styleLineInfo?.line, lineInfo.hasLine),
      shadow: styleShadowInfo ?? shadowInfo,
      order: getNodeOrder(node, context.orderedNodeOrders),
      groupPath: [...context.group.groupPath],
      mediaId: mediaSource.mediaId,
      posterMediaId,
      crop,
      opacity,
      ...hyperlink
    };

    return {
      item,
      hasTransform: transformInfo.hasTransform,
      hasText: false,
      hasFill: fillInfo.hasFill || styleFillInfo?.hasFill === true,
      hasLine: lineInfo.hasLine || styleLineInfo?.hasLine === true
    };
  }

  const item: ImageItem = {
    id: createId('image'),
    name: itemName,
    kind: 'image',
    transform: transformInfo.transform,
    fill: resolveAppliedFill(fillInfo, styleFillInfo),
    line: mergeResolvedLineStyles(lineInfo.line, styleLineInfo?.line, lineInfo.hasLine),
    shadow: styleShadowInfo ?? shadowInfo,
    order: getNodeOrder(node, context.orderedNodeOrders),
    groupPath: [...context.group.groupPath],
    mediaId: posterMediaId ?? '',
    crop,
    opacity,
    ...hyperlink
  };

  if (!posterMediaId) {
    context.warnings.push(`Image ${itemName} has no media reference.`);
  }

  return {
    item,
    hasTransform: transformInfo.hasTransform,
    hasText: false,
    hasFill: fillInfo.hasFill || styleFillInfo?.hasFill === true,
    hasLine: lineInfo.hasLine || styleLineInfo?.hasLine === true
  };
}

function parseGraphicFrameDrafts(node: XmlRecord, context: ParseContext): SlideItemDraft[] {
  if (node['a:graphic']?.['a:graphicData']?.['a:tbl']) {
    return [parseTableDraft(node, context)];
  }

  const graphicData = node['a:graphic']?.['a:graphicData'] as XmlRecord | undefined;
  if (graphicData?.uri === 'http://schemas.openxmlformats.org/drawingml/2006/chart') {
    const chartDraft = parseChartGraphicFrameDraft(node, graphicData, context);
    if (chartDraft) {
      return [chartDraft];
    }
  }

  if (graphicData?.uri === 'http://schemas.openxmlformats.org/drawingml/2006/diagram') {
    const diagramDrafts = parseDiagramGraphicFrameDrafts(node, graphicData, context);
    if (diagramDrafts.length) {
      return diagramDrafts;
    }
  }

  const hyperlink = parseHyperlink(node['p:nvGraphicFramePr']?.['p:cNvPr']?.['a:hlinkClick'] as XmlRecord | undefined, context);
  const item: UnsupportedItem = {
    id: createId('unsupported'),
    name: getName(node, ['p:nvGraphicFramePr', 'p:cNvPr']) ?? 'graphic-frame',
    kind: 'unsupported',
    unsupportedType: 'graphicFrame',
    label: 'Unsupported graphic frame',
    transform: parseTransform(node['p:xfrm'], context.group).transform,
    fill: { type: 'none' },
    order: getNodeOrder(node, context.orderedNodeOrders),
    groupPath: [...context.group.groupPath],
    ...hyperlink
  };
  context.warnings.push(`Unsupported graphic frame ${item.name ?? item.id}.`);

  return [
    {
      item,
      hasTransform: true,
      hasText: false,
      hasFill: false,
      hasLine: false
    }
  ];
}

function parseChartGraphicFrameDraft(
  node: XmlRecord,
  graphicData: XmlRecord,
  context: ParseContext
): SlideItemDraft | undefined {
  const chartRelId = graphicData['c:chart']?.['r:id'];
  const relationship = typeof chartRelId === 'string' ? context.relationships[chartRelId] : undefined;
  if (!relationship || relationship.type !== REL_TYPES.chart) {
    return undefined;
  }

  const chartSpace = context.chartSpaces[relationship.target];
  const chartNode = chartSpace?.['c:chart'] as XmlRecord | undefined;
  const plotArea = chartNode?.['c:plotArea'] as XmlRecord | undefined;
  const barChart = asArray(plotArea?.['c:barChart'])[0] as XmlRecord | undefined;
  if (!chartNode || !plotArea || !barChart || String(barChart['c:barDir']?.val ?? 'col') !== 'col') {
    return undefined;
  }

  const categories = readChartStrings(asArray(barChart['c:ser'])[0]?.['c:cat']);
  const series = asArray(barChart['c:ser']).map((seriesNode, index) => {
    const fill = parseFillInfo(seriesNode['c:spPr'] as XmlRecord | undefined, context.theme, context.colorMap).fill;
    return {
      name: readChartText(seriesNode['c:tx']) ?? `Series ${index + 1}`,
      values: readChartNumbers(seriesNode['c:val']),
      color: primaryFillColor(fill) ?? resolveThemeColor(`accent${(index % 6) + 1}`, context.theme.colors, context.colorMap),
      alpha: primaryFillAlpha(fill)
    };
  });
  if (!series.length || !series.some((entry) => entry.values.some((value) => value != null))) {
    return undefined;
  }

  const valueAxisNode = asArray(plotArea['c:valAx'])[0] as XmlRecord | undefined;
  const valueAxis = valueAxisNode
    ? {
        min: readFiniteNumber(valueAxisNode['c:scaling']?.['c:min']?.val),
        max: readFiniteNumber(valueAxisNode['c:scaling']?.['c:max']?.val),
        majorUnit: readFiniteNumber(valueAxisNode['c:majorUnit']?.val),
        formatCode: typeof valueAxisNode['c:numFmt']?.formatCode === 'string'
          ? String(valueAxisNode['c:numFmt'].formatCode)
          : undefined
      }
    : undefined;
  const transformInfo = parseTransform(node['p:xfrm'], context.group);
  const hyperlink = parseHyperlink(node['p:nvGraphicFramePr']?.['p:cNvPr']?.['a:hlinkClick'] as XmlRecord | undefined, context);
  const item: ChartItem = {
    id: createId('chart'),
    name: getName(node, ['p:nvGraphicFramePr', 'p:cNvPr']) ?? 'chart',
    kind: 'chart',
    chartType: 'column',
    grouping: normalizeChartGrouping(barChart['c:grouping']?.val),
    title: readChartText(chartNode['c:title']?.['c:tx']),
    categories,
    series,
    legendPosition: resolveChartLegendPosition(chartNode['c:legend']),
    valueAxis,
    transform: transformInfo.transform,
    fill: { type: 'none' },
    order: getNodeOrder(node, context.orderedNodeOrders),
    groupPath: [...context.group.groupPath],
    ...hyperlink
  };

  return {
    item,
    hasTransform: transformInfo.hasTransform,
    hasText: Boolean(item.title),
    hasFill: false,
    hasLine: false
  };
}

function readChartText(node: XmlRecord | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  const richText = asArray(node['c:rich']?.['a:p'])
    .flatMap((paragraph) => [
      ...asArray(paragraph['a:r']).map((run) => String(run?.['a:t'] ?? '')),
      ...asArray(paragraph['a:fld']).map((field) => String(field?.['a:t'] ?? ''))
    ])
    .join('')
    .trim();
  if (richText) {
    return richText;
  }

  const values = readChartStrings(node);
  return values.find((value) => value.trim())?.trim();
}

function readChartStrings(node: XmlRecord | undefined): string[] {
  const cache = resolveChartCache(node);
  return readChartCacheValues(cache).map((value) => value ?? '');
}

function readChartNumbers(node: XmlRecord | undefined): Array<number | null> {
  const cache = resolveChartCache(node);
  return readChartCacheValues(cache).map((value) => {
    if (value == null || value.trim() === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });
}

function resolveChartCache(node: XmlRecord | undefined): XmlRecord | undefined {
  if (!node) {
    return undefined;
  }

  return (
    node['c:strRef']?.['c:strCache'] ??
    node['c:numRef']?.['c:numCache'] ??
    node['c:strLit'] ??
    node['c:numLit']
  ) as XmlRecord | undefined;
}

function readChartCacheValues(cache: XmlRecord | undefined): Array<string | null> {
  if (!cache) {
    return [];
  }

  const points = asArray(cache['c:pt']);
  const pointCount = Math.max(
    0,
    toNumber(cache['c:ptCount']?.val, 0),
    ...points.map((point) => toNumber(point?.idx, -1) + 1)
  );
  const values = Array<string | null>(pointCount).fill(null);
  for (const point of points) {
    const index = toNumber(point?.idx, -1);
    if (index >= 0 && index < values.length) {
      values[index] = point?.['c:v'] == null ? null : String(point['c:v']);
    }
  }
  return values;
}

function readFiniteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeChartGrouping(value: unknown): ChartItem['grouping'] {
  switch (String(value ?? 'clustered')) {
    case 'stacked':
      return 'stacked';
    case 'percentStacked':
      return 'percentStacked';
    default:
      return 'clustered';
  }
}

function resolveChartLegendPosition(node: XmlRecord | undefined): ChartItem['legendPosition'] {
  if (!node || node['c:delete']?.val === '1') {
    return 'none';
  }

  switch (String(node['c:legendPos']?.val ?? 'right')) {
    case 't':
      return 'top';
    case 'b':
      return 'bottom';
    case 'l':
      return 'left';
    case 'r':
    case 'tr':
    default:
      return 'right';
  }
}

function parseTableDraft(node: XmlRecord, context: ParseContext): SlideItemDraft {
  const tableNode = node['a:graphic']?.['a:graphicData']?.['a:tbl'] as XmlRecord;
  const tableProps = asXmlRecordNode(tableNode?.['a:tblPr']);
  const transformInfo = parseTransform(node['p:xfrm'], context.group);
  const hyperlink = parseHyperlink(node['p:nvGraphicFramePr']?.['p:cNvPr']?.['a:hlinkClick'] as XmlRecord | undefined, context);
  const columns = asArray(tableNode['a:tblGrid']?.['a:gridCol']).map((column) => emuToPx(toNumber(column.w, 0)));
  const rowNodes = asArray(tableNode['a:tr']);
  const rows = rowNodes.map((row) => emuToPx(toNumber(row.h, 0)));
  const tableStyle = resolveTableStyleDefinition(tableProps, context.tableStyles);
  const cells: TableCell[] = [];

  rowNodes.forEach((rowNode, rowIndex) => {
    let columnIndex = 0;
    for (const cellNode of asArray(rowNode['a:tc'])) {
      const cellProps = asXmlRecordNode(cellNode['a:tcPr']);
      const rowSpan = Math.max(1, toNumber(cellNode.rowSpan ?? cellProps?.rowSpan, 1));
      const colSpan = Math.max(1, toNumber(cellNode.gridSpan ?? cellProps?.gridSpan, 1));
      const isMergedContinuation =
        cellNode.hMerge === '1' || cellNode.vMerge === '1' || cellProps?.hMerge === '1' || cellProps?.vMerge === '1';
      const cellTextLanguage = inferTextBodyLanguage(cellNode['a:txBody'] as XmlRecord | undefined);
      const stylePart = resolveTableCellStyle(
        tableStyle,
        tableProps,
        rowIndex,
        columnIndex,
        rowSpan,
        colSpan,
        rowNodes.length,
        columns.length,
        context,
        cellTextLanguage
      );
      const tableTextListStyle = createTableTextListStyle(context.textStyles.other, stylePart.textStyle?.paragraphAlign);
      const tableDefaultRunStyle = mergeRunStyles(
        resolveParagraphStyleDefaults(tableTextListStyle, 0).run,
        stylePart.textStyle?.run ?? {}
      );
      const localFillInfo = parseFillInfo(cellProps, context.theme, context.colorMap, undefined, context);
      const localBorders = parseTableCellBorders(cellProps, context.theme, context.colorMap);
      const parsedTextFrame = parseTextFrame(
        cellNode['a:txBody'],
        context,
        undefined,
        stylePart.textStyle?.run ?? {},
        undefined,
        tableTextListStyle
      );
      const hasExplicitVerticalAlign = parsedTextFrame.styleFlags.verticalAlign || cellProps?.anchor != null;
      const textFrame = applyTableCellTextFrameDefaults(
        applyTextFrameDefaults(
          applyTableCellProperties(
            parsedTextFrame.frame ?? emptyTextFrame(context.theme, tableDefaultRunStyle, cellTextLanguage),
            cellProps
          ),
          tableDefaultRunStyle
        ),
        hasExplicitVerticalAlign
      );

      cells.push({
        row: rowIndex,
        column: columnIndex,
        rowSpan,
        colSpan,
        isMergedContinuation,
        fill: localFillInfo.hasFill ? localFillInfo.fill : stylePart.fill ?? { type: 'none' },
        borders: mergeTableBorders(
          materializeTableBorders(stylePart.borders, rowIndex, columnIndex, rowNodes.length, columns.length),
          localBorders
        ),
        textFrame
      });
      // OOXML tables keep one <a:tc> node per grid slot, even when the leading
      // cell advertises a wider gridSpan. Advance by physical slots here so
      // continuation cells retain their true column positions.
      columnIndex += colSpan > 1 || isMergedContinuation ? 1 : colSpan;
    }
  });

  const item: TableItem = {
    id: createId('table'),
    name: getName(node, ['p:nvGraphicFramePr', 'p:cNvPr']) ?? 'table',
    kind: 'table',
    transform: transformInfo.transform,
    fill: { type: 'none' },
    order: getNodeOrder(node, context.orderedNodeOrders),
    groupPath: [...context.group.groupPath],
    ...hyperlink,
    columns,
    rows,
    cells
  };

  return {
    item,
    hasTransform: transformInfo.hasTransform,
    hasText: cells.some((cell) => hasTextFrame(cell.textFrame)),
    hasFill: false,
    hasLine: false
  };
}

function parseDiagramGraphicFrameDrafts(node: XmlRecord, graphicData: XmlRecord, context: ParseContext): SlideItemDraft[] {
  const relIds = graphicData['dgm:relIds'] as XmlRecord | undefined;
  const dataRelId = typeof relIds?.['r:dm'] === 'string' ? String(relIds['r:dm']) : undefined;
  if (!dataRelId) {
    return [];
  }

  const dataRelationship = context.relationships[dataRelId];
  if (!dataRelationship || dataRelationship.type !== REL_TYPES.diagramData) {
    return [];
  }

  const dataModel = context.diagramDataModels[dataRelationship.target];
  const drawingRelId = findDiagramDrawingRelId(dataModel);
  if (!drawingRelId) {
    return [];
  }

  const drawingRelationship = context.relationships[drawingRelId];
  if (!drawingRelationship || drawingRelationship.type !== REL_TYPES.diagramDrawing) {
    return [];
  }

  const drawing = context.diagramDrawings[drawingRelationship.target];
  const spTree = drawing?.['dsp:spTree'] as XmlRecord | undefined;
  if (!spTree) {
    return [];
  }

  const normalizedTree = normalizeDiagramDrawingTree(spTree);
  const baseOrder = getNodeOrder(node, context.orderedNodeOrders);
  const graphicFrameName = getName(node, ['p:nvGraphicFramePr', 'p:cNvPr']) ?? createId('diagram');
  const diagramContext: ParseContext = {
    ...context,
    inDiagram: true,
    group: createChildGroupContext(node['p:xfrm'] as XmlRecord | undefined, context.group, graphicFrameName)
  };
  return parseSpTree(normalizedTree, diagramContext).map((draft, index) => ({
    ...draft,
    item: {
      ...draft.item,
      order: baseOrder + index / 1000
    }
  }));
}

async function preloadDiagramParts(
  zip: JSZip,
  relationships: Record<string, RelationshipEntry>
): Promise<{ dataModels: Record<string, XmlRecord | null>; drawings: Record<string, XmlRecord | null> }> {
  const dataModels: Record<string, XmlRecord | null> = {};
  const drawings: Record<string, XmlRecord | null> = {};
  const dataRelationships = Object.values(relationships).filter((entry) => entry.type === REL_TYPES.diagramData);

  for (const relationship of dataRelationships) {
    if (!(relationship.target in dataModels)) {
      const xml = await parseXmlFile(zip, relationship.target);
      dataModels[relationship.target] = (xml?.['dgm:dataModel'] as XmlRecord | undefined) ?? null;
    }

    const drawingRelId = findDiagramDrawingRelId(dataModels[relationship.target]);
    if (!drawingRelId) {
      continue;
    }

    const drawingRelationship = relationships[drawingRelId];
    if (!drawingRelationship || drawingRelationship.type !== REL_TYPES.diagramDrawing) {
      continue;
    }

    if (drawingRelationship.target in drawings) {
      continue;
    }

    const drawingXml = await parseXmlFile(zip, drawingRelationship.target);
    drawings[drawingRelationship.target] = (drawingXml?.['dsp:drawing'] as XmlRecord | undefined) ?? null;
  }

  return {
    dataModels,
    drawings
  };
}

async function preloadChartParts(
  zip: JSZip,
  relationships: Record<string, RelationshipEntry>
): Promise<Record<string, XmlRecord | null>> {
  const chartSpaces: Record<string, XmlRecord | null> = {};
  const chartRelationships = Object.values(relationships).filter((entry) => entry.type === REL_TYPES.chart);

  for (const relationship of chartRelationships) {
    const xml = await parseXmlFile(zip, relationship.target);
    chartSpaces[relationship.target] = (xml?.['c:chartSpace'] as XmlRecord | undefined) ?? null;
  }

  return chartSpaces;
}

function findDiagramDrawingRelId(node: XmlRecord | null | undefined): string | undefined {
  const ext = findNestedNodeByKey(node, 'dsp:dataModelExt');
  return typeof ext?.relId === 'string' ? String(ext.relId) : undefined;
}

function findNestedNodeByKey(value: unknown, key: string): XmlRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (!Array.isArray(value) && key in (value as XmlRecord)) {
    return asXmlRecordNode((value as XmlRecord)[key]);
  }

  const entries = Array.isArray(value) ? value : Object.values(value as XmlRecord);
  for (const entry of entries) {
    const nested = findNestedNodeByKey(entry, key);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function normalizeDiagramDrawingTree(tree: XmlRecord): XmlRecord {
  return renameXmlNamespace(tree, 'dsp:', 'p:');
}

function multiplyAffineMatrices(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}

function translateMatrix(x: number, y: number): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function scaleMatrix(x: number, y: number): AffineMatrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function flipMatrix(horizontal: boolean, vertical: boolean): AffineMatrix {
  return {
    a: horizontal ? -1 : 1,
    b: 0,
    c: 0,
    d: vertical ? -1 : 1,
    e: 0,
    f: 0
  };
}

function rotateMatrix(degrees: number): AffineMatrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: 0,
    f: 0
  };
}

function applyAffineMatrix(matrix: AffineMatrix, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f
  };
}

function renameXmlNamespace(value: unknown, fromPrefix: string, toPrefix: string): any {
  if (Array.isArray(value)) {
    return value.map((entry) => renameXmlNamespace(entry, fromPrefix, toPrefix));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as XmlRecord;
  const next: XmlRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    const nextKey = key.startsWith(fromPrefix) ? `${toPrefix}${key.slice(fromPrefix.length)}` : key;
    next[nextKey] = renameXmlNamespace(entry, fromPrefix, toPrefix);
  }

  return next;
}

function parseTransform(xfrmNode: XmlRecord | undefined, group: GroupContext): { transform: ItemTransform; hasTransform: boolean } {
  if (!xfrmNode) {
    return {
      transform: {
        x: group.offsetX,
        y: group.offsetY,
        width: 0,
        height: 0,
        rotation: group.rotation,
        flipH: false,
        flipV: false
      },
      hasTransform: false
    };
  }

  const offNode = xfrmNode['a:off'] ?? xfrmNode.off;
  const extNode = xfrmNode['a:ext'] ?? xfrmNode.ext;
  const x = emuToPx(toNumber(offNode?.x, 0));
  const y = emuToPx(toNumber(offNode?.y, 0));
  const width = emuToPx(toNumber(extNode?.cx, 0));
  const height = emuToPx(toNumber(extNode?.cy, 0));
  const scaledWidth = width * group.scaleX;
  const scaledHeight = height * group.scaleY;
  const center = applyAffineMatrix(group.matrix, x + width / 2, y + height / 2);

  return {
    transform: {
      x: center.x - scaledWidth / 2,
      y: center.y - scaledHeight / 2,
      width: scaledWidth,
      height: scaledHeight,
      rotation: angleToDegrees(toNumber(xfrmNode.rot, 0)) + group.rotation,
      flipH: (xfrmNode.flipH === '1') !== group.flipH,
      flipV: (xfrmNode.flipV === '1') !== group.flipV
    },
    hasTransform: true
  };
}

function createChildGroupContext(xfrmNode: XmlRecord | undefined, parent: GroupContext, groupId: string): GroupContext {
  return composeGroupContext(xfrmNode, parent, groupId, true);
}

function composeGroupContext(
  xfrmNode: XmlRecord | undefined,
  parent: GroupContext,
  groupId?: string,
  appendGroupPath = true
): GroupContext {
  if (!xfrmNode) {
    return {
      ...parent,
      groupPath: appendGroupPath && groupId ? [...parent.groupPath, groupId] : [...parent.groupPath]
    };
  }

  const offNode = xfrmNode['a:off'];
  const extNode = xfrmNode['a:ext'];
  const childOffNode = xfrmNode['a:chOff'];
  const childExtNode = xfrmNode['a:chExt'];

  const offX = emuToPx(toNumber(offNode?.x, 0));
  const offY = emuToPx(toNumber(offNode?.y, 0));
  const extX = extNode ? emuToPx(toNumber(extNode.cx, 0)) : undefined;
  const extY = extNode ? emuToPx(toNumber(extNode.cy, 0)) : undefined;
  const childOffX = childOffNode ? emuToPx(toNumber(childOffNode.x, 0)) : 0;
  const childOffY = childOffNode ? emuToPx(toNumber(childOffNode.y, 0)) : 0;
  const childExtX = childExtNode ? emuToPx(toNumber(childExtNode.cx, 0)) : extX;
  const childExtY = childExtNode ? emuToPx(toNumber(childExtNode.cy, 0)) : extY;

  const scaleX = extX === undefined || childExtX === undefined || childExtX === 0 ? 1 : extX / childExtX;
  const scaleY = extY === undefined || childExtY === undefined || childExtY === 0 ? 1 : extY / childExtY;
  const rotation = angleToDegrees(toNumber(xfrmNode.rot, 0));
  const flipH = xfrmNode.flipH === '1';
  const flipV = xfrmNode.flipV === '1';
  const centerX = offX + (extX ?? 0) / 2;
  const centerY = offY + (extY ?? 0) / 2;
  const localMatrix = multiplyAffineMatrices(
    multiplyAffineMatrices(
      multiplyAffineMatrices(
        multiplyAffineMatrices(
          multiplyAffineMatrices(translateMatrix(centerX, centerY), rotateMatrix(rotation)),
          flipMatrix(flipH, flipV)
        ),
        translateMatrix(-centerX, -centerY)
      ),
      translateMatrix(offX, offY)
    ),
    multiplyAffineMatrices(scaleMatrix(scaleX, scaleY), translateMatrix(-childOffX, -childOffY))
  );
  const matrix = multiplyAffineMatrices(parent.matrix, localMatrix);
  const origin = applyAffineMatrix(matrix, 0, 0);

  return {
    offsetX: origin.x,
    offsetY: origin.y,
    scaleX: parent.scaleX * scaleX,
    scaleY: parent.scaleY * scaleY,
    rotation: parent.rotation + rotation,
    flipH: parent.flipH !== flipH,
    flipV: parent.flipV !== flipV,
    matrix,
    fill: parent.fill,
    groupPath: appendGroupPath && groupId ? [...parent.groupPath, groupId] : [...parent.groupPath]
  };
}

function createFillParseContext(context: ParseContext): FillParseContext {
  return {
    relationships: context.relationships,
    warnings: context.warnings,
    slidePath: context.slidePath,
    groupFill: context.group.fill ? deepClone(context.group.fill) : undefined
  };
}

function resolveGroupFill(node: XmlRecord | undefined, context: ParseContext): FillStyle | undefined {
  const fillInfo = parseFillInfo(node, context.theme, context.colorMap, undefined, createFillParseContext(context));
  if (fillInfo.hasFill) {
    return deepClone(fillInfo.fill);
  }

  return context.group.fill ? deepClone(context.group.fill) : undefined;
}

function parseFillInfo(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  placeholderColor?: { color: string; alpha?: number },
  fillContext?: FillParseContext
): { fill: FillStyle; hasFill: boolean } {
  if (!node) {
    return {
      fill: { type: 'none' },
      hasFill: false
    };
  }

  if (node['a:grpFill'] !== undefined) {
    return {
      fill: fillContext?.groupFill ? deepClone(fillContext.groupFill) : { type: 'none' },
      hasFill: true
    };
  }

  if (node['a:noFill'] !== undefined) {
    return {
      fill: { type: 'none' },
      hasFill: true
    };
  }

  const solidFill = node['a:solidFill'] as XmlRecord | undefined;
  if (solidFill) {
    const color = parseColorValue(solidFill, theme, clrMap, placeholderColor);
    return {
      fill: {
        type: 'solid',
        color: color.color,
        alpha: color.alpha
      },
      hasFill: true
    };
  }

  const pictureFill = node['a:blipFill'] as XmlRecord | undefined;
  if (pictureFill) {
    const fill = parsePictureFill(pictureFill, fillContext);
    if (fill) {
      return {
        fill,
        hasFill: true
      };
    }
  }

  const patternFill = node['a:pattFill'] as XmlRecord | undefined;
  if (patternFill) {
    const fill = parsePatternFill(patternFill, theme, clrMap, placeholderColor);
    if (fill) {
      return {
        fill,
        hasFill: true
      };
    }
  }

  const gradientFill = node['a:gradFill'] as XmlRecord | undefined;
  if (gradientFill) {
    const fill = parseGradientFill(gradientFill, theme, clrMap, placeholderColor);
    if (fill) {
      return {
        fill,
        hasFill: true
      };
    }
  }

  return {
    fill: { type: 'none' },
    hasFill: false
  };
}

function parseLineInfo(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  placeholderColor?: { color: string; alpha?: number }
): { line: LineStyle | undefined; hasLine: boolean } {
  if (!node) {
    return {
      line: undefined,
      hasLine: false
    };
  }

  if (node['a:noFill'] !== undefined) {
    return {
      line: undefined,
      hasLine: true
    };
  }

  const fill = parseFillInfo(node, theme, clrMap, placeholderColor);
  return {
    line: {
      color: primaryFillColor(fill.fill),
      alpha: primaryFillAlpha(fill.fill),
      width: emuToPx(toNumber(node.w, 0)),
      dash: node['a:prstDash']?.val ? String(node['a:prstDash'].val) : undefined,
      compound: normalizeLineCompound(node.cmpd),
      lineCap: normalizeLineCap(node.cap),
      lineJoin: normalizeLineJoin(node),
      miterLimit: parseLineMiterLimit(node),
      headEnd: normalizeLineEndType(node['a:headEnd']?.type),
      tailEnd: normalizeLineEndType(node['a:tailEnd']?.type)
    },
    hasLine: true
  };
}

function mergeResolvedLineStyles(
  explicitLine: LineStyle | undefined,
  styleLine: LineStyle | undefined,
  explicitHasLine: boolean
): LineStyle | undefined {
  if (explicitHasLine) {
    if (!explicitLine) {
      return undefined;
    }
    if (!styleLine) {
      return explicitLine;
    }

    const merged: LineStyle = { ...styleLine };
    for (const [key, value] of Object.entries(explicitLine) as Array<[keyof LineStyle, LineStyle[keyof LineStyle]]>) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[String(key)] = value;
      }
    }
    return merged;
  }

  return styleLine;
}

function parseShadowInfo(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  placeholderColor?: { color: string; alpha?: number }
): ShadowStyle | undefined {
  const shadowNode = (node?.['a:effectLst']?.['a:outerShdw'] ?? node?.['a:outerShdw']) as XmlRecord | undefined;
  if (!shadowNode) {
    return undefined;
  }

  const color = parseColorValue(shadowNode, theme, clrMap, placeholderColor);
  const angle = angleToDegrees(toNumber(shadowNode.dir, 0));
  const distance = emuToPx(toNumber(shadowNode.dist, 0));
  const blur = emuToPx(toNumber(shadowNode.blurRad, 0));
  const offset = resolveShadowOffset(distance, angle);

  return {
    color: color.color,
    alpha: color.alpha,
    blur,
    distance,
    angle,
    offsetX: offset.x,
    offsetY: offset.y
  };
}

function resolveShadowOffset(distance: number, angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Number((Math.cos(radians) * distance).toFixed(3)),
    y: Number((Math.sin(radians) * distance).toFixed(3))
  };
}

function parseImageCrop(node: XmlRecord | undefined): ImageItem['crop'] {
  if (!node) {
    return undefined;
  }

  const crop = {
    left: clamp(toNumber(node.l, 0) / 100000, 0, 1),
    right: clamp(toNumber(node.r, 0) / 100000, 0, 1),
    top: clamp(toNumber(node.t, 0) / 100000, 0, 1),
    bottom: clamp(toNumber(node.b, 0) / 100000, 0, 1)
  };

  return crop.left || crop.right || crop.top || crop.bottom ? crop : undefined;
}

function parseBlipOpacity(node: XmlRecord | undefined): number | undefined {
  if (!node) {
    return undefined;
  }

  let opacity = 1;
  let hasOpacity = false;

  const alphaNode = asXmlRecordNode(node['a:alpha']) ?? asXmlRecordNode(node.alpha);
  if (alphaNode?.amt != null) {
    opacity = clamp(toNumber(alphaNode.amt, 100000) / 100000, 0, 1);
    hasOpacity = true;
  }

  const alphaModNode = asXmlRecordNode(node['a:alphaMod']) ?? asXmlRecordNode(node.alphaMod);
  if (alphaModNode?.amt != null) {
    opacity *= clamp(toNumber(alphaModNode.amt, 100000) / 100000, 0, 1);
    hasOpacity = true;
  }

  const alphaModFixNode = asXmlRecordNode(node['a:alphaModFix']) ?? asXmlRecordNode(node.alphaModFix);
  if (alphaModFixNode?.amt != null) {
    opacity *= clamp(toNumber(alphaModFixNode.amt, 100000) / 100000, 0, 1);
    hasOpacity = true;
  }

  const alphaOffNode = asXmlRecordNode(node['a:alphaOff']) ?? asXmlRecordNode(node.alphaOff);
  if (alphaOffNode?.amt != null) {
    opacity += toNumber(alphaOffNode.amt, 0) / 100000;
    hasOpacity = true;
  }

  return hasOpacity ? clamp(opacity, 0, 1) : undefined;
}

function parsePictureFill(node: XmlRecord | undefined, context: FillParseContext | undefined): FillStyle | undefined {
  if (!node || !context) {
    return undefined;
  }

  const blip = node['a:blip'] as XmlRecord | undefined;
  const embedId = blip?.['r:embed'] as string | undefined;
  const linkId = blip?.['r:link'] as string | undefined;
  const relationshipId = embedId ?? linkId;

  if (!relationshipId) {
    context.warnings.push(`Picture fill in ${context.slidePath} has no image relationship.`);
    return undefined;
  }

  const relationship = context.relationships[relationshipId];
  if (!relationship) {
    context.warnings.push(`Missing image relationship ${relationshipId} in ${context.slidePath}.`);
    return undefined;
  }

  if (relationship.type !== REL_TYPES.image || relationship.targetMode === 'External') {
    context.warnings.push(`Unsupported picture fill relationship ${relationshipId} in ${context.slidePath}.`);
    return undefined;
  }

  return {
    type: 'picture',
    mediaId: relationship.target,
    crop: parseImageCrop(node['a:srcRect']),
    tile: node['a:tile'] !== undefined,
    alpha: parseBlipOpacity(blip)
  };
}

function parsePatternFill(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  placeholderColor?: { color: string; alpha?: number }
): FillStyle | undefined {
  if (!node) {
    return undefined;
  }

  const foreground = node['a:fgClr']
    ? parseColorValue(node['a:fgClr'] as XmlRecord, theme, clrMap, placeholderColor)
    : undefined;
  const background = node['a:bgClr']
    ? parseColorValue(node['a:bgClr'] as XmlRecord, theme, clrMap, placeholderColor)
    : undefined;

  return {
    type: 'pattern',
    pattern: typeof node.prst === 'string' ? node.prst : 'pct5',
    foregroundColor: foreground?.color ?? theme.colors.dk1,
    foregroundAlpha: foreground?.alpha,
    backgroundColor: background?.color ?? theme.colors.lt1,
    backgroundAlpha: background?.alpha
  };
}

function shouldResolveStyleFill(fillInfo: { fill: FillStyle; hasFill: boolean }): boolean {
  return !fillInfo.hasFill || fillInfo.fill.type === 'pattern';
}

function resolveAppliedFill(
  fillInfo: { fill: FillStyle; hasFill: boolean },
  styleFillInfo: { fill: FillStyle; hasFill: boolean } | undefined
): FillStyle {
  if (fillInfo.fill.type === 'pattern' && styleFillInfo?.hasFill) {
    return styleFillInfo.fill;
  }

  return styleFillInfo?.fill ?? fillInfo.fill;
}

function parseColorValue(
  node: XmlRecord,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  placeholderColor?: { color: string; alpha?: number }
): { color: string; alpha?: number } {
  const srgb = node['a:srgbClr'] as XmlRecord | undefined;
  const scheme = node['a:schemeClr'] as XmlRecord | undefined;
  const sys = node['a:sysClr'] as XmlRecord | undefined;
  let color = '#000000';
  let alpha: number | undefined;
  let modifierNode: XmlRecord | undefined;

  if (srgb?.val) {
    color = `#${String(srgb.val)}`.toUpperCase();
    modifierNode = srgb;
  } else if (scheme?.val) {
    if (String(scheme.val) === 'phClr' && placeholderColor) {
      color = placeholderColor.color;
      alpha = placeholderColor.alpha;
    } else {
      color = resolveThemeColor(String(scheme.val), theme.colors, clrMap);
    }
    modifierNode = scheme;
  } else if (sys?.lastClr) {
    color = `#${String(sys.lastClr)}`.toUpperCase();
    modifierNode = sys;
  }

  if (modifierNode?.['a:shade']?.val) {
    color = applyShade(color, toNumber(modifierNode['a:shade'].val, 100000) / 100000);
  }
  if (modifierNode?.['a:lumMod']?.val) {
    color = applyLumMod(color, toNumber(modifierNode['a:lumMod'].val, 100000) / 100000);
  }
  if (modifierNode?.['a:lumOff']?.val) {
    color = applyLumOff(color, toNumber(modifierNode['a:lumOff'].val, 0) / 100000);
  }
  if (modifierNode?.['a:tint']?.val) {
    const ooxmlTint = clamp(toNumber(modifierNode['a:tint'].val, 0) / 100000, 0, 1);
    // OOXML tint values retain part of the original color, while applyTint expects
    // the distance to move toward white.
    color = applyTint(color, 1 - ooxmlTint);
  }

  return {
    color,
    alpha: modifierNode?.['a:alpha']?.val ? toNumber(modifierNode['a:alpha'].val, 100000) / 100000 : alpha
  };
}

function parseGradientFill(
  node: XmlRecord,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  placeholderColor?: { color: string; alpha?: number }
): FillStyle | undefined {
  const stops = asArray(node['a:gsLst']?.['a:gs'])
    .map((entry) => {
      const color = parseColorValue(entry, theme, clrMap, placeholderColor);
      return {
        position: clamp(toNumber(entry?.pos, 0) / 100000, 0, 1),
        color: color.color,
        alpha: color.alpha
      };
    })
    .sort((left, right) => left.position - right.position);

  if (!stops.length) {
    return undefined;
  }

  if (stops.length === 1) {
    return {
      type: 'solid',
      color: stops[0].color,
      alpha: stops[0].alpha
    };
  }

  const linearNode = node['a:lin'] as XmlRecord | undefined;
  const pathNode = node['a:path'] as XmlRecord | undefined;

  return {
    type: 'gradient',
    angle: angleToDegrees(toNumber(linearNode?.ang, 0)),
    gradientType: pathNode ? 'path' : 'linear',
    gradientPath: pathNode?.path ? String(pathNode.path) : undefined,
    gradientFillToRect: parseGradientRect(pathNode?.['a:fillToRect']),
    gradientTileRect: parseGradientRect(node['a:tileRect']),
    stops
  };
}

function parseGradientRect(node: XmlRecord | undefined):
  | {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
  | undefined {
  if (node == null) {
    return undefined;
  }

  return {
    left: normalizeGradientRectValue(node.l),
    top: normalizeGradientRectValue(node.t),
    right: normalizeGradientRectValue(node.r),
    bottom: normalizeGradientRectValue(node.b)
  };
}

function normalizeGradientRectValue(value: unknown): number {
  return Number((toNumber(value, 0) / 100000).toFixed(5));
}

function primaryFillColor(fill: FillStyle): string | undefined {
  if (fill.type === 'solid') {
    return fill.color;
  }

  if (fill.type === 'gradient') {
    return fill.stops?.[0]?.color;
  }

  if (fill.type === 'pattern') {
    return fill.foregroundColor ?? fill.backgroundColor;
  }

  return undefined;
}

function primaryFillAlpha(fill: FillStyle): number | undefined {
  if (fill.type === 'solid') {
    return fill.alpha;
  }

  if (fill.type === 'gradient') {
    return fill.stops?.[0]?.alpha;
  }

  if (fill.type === 'pattern') {
    return fill.foregroundAlpha ?? fill.backgroundAlpha;
  }

  return undefined;
}

function parseTextFrame(
  node: XmlRecord | undefined,
  context: ParseContext,
  orderedNode?: OrderedXmlNode,
  defaultRunStyle: TextRunStyle = {},
  defaultParagraphAlign?: TextParagraph['align'],
  inheritedListStyle?: ListStyleDefaults,
  preserveDefaultParagraphLineHeight = false,
  allowImplicitDefaultFont = true
): { frame?: TextFrame; hasText: boolean; styleFlags: TextFrameStyleFlags } {
  const styleFlags = createTextFrameStyleFlags();
  if (!node) {
    return { frame: undefined, hasText: false, styleFlags };
  }

  const bodyPr = asXmlRecordNode(node['a:bodyPr']);
  styleFlags.verticalAlign = bodyPr?.anchor != null;
  styleFlags.direction = bodyPr?.vert != null;
  styleFlags.wrap = bodyPr?.wrap != null;
  styleFlags.anchorCenter = bodyPr?.anchorCtr != null;
  styleFlags.padding.left = bodyPr?.lIns != null;
  styleFlags.padding.right = bodyPr?.rIns != null;
  styleFlags.padding.top = bodyPr?.tIns != null;
  styleFlags.padding.bottom = bodyPr?.bIns != null;
  const parsedListStyle = parseListStyleDefaults(node['a:lstStyle'] as XmlRecord | undefined, context, inheritedListStyle);
  const listStyle = preserveDefaultParagraphLineHeight
    ? parsedListStyle
    : stripLineHeightFromListStyleDefaults(parsedListStyle);
  const orderedParagraphs = orderedNode ? getOrderedChildren(orderedNode, 'a:p') : [];
  const paragraphs = asArray(node['a:p']).map((paragraphNode, index) =>
    parseParagraph(
      paragraphNode,
      context,
      listStyle,
      orderedParagraphs[index],
      defaultRunStyle,
      defaultParagraphAlign,
      allowImplicitDefaultFont
    )
  );
  const autofit = parseTextAutofit(bodyPr);
  collectUnsupportedTextFrameWarnings(bodyPr, context);
  const frame: TextFrame = {
    paragraphs: paragraphs.length ? paragraphs : [{ runs: [] }],
    verticalAlign: normalizeAnchor(bodyPr?.anchor),
    direction: normalizeTextDirection(bodyPr?.vert),
    wrap: normalizeTextWrap(bodyPr?.wrap),
    anchorCenter: toBooleanFlag(bodyPr?.anchorCtr),
    horizontalOverflow: normalizeTextOverflow(bodyPr?.horzOverflow),
    verticalOverflow: normalizeTextOverflow(bodyPr?.vertOverflow),
    columns: Math.max(1, toNumber(bodyPr?.numCol, 1)),
    columnSpacing: bodyPr?.spcCol != null ? emuToPx(toNumber(bodyPr.spcCol, 0)) : undefined,
    rtlColumns: toBooleanFlag(bodyPr?.rtlCol),
    fromWordArt: toBooleanFlag(bodyPr?.fromWordArt),
    padding: {
      left: emuToPx(toNumber(bodyPr?.lIns, 91440)),
      right: emuToPx(toNumber(bodyPr?.rIns, 91440)),
      top: emuToPx(toNumber(bodyPr?.tIns, 45720)),
      bottom: emuToPx(toNumber(bodyPr?.bIns, 45720))
    },
    autofit
  };
  const normalizedFrame = applyTextAutofit(frame);

  return {
    frame: normalizedFrame,
    hasText: hasTextFrame(normalizedFrame),
    styleFlags
  };
}

function parseTextAutofit(node: XmlRecord | undefined): TextFrame['autofit'] | undefined {
  if (!node) {
    return undefined;
  }

  const normalAutofit = asXmlRecordNode(node['a:normAutofit']);
  if (normalAutofit) {
    return {
      type: 'normal',
      fontScale: normalizeAutofitScale(normalAutofit.fontScale),
      lineSpaceReduction: normalizeAutofitScale(normalAutofit.lnSpcReduction)
    };
  }

  if (node['a:spAutoFit'] !== undefined) {
    return {
      type: 'shape'
    };
  }

  if (node['a:noAutofit'] !== undefined) {
    return {
      type: 'none'
    };
  }

  return undefined;
}

function normalizeAutofitScale(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }

  const numeric = toNumber(value, NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return clamp(numeric / 100000, 0.01, 1);
}

function applyTextAutofit(frame: TextFrame): TextFrame {
  const autofit = frame.autofit;
  if (!autofit || autofit.type !== 'normal') {
    return frame;
  }

  const fontScale = autofit.fontScale ?? 1;
  const lineSpaceReduction = autofit.lineSpaceReduction ?? 0;
  if (Math.abs(fontScale - 1) < 0.0001 && lineSpaceReduction <= 0.0001) {
    return frame;
  }

  return {
    ...frame,
    paragraphs: frame.paragraphs.map((paragraph) => {
      const nextParagraph: TextParagraph = {
        ...paragraph,
        runs: paragraph.runs.map((run) => ({
          ...run,
          fontSize: run.fontSize != null ? Number((run.fontSize * fontScale).toFixed(3)) : run.fontSize
        }))
      };

      if (paragraph.lineHeight != null) {
        if (paragraph.lineHeightUnit === 'px') {
          nextParagraph.lineHeight = Number((paragraph.lineHeight * fontScale).toFixed(3));
        } else {
          nextParagraph.lineHeight = Number((paragraph.lineHeight * Math.max(0.2, 1 - lineSpaceReduction)).toFixed(4));
        }
      } else if (lineSpaceReduction > 0.0001) {
        nextParagraph.lineHeight = Number((1 * Math.max(0.2, 1 - lineSpaceReduction)).toFixed(4));
        nextParagraph.lineHeightUnit = 'multiple';
      }

      if (paragraph.spaceBefore != null) {
        nextParagraph.spaceBefore = Number((paragraph.spaceBefore * fontScale).toFixed(3));
      }
      if (paragraph.spaceAfter != null) {
        nextParagraph.spaceAfter = Number((paragraph.spaceAfter * fontScale).toFixed(3));
      }
      if (paragraph.marginLeft != null) {
        nextParagraph.marginLeft = Number((paragraph.marginLeft * fontScale).toFixed(3));
      }
      if (paragraph.indent != null) {
        nextParagraph.indent = Number((paragraph.indent * fontScale).toFixed(3));
      }
      if (paragraph.tabStops?.length) {
        nextParagraph.tabStops = paragraph.tabStops.map((stop) => Number((stop * fontScale).toFixed(3)));
      }

      return nextParagraph;
    })
  };
}

function parseParagraph(
  node: XmlRecord,
  context: ParseContext,
  listStyle: ListStyleDefaults,
  orderedNode?: OrderedXmlNode,
  defaultRunStyle: TextRunStyle = {},
  defaultParagraphAlign?: TextParagraph['align'],
  allowImplicitDefaultFont = true
): TextParagraph {
  const paragraphProps = node['a:pPr'] as XmlRecord | undefined;
  const paragraphLevel = paragraphProps?.lvl != null ? toNumber(paragraphProps.lvl, 0) : 0;
  const paragraphDefaults = resolveParagraphStyleDefaults(listStyle, paragraphLevel);
  const localParagraphDefaults = parseParagraphStyleDefaults(paragraphProps, context);
  const runDefaults = mergeRunStyles(
    mergeRunStyles(paragraphDefaults.run, defaultRunStyle),
    localParagraphDefaults.run
  );
  const bulletDisabled = paragraphProps?.['a:buNone'] !== undefined;
  const runs = orderedNode
    ? parseOrderedParagraphRuns(node, orderedNode, context, runDefaults, allowImplicitDefaultFont)
    : parseUnorderedParagraphRuns(node, context, runDefaults, allowImplicitDefaultFont);

  if (!runs.length) {
    const endParagraphRunStyle = parseRunStyle(
      node['a:endParaRPr'] as XmlRecord | undefined,
      context,
      undefined,
      allowImplicitDefaultFont && !runDefaults.fontFamily
    );
    const fallbackRunStyle = mergeRunStyles(runDefaults, endParagraphRunStyle);
    runs.push({
      text: node['a:endParaRPr'] ? '' : '',
      ...fallbackRunStyle,
      fontFamily: fallbackRunStyle.fontFamily ?? (allowImplicitDefaultFont ? context.theme.fonts.minor : undefined)
    });
  }

  return {
    align: localParagraphDefaults.align ?? paragraphDefaults.align ?? defaultParagraphAlign,
    level: paragraphProps?.lvl != null ? paragraphLevel : undefined,
    bullet: bulletDisabled ? undefined : (mergeBulletStyle(paragraphDefaults.bullet, localParagraphDefaults.bullet) ?? undefined),
    bulletDisabled: bulletDisabled || undefined,
    marginLeft: localParagraphDefaults.marginLeft ?? paragraphDefaults.marginLeft,
    indent: localParagraphDefaults.indent ?? paragraphDefaults.indent,
    spaceBefore: localParagraphDefaults.spaceBefore ?? paragraphDefaults.spaceBefore,
    spaceAfter: localParagraphDefaults.spaceAfter ?? paragraphDefaults.spaceAfter,
    lineHeight: localParagraphDefaults.lineHeight ?? paragraphDefaults.lineHeight,
    lineHeightUnit: localParagraphDefaults.lineHeightUnit ?? paragraphDefaults.lineHeightUnit,
    tabStops: localParagraphDefaults.tabStops ?? paragraphDefaults.tabStops,
    runs
  };
}

function parseOrderedParagraphRuns(
  node: XmlRecord,
  orderedNode: OrderedXmlNode,
  context: ParseContext,
  defaults: TextRunStyle,
  allowImplicitDefaultFont: boolean
): TextRun[] {
  const runs: TextRun[] = [];
  const runNodes = asArray(node['a:r']);
  const fieldNodes = asArray(node['a:fld']);
  const symbolNodes = asArray(node['a:sym']);
  const breakNodes = asArray(node['a:br']);
  const tabNodes = asArray(node['a:tab']);
  const softHyphenNodes = asArray(node['a:softHyphen']);
  const noBreakHyphenNodes = asArray(node['a:noBreakHyphen']);
  let runIndex = 0;
  let fieldIndex = 0;
  let symbolIndex = 0;
  let breakIndex = 0;
  let tabIndex = 0;
  let softHyphenIndex = 0;
  let noBreakHyphenIndex = 0;

  for (const entry of orderedNode) {
    if (Object.prototype.hasOwnProperty.call(entry, 'a:r')) {
      const runNode = runNodes[runIndex];
      runIndex += 1;
      if (runNode) {
        runs.push(parseRun(runNode, context, defaults, allowImplicitDefaultFont));
      }
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'a:fld')) {
      const fieldNode = fieldNodes[fieldIndex];
      fieldIndex += 1;
      if (fieldNode) {
        runs.push(parseRun(fieldNode, context, defaults, allowImplicitDefaultFont));
      }
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'a:sym')) {
      const symbolNode = symbolNodes[symbolIndex];
      symbolIndex += 1;
      if (symbolNode) {
        runs.push(parseSymbolRun(symbolNode, context, defaults));
      }
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'a:br')) {
      runs.push(parseControlRun(breakNodes[breakIndex], context, defaults, '\n', allowImplicitDefaultFont));
      breakIndex += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'a:tab')) {
      runs.push(parseControlRun(tabNodes[tabIndex], context, defaults, '\t', allowImplicitDefaultFont));
      tabIndex += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'a:softHyphen')) {
      runs.push(parseControlRun(softHyphenNodes[softHyphenIndex], context, defaults, SOFT_HYPHEN, allowImplicitDefaultFont));
      softHyphenIndex += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'a:noBreakHyphen')) {
      runs.push(parseControlRun(noBreakHyphenNodes[noBreakHyphenIndex], context, defaults, NO_BREAK_HYPHEN, allowImplicitDefaultFont));
      noBreakHyphenIndex += 1;
    }
  }

  for (; runIndex < runNodes.length; runIndex += 1) {
    runs.push(parseRun(runNodes[runIndex], context, defaults, allowImplicitDefaultFont));
  }
  for (; fieldIndex < fieldNodes.length; fieldIndex += 1) {
    runs.push(parseRun(fieldNodes[fieldIndex], context, defaults, allowImplicitDefaultFont));
  }
  for (; symbolIndex < symbolNodes.length; symbolIndex += 1) {
    runs.push(parseSymbolRun(symbolNodes[symbolIndex], context, defaults));
  }
  for (; breakIndex < breakNodes.length; breakIndex += 1) {
    runs.push(parseControlRun(breakNodes[breakIndex], context, defaults, '\n', allowImplicitDefaultFont));
  }
  for (; tabIndex < tabNodes.length; tabIndex += 1) {
    runs.push(parseControlRun(tabNodes[tabIndex], context, defaults, '\t', allowImplicitDefaultFont));
  }
  for (; softHyphenIndex < softHyphenNodes.length; softHyphenIndex += 1) {
    runs.push(parseControlRun(softHyphenNodes[softHyphenIndex], context, defaults, SOFT_HYPHEN, allowImplicitDefaultFont));
  }
  for (; noBreakHyphenIndex < noBreakHyphenNodes.length; noBreakHyphenIndex += 1) {
    runs.push(parseControlRun(noBreakHyphenNodes[noBreakHyphenIndex], context, defaults, NO_BREAK_HYPHEN, allowImplicitDefaultFont));
  }

  return runs;
}

function parseUnorderedParagraphRuns(
  node: XmlRecord,
  context: ParseContext,
  defaults: TextRunStyle,
  allowImplicitDefaultFont: boolean
): TextRun[] {
  const runs: TextRun[] = [];

  for (const runNode of asArray(node['a:r'])) {
    runs.push(parseRun(runNode, context, defaults, allowImplicitDefaultFont));
  }

  for (const fieldNode of asArray(node['a:fld'])) {
    runs.push(parseRun(fieldNode, context, defaults, allowImplicitDefaultFont));
  }

  for (const symbolNode of asArray(node['a:sym'])) {
    runs.push(parseSymbolRun(symbolNode, context, defaults));
  }

  for (const breakNode of asArray(node['a:br'])) {
    runs.push(parseControlRun(breakNode, context, defaults, '\n', allowImplicitDefaultFont));
  }

  for (const tabNode of asArray(node['a:tab'])) {
    runs.push(parseControlRun(tabNode, context, defaults, '\t', allowImplicitDefaultFont));
  }

  for (const softHyphenNode of asArray(node['a:softHyphen'])) {
    runs.push(parseControlRun(softHyphenNode, context, defaults, SOFT_HYPHEN, allowImplicitDefaultFont));
  }

  for (const noBreakHyphenNode of asArray(node['a:noBreakHyphen'])) {
    runs.push(parseControlRun(noBreakHyphenNode, context, defaults, NO_BREAK_HYPHEN, allowImplicitDefaultFont));
  }

  return runs;
}

function parseSymbolRun(node: XmlRecord | undefined, context: ParseContext, defaults: TextRunStyle): TextRun {
  const fontFamily =
    typeof node?.font === 'string'
      ? resolveThemeFontFamily(node.font, context.theme, typeof node?.lang === 'string' ? node.lang : undefined)
      : defaults.fontFamily;
  const text = typeof node?.char === 'string' ? decodeXmlEntities(node.char) : '';

  return {
    text,
    ...defaults,
    fontFamily: fontFamily ?? context.theme.fonts.minor
  };
}

function parseControlRun(
  node: XmlRecord | undefined,
  context: ParseContext,
  defaults: TextRunStyle,
  text: '\n' | '\t' | typeof SOFT_HYPHEN | typeof NO_BREAK_HYPHEN,
  allowImplicitDefaultFont = true
): TextRun {
  const inferredLanguage = inferLanguageFromText(text);
  const style = mergeRunStyles(
    defaults,
    parseRunStyle(asXmlRecordNode(node?.['a:rPr']), context, inferredLanguage, allowImplicitDefaultFont && !defaults.fontFamily)
  );

  return {
    text,
    ...style,
    fontFamily: style.fontFamily ?? (allowImplicitDefaultFont ? resolveThemeDefaultFont('minor', context.theme, inferredLanguage) : undefined)
  };
}

function parseRun(node: XmlRecord, context: ParseContext, defaults: TextRunStyle = {}, allowImplicitDefaultFont = true): TextRun {
  const text = resolveFieldText(node, context) ?? (typeof node['a:t'] === 'string' ? node['a:t'] : '');
  const runProps = asXmlRecordNode(node['a:rPr']) ?? node;
  const inferredLanguage = inferLanguageFromText(text);
  const style = applyHyperlinkRunDefaults(
    mergeRunStyles(defaults, parseRunStyle(runProps, context, inferredLanguage, allowImplicitDefaultFont && !defaults.fontFamily)),
    asXmlRecordNode(runProps['a:hlinkClick']),
    context
  );
  const hyperlink = parseHyperlink(runProps['a:hlinkClick'], context);

  return {
    text,
    ...style,
    fontFamily: style.fontFamily ?? (allowImplicitDefaultFont ? resolveThemeDefaultFont('minor', context.theme, inferredLanguage) : undefined),
    ...hyperlink
  };
}

function resolveFieldText(node: XmlRecord, context: ParseContext): string | undefined {
  const rawText = typeof node['a:t'] === 'string' ? node['a:t'] : undefined;
  const fieldType = typeof node.type === 'string' ? node.type.trim().toLowerCase() : '';
  const slideIndex = context.slideIndexByPath[context.slidePath];

  if (slideIndex == null) {
    return rawText;
  }

  if (
    (fieldType.includes('slidenum') || fieldType.includes('slidenumber')) &&
    isSlideNumberPlaceholderText((rawText ?? '').trim())
  ) {
    return String(slideIndex + 1);
  }

  return rawText;
}

function applyHyperlinkRunDefaults(
  style: TextRunStyle,
  hyperlinkNode: XmlRecord | undefined,
  context: ParseContext
): TextRunStyle {
  if (!hyperlinkNode) {
    return style;
  }

  return {
    ...style,
    color: style.color ?? context.theme.colors.hlink ?? DEFAULT_THEME.colors.hlink,
    underline: style.underline ?? true
  };
}

function parseRunStyle(
  node: XmlRecord | undefined,
  context: ParseContext,
  fallbackLanguage?: string,
  allowImplicitDefaultFont = true
): TextRunStyle {
  if (!node) {
    return {};
  }

  const style: TextRunStyle = {};
  const language = typeof node.lang === 'string' ? node.lang : fallbackLanguage;
  const colorInfo = node['a:solidFill'] ? parseColorValue(node['a:solidFill'], context.theme, context.colorMap) : undefined;
  const highlightInfo = node['a:highlight']
    ? parseColorValue(node['a:highlight'], context.theme, context.colorMap)
    : undefined;
  const fontNode = selectRunFontNode(node, language);

  if (node.b != null) {
    style.bold = node.b === '1';
  }
  if (node.i != null) {
    style.italic = node.i === '1';
  }
  if (node.u != null) {
    style.underline = String(node.u) !== 'none';
  }
  if (node.strike != null) {
    style.strike = String(node.strike) !== 'noStrike';
  }
  if (colorInfo) {
    style.color = colorInfo.color;
    style.colorAlpha = colorInfo.alpha;
  }
  if (highlightInfo) {
    style.highlightColor = highlightInfo.color;
    style.highlightAlpha = highlightInfo.alpha;
  }
  if (node.sz != null) {
    style.fontSize = pointsToPx(toNumber(node.sz, 1800) / 100);
  }
  if (fontNode?.typeface) {
    style.fontFamily = resolveThemeFontFamily(
      String(fontNode.typeface),
      context.theme,
      language
    );
  } else if (allowImplicitDefaultFont && language) {
    style.fontFamily = resolveThemeDefaultFont('minor', context.theme, language);
  }
  if (node.baseline != null) {
    style.baselineShift = toNumber(node.baseline, 0) / 100000;
  }

  return style;
}

function selectRunFontNode(node: XmlRecord, language?: string): XmlRecord | undefined {
  const latin = asXmlRecordNode(node['a:latin']) ?? asXmlRecordNode(node.latin);
  const eastAsia = asXmlRecordNode(node['a:ea']) ?? asXmlRecordNode(node.ea);
  const complexScript = asXmlRecordNode(node['a:cs']) ?? asXmlRecordNode(node.cs);

  if (language) {
    const normalized = language.trim().toLowerCase();
    if (normalized.startsWith('zh') || normalized.startsWith('ja') || normalized.startsWith('ko')) {
      return eastAsia ?? latin ?? complexScript;
    }
    if (normalized.startsWith('ar') || normalized.startsWith('he') || normalized.startsWith('fa') || normalized.startsWith('ur')) {
      return complexScript ?? latin ?? eastAsia;
    }
  }

  return latin ?? eastAsia ?? complexScript;
}

function resolveStyleFont(
  styleNode: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  language?: string
): TextRunStyle | undefined {
  const fontRef = styleNode?.['a:fontRef'] as XmlRecord | undefined;
  if (!fontRef) {
    return undefined;
  }

  const style: TextRunStyle = {};
  const idx = typeof fontRef.idx === 'string' ? fontRef.idx.trim().toLowerCase() : '';

  if (idx === 'major') {
    style.fontFamily = resolveThemeDefaultFont('major', theme, language);
  } else if (idx === 'minor') {
    style.fontFamily = resolveThemeDefaultFont('minor', theme, language);
  }

  if (fontRef['a:srgbClr'] || fontRef['a:schemeClr'] || fontRef['a:sysClr']) {
    style.color = parseColorValue(fontRef, theme, clrMap).color;
  }

  return Object.keys(style).length ? style : undefined;
}

function resolveThemeFontFamily(typeface: string, theme: ThemeModel, language?: string): string {
  const normalized = typeface.trim();
  if (!normalized) {
    return theme.fonts.minor ?? DEFAULT_THEME.fonts.minor ?? typeface;
  }

  if (/^\+mj(?:-|$)/i.test(normalized)) {
    return resolveThemeSchemeFont('major', normalized, theme, language) ?? theme.fonts.major ?? DEFAULT_THEME.fonts.major ?? normalized;
  }

  if (/^\+mn(?:-|$)/i.test(normalized)) {
    return resolveThemeSchemeFont('minor', normalized, theme, language) ?? theme.fonts.minor ?? DEFAULT_THEME.fonts.minor ?? normalized;
  }

  return normalized;
}

function resolveThemeDefaultFont(
  family: 'major' | 'minor',
  theme: ThemeModel,
  language?: string
): string {
  const scripts = family === 'major' ? theme.fonts.majorScripts : theme.fonts.minorScripts;
  const defaultFont =
    family === 'major'
      ? (theme.fonts.major ?? DEFAULT_THEME.fonts.major)
      : (theme.fonts.minor ?? DEFAULT_THEME.fonts.minor);
  const scriptCode = resolveThemeScriptCode(language, 'lt');
  return (scriptCode ? scripts?.[scriptCode] : undefined) ?? defaultFont ?? DEFAULT_THEME.fonts.minor ?? 'Calibri';
}

function resolveThemeSchemeFont(
  family: 'major' | 'minor',
  token: string,
  theme: ThemeModel,
  language?: string
): string | undefined {
  const normalized = token.trim().toLowerCase();
  const scriptCode = normalized.replace(/^\+m[jn]-/, '');
  const scripts = family === 'major' ? theme.fonts.majorScripts : theme.fonts.minorScripts;
  const defaultFont = family === 'major' ? theme.fonts.major : theme.fonts.minor;

  if (scriptCode === 'lt') {
    return defaultFont ?? undefined;
  }

  const preferredScript = resolveThemeScriptCode(language, scriptCode);
  return (preferredScript ? scripts?.[preferredScript] : undefined) ?? defaultFont ?? undefined;
}

function resolveThemeScriptCode(language: string | undefined, fallbackScriptCode: string): string | undefined {
  const normalized = (language ?? '').trim().toLowerCase();
  if (!normalized) {
    return mapThemeScriptCode(fallbackScriptCode);
  }

  if (normalized.startsWith('zh')) {
    return 'Hans';
  }
  if (normalized.startsWith('ja')) {
    return 'Jpan';
  }
  if (normalized.startsWith('ko')) {
    return 'Hang';
  }
  if (normalized.startsWith('ar')) {
    return 'Arab';
  }
  if (normalized.startsWith('he')) {
    return 'Hebr';
  }
  if (normalized.startsWith('th')) {
    return 'Thai';
  }

  return mapThemeScriptCode(fallbackScriptCode);
}

function inferTextBodyLanguage(node: XmlRecord | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  const directLanguage = findLanguageValue(node);
  if (directLanguage) {
    return directLanguage;
  }

  const text = collectTextBodyText(node);
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return 'zh-CN';
  }
  if (/[\u3040-\u30FF]/.test(text)) {
    return 'ja-JP';
  }
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) {
    return 'ko-KR';
  }

  return undefined;
}

function findLanguageValue(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      const language = findLanguageValue(entry);
      if (language) {
        return language;
      }
    }
    return undefined;
  }

  const record = node as XmlRecord;
  if (typeof record.lang === 'string' && record.lang.trim().length) {
    return record.lang;
  }

  for (const value of Object.values(record)) {
    const language = findLanguageValue(value);
    if (language) {
      return language;
    }
  }

  return undefined;
}

function collectTextBodyText(node: unknown): string {
  if (typeof node === 'string') {
    return node;
  }
  if (!node || typeof node !== 'object') {
    return '';
  }

  if (Array.isArray(node)) {
    return node.map((entry) => collectTextBodyText(entry)).join('');
  }

  const record = node as XmlRecord;
  let output = '';
  for (const [key, value] of Object.entries(record)) {
    if (key === 'a:t' && typeof value === 'string') {
      output += value;
      continue;
    }
    output += collectTextBodyText(value);
  }

  return output;
}

function mapThemeScriptCode(value: string): string | undefined {
  switch (value.toLowerCase()) {
    case 'ea':
      return 'Hans';
    case 'cs':
      return 'Arab';
    case 'lt':
      return undefined;
    default:
      return undefined;
  }
}

function mergeRunStyles(base: TextRunStyle, current: TextRunStyle): TextRunStyle {
  const merged: TextRunStyle = {
    ...base,
    ...current
  };

  const color = mergeOptionalColorPair(base.color, base.colorAlpha, current.color, current.colorAlpha);
  merged.color = color.color;
  merged.colorAlpha = color.alpha;

  const highlight = mergeOptionalColorPair(
    base.highlightColor,
    base.highlightAlpha,
    current.highlightColor,
    current.highlightAlpha
  );
  merged.highlightColor = highlight.color;
  merged.highlightAlpha = highlight.alpha;

  return merged;
}

function createTextStyleRegistry(baseListStyle?: ListStyleDefaults): TextStyleRegistry {
  return {
    textBox: cloneListStyleDefaults(baseListStyle),
    title: cloneListStyleDefaults(baseListStyle),
    body: cloneListStyleDefaults(baseListStyle),
    other: cloneListStyleDefaults(baseListStyle)
  };
}

function cloneTextStyleRegistry(source: TextStyleRegistry): TextStyleRegistry {
  return {
    textBox: cloneListStyleDefaults(source.textBox),
    title: cloneListStyleDefaults(source.title),
    body: cloneListStyleDefaults(source.body),
    other: cloneListStyleDefaults(source.other)
  };
}

function cloneListStyleDefaults(source?: ListStyleDefaults): ListStyleDefaults {
  const baseDefault = source?.default;
  const defaultStyle = cloneParagraphStyleDefaults(baseDefault);
  const levels: ListStyleDefaults['levels'] = {};

  for (let level = 0; level < 9; level += 1) {
    levels[level] = cloneParagraphStyleDefaults(source?.levels[level] ?? baseDefault);
  }

  return {
    default: defaultStyle,
    levels
  };
}

function cloneParagraphStyleDefaults(source?: ParagraphStyleDefaults): ParagraphStyleDefaults {
  return {
    align: source?.align,
    bullet: cloneBulletStyle(source?.bullet),
    marginLeft: source?.marginLeft,
    indent: source?.indent,
    spaceBefore: source?.spaceBefore,
    spaceAfter: source?.spaceAfter,
    lineHeight: source?.lineHeight,
    lineHeightUnit: source?.lineHeightUnit,
    tabStops: source?.tabStops ? [...source.tabStops] : undefined,
    run: source?.run ? { ...source.run } : {}
  };
}

function stripParagraphLayoutDefaults(source?: ParagraphStyleDefaults): ParagraphStyleDefaults {
  return {
    run: source?.run ? { ...source.run } : {}
  };
}

function stripParagraphLayoutFromListStyleDefaults(source: ListStyleDefaults): ListStyleDefaults {
  const stripped: ListStyleDefaults = {
    default: stripParagraphLayoutDefaults(source.default),
    levels: {}
  };

  for (let level = 0; level < 9; level += 1) {
    stripped.levels[level] = stripParagraphLayoutDefaults(source.levels[level] ?? source.default);
  }

  return stripped;
}

function stripLineHeightFromListStyleDefaults(source: ListStyleDefaults): ListStyleDefaults {
  const listStyle = cloneListStyleDefaults(source);
  listStyle.default.lineHeight = undefined;
  listStyle.default.lineHeightUnit = undefined;

  for (let level = 0; level < 9; level += 1) {
    const style = listStyle.levels[level];
    if (!style) {
      continue;
    }

    style.lineHeight = undefined;
    style.lineHeightUnit = undefined;
  }

  return listStyle;
}

function createTableTextListStyle(
  baseListStyle: ListStyleDefaults,
  paragraphAlign?: TextParagraph['align']
): ListStyleDefaults {
  const listStyle = cloneListStyleDefaults(baseListStyle);
  if (!paragraphAlign) {
    return listStyle;
  }

  listStyle.default.align = paragraphAlign;

  for (let level = 0; level < 9; level += 1) {
    const style = listStyle.levels[level];
    if (!style) {
      continue;
    }

    style.align = paragraphAlign;
  }

  return listStyle;
}

function parseTextStyleRegistry(
  node: XmlRecord | undefined,
  context: ParseContext,
  baseRegistry: TextStyleRegistry = createTextStyleRegistry()
): TextStyleRegistry {
  if (!node) {
    return cloneTextStyleRegistry(baseRegistry);
  }

  return {
    textBox: cloneListStyleDefaults(baseRegistry.textBox),
    title: parseListStyleDefaults(node['p:titleStyle'] as XmlRecord | undefined, context, baseRegistry.title),
    body: parseListStyleDefaults(node['p:bodyStyle'] as XmlRecord | undefined, context, baseRegistry.body),
    other: parseListStyleDefaults(node['p:otherStyle'] as XmlRecord | undefined, context, baseRegistry.other)
  };
}

function resolveTextStyleDefaults(
  textStyles: TextStyleRegistry,
  placeholder: PlaceholderRef | undefined,
  isTextBox = false
): ListStyleDefaults {
  if (!placeholder && isTextBox) {
    return textStyles.textBox;
  }

  switch (placeholder?.type) {
    case 'title':
    case 'ctrTitle':
      return textStyles.title;
    case 'body':
    case 'obj':
    case 'subTitle':
      return textStyles.body;
    default:
      return stripParagraphLayoutFromListStyleDefaults(textStyles.other);
  }
}

function parseListStyleDefaults(
  node: XmlRecord | undefined,
  context: ParseContext,
  baseListStyle: ListStyleDefaults = cloneListStyleDefaults()
): ListStyleDefaults {
  if (!node) {
    return cloneListStyleDefaults(baseListStyle);
  }

  const localDefaults = parseParagraphStyleDefaults(node['a:defPPr'] as XmlRecord | undefined, context);
  const defaults = mergeParagraphStyleDefaults(
    cloneParagraphStyleDefaults(baseListStyle.default),
    localDefaults
  );
  const levels: ListStyleDefaults['levels'] = {};

  for (let level = 0; level < 9; level += 1) {
    const override = parseParagraphStyleDefaults(node[`a:lvl${level + 1}pPr`] as XmlRecord | undefined, context);
    const inheritedLevel = baseListStyle.levels[level] ?? baseListStyle.default;
    levels[level] = mergeParagraphStyleDefaults(
      mergeParagraphStyleDefaults(cloneParagraphStyleDefaults(inheritedLevel), cloneParagraphStyleDefaults(localDefaults)),
      override
    );
  }

  return {
    default: defaults,
    levels
  };
}

function parseParagraphStyleDefaults(node: XmlRecord | undefined, context: ParseContext): ParagraphStyleDefaults {
  return {
    align: normalizeAlignment(node?.algn),
    bullet: node?.['a:buNone'] !== undefined ? null : parseBullet(node, context),
    marginLeft: node?.marL != null ? emuToPx(toNumber(node.marL, 0)) : undefined,
    indent: node?.indent != null ? emuToPx(toNumber(node.indent, 0)) : undefined,
    spaceBefore: parseParagraphSpacing(node?.['a:spcBef']),
    spaceAfter: parseParagraphSpacing(node?.['a:spcAft']),
    ...parseLineSpacing(node?.['a:lnSpc']),
    tabStops: parseTabStops(node?.['a:tabLst'] as XmlRecord | undefined),
    run: parseRunStyle(node?.['a:defRPr'] as XmlRecord | undefined, context)
  };
}

function resolveParagraphStyleDefaults(listStyle: ListStyleDefaults, level: number): ParagraphStyleDefaults {
  return listStyle.levels[level] ?? listStyle.default;
}

function cloneBulletStyle(
  bullet: ParagraphStyleDefaults['bullet'] | TextParagraph['bullet'] | undefined
): ParagraphStyleDefaults['bullet'] | TextParagraph['bullet'] | undefined {
  return bullet && typeof bullet === 'object' ? { ...bullet } : bullet;
}

function mergeBulletStyle(
  base: ParagraphStyleDefaults['bullet'] | TextParagraph['bullet'] | undefined,
  current: ParagraphStyleDefaults['bullet'] | TextParagraph['bullet'] | undefined
): ParagraphStyleDefaults['bullet'] | TextParagraph['bullet'] | undefined {
  if (current === undefined) {
    return cloneBulletStyle(base);
  }

  if (current === null) {
    return null;
  }

  if (!base || base === null) {
    return { ...current };
  }

  return {
    char: current.char !== undefined ? current.char : current.autoType !== undefined ? undefined : base.char,
    autoType: current.autoType !== undefined ? current.autoType : current.char !== undefined ? undefined : base.autoType,
    startAt:
      current.autoType !== undefined
        ? current.startAt ?? base.startAt
        : current.char !== undefined
          ? undefined
          : current.startAt ?? base.startAt,
    fontFamily: current.fontFamily ?? base.fontFamily,
    color: current.color ?? base.color,
    colorAlpha: current.colorAlpha ?? base.colorAlpha
  };
}

function mergeParagraphStyleDefaults(base: ParagraphStyleDefaults, current: ParagraphStyleDefaults): ParagraphStyleDefaults {
  return {
    align: current.align ?? base.align,
    bullet: mergeBulletStyle(base.bullet, current.bullet),
    marginLeft: current.marginLeft ?? base.marginLeft,
    indent: current.indent ?? base.indent,
    spaceBefore: current.spaceBefore ?? base.spaceBefore,
    spaceAfter: current.spaceAfter ?? base.spaceAfter,
    lineHeight: current.lineHeight ?? base.lineHeight,
    lineHeightUnit: current.lineHeightUnit ?? base.lineHeightUnit,
    tabStops: current.tabStops ?? base.tabStops,
    run: mergeRunStyles(base.run, current.run)
  };
}

function emptyTextFrame(theme: ThemeModel, defaultRunStyle: TextRunStyle = {}, language?: string): TextFrame {
  return {
    paragraphs: [
      {
        runs: [
          {
            text: '',
            ...defaultRunStyle,
            fontFamily: defaultRunStyle.fontFamily ?? resolveThemeDefaultFont('minor', theme, language)
          }
        ]
      }
    ],
    verticalAlign: 'top',
    direction: 'horizontal',
    wrap: 'square',
    anchorCenter: false,
    horizontalOverflow: 'overflow',
    verticalOverflow: 'overflow',
    columns: 1,
    rtlColumns: false,
    fromWordArt: false,
    padding: {
      top: emuToPx(45720),
      right: emuToPx(91440),
      bottom: emuToPx(45720),
      left: emuToPx(91440)
    },
    autofit: {
      type: 'none'
    }
  };
}

function parseBackground(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  themeFormatScheme: ThemeFormatScheme,
  fillContext?: FillParseContext
): SlideBackground | undefined {
  const backgroundContainer = node?.['p:bg'] as XmlRecord | undefined;
  const backgroundNode = backgroundContainer?.['p:bgPr'] as XmlRecord | undefined;
  if (!backgroundNode) {
    const backgroundRef = backgroundContainer?.['p:bgRef'] as XmlRecord | undefined;
    if (!backgroundRef) {
      return undefined;
    }

    const styleFill = resolveFillReference(backgroundRef, theme, clrMap, themeFormatScheme);
    if (styleFill?.hasFill) {
      return styleFill.fill;
    }

    const color = parseColorValue(backgroundRef, theme, clrMap);
    return {
      type: 'solid',
      color: color.color,
      alpha: color.alpha
    };
  }

  const fillInfo = parseFillInfo(backgroundNode, theme, clrMap, undefined, fillContext);
  return fillInfo.fill.type === 'none'
    ? {
        type: 'solid',
        color: theme.colors.lt1
      }
    : fillInfo.fill;
}

function parseThemeFormatScheme(node: XmlRecord | undefined, orderedNode: OrderedXmlNode | undefined): ThemeFormatScheme {
  return {
    fills: parseThemeFillStyleEntries(
      node?.['a:fillStyleLst'] as XmlRecord | undefined,
      orderedNode ? getOrderedChild(orderedNode, 'a:fillStyleLst') : undefined
    ),
    backgroundFills: parseThemeFillStyleEntries(
      node?.['a:bgFillStyleLst'] as XmlRecord | undefined,
      orderedNode ? getOrderedChild(orderedNode, 'a:bgFillStyleLst') : undefined
    ),
    lines: parseThemeLineStyles(
      node?.['a:lnStyleLst'] as XmlRecord | undefined,
      orderedNode ? getOrderedChild(orderedNode, 'a:lnStyleLst') : undefined
    ),
    effects: parseThemeEffectStyles(
      node?.['a:effectStyleLst'] as XmlRecord | undefined,
      orderedNode ? getOrderedChild(orderedNode, 'a:effectStyleLst') : undefined
    )
  };
}

function parseThemeFillStyleEntries(node: XmlRecord | undefined, orderedNode: OrderedXmlNode | undefined): ThemeFillStyleEntry[] {
  const entries: ThemeFillStyleEntry[] = [];
  const counters: Record<ThemeFillStyleEntry['tag'], number> = {
    'a:solidFill': 0,
    'a:gradFill': 0,
    'a:noFill': 0,
    'a:pattFill': 0
  };

  for (const orderedEntry of orderedNode ?? []) {
    const [tag] = Object.keys(orderedEntry);
    if (tag !== 'a:solidFill' && tag !== 'a:gradFill' && tag !== 'a:noFill' && tag !== 'a:pattFill') {
      continue;
    }

    const list = asArray(node?.[tag]);
    const entry = list[counters[tag]];
    counters[tag] += 1;
    entries.push({
      tag,
      node: asXmlRecordNode(entry) ?? {}
    });
  }

  return entries;
}

function parseThemeLineStyles(node: XmlRecord | undefined, orderedNode: OrderedXmlNode | undefined): XmlRecord[] {
  const entries: XmlRecord[] = [];
  const lines = asArray(node?.['a:ln']);
  let index = 0;

  for (const orderedEntry of orderedNode ?? []) {
    if (!Object.prototype.hasOwnProperty.call(orderedEntry, 'a:ln')) {
      continue;
    }

    entries.push(asXmlRecordNode(lines[index]) ?? {});
    index += 1;
  }

  return entries;
}

function parseThemeEffectStyles(node: XmlRecord | undefined, orderedNode: OrderedXmlNode | undefined): XmlRecord[] {
  const entries: XmlRecord[] = [];
  const effects = asArray(node?.['a:effectStyle']);
  let index = 0;

  for (const orderedEntry of orderedNode ?? []) {
    if (!Object.prototype.hasOwnProperty.call(orderedEntry, 'a:effectStyle')) {
      continue;
    }

    entries.push(asXmlRecordNode(effects[index]) ?? {});
    index += 1;
  }

  if (!entries.length) {
    return effects.map((entry) => asXmlRecordNode(entry) ?? {});
  }

  return entries;
}

function resolveStyleFill(
  styleNode: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  themeFormatScheme: ThemeFormatScheme
): { fill: FillStyle; hasFill: boolean } | undefined {
  const fillRef = styleNode?.['a:fillRef'] as XmlRecord | undefined;
  return fillRef ? resolveFillReference(fillRef, theme, clrMap, themeFormatScheme) : undefined;
}

function resolveFillReference(
  refNode: XmlRecord,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  themeFormatScheme: ThemeFormatScheme
): { fill: FillStyle; hasFill: boolean } | undefined {
  const placeholderColor = parseColorValue(refNode, theme, clrMap);
  const idx = toNumber(refNode.idx, 0);
  const entries = idx >= 1001 ? themeFormatScheme.backgroundFills : themeFormatScheme.fills;
  const entryIndex = idx >= 1001 ? idx - 1001 : idx - 1;
  const styleEntry = entries[entryIndex];

  if (styleEntry) {
    const parsed = parseFillInfo({ [styleEntry.tag]: styleEntry.node }, theme, clrMap, placeholderColor);
    if (parsed.hasFill) {
      return parsed;
    }
  }

  return {
    fill: {
      type: 'solid',
      color: placeholderColor.color,
      alpha: placeholderColor.alpha
    },
    hasFill: true
  };
}

function resolveStyleLine(
  styleNode: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  themeFormatScheme: ThemeFormatScheme
): { line: LineStyle | undefined; hasLine: boolean } | undefined {
  const lineRef = styleNode?.['a:lnRef'] as XmlRecord | undefined;
  if (!lineRef) {
    return undefined;
  }

  const placeholderColor = parseColorValue(lineRef, theme, clrMap);
  const lineStyle = themeFormatScheme.lines[Math.max(0, toNumber(lineRef.idx, 1) - 1)];
  if (lineStyle) {
    const parsed = parseLineInfo(lineStyle, theme, clrMap, placeholderColor);
    if (parsed.hasLine) {
      return parsed;
    }
  }

  return {
    line: {
      color: placeholderColor.color,
      alpha: placeholderColor.alpha,
      width: 1
    },
    hasLine: true
  };
}

function resolveStyleEffect(
  styleNode: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  themeFormatScheme: ThemeFormatScheme
): ShadowStyle | undefined {
  const effectRef = styleNode?.['a:effectRef'] as XmlRecord | undefined;
  if (!effectRef) {
    return undefined;
  }

  const placeholderColor = parseColorValue(effectRef, theme, clrMap);
  const effectStyle = themeFormatScheme.effects[Math.max(0, toNumber(effectRef.idx, 0))];
  return effectStyle ? parseShadowInfo(effectStyle, theme, clrMap, placeholderColor) : undefined;
}

function normalizeShapeType(value: unknown): ShapeItem['shapeType'] {
  const raw = typeof value === 'string' ? value : 'rect';
  switch (raw) {
    case 'rect':
    case 'roundRect':
    case 'snip1Rect':
    case 'snip2SameRect':
    case 'snip2DiagRect':
    case 'snipRoundRect':
    case 'round1Rect':
    case 'round2SameRect':
    case 'round2DiagRect':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
    case 'rtTriangle':
    case 'parallelogram':
    case 'trapezoid':
    case 'octagon':
    case 'hexagon':
    case 'heptagon':
    case 'decagon':
    case 'dodecagon':
    case 'pentagon':
    case 'star5':
    case 'plaque':
    case 'can':
    case 'pie':
    case 'chord':
    case 'donut':
    case 'arc':
    case 'teardrop':
    case 'leftCircularArrow':
    case 'curvedRightArrow':
    case 'curvedLeftArrow':
    case 'curvedUpArrow':
    case 'curvedDownArrow':
    case 'smileyFace':
    case 'frame':
    case 'halfFrame':
    case 'corner':
    case 'diagStripe':
    case 'plus':
    case 'noSmoking':
    case 'bevel':
    case 'chevron':
    case 'cloud':
    case 'cube':
    case 'homePlate':
    case 'rightArrow':
    case 'stripedRightArrow':
    case 'notchedRightArrow':
    case 'leftArrow':
    case 'leftRightArrow':
    case 'upArrow':
    case 'downArrow':
    case 'upDownArrow':
    case 'quadArrow':
    case 'leftRightUpArrow':
    case 'bentArrow':
    case 'uturnArrow':
    case 'leftUpArrow':
    case 'bentUpArrow':
    case 'rightArrowCallout':
    case 'leftRightArrowCallout':
    case 'quadArrowCallout':
    case 'leftArrowCallout':
    case 'upArrowCallout':
    case 'line':
      return raw;
    default:
      return 'unknown';
  }
}

function normalizeAlignment(value: unknown): TextParagraph['align'] {
  if (value == null || value === '') {
    return undefined;
  }

  switch (value) {
    case 'ctr':
      return 'center';
    case 'r':
      return 'right';
    case 'just':
      return 'justify';
    default:
      return 'left';
  }
}

function normalizeAnchor(value: unknown): TextFrame['verticalAlign'] {
  switch (value) {
    case 'ctr':
    case 'mid':
      return 'middle';
    case 'b':
    case 'bot':
      return 'bottom';
    default:
      return 'top';
  }
}

function normalizeTextDirection(value: unknown): TextFrame['direction'] {
  switch (value) {
    case 'vert':
    case 'eaVert':
    case 'mongolianVert':
    case 'wordArtVert':
      return 'vertical';
    case 'vert270':
    case 'wordArtVertRtl':
      return 'vertical270';
    default:
      return 'horizontal';
  }
}

function resolveTableStyleDefinition(
  tableProps: XmlRecord | undefined,
  registry: TableStyleRegistry
): TableStyleDefinition | undefined {
  const styleId =
    (typeof tableProps?.['a:tableStyleId'] === 'string' ? String(tableProps['a:tableStyleId']) : undefined) ??
    registry.defaultStyleId;

  return styleId ? registry.styles[styleId] : undefined;
}

function resolveTableCellStyle(
  style: TableStyleDefinition | undefined,
  tableProps: XmlRecord | undefined,
  rowIndex: number,
  columnIndex: number,
  rowSpan: number,
  colSpan: number,
  rowCount: number,
  columnCount: number,
  context: Pick<ParseContext, 'theme' | 'colorMap'>,
  language?: string
): ResolvedTableStylePart {
  if (!style) {
    return {};
  }

  const firstRow = toBooleanFlag(tableProps?.firstRow);
  const lastRow = toBooleanFlag(tableProps?.lastRow);
  const firstCol = toBooleanFlag(tableProps?.firstCol);
  const lastCol = toBooleanFlag(tableProps?.lastCol);
  const bandRow = toBooleanFlag(tableProps?.bandRow);
  const bandCol = toBooleanFlag(tableProps?.bandCol);
  const rowEnd = Math.min(rowCount - 1, rowIndex + Math.max(rowSpan, 1) - 1);
  const columnEnd = Math.min(columnCount - 1, columnIndex + Math.max(colSpan, 1) - 1);

  let resolved = resolveTableStylePart(style.wholeTbl, context, language);

  if (bandRow && rowCount > 0) {
    const bandIndex = Math.max(0, rowIndex - (firstRow && rowIndex > 0 ? 1 : 0));
    resolved = mergeResolvedTableStyleParts(
      resolved,
      resolveTableStylePart(bandIndex % 2 === 0 ? style.band1H : style.band2H, context, language)
    );
  }

  if (bandCol && columnCount > 0) {
    const bandIndex = Math.max(0, columnIndex - (firstCol && columnIndex > 0 ? 1 : 0));
    resolved = mergeResolvedTableStyleParts(
      resolved,
      resolveTableStylePart(bandIndex % 2 === 0 ? style.band1V : style.band2V, context, language)
    );
  }

  if (firstRow && rowIndex === 0) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.firstRow, context, language));
  }
  if (lastRow && rowEnd === rowCount - 1) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.lastRow, context, language));
  }
  if (firstCol && columnIndex === 0) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.firstCol, context, language));
  }
  if (lastCol && columnEnd === columnCount - 1) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.lastCol, context, language));
  }

  if (rowIndex === 0 && columnIndex === 0) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.nwCell, context, language));
  }
  if (rowIndex === 0 && columnEnd === columnCount - 1) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.neCell, context, language));
  }
  if (rowEnd === rowCount - 1 && columnIndex === 0) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.swCell, context, language));
  }
  if (rowEnd === rowCount - 1 && columnEnd === columnCount - 1) {
    resolved = mergeResolvedTableStyleParts(resolved, resolveTableStylePart(style.seCell, context, language));
  }

  return resolved;
}

function resolveTableStylePart(
  node: XmlRecord | undefined,
  context: Pick<ParseContext, 'theme' | 'colorMap'>,
  language?: string
): ResolvedTableStylePart {
  if (!node) {
    return {};
  }

  const fillInfo = parseFillInfo(node['a:tcStyle']?.['a:fill'] as XmlRecord | undefined, context.theme, context.colorMap);
  return {
    fill: fillInfo.hasFill ? fillInfo.fill : undefined,
    borders: parseTableStyleBorders(node['a:tcStyle']?.['a:tcBdr'] as XmlRecord | undefined, context.theme, context.colorMap),
    textStyle: parseTableTextStyle(node['a:tcTxStyle'] as XmlRecord | undefined, context.theme, context.colorMap, language)
  };
}

function mergeResolvedTableStyleParts(
  base: ResolvedTableStylePart,
  current: ResolvedTableStylePart
): ResolvedTableStylePart {
  return {
    fill: current.fill ?? base.fill,
    borders: mergeTableStyleBorderBoxes(base.borders, current.borders),
    textStyle: current.textStyle
      ? {
          run: current.textStyle.run ? mergeRunStyles(base.textStyle?.run ?? {}, current.textStyle.run) : base.textStyle?.run,
          paragraphAlign: current.textStyle.paragraphAlign ?? base.textStyle?.paragraphAlign
        }
      : base.textStyle
  };
}

function parseTableTextStyle(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>,
  language?: string
): ResolvedTableStylePart['textStyle'] | undefined {
  if (!node) {
    return undefined;
  }

  const style: TextRunStyle = {};
  if (node.b != null) {
    style.bold = String(node.b) === '1' || String(node.b).toLowerCase() === 'on';
  }
  if (node.i != null) {
    style.italic = String(node.i) === '1' || String(node.i).toLowerCase() === 'on';
  }
  if (node.u != null) {
    style.underline = String(node.u) !== 'none' && String(node.u).toLowerCase() !== 'off';
  }
  if (node.sz != null) {
    style.fontSize = pointsToPx(toNumber(node.sz, 1800) / 100);
  }

  const fontRef = node['a:fontRef'] as XmlRecord | undefined;
  const fontIdx = typeof fontRef?.idx === 'string' ? String(fontRef.idx).trim().toLowerCase() : '';
  if (fontIdx === 'major') {
    style.fontFamily = resolveThemeDefaultFont('major', theme, language);
  } else if (fontIdx === 'minor') {
    style.fontFamily = resolveThemeDefaultFont('minor', theme, language);
  }

  if (node['a:srgbClr'] || node['a:schemeClr'] || node['a:sysClr']) {
    const color = parseColorValue(node, theme, clrMap);
    style.color = color.color;
    style.colorAlpha = color.alpha;
  }

  const paragraphAlign = normalizeAlignment(node.algn);
  if (!Object.keys(style).length && paragraphAlign == null) {
    return undefined;
  }

  return {
    run: Object.keys(style).length ? style : undefined,
    paragraphAlign
  };
}

function parseTableStyleBorders(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>
): TableStyleBorderBox | undefined {
  if (!node) {
    return undefined;
  }

  const borders: TableStyleBorderBox = {
    top: parseTableStyleBorderLine(node['a:top'] as XmlRecord | undefined, theme, clrMap),
    right: parseTableStyleBorderLine(node['a:right'] as XmlRecord | undefined, theme, clrMap),
    bottom: parseTableStyleBorderLine(node['a:bottom'] as XmlRecord | undefined, theme, clrMap),
    left: parseTableStyleBorderLine(node['a:left'] as XmlRecord | undefined, theme, clrMap),
    insideH: parseTableStyleBorderLine(node['a:insideH'] as XmlRecord | undefined, theme, clrMap),
    insideV: parseTableStyleBorderLine(node['a:insideV'] as XmlRecord | undefined, theme, clrMap)
  };

  return Object.values(borders).some(Boolean) ? borders : undefined;
}

function parseTableStyleBorderLine(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>
): LineStyle | undefined {
  return parseTableBorderLine(asXmlRecordNode(node?.['a:ln']) ?? node, theme, clrMap);
}

function mergeTableStyleBorderBoxes(
  base: TableStyleBorderBox | undefined,
  current: TableStyleBorderBox | undefined
): TableStyleBorderBox | undefined {
  if (!base) {
    return current;
  }
  if (!current) {
    return base;
  }

  return {
    top: current.top ?? base.top,
    right: current.right ?? base.right,
    bottom: current.bottom ?? base.bottom,
    left: current.left ?? base.left,
    insideH: current.insideH ?? base.insideH,
    insideV: current.insideV ?? base.insideV
  };
}

function materializeTableBorders(
  borders: TableStyleBorderBox | undefined,
  rowIndex: number,
  columnIndex: number,
  rowCount: number,
  columnCount: number
): TableCell['borders'] | undefined {
  if (!borders) {
    return undefined;
  }

  const resolved: TableCell['borders'] = {
    top: rowIndex === 0 ? (borders.top ?? borders.insideH) : (borders.insideH ?? borders.top),
    right: columnIndex === columnCount - 1 ? (borders.right ?? borders.insideV) : (borders.insideV ?? borders.right),
    bottom: rowIndex === rowCount - 1 ? (borders.bottom ?? borders.insideH) : (borders.insideH ?? borders.bottom),
    left: columnIndex === 0 ? (borders.left ?? borders.insideV) : (borders.insideV ?? borders.left)
  };

  return Object.values(resolved).some(Boolean) ? resolved : undefined;
}

function mergeTableBorders(
  base: TableCell['borders'] | undefined,
  current: TableCell['borders'] | undefined
): TableCell['borders'] | undefined {
  if (!base) {
    return current;
  }
  if (!current) {
    return base;
  }

  return {
    top: current.top ?? base.top,
    right: current.right ?? base.right,
    bottom: current.bottom ?? base.bottom,
    left: current.left ?? base.left
  };
}

function applyTextFrameDefaults(
  frame: TextFrame,
  defaults: TextRunStyle | undefined
): TextFrame {
  if (!defaults || !Object.keys(defaults).length) {
    return frame;
  }

  return {
    ...frame,
    paragraphs: frame.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({
        ...mergeRunStyles(defaults ?? {}, run),
        text: run.text
      }))
    }))
  };
}

function toBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function applyTableCellProperties(frame: TextFrame, cellProps: XmlRecord | undefined): TextFrame {
  if (!cellProps) {
    return frame;
  }

  const nextFrame = deepClone(frame);
  let touched = false;
  const paddingMap = [
    ['left', 'marL'],
    ['right', 'marR'],
    ['top', 'marT'],
    ['bottom', 'marB']
  ] as const;

  for (const [side, attr] of paddingMap) {
    if (cellProps[attr] == null) {
      continue;
    }

    nextFrame.padding[side] = emuToPx(toNumber(cellProps[attr], nextFrame.padding[side]));
    touched = true;
  }

  if (cellProps.anchor != null) {
    nextFrame.verticalAlign = normalizeAnchor(cellProps.anchor);
    touched = true;
  }

  return touched ? nextFrame : frame;
}

function applyTableCellTextFrameDefaults(frame: TextFrame, hasExplicitVerticalAlign: boolean): TextFrame {
  if (hasExplicitVerticalAlign || frame.verticalAlign !== 'top') {
    return frame;
  }

  return {
    ...frame,
    verticalAlign: 'middle'
  };
}

function parseTableCellBorders(
  cellProps: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>
): TableCell['borders'] {
  if (!cellProps) {
    return undefined;
  }

  const borders = {
    top: parseTableBorderLine(cellProps['a:lnT'], theme, clrMap),
    right: parseTableBorderLine(cellProps['a:lnR'], theme, clrMap),
    bottom: parseTableBorderLine(cellProps['a:lnB'], theme, clrMap),
    left: parseTableBorderLine(cellProps['a:lnL'], theme, clrMap)
  };

  return Object.values(borders).some(Boolean) ? borders : undefined;
}

function parseTableBorderLine(
  node: XmlRecord | undefined,
  theme: ThemeModel,
  clrMap: Record<string, string>
): LineStyle | undefined {
  if (!node) {
    return undefined;
  }

  const lineInfo = parseLineInfo(node, theme, clrMap);
  if (lineInfo.line) {
    return lineInfo.line;
  }

  if (lineInfo.hasLine) {
    return {
      width: 0,
      color: 'transparent'
    };
  }

  return undefined;
}

function parseHyperlink(
  node: XmlRecord | undefined,
  context: ParseContext
): Pick<TextRun, 'href' | 'slideIndex' | 'navigationAction'> {
  const navigationAction = parseNavigationAction(node?.action);
  const relId = node?.['r:id'];
  if (typeof relId !== 'string' || !relId) {
    return navigationAction ? { navigationAction } : {};
  }

  const relationship = context.relationships[relId];
  if (!relationship) {
    if (navigationAction) {
      return { navigationAction };
    }
    context.warnings.push(`Missing hyperlink relationship ${relId} in ${context.slidePath}.`);
    return {};
  }

  if (relationship.type === REL_TYPES.hyperlink) {
    return {
      href: relationship.target
    };
  }

  if (relationship.type === REL_TYPES.slide) {
    const slideIndex = context.slideIndexByPath[relationship.target];
    if (slideIndex == null) {
      context.warnings.push(`Missing target slide ${relationship.target} for hyperlink ${relId}.`);
      return {};
    }

    return {
      slideIndex
    };
  }

  return navigationAction ? { navigationAction } : {};
}

function parseNavigationAction(value: unknown): TextRun['navigationAction'] {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/[?&]jump=([^&]+)/);
  switch (match?.[1]) {
    case 'nextslide':
      return 'next';
    case 'previousslide':
      return 'previous';
    case 'firstslide':
      return 'first';
    case 'lastslide':
      return 'last';
    case 'lastslideviewed':
      return 'lastViewed';
    default:
      return undefined;
  }
}

function normalizeLineEndType(value: unknown): LineStyle['headEnd'] {
  switch (value) {
    case 'triangle':
    case 'stealth':
    case 'diamond':
    case 'oval':
    case 'arrow':
      return value;
    default:
      return undefined;
  }
}

function normalizeLineCap(value: unknown): LineStyle['lineCap'] {
  switch (value) {
    case 'rnd':
      return 'round';
    case 'sq':
      return 'square';
    case 'flat':
      return 'butt';
    default:
      return undefined;
  }
}

function normalizeLineCompound(value: unknown): LineStyle['compound'] {
  switch (value) {
    case 'dbl':
      return 'double';
    case 'thickThin':
      return 'thickThin';
    case 'thinThick':
      return 'thinThick';
    case 'tri':
      return 'triple';
    case 'sng':
      return 'single';
    default:
      return undefined;
  }
}

function normalizeLineJoin(node: XmlRecord | undefined): LineStyle['lineJoin'] {
  if (!node) {
    return undefined;
  }

  if (node['a:round'] !== undefined) {
    return 'round';
  }
  if (node['a:bevel'] !== undefined) {
    return 'bevel';
  }
  if (node['a:miter'] !== undefined) {
    return 'miter';
  }

  return undefined;
}

function parseLineMiterLimit(node: XmlRecord | undefined): number | undefined {
  const limit = asXmlRecordNode(node?.['a:miter'])?.lim;
  if (limit == null) {
    return undefined;
  }

  const normalized = toNumber(limit, 0) / 100000;
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
}

function parseBullet(paragraphProps: XmlRecord | undefined, context: Pick<ParseContext, 'theme' | 'colorMap'>): TextParagraph['bullet'] {
  if (!paragraphProps || paragraphProps['a:buNone'] !== undefined) {
    return undefined;
  }

  const bulletFont = paragraphProps['a:buFont'] as XmlRecord | undefined;
  const fontFamily =
    typeof bulletFont?.typeface === 'string' && bulletFont.typeface.trim().length
      ? resolveThemeFontFamily(String(bulletFont.typeface), context.theme)
      : undefined;
  const bulletColorNode = paragraphProps['a:buClr'] as XmlRecord | undefined;
  const bulletColor = bulletColorNode ? parseColorValue(bulletColorNode, context.theme, context.colorMap) : undefined;
  const bulletChar = paragraphProps['a:buChar']?.char;
  if (typeof bulletChar === 'string' && bulletChar.trim().length > 0) {
    return {
      char: decodeXmlEntities(bulletChar),
      fontFamily,
      color: bulletColor?.color,
      colorAlpha: bulletColor?.alpha
    };
  }

  const autoNumberNode = paragraphProps['a:buAutoNum'] as XmlRecord | undefined;
  if (autoNumberNode?.type) {
    return {
      autoType: String(autoNumberNode.type),
      startAt: Math.max(1, toNumber(autoNumberNode.startAt, 1)),
      fontFamily,
      color: bulletColor?.color,
      colorAlpha: bulletColor?.alpha
    };
  }

  return undefined;
}

function inferLanguageFromText(text: string): string | undefined {
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return 'zh-CN';
  }
  if (/[\u3040-\u30FF]/.test(text)) {
    return 'ja-JP';
  }
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) {
    return 'ko-KR';
  }

  return undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => String.fromCodePoint(parseInt(codePoint, 16)))
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(parseInt(codePoint, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isExternalTarget(target: string, targetMode?: string): boolean {
  return targetMode === 'External' || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function parseParagraphSpacing(node: XmlRecord | undefined): number | undefined {
  if (!node) {
    return undefined;
  }

  if (node['a:spcPts']?.val != null) {
    return pointsToPx(toNumber(node['a:spcPts'].val, 0) / 100);
  }

  return undefined;
}

function parseTabStops(node: XmlRecord | undefined): number[] | undefined {
  if (!node) {
    return undefined;
  }

  const stops = asArray(node['a:tab'])
    .map((entry) => emuToPx(toNumber(entry?.pos, NaN)))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  return stops.length ? stops : [];
}

function parseLineSpacing(
  node: XmlRecord | undefined
): Pick<TextParagraph, 'lineHeight' | 'lineHeightUnit'> {
  if (!node) {
    return {};
  }

  if (node['a:spcPct']?.val != null) {
    return {
      lineHeight: toNumber(node['a:spcPct'].val, 100000) / 100000,
      lineHeightUnit: 'multiple'
    };
  }

  if (node['a:spcPts']?.val != null) {
    return {
      lineHeight: pointsToPx(toNumber(node['a:spcPts'].val, 0) / 100),
      lineHeightUnit: 'px'
    };
  }

  return {};
}

function pointsToPx(points: number): number {
  return Number(((points * 96) / 72).toFixed(3));
}

function getNodeOrder(node: XmlRecord, orderedNodeOrders?: Map<string, number>): number {
  const nodeId = getDrawingNodeId(node);
  const orderedNodeOrder = nodeId ? orderedNodeOrders?.get(nodeId) : undefined;
  if (orderedNodeOrder != null) {
    return orderedNodeOrder;
  }

  return nodeId != null ? toNumber(nodeId, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
}

function getName(node: XmlRecord, path: string[]): string | undefined {
  let current: any = node;
  for (const key of path) {
    current = current?.[key];
  }
  return typeof current?.name === 'string' ? current.name : undefined;
}

function getShapeNodeId(node: XmlRecord): string | undefined {
  const id = node['p:nvSpPr']?.['p:cNvPr']?.id;
  return id != null ? String(id) : undefined;
}

function getDrawingNodeId(node: XmlRecord): string | undefined {
  return (
    getNodeIdByNvPath(node, ['p:nvSpPr', 'p:cNvPr']) ??
    getNodeIdByNvPath(node, ['p:nvPicPr', 'p:cNvPr']) ??
    getNodeIdByNvPath(node, ['p:nvGraphicFramePr', 'p:cNvPr']) ??
    getNodeIdByNvPath(node, ['p:nvCxnSpPr', 'p:cNvPr']) ??
    getNodeIdByNvPath(node, ['p:nvGrpSpPr', 'p:cNvPr'])
  );
}

function getNodeIdByNvPath(node: XmlRecord, path: string[]): string | undefined {
  let current: any = node;
  for (const key of path) {
    current = current?.[key];
  }

  return current?.id != null ? String(current.id) : undefined;
}

function extractPlaceholder(node: XmlRecord | undefined): PlaceholderRef | undefined {
  const ph = node?.['p:ph'] as XmlRecord | undefined;
  if (!ph) {
    return undefined;
  }

  return {
    type: typeof ph.type === 'string' ? ph.type : undefined,
    idx: ph.idx != null ? String(ph.idx) : undefined
  };
}

function getPlaceholderKey(placeholder: PlaceholderRef): string {
  return `${normalizePlaceholderKeyType(placeholder.type)}:${placeholder.idx ?? ''}`;
}

function resolvePlaceholderDraft(
  placeholders: Map<string, SlideItemDraft> | undefined,
  placeholder: PlaceholderRef | undefined
): SlideItemDraft | undefined {
  if (!placeholders || !placeholder) {
    return undefined;
  }

  for (const key of getPlaceholderLookupKeys(placeholder)) {
    const draft = placeholders.get(key);
    if (draft) {
      return draft;
    }
  }

  return undefined;
}

function placeholderHasMeaningfulFontDefaults(
  placeholderDraft: SlideItemDraft | undefined,
  theme: ThemeModel
): boolean {
  const frame = placeholderDraft ? getItemTextFrame(placeholderDraft.item) : undefined;
  if (!frame) {
    return false;
  }

  for (const paragraph of frame.paragraphs) {
    for (const run of paragraph.runs) {
      const fontFamily = run.fontFamily?.trim();
      if (!fontFamily) {
        continue;
      }

      if (fontFamily !== theme.fonts.minor && fontFamily !== theme.fonts.major) {
        return true;
      }
    }
  }

  return false;
}

function getPlaceholderLookupKeys(placeholder: PlaceholderRef): string[] {
  const exactKey = getPlaceholderKey(placeholder);
  const idx = placeholder.idx;
  const type = normalizePlaceholderKeyType(placeholder.type);
  const compatibleTypes = [type];

  if (type === 'ctrTitle') {
    compatibleTypes.push('title');
  } else if (type === 'title') {
    compatibleTypes.push('ctrTitle');
  } else if (type === 'obj') {
    compatibleTypes.push('body');
  } else if (type === 'body') {
    compatibleTypes.push('obj');
  }

  const keys = new Set<string>([exactKey]);
  for (const compatibleType of compatibleTypes) {
    keys.add(getPlaceholderKey({ type: compatibleType, idx }));
  }

  return [...keys];
}

function normalizePlaceholderKeyType(type: string | undefined): string {
  switch (type) {
    case 'ctrTitle':
      return 'title';
    case 'obj':
      return 'body';
    default:
      return type ?? 'body';
  }
}

function mergeDraft(base: SlideItemDraft | undefined, current: SlideItemDraft): SlideItemDraft {
  if (!base) {
    return current;
  }

  const merged = deepClone(current);
  const baseTextFrame = getItemTextFrame(base.item);
  const currentTextFrame = getItemTextFrame(merged.item);
  if (!merged.hasTransform) {
    merged.item.transform = deepClone(base.item.transform);
  }

  if (!merged.hasFill && base.item.fill) {
    merged.item.fill = deepClone(base.item.fill);
  }

  if (!merged.hasLine && 'line' in base.item && base.item.line) {
    merged.item.line = deepClone(base.item.line);
  }

  if (!merged.item.name) {
    merged.item.name = base.item.name;
  }

  if (!merged.item.placeholder && base.item.placeholder) {
    merged.item.placeholder = deepClone(base.item.placeholder);
  }

  if (!merged.hasText) {
    if (
      baseTextFrame &&
      currentTextFrame &&
      !isPlaceholderPromptItem(base.item) &&
      !isGenericTemplatePlaceholderPromptItem(base.item) &&
      !isMasterStylePlaceholderPromptItem(base.item)
    ) {
      setItemTextFrame(merged.item, mergeTextFrameStyles(baseTextFrame, currentTextFrame, merged.textFrameStyleFlags));
    } else if (
      baseTextFrame &&
      !currentTextFrame &&
      !isPlaceholderPromptItem(base.item) &&
      !isGenericTemplatePlaceholderPromptItem(base.item) &&
      !isMasterStylePlaceholderPromptItem(base.item)
    ) {
      setItemTextFrame(merged.item, deepClone(baseTextFrame));
    }
  } else {
    if (baseTextFrame && currentTextFrame) {
      setItemTextFrame(merged.item, mergeTextFrameStyles(baseTextFrame, currentTextFrame, merged.textFrameStyleFlags));
    }
  }

  if (merged.item.kind === 'shape' && base.item.kind === 'shape' && !merged.item.geometry && base.item.geometry) {
    merged.item.geometry = deepClone(base.item.geometry);
  }

  return merged;
}

function getItemTextFrame(item: SlideItem): TextFrame | undefined {
  if (item.kind === 'text' || item.kind === 'shape') {
    return item.textFrame;
  }

  return undefined;
}

function setItemTextFrame(item: SlideItem, frame: TextFrame): void {
  if (item.kind === 'text' || item.kind === 'shape') {
    item.textFrame = frame;
  }
}

function mergeTextFrameStyles(
  base: TextFrame | undefined,
  current: TextFrame,
  styleFlags: TextFrameStyleFlags | undefined
): TextFrame {
  if (!base?.paragraphs.length) {
    return current;
  }

  const merged = deepClone(current);
  if (!styleFlags?.verticalAlign) {
    merged.verticalAlign = base.verticalAlign;
  }
  if (!styleFlags?.direction) {
    merged.direction = base.direction ?? 'horizontal';
  }
  if (!styleFlags?.wrap) {
    merged.wrap = base.wrap ?? 'square';
  }
  if (!styleFlags?.anchorCenter) {
    merged.anchorCenter = base.anchorCenter ?? false;
  }
  merged.horizontalOverflow = current.horizontalOverflow ?? base.horizontalOverflow ?? 'overflow';
  merged.verticalOverflow = current.verticalOverflow ?? base.verticalOverflow ?? 'overflow';
  merged.columns = current.columns ?? base.columns ?? 1;
  merged.columnSpacing = current.columnSpacing ?? base.columnSpacing;
  merged.rtlColumns = current.rtlColumns ?? base.rtlColumns ?? false;
  merged.fromWordArt = current.fromWordArt ?? base.fromWordArt ?? false;
  if (!styleFlags?.padding.top) {
    merged.padding.top = base.padding.top;
  }
  if (!styleFlags?.padding.right) {
    merged.padding.right = base.padding.right;
  }
  if (!styleFlags?.padding.bottom) {
    merged.padding.bottom = base.padding.bottom;
  }
  if (!styleFlags?.padding.left) {
    merged.padding.left = base.padding.left;
  }
  merged.autofit = current.autofit ?? base.autofit;
  merged.paragraphs = current.paragraphs.map((paragraph, index) =>
    mergeParagraphStyles(selectFallback(base.paragraphs, index), paragraph)
  );
  return merged;
}

function mergeParagraphStyles(
  base: TextFrame['paragraphs'][number] | undefined,
  current: TextFrame['paragraphs'][number]
): TextFrame['paragraphs'][number] {
  if (!base) {
    return current;
  }

  return {
    ...current,
    level: current.level ?? base.level,
    bullet: current.bulletDisabled ? undefined : (mergeBulletStyle(base.bullet, current.bullet) ?? undefined),
    bulletDisabled: current.bulletDisabled || undefined,
    align: current.align ?? base.align,
    marginLeft: current.marginLeft ?? base.marginLeft,
    indent: current.indent ?? base.indent,
    spaceBefore: current.spaceBefore ?? base.spaceBefore,
    spaceAfter: current.spaceAfter ?? base.spaceAfter,
    lineHeight: current.lineHeight ?? base.lineHeight,
    lineHeightUnit: current.lineHeightUnit ?? base.lineHeightUnit,
    runs: current.runs.map((run, index) => mergeRunStylesFromBase(selectFallback(base.runs, index), run))
  };
}

function mergeRunStylesFromBase(base: TextRun | undefined, current: TextRun): TextRun {
  if (!base) {
    return current;
  }

  const color = mergeOptionalColorPair(base.color, base.colorAlpha, current.color, current.colorAlpha);
  const highlight = mergeOptionalColorPair(
    base.highlightColor,
    base.highlightAlpha,
    current.highlightColor,
    current.highlightAlpha
  );

  return {
    ...current,
    bold: current.bold ?? base.bold,
    italic: current.italic ?? base.italic,
    underline: current.underline ?? base.underline,
    strike: current.strike ?? base.strike,
    color: color.color,
    colorAlpha: color.alpha,
    highlightColor: highlight.color,
    highlightAlpha: highlight.alpha,
    fontSize: current.fontSize ?? base.fontSize,
    fontFamily: current.fontFamily ?? base.fontFamily,
    baselineShift: current.baselineShift ?? base.baselineShift
  };
}

function mergeOptionalColorPair(
  baseColor: string | undefined,
  baseAlpha: number | undefined,
  currentColor: string | undefined,
  currentAlpha: number | undefined
): { color: string | undefined; alpha: number | undefined } {
  if (currentColor !== undefined) {
    return {
      color: currentColor,
      alpha: currentAlpha
    };
  }

  if (currentAlpha !== undefined) {
    return {
      color: baseColor,
      alpha: currentAlpha
    };
  }

  return {
    color: baseColor,
    alpha: baseAlpha
  };
}

function selectFallback<T>(items: T[], index: number): T | undefined {
  return items[index] ?? items[items.length - 1] ?? items[0];
}

function createTextFrameStyleFlags(): TextFrameStyleFlags {
  return {
    verticalAlign: false,
    direction: false,
    wrap: false,
    anchorCenter: false,
    padding: {
      top: false,
      right: false,
      bottom: false,
      left: false
    }
  };
}

function normalizeTextWrap(value: unknown): TextFrame['wrap'] {
  return String(value).trim().toLowerCase() === 'none' ? 'none' : 'square';
}

function normalizeTextOverflow(value: unknown): TextFrame['horizontalOverflow'] {
  return String(value).trim().toLowerCase() === 'clip' ? 'clip' : 'overflow';
}

function collectUnsupportedTextFrameWarnings(
  bodyPr: XmlRecord | undefined,
  context: Pick<ParseContext, 'warnings' | 'slidePath'>
): void {
  if (!bodyPr) {
    return;
  }

  if (toBooleanFlag(bodyPr.rtlCol)) {
    context.warnings.push(`Text columns with rtlCol are not fully supported in ${context.slidePath}.`);
  }
  if (toBooleanFlag(bodyPr.fromWordArt)) {
    context.warnings.push(`WordArt text behavior is not fully supported in ${context.slidePath}.`);
  }

  const numCol = Math.max(1, toNumber(bodyPr.numCol, 1));
  if (numCol > 1) {
    context.warnings.push(`Multi-column text (numCol=${numCol}) is not fully supported in ${context.slidePath}.`);
  }
}

function asXmlRecordNode(value: unknown): XmlRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as XmlRecord) : undefined;
}

function hasTextFrame(frame: TextFrame | undefined): boolean {
  return Boolean(
    frame?.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim().length > 0))
  );
}

function hasRenderableText(item: SlideItem): boolean {
  if (item.kind === 'text') {
    return hasTextFrame(item.textFrame);
  }
  if (item.kind === 'shape') {
    return hasTextFrame(item.textFrame);
  }
  if (item.kind === 'table') {
    return item.cells.some((cell) => hasTextFrame(cell.textFrame));
  }
  return false;
}

function applyThemeScriptFontFallbacksToItems(items: SlideItem[], theme: ThemeModel): void {
  for (const item of items) {
    if ((item.kind === 'text' || item.kind === 'shape') && item.textFrame) {
      applyThemeScriptFontFallbacks(item.textFrame, theme);
      continue;
    }

    if (item.kind === 'table') {
      for (const cell of item.cells) {
        applyThemeScriptFontFallbacks(cell.textFrame, theme);
      }
    }
  }
}

function applyThemeScriptFontFallbacks(frame: TextFrame, theme: ThemeModel): void {
  for (const paragraph of frame.paragraphs) {
    for (const run of paragraph.runs) {
      const fontFamily = run.fontFamily?.trim();
      const language = inferLanguageFromText(run.text);
      if (!fontFamily || !language) {
        continue;
      }

      if (fontFamily === theme.fonts.major) {
        run.fontFamily = resolveThemeDefaultFont('major', theme, language);
      } else if (fontFamily === theme.fonts.minor) {
        run.fontFamily = resolveThemeDefaultFont('minor', theme, language);
      }
    }
  }
}

function resolveRuntimePlaceholderFields(items: SlideItem[], slideIndex: number): void {
  const slideNumber = String(slideIndex + 1);

  for (const item of items) {
    if ((item.kind !== 'text' && item.kind !== 'shape') || !item.placeholder || !item.textFrame) {
      continue;
    }

    if (item.placeholder.type !== 'sldNum') {
      continue;
    }

    const visibleText = item.textFrame.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
      .filter(Boolean)
      .join('');

    if (!isSlideNumberPlaceholderText(visibleText)) {
      continue;
    }

    const targetParagraph = item.textFrame.paragraphs.find((paragraph) => paragraph.runs.length);
    if (!targetParagraph) {
      continue;
    }

    let replaced = false;
    targetParagraph.runs = targetParagraph.runs.map((run) => {
      if (!replaced) {
        replaced = true;
        return {
          ...run,
          text: slideNumber
        };
      }

      return {
        ...run,
        text: ''
      };
    });
  }
}

function isSlideNumberPlaceholderText(text: string): boolean {
  if (!text) {
    return true;
  }

  const normalized = text.replace(/[\s<#>‹›《》〔〕\[\]\(\)\{\}-]/g, '');
  return normalized.length === 0 || /^sldnum$/i.test(normalized);
}

function isHiddenFooterPlaceholderItem(item: SlideItem): boolean {
  if ((item.kind !== 'text' && item.kind !== 'shape') || !item.placeholder) {
    return false;
  }

  return (
    item.placeholder.type === 'dt' ||
    item.placeholder.type === 'ftr' ||
    item.placeholder.type === 'hdr'
  );
}

function isMetadataPlaceholderItem(item: SlideItem): boolean {
  if ((item.kind !== 'text' && item.kind !== 'shape') || !item.placeholder) {
    return false;
  }

  return (
    item.placeholder.type === 'dt' ||
    item.placeholder.type === 'sldNum' ||
    item.placeholder.type === 'ftr' ||
    item.placeholder.type === 'hdr'
  );
}

function isPlaceholderPromptItem(item: SlideItem): boolean {
  if ((item.kind !== 'text' && item.kind !== 'shape') || !item.placeholder || !hasTextFrame(item.textFrame)) {
    return false;
  }

  const placeholderType = item.placeholder.type;
  if (placeholderType === 'dt' || placeholderType === 'sldNum' || placeholderType === 'ftr' || placeholderType === 'hdr') {
    return false;
  }

  const firstParagraphText =
    item.textFrame?.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
      .find(Boolean) ?? '';

  return (
    /^(?:click|tap)\s+to\s+(?:edit|add)\b/i.test(firstParagraphText) ||
    /^(?:单击|点击)\s*此处(?:以)?(?:编辑|添加)/.test(firstParagraphText)
  );
}

function isGenericTemplatePlaceholderPromptItem(item: SlideItem): boolean {
  if ((item.kind !== 'text' && item.kind !== 'shape') || !item.placeholder || !hasTextFrame(item.textFrame)) {
    return false;
  }

  const placeholderType = item.placeholder.type;
  if (placeholderType === 'dt' || placeholderType === 'sldNum' || placeholderType === 'ftr' || placeholderType === 'hdr') {
    return false;
  }

  const firstParagraphText =
    item.textFrame?.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
      .find(Boolean)
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';

  return (
    /^(?:标题|副标题)\s*文本$/u.test(firstParagraphText) ||
    /^(?:Title|Subtitle)\s+Text$/i.test(firstParagraphText) ||
    /^(?:正文|文本)\s*级别\s*\d+$/u.test(firstParagraphText) ||
    /^(?:Body|Text)\s+Level\s*\d+$/i.test(firstParagraphText)
  );
}

function isMasterStylePlaceholderPromptItem(item: SlideItem): boolean {
  if ((item.kind !== 'text' && item.kind !== 'shape') || !item.placeholder || !hasTextFrame(item.textFrame)) {
    return false;
  }

  const placeholderType = item.placeholder.type;
  if (placeholderType === 'dt' || placeholderType === 'sldNum' || placeholderType === 'ftr' || placeholderType === 'hdr') {
    return false;
  }

  const normalizedParagraphTexts = (item.textFrame?.paragraphs ?? [])
    .map((paragraph) => paragraph.runs.map((run) => run.text).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const firstParagraphText = normalizedParagraphTexts[0] ?? '';
  if (/^编[辑輯]母版(?:标题|副标题|文本)样式$/u.test(firstParagraphText)) {
    return true;
  }

  return (
    normalizedParagraphTexts.length >= 2 &&
    /^编[辑輯]母版(?:标题|副标题|文本)样式$/u.test(firstParagraphText) &&
    normalizedParagraphTexts.slice(1).every((text, index) => text === `第${index + 2}级`)
  );
}

function extractFirstText(items: SlideItem[]): string | undefined {
  for (const item of items) {
    if (isMetadataPlaceholderItem(item)) {
      continue;
    }

    if (item.kind === 'text' || item.kind === 'shape') {
      for (const paragraph of item.textFrame?.paragraphs ?? []) {
        const text = paragraph.runs.map((run) => run.text).join('').trim();
        if (text) {
          return text;
        }
      }
    }

    if (item.kind === 'table') {
      for (const cell of item.cells) {
        for (const paragraph of cell.textFrame.paragraphs) {
          const text = paragraph.runs.map((run) => run.text).join('').trim();
          if (text) {
            return text;
          }
        }
      }
    }
  }

  return undefined;
}

function toRelationshipPath(partPath: string): string {
  const parts = partPath.split('/');
  const fileName = parts.pop();
  return `${parts.join('/')}/_rels/${fileName}.rels`;
}

function resolveEmbeddedMediaSource(
  nvPr: XmlRecord | undefined,
  context: Pick<ParseContext, 'relationships' | 'warnings' | 'slidePath'>,
  itemName: string
): { mediaType: MediaItem['mediaType']; mediaId: string } | undefined {
  if (!nvPr) {
    return undefined;
  }

  const videoRelId = typeof nvPr['a:videoFile']?.['r:link'] === 'string' ? String(nvPr['a:videoFile']['r:link']) : undefined;
  const audioRelId = typeof nvPr['a:audioFile']?.['r:link'] === 'string' ? String(nvPr['a:audioFile']['r:link']) : undefined;
  const embeddedRelId = extractEmbeddedMediaRelationshipId(nvPr);
  const explicitMediaType: MediaItem['mediaType'] | undefined = videoRelId
    ? 'video'
    : audioRelId
      ? 'audio'
      : undefined;

  if (!videoRelId && !audioRelId && !embeddedRelId) {
    return undefined;
  }

  const primaryRelId = embeddedRelId ?? videoRelId ?? audioRelId;
  const primaryExpectedTypes = explicitMediaType
    ? [REL_TYPES.media, explicitMediaType === 'video' ? REL_TYPES.video : REL_TYPES.audio]
    : [REL_TYPES.media, REL_TYPES.video, REL_TYPES.audio];
  const primaryTarget = resolveInternalRelationshipTarget(primaryRelId, primaryExpectedTypes, context, `media for ${itemName}`);
  if (primaryTarget) {
    return {
      mediaType: explicitMediaType ?? inferMediaTypeFromPath(primaryTarget),
      mediaId: primaryTarget
    };
  }

  const fallbackRelId = explicitMediaType === 'video' ? videoRelId : explicitMediaType === 'audio' ? audioRelId : undefined;
  const fallbackExpectedTypes = explicitMediaType === 'video' ? [REL_TYPES.video] : explicitMediaType === 'audio' ? [REL_TYPES.audio] : [];
  const fallbackTarget =
    fallbackRelId && fallbackRelId !== primaryRelId
      ? resolveInternalRelationshipTarget(fallbackRelId, fallbackExpectedTypes, context, `${explicitMediaType ?? 'media'} for ${itemName}`)
      : undefined;

  if (!fallbackTarget) {
    return undefined;
  }

  return {
    mediaType: explicitMediaType ?? inferMediaTypeFromPath(fallbackTarget),
    mediaId: fallbackTarget
  };
}

function extractEmbeddedMediaRelationshipId(nvPr: XmlRecord | undefined): string | undefined {
  if (!nvPr) {
    return undefined;
  }

  for (const ext of asArray(nvPr['p:extLst']?.['p:ext'])) {
    const mediaNode = asXmlRecordNode(ext?.['p14:media']);
    if (typeof mediaNode?.['r:embed'] === 'string' && mediaNode['r:embed']) {
      return String(mediaNode['r:embed']);
    }
  }

  return undefined;
}

function resolveInternalRelationshipTarget(
  relId: string | undefined,
  expectedTypes: string[],
  context: Pick<ParseContext, 'relationships' | 'warnings' | 'slidePath'>,
  label: string
): string | undefined {
  if (!relId) {
    return undefined;
  }

  const relationship = context.relationships[relId];
  if (!relationship) {
    context.warnings.push(`Missing relationship ${relId} for ${label} in ${context.slidePath}.`);
    return undefined;
  }

  if (relationship.targetMode === 'External') {
    context.warnings.push(`External ${label} is not supported in ${context.slidePath}.`);
    return undefined;
  }

  if (expectedTypes.length > 0 && !expectedTypes.includes(relationship.type)) {
    context.warnings.push(`Unsupported relationship type for ${label} in ${context.slidePath}: ${relationship.type}.`);
    return undefined;
  }

  return relationship.target;
}

function inferMediaTypeFromPath(mediaPath: string): MediaItem['mediaType'] {
  const extension = (mediaPath.split('.').pop() ?? '').toLowerCase();
  switch (extension) {
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'aac':
    case 'oga':
    case 'ogg':
    case 'flac':
      return 'audio';
    default:
      return 'video';
  }
}

function relationshipSourcePath(relPath: string): string {
  if (relPath === '_rels/.rels') {
    return 'package-root.xml';
  }

  const parts = relPath.split('/');
  const fileName = parts.pop() ?? '';
  const relsFolder = parts.pop();
  if (relsFolder !== '_rels') {
    return relPath;
  }

  return [...parts, fileName.replace(/\.rels$/, '')].join('/');
}

function collectItemMediaIds(item: SlideItem, target: Set<string>): void {
  if (item.kind === 'image' && item.mediaId) {
    target.add(item.mediaId);
  }
  if (item.kind === 'media') {
    if (item.mediaId) {
      target.add(item.mediaId);
    }
    if (item.posterMediaId) {
      target.add(item.posterMediaId);
    }
  }

  collectPictureFillMediaIds(item.fill, target);

  if (item.kind === 'table') {
    for (const cell of item.cells) {
      collectPictureFillMediaIds(cell.fill, target);
    }
  }
}

function collectPictureFillMediaIds(fill: FillStyle | undefined, target: Set<string>): void {
  if (fill?.type === 'picture' && fill.mediaId) {
    target.add(fill.mediaId);
  }
}

async function loadMediaAsset(zip: JSZip, mediaPath: string, contentTypes: ContentTypes, caches: ParseCaches): Promise<void> {
  if (caches.media[mediaPath]?.data?.length) {
    return;
  }
  const file = zip.file(mediaPath);
  if (!file) {
    return;
  }

  const data = await file.async('uint8array');
  caches.media[mediaPath] = {
    id: mediaPath,
    path: mediaPath,
    contentType: getContentTypeForPart(mediaPath, contentTypes),
    data
  };
}

function extractItemText(item: SlideItem | undefined): string | undefined {
  if (!item) {
    return undefined;
  }

  if (item.kind === 'text' || item.kind === 'shape') {
    return item.textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(' ').trim();
  }

  if (item.kind === 'table') {
    return item.cells
      .flatMap((cell) => cell.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')))
      .join(' ')
      .trim();
  }

  return undefined;
}

function getContentTypeForPart(partPath: string, contentTypes: ContentTypes): string {
  const override = contentTypes.overrides[partPath];
  if (override) {
    return override;
  }

  const extension = partPath.split('.').pop() ?? '';
  return contentTypes.defaults[extension] ?? 'application/octet-stream';
}
