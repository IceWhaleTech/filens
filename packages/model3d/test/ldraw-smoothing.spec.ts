import { describe, expect, it } from 'vitest';
import type { Object3D } from 'three';
import { LDrawLoader as OriginalLDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import { LDrawLoader } from '../vendor/three/LDrawLoader.js';
import { createLDrawSmoothingFixture } from './fixtures/ldraw.mjs';

async function parse(Type: typeof LDrawLoader, source: string): Promise<Object3D> {
  const loader = new Type(); loader.setConditionalLineMaterial(LDrawConditionalLineMaterial); loader.setMaterials([]);
  return new Promise((resolve, reject) => (loader.parse as any)(source, resolve, reject));
}
function content(object: Object3D) {
  const result: any[] = [], geometries = new Set<any>(), materials = new Set<any>();
  object.traverse((node: any) => {
    if (!node.geometry) return;
    geometries.add(node.geometry);
    const material = Array.isArray(node.material) ? node.material : [node.material]; material.forEach((value: any) => materials.add(value));
    result.push({ type: node.type, attributes: Object.fromEntries(Object.entries(node.geometry.attributes).map(([name, value]: any) => [name, [...value.array]])),
      groups: node.geometry.groups, material: material.map((value: any) => ({ type: value.type, color: value.color.toArray(), roughness: value.roughness, side: value.side })) });
  });
  for (const value of geometries) value.dispose(); for (const value of materials) value.dispose(); return result;
}

describe('LDraw normal smoothing output equivalence', () => {
  it.each(['curved', 'quads', 'sharp', 'hard', 'multicolor', 'disconnected', 'reordered', 'duplicates'])('retains complete upstream geometry, normals, groups and materials for %s faces', async mode => {
    const source = createLDrawSmoothingFixture(mode);
    const original = content(await parse(OriginalLDrawLoader, source)), current = content(await parse(LDrawLoader, source));
    expect(current).toEqual(original); expect(current.length).toBeGreaterThan(0);
    expect(current.some(node => node.attributes.normal?.some((value: number) => value > 0 && value < 0.99))).toBe(true);
  });
});
