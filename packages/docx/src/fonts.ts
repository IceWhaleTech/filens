import {
  analyzePreviewFonts, analyzeLoadedPreviewFonts, buildPreviewFontStack, fontTraitsFromPanose, getPreviewFontWarnings, officeFontTraits, splitPreviewFontFamilies,
  type PreviewFontReference, type PreviewFontTraits, type PreviewFontRefresh
} from '@filens/core';

interface DocxFontDocument {
  fontTablePart?: {
    fonts?: Array<{ name?: string; family?: string; pitch?: string; embedFontRefs?: unknown[] }>;
    path?: string;
    _package?: { load(path: string): Promise<string | null> };
  };
  documentPart?: { body?: unknown };
  stylesPart?: { styles?: unknown };
  parts?: Array<Record<string, unknown>>;
}

const originalStacks = new WeakMap<object, string>();

/** docx-preview omits PANOSE/pitch; read just its existing package's font table. */
export async function readDocxFontTraits(document: DocxFontDocument, ownerDocument: Document): Promise<Map<string, PreviewFontTraits>> {
  const traits = new Map<string, PreviewFontTraits>();
  const part = document.fontTablePart;
  if (!part?.path || !part._package?.load) return traits;
  try {
    const xml = await part._package.load(part.path);
    const Parser = ownerDocument.defaultView?.DOMParser;
    if (!xml || !Parser) return traits;
    const parsed = new Parser().parseFromString(xml, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length) return traits;
    const attribute = (element: Element, name: string) => [...element.attributes].find(attr => attr.localName === name)?.value;
    for (const font of [...parsed.getElementsByTagNameNS('*', 'font')]) {
      const name = attribute(font, 'name');
      if (!name) continue;
      const value = (localName: string) => {
        const child = [...font.children].find(child => child.localName === localName);
        return child ? attribute(child, 'val') : undefined;
      };
      traits.set(name.toLowerCase(), {
        ...officeFontTraits(value('family')), ...fontTraitsFromPanose(value('panose1')),
        ...officeFontTraits(undefined, value('pitch'))
      });
    }
  } catch { /* Optional metadata must not prevent document rendering. */ }
  return traits;
}

/** Reuse parsed payloads; never traverse package/resource graphs. */
export function prepareDocxFonts(document: DocxFontDocument, ownerDocument: Document, metadata = new Map<string, PreviewFontTraits>(), update?: PreviewFontRefresh) {
  const references = new Map<string, PreviewFontReference>();
  for (const font of document.fontTablePart?.fonts ?? []) {
    if (!font.name) continue;
    references.set(font.name.toLowerCase(), {
      fontFamily: font.name, traits: { ...officeFontTraits(font.family, font.pitch), ...metadata.get(font.name.toLowerCase()) },
      embedded: font.embedFontRefs?.length ? true : undefined
    });
  }
  const styles: Array<{ values: Record<string, unknown>; stack: string }> = [];
  const visited = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (typeof record['font-family'] === 'string') {
      const stack = originalStacks.get(record) ?? record['font-family'];
      originalStacks.set(record, stack);
      styles.push({ values: record, stack });
      for (const fontFamily of splitPreviewFontFamilies(stack)) {
        if (!references.has(fontFamily.toLowerCase())) references.set(fontFamily.toLowerCase(), { fontFamily });
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'parent' && !key.startsWith('_')) visit(child);
    }
  };
  visit(document.documentPart?.body);
  visit(document.stylesPart?.styles);
  for (const part of document.parts ?? []) {
    for (const key of ['body', 'styles', 'domNumberings', 'notes', 'comments']) visit(part[key]);
  }
  // Only claim automatic selection for declarations we can actually rewrite.
  const rewritable = styles.filter(({ stack }) => !/[()]/.test(stack)
    && !splitPreviewFontFamilies(stack).some(family => references.get(family.toLowerCase())?.embedded));
  const eligibleFamilies = new Set(rewritable.flatMap(({ stack }) => splitPreviewFontFamilies(stack).map(family => family.toLowerCase())));
  const replacements = new Map(update?.references.map(ref => [ref.fontFamily?.toLowerCase(), ref]));
  for (const [key, ref] of references) {
    const replacement = replacements.get(key);
    if (replacement && eligibleFamilies.has(key)) references.set(key, { ...ref, ...replacement });
  }
  const eligible = [...references.values()].filter(ref => eligibleFamilies.has(ref.fontFamily!.toLowerCase()));
  const fonts = [
    ...(update ? analyzeLoadedPreviewFonts({ ...update, references: eligible }, ownerDocument)
      : analyzePreviewFonts(eligible, ownerDocument, { substitute: true })).fonts,
    ...analyzePreviewFonts([...references.values()].filter(ref => !eligibleFamilies.has(ref.fontFamily!.toLowerCase())), ownerDocument).fonts
  ];
  const targets = new Map(fonts.map(font => [font.fontFamily?.toLowerCase(), font.resolvedFontFamily]));
  for (const { values, stack } of rewritable) {
    const families = splitPreviewFontFamilies(stack);
    const preferred = families.map(family => targets.get(family.toLowerCase())).filter((target): target is string => !!target);
    values['font-family'] = buildPreviewFontStack(stack, family => references.get(family.toLowerCase())?.traits, preferred);
  }
  return { fonts, references: [...references.values()], loadingReferences: eligible,
    warnings: [...new Set([...getPreviewFontWarnings(fonts), ...update?.warnings ?? []])] };
}
