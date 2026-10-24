import type { PptxArchive, PptxArchiveEntry } from './archive';
import { XMLParser } from 'fast-xml-parser';
import { parseOpenXml } from './ordered-xml';

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  trimValues: false,
  parseAttributeValue: false
});

export type XmlNode = Record<string, unknown>;
export type OrderedXmlNode = Array<Record<string, unknown>>;

// Parse once: the ordered view retains mixed run/field/line-break order, and
// the lookup view groups repeated elements using the fixed options above.
const orderedCache = new WeakMap<PptxArchiveEntry, Promise<OrderedXmlNode>>();
const lookupCache = new WeakMap<PptxArchiveEntry, XmlNode>();

function orderedXml(file: PptxArchiveEntry): Promise<OrderedXmlNode> {
  let ordered = orderedCache.get(file);
  if (!ordered) {
    ordered = file.async('text').then(content => parseOpenXml(content) ?? orderedParser.parse(content) as OrderedXmlNode);
    orderedCache.set(file, ordered);
  }
  return ordered;
}

export async function parseXmlFile(zip: PptxArchive, path: string): Promise<XmlNode | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }

  let lookup = lookupCache.get(file);
  if (!lookup) {
    lookup = groupXmlNodes(await orderedXml(file));
    lookupCache.set(file, lookup);
  }
  return lookup;
}

export async function parseXmlFileOrdered(zip: PptxArchive, path: string): Promise<OrderedXmlNode | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }

  return orderedXml(file);
}

function groupXmlNodes(nodes: OrderedXmlNode): XmlNode {
  const result: XmlNode = {};
  let text: unknown;
  for (const node of nodes) {
    const tag = Object.keys(node).find(key => key !== ':@');
    if (!tag) continue;
    if (tag === '#text') {
      text = text === undefined ? node[tag] : String(text) + String(node[tag]);
      continue;
    }
    if (!Array.isArray(node[tag])) continue;
    const children = groupXmlNodes(node[tag] as OrderedXmlNode);
    const attributes = node[':@'] as XmlNode | undefined;
    let value: unknown = children;
    if (attributes) {
      for (const [key, attribute] of Object.entries(attributes)) defineXmlProperty(children, key, attribute);
    } else {
      const keys = Object.keys(children);
      if (keys.length === 0) value = '';
      else if (keys.length === 1 && children['#text'] !== undefined) value = children['#text'];
    }
    if (Object.prototype.hasOwnProperty.call(result, tag) && result[tag] !== undefined) {
      const existing = result[tag];
      if (Array.isArray(existing)) existing.push(value);
      else defineXmlProperty(result, tag, [existing, value]);
    } else defineXmlProperty(result, tag, value);
  }
  if (text !== undefined && (typeof text !== 'string' || text.length)) result['#text'] = text;
  return result;
}

function defineXmlProperty(target: XmlNode, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}
