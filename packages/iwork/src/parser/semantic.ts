import type {
  FillStyle,
  ItemTransform,
  ParsedPresentation,
  SlideItem,
  SlideModel,
  TableItem,
  TextFrame,
  TextParagraph,
  ThemeModel
} from '@filens/core';
import type {
  IworkArchiveIndex,
  IworkArchiveRecord,
  IworkCanvasModel,
  IworkImageAsset,
  PagesBodyBlock,
  ParsedIworkDocument,
  ParsedKeynoteDocument,
  ParsedNumbersDocument,
  ParsedNumbersSheet,
  ParsedPagesDocument,
  ParsedPagesPage
} from '../types';
import { buildTableItem } from './table';
import {
  asArray,
  asObject,
  buildTextFrameFromStorage,
  colorAlpha,
  colorToHex,
  collectStorageObjectAttributeEntries,
  fillFromValue,
  getRecord,
  getRefId,
  getRecordValue,
  lineFromValue,
  paddingFromValue,
  pathSourceToGeometry,
  readField,
  resolveMergedStyle,
  shadowFromValue,
  transformFromGeometry,
  verticalAlignFromValue
} from './helpers';

type AnyObject = Record<string, unknown>;
type ShapeType = Extract<SlideItem, { kind: 'shape' }>['shapeType'];

export interface SemanticBuildContext {
  archive: IworkArchiveIndex;
  media: Record<string, IworkImageAsset>;
}

export interface SemanticBuildOptions {
  numbersSheetIndexes?: Set<number>;
}

interface PagesLayoutModel {
  width: number;
  height: number;
  leftMargin: number;
  rightMargin: number;
  topMargin: number;
  bottomMargin: number;
  bodyWidth: number;
  bodyHeight: number;
}

interface PaginatedPagesBodyPage {
  pageIndex: number;
  startParagraph: number;
  endParagraph: number;
  fragments: PaginatedPagesBodyFragment[];
}

interface PagesTextRange {
  location: number;
  length: number;
}

interface PagesBodyFragmentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PaginatedPagesBodyFragment {
  startParagraph: number;
  endParagraph: number;
  rangeStart?: number;
  rangeEnd?: number;
  rect?: PagesBodyFragmentRect;
  columnCount?: number;
  startVisibleOffset?: number;
  endVisibleOffset?: number;
}

interface PagesInlineAttachment {
  characterIndex: number;
  anchorParagraphIndex: number;
  fragmentIndex: number;
  placement: 'standalone' | 'prefix' | 'suffix' | 'middle';
  flowPositioned: boolean;
  flowOffsetY: number;
  item: SlideItem;
  block: PagesBodyBlock;
}

interface PagesAttachmentPositionHint {
  pageIndex: number;
  x?: number;
  y?: number;
}

interface PagesTablePartitionHint {
  pageIndex: number;
  rowStart: number;
  rowCount: number;
  columnStart: number;
  columnCount: number;
}

interface PagesTextHintFragment {
  range: PagesTextRange;
  rect?: PagesBodyFragmentRect;
  columnCount?: number;
}

interface PagesParagraphMetrics {
  heights: number[];
  offsets: number[];
  totalHeight: number;
}

interface PagesBodyFlowBlock extends PagesBodyBlock {
  fragmentIndex: number;
  flowPositioned?: boolean;
  flowOffsetY?: number;
}

interface PagesFloatingGroup {
  backgroundItems: SlideItem[];
  drawableItems: SlideItem[];
  foregroundItems: SlideItem[];
  blocks: PagesBodyBlock[];
  seenRecordIds: Set<number>;
}

interface PagesSectionEntry {
  index: number;
  refId?: number;
}

interface PagesSectionState {
  sectionRefId?: number;
  sectionPageIndex: number;
}

interface PagesTemplateDecorations {
  background: FillStyle;
  leadingItems: SlideItem[];
  trailingItems: SlideItem[];
  blocks: PagesBodyBlock[];
}

interface PagesResolvedSection {
  sectionRefId?: number;
  section?: Record<string, unknown>;
  sectionTemplate?: Record<string, unknown>;
  pageTemplateRecord?: {
    id: number;
    typeName: string;
    value: Record<string, unknown>;
  };
  documentPageNumber: number;
  sectionPageIndex: number;
  pageNumber: number;
  pageNumberText: string;
  pageCount: number;
  pageCountText: string;
  headersEnabled: boolean;
  footersEnabled: boolean;
}

const DEFAULT_THEME: ThemeModel = {
  colors: {},
  fonts: {}
};

export function buildParsedDocument(context: SemanticBuildContext, options: SemanticBuildOptions = {}): ParsedIworkDocument {
  switch (context.archive.type) {
    case 'key':
      return buildKeynoteDocument(context);
    case 'pages':
      return buildPagesDocument(context);
    case 'numbers':
      return buildNumbersDocument(context, options.numbersSheetIndexes);
    default:
      throw new Error(`Unsupported iWork type: ${context.archive.type satisfies never}`);
  }
}

function buildKeynoteDocument(context: SemanticBuildContext): ParsedKeynoteDocument {
  const documentRecord = findRecordByType(context.archive, 'KN.DocumentArchive', ['show']);
  const show = getRecordValue<Record<string, unknown>>(context.archive, readField(documentRecord?.value as Record<string, unknown>, ['show']));
  const slideTree = asObject(readField(show, ['slideTree', 'slide_tree']));
  const slideNodeRefs = asArray<Record<string, unknown>>(readField(slideTree, ['slides']));
  const size = asObject(readField(show, ['size']));
  const defaultSlideNumberVisible = readField<boolean>(show, ['slideNumbersVisible', 'slide_numbers_visible']) === true;
  const width = Number(readField<number>(size, ['width']) ?? 1024);
  const height = Number(readField<number>(size, ['height']) ?? 768);

  const slides = slideNodeRefs
    .map((slideNodeRef, index) => {
      const slideNode = getRecordValue<Record<string, unknown>>(context.archive, slideNodeRef);
      const slide = getRecordValue<Record<string, unknown>>(context.archive, readField(slideNode, ['slide']));
      if (!slide) {
        return undefined;
      }
      return buildSlideCanvas(
        context,
        slideNode ?? {},
        slide,
        index,
        slideNodeRefs.length || 1,
        width,
        height,
        defaultSlideNumberVisible
      );
    })
    .filter((slide): slide is IworkCanvasModel => Boolean(slide));

  const presentation: ParsedPresentation = {
    size: {
      width,
      height
    },
    theme: DEFAULT_THEME,
    slides: slides.map((canvas) => canvas.slide),
    media: context.media,
    warnings: context.archive.warnings.slice()
  };

  return {
    kind: 'key',
    archive: context.archive,
    warnings: context.archive.warnings.slice(),
    presentation,
    slides
  };
}

function buildPagesDocument(context: SemanticBuildContext): ParsedPagesDocument {
  const documentRecord = findRecordByType(context.archive, 'TP.DocumentArchive', ['bodyStorage', 'body_storage', 'pageWidth', 'page_width', 'pageHeight', 'page_height']);
  const documentValue = asObject(documentRecord?.value) ?? {};
  const layout = buildPagesLayout(documentValue);
  const bodyStorage = getRecordValue<Record<string, unknown>>(context.archive, readField(documentValue, ['bodyStorage', 'body_storage']));
  const sectionEntries = bodyStorage ? normalizePagesSectionEntries(readField(bodyStorage, ['tableSection', 'table_section'])) : [];

  let title = 'Pages document';
  let bodyFrame: TextFrame | undefined;
  let paragraphRanges: Array<{ start: number; end: number; text: string }> = [];
  let paginatedBodyPages: PaginatedPagesBodyPage[] = [];
  let paragraphMetrics: PagesParagraphMetrics | undefined;
  const inlineAttachmentsByPage = new Map<number, PagesInlineAttachment[]>();
  const pencilItemsByPage = new Map<number, SlideItem[]>();
  const attachmentPositionHints = buildPagesAttachmentPositionHints(context.archive, documentValue);
  const tablePartitionHints = buildPagesTablePartitionHints(context.archive, documentValue);
  const layoutStatePageCount = resolvePagesLayoutStatePageCount(context.archive, documentValue);

  if (bodyStorage) {
    bodyFrame = buildTextFrameFromStorage(context.archive, bodyStorage, {
      padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      },
      verticalAlign: 'top',
      attachmentContext: {
        documentName: context.archive.sourceName
      }
    });
    if (bodyFrame) {
      title = findFirstParagraphText(bodyFrame.paragraphs) ?? title;
      const bodyText = normalizeStorageText(readField(bodyStorage, ['text']));
      paragraphRanges = buildParagraphRanges(bodyText);
      paragraphMetrics = buildPagesParagraphMetrics(bodyFrame.paragraphs, layout.bodyWidth);
      paginatedBodyPages = paginatePagesBodyParagraphsFromLayoutState(
        context.archive,
        documentValue,
        bodyFrame.paragraphs,
        paragraphRanges
      );
      if (!paginatedBodyPages.length) {
        paginatedBodyPages = paginatePagesBodyParagraphs(bodyFrame.paragraphs, layout.bodyWidth, layout.bodyHeight);
      }
      const attachmentEntries = collectStorageObjectAttributeEntries(bodyStorage, [
        'tableAttachment',
        'table_attachment',
        'tableSmartfield',
        'table_smartfield',
        'tableBookmark',
        'table_bookmark',
        'tableFootnote',
        'table_footnote',
        'tableRubyfield',
        'table_rubyfield'
      ])
        .map((entry, index) => ({
          entry,
          index,
          characterIndex: Number(readField<number>(entry, ['characterIndex', 'character_index']) ?? 0)
        }))
        .sort((left, right) => left.characterIndex - right.characterIndex || left.index - right.index);

      let attachmentOrder = 1;
      for (const attachment of attachmentEntries) {
        const attachmentObject = getRecordValue<Record<string, unknown>>(context.archive, readField(attachment.entry, ['object']));
        const drawable = getRecordValue<Record<string, unknown>>(context.archive, readField(attachmentObject, ['drawable']));
        if (!drawable) {
          continue;
        }
        const attachmentItem = buildDrawableItem(context, drawable, attachmentOrder);
        if (!attachmentItem) {
          continue;
        }

        const attachmentId = getRefId(readField(attachment.entry, ['object'])) ??
          (attachmentObject ? findRecordIdByValue(context.archive, attachmentObject) : undefined);
        const drawableId = findRecordIdByValue(context.archive, drawable);
        const anchorParagraphIndex = findParagraphIndexForCharacter(paragraphRanges, attachment.characterIndex);
        const attachmentHint =
          (attachmentId != null ? attachmentPositionHints.get(attachmentId) : undefined) ??
          (drawableId != null ? attachmentPositionHints.get(drawableId) : undefined);
        const pageIndex = attachmentHint
          ? Math.max(0, attachmentHint.pageIndex)
          : findBodyPageIndexForCharacter(paginatedBodyPages, paragraphRanges, attachment.characterIndex, anchorParagraphIndex);
        const pageInfo = findPagesBodyPageByIndex(paginatedBodyPages, pageIndex) ?? paginatedBodyPages[paginatedBodyPages.length - 1];
        if (!pageInfo && !attachmentHint) {
          continue;
        }

        const itemParts = attachmentItem.kind === 'table'
          ? resolvePagesTableItemPartitions(attachmentItem, pageIndex, tablePartitionHints)
          : [];
        const renderParts = itemParts.length
          ? itemParts
          : [{ pageIndex, item: attachmentItem }];

        for (let partIndex = 0; partIndex < renderParts.length; partIndex += 1) {
          const part = renderParts[partIndex];
          const partPageInfo = findPagesBodyPageByIndex(paginatedBodyPages, part.pageIndex) ?? pageInfo;
          const partHint = partIndex === 0 ? attachmentHint : { pageIndex: part.pageIndex };
          positionPagesAttachmentItem({
            archive: context.archive,
            item: part.item,
            attachmentObject,
            attachmentHint: partHint,
            page: partPageInfo,
            paragraphRanges,
            characterIndex: attachment.characterIndex,
            anchorParagraphIndex,
            paragraphCount: paragraphRanges.length,
            pageParagraphStart: partPageInfo?.startParagraph ?? 0,
            pageParagraphEnd: partPageInfo?.endParagraph ?? paragraphRanges.length,
            paragraphMetrics,
            leftMargin: layout.leftMargin,
            topMargin: layout.topMargin,
            bottomMargin: layout.bottomMargin,
            pageHeight: layout.height
          });

          const flowPositioned = !hasAbsolutePagesAttachmentPosition(partHint);
          const pageBucket = inlineAttachmentsByPage.get(part.pageIndex) ?? [];
          pageBucket.push({
            characterIndex: attachment.characterIndex,
            anchorParagraphIndex,
            fragmentIndex: resolvePagesAttachmentFragmentIndex(partPageInfo, paragraphRanges, attachment.characterIndex, anchorParagraphIndex),
            placement: resolvePagesAttachmentPlacement(paragraphRanges, attachment.characterIndex, anchorParagraphIndex),
            flowPositioned,
            flowOffsetY: flowPositioned
              ? Number(readField<number>(attachmentObject, ['vOffset', 'v_offset']) ?? 0)
              : 0,
            item: part.item,
            block: {
              id: `pages-attachment-${part.pageIndex + 1}-${attachmentOrder}-${partIndex + 1}`,
              kind: part.item.kind === 'table' ? 'table' : 'drawable',
              item: part.item,
              sourceRecordId: attachmentObject ? findRecordIdByValue(context.archive, attachmentObject) : undefined
            }
          });
          inlineAttachmentsByPage.set(part.pageIndex, pageBucket);
        }

        const firstRenderPart = renderParts[0];
        const pencilItems = buildPencilAnnotationItems(context, drawable, attachmentOrder, firstRenderPart.item.transform);
        const pagePencilItems = pencilItemsByPage.get(pageIndex) ?? [];
        pagePencilItems.push(...pencilItems);
        pencilItemsByPage.set(pageIndex, pagePencilItems);
        attachmentOrder += 1;
      }
    }
  }

  const floatingGroups = buildPagesFloatingGroups(context, documentValue);
  const totalPages = Math.max(
    1,
    paginatedBodyPages.length,
    layoutStatePageCount,
    maxPageIndexFromFloatingGroups(floatingGroups) + 1,
    maxPageIndexFromAttachmentHints(attachmentPositionHints) + 1
  );
  const settings = getRecordValue<Record<string, unknown>>(context.archive, readField(documentValue, ['settings']));
  const sectionStates = buildPagesSectionStates(
    documentValue,
    paginatedBodyPages,
    totalPages,
    sectionEntries,
    paragraphRanges
  );
  const pages: ParsedPagesPage[] = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const items: SlideItem[] = [];
    const blocks: PagesBodyBlock[] = [];
    const bodyPage = paginatedBodyPages[pageIndex];
    const inlineAttachments = (inlineAttachmentsByPage.get(pageIndex) ?? [])
      .slice()
      .sort((left, right) =>
        left.fragmentIndex - right.fragmentIndex ||
        left.anchorParagraphIndex - right.anchorParagraphIndex ||
        left.characterIndex - right.characterIndex
      );
    const floatingGroup = floatingGroups.get(pageIndex);
    const sectionContext = resolvePagesSectionForPage(
      context,
      documentValue,
      pageIndex,
      totalPages,
      sectionStates[pageIndex],
      settings
    );
    const templateDecorations = buildPagesTemplateDecorations(context, sectionContext, layout);

    if (templateDecorations.background.type !== 'none' || templateDecorations.background.color || templateDecorations.background.mediaId) {
      // applied below through canvas background; keep item layering separate
    }

    if (templateDecorations.leadingItems.length) {
      items.push(...templateDecorations.leadingItems);
    }

    if (floatingGroup) {
      items.push(...floatingGroup.backgroundItems);
    }

    if (bodyFrame && bodyPage) {
      const bodyFlowBlocks = buildPagesBodyFlowBlocksForPage(
        bodyFrame.paragraphs,
        bodyPage,
        inlineAttachments,
        paragraphRanges,
        pageIndex,
        documentRecord?.id
      );
      const bodyItems = createPagesBodyItems(bodyFrame, bodyPage, layout, pageIndex, bodyFlowBlocks);
      if (bodyItems.length) {
        items.push(...bodyItems);
      }
      blocks.push(...bodyFlowBlocks.map(toPagesBodyBlock));
    } else if (inlineAttachments.length) {
      for (const attachment of inlineAttachments) {
        items.push(attachment.item);
        blocks.push(attachment.block);
      }
    }

    if (floatingGroup) {
      items.push(...floatingGroup.drawableItems, ...floatingGroup.foregroundItems);
      blocks.push(...floatingGroup.blocks);
    }

    const pagePencilItems = pencilItemsByPage.get(pageIndex);
    if (pagePencilItems?.length) {
      items.push(...pagePencilItems);
    }

    if (templateDecorations.trailingItems.length) {
      items.push(...templateDecorations.trailingItems);
    }
    if (templateDecorations.blocks.length) {
      blocks.push(...templateDecorations.blocks);
    }

    items.forEach((item, order) => {
      item.order = order;
    });

    const canvasTitle = pageIndex === 0
      ? findCanvasTitle(items) ?? title
      : findCanvasTitle(items) ?? `${title} ${pageIndex + 1}`;
    const canvas = createCanvasModel(
      `pages-${pageIndex + 1}`,
      pageIndex,
      layout.width,
      layout.height,
      items,
      canvasTitle,
      templateDecorations.background.type === 'none'
        ? { type: 'solid', color: '#ffffff', alpha: 1 }
        : templateDecorations.background
    );
    pages.push({
      id: canvas.id,
      index: pageIndex,
      width: layout.width,
      height: layout.height,
      canvas,
      blocks
    });
  }

  return {
    kind: 'pages',
    archive: context.archive,
    warnings: context.archive.warnings.slice(),
    title,
    pages,
    media: context.media
  };
}

