import { createStepReader } from 'filens-step';

export interface StepImportResult {
  success: boolean;
  root?: { meshes: number[] };
  meshes?: Array<{
    attributes: { position: { array: number[] | Float32Array }; normal?: { array: number[] | Float32Array } };
    index?: { array: number[] };
  }>;
  warnings?: string[];
}
export interface StepImporter {
  ReadStepFile(content: Uint8Array, options: { linearUnit: 'millimeter' }, signal?: AbortSignal): StepImportResult | Promise<StepImportResult>;
}

export async function createRustStepImporter(): Promise<StepImporter> {
  const reader = createStepReader();
  return {
    async ReadStepFile(content, _options, signal) {
      const mesh = await reader.read(content, { signal });
      return {
        success: true, root: { meshes: [0] }, warnings: mesh.warnings,
        meshes: [{ attributes: { position: { array: mesh.positions }, normal: { array: mesh.normals } } }]
      };
    }
  };
}
