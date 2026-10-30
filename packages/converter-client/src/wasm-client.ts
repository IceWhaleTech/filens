import { createWasmCoreRunner, InMemoryWasiHost, loadWasmModule, type WasmModuleSource } from './wasi-runner';
export { createWasmCoreRunner } from './wasi-runner';
export type { WasmModuleSource, WasmCoreRunnerOptions, WasmCoreInvocation, WasmCoreInvocationResult } from './wasi-runner';
import type {
  ConversionRequest,
  ConversionResult,
  ConverterClient,
  PreviewLoadContext
} from '@filens/core';
import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';
import imageConversionManifest from '../../../wasm/converter-image/manifest/conversions.json';
import { sourceToBytes, retryableLoader, throwIfAborted, waitForConversion } from './source';

interface ConversionManifestEntry {
  sourceFormat: string;
  targetFormat: string;
}

const supportedSources = new Set(
  (conversionManifest as ConversionManifestEntry[]).map((entry) => normalizeFormat(entry.sourceFormat))
);
const supportedConversionPairs = new Set(
  (conversionManifest as ConversionManifestEntry[]).map((entry) =>
    `${normalizeFormat(entry.sourceFormat)}->${normalizeFormat(entry.targetFormat)}`
  )
);
const imageConversionPairs = new Set(
  (imageConversionManifest as ConversionManifestEntry[]).map((entry) =>
    `${normalizeFormat(entry.sourceFormat)}->${normalizeFormat(entry.targetFormat)}`
  )
);

export interface WasmConverterClientOptions {
  wasm: WasmModuleSource;
  imageWasm?: WasmModuleSource;
  fetch?: typeof fetch;
}

export interface WasmCoreMetrics {
  elapsedMs?: number;
  inputSize?: number;
}

export interface WasmCoreResult {
  ok: boolean;
  sourceFormat?: string;
  targetFormat?: string;
  backend?: string;
  fidelity?: string;
  contentType?: string;
  warnings?: string[];
  errorCode?: string;
  errorMessage?: string;
  metrics?: WasmCoreMetrics;
}

export class WasmConversionError extends Error {
  constructor(readonly result: WasmCoreResult) {
    super(result.errorMessage || result.errorCode || 'WASM conversion failed.');
    this.name = 'WasmConversionError';
  }
}

export function createWasmConverterClient(options: WasmConverterClientOptions): ConverterClient {
  const runCore = createWasmCoreRunner(options);
  const imageModule = options.imageWasm
    ? retryableLoader(() => loadWasmModule(options.imageWasm!, options.fetch))
    : undefined;
  const runImage = options.imageWasm
    ? createWasmCoreRunner({ wasm: imageModule!, fetch: options.fetch })
    : undefined;
  const previewImage = imageModule ? createImagePreviewRunner(imageModule) : undefined;

  return {
    async convert(request, context) {
      throwIfAborted(context.signal);
      const sourceFormat = normalizeFormat(request.sourceFormat);
      const targetFormat = normalizeFormat(request.targetFormat);
      const conversionPair = validateSupportedConversionPair(sourceFormat, targetFormat);
      const inputPath = `/work/input.${sourceFormat}`;
      const outputPath = `/work/output.${targetFormat}`;
      const optionsPath = '/work/options.json';
      const resultPath = '/work/result.json';
      const input = await sourceToBytes(request.source, options.fetch, context.signal);
      throwIfAborted(context.signal);
      const requestOptions = JSON.stringify({
        ...(request.password ? { password: request.password } : {}),
        ...(request.locale ? { locale: request.locale } : {})
      });

      const useImageConverter = Boolean(runImage && imageConversionPairs.has(conversionPair));
      if (useImageConverter && targetFormat === 'jpg' && previewImage) {
        const preview = await previewImage(input, context.signal);
        throwIfAborted(context.signal);
        if (preview) return preview;
      }
      const runConverter = useImageConverter ? runImage! : runCore;
      const invocation = await runConverter({
        args: [
          useImageConverter ? 'converter-image' : 'converter-core',
          '--input',
          inputPath,
          '--output',
          outputPath,
          '--source',
          sourceFormat,
          '--target',
          targetFormat,
          '--options',
          optionsPath,
          '--result',
          resultPath
        ],
        files: {
          [inputPath]: input,
          [optionsPath]: new TextEncoder().encode(requestOptions)
        },
        readFiles: [resultPath, outputPath],
        signal: context.signal
      });
      throwIfAborted(context.signal);

      const coreResult = parseCoreResult(invocation.files[resultPath]);
      if (!coreResult.ok) {
        throw new WasmConversionError(coreResult);
      }
      if (invocation.exitCode !== 0) {
        throw new WasmConversionError({
          ...coreResult,
          ok: false,
          errorCode: coreResult.errorCode || 'conversion_failed',
          errorMessage: coreResult.errorMessage || `converter WASM exited with code ${invocation.exitCode}`
        });
      }

      const output = invocation.files[outputPath];
      return {
        source: output,
        format: normalizeFormat(coreResult.targetFormat || targetFormat),
        contentType: coreResult.contentType,
        warnings: coreResult.warnings
      } satisfies ConversionResult;
    }
  };
}