function buildNumbersDocument(context: SemanticBuildContext, sheetIndexes?: Set<number>): ParsedNumbersDocument {
  const documentRecord = findRecordByType(context.archive, 'TN.DocumentArchive', ['sheets']);
  const documentValue = asObject(documentRecord?.value) ?? {};
  const pageSize = asObject(readField(documentValue, ['pageSize', 'page_size']));
  const defaultPageWidth = Number(readField<number>(pageSize, ['width']) ?? 595);
  const defaultPageHeight = Number(readField<number>(pageSize, ['height']) ?? 842);
  const sheetRefs = asArray<Record<string, unknown>>(readField(documentValue, ['sheets']));
  const sheets = sheetRefs
    .map((sheetRef, index) =>
      !sheetIndexes || sheetIndexes.has(index)
        ? buildNumbersSheet(context, sheetRef, index, defaultPageWidth, defaultPageHeight)
        : buildNumbersSheetPlaceholder(context, sheetRef, index, defaultPageWidth, defaultPageHeight)
    )
    .filter((sheet): sheet is ParsedNumbersSheet => Boolean(sheet));

  return {
    kind: 'numbers',
    archive: context.archive,
    warnings: context.archive.warnings.slice(),
    sheets,
    media: context.media
  };
}

export function buildNumbersSheetAt(context: SemanticBuildContext, index: number): ParsedNumbersSheet | undefined {
  const documentRecord = findRecordByType(context.archive, 'TN.DocumentArchive', ['sheets']);
  const documentValue = asObject(documentRecord?.value) ?? {};
  const pageSize = asObject(readField(documentValue, ['pageSize', 'page_size']));
  const sheetRef = asArray<Record<string, unknown>>(readField(documentValue, ['sheets']))[index];
  return buildNumbersSheet(
    context,
    sheetRef,
    index,
    Number(readField<number>(pageSize, ['width']) ?? 595),
    Number(readField<number>(pageSize, ['height']) ?? 842)
  );
}

function buildNumbersSheetPlaceholder(
  context: SemanticBuildContext,
  sheetRef: unknown,
  index: number,
  width: number,
  height: number
): ParsedNumbersSheet | undefined {
  const sheet = getRecordValue<Record<string, unknown>>(context.archive, sheetRef);
  if (!sheet) {
    return undefined;
  }
  const name = String(readField<string>(sheet, ['name']) ?? `Sheet ${index + 1}`);
  const canvas = createCanvasModel(`numbers-sheet-${index + 1}`, index, width, height, [], name);
  return { id: canvas.id, index, name, canvas, tables: [], loaded: false };
}

function buildNumbersSheet(
  context: SemanticBuildContext,
  sheetRef: unknown,
  index: number,
  defaultPageWidth: number,
  defaultPageHeight: number
): ParsedNumbersSheet | undefined {
  const sheet = getRecordValue<Record<string, unknown>>(context.archive, sheetRef);
  if (!sheet) {
    return undefined;
  }

  const drawableRefs = asArray<Record<string, unknown>>(readField(sheet, ['drawableInfos', 'drawable_infos']));
  const items: SlideItem[] = [];
  const tables: TableItem[] = [];
  const printMargins = asObject(readField(sheet, ['printMargins', 'print_margins']));
  const leftMargin = Number(readField<number>(printMargins, ['left']) ?? 48);
  const topMargin = Number(readField<number>(printMargins, ['top']) ?? 48);
  const rightMargin = Number(readField<number>(printMargins, ['right']) ?? 48);
  const bottomMargin = Number(readField<number>(printMargins, ['bottom']) ?? 48);
  let maxWidth = defaultPageWidth;
  let maxHeight = defaultPageHeight;

  drawableRefs.forEach((drawableRef, order) => {
    const drawable = getRecordValue<Record<string, unknown>>(context.archive, drawableRef);
    if (!drawable) {
      return;
    }
    const item = buildDrawableItem(context, drawable, order);
    if (!item) {
      return;
    }
    items.push(item);
    if (item.kind === 'table') {
      tables.push(item);
    }
    maxWidth = Math.max(maxWidth, item.transform.x + item.transform.width + rightMargin);
    maxHeight = Math.max(maxHeight, item.transform.y + item.transform.height + bottomMargin);
  });

  const sheetName = String(readField<string>(sheet, ['name']) ?? `Sheet ${index + 1}`);
  const headerFooterItems = buildNumbersHeaderFooterItems(context, {
    sheet,
    orderOffset: items.length,
    pageWidth: defaultPageWidth,
    pageHeight: defaultPageHeight,
    leftMargin,
    topMargin,
    rightMargin,
    bottomMargin
  });
  for (const item of headerFooterItems) {
    items.push(item);
    maxWidth = Math.max(maxWidth, item.transform.x + item.transform.width + rightMargin);
    maxHeight = Math.max(maxHeight, item.transform.y + item.transform.height + bottomMargin);
  }

  const canvas = createCanvasModel(`numbers-sheet-${index + 1}`, index, maxWidth, maxHeight, items, sheetName);
  return {
    id: canvas.id,
    index,
    name: sheetName,
    canvas,
    loaded: true,
    tables: tables.map((table) => ({
      id: table.id,
      item: table
    }))
  };
}

function buildSlideCanvas(
  context: SemanticBuildContext,
  slideNode: Record<string, unknown>,
  slide: Record<string, unknown>,
  index: number,
  pageCount: number,
  width: number,
  height: number,
  defaultSlideNumberVisible = false
): IworkCanvasModel {
  const background = resolveKeynoteSlideBackground(context.archive, slide);
  const localSlideNumberVisible = readField<boolean>(slideNode, ['isSlideNumberVisible', 'is_slide_number_visible']);
  const items = buildKeynoteSlideItems(context, slide, {
    pageNumber: index + 1,
    pageCount,
    slideNumberVisible: localSlideNumberVisible ?? defaultSlideNumberVisible
  });
  items.forEach((item, order) => {
    item.order = order;
  });

  const title = findCanvasTitle(items) ?? `Slide ${index + 1}`;
  return createCanvasModel(`key-slide-${index + 1}`, index, width, height, items, title, background);
}

function resolveKeynoteSlideBackground(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  visitedSlideIds = new Set<number>()
): FillStyle {
  const slideRecordId = findRecordIdByValue(archive, slide);
  if (slideRecordId != null) {
    if (visitedSlideIds.has(slideRecordId)) {
      return { type: 'solid', color: '#ffffff', alpha: 1 };
    }
    visitedSlideIds.add(slideRecordId);
  }

  const directBackground = readKeynoteSlideBackground(archive, slide);
  if (directBackground.type !== 'none') {
    return directBackground;
  }

  const templateSlide = getRecordValue<Record<string, unknown>>(archive, readField(slide, ['templateSlide', 'template_slide']));
  if (templateSlide) {
    const templateBackground = resolveKeynoteSlideBackground(archive, templateSlide, visitedSlideIds);
    if (templateBackground.type !== 'none') {
      return templateBackground;
    }
  }

  return { type: 'solid', color: '#ffffff', alpha: 1 };
}

function readKeynoteSlideBackground(archive: IworkArchiveIndex, slide: Record<string, unknown>): FillStyle {
  const style = resolveMergedStyle(archive, readField(slide, ['style']));
  const slideProperties = asObject(readField(style, ['slideProperties', 'slide_properties']));
  return fillFromValue(readField(slideProperties, ['fill']));
}

interface KeynoteBuildOptions {
  pageNumber?: number;
  pageCount?: number;
  slideNumberVisible?: boolean;
}

interface DrawableBuildOptions {
  attachmentContext?: {
    pageNumber?: number;
    pageCount?: number;
    pageNumberText?: string;
    pageCountText?: string;
    documentName?: string;
  };
  slide?: Record<string, unknown>;
}

type DrawableRenderItem = SlideItem & {
  opacity?: number;
};

function buildKeynoteSlideItems(
  context: SemanticBuildContext,
  slide: Record<string, unknown>,
  options: KeynoteBuildOptions,
  visitedSlideIds = new Set<number>(),
  suppressedPlaceholderKinds = new Set<number>(),
  hiddenPlaceholderKinds = new Set<number>(),
  seenDrawableIds = new Set<number>()
): SlideItem[] {
  const slideRecordId = findRecordIdByValue(context.archive, slide);
  if (slideRecordId != null) {
    if (visitedSlideIds.has(slideRecordId)) {
      return [];
    }
    visitedSlideIds.add(slideRecordId);
  }

  const items: SlideItem[] = [];
  const localPlaceholderKinds = collectKeynotePlaceholderKinds(context.archive, slide, options.slideNumberVisible);
  const localHiddenPlaceholderKinds = collectHiddenKeynotePlaceholderKinds(context.archive, slide, options.slideNumberVisible);
  const templateSlide = getRecordValue<Record<string, unknown>>(context.archive, readField(slide, ['templateSlide', 'template_slide']));
  if (templateSlide) {
    items.push(
      ...buildKeynoteSlideItems(
        context,
        templateSlide,
        {
          ...options,
          slideNumberVisible: false
        },
        visitedSlideIds,
        new Set([...suppressedPlaceholderKinds, ...localPlaceholderKinds]),
        new Set([...hiddenPlaceholderKinds, ...localHiddenPlaceholderKinds]),
        seenDrawableIds
      )
    );
  }

  const pushDrawable = (drawableRef: unknown, depth = 0, inheritedOpacity?: number) => {
    const drawableRecord = getRecord(context.archive, drawableRef);
    const drawable = asObject(drawableRecord?.value);
    if (!drawable || depth > 16 || (drawableRecord?.id != null && seenDrawableIds.has(drawableRecord.id))) {
      return;
    }

    const freehand = resolveFreehandDrawingArchive(drawable);
    const freehandOpacity = normalizeDrawableOpacity(Number(readField<number>(freehand, ['opacity']) ?? NaN));
    const effectiveOpacity = combineDrawableOpacity(inheritedOpacity, freehandOpacity);
    let item = buildDrawableItem(context, drawable, items.length, {
      slide,
      attachmentContext: {
        pageNumber: options.pageNumber,
        pageCount: options.pageCount,
        pageNumberText: options.pageNumber != null ? String(options.pageNumber) : undefined,
        pageCountText: options.pageCount != null ? String(options.pageCount) : undefined
      }
    });
    if (!item) {
      // Containers have no placeholder visibility to filter, so mark them
      // before descending to protect against malformed cyclic child graphs.
      if (drawableRecord?.id != null) {
        seenDrawableIds.add(drawableRecord.id);
      }
      if (context.archive.type === 'key') {
        items.push(...buildPencilAnnotationItems(context, drawable, items.length, undefined, effectiveOpacity));
      }
    } else {
      const placeholderKind = drawableRecord?.typeName === 'KN.PlaceholderArchive'
        ? Number(readField<number>(drawable, ['kind']) ?? -1)
        : undefined;
      if (
        drawableRecord?.typeName === 'KN.PlaceholderArchive' &&
        (
          hiddenPlaceholderKinds.has(placeholderKind ?? -1) ||
          localHiddenPlaceholderKinds.has(placeholderKind ?? -1) ||
          suppressedPlaceholderKinds.has(placeholderKind ?? -1) ||
          !shouldIncludeKeynotePlaceholderItem(item)
        )
      ) {
        return;
      }

      if (drawableRecord?.id != null) {
        seenDrawableIds.add(drawableRecord.id);
      }
      if (effectiveOpacity != null) {
        const itemOpacity = normalizeDrawableOpacity((item as DrawableRenderItem).opacity ?? NaN);
        item = {
          ...item,
          opacity: combineDrawableOpacity(itemOpacity, effectiveOpacity)
        } as DrawableRenderItem;
      }
      items.push(item);
      if (context.archive.type === 'key') {
        items.push(...buildPencilAnnotationItems(context, drawable, items.length, undefined, effectiveOpacity));
      }
    }

    const childRefs = asArray<unknown>(readField(drawable, ['children']));
    for (const childRef of childRefs) {
      pushDrawable(childRef, depth + 1, effectiveOpacity);
    }

    // Older archives may expose only the spacer shape on a freehand group.
    // It still carries the drawing geometry and is a useful fallback when the
    // group child list is absent.
    if (!childRefs.length) {
      const spacerShape = freehand && readField(freehand, ['spacerShape', 'spacer_shape']);
      if (spacerShape != null) {
        pushDrawable(spacerShape, depth + 1, effectiveOpacity);
      }
    }
  };

  const drawableRefs = asArray<Record<string, unknown>>(readField(slide, ['drawablesZOrder', 'drawables_z_order'])).length
    ? asArray<Record<string, unknown>>(readField(slide, ['drawablesZOrder', 'drawables_z_order']))
    : asArray<Record<string, unknown>>(readField(slide, ['ownedDrawables', 'owned_drawables']));
  for (const drawableRef of drawableRefs) {
    pushDrawable(drawableRef);
  }

  const placeholderRefs = collectKeynotePlaceholderRefs(slide, options.slideNumberVisible);
  for (const placeholderRef of placeholderRefs) {
    pushDrawable(placeholderRef);
  }

  const objectPlaceholderInfoRefs = collectKeynoteObjectPlaceholderInfoRefs(slide);
  for (const infoRef of objectPlaceholderInfoRefs) {
    pushDrawable(infoRef);
  }

  const syntheticPlaceholderItems = buildSyntheticKeynotePlaceholderItems(context.archive, slide, items.length, options);
  for (const item of syntheticPlaceholderItems) {
    items.push(item);
  }

  return items;
}

function createCanvasModel(
  id: string,
  index: number,
  width: number,
  height: number,
  items: SlideItem[],
  title: string,
  background: FillStyle = { type: 'solid', color: '#ffffff', alpha: 1 }
): IworkCanvasModel {
  const slide: SlideModel = {
    id,
    index,
    title,
    background,
    width,
    height,
    items,
    warnings: []
  };
  return {
    id,
    title,
    width,
    height,
    slide
  };
}

function findRecordByType(archive: IworkArchiveIndex, typeName: string, requiredKeys: string[] = []) {
  const records = Object.values(archive.records).filter((record) => record.typeName === typeName);
  return (
    records.find((record) => {
      const value = asObject(record.value);
      return value ? requiredKeys.every((key) => key in value) : false;
    }) ?? records[0]
  );
}

