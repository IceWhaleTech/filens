import type { ThemeColorMap } from '../types';

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').padEnd(6, '0');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((part) => {
      const value = clampByte(part);
      return value.toString(16).padStart(2, '0');
    })
    .join('')}`.toUpperCase();
}

export function applyTint(hex: string, amount: number): string {
  return mapHsl(hex, ({ h, s, l }) => ({
    h,
    s,
    l: l + (1 - l) * clampUnit(amount)
  }));
}

export function applyShade(hex: string, amount: number): string {
  const modifier = clampUnit(amount);
  return mapLinearRgb(hex, (channel) => channel * modifier);
}

export function applyLumMod(hex: string, amount: number): string {
  return mapHsl(hex, ({ h, s, l }) => ({
    h,
    s,
    l: l * amount
  }));
}

export function applyLumOff(hex: string, amount: number): string {
  return mapHsl(hex, ({ h, s, l }) => ({
    h,
    s,
    l: l + amount
  }));
}

export function resolveThemeColor(name: string, themeColors: ThemeColorMap, clrMap: Record<string, string>): string {
  const normalized = clrMap[name] ?? name;
  return themeColors[normalized] ?? themeColors[name] ?? '#000000';
}

function mapLinearRgb(hex: string, modifier: (channel: number) => number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([
    linearToSrgb(modifier(srgbToLinear(r / 255))) * 255,
    linearToSrgb(modifier(srgbToLinear(g / 255))) * 255,
    linearToSrgb(modifier(srgbToLinear(b / 255))) * 255
  ]);
}

function mapHsl(
  hex: string,
  modifier: (color: { h: number; s: number; l: number }) => { h: number; s: number; l: number }
): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
  const next = modifier({ h, s, l });
  const [nextR, nextG, nextB] = hslToRgb(next.h, clampUnit(next.s), clampUnit(next.l));
  return rgbToHex([nextR * 255, nextG * 255, nextB * 255]);
}

function srgbToLinear(channel: number): number {
  if (channel <= 0.04045) {
    return channel / 12.92;
  }
  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(channel: number): number {
  const normalized = clampUnit(channel);
  if (normalized <= 0.0031308) {
    return normalized * 12.92;
  }
  return 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;

  switch (max) {
    case r:
      h = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / delta + 2;
      break;
    default:
      h = (r - g) / delta + 4;
      break;
  }

  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    return [l, l, l];
  }

  const normalizedHue = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    hueToRgb(p, q, normalizedHue + 1 / 3),
    hueToRgb(p, q, normalizedHue),
    hueToRgb(p, q, normalizedHue - 1 / 3)
  ];
}

function hueToRgb(p: number, q: number, t: number): number {
  let normalized = t;
  if (normalized < 0) {
    normalized += 1;
  }
  if (normalized > 1) {
    normalized -= 1;
  }
  if (normalized < 1 / 6) {
    return p + (q - p) * 6 * normalized;
  }
  if (normalized < 1 / 2) {
    return q;
  }
  if (normalized < 2 / 3) {
    return p + (q - p) * (2 / 3 - normalized) * 6;
  }
  return p;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
