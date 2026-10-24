interface CssReference {
  start: number;
  end: number;
  value: string;
  stylesheet: boolean;
}

// Find URL tokens without touching comments or literal strings such as content:"url(...)".
export async function rewriteCssResources(
  css: string,
  resolve: (value: string, stylesheet: boolean) => Promise<string | undefined>
): Promise<string> {
  const references: CssReference[] = [];
  for (let index = 0; index < css.length;) {
    if (css.startsWith('/*', index)) { index = commentEnd(css, index); continue; }
    if (css[index] === '"' || css[index] === "'") { index = stringEnd(css, index); continue; }
    let start = index, stylesheet = false;
    if (/^@import(?![\w-])/i.test(css.slice(index, index + 9))) {
      stylesheet = true;
      start = skipSpace(css, index + 7);
      if (css[start] === '"' || css[start] === "'") {
        const end = stringEnd(css, start);
        if (css[end - 1] === css[start]) references.push({ start, end, value: unescapeCss(css.slice(start + 1, end - 1)), stylesheet });
        index = end; continue;
      }
    }
    if ((start === 0 || !/[\w\\-]/.test(css[start - 1]!)) && /^url\(/i.test(css.slice(start, start + 4))) {
      const valueStart = skipSpace(css, start + 4);
      let end = valueStart, value: string;
      if (css[valueStart] === '"' || css[valueStart] === "'") {
        end = stringEnd(css, valueStart);
        if (css[end - 1] !== css[valueStart]) { index = end; continue; }
        value = css.slice(valueStart + 1, end - 1);
      } else {
        while (end < css.length && css[end] !== ')') {
          if (css[end] === '\\') end++;
          end++;
        }
        value = css.slice(valueStart, end).trimEnd();
      }
      const close = skipSpace(css, end);
      if (css[close] === ')') {
        references.push({ start: valueStart, end, value: unescapeCss(value), stylesheet });
        index = close + 1; continue;
      }
    }
    index++;
  }
  const parts: string[] = [];
  let position = 0;
  for (const reference of references) {
    const url = await resolve(reference.value, reference.stylesheet);
    if (url === undefined) continue;
    parts.push(css.slice(position, reference.start), quoteCss(url));
    position = reference.end;
  }
  if (!position) return css;
  parts.push(css.slice(position));
  return parts.join('');
}

function commentEnd(css: string, index: number): number {
  const end = css.indexOf('*/', index + 2);
  return end < 0 ? css.length : end + 2;
}

function skipSpace(css: string, index: number): number {
  while (index < css.length) {
    if (/\s/.test(css[index]!)) index++;
    else if (css.startsWith('/*', index)) index = commentEnd(css, index);
    else break;
  }
  return index;
}

function stringEnd(css: string, index: number): number {
  const quote = css[index++];
  while (index < css.length) {
    if (css[index] === '\\') index += 2;
    else if (css[index++] === quote) return index;
  }
  return css.length;
}

function unescapeCss(value: string): string {
  return value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\n\r\f])|(.))/gi,
    (_match, hex: string | undefined, newline: string | undefined, character: string | undefined) => {
      if (hex) {
        const code = parseInt(hex, 16);
        return String.fromCodePoint(!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code);
      }
      return newline ? '' : character ?? '';
    });
}

function quoteCss(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}"`;
}