function buildPencilAnnotationItems(
  context: SemanticBuildContext,
  drawable: Record<string, unknown>,
  orderOffset: number,
  parentTransformOverride?: ItemTransform,
  inheritedOpacity?: number
): SlideItem[] {
  const annotationRefs = asArray<unknown>(readFieldInDrawableChain(drawable, ['pencilAnnotations', 'pencil_annotations']));
  if (!annotationRefs.length) {
    return [];
  }

  const parentTransform = parentTransformOverride ?? transformFromGeometry(resolveDrawableGeometry(drawable));
  const items: SlideItem[] = [];
  annotationRefs.forEach((annotationRef, annotationIndex) => {
    const annotation = asObject(getRecordValue(context.archive, annotationRef)) ?? asObject(annotationRef);
    const storageRef = annotation && readField(annotation, ['pencilAnnotationStorage', 'pencil_annotation_storage']);
    const storage = asObject(getRecordValue(context.archive, storageRef)) ?? asObject(storageRef);
    if (!storage) {
      return;
    }

    const origin = asObject(readField(storage, ['strokesBoundingBoxOrigin', 'strokes_bounding_box_origin'])) ??
      asObject(readField(storage, ['strokePointsFrameOrigin', 'stroke_points_frame_origin'])) ??
      asObject(readField(storage, ['renderedFrameOrigin', 'rendered_frame_origin'])) ??
      { x: 0, y: 0 };
    const size = asObject(readField(storage, ['strokesBoundingBoxSize', 'strokes_bounding_box_size'])) ??
      asObject(readField(storage, ['strokePointsFrameSize', 'stroke_points_frame_size'])) ??
      asObject(readField(storage, ['renderedFrameSize', 'rendered_frame_size'])) ??
      { width: parentTransform.width, height: parentTransform.height };
    const rawWidth = Number(readField<number>(size, ['width']) ?? parentTransform.width);
    const rawHeight = Number(readField<number>(size, ['height']) ?? parentTransform.height);
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : Math.max(parentTransform.width, 1);
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : Math.max(parentTransform.height, 1);
    const path = asObject(readField(storage, ['drawingPath', 'drawing_path']));
    const geometry = path
      ? pathSourceToGeometry({ path, naturalSize: { width, height } }, width, height)
      : undefined;

    const rasterizedDataId = getRefId(readField(storage, ['rasterizedImage', 'rasterized_image']));
    if (!geometry && rasterizedDataId != null && context.media[String(rasterizedDataId)]) {
      items.push({
        id: `pencil-image-${orderOffset}-${annotationIndex + 1}`,
        kind: 'image',
        name: 'Pencil annotation',
        order: orderOffset + annotationIndex,
        groupPath: [],
        transform: {
          x: parentTransform.x + Number(readField<number>(origin, ['x']) ?? 0),
          y: parentTransform.y + Number(readField<number>(origin, ['y']) ?? 0),
          width,
          height,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'none' },
        mediaId: String(rasterizedDataId),
        ...(inheritedOpacity != null ? { opacity: inheritedOpacity } : {})
      });
      return;
    }
    if (!geometry) {
      return;
    }

    const color = asObject(readField(storage, ['penColor', 'pen_color']));
    const rawToolType = Number(readField<number>(storage, ['toolType', 'tool_type']) ?? 0);
    const toolType = Number.isFinite(rawToolType) ? rawToolType : 0;
    const rawDrawingScale = Number(readField<number>(storage, ['pencilAnnotationDrawingScale', 'pencil_annotation_drawing_scale']) ?? 1);
    const drawingScale = Number.isFinite(rawDrawingScale) && rawDrawingScale > 0 ? rawDrawingScale : 1;
    const storedWidth = Number(readField<number>(storage, ['penWidth', 'pen_width', 'strokeWidth', 'stroke_width']) ?? NaN);
    const baseWidth = Number.isFinite(storedWidth) && storedWidth > 0
      ? storedWidth
      : toolType === 1
        ? 8
        : 2;
    const alpha = Number(((colorAlpha(color) ?? 1) * (toolType === 1 ? 0.38 : 1)).toFixed(4));
    const item: SlideItem = {
      id: `pencil-${orderOffset}-${annotationIndex + 1}`,
      kind: 'shape',
      name: 'Pencil annotation',
      order: orderOffset + annotationIndex,
      groupPath: [],
      transform: {
        x: parentTransform.x + Number(readField<number>(origin, ['x']) ?? 0),
        y: parentTransform.y + Number(readField<number>(origin, ['y']) ?? 0),
        width,
        height,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      fill: { type: 'none' },
      line: {
        color: colorToHex(color, '#111827'),
        alpha,
        width: Math.max(1, Math.min(32, baseWidth * drawingScale)),
        lineCap: 'round',
        lineJoin: 'round'
      },
      shapeType: pencilGeometryLooksOpen(geometry) ? 'line' : 'unknown',
      geometry
    } as DrawableRenderItem;
    if (inheritedOpacity != null) {
      (item as DrawableRenderItem).opacity = inheritedOpacity;
    }
    items.push(item);
  });

  return items;
}

function resolveFreehandDrawingArchive(drawable: Record<string, unknown>): Record<string, unknown> | undefined {
  return asObject(readField(drawable, [
    'freehandDrawingArchive',
    'freehand_drawing_archive',
    '.TSD.freehandDrawingArchive'
  ]));
}

function combineDrawableOpacity(parent: number | undefined, local: number | undefined): number | undefined {
  if (parent == null) {
    return local;
  }
  if (local == null) {
    return parent;
  }
  return Number(Math.max(0, Math.min(1, parent * local)).toFixed(4));
}

function pencilGeometryLooksOpen(geometry: NonNullable<Extract<SlideItem, { kind: 'shape' }>['geometry']>): boolean {
  if (geometry.type !== 'custom') {
    return false;
  }
  return geometry.paths.some((path) => path.commands.some((command) => command.type !== 'Z')) &&
    geometry.paths.every((path) => path.commands.every((command) => command.type !== 'Z'));
}

function buildDrawableItem(
  context: SemanticBuildContext,
  drawable: Record<string, unknown>,
  order: number,
  options: DrawableBuildOptions = {}
): DrawableRenderItem | undefined {
  const geometry = resolveDrawableGeometry(drawable);
  const transform = transformFromGeometry(geometry);
  const style = resolveMergedStyle(context.archive, resolveDrawableStyleRef(drawable));
  const shapeProps = asObject(readField(style, ['shapeProperties', 'shape_properties']));
  const mediaProps = asObject(readField(style, ['mediaProperties', 'media_properties']));
  const fill = fillFromValue(
    readField(shapeProps, ['fill']) ??
    readField(mediaProps, ['fill']) ??
    readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['fill']) ??
    readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['fill']) ??
    readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['fill']) ??
    readFieldInStyleChain(style, [], ['fill']) ??
    readField(style, ['fill'])
  );
  const line = lineFromValue(
    readField(shapeProps, ['stroke']) ??
    readField(mediaProps, ['stroke']) ??
    readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['stroke']) ??
    readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['stroke']) ??
    readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['stroke']) ??
    readFieldInStyleChain(style, [], ['stroke']) ??
    readField(style, ['stroke'])
  );
  const shadow = shadowFromValue(
    readField(shapeProps, ['shadow']) ??
    readField(mediaProps, ['shadow']) ??
    readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['shadow']) ??
    readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['shadow']) ??
    readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['shadow']) ??
    readFieldInStyleChain(style, [], ['shadow']) ??
    readField(style, ['shadow'])
  );
  const opacity = normalizeDrawableOpacity(
    readField<number>(shapeProps, ['opacity']) ??
    readField<number>(mediaProps, ['opacity']) ??
    asFiniteNumber(readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['opacity'])) ??
    asFiniteNumber(readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['opacity'])) ??
    asFiniteNumber(readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['opacity'])) ??
    asFiniteNumber(readFieldInStyleChain(style, [], ['opacity'])) ??
    readField<number>(style, ['opacity'])
  );
  const storageRef = resolveDrawableStorageRef(drawable);
  const pathSource = resolveDrawablePathSource(drawable);
  const geometryModel = pathSourceToGeometry(pathSource, transform.width, transform.height);
  const paragraphStyleRef = readField(shapeProps, ['paragraphStyle', 'paragraph_style']);
  const padding = paddingFromValue(readField(shapeProps, ['padding']), 4);
  const verticalAlign = verticalAlignFromValue(readField(shapeProps, ['verticalAlignment', 'vertical_alignment']));
  const textFrame = buildTextFrameFromStorage(context.archive, storageRef, {
    defaultParagraphStyleRef: paragraphStyleRef,
    padding,
    verticalAlign,
    shapeProperties: shapeProps,
    attachmentContext: {
      ...options.attachmentContext,
      documentName: options.attachmentContext?.documentName ?? context.archive.sourceName
    }
  }) ??
    buildKeynotePlaceholderFallbackTextFrame(drawable, options.slide, padding, verticalAlign) ??
    buildKeynoteInstructionalTextFrame(context.archive, drawable, options.slide, padding, verticalAlign);
  const normalizedTransform = ensureDrawableTextTransform(transform, textFrame);
  const drawableRecord = findRecordByValue(context.archive, drawable);
  const hyperlink = resolveDrawableHyperlink(drawable);

  if (readField(drawable, ['tableModel', 'table_model'])) {
    return buildTableItem(context.archive, drawable, normalizedTransform, order);
  }

  const dataId = resolveDrawableDataId(drawable, drawableRecord);
  if (dataId) {
    const media = context.media[dataId];
    const mediaType = resolveDrawableMediaType(drawable, media);
    if (mediaType === 'video' || mediaType === 'audio') {
      return {
        id: `media-${dataId}-${order}`,
        kind: 'media',
        name: media.path,
        order,
        groupPath: [],
        transform: normalizedTransform,
        fill,
        line,
        shadow,
        href: hyperlink,
        opacity,
        mediaType,
        mediaId: dataId,
        posterMediaId: resolveDrawableThumbnailDataId(drawable, drawableRecord, dataId)
      };
    }
    return {
      id: `image-${dataId}-${order}`,
      kind: 'image',
      name: media?.path ?? dataId,
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill,
      line,
      shadow,
      href: hyperlink,
      opacity,
      mediaId: dataId
    };
  }

  if (textFrame && (transform.width <= 0 || transform.height <= 0)) {
    return {
      id: `text-${order}-${normalizedTransform.x}-${normalizedTransform.y}`,
      kind: 'text',
      name: 'Text',
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill: {
        type: 'none'
      },
      line,
      shadow,
      href: hyperlink,
      opacity,
      textFrame
    };
  }

  const hasVisibleShapeAppearance = fill.type !== 'none' || Boolean(line) || Boolean(shadow);

  if (
    geometryModel ||
    pathSource ||
    (transform.width > 0 && transform.height > 0 && hasVisibleShapeAppearance)
  ) {
    return {
      id: `shape-${order}-${normalizedTransform.x}-${normalizedTransform.y}`,
      kind: 'shape',
      name: String(readField<string>(drawable, ['title']) ?? 'Shape'),
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill,
      line,
      shadow,
      href: hyperlink,
      opacity,
      shapeType: resolveShapeType(pathSource),
      geometry: geometryModel,
      textFrame
    };
  }

  if (textFrame) {
    return {
      id: `text-${order}-${transform.x}-${transform.y}`,
      kind: 'text',
      name: 'Text',
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill: {
        type: 'none'
      },
      line,
      shadow,
      href: hyperlink,
      opacity,
      textFrame
    };
  }

  return undefined;
}

function buildNumbersHeaderFooterItems(
  context: SemanticBuildContext,
  options: {
    sheet: Record<string, unknown>;
    orderOffset: number;
    pageWidth: number;
    pageHeight: number;
    leftMargin: number;
    topMargin: number;
    rightMargin: number;
    bottomMargin: number;
  }
): SlideItem[] {
  const {
    sheet,
    orderOffset,
    pageWidth,
    pageHeight,
    leftMargin,
    topMargin,
    rightMargin,
    bottomMargin
  } = options;
  const showsPageNumbers = readField<boolean>(sheet, ['showPageNumbers', 'show_page_numbers']) !== false;
  const usesStartPageNumber = readField<boolean>(sheet, ['usingStartPageNumber', 'using_start_page_number']) === true;
  const pageNumber = usesStartPageNumber
    ? Number(readField<number>(sheet, ['startPageNumber', 'start_page_number']) ?? 1)
    : 1;
  const headerInset = Number(readField<number>(sheet, ['pageHeaderInset', 'page_header_inset']) ?? 18);
  const footerInset = Number(readField<number>(sheet, ['pageFooterInset', 'page_footer_inset']) ?? 18);
  const pageCount = Math.max(1, Number(readField<number>(sheet, ['lastPageCount', 'last_page_count']) ?? 1));
  const slots: Array<{
    section: 'header' | 'footer';
    ref: unknown;
    slotIndex: number;
    y: number;
  }> = [];

  asArray<unknown>(readField(sheet, ['headers'])).forEach((ref, slotIndex) => {
    slots.push({
      section: 'header',
      ref,
      slotIndex,
      y: Math.max(0, topMargin - headerInset)
    });
  });
  asArray<unknown>(readField(sheet, ['footers'])).forEach((ref, slotIndex) => {
    slots.push({
      section: 'footer',
      ref,
      slotIndex,
      y: Math.max(0, pageHeight - bottomMargin + 6)
    });
  });

  const items: SlideItem[] = [];
  for (const slot of slots) {
    const storage = getRecordValue<Record<string, unknown>>(context.archive, slot.ref);
    if (!storage) {
      continue;
    }
    const textFrame = buildTextFrameFromStorage(context.archive, storage, {
      padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      },
      verticalAlign: slot.section === 'header' ? 'top' : 'bottom',
      attachmentContext: {
        documentName: context.archive.sourceName,
        pageNumber,
        pageCount,
        pageNumberText: showsPageNumbers ? undefined : '',
        pageCountText: showsPageNumbers ? undefined : ''
      }
    });
    if (!textFrame || !hasVisibleTextFrame(textFrame)) {
      continue;
    }

    const slotWidth = Math.max((pageWidth - leftMargin - rightMargin) / 3, 48);
    const x = leftMargin + slot.slotIndex * slotWidth;
    const align: TextParagraph['align'] =
      slot.slotIndex === 0 ? 'left' : slot.slotIndex === 1 ? 'center' : 'right';
    const paragraphs = textFrame.paragraphs.map((paragraph) => ({
      ...paragraph,
      align: paragraph.align ?? align
    }));
    items.push({
      id: `numbers-${slot.section}-${slot.slotIndex}`,
      kind: 'text',
      name: `${slot.section}-${slot.slotIndex}`,
      order: orderOffset + items.length,
      groupPath: [],
      transform: {
        x,
        y: slot.y,
        width: slotWidth,
        height: 24,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      fill: {
        type: 'none'
      },
      textFrame: {
        ...textFrame,
        paragraphs
      }
    });
  }

  return items;
}

function buildPagesLayout(documentValue: Record<string, unknown>): PagesLayoutModel {
  // Match Pages' A4 fallback used by the reference iwork-converter when an
  // older archive omits document paper dimensions.
  const width = Number(readField<number>(documentValue, ['pageWidth', 'page_width']) ?? 595);
  const height = Number(readField<number>(documentValue, ['pageHeight', 'page_height']) ?? 842);
  const leftMargin = Number(readField<number>(documentValue, ['leftMargin', 'left_margin']) ?? 72);
  const rightMargin = Number(readField<number>(documentValue, ['rightMargin', 'right_margin']) ?? 72);
  const topMargin = Number(readField<number>(documentValue, ['topMargin', 'top_margin']) ?? 72);
  const bottomMargin = Number(readField<number>(documentValue, ['bottomMargin', 'bottom_margin']) ?? 72);
  return {
    width,
    height,
    leftMargin,
    rightMargin,
    topMargin,
    bottomMargin,
    bodyWidth: Math.max(width - leftMargin - rightMargin, 1),
    bodyHeight: Math.max(height - topMargin - bottomMargin, 1)
  };
}

function paginatePagesBodyParagraphsFromLayoutState(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>,
  paragraphs: TextParagraph[],
  paragraphRanges: Array<{ start: number; end: number; text: string }>
): PaginatedPagesBodyPage[] {
  if (!paragraphs.length || !paragraphRanges.length) {
    return [];
  }

  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));
  if (!sectionHints.length) {
    return [];
  }

  const pages: PaginatedPagesBodyPage[] = [];
  const textLength = paragraphRanges[paragraphRanges.length - 1]?.end ?? 0;

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));

    for (let localPageIndex = 0; localPageIndex < pageHints.length; localPageIndex += 1) {
      const pageHint = pageHints[localPageIndex];
      const hintFragments = resolvePagesPageHintTextFragments(pageHint);
      if (!hintFragments.length) {
        continue;
      }

      const pageFragments: PaginatedPagesBodyFragment[] = [];
      for (const hintFragment of hintFragments) {
        const fragment = mapPagesTextRangeToParagraphFragment(paragraphRanges, hintFragment, textLength);
        if (!fragment) {
          pushUniqueArchiveWarning(
            archive,
            'Pages layout target hints split body text inside a paragraph; falling back to estimated paragraph pagination.'
          );
          return [];
        }
        if (fragment.endParagraph > fragment.startParagraph) {
          pageFragments.push(fragment);
        }
      }

      if (!pageFragments.length) {
        continue;
      }

      const normalizedPageFragments = normalizePagesPageFragments(pageFragments);
      pushPagesPageHintLayoutWarnings(archive, pageHint, hintFragments.length, normalizedPageFragments);

      if (normalizedPageFragments.some((fragment, index) =>
        index > 0 && fragmentsOverlapInPage(normalizedPageFragments[index - 1], fragment, paragraphRanges)
      )) {
        pushUniqueArchiveWarning(
          archive,
          'Pages layout target hints overlap body paragraphs; falling back to estimated paragraph pagination.'
        );
        return [];
      }

      pages.push({
        pageIndex: startPageIndex + localPageIndex,
        startParagraph: normalizedPageFragments[0].startParagraph,
        endParagraph: normalizedPageFragments[normalizedPageFragments.length - 1].endParagraph,
        fragments: normalizedPageFragments
      });
    }
  }

  return pages
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .filter((page, index, list) =>
      page.endParagraph > page.startParagraph &&
      (index === 0 || list[index - 1].pageIndex !== page.pageIndex)
    );
}

function fragmentsOverlapInPage(
  previous: PaginatedPagesBodyFragment,
  current: PaginatedPagesBodyFragment,
  paragraphRanges: Array<{ start: number; end: number; text: string }>
): boolean {
  const previousLastParagraph = previous.endParagraph - 1;
  if (current.startParagraph < previousLastParagraph) {
    return true;
  }
  if (current.startParagraph > previousLastParagraph) {
    return false;
  }

  const previousEndOffset =
    previous.endVisibleOffset ??
    stripObjectMarker(paragraphRanges[previousLastParagraph]?.text ?? '').length;
  const currentStartOffset = current.startVisibleOffset ?? 0;
  return currentStartOffset < previousEndOffset;
}

function normalizePagesPageFragments(fragments: PaginatedPagesBodyFragment[]): PaginatedPagesBodyFragment[] {
  const deduped: PaginatedPagesBodyFragment[] = [];

  for (const fragment of fragments) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !pagesFragmentsShareTextBounds(previous, fragment)) {
      deduped.push(fragment);
      continue;
    }

    deduped[deduped.length - 1] = mergePagesEquivalentFragments(previous, fragment);
  }

  const normalized: PaginatedPagesBodyFragment[] = [];
  for (let index = 0; index < deduped.length; index += 1) {
    if (pagesFragmentIsRedundantContainer(deduped, index)) {
      continue;
    }
    normalized.push(deduped[index]);
  }

  return mergePagesImplicitColumnFragments(normalized);
}

function pagesFragmentsShareTextBounds(
  left: PaginatedPagesBodyFragment,
  right: PaginatedPagesBodyFragment
): boolean {
  return left.startParagraph === right.startParagraph &&
    left.endParagraph === right.endParagraph &&
    (left.startVisibleOffset ?? 0) === (right.startVisibleOffset ?? 0) &&
    left.endVisibleOffset === right.endVisibleOffset;
}

function mergePagesEquivalentFragments(
  previous: PaginatedPagesBodyFragment,
  current: PaginatedPagesBodyFragment
): PaginatedPagesBodyFragment {
  return {
    ...previous,
    ...(previous.rect ? {} : current.rect ? { rect: current.rect } : {}),
    ...(previous.columnCount != null ? {} : current.columnCount != null ? { columnCount: current.columnCount } : {})
  };
}

function mergePagesImplicitColumnFragments(
  fragments: PaginatedPagesBodyFragment[]
): PaginatedPagesBodyFragment[] {
  if (fragments.length < 2) {
    return fragments;
  }

  const merged: PaginatedPagesBodyFragment[] = [fragments[0]];

  for (let index = 1; index < fragments.length; index += 1) {
    const current = fragments[index];
    const previous = merged[merged.length - 1];
    if (!previous || !pagesFragmentsCanMergeImplicitColumns(previous, current)) {
      merged.push(current);
      continue;
    }

    merged[merged.length - 1] = {
      ...previous,
      endParagraph: current.endParagraph,
      rangeEnd: current.rangeEnd
    };
  }

  return merged;
}

function pagesFragmentsCanMergeImplicitColumns(
  previous: PaginatedPagesBodyFragment,
  current: PaginatedPagesBodyFragment
): boolean {
  return previous.rect == null &&
    current.rect == null &&
    previous.columnCount != null &&
    previous.columnCount === current.columnCount &&
    previous.startVisibleOffset == null &&
    previous.endVisibleOffset == null &&
    current.startVisibleOffset == null &&
    current.endVisibleOffset == null &&
    previous.rangeEnd != null &&
    current.rangeStart != null &&
    previous.rangeEnd === current.rangeStart &&
    previous.endParagraph === current.startParagraph;
}

