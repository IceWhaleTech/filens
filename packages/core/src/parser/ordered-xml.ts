import type { OrderedXmlNode, XmlNode } from './xml';

// OpenXML normally contains quoted attributes, the five XML entities, and
// ordinary elements. Tokenize that subset without constructing tag paths or
// copying opening tags character by character. Other XML uses the full parser.
const token = /([^<]+)|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?xml\s+([^?]*)\?>|<\/([^\s/>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/gy;
const attribute = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const entity = /&(amp|lt|gt|quot|apos|#38|#x26|#60|#x3C|#62|#x3E|#34|#x22|#39|#x27);/g;
// Match the full parser's entity policy, including its five numeric aliases.
const entities: Record<string, string> = {
  amp: '&', '#38': '&', '#x26': '&', lt: '<', '#60': '<', '#x3C': '<',
  gt: '>', '#62': '>', '#x3E': '>', quot: '"', '#34': '"', '#x22': '"',
  apos: "'", '#39': "'", '#x27': "'"
};

interface ElementFrame {
  tag: string;
  children: OrderedXmlNode;
  text: string;
}

export function parseOpenXml(source: string): OrderedXmlNode | null {
  if (!source.startsWith('<')) return null;
  const xml = source.replace(/\r\n?/g, '\n');
  const root: ElementFrame = { tag: '', children: [], text: '' };
  const stack = [root];
  token.lastIndex = 0;
  let position = 0;
  try {
    while (position < xml.length) {
      const match = token.exec(xml);
      if (!match || match.index !== position) return null;
      position = token.lastIndex;
      const current = stack[stack.length - 1];
      if (match[1] !== undefined) {
        // The full parser ignores text outside the document element.
        if (stack.length > 1) current.text += match[1];
      } else if (match[2] !== undefined) {
        flushText(current);
        current.children.push({ '#text': match[2] });
      } else if (match[3] !== undefined) {
        flushText(current);
        const declaration: XmlNode = { '?xml': [{ '#text': '' }] };
        declaration[':@'] = parseAttributes(match[3]);
        current.children.push(declaration);
      } else if (match[4] !== undefined) {
        if (stack.length === 1 || current.tag !== match[4]) return null;
        flushText(current);
        stack.pop();
      } else if (match[5] !== undefined) {
        const tag = match[5];
        if (tag === ':@' || tag === '#text' || tag === '__proto__') return null;
        flushText(current);
        const children: OrderedXmlNode = [];
        const node: XmlNode = {};
        setProperty(node, tag, children);
        if (match[6].trim()) node[':@'] = parseAttributes(match[6]);
        current.children.push(node);
        if (!match[7]) {
          if (stack.length > 101) return null;
          stack.push({ tag, children, text: '' });
        }
      }
      // Comments leave pending text intact, as in the full ordered parser.
    }
    return stack.length === 1 ? root.children : null;
  } catch {
    // Unfamiliar syntax retains the full parser's existing error handling.
    return null;
  }
}

function flushText(frame: ElementFrame): void {
  if (frame.text) {
    frame.children.push({ '#text': decodeEntities(frame.text) });
    frame.text = '';
  }
}

function parseAttributes(source: string): XmlNode {
  const attributes: XmlNode = {};
  attribute.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(source))) {
    if (match[1] in Object.prototype || match[1] === 'prototype') throw new Error('Reserved XML attribute');
    setProperty(attributes, match[1], decodeEntities(match[2] ?? match[3]));
  }
  return attributes;
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(entity, (_, name: string) => entities[name]);
}

function setProperty(target: XmlNode, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}
