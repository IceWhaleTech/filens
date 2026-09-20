export const EMUS_PER_PIXEL = 9525;
export const ANGLE_UNITS_PER_DEGREE = 60000;

export function emuToPx(value: number): number {
  return value / EMUS_PER_PIXEL;
}

export function angleToDegrees(value: number): number {
  return value / ANGLE_UNITS_PER_DEGREE;
}