function pagesFragmentIsRedundantContainer(
  fragments: PaginatedPagesBodyFragment[],
  index: number
): boolean {
  const fragment = fragments[index];
  const nextFragment = fragments[index + 1];
  if (
    fragment.rangeStart == null ||
    fragment.rangeEnd == null ||
    !nextFragment ||
    nextFragment.rangeStart == null ||
    nextFragment.rangeEnd == null ||
    fragment.rangeStart !== nextFragment.rangeStart ||
    nextFragment.rangeEnd <= fragment.rangeStart ||
    nextFragment.rangeEnd >= fragment.rangeEnd
  ) {
    return false;
  }

  let coveredEnd = nextFragment.rangeEnd;
  for (let scanIndex = index + 2; scanIndex < fragments.length && coveredEnd < fragment.rangeEnd; scanIndex += 1) {
    const candidate = fragments[scanIndex];
    if (
      candidate.rangeStart == null ||
      candidate.rangeEnd == null ||
      candidate.rangeStart !== coveredEnd ||
      candidate.rangeEnd > fragment.rangeEnd
    ) {
      return false;
    }
    coveredEnd = candidate.rangeEnd;
  }

  return coveredEnd >= fragment.rangeEnd;
}

function paginatePagesBodyParagraphs(
  paragraphs: TextParagraph[],
  availableWidth: number,
  availableHeight: number
): PaginatedPagesBodyPage[] {
  if (!paragraphs.length) {
    return [];
  }

  const pages: PaginatedPagesBodyPage[] = [];
  const safeHeight = Math.max(availableHeight, 1);
  let pageStart = 0;
  let consumedHeight = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraphHeight = estimateParagraphHeight(paragraphs[index], availableWidth);
    if (index > pageStart && consumedHeight + paragraphHeight > safeHeight) {
      pages.push({
        pageIndex: pages.length,
        startParagraph: pageStart,
        endParagraph: index,
        fragments: [
          {
            startParagraph: pageStart,
            endParagraph: index
          }
        ]
      });
      pageStart = index;
      consumedHeight = 0;
    }
    consumedHeight += paragraphHeight;
  }

  pages.push({
    pageIndex: pages.length,
    startParagraph: pageStart,
    endParagraph: paragraphs.length,
    fragments: [
      {
        startParagraph: pageStart,
        endParagraph: paragraphs.length
      }
    ]
  });

  return pages.filter((page) => page.endParagraph > page.startParagraph && pageContainsVisibleParagraphs(paragraphs, page.startParagraph, page.endParagraph));
}

function estimateParagraphHeight(paragraph: TextParagraph, availableWidth: number): number {
  const runFontSizes = paragraph.runs
    .map((run) => run.fontSize)
    .filter((size): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0);
  const fontSize = runFontSizes.length ? Math.max(...runFontSizes) : 16;
  const baseLineHeight = typeof paragraph.lineHeight === 'number' && Number.isFinite(paragraph.lineHeight) && paragraph.lineHeight > 0
    ? (paragraph.lineHeightUnit === 'multiple' ? paragraph.lineHeight * fontSize : paragraph.lineHeight)
    : fontSize * 1.2;
  const paragraphText = paragraph.runs.map((run) => stripObjectMarker(run.text)).join('');
  const bulletText = paragraph.bullet?.char ?? (paragraph.bullet?.autoType ? '1.' : '');
  const estimatedWidth = estimateParagraphTextWidth(`${bulletText}${paragraphText || 'M'}`, fontSize);
  const indentAllowance = Math.max(0, (paragraph.marginLeft ?? 0) + Math.abs(paragraph.indent ?? 0));
  const effectiveWidth = Math.max(availableWidth - indentAllowance - 8, fontSize);
  const lineCount = Math.max(1, Math.ceil(estimatedWidth / effectiveWidth));
  return Number(((paragraph.spaceBefore ?? 0) + lineCount * baseLineHeight + (paragraph.spaceAfter ?? 0)).toFixed(3));
}

function estimateParagraphGroupHeight(paragraphs: TextParagraph[], availableWidth: number): number {
  return Number(
    paragraphs
      .reduce((total, paragraph) => total + estimateParagraphHeight(paragraph, availableWidth), 0)
      .toFixed(3)
  );
}

function buildPagesParagraphMetrics(paragraphs: TextParagraph[], availableWidth: number): PagesParagraphMetrics {
  const heights = paragraphs.map((paragraph) => estimateParagraphHeight(paragraph, availableWidth));
  const offsets: number[] = [];
  let totalHeight = 0;
  for (const height of heights) {
    offsets.push(totalHeight);
    totalHeight += height;
  }
  return {
    heights,
    offsets,
    totalHeight
  };
}

function estimateParagraphTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (/\s/u.test(char)) {
      units += 0.33;
      continue;
    }
    if (isWideTextCharacter(char)) {
      units += 1;
      continue;
    }
    if (/[A-Z]/u.test(char)) {
      units += 0.64;
      continue;
    }
    if (/[a-z0-9]/u.test(char)) {
      units += 0.56;
      continue;
    }
    units += 0.5;
  }
  return Math.max(units * fontSize, fontSize);
}

function isWideTextCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    codePoint >= 0x1f300
  );
}

function findBodyPageIndexForParagraph(pages: PaginatedPagesBodyPage[], paragraphIndex: number): number {
  for (const page of pages) {
    if (paragraphIndex < page.endParagraph || page.pageIndex === pages.length - 1) {
      return page.pageIndex;
    }
  }
  return 0;
}

function findBodyPageIndexForCharacter(
  pages: PaginatedPagesBodyPage[],
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  for (const page of pages) {
    if (page.fragments.some((fragment) =>
      fragmentContainsCharacter(fragment, paragraphRanges, characterIndex, anchorParagraphIndex)
    )) {
      return page.pageIndex;
    }
  }
  return findBodyPageIndexForParagraph(pages, anchorParagraphIndex);
}

function pageContainsVisibleParagraphs(paragraphs: TextParagraph[], start: number, end: number): boolean {
  return paragraphs.slice(start, end).some((paragraph) =>
    paragraph.runs.some((run) => stripObjectMarker(run.text).trim().length > 0)
  );
}

function createPagesBodyItems(
  bodyFrame: TextFrame,
  page: PaginatedPagesBodyPage,
  layout: PagesLayoutModel,
  pageIndex: number,
  bodyBlocks: PagesBodyFlowBlock[]
): SlideItem[] {
  const items: SlideItem[] = [];

  page.fragments.forEach((fragment, fragmentIndex) => {
    const fragmentBlocks = bodyBlocks.filter((block) => block.fragmentIndex === fragmentIndex);
    if (!fragmentBlocks.length) {
      return;
    }

    const x = layout.leftMargin + (fragment.rect?.x ?? 0);
    const width = Math.max(fragment.rect?.width ?? layout.bodyWidth, 1);
    const defaultHeight = Math.max(fragment.rect?.height ?? layout.bodyHeight, 1);
    let cursorY = layout.topMargin + (fragment.rect?.y ?? 0);

    fragmentBlocks.forEach((block, blockIndex) => {
      if (block.kind === 'paragraphs' && block.paragraphs?.length) {
        const pageFrame: TextFrame = {
          ...bodyFrame,
          paragraphs: block.paragraphs,
          ...(fragment.columnCount != null ? { columns: fragment.columnCount } : {})
        };
        const isWholeFragmentText =
          fragmentBlocks.length === 1 &&
          blockIndex === 0 &&
          block.kind === 'paragraphs';
        const hasVisibleText = hasVisibleTextFrame(pageFrame);
        const height = isWholeFragmentText && hasVisibleText
          ? defaultHeight
          : Math.max(estimateParagraphGroupHeight(block.paragraphs, width), 1);
        if (!hasVisibleText) {
          cursorY += height;
          return;
        }
        items.push({
          id: `pages-body-${pageIndex + 1}-${fragmentIndex + 1}-${blockIndex + 1}`,
          kind: 'text',
          name: 'Body',
          order: items.length,
          groupPath: [],
          transform: {
            x,
            y: cursorY,
            width,
            height,
            rotation: 0,
            flipH: false,
            flipV: false
          },
          fill: {
            type: 'none'
          },
          textFrame: pageFrame
        });
        cursorY += height;
        return;
      }

      if (block.item) {
        if (block.flowPositioned) {
          block.item.transform.y = cursorY + (block.flowOffsetY ?? 0);
        }
        items.push(block.item);
        cursorY = Math.max(cursorY, block.item.transform.y + Math.max(block.item.transform.height, 0));
      }
    });
  });

  return items;
}

function buildPagesBodyFlowBlocksForPage(
  paragraphs: TextParagraph[],
  page: PaginatedPagesBodyPage,
  inlineAttachments: PagesInlineAttachment[],
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  pageIndex: number,
  sourceRecordId?: number
): PagesBodyFlowBlock[] {
  const blocks: PagesBodyFlowBlock[] = [];

  page.fragments.forEach((fragment, fragmentIndex) => {
    const fragmentAttachments = inlineAttachments.filter((attachment) => attachment.fragmentIndex === fragmentIndex);
    if (fragmentHasPartialParagraphBounds(fragment, paragraphs)) {
      blocks.push(
        ...buildPagesBodyFlowBlocksForPartialFragment(
          paragraphs,
          fragment,
          fragmentAttachments,
          paragraphRanges,
          pageIndex,
          fragmentIndex,
          sourceRecordId
        )
      );
      return;
    }
    let paragraphCursor = fragment.startParagraph;

    const attachmentsByParagraph = new Map<number, PagesInlineAttachment[]>();
    for (const attachment of fragmentAttachments) {
      const bucket = attachmentsByParagraph.get(attachment.anchorParagraphIndex) ?? [];
      bucket.push(attachment);
      attachmentsByParagraph.set(attachment.anchorParagraphIndex, bucket);
    }

    const anchoredParagraphIndexes = Array.from(attachmentsByParagraph.keys()).sort((left, right) => left - right);
    for (const paragraphIndex of anchoredParagraphIndexes) {
      const leadingParagraphBlock = buildParagraphBlock(
        `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphCursor}-${paragraphIndex}`,
        paragraphs,
        paragraphCursor,
        Math.min(fragment.endParagraph, paragraphIndex),
        sourceRecordId
      );
      if (leadingParagraphBlock) {
        blocks.push({
          ...leadingParagraphBlock,
          fragmentIndex
        });
      }

      const paragraph = paragraphs[paragraphIndex];
      const visibleParagraphLength = collectParagraphVisibleText(paragraph).length;
      let visibleCursor = 0;
      const paragraphAttachments = (attachmentsByParagraph.get(paragraphIndex) ?? [])
        .slice()
        .sort((left, right) => left.characterIndex - right.characterIndex);

      for (const attachment of paragraphAttachments) {
        const splitOffset = resolvePagesAttachmentVisibleSplit(paragraphRanges, attachment.characterIndex, attachment.anchorParagraphIndex);
        const prefixBlock = buildParagraphSliceBlock(
          `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${splitOffset}`,
          paragraph,
          visibleCursor,
          splitOffset,
          sourceRecordId
        );
        if (prefixBlock) {
          blocks.push({
            ...prefixBlock,
            fragmentIndex
          });
        }

        blocks.push({
          ...attachment.block,
          fragmentIndex,
          flowPositioned: attachment.flowPositioned,
          flowOffsetY: attachment.flowOffsetY
        });
        visibleCursor = splitOffset;
      }

      const trailingBlock = buildParagraphSliceBlock(
        `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${visibleParagraphLength}`,
        paragraph,
        visibleCursor,
        visibleParagraphLength,
        sourceRecordId
      );
      if (trailingBlock) {
        blocks.push({
          ...trailingBlock,
          fragmentIndex
        });
      }

      paragraphCursor = Math.min(fragment.endParagraph, paragraphIndex + 1);
    }

    const trailingBlock = buildParagraphBlock(
      `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphCursor}-${fragment.endParagraph}`,
      paragraphs,
      paragraphCursor,
      fragment.endParagraph,
      sourceRecordId
    );
    if (trailingBlock) {
      blocks.push({
        ...trailingBlock,
        fragmentIndex
      });
    }
  });

  return blocks;
}

function fragmentHasPartialParagraphBounds(
  fragment: PaginatedPagesBodyFragment,
  paragraphs: TextParagraph[]
): boolean {
  if ((fragment.startVisibleOffset ?? 0) > 0) {
    return true;
  }

  if (fragment.endVisibleOffset == null || fragment.endParagraph <= fragment.startParagraph) {
    return false;
  }

  const lastParagraph = paragraphs[fragment.endParagraph - 1];
  const lastParagraphLength = collectParagraphVisibleText(lastParagraph).length;
  return fragment.endVisibleOffset < lastParagraphLength;
}

function buildPagesBodyFlowBlocksForPartialFragment(
  paragraphs: TextParagraph[],
  fragment: PaginatedPagesBodyFragment,
  fragmentAttachments: PagesInlineAttachment[],
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  pageIndex: number,
  fragmentIndex: number,
  sourceRecordId?: number
): PagesBodyFlowBlock[] {
  const blocks: PagesBodyFlowBlock[] = [];
  const attachmentsByParagraph = new Map<number, Array<PagesInlineAttachment & { visibleOffset: number }>>();

  for (const attachment of fragmentAttachments) {
    const visibleOffset = resolvePagesCharacterVisibleSplit(
      paragraphRanges,
      attachment.characterIndex,
      attachment.anchorParagraphIndex
    );
    const bucket = attachmentsByParagraph.get(attachment.anchorParagraphIndex) ?? [];
    bucket.push({
      ...attachment,
      visibleOffset
    });
    attachmentsByParagraph.set(attachment.anchorParagraphIndex, bucket);
  }

  for (let paragraphIndex = fragment.startParagraph; paragraphIndex < fragment.endParagraph; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const paragraphLength = collectParagraphVisibleText(paragraph).length;
    const paragraphStart =
      paragraphIndex === fragment.startParagraph
        ? Math.max(0, fragment.startVisibleOffset ?? 0)
        : 0;
    const paragraphEnd =
      paragraphIndex === fragment.endParagraph - 1
        ? Math.min(fragment.endVisibleOffset ?? paragraphLength, paragraphLength)
        : paragraphLength;
    if (paragraphEnd <= paragraphStart) {
      continue;
    }

    let visibleCursor = paragraphStart;
    const paragraphAttachments = (attachmentsByParagraph.get(paragraphIndex) ?? [])
      .filter((attachment) => attachment.visibleOffset >= paragraphStart && attachment.visibleOffset <= paragraphEnd)
      .sort((left, right) => left.visibleOffset - right.visibleOffset);

    for (const attachment of paragraphAttachments) {
      const prefixBlock = buildParagraphSliceBlock(
        `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${attachment.visibleOffset}`,
        paragraph,
        visibleCursor,
        attachment.visibleOffset,
        sourceRecordId
      );
      if (prefixBlock) {
        blocks.push({
          ...prefixBlock,
          fragmentIndex
        });
      }

      blocks.push({
        ...attachment.block,
        fragmentIndex,
        flowPositioned: attachment.flowPositioned,
        flowOffsetY: attachment.flowOffsetY
      });
      visibleCursor = attachment.visibleOffset;
    }

    const trailingBlock = buildParagraphSliceBlock(
      `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${paragraphEnd}`,
      paragraph,
      visibleCursor,
      paragraphEnd,
      sourceRecordId
    );
    if (trailingBlock) {
      blocks.push({
        ...trailingBlock,
        fragmentIndex
      });
    }
  }

  return blocks;
}

function buildPagesBodyBlocksForPage(
  paragraphs: TextParagraph[],
  page: PaginatedPagesBodyPage,
  inlineAttachments: PagesInlineAttachment[],
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  pageIndex: number,
  sourceRecordId?: number
): PagesBodyBlock[] {
  return buildPagesBodyFlowBlocksForPage(
    paragraphs,
    page,
    inlineAttachments,
    paragraphRanges,
    pageIndex,
    sourceRecordId
  ).map(toPagesBodyBlock);
}

function toPagesBodyBlock(block: PagesBodyFlowBlock): PagesBodyBlock {
  return {
    id: block.id,
    kind: block.kind,
    paragraphs: block.paragraphs,
    item: block.item,
    sourceRecordId: block.sourceRecordId
  };
}

function buildPagesFloatingGroups(
  context: SemanticBuildContext,
  documentValue: Record<string, unknown>
): Map<number, PagesFloatingGroup> {
  const groups = new Map<number, PagesFloatingGroup>();
  const floatingArchive = getRecordValue<Record<string, unknown>>(context.archive, readField(documentValue, ['floatingDrawables', 'floating_drawables']));
  const pageGroups = asArray<Record<string, unknown>>(readField(floatingArchive, ['pageGroups', 'page_groups']));

  for (const pageGroup of pageGroups) {
    const pageIndex = Math.max(0, Number(readField<number>(pageGroup, ['pageIndex', 'page_index']) ?? 0));
    const group = groups.get(pageIndex) ?? {
      backgroundItems: [],
      drawableItems: [],
      foregroundItems: [],
      blocks: [],
      seenRecordIds: new Set<number>()
    };
    appendPagesFloatingEntries(context, pageIndex, group, asArray<Record<string, unknown>>(readField(pageGroup, ['backgroundDrawables', 'background_drawables'])), group.backgroundItems);
    appendPagesFloatingEntries(context, pageIndex, group, asArray<Record<string, unknown>>(readField(pageGroup, ['drawables'])), group.drawableItems);
    appendPagesFloatingEntries(context, pageIndex, group, asArray<Record<string, unknown>>(readField(pageGroup, ['foregroundDrawables', 'foreground_drawables'])), group.foregroundItems);
    groups.set(pageIndex, group);
  }

  return groups;
}

