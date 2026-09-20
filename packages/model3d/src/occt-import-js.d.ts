declare module 'occt-import-js' {
  interface OcctImportOptions {
    locateFile?: (path: string) => string;
  }

  interface OcctMesh {
    name?: string;
    color?: [number, number, number];
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }

  interface OcctNode {
    name?: string;
    meshes?: number[];
    children?: OcctNode[];
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
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
