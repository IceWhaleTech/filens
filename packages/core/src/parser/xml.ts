import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  trimValues: false,
  parseAttributeValue: false
});

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

export async function parseXmlFile(zip: JSZip, path: string): Promise<XmlNode | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }

  const content = await file.async('text');
  return parser.parse(content) as XmlNode;
}

export async function parseXmlFileOrdered(zip: JSZip, path: string): Promise<OrderedXmlNode | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }

  const content = await file.async('text');
  return orderedParser.parse(content) as OrderedXmlNode;
}