function appendPagesFloatingEntries(
  context: SemanticBuildContext,
  pageIndex: number,
  group: PagesFloatingGroup,
  entries: Array<Record<string, unknown>>,
  target: SlideItem[]
): void {
  for (const entry of entries) {
    const drawableRef = readField(entry, ['drawable']);
    const drawableRecord = getRecord(context.archive, drawableRef);
    const drawable = asObject(drawableRecord?.value);
    if (!drawable || (drawableRecord?.id != null && group.seenRecordIds.has(drawableRecord.id))) {
      continue;
    }

    const item = buildDrawableItem(context, drawable, target.length);
    if (!item) {
      continue;
    }

    target.push(item);
    group.blocks.push({
      id: `pages-floating-${pageIndex + 1}-${group.blocks.length + 1}`,
      kind: item.kind === 'table' ? 'table' : 'drawable',
      item,
      sourceRecordId: drawableRecord?.id
    });
    const pencilItems = buildPencilAnnotationItems(context, drawable, target.length);
    target.push(...pencilItems);
    pencilItems.forEach((pencilItem) => {
      group.blocks.push({
        id: `pages-floating-${pageIndex + 1}-${group.blocks.length + 1}`,
        kind: 'drawable',
        item: pencilItem,
        sourceRecordId: drawableRecord?.id
      });
    });
    if (drawableRecord?.id != null) {
      group.seenRecordIds.add(drawableRecord.id);
    }
  }
}

function maxPageIndexFromFloatingGroups(groups: Map<number, PagesFloatingGroup>): number {
  let maxPageIndex = -1;
  for (const pageIndex of groups.keys()) {
    maxPageIndex = Math.max(maxPageIndex, pageIndex);
  }
  return maxPageIndex;
}

function maxPageIndexFromAttachmentHints(hints: Map<number, PagesAttachmentPositionHint>): number {
  let maxPageIndex = -1;
  for (const hint of hints.values()) {
    maxPageIndex = Math.max(maxPageIndex, hint.pageIndex);
  }
  return maxPageIndex;
}

function normalizePagesSectionEntries(sectionTableLike: unknown): PagesSectionEntry[] {
  return asArray<Record<string, unknown>>(readField(asObject(sectionTableLike), ['entries']))
    .map((entry) => ({
      index: Number(readField<number>(entry, ['characterIndex', 'character_index']) ?? 0),
      refId: getRefId(readField(entry, ['object']))
    }))
    .sort((left, right) => left.index - right.index);
}

function buildPagesSectionStates(
  documentValue: Record<string, unknown>,
  bodyPages: PaginatedPagesBodyPage[],
  totalPages: number,
  sectionEntries: PagesSectionEntry[],
  paragraphRanges: Array<{ start: number; end: number; text: string }>
): PagesSectionState[] {
  const states: PagesSectionState[] = [];
  const defaultSectionRefId = getRefId(readField(documentValue, ['section'])) ?? sectionEntries[0]?.refId;
  let previousSectionRefId = defaultSectionRefId;
  let previousSectionPageIndex = 0;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const bodyPage = bodyPages[pageIndex];
    const startCharacterIndex = bodyPage
      ? Number(paragraphRanges[bodyPage.startParagraph]?.start ?? 0)
      : undefined;
    const resolvedSectionRefId = startCharacterIndex != null
      ? resolvePagesSectionRefIdForCharacter(documentValue, startCharacterIndex, sectionEntries)
      : previousSectionRefId ?? defaultSectionRefId;
    const sectionRefId = resolvedSectionRefId ?? previousSectionRefId ?? defaultSectionRefId;
    const sectionPageIndex = pageIndex === 0 || sectionRefId !== previousSectionRefId
      ? 1
      : previousSectionPageIndex + 1;

    states.push({
      sectionRefId,
      sectionPageIndex
    });
    previousSectionRefId = sectionRefId;
    previousSectionPageIndex = sectionPageIndex;
  }

  return states;
}

function resolvePagesSectionRefIdForCharacter(
  documentValue: Record<string, unknown>,
  characterIndex: number,
  sectionEntries: PagesSectionEntry[]
): number | undefined {
  let sectionRefId = getRefId(readField(documentValue, ['section']));
  for (const entry of sectionEntries) {
    if (entry.index > characterIndex) {
      break;
    }
    if (entry.refId != null) {
      sectionRefId = entry.refId;
    }
  }
  return sectionRefId;
}

function findPagesBodyPageByIndex(
  pages: PaginatedPagesBodyPage[],
  pageIndex: number
): PaginatedPagesBodyPage | undefined {
  return pages.find((page) => page.pageIndex === pageIndex);
}

function hasAbsolutePagesAttachmentPosition(
  hint: PagesAttachmentPositionHint | undefined
): hint is PagesAttachmentPositionHint & { x: number; y: number } {
  return hint != null && Number.isFinite(hint.x) && Number.isFinite(hint.y);
}

function resolvePagesTableItemPartitions(
  item: TableItem,
  startPageIndex: number,
  hints: PagesTablePartitionHint[]
): Array<{ pageIndex: number; item: TableItem }> {
  const firstHint = hints.find((hint) =>
    hint.pageIndex === startPageIndex &&
    hint.rowStart === 0 &&
    hint.columnStart === 0 &&
    hint.columnCount === item.columns.length &&
    hint.rowCount > 0 &&
    hint.rowCount <= item.rows.length
  );
  if (!firstHint) {
    return [];
  }

  const matchedHints = [firstHint];
  let coveredRows = firstHint.rowCount;
  while (coveredRows < item.rows.length) {
    const nextHint = hints.find((hint) =>
      hint.pageIndex > matchedHints[matchedHints.length - 1].pageIndex &&
      hint.rowStart === coveredRows &&
      hint.columnStart === 0 &&
      hint.columnCount === item.columns.length &&
      hint.rowCount > 0 &&
      coveredRows + hint.rowCount <= item.rows.length
    );
    if (!nextHint) {
      return [];
    }
    matchedHints.push(nextHint);
    coveredRows += nextHint.rowCount;
  }

  return matchedHints.map((hint, index) => ({
    pageIndex: hint.pageIndex,
    item: slicePagesTableItem(item, hint.rowStart, hint.rowCount, index)
  }));
}

function slicePagesTableItem(item: TableItem, rowStart: number, rowCount: number, partIndex: number): TableItem {
  const rowEnd = Math.min(item.rows.length, rowStart + rowCount);
  const rows = item.rows.slice(rowStart, rowEnd);
  const cells = item.cells.flatMap((cell) => {
    if (cell.isMergedContinuation) {
      return [];
    }
    const overlapStart = Math.max(cell.row, rowStart);
    const overlapEnd = Math.min(cell.row + Math.max(cell.rowSpan, 1), rowEnd);
    if (overlapEnd <= overlapStart) {
      return [];
    }
    return [{
      ...cell,
      row: overlapStart - rowStart,
      rowSpan: overlapEnd - overlapStart
    }];
  });
  const hiddenRows = item.hiddenRows
    ?.filter((row) => row >= rowStart && row < rowEnd)
    .map((row) => row - rowStart);

  return {
    ...item,
    id: `${item.id}-part-${partIndex + 1}`,
    transform: {
      ...item.transform,
      height: rows.reduce((total, height) => total + height, 0)
    },
    rows,
    cells,
    hiddenRows: hiddenRows?.length ? hiddenRows : undefined
  };
}

function buildPagesTablePartitionHints(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): PagesTablePartitionHint[] {
  const hints: PagesTablePartitionHint[] = [];
  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));
    for (let localPageIndex = 0; localPageIndex < pageHints.length; localPageIndex += 1) {
      const childRefs = asArray<unknown>(readField(pageHints[localPageIndex], ['childHints', 'child_hints']));
      for (const childRef of childRefs) {
        const childRecord = getRecord(archive, childRef);
        if (childRecord?.typeName !== 'TST.LayoutHintArchive') {
          continue;
        }
        const childHint = asObject(childRecord.value);
        if (!childHint || readField<boolean>(childHint, ['isValid', 'is_valid']) === false) {
          continue;
        }
        const range = resolvePagesTablePartitionRange(asObject(readField(childHint, ['cellRange', 'cell_range'])));
        if (!range || range.rowCount <= 0 || range.columnCount <= 0) {
          continue;
        }
        hints.push({
          pageIndex: startPageIndex + localPageIndex,
          ...range
        });
      }
    }
  }

  return hints.sort((left, right) => left.pageIndex - right.pageIndex || left.rowStart - right.rowStart);
}

function resolvePagesTablePartitionRange(cellRange: Record<string, unknown> | undefined): Omit<PagesTablePartitionHint, 'pageIndex'> | undefined {
  if (!cellRange) {
    return undefined;
  }
  const origin = asObject(readField(cellRange, ['origin']));
  const expandedOrigin = asObject(readField(origin, ['expandedCoord', 'expanded_coord']));
  const size = asObject(readField(cellRange, ['size']));
  const rowStart = Number(readField<number>(expandedOrigin, ['row']) ?? 0);
  const columnStart = Number(readField<number>(expandedOrigin, ['column']) ?? 0);
  const packedSize = Number(readField<number>(size, ['packedData', 'packed_data']) ?? 0) >>> 0;
  const rowCount = Number(readField<number>(size, ['numRows', 'num_rows']) ?? (packedSize & 0xffff));
  const columnCount = Number(readField<number>(size, ['numColumns', 'num_columns']) ?? (packedSize >>> 16));
  if (![rowStart, columnStart, rowCount, columnCount].every(Number.isFinite)) {
    return undefined;
  }
  return {
    rowStart: Math.max(0, Math.trunc(rowStart)),
    rowCount: Math.max(0, Math.trunc(rowCount)),
    columnStart: Math.max(0, Math.trunc(columnStart)),
    columnCount: Math.max(0, Math.trunc(columnCount))
  };
}

function buildPagesAttachmentPositionHints(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): Map<number, PagesAttachmentPositionHint> {
  const hints = new Map<number, PagesAttachmentPositionHint>();
  const objectIdsByUuid = buildPagesObjectIdsByUuid(archive.packageMetadata);
  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));
    for (let localPageIndex = 0; localPageIndex < pageHints.length; localPageIndex += 1) {
      const pageHint = pageHints[localPageIndex];
      const pageIndex = startPageIndex + localPageIndex;
      const partitionedAttachmentUuids = asArray<unknown>(readField(pageHint, ['partitionedAttachmentUuids', 'partitioned_attachment_uuids']));
      for (const uuid of partitionedAttachmentUuids) {
        const uuidKey = pagesUuidToKey(uuid);
        const drawableId = uuidKey ? objectIdsByUuid.get(uuidKey) : undefined;
        if (drawableId != null && !hints.has(drawableId)) {
          hints.set(drawableId, { pageIndex });
        }
      }
      const anchoredAttachments = asArray<Record<string, unknown>>(readField(pageHint, ['anchoredAttachmentsMap', 'anchored_attachments_map']));
      for (const anchoredAttachment of anchoredAttachments) {
        const attachmentId = getRefId(readField(anchoredAttachment, ['attachment']));
        const anchorPosition = asObject(readField(anchoredAttachment, ['doublePosition', 'double_position'])) ??
          asObject(readField(anchoredAttachment, ['position']));
        const x = Number(readField<number>(anchorPosition, ['x']) ?? NaN);
        const y = Number(readField<number>(anchorPosition, ['y']) ?? NaN);
        if (attachmentId == null || !Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }
        hints.set(attachmentId, {
          pageIndex,
          x,
          y
        });
      }
    }
  }

  return hints;
}

function buildPagesObjectIdsByUuid(packageMetadata: unknown): Map<string, number> {
  const ids = new Map<string, number>();
  const components = asArray<Record<string, unknown>>(readField(asObject(packageMetadata), ['components']));
  for (const component of components) {
    const entries = asArray<Record<string, unknown>>(readField(component, ['objectUuidMapEntries', 'object_uuid_map_entries']));
    for (const entry of entries) {
      const key = pagesUuidToKey(readField(entry, ['uuid']));
      const identifier = Number(readField<number>(entry, ['identifier']) ?? NaN);
      if (key && Number.isFinite(identifier)) {
        ids.set(key, identifier);
      }
    }
  }
  return ids;
}

function pagesUuidToKey(value: unknown): string | undefined {
  const uuid = asObject(value);
  if (!uuid) {
    return undefined;
  }
  const lower = readField<number | string>(uuid, ['lower']);
  const upper = readField<number | string>(uuid, ['upper']);
  if (lower == null && upper == null) {
    return undefined;
  }
  return `${String(upper ?? 0)}:${String(lower ?? 0)}`;
}

function resolvePagesPageHintTextFragments(pageHint: Record<string, unknown> | undefined): PagesTextHintFragment[] {
  const targetHints = asArray<Record<string, unknown>>(readField(pageHint, ['targetHints', 'target_hints']));
  const flowHints = asArray<Record<string, unknown>>(readField(pageHint, ['flowHints', 'flow_hints']));
  const textHints = targetHints.length ? targetHints : flowHints;
  const fragments: PagesTextHintFragment[] = [];

  for (const hint of textHints) {
    const range = asObject(readField(hint, ['range'])) ?? asObject(readField(hint, ['anchoredRange', 'anchored_range']));
    const location = Number(readField<number>(range, ['location']) ?? NaN);
    const length = Number(readField<number>(range, ['length']) ?? NaN);
    if (!Number.isFinite(location) || !Number.isFinite(length) || length <= 0) {
      continue;
    }

    const rect = resolvePagesTextHintRect(hint);
    const columnCount = normalizePagesTextHintColumnCount(readField<number>(hint, ['columnCount', 'column_count']));
    fragments.push({
      range: {
        location,
        length
      },
      ...(rect ? { rect } : {}),
      ...(columnCount != null ? { columnCount } : {})
    });
  }

  return fragments.sort((left, right) =>
    left.range.location - right.range.location ||
    (right.range.location + right.range.length) - (left.range.location + left.range.length)
  );
}

function resolvePagesTextHintRect(hint: Record<string, unknown> | undefined): PagesBodyFragmentRect | undefined {
  const origin = asObject(readField(hint, ['doubleOrigin', 'double_origin'])) ?? asObject(readField(hint, ['frameOrigin', 'frame_origin']));
  const size = asObject(readField(hint, ['doubleSize', 'double_size'])) ?? asObject(readField(hint, ['frameSize', 'frame_size']));
  const x = Number(readField<number>(origin, ['x']) ?? NaN);
  const y = Number(readField<number>(origin, ['y']) ?? NaN);
  const width = Number(readField<number>(size, ['width']) ?? NaN);
  const height = Number(readField<number>(size, ['height']) ?? NaN);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  return {
    x,
    y,
    width,
    height
  };
}

function pushPagesPageHintLayoutWarnings(
  archive: IworkArchiveIndex,
  pageHint: Record<string, unknown> | undefined,
  fragmentCount: number,
  normalizedFragments?: PaginatedPagesBodyFragment[]
): void {
  const textHints = [
    ...asArray<Record<string, unknown>>(readField(pageHint, ['targetHints', 'target_hints'])),
    ...asArray<Record<string, unknown>>(readField(pageHint, ['flowHints', 'flow_hints']))
  ];

  for (const hint of textHints) {
    const columnCount = normalizePagesTextHintColumnCount(readField<number>(hint, ['columnCount', 'column_count'])) ?? 1;
    const normalizedFragmentCount = resolvePagesHintColumnFragmentCount(columnCount, normalizedFragments);
    const effectiveFragmentCount = normalizedFragmentCount ?? fragmentCount;
    if (
      columnCount > 1 &&
      effectiveFragmentCount > 1 &&
      effectiveFragmentCount < columnCount &&
      !pagesTextHintHasExplicitFragmentGeometry(hint)
    ) {
      pushUniqueArchiveWarning(
        archive,
        `Pages text hint column count ${columnCount} is not fully supported; using fragment-based fallback.`
      );
    }
  }
}

function pagesTextHintHasExplicitFragmentGeometry(hint: Record<string, unknown> | undefined): boolean {
  return Boolean(resolvePagesTextHintRect(hint));
}

function resolvePagesHintColumnFragmentCount(
  columnCount: number,
  fragments: PaginatedPagesBodyFragment[] | undefined
): number | undefined {
  if (!fragments?.length) {
    return undefined;
  }

  const matchingFragments = fragments.filter((fragment) =>
    fragment.columnCount === columnCount &&
    fragment.rect == null
  );
  return matchingFragments.length || undefined;
}

function mapPagesTextRangeToParagraphFragment(
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  hintFragment: PagesTextHintFragment,
  textLength: number
): PaginatedPagesBodyFragment | undefined {
  if (!paragraphRanges.length) {
    return undefined;
  }

  const startParagraph = findParagraphIndexForCharacter(paragraphRanges, hintFragment.range.location);
  const startParagraphStart = paragraphRanges[startParagraph]?.start ?? 0;
  const startVisibleOffset = resolvePagesCharacterVisibleSplit(
    paragraphRanges,
    hintFragment.range.location,
    startParagraph
  );

  const rangeEnd = Math.min(textLength, hintFragment.range.location + hintFragment.range.length);
  const endParagraph = findParagraphEndIndexForCharacter(paragraphRanges, rangeEnd);
  const endParagraphStart = paragraphRanges[endParagraph]?.start ?? textLength;
  const lastParagraphIndex = Math.max(Math.min(endParagraph - 1, paragraphRanges.length - 1), startParagraph);
  const lastParagraphVisibleLength = stripObjectMarker(paragraphRanges[lastParagraphIndex]?.text ?? '').length;
  const endVisibleOffset =
    rangeEnd !== textLength && rangeEnd !== endParagraphStart
      ? resolvePagesCharacterVisibleSplit(paragraphRanges, rangeEnd, lastParagraphIndex)
      : undefined;
  const normalizedEndParagraph = Math.max(endParagraph, startParagraph + 1);
  if (normalizedEndParagraph <= startParagraph) {
    return undefined;
  }

  return {
    startParagraph,
    endParagraph: normalizedEndParagraph,
    rangeStart: hintFragment.range.location,
    rangeEnd,
    rect: hintFragment.rect,
    columnCount: hintFragment.columnCount,
    ...(hintFragment.range.location !== startParagraphStart ? { startVisibleOffset } : {}),
    ...(endVisibleOffset != null && endVisibleOffset < lastParagraphVisibleLength ? { endVisibleOffset } : {})
  };
}

function normalizePagesTextHintColumnCount(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1) {
    return undefined;
  }
  return Math.max(2, Math.round(value));
}

