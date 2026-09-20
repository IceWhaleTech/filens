import { describe, expect, it } from 'vitest';
import { applyLumMod, applyLumOff, applyShade, applyTint } from '../src/utils/colors';

describe('colors', () => {
  it('applies tint by lifting HSL luminance toward white', () => {
    expect(applyTint('#000000', 0.5)).toBe('#808080');
  });

  it('applies shade in linear RGB so theme-derived line colors stay close to PowerPoint', () => {
    expect(applyShade('#808080', 0.5)).toBe('#5C5C5C');
    expect(applyShade('#4472C4', 0.15)).toBe('#172C51');
  });

  it('applies lumMod and lumOff in HSL luminance space', () => {
    expect(applyLumMod('#FFC000', 0.6)).toBe('#997300');
    expect(applyLumOff('#997300', 0.4)).toBe('#FFD966');
  });
});
