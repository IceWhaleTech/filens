import { describe, expect, it } from 'vitest';
import { deepClone } from '../src/utils/common';
import { angleToDegrees, emuToPx } from '../src/utils/units';

describe('units', () => {
  it('converts EMU values to pixels', () => {
    expect(emuToPx(9525)).toBe(1);
    expect(emuToPx(19050)).toBe(2);
  });

  it('converts OOXML angle units to degrees', () => {
    expect(angleToDegrees(60000)).toBe(1);
    expect(angleToDegrees(1800000)).toBe(30);
  });

  it('safely clones undefined values and plain objects', () => {
    expect(deepClone(undefined)).toBeUndefined();

    const original = {
      fill: {
        type: 'solid' as const,
        color: '#2F6BFF'
      }
    };
    const cloned = deepClone(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.fill).not.toBe(original.fill);
  });
});