function resolvePagesLayoutStatePageCount(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): number {
  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));
  let maxPageCount = 0;

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));
    maxPageCount = Math.max(maxPageCount, startPageIndex + pageHints.length);
  }

  return maxPageCount;
}

function resolvePagesLayoutState(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): Record<string, unknown> | undefined {
  const preferredLayoutState = getRecordValue<Record<string, unknown>>(
    archive,
    readField(documentValue, ['deprecatedLayoutState', 'deprecated_layout_state', 'layoutState', 'layout_state'])
  );
  if (preferredLayoutState) {
    const sectionHints = asArray<Record<string, unknown>>(readField(preferredLayoutState, ['sectionHints', 'section_hints']));
    if (sectionHints.length) {
      return preferredLayoutState;
    }
    const normalizedLegacyState = normalizeLegacyPagesViewState(documentValue, preferredLayoutState);
    if (normalizedLegacyState) {
      return normalizedLegacyState;
    }
  }

  const layoutStateFromViewStateRoot = resolvePagesLayoutStateFromViewStateRoot(archive);
  if (layoutStateFromViewStateRoot) {
    return layoutStateFromViewStateRoot;
  }

  const layoutState = asObject(findRecordByType(archive, 'TP.LayoutStateArchive')?.value);
  if (layoutState) {
    return layoutState;
  }
  const legacyViewState = asObject(findRecordByType(archive, 'TSK.ViewStateArchive')?.value);
  return legacyViewState ? normalizeLegacyPagesViewState(documentValue, legacyViewState) : undefined;
}

function resolvePagesLayoutStateFromViewStateRoot(
  archive: IworkArchiveIndex
): Record<string, unknown> | undefined {
  const viewStateRecord = findRecordByType(archive, 'TSK.ViewStateArchive');
  const viewStateValue = asObject(viewStateRecord?.value);
  if (!viewStateRecord || !viewStateValue) {
    return undefined;
  }

  const viewStateRoot = getRecordValue<Record<string, unknown>>(
    archive,
    readField(viewStateValue, ['viewStateRoot', 'view_state_root'])
  );
  if (!viewStateRoot) {
    return undefined;
  }

  const layoutStateRef = readField(viewStateRoot, ['layoutState', 'layout_state']);
  const explicitLayoutState = getRecordValue<Record<string, unknown>>(archive, layoutStateRef);
  const explicitSectionHints = asArray<Record<string, unknown>>(readField(explicitLayoutState, ['sectionHints', 'section_hints']));
  if (explicitSectionHints.length) {
    return explicitLayoutState;
  }

  const outgoingRefs = archive.references.outgoing[String(findRecordIdByValue(archive, viewStateRoot) ?? '')] ?? [];
  for (const recordId of outgoingRefs) {
    const record = archive.records[String(recordId)];
    const value = asObject(record?.value);
    if (!value || record?.typeName !== 'TP.LayoutStateArchive') {
      continue;
    }
    const sectionHints = asArray<Record<string, unknown>>(readField(value, ['sectionHints', 'section_hints']));
    if (sectionHints.length) {
      return value;
    }
  }

  return undefined;
}

function normalizeLegacyPagesViewState(
  documentValue: Record<string, unknown>,
  viewState: Record<string, unknown>
): Record<string, unknown> | undefined {
  const bodyStorageId = getRefId(readField(documentValue, ['bodyStorage', 'body_storage']));
  const pageHintTargets = asArray<Record<string, unknown>>(readField(viewState, ['pageHintForTarget', 'page_hint_for_target']));
  const matchingTarget = pageHintTargets.find((entry) => getRefId(readField(entry, ['target'])) === bodyStorageId);
  if (!matchingTarget) {
    return undefined;
  }

  const pageInfos = asArray<Record<string, unknown>>(readField(matchingTarget, ['pageInfos', 'page_infos']));
  if (!pageInfos.length) {
    return undefined;
  }

  const leftMargin = Number(readField<number>(documentValue, ['leftMargin', 'left_margin']) ?? 0);
  const topMargin = Number(readField<number>(documentValue, ['topMargin', 'top_margin']) ?? 0);
  const pageHintMap = new Map<number, Record<string, unknown>>();

  for (const pageInfo of pageInfos) {
    const pageIndex = Math.max(0, Number(readField<number>(pageInfo, ['pageIndex', 'page_index']) ?? 0));
    const bodyPageHint = asObject(readField(pageInfo, ['bodyPageHint', 'body_page_hint']));
    const targetInfos = asArray<Record<string, unknown>>(readField(bodyPageHint, ['targetInfos', 'target_infos']));
    if (!targetInfos.length) {
      continue;
    }

    const targetHints = targetInfos.map((targetInfo) => {
      const rect = asObject(readField(targetInfo, ['rect']));
      const origin = asObject(readField(rect, ['origin']));
      const size = asObject(readField(rect, ['size']));
      return {
        range: readField(targetInfo, ['range']),
        doubleOrigin: {
          x: Number(readField<number>(origin, ['x']) ?? 0) - leftMargin,
          y: Number(readField<number>(origin, ['y']) ?? 0) - topMargin
        },
        doubleSize: {
          width: Number(readField<number>(size, ['width']) ?? 0),
          height: Number(readField<number>(size, ['height']) ?? 0)
        }
      };
    });

    pageHintMap.set(pageIndex, {
      targetHints
    });
  }

  if (!pageHintMap.size) {
    return undefined;
  }

  const maxPageIndex = Math.max(...pageHintMap.keys());
  const pageHints = Array.from({ length: maxPageIndex + 1 }, (_, pageIndex) => pageHintMap.get(pageIndex) ?? {});
  return {
    sectionHints: [
      {
        startPageIndex: 0,
        pageHints
      }
    ]
  };
}

function resolvePagesSectionForPage(
  context: SemanticBuildContext,
  documentValue: Record<string, unknown>,
  pageIndex: number,
  pageCount: number,
  sectionState: PagesSectionState | undefined,
  settings: Record<string, unknown> | undefined
): PagesResolvedSection {
  const sectionRefId = sectionState?.sectionRefId ?? getRefId(readField(documentValue, ['section']));
  const section = sectionRefId != null ? getRecordValue<Record<string, unknown>>(context.archive, { identifier: sectionRefId }) : undefined;
  const sectionTemplate = section
    ? getRecordValue<Record<string, unknown>>(context.archive, readField(section, ['userDefinedGuideStorage', 'user_defined_guide_storage']))
    : undefined;
  const documentPageNumber = pageIndex + 1;
  const sectionPageIndex = Math.max(1, Number(sectionState?.sectionPageIndex ?? 1));
  const pageNumberKind = Number(readField<number>(section, ['sectionPageNumberKind', 'section_page_number_kind']) ?? 0);
  const pageNumber = resolvePagesDisplayPageNumber(context.archive, section, sectionPageIndex, documentPageNumber);
  const pageNumberText = formatPagesPageNumber(context.archive, pageNumber, pageNumberKind);
  const pageCountText = formatPagesPageNumber(context.archive, pageCount, pageNumberKind);
  const pageTemplateRef = resolvePagesTemplateRef(section, sectionPageIndex);
  const pageTemplateRecord = pageTemplateRef != null ? getRecord(context.archive, { identifier: pageTemplateRef }) : undefined;
  const pageTemplateValue = asObject(pageTemplateRecord?.value);

  return {
    sectionRefId,
    section,
    sectionTemplate,
    pageTemplateRecord: pageTemplateRecord && pageTemplateValue
      ? {
          id: pageTemplateRecord.id,
          typeName: pageTemplateRecord.typeName,
          value: pageTemplateValue
        }
      : undefined,
    documentPageNumber,
    sectionPageIndex,
    pageNumber,
    pageNumberText,
    pageCount,
    pageCountText,
    headersEnabled: isPagesHeaderFooterSettingEnabled(settings, 'headers'),
    footersEnabled: isPagesHeaderFooterSettingEnabled(settings, 'footers')
  };
}

function resolvePagesDisplayPageNumber(
  archive: IworkArchiveIndex,
  section: Record<string, unknown> | undefined,
  sectionPageIndex: number,
  documentPageNumber: number
): number {
  const pageNumberKind = Number(readField<number>(section, ['sectionPageNumberKind', 'section_page_number_kind']) ?? 0);
  if (!isSupportedPagesPageNumberKind(pageNumberKind)) {
    pushUniqueArchiveWarning(
      archive,
      `Pages section page number kind ${pageNumberKind} is not fully supported; using numeric fallback.`
    );
  }
  const pageNumberStart = readField<number>(section, ['sectionPageNumberStart', 'section_page_number_start']);
  if (typeof pageNumberStart === 'number' && Number.isFinite(pageNumberStart) && pageNumberStart > 0) {
    return pageNumberStart + Math.max(sectionPageIndex - 1, 0);
  }
  return documentPageNumber;
}

function isSupportedPagesPageNumberKind(pageNumberKind: number): boolean {
  return pageNumberKind >= 0 && pageNumberKind <= 4;
}

function formatPagesPageNumber(
  archive: IworkArchiveIndex,
  value: number,
  pageNumberKind: number
): string {
  const normalizedValue = Math.max(1, Math.trunc(value));
  switch (pageNumberKind) {
    case 0:
      return String(normalizedValue);
    case 1:
      return toRomanNumeral(normalizedValue).toUpperCase();
    case 2:
      return toRomanNumeral(normalizedValue).toLowerCase();
    case 3:
      return toAlphabeticSequence(normalizedValue).toUpperCase();
    case 4:
      return toAlphabeticSequence(normalizedValue).toLowerCase();
    default:
      pushUniqueArchiveWarning(
        archive,
        `Pages section page number kind ${pageNumberKind} is not fully supported; using numeric fallback.`
      );
      return String(normalizedValue);
  }
}

function toRomanNumeral(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];
  let remainder = Math.max(1, Math.trunc(value));
  let output = '';
  for (const [amount, symbol] of numerals) {
    while (remainder >= amount) {
      output += symbol;
      remainder -= amount;
    }
  }
  return output || 'I';
}

function toAlphabeticSequence(value: number): string {
  let remainder = Math.max(1, Math.trunc(value));
  let output = '';
  while (remainder > 0) {
    remainder -= 1;
    output = String.fromCharCode(65 + (remainder % 26)) + output;
    remainder = Math.floor(remainder / 26);
  }
  return output || 'A';
}

function isPagesHeaderFooterSettingEnabled(
  settings: Record<string, unknown> | undefined,
  field: 'headers' | 'footers'
): boolean {
  return readField<boolean>(settings, [field]) !== false;
}

function resolvePagesTemplateRef(section: Record<string, unknown> | undefined, pageNumber: number): number | undefined {
  if (!section) {
    return undefined;
  }

  if (pageNumber === 1) {
    const firstRef = getRefId(readField(section, ['firstSectionTemplatePage', 'first_section_template_page']));
    if (firstRef != null) {
      return firstRef;
    }
  }

  const evenOddDifferent = Boolean(readField<boolean>(section, ['sectionTemplateEvenOddPagesDifferent', 'section_template_even_odd_pages_different']));
  if (evenOddDifferent) {
    if (pageNumber % 2 === 0) {
      const evenRef = getRefId(readField(section, ['evenSectionTemplatePage', 'even_section_template_page']));
      if (evenRef != null) {
        return evenRef;
      }
    } else {
      const oddRef = getRefId(readField(section, ['oddSectionTemplatePage', 'odd_section_template_page']));
      if (oddRef != null) {
        return oddRef;
      }
    }
  }

  return getRefId(readField(section, ['oddSectionTemplatePage', 'odd_section_template_page'])) ??
    getRefId(readField(section, ['evenSectionTemplatePage', 'even_section_template_page'])) ??
    getRefId(readField(section, ['firstSectionTemplatePage', 'first_section_template_page']));
}

function buildPagesTemplateDecorations(
  context: SemanticBuildContext,
  resolvedSection: PagesResolvedSection,
  layout: PagesLayoutModel
): PagesTemplateDecorations {
  const background = fillFromValue(readField(resolvedSection.pageTemplateRecord?.value, ['backgroundFill', 'background_fill']));
  const leadingItems: SlideItem[] = [];
  const trailingItems: SlideItem[] = [];
  const blocks: PagesBodyBlock[] = [];
  const seen = new Set<number>();

  const appendDrawable = (drawableRef: unknown, target: SlideItem[]) => {
    const drawableRecord = getRecord(context.archive, drawableRef);
    const drawable = asObject(drawableRecord?.value);
    if (!drawable || (drawableRecord?.id != null && seen.has(drawableRecord.id))) {
      return;
    }
    const item = buildDrawableItem(context, drawable, target.length + leadingItems.length + trailingItems.length);
    if (!item) {
      return;
    }
    target.push(item);
    blocks.push({
      id: `pages-template-${resolvedSection.documentPageNumber}-${blocks.length + 1}`,
      kind: item.kind === 'table' ? 'table' : 'drawable',
      item,
      sourceRecordId: drawableRecord?.id
    });
    const pencilItems = buildPencilAnnotationItems(
      context,
      drawable,
      target.length + leadingItems.length + trailingItems.length
    );
    target.push(...pencilItems);
    pencilItems.forEach((pencilItem) => {
      blocks.push({
        id: `pages-template-${resolvedSection.documentPageNumber}-${blocks.length + 1}`,
        kind: 'drawable',
        item: pencilItem,
        sourceRecordId: drawableRecord?.id
      });
    });
    if (drawableRecord?.id != null) {
      seen.add(drawableRecord.id);
    }
  };

  const sectionTemplateDrawables = asArray<unknown>(readField(resolvedSection.sectionTemplate, ['sectionTemplateDrawables', 'section_template_drawables']));
  for (const drawableRef of sectionTemplateDrawables) {
    appendDrawable(drawableRef, leadingItems);
  }

  const pageTemplateDrawables = asArray<unknown>(readField(resolvedSection.pageTemplateRecord?.value, ['sectionTemplateDrawables', 'section_template_drawables']));
  for (const drawableRef of pageTemplateDrawables) {
    appendDrawable(drawableRef, leadingItems);
  }

  const placeholderDrawables = asArray<Record<string, unknown>>(readField(resolvedSection.pageTemplateRecord?.value, ['placeholderDrawables', 'placeholder_drawables']))
    .slice()
    .sort((left, right) => Number(readField<number>(left, ['zIndex', 'z_index']) ?? 0) - Number(readField<number>(right, ['zIndex', 'z_index']) ?? 0));
  for (const placeholder of placeholderDrawables) {
    appendDrawable(readField(placeholder, ['drawable']), trailingItems);
  }

  const firstPageHidesHeaderFooter = resolvedSection.sectionPageIndex === 1 &&
    Boolean(readField<boolean>(resolvedSection.section, ['sectionTemplateFirstPageHidesHeaderFooter', 'section_template_first_page_hides_header_footer']));
  if (!firstPageHidesHeaderFooter && !shouldHidePagesHeadersFooters(resolvedSection.pageTemplateRecord?.value)) {
    const headerFooterItems = buildPagesHeaderFooterItems(context, resolvedSection, layout);
    for (const item of headerFooterItems) {
      trailingItems.push(item);
      blocks.push({
        id: `pages-template-header-footer-${resolvedSection.documentPageNumber}-${blocks.length + 1}`,
        kind: 'drawable',
        item,
        sourceRecordId: undefined
      });
    }
  }

  return {
    background,
    leadingItems,
    trailingItems,
    blocks
  };
}

function shouldHidePagesHeadersFooters(pageTemplate: Record<string, unknown> | undefined): boolean {
  return Boolean(readField<boolean>(pageTemplate, ['hideHeadersFooters', 'hide_headers_footers']));
}

function buildPagesHeaderFooterItems(
  context: SemanticBuildContext,
  resolvedSection: PagesResolvedSection,
  layout: PagesLayoutModel
): SlideItem[] {
  const sectionTemplate = resolvedSection.sectionTemplate;
  if (!sectionTemplate) {
    return [];
  }

  const pageTemplate = resolvedSection.pageTemplateRecord?.value;
  const slotWidth = Math.max(layout.bodyWidth / 3, 48);
  const topY = Math.max(0, Number(layout.topMargin - 24));
  const bottomY = Math.max(0, Number(layout.height - layout.bottomMargin + 6));
  const items: SlideItem[] = [];

  const appendStorageSlots = (refs: unknown[], section: 'header' | 'footer', y: number) => {
    refs.forEach((ref, slotIndex) => {
      const storage = getRecordValue<Record<string, unknown>>(context.archive, ref);
      const textFrame = buildTextFrameFromStorage(context.archive, storage, {
        padding: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0
        },
        verticalAlign: section === 'header' ? 'top' : 'bottom',
        attachmentContext: {
          documentName: context.archive.sourceName,
          pageNumber: resolvedSection.pageNumber,
          pageCount: resolvedSection.pageCount,
          pageNumberText: resolvedSection.pageNumberText,
          pageCountText: resolvedSection.pageCountText
        }
      });
      if (!textFrame || !hasVisibleTextFrame(textFrame)) {
        return;
      }

      const align: TextParagraph['align'] =
        slotIndex === 0 ? 'left' : slotIndex === 1 ? 'center' : 'right';
      items.push({
        id: `pages-${section}-${resolvedSection.pageNumber}-${slotIndex}`,
        kind: 'text',
        name: `${section}-${slotIndex}`,
        order: items.length,
        groupPath: [],
        transform: {
          x: layout.leftMargin + slotIndex * slotWidth,
          y,
          width: slotWidth,
          height: 24,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        textFrame: {
          ...textFrame,
          paragraphs: textFrame.paragraphs.map((paragraph) => ({
            ...paragraph,
            align: paragraph.align ?? align
          }))
        }
      });
    });
  };

  const headerRefs = asArray<unknown>(readField(sectionTemplate, ['headers']));
  const footerRefs = asArray<unknown>(readField(sectionTemplate, ['footers']));
  const pageTemplateStorageRefs = resolvePagesTemplateStorageRefs(context.archive, resolvedSection.pageTemplateRecord);
  const effectiveHeaderRefs = headerRefs.length ? headerRefs : pageTemplateStorageRefs.slice(0, 3);
  const effectiveFooterRefs = footerRefs.length ? footerRefs : pageTemplateStorageRefs.slice(3, 6);
  if (resolvedSection.headersEnabled) {
    appendStorageSlots(effectiveHeaderRefs, 'header', topY);
  }

  const matchPrevious = Boolean(readField<boolean>(pageTemplate, ['headersFootersMatchPreviousPage', 'headers_footers_match_previous_page']));
  if (resolvedSection.footersEnabled && (!matchPrevious || effectiveFooterRefs.length)) {
    appendStorageSlots(effectiveFooterRefs, 'footer', bottomY);
  }

  return items;
}