interface ImagePreviewExports {
  memory: WebAssembly.Memory;
  filens_image_alloc(length: number): number;
  filens_image_free(pointer: number, length: number): void;
  filens_image_preview(pointer: number, length: number): bigint;
}

function createImagePreviewRunner(loadModule: () => Promise<WebAssembly.Module>) {
  const runtime = retryableLoader(async () => {
    const module = await loadModule();
    const names = new Set(WebAssembly.Module.exports(module).map(entry => entry.name));
    if (!['filens_image_alloc', 'filens_image_free', 'filens_image_preview', 'memory'].every(name => names.has(name))) return null;
    const wasi = new InMemoryWasiHost({ args: ['converter-image'], files: {} });
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.imports });
    wasi.setInstance(instance);
    return instance.exports as unknown as ImagePreviewExports;
  });

  return async (input: Uint8Array, signal?: AbortSignal): Promise<ConversionResult | null> => {
    const instance = await waitForConversion(runtime(), signal);
    throwIfAborted(signal);
    // Older image modules remain compatible through the existing WASI path.
    if (!instance || input.length === 0) return null;
    let inputPointer = 0, outputPointer = 0, outputLength = 0;
    try {
      inputPointer = instance.filens_image_alloc(input.length) >>> 0;
      if (!inputPointer) throw new Error('Image core could not allocate its input buffer.');
      new Uint8Array(instance.memory.buffer).set(input, inputPointer);
      const output = instance.filens_image_preview(inputPointer, input.length);
      outputPointer = Number(output & 0xffffffffn);
      outputLength = Number(output >> 32n);
      if (!outputPointer || outputLength < 4 || outputPointer + outputLength > instance.memory.buffer.byteLength) throw new Error('Image core returned an invalid preview buffer.');
      const bytes = new Uint8Array(instance.memory.buffer, outputPointer, outputLength);
      const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
      if (metadataLength > bytes.length - 4) throw new Error('Image core returned invalid preview metadata.');
      const metadata = parseCoreResult(bytes.subarray(4, 4 + metadataLength));
      if (!metadata.ok) throw new WasmConversionError(metadata);
      return { source: bytes.slice(4 + metadataLength), format: 'jpg', contentType: metadata.contentType, warnings: metadata.warnings };
    } finally {
      if (outputPointer && outputLength) instance.filens_image_free(outputPointer, outputLength);
      if (inputPointer) instance.filens_image_free(inputPointer, input.length);
    }
  };
}

function validateSupportedConversionPair(sourceFormat: string, targetFormat: string): string {
  const pair = `${sourceFormat}->${targetFormat}`;
  if (supportedConversionPairs.has(pair)) {
    return pair;
  }
  const errorMessage = supportedSources.has(sourceFormat)
    ? `unsupported conversion pair: ${sourceFormat} -> ${targetFormat}`
    : `unsupported source format: ${sourceFormat}`;
  throw new WasmConversionError({
    ok: false,
    sourceFormat,
    targetFormat,
    warnings: [],
    errorCode: 'unsupported_format',
    errorMessage,
    metrics: {}
  });
}

function parseCoreResult(bytes: Uint8Array): WasmCoreResult {
  const payload = new TextDecoder().decode(bytes);
  const result = JSON.parse(payload) as WasmCoreResult;
  return {
    ...result,
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : []
  };
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
}
