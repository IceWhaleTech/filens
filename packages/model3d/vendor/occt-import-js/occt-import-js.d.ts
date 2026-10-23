interface OcctImportOptions {
  locateFile?: (path: string) => string;
  wasmBinary?: Uint8Array;
}

interface OcctMesh {
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] };
  };
  index: { array: number[] };
}

interface OcctNode {
  meshes: number[];
}

interface OcctResult {
  success: boolean;
  root?: OcctNode;
  meshes?: OcctMesh[];
}

export interface OcctImporter {
  ReadStepFile(content: Uint8Array, params: { linearUnit: 'millimeter' }): OcctResult;
}

export default function createOcctImporter(options?: OcctImportOptions): Promise<OcctImporter>;