function resolvePagesTemplateStorageRefs(
  archive: IworkArchiveIndex,
  pageTemplateRecord: PagesResolvedSection['pageTemplateRecord']
): unknown[] {
  if (!pageTemplateRecord || (pageTemplateRecord.typeName !== 'TP.DocumentArchive' && pageTemplateRecord.typeName !== 'TP.PageTemplateArchive')) {
    return [];
  }
  return (archive.references.outgoing[String(pageTemplateRecord.id)] ?? [])
    .map((id) => archive.records[String(id)])
    .filter((record) => record?.typeName === 'TSWP.StorageArchive')
    .map((record) => ({ identifier: record!.id }));
}

function resolveDrawableGeometry(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['geometry']);
}

function resolveDrawableStyleRef(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['style']);
}

function resolveDrawablePathSource(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['pathsource']);
}

function resolveDrawableStorageRef(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['ownedStorage', 'owned_storage']) ??
    readFieldInDrawableChain(drawable, ['deprecatedStorage', 'deprecated_storage']) ??
    readFieldInDrawableChain(drawable, ['storage']);
}

function normalizeDrawableOpacity(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function resolveDrawableMediaType(
  drawable: Record<string, unknown>,
  media: IworkImageAsset | undefined
): 'video' | 'audio' | 'image' | undefined {
  if (readField<boolean>(drawable, ['audioOnly', 'audio_only']) === true) {
    return 'audio';
  }
  return media?.role;
}

function resolveDrawableHyperlink(drawable: Record<string, unknown>): string | undefined {
  const value = readFieldInDrawableChain(drawable, ['hyperlinkUrl']) ??
    readFieldInDrawableChain(drawable, ['hyperlink_url']);
  return typeof value === 'string' && value.length ? value : undefined;
}

function resolveDrawableDataId(drawable: Record<string, unknown>, drawableRecord?: IworkArchiveRecord): string {
  const dataRef = readFirstFieldInDrawableChain(drawable, [
    ['data'],
    ['image_data'],
    ['imageData'],
    ['adjusted_image_data'],
    ['adjustedImageData'],
    ['enhanced_image_data'],
    ['enhancedImageData'],
    ['database_data'],
    ['databaseData'],
    ['original_data'],
    ['originalData'],
    ['database_original_data'],
    ['databaseOriginalData'],
    ['media_data'],
    ['mediaData'],
    ['movie_data'],
    ['movieData'],
    ['database_movie_data'],
    ['databaseMovieData'],
    ['asset_data'],
    ['assetData'],
    ['image', 'data'],
    ['image', 'image_data'],
    ['image', 'imageData'],
    ['image', 'adjusted_image_data'],
    ['image', 'adjustedImageData'],
    ['image', 'enhanced_image_data'],
    ['image', 'enhancedImageData'],
    ['image', 'database_data'],
    ['image', 'databaseData'],
    ['image', 'original_data'],
    ['image', 'originalData'],
    ['image', 'database_original_data'],
    ['image', 'databaseOriginalData'],
    ['media', 'data'],
    ['media', 'media_data'],
    ['media', 'movie_data'],
    ['media', 'database_movie_data'],
    ['movie', 'data'],
    ['movie', 'movie_data'],
    ['movie', 'movieData'],
    ['movie', 'database_movie_data'],
    ['movie', 'databaseMovieData']
  ]);
  const explicitId = dataRef ? String(readField<number>(dataRef as Record<string, unknown>, ['identifier']) ?? '') : '';
  if (explicitId) {
    return explicitId;
  }

  const fallbackId = drawableRecord?.dataReferences.find((candidate: number) => Number.isFinite(candidate) && candidate > 0);
  return fallbackId != null ? String(fallbackId) : '';
}

function resolveDrawableThumbnailDataId(
  drawable: Record<string, unknown>,
  drawableRecord?: IworkArchiveRecord,
  primaryDataId?: string
): string | undefined {
  const thumbnailRef = readFirstFieldInDrawableChain(drawable, [
    ['thumbnail_data'],
    ['thumbnailData'],
    ['database_thumbnail_data'],
    ['databaseThumbnailData'],
    ['thumbnail_adjusted_image_data'],
    ['thumbnailAdjustedImageData'],
    ['poster_data'],
    ['posterData'],
    ['poster_image_data'],
    ['posterImageData'],
    ['database_poster_image_data'],
    ['databasePosterImageData'],
    ['audio_only_image_data'],
    ['audioOnlyImageData'],
    ['database_audio_only_image_data'],
    ['databaseAudioOnlyImageData'],
    ['poster_frame_data'],
    ['posterFrameData'],
    ['preview_data'],
    ['previewData'],
    ['image', 'thumbnail_data'],
    ['image', 'thumbnailData'],
    ['image', 'database_thumbnail_data'],
    ['image', 'databaseThumbnailData'],
    ['image', 'thumbnail_adjusted_image_data'],
    ['image', 'thumbnailAdjustedImageData'],
    ['image', 'poster_image_data'],
    ['image', 'posterImageData'],
    ['media', 'thumbnail_data'],
    ['media', 'thumbnailData'],
    ['media', 'poster_image_data'],
    ['media', 'posterImageData'],
    ['movie', 'thumbnail_data'],
    ['movie', 'thumbnailData'],
    ['movie', 'poster_image_data'],
    ['movie', 'posterImageData'],
    ['movie', 'database_poster_image_data'],
    ['movie', 'databasePosterImageData'],
    ['movie', 'audio_only_image_data'],
    ['movie', 'audioOnlyImageData'],
    ['movie', 'database_audio_only_image_data'],
    ['movie', 'databaseAudioOnlyImageData'],
    ['movie', 'poster_frame_data'],
    ['movie', 'posterFrameData']
  ]);
  const identifier = thumbnailRef ? readField<number>(thumbnailRef as Record<string, unknown>, ['identifier']) : undefined;
  if (identifier != null) {
    return String(identifier);
  }

  if (!drawableRecord) {
    return undefined;
  }

  const fallbackPosterId = drawableRecord.dataReferences
    .filter((candidate: number) => Number.isFinite(candidate) && candidate > 0)
    .map((candidate) => String(candidate))
    .find((candidate) => candidate !== primaryDataId);
  return fallbackPosterId || undefined;
}

function readFirstFieldInDrawableChain(drawable: Record<string, unknown>, keyPaths: string[][]): unknown {
  for (const keys of keyPaths) {
    const value = readFieldInDrawableChain(drawable, keys);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readFieldInDrawableChain(drawable: Record<string, unknown>, keys: string[]): unknown {
  let current: Record<string, unknown> | undefined = drawable;
  const seen = new Set<Record<string, unknown>>();
  while (current && !seen.has(current)) {
    const value = readField(current, keys);
    if (value !== undefined) {
      return value;
    }
    seen.add(current);
    current = asObject(readField(current, ['super']));
  }
  return undefined;
}

function readFieldInStyleChain<T = unknown>(
  style: Record<string, unknown> | undefined,
  containerKeys: string[],
  valueKeys: string[]
): T | undefined {
  let current = style;
  const seen = new Set<Record<string, unknown>>();
  while (current && !seen.has(current)) {
    const container = containerKeys.length ? asObject(readField(current, containerKeys)) : current;
    const value = readField<T>(container, valueKeys);
    if (value !== undefined) {
      return value;
    }
    seen.add(current);
    current = asObject(readField(current, ['super']));
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isLineShape(pathSource: unknown): boolean {
  const path = asObject(pathSource);
  if (!path) {
    return false;
  }
  if (readField(path, ['connectionLinePathSource', 'connection_line_path_source'])) {
    return true;
  }

  const bezier = asObject(readField(path, ['bezierPathSource', 'bezier_path_source'])) ?? path;
  const pathValue = asObject(readField(bezier, ['path'])) ?? (asArray(readField(bezier, ['elements'])).length ? bezier : undefined);
  const elements = asArray<AnyObject>(readField(pathValue, ['elements']));
  if (elements.length) {
    const hasClose = elements.some((element) => Number(readField<number>(element, ['type']) ?? 0) === 5);
    const drawableTypes = elements.filter((element) => Number(readField<number>(element, ['type']) ?? 0) !== 5);
    return !hasClose && drawableTypes.length === 2 &&
      Number(readField<number>(drawableTypes[0], ['type']) ?? 0) === 1 &&
      Number(readField<number>(drawableTypes[1], ['type']) ?? 0) === 2;
  }

  const editable = asObject(readField(path, ['editableBezierPathSource', 'editable_bezier_path_source']));
  const subpaths = asArray<AnyObject>(readField(editable, ['subpaths']));
  if (subpaths.length !== 1) {
    return false;
  }
  const subpath = subpaths[0];
  const nodes = asArray(readField(subpath, ['nodes']));
  return readField<boolean>(subpath, ['closed']) !== true && nodes.length === 2;
}

function resolveShapeType(pathSource: unknown): ShapeType {
  if (isLineShape(pathSource)) {
    return 'line';
  }

  const path = asObject(pathSource);
  const pointSource = asObject(readField(path, ['pointPathSource', 'point_path_source']));
  if (pointSource) {
    switch (Number(readField<number>(pointSource, ['type']) ?? 0)) {
      case 0:
        return 'leftArrow';
      case 1:
        return 'rightArrow';
      case 10:
        return 'leftRightArrow';
      case 100:
        return 'star5';
      case 200:
        return 'plus';
      default:
        break;
    }
  }

  const scalarSource = asObject(readField(path, ['scalarPathSource', 'scalar_path_source']));
  if (scalarSource) {
    switch (Number(readField<number>(scalarSource, ['type']) ?? 0)) {
      case 0:
        return 'roundRect';
      case 2:
        return 'chevron';
      case 1:
        return 'hexagon';
      default:
        break;
    }
  }

  return 'unknown';
}

function findCanvasTitle(items: SlideItem[]): string | undefined {
  for (const item of items) {
    if ('textFrame' in item && item.textFrame) {
      const text = item.textFrame.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('').trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function findRecordByValue(
  archive: IworkArchiveIndex,
  target: Record<string, unknown>
): IworkArchiveRecord | undefined {
  return Object.values(archive.records).find((record) => record.value === target);
}

function normalizeStorageText(value: unknown): string {
  return asArray<string>(value).join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hasVisibleTextFrame(frame: TextFrame): boolean {
  return frame.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => stripObjectMarker(run.text).trim().length > 0)
  );
}

function shouldIncludeKeynotePlaceholderItem(item: SlideItem): boolean {
  if (!('textFrame' in item) || !item.textFrame) {
    return false;
  }
  return hasVisibleTextFrame(item.textFrame);
}

function collectKeynotePlaceholderKinds(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  includeSlideNumber: boolean | undefined
): Set<number> {
  const refs = collectKeynotePlaceholderRefs(slide, includeSlideNumber);
  const kinds = new Set<number>();
  for (const ref of refs) {
    const placeholder = getRecordValue<Record<string, unknown>>(archive, ref);
    const kind = Number(readField<number>(placeholder, ['kind']) ?? -1);
    if (kind >= 0) {
      kinds.add(kind);
    }
  }
  return kinds;
}

function collectHiddenKeynotePlaceholderKinds(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  includeSlideNumber: boolean | undefined
): Set<number> {
  const style = resolveMergedStyle(archive, readField(slide, ['style']));
  const slideProperties = asObject(readField(style, ['slideProperties', 'slide_properties']));
  const kinds = new Set<number>();

  if (readField<boolean>(slideProperties, ['titlePlaceholderVisibility', 'title_placeholder_visibility']) === false) {
    kinds.add(2);
  }
  if (readField<boolean>(slideProperties, ['bodyPlaceholderVisibility', 'body_placeholder_visibility']) === false) {
    kinds.add(3);
  }
  if (readField<boolean>(slideProperties, ['objectPlaceholderVisibility', 'object_placeholder_visibility']) === false) {
    kinds.add(4);
  }
  if (
    includeSlideNumber &&
    readField<boolean>(slideProperties, ['slideNumberPlaceholderVisibility', 'slide_number_placeholder_visibility']) === false
  ) {
    kinds.add(1);
  }

  return kinds;
}

function collectKeynotePlaceholderRefs(slide: Record<string, unknown>, includeSlideNumber: boolean | undefined): unknown[] {
  const refs: unknown[] = [
    readField(slide, ['titlePlaceholder', 'title_placeholder']),
    readField(slide, ['bodyPlaceholder', 'body_placeholder']),
    readField(slide, ['objectPlaceholder', 'object_placeholder']),
    ...asArray<unknown>(readField(slide, ['placeholderDrawables', 'placeholder_drawables'])),
    ...asArray<unknown>(readField(slide, ['placeholderDrawableInfos', 'placeholder_drawable_infos'])),
    ...asArray<unknown>(readField(slide, ['placeholders']))
  ];
  if (includeSlideNumber) {
    refs.push(readField(slide, ['slideNumberPlaceholder', 'slide_number_placeholder']));
  }
  return refs.filter((ref) => ref != null);
}

function collectKeynoteObjectPlaceholderInfoRefs(slide: Record<string, unknown>): unknown[] {
  const directRefs = [
    readField(slide, ['infoUsingObjectPlaceholderGeometry', 'info_using_object_placeholder_geometry']),
    ...asArray<unknown>(readField(slide, ['infosUsingObjectPlaceholderGeometry', 'infos_using_object_placeholder_geometry']))
  ].filter((ref) => ref != null);
  if (directRefs.length) {
    return directRefs;
  }

  if (!readField(slide, ['objectPlaceholder', 'object_placeholder'])) {
    return [];
  }

  return asArray<Record<string, unknown>>(readField(slide, ['sageTagToInfoMap', 'sage_tag_to_info_map']))
    .map((entry) => readField(entry, ['info']))
    .filter((ref) => ref != null);
}

function buildSyntheticKeynotePlaceholderItems(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  orderOffset: number,
  options: KeynoteBuildOptions
): SlideItem[] {
  const syntheticItems: SlideItem[] = [];
  const pushSyntheticPlaceholder = (item: SlideItem | undefined) => {
    if (item) {
      syntheticItems.push({
        ...item,
        order: orderOffset + syntheticItems.length
      });
    }
  };

  if (!readField(slide, ['titlePlaceholder', 'title_placeholder']) && readField(slide, ['titlePlaceholderGeometry', 'title_placeholder_geometry'])) {
    pushSyntheticPlaceholder(
      buildSyntheticKeynotePlaceholderItem(slide, 2, ['titlePlaceholderGeometry', 'title_placeholder_geometry'], ['titleLayoutProperties', 'title_layout_properties'], orderOffset + syntheticItems.length)
    );
  }
  if (!readField(slide, ['bodyPlaceholder', 'body_placeholder']) && readField(slide, ['bodyPlaceholderGeometry', 'body_placeholder_geometry'])) {
    pushSyntheticPlaceholder(
      buildSyntheticKeynotePlaceholderItem(slide, 3, ['bodyPlaceholderGeometry', 'body_placeholder_geometry'], ['bodyLayoutProperties', 'body_layout_properties'], orderOffset + syntheticItems.length)
    );
  }
  if (
    options.slideNumberVisible &&
    !readField(slide, ['slideNumberPlaceholder', 'slide_number_placeholder']) &&
    readField(slide, ['slideNumberPlaceholderGeometry', 'slide_number_placeholder_geometry'])
  ) {
    pushSyntheticPlaceholder(
      buildSyntheticKeynotePlaceholderItem(
        slide,
        1,
        ['slideNumberPlaceholderGeometry', 'slide_number_placeholder_geometry'],
        ['slideNumberLayoutProperties', 'slide_number_layout_properties'],
        orderOffset + syntheticItems.length,
        options.pageNumber != null ? String(options.pageNumber) : undefined
      )
    );
  }

  const hiddenKinds = collectHiddenKeynotePlaceholderKinds(archive, slide, options.slideNumberVisible);
  return syntheticItems.filter((item) => {
    const placeholderKind = item.placeholder?.type === 'body'
      ? 3
      : item.placeholder?.type === 'title'
        ? 2
        : item.placeholder?.type === 'slideNumber'
          ? 1
          : undefined;
    return placeholderKind == null || !hiddenKinds.has(placeholderKind);
  });
}

function buildSyntheticKeynotePlaceholderItem(
  slide: Record<string, unknown>,
  kind: 1 | 2 | 3,
  geometryKeys: string[],
  layoutKeys: string[],
  order: number,
  overrideText?: string
): SlideItem | undefined {
  const geometry = readField(slide, geometryKeys);
  if (!geometry) {
    return undefined;
  }
  const transform = transformFromGeometry(geometry);
  const layoutProperties = asObject(readField(slide, layoutKeys));
  const padding = paddingFromValue(readField(layoutProperties, ['padding']), 4);
  const verticalAlign = verticalAlignFromValue(readField(layoutProperties, ['verticalAlignment', 'vertical_alignment']));
  const text = overrideText ??
    (kind === 2
      ? readField<string>(slide, ['thumbnailTextForTitlePlaceholder', 'thumbnail_text_for_title_placeholder'])
      : kind === 3
        ? readField<string>(slide, ['thumbnailTextForBodyPlaceholder', 'thumbnail_text_for_body_placeholder'])
        : undefined);
  if (!text || !text.trim()) {
    return undefined;
  }

  const textFrame: TextFrame = {
    paragraphs: [
      {
        runs: [{ text }]
      }
    ],
    verticalAlign,
    padding,
    wrap: 'square'
  };
  const normalizedTransform = ensureDrawableTextTransform(transform, textFrame);
  const placeholderType = kind === 2 ? 'title' : kind === 3 ? 'body' : 'slideNumber';

  return {
    id: `synthetic-placeholder-${placeholderType}-${order}`,
    kind: 'text',
    name: 'Text',
    order,
    groupPath: [],
    transform: normalizedTransform,
    fill: {
      type: 'none'
    },
    line: undefined,
    shadow: undefined,
    textFrame,
    placeholder: {
      type: placeholderType,
      idx: '0'
    }
  };
}

function buildKeynotePlaceholderFallbackTextFrame(
  drawable: Record<string, unknown>,
  slide: Record<string, unknown> | undefined,
  padding: TextFrame['padding'],
  verticalAlign: TextFrame['verticalAlign']
): TextFrame | undefined {
  const placeholderKind = Number(readField<number>(drawable, ['kind']) ?? -1);
  const fallbackText =
    placeholderKind === 2
      ? readField<string>(slide, ['thumbnailTextForTitlePlaceholder', 'thumbnail_text_for_title_placeholder'])
      : placeholderKind === 3
        ? readField<string>(slide, ['thumbnailTextForBodyPlaceholder', 'thumbnail_text_for_body_placeholder'])
        : undefined;
  if (!fallbackText || !fallbackText.trim()) {
    return undefined;
  }

  return {
    paragraphs: [
      {
        runs: [{ text: fallbackText }]
      }
    ],
    verticalAlign,
    padding,
    wrap: 'square'
  };
}

function buildKeynoteInstructionalTextFrame(
  archive: IworkArchiveIndex,
  drawable: Record<string, unknown>,
  slide: Record<string, unknown> | undefined,
  padding: TextFrame['padding'],
  verticalAlign: TextFrame['verticalAlign']
): TextFrame | undefined {
  const instructionalText = resolveKeynoteInstructionalText(archive, drawable, slide);
  if (!instructionalText || !instructionalText.trim()) {
    return undefined;
  }

  return {
    paragraphs: [
      {
        runs: [{ text: instructionalText }]
      }
    ],
    verticalAlign,
    padding,
    wrap: 'square'
  };
}

function resolveKeynoteInstructionalText(
  archive: IworkArchiveIndex,
  drawable: Record<string, unknown>,
  slide: Record<string, unknown> | undefined
): string | undefined {
  if (!slide) {
    return undefined;
  }

  const drawableId = findRecordIdByValue(archive, drawable);
  if (drawableId == null) {
    return undefined;
  }

  const instructionalTextMap = asObject(readField(slide, ['instructionalTextMap', 'instructional_text_map']));
  const entries = asArray<Record<string, unknown>>(readField(instructionalTextMap, ['instructionalTextForInfos', 'instructional_text_for_infos']));
  for (const entry of entries) {
    const infoId = getRefId(readField(entry, ['info']));
    if (infoId === drawableId) {
      return readField<string>(entry, ['instructionalText', 'instructional_text']);
    }
  }

  return undefined;
}

function ensureDrawableTextTransform(transform: SlideItem['transform'], textFrame: TextFrame | undefined): SlideItem['transform'] {
  if (!textFrame || (transform.width > 0 && transform.height > 0)) {
    return transform;
  }

  const fontSizes = textFrame.paragraphs.flatMap((paragraph) =>
    paragraph.runs.map((run) => run.fontSize).filter((size): size is number => typeof size === 'number' && size > 0)
  );
  const fontSize = fontSizes.length ? Math.max(...fontSizes) : 18;
  const lines = Math.max(textFrame.paragraphs.length, 1);
  const longestLineLength = Math.max(
    ...textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('').length),
    1
  );
  const estimatedWidth = Math.max(
    24,
    longestLineLength * fontSize * 0.6 + textFrame.padding.left + textFrame.padding.right
  );
  const estimatedHeight = Math.max(
    fontSize * 1.2 * lines + textFrame.padding.top + textFrame.padding.bottom,
    fontSize * 1.5
  );

  return {
    ...transform,
    width: transform.width > 0 ? transform.width : Number(estimatedWidth.toFixed(2)),
    height: transform.height > 0 ? transform.height : Number(estimatedHeight.toFixed(2))
  };
}

function buildParagraphRanges(text: string): Array<{ start: number; end: number; text: string }> {
  if (!text.length) {
    return [{ start: 0, end: 0, text: '' }];
  }

  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? text.length;
    const rawText = text.slice(start, end);
    return {
      start,
      end,
      text: rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText
    };
  });
}

function findParagraphIndexForCharacter(paragraphRanges: Array<{ start: number; end: number; text: string }>, characterIndex: number): number {
  for (let index = 0; index < paragraphRanges.length; index += 1) {
    const paragraph = paragraphRanges[index];
    if (characterIndex < paragraph.end || index === paragraphRanges.length - 1) {
      return index;
    }
  }
  return Math.max(paragraphRanges.length - 1, 0);
}

function findParagraphEndIndexForCharacter(
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number
): number {
  if (characterIndex <= 0) {
    return 0;
  }
  for (let index = 0; index < paragraphRanges.length; index += 1) {
    if (characterIndex <= paragraphRanges[index].start) {
      return index;
    }
    if (characterIndex < paragraphRanges[index].end) {
      return index + 1;
    }
  }
  return paragraphRanges.length;
}

function stripObjectMarker(text: string): string {
  return text.replace(/[\u0005\uFFFC]/g, '');
}

function buildParagraphBlock(
  id: string,
  paragraphs: TextParagraph[],
  start: number,
  end: number,
  sourceRecordId?: number
): PagesBodyBlock | undefined {
  const slice = paragraphs.slice(start, end);
  if (!slice.length) {
    return undefined;
  }
  return {
    id,
    kind: 'paragraphs',
    paragraphs: slice,
    sourceRecordId
  };
}

function buildParagraphSliceBlock(
  id: string,
  paragraph: TextParagraph | undefined,
  startVisibleOffset: number,
  endVisibleOffset: number,
  sourceRecordId?: number
): PagesBodyBlock | undefined {
  const slicedParagraph = sliceTextParagraph(paragraph, startVisibleOffset, endVisibleOffset);
  if (!slicedParagraph) {
    return undefined;
  }
  const hasVisibleText = slicedParagraph.runs.some((run) => stripObjectMarker(run.text).trim().length > 0);
  if (!hasVisibleText) {
    return undefined;
  }
  return {
    id,
    kind: 'paragraphs',
    paragraphs: [slicedParagraph],
    sourceRecordId
  };
}

function sliceTextParagraph(
  paragraph: TextParagraph | undefined,
  startVisibleOffset: number,
  endVisibleOffset: number
): TextParagraph | undefined {
  if (!paragraph) {
    return undefined;
  }

  const clampedStart = Math.max(0, startVisibleOffset);
  const clampedEnd = Math.max(clampedStart, endVisibleOffset);
  let cursor = 0;
  const runs: TextParagraph['runs'] = [];

  for (const run of paragraph.runs) {
    const runLength = run.text.length;
    const runStart = cursor;
    const runEnd = cursor + runLength;
    const sliceStart = Math.max(clampedStart, runStart);
    const sliceEnd = Math.min(clampedEnd, runEnd);
    if (sliceStart < sliceEnd) {
      runs.push({
        ...run,
        text: run.text.slice(sliceStart - runStart, sliceEnd - runStart)
      });
    }
    cursor = runEnd;
  }

  if (!runs.length) {
    return undefined;
  }

  const totalVisibleLength = collectParagraphVisibleText(paragraph).length;
  const isLeadingSlice = clampedStart <= 0;
  const isTrailingSlice = clampedEnd >= totalVisibleLength;

  return {
    ...paragraph,
    bullet: isLeadingSlice ? paragraph.bullet : undefined,
    bulletDisabled: isLeadingSlice ? paragraph.bulletDisabled : true,
    spaceBefore: isLeadingSlice ? paragraph.spaceBefore : 0,
    spaceAfter: isTrailingSlice ? paragraph.spaceAfter : 0,
    runs
  };
}

function findFirstParagraphText(paragraphs: TextParagraph[]): string | undefined {
  for (const paragraph of paragraphs) {
    const text = paragraph.runs.map((run) => stripObjectMarker(run.text)).join('').trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function positionPagesAttachmentItem(params: {
  archive: IworkArchiveIndex;
  item: SlideItem;
  attachmentObject: Record<string, unknown> | undefined;
  attachmentHint?: PagesAttachmentPositionHint;
  page?: PaginatedPagesBodyPage;
  paragraphRanges: Array<{ start: number; end: number; text: string }>;
  characterIndex: number;
  anchorParagraphIndex: number;
  paragraphCount: number;
  pageParagraphStart: number;
  pageParagraphEnd: number;
  paragraphMetrics?: PagesParagraphMetrics;
  leftMargin: number;
  topMargin: number;
  bottomMargin: number;
  pageHeight: number;
}): void {
  const {
    archive,
    item,
    attachmentObject,
    attachmentHint,
    page,
    paragraphRanges,
    characterIndex,
    anchorParagraphIndex,
    paragraphCount,
    pageParagraphStart,
    pageParagraphEnd,
    paragraphMetrics,
    leftMargin,
    topMargin,
    bottomMargin,
    pageHeight
  } = params;
  if (hasAbsolutePagesAttachmentPosition(attachmentHint)) {
    item.transform.x = attachmentHint.x;
    item.transform.y = attachmentHint.y;
    return;
  }

  const hOffsetType = Number(readField<number>(attachmentObject, ['hOffsetType', 'h_offset_type']) ?? 0);
  const vOffsetType = Number(readField<number>(attachmentObject, ['vOffsetType', 'v_offset_type']) ?? 0);
  const hOffset = Number(readField<number>(attachmentObject, ['hOffset', 'h_offset']) ?? 0);
  const vOffset = Number(readField<number>(attachmentObject, ['vOffset', 'v_offset']) ?? 0);
  if (!isSupportedPagesAttachmentHorizontalOffsetType(hOffsetType)) {
    pushUniqueArchiveWarning(
      archive,
      `Pages attachment horizontal offset type ${hOffsetType} is not fully supported; using margin-relative fallback.`
    );
  }
  if (!isSupportedPagesAttachmentVerticalOffsetType(vOffsetType)) {
    pushUniqueArchiveWarning(
      archive,
      `Pages attachment vertical offset type ${vOffsetType} is not fully supported; using margin-relative fallback.`
    );
  }
  const anchorFragment = resolvePagesAttachmentFragment(page, paragraphRanges, characterIndex, anchorParagraphIndex);
  const fragmentRect = anchorFragment?.rect;
  const fragmentStart = anchorFragment?.startParagraph ?? pageParagraphStart;
  const fragmentEnd = anchorFragment?.endParagraph ?? pageParagraphEnd;
  const fragmentRelativeRatio = resolvePagesAttachmentRelativeRatio({
    anchorParagraphIndex,
    paragraphCount,
    pageParagraphStart: fragmentStart,
    pageParagraphEnd: fragmentEnd,
    paragraphMetrics,
    paragraphRanges,
    characterIndex
  });
  item.transform.x = leftMargin + (fragmentRect?.x ?? 0) + hOffset;
  item.transform.y =
    topMargin +
    (fragmentRect?.y ?? 0) +
    vOffset +
    fragmentRelativeRatio * Math.max(
      (fragmentRect?.height ?? (pageHeight - topMargin - bottomMargin)) - item.transform.height,
      1
    );
}

function isSupportedPagesAttachmentHorizontalOffsetType(offsetType: number): boolean {
  return offsetType === 0 || offsetType === 3;
}

function isSupportedPagesAttachmentVerticalOffsetType(offsetType: number): boolean {
  return offsetType === 0 || offsetType === 4;
}

function resolvePagesAttachmentFragment(
  page: PaginatedPagesBodyPage | undefined,
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): PaginatedPagesBodyFragment | undefined {
  if (!page) {
    return undefined;
  }

  for (const fragment of page.fragments) {
    if (fragmentContainsCharacter(fragment, paragraphRanges, characterIndex, anchorParagraphIndex)) {
      return fragment;
    }
  }

  return page.fragments[page.fragments.length - 1];
}

function resolvePagesAttachmentFragmentIndex(
  page: PaginatedPagesBodyPage | undefined,
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  if (!page?.fragments.length) {
    return 0;
  }

  for (let index = 0; index < page.fragments.length; index += 1) {
    if (fragmentContainsCharacter(page.fragments[index], paragraphRanges, characterIndex, anchorParagraphIndex)) {
      return index;
    }
  }

  return Math.max(page.fragments.length - 1, 0);
}

function fragmentContainsCharacter(
  fragment: PaginatedPagesBodyFragment,
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): boolean {
  if (anchorParagraphIndex < fragment.startParagraph || anchorParagraphIndex >= fragment.endParagraph) {
    return false;
  }

  const visibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
  if (anchorParagraphIndex === fragment.startParagraph && visibleOffset < (fragment.startVisibleOffset ?? 0)) {
    return false;
  }

  const lastParagraphIndex = fragment.endParagraph - 1;
  if (anchorParagraphIndex === lastParagraphIndex && fragment.endVisibleOffset != null && visibleOffset >= fragment.endVisibleOffset) {
    return false;
  }

  return true;
}

function resolvePagesAttachmentPlacement(
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): PagesInlineAttachment['placement'] {
  const anchorRange = paragraphRanges[anchorParagraphIndex];
  if (!anchorRange) {
    return 'standalone';
  }

  const localIndex = characterIndex - anchorRange.start;
  if (localIndex < 0 || localIndex >= anchorRange.text.length) {
    return stripObjectMarker(anchorRange.text).trim().length ? 'suffix' : 'standalone';
  }

  const beforeText = stripObjectMarker(anchorRange.text.slice(0, localIndex));
  const afterText = stripObjectMarker(anchorRange.text.slice(localIndex + 1));
  const hasBefore = beforeText.trim().length > 0;
  const hasAfter = afterText.trim().length > 0;

  if (!hasBefore && !hasAfter) {
    return 'standalone';
  }
  if (!hasBefore) {
    return 'prefix';
  }
  if (!hasAfter) {
    return 'suffix';
  }
  return 'middle';
}

function resolvePagesAttachmentVisibleSplit(
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  return resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
}

function resolvePagesCharacterVisibleSplit(
  paragraphRanges: Array<{ start: number; end: number; text: string }>,
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  const anchorRange = paragraphRanges[anchorParagraphIndex];
  if (!anchorRange) {
    return 0;
  }

  const localIndex = Math.max(0, Math.min(characterIndex - anchorRange.start, anchorRange.text.length));
  return stripObjectMarker(anchorRange.text.slice(0, localIndex)).length;
}

function collectParagraphVisibleText(paragraph: TextParagraph | undefined): string {
  return stripObjectMarker(paragraph?.runs.map((run) => run.text).join('') ?? '');
}

function resolvePagesAttachmentRelativeRatio(params: {
  anchorParagraphIndex: number;
  paragraphCount: number;
  pageParagraphStart: number;
  pageParagraphEnd: number;
  paragraphMetrics?: PagesParagraphMetrics;
  paragraphRanges: Array<{ start: number; end: number; text: string }>;
  characterIndex: number;
}): number {
  const {
    anchorParagraphIndex,
    paragraphCount,
    pageParagraphStart,
    pageParagraphEnd,
    paragraphMetrics,
    paragraphRanges,
    characterIndex
  } = params;

  if (paragraphMetrics) {
    const startOffset = paragraphMetrics.offsets[pageParagraphStart] ?? 0;
    const endParagraphIndex = Math.max(pageParagraphStart, pageParagraphEnd - 1);
    const endOffset =
      (paragraphMetrics.offsets[endParagraphIndex] ?? 0) +
      (paragraphMetrics.heights[endParagraphIndex] ?? 0);
    const anchorOffset = paragraphMetrics.offsets[anchorParagraphIndex] ?? startOffset;
    const anchorHeight = paragraphMetrics.heights[anchorParagraphIndex] ?? 0;
    const anchorVisibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
    const anchorParagraphText = paragraphRanges[anchorParagraphIndex]?.text ?? '';
    const anchorVisibleLength = stripObjectMarker(anchorParagraphText).length;
    const anchorRelativeOffset =
      anchorVisibleLength > 0
        ? Math.min(1, Math.max(0, anchorVisibleOffset / anchorVisibleLength))
        : 0.5;
    const pageHeight = Math.max(endOffset - startOffset, 1);
    return Math.min(
      1,
      Math.max(0, (anchorOffset - startOffset + anchorHeight * anchorRelativeOffset) / pageHeight)
    );
  }

  const pageParagraphCount = Math.max(pageParagraphEnd - pageParagraphStart, 1);
  if (pageParagraphCount) {
    const anchorVisibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
    const anchorParagraphText = paragraphRanges[anchorParagraphIndex]?.text ?? '';
    const anchorVisibleLength = stripObjectMarker(anchorParagraphText).length;
    const anchorRelativeOffset =
      anchorVisibleLength > 0
        ? Math.min(1, Math.max(0, anchorVisibleOffset / anchorVisibleLength))
        : 0.5;
    return Math.min(
      1,
      Math.max(0, (anchorParagraphIndex - pageParagraphStart + anchorRelativeOffset) / pageParagraphCount)
    );
  }
  if (paragraphCount) {
    const anchorVisibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
    const anchorParagraphText = paragraphRanges[anchorParagraphIndex]?.text ?? '';
    const anchorVisibleLength = stripObjectMarker(anchorParagraphText).length;
    const anchorRelativeOffset =
      anchorVisibleLength > 0
        ? Math.min(1, Math.max(0, anchorVisibleOffset / anchorVisibleLength))
        : 0.5;
    return Math.min(1, Math.max(0, (anchorParagraphIndex + anchorRelativeOffset) / paragraphCount));
  }
  return Math.min(1, Math.max(0, characterIndex / 1000));
}

function findRecordIdByValue(archive: IworkArchiveIndex, value: Record<string, unknown>): number | undefined {
  return Object.values(archive.records).find((record) => record.value === value)?.id;
}

function pushUniqueArchiveWarning(archive: IworkArchiveIndex, message: string): void {
  if (!archive.warnings.includes(message)) {
    archive.warnings.push(message);
  }
}
