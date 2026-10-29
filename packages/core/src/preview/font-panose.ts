import type { PreviewFontTraits } from './types';

export function parseFontPanose(value: string | undefined): number[] | undefined {
  if (typeof value !== 'string' || !/^[\da-f]{20}$/i.test(value.trim())) return undefined;
  const bytes = value.trim().match(/../g)!.map(byte => Number.parseInt(byte, 16));
  return bytes[0] >= 2 && bytes[0] <= 5 ? bytes : undefined;
}

/** PANOSE byte meanings vary by family. Reserved/Any/No Fit values supply no traits. */
export function fontTraitsFromPanose(value: string | undefined): PreviewFontTraits {
  const bytes = parseFontPanose(value);
  if (!bytes) return {};
  const traits: PreviewFontTraits = { panose: value!.trim().toUpperCase() };
  traits.style = ({ 2: 'text', 3: 'handwriting', 4: 'decorative', 5: 'symbol' } as const)[bytes[0] as 2 | 3 | 4 | 5];
  if (bytes[0] !== 5) {
    const weights: Record<number, number> = { 2: 100, 3: 200, 4: 300, 5: 400, 6: 400, 7: 600, 8: 700, 9: 800, 10: 900, 11: 950 };
    if (weights[bytes[2]]) traits.weight = weights[bytes[2]];
  }
  if (bytes[0] === 2) {
    if (bytes[1] >= 2 && bytes[1] <= 10) traits.serif = true;
    else if (bytes[1] >= 11 && bytes[1] <= 15) traits.serif = false;
    if (bytes[3] >= 2 && bytes[3] <= 9) traits.monospace = bytes[3] === 9;
    const widths: Record<number, number> = { 5: 125, 6: 75, 7: 150, 8: 62.5 };
    if (widths[bytes[3]]) traits.stretch = widths[bytes[3]];
  }
  return traits;
}
