import type {
  ConversionRequest,
  ConversionResult,
  ConverterClient,
  PreviewLoadContext,
  PreviewSource
} from '@filens/core';
import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';
import imageConversionManifest from '../../../wasm/converter-image/manifest/conversions.json';
import { isConversionSourceUrl, isDataUrl, readDataUrl, retryableLoader, throwIfAborted, waitForConversion } from './source';

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

export type WasmModuleSource =
  | BufferSource
  | WebAssembly.Module
  | Response
  | string
  | URL
  | Promise<BufferSource | WebAssembly.Module | Response | string | URL>
  | (() => BufferSource | WebAssembly.Module | Response | string | URL | Promise<BufferSource | WebAssembly.Module | Response | string | URL>);

export interface WasmConverterClientOptions {
  wasm: WasmModuleSource;
  imageWasm?: WasmModuleSource;
  fetch?: typeof fetch;
}

export interface WasmCoreRunnerOptions extends WasmConverterClientOptions {}

export interface WasmCoreInvocation {
  args: string[];
  files: Record<string, Uint8Array>;
  readFiles?: string[];
  signal?: AbortSignal;
}

export interface WasmCoreInvocationResult {
  exitCode: number;
  files: Record<string, Uint8Array>;
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

export function createWasmCoreRunner(options: WasmCoreRunnerOptions) {
  const loadModule = retryableLoader(() => loadWasmModule(options.wasm, options.fetch));

  return async (invocation: WasmCoreInvocation): Promise<WasmCoreInvocationResult> => {
    const signal = invocation.signal;
    throwIfAborted(signal);
    const wasi = new InMemoryWasiHost({
      args: invocation.args,
      files: invocation.files
    });
    const module = await waitForConversion(loadModule(), signal);
    throwIfAborted(signal);
    const instance = await waitForConversion(WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.imports
    }), signal);
    throwIfAborted(signal);
    wasi.setInstance(instance);
    let exitCode = 0;
    try {
      (instance.exports._start as () => void)();
    } catch (error) {
      if (error instanceof WasiExit) {
        exitCode = error.code;
      } else {
        throw error;
      }
    }
    return {
      exitCode,
      files: Object.fromEntries((invocation.readFiles ?? []).flatMap((path) => {
        const bytes = wasi.readFileIfPresent(path);
        return bytes ? [[path, bytes]] : [];
      }))
    };
  };
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

async function loadWasmModule(source: WasmModuleSource, fetchImpl = globalThis.fetch): Promise<WebAssembly.Module> {
  const resolved = typeof source === 'function' ? await source() : await source;
  if (resolved instanceof WebAssembly.Module) {
    return resolved;
  }
  if (typeof resolved === 'string' || isUrlSource(resolved)) {
    if (!fetchImpl) {
    throw new Error('A fetch implementation is required to load converter WASM from a URL.');
    }
    return compileWasmResponse(await fetchImpl(String(resolved)));
  }
  if (typeof Response !== 'undefined' && resolved instanceof Response) {
    return compileWasmResponse(resolved);
  }
  return WebAssembly.compile(resolved);
}

function isUrlSource(source: unknown): source is URL {
  return typeof URL !== 'undefined' && source instanceof URL;
}

async function compileWasmResponse(response: Response): Promise<WebAssembly.Module> {
  if (!response.ok) {
    throw new Error(`Failed to fetch converter WASM: ${response.status} ${response.statusText}`.trim());
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

async function sourceToBytes(source: PreviewSource, fetchImpl = globalThis.fetch, signal?: AbortSignal): Promise<Uint8Array> {
  if (isBlobLikeSource(source)) {
    return new Uint8Array(await waitForConversion(source.arrayBuffer(), signal));
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (typeof source === 'string') {
    if (isDataUrl(source)) {
      return readDataUrl(source).bytes;
    }
    if (isConversionSourceUrl(source)) {
      if (!fetchImpl) throw new Error('A fetch implementation is required to load a conversion source URL.');
      const response = await waitForConversion(fetchImpl(source, { signal }), signal);
      throwIfAborted(signal);
      if (!response.ok) {
        throw new Error(`Failed to fetch conversion source: ${response.status} ${response.statusText}`.trim());
      }
      return new Uint8Array(await waitForConversion(response.arrayBuffer(), signal));
    }
    return new TextEncoder().encode(source);
  }
  throw new Error('Unsupported conversion source type.');
}

function isBlobLikeSource(source: PreviewSource): source is Blob | File {
  return typeof source === 'object'
    && source !== null
    && 'arrayBuffer' in source
    && typeof source.arrayBuffer === 'function';
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


class WasiExit extends Error {
  constructor(readonly code: number) {
    super(`WASI exited with code ${code}`);
  }
}

interface InMemoryWasiHostOptions {
  args: string[];
  files: Record<string, Uint8Array>;
}

type FileDescriptor =
  | { kind: 'stdio'; fd: 0 | 1 | 2; position: number }
  | { kind: 'dir'; path: string; position: number }
  | { kind: 'file'; path: string; position: number; append: boolean };

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_EXIST = 20;
const ERRNO_INVAL = 28;
const ERRNO_ISDIR = 31;
const ERRNO_NOENT = 44;
const ERRNO_NOTDIR = 54;
const ERRNO_NOTEMPTY = 55;

const FILETYPE_CHARACTER_DEVICE = 2;
const FILETYPE_DIRECTORY = 3;
const FILETYPE_REGULAR_FILE = 4;

const OFLAGS_CREAT = 1;
const OFLAGS_DIRECTORY = 2;
const OFLAGS_EXCL = 4;
const OFLAGS_TRUNC = 8;
const FDFLAGS_APPEND = 1;

class InMemoryWasiHost {
  readonly imports: Record<string, (...args: never[]) => number | void> = {
    args_get: (argv: number, argvBuf: number) => this.argsGet(argv, argvBuf),
    args_sizes_get: (argc: number, argvBufSize: number) => this.argsSizesGet(argc, argvBufSize),
    clock_time_get: (_clockId: number, _precision: bigint, timePtr: number) => this.clockTimeGet(timePtr),
    environ_get: (_environ: number, _environBuf: number) => ERRNO_SUCCESS,
    environ_sizes_get: (environCount: number, environBufSize: number) => this.environSizesGet(environCount, environBufSize),
    fd_close: (fd: number) => this.fdClose(fd),
    fd_fdstat_get: (fd: number, statPtr: number) => this.fdFdstatGet(fd, statPtr),
    fd_fdstat_set_flags: (_fd: number, _flags: number) => ERRNO_SUCCESS,
    fd_filestat_get: (fd: number, statPtr: number) => this.fdFilestatGet(fd, statPtr),
    fd_pread: (fd: number, iovs: number, iovsLen: number, offset: bigint, nread: number) =>
      this.fdRead(fd, iovs, iovsLen, nread, Number(offset), false),
    fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) => this.fdPrestatDirName(fd, pathPtr, pathLen),
    fd_prestat_get: (fd: number, prestatPtr: number) => this.fdPrestatGet(fd, prestatPtr),
    fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => this.fdRead(fd, iovs, iovsLen, nread),
    fd_seek: (fd: number, offset: bigint, whence: number, newOffset: number) => this.fdSeek(fd, offset, whence, newOffset),
    fd_tell: (fd: number, offset: number) => this.fdTell(fd, offset),
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => this.fdWrite(fd, iovs, iovsLen, nwritten),
    path_create_directory: (fd: number, pathPtr: number, pathLen: number) => this.pathCreateDirectory(fd, pathPtr, pathLen),
    path_filestat_get: (fd: number, _flags: number, pathPtr: number, pathLen: number, statPtr: number) =>
      this.pathFilestatGet(fd, pathPtr, pathLen, statPtr),
    path_open: (
      fd: number,
      _dirflags: number,
      pathPtr: number,
      pathLen: number,
      oflags: number,
      _rightsBase: bigint,
      _rightsInheriting: bigint,
      fdflags: number,
      openedFd: number
    ) => this.pathOpen(fd, pathPtr, pathLen, oflags, fdflags, openedFd),
    path_remove_directory: (fd: number, pathPtr: number, pathLen: number) => this.pathRemoveDirectory(fd, pathPtr, pathLen),
    path_unlink_file: (fd: number, pathPtr: number, pathLen: number) => this.pathUnlinkFile(fd, pathPtr, pathLen),
    poll_oneoff: (_in: number, _out: number, _subscriptions: number, nevents: number) => this.pollOneoff(nevents),
    proc_exit: (code: number) => {
      throw new WasiExit(code);
    },
    random_get: (buf: number, bufLen: number) => this.randomGet(buf, bufLen),
    sched_yield: () => ERRNO_SUCCESS
  };

  private instance?: WebAssembly.Instance;
  private readonly args: string[];
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(['/', '/work']);
  private readonly fds = new Map<number, FileDescriptor>([
    [0, { kind: 'stdio', fd: 0, position: 0 }],
    [1, { kind: 'stdio', fd: 1, position: 0 }],
    [2, { kind: 'stdio', fd: 2, position: 0 }],
    [3, { kind: 'dir', path: '/work', position: 0 }]
  ]);
  private nextFd = 4;

  constructor(options: InMemoryWasiHostOptions) {
    this.args = options.args;
    for (const [path, bytes] of Object.entries(options.files)) {
      this.writeInitialFile(path, bytes);
    }
  }

  setInstance(instance: WebAssembly.Instance): void {
    this.instance = instance;
  }

  readFile(path: string): Uint8Array {
    const file = this.files.get(normalizePath(path));
    if (!file) {
      throw new Error(`WASM file was not written: ${path}`);
    }
    const copy = new Uint8Array(file.byteLength);
    copy.set(file);
    return copy;
  }

  readFileIfPresent(path: string): Uint8Array | undefined {
    return this.files.has(normalizePath(path)) ? this.readFile(path) : undefined;
  }

  private get memory(): WebAssembly.Memory {
    const memory = this.instance?.exports.memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error('WASM instance did not export memory.');
    }
    return memory;
  }

  private get bytes(): Uint8Array {
    return new Uint8Array(this.memory.buffer);
  }

  private get view(): DataView {
    return new DataView(this.memory.buffer);
  }

  private argsSizesGet(argc: number, argvBufSize: number): number {
    this.view.setUint32(argc, this.args.length, true);
    this.view.setUint32(argvBufSize, encodedStringListSize(this.args), true);
    return ERRNO_SUCCESS;
  }

  private argsGet(argv: number, argvBuf: number): number {
    return this.writeStringList(this.args, argv, argvBuf);
  }

  private environSizesGet(environCount: number, environBufSize: number): number {
    this.view.setUint32(environCount, 0, true);
    this.view.setUint32(environBufSize, 0, true);
    return ERRNO_SUCCESS;
  }

  private clockTimeGet(timePtr: number): number {
    this.view.setBigUint64(timePtr, BigInt(Date.now()) * 1_000_000n, true);
    return ERRNO_SUCCESS;
  }

  private fdClose(fd: number): number {
    if (fd <= 3) {
      return ERRNO_SUCCESS;
    }
    return this.fds.delete(fd) ? ERRNO_SUCCESS : ERRNO_BADF;
  }

  private fdFdstatGet(fd: number, statPtr: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor) {
      return ERRNO_BADF;
    }
    this.bytes.fill(0, statPtr, statPtr + 24);
    this.bytes[statPtr] = fileTypeForDescriptor(descriptor);
    this.view.setBigUint64(statPtr + 8, 0xffff_ffff_ffff_ffffn, true);
    this.view.setBigUint64(statPtr + 16, 0xffff_ffff_ffff_ffffn, true);
    return ERRNO_SUCCESS;
  }

  private fdFilestatGet(fd: number, statPtr: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor) {
      return ERRNO_BADF;
    }
    if (descriptor.kind === 'file') {
      this.writeFilestat(statPtr, FILETYPE_REGULAR_FILE, this.files.get(descriptor.path)?.byteLength ?? 0);
      return ERRNO_SUCCESS;
    }
    if (descriptor.kind === 'dir') {
      this.writeFilestat(statPtr, FILETYPE_DIRECTORY, 0);
      return ERRNO_SUCCESS;
    }
    this.writeFilestat(statPtr, FILETYPE_CHARACTER_DEVICE, 0);
    return ERRNO_SUCCESS;
  }

  private fdPrestatGet(fd: number, prestatPtr: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor || descriptor.kind !== 'dir' || descriptor.path !== '/work') {
      return ERRNO_BADF;
    }
    this.bytes.fill(0, prestatPtr, prestatPtr + 8);
    this.view.setUint32(prestatPtr + 4, descriptor.path.length, true);
    return ERRNO_SUCCESS;
  }

  private fdPrestatDirName(fd: number, pathPtr: number, pathLen: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor || descriptor.kind !== 'dir') {
      return ERRNO_BADF;
    }
    const bytes = new TextEncoder().encode(descriptor.path);
    this.bytes.set(bytes.subarray(0, pathLen), pathPtr);
    return ERRNO_SUCCESS;
  }

  private fdRead(fd: number, iovs: number, iovsLen: number, nread: number, offset?: number, updatePosition = true): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor) {
      return ERRNO_BADF;
    }
    if (descriptor.kind !== 'file') {
      this.view.setUint32(nread, 0, true);
      return descriptor.kind === 'dir' ? ERRNO_ISDIR : ERRNO_SUCCESS;
    }

    const file = this.files.get(descriptor.path) ?? new Uint8Array();
    let position = offset ?? descriptor.position;
    let total = 0;
    for (const [target, length] of this.iovs(iovs, iovsLen)) {
      const chunk = file.subarray(position, position + length);
      this.bytes.set(chunk, target);
      position += chunk.byteLength;
      total += chunk.byteLength;
      if (chunk.byteLength < length) {
        break;
      }
    }
    if (updatePosition && offset === undefined) {
      descriptor.position = position;
    }
    this.view.setUint32(nread, total, true);
    return ERRNO_SUCCESS;
  }

  private fdSeek(fd: number, offset: bigint, whence: number, newOffset: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor || descriptor.kind !== 'file') {
      return descriptor?.kind === 'dir' ? ERRNO_ISDIR : ERRNO_BADF;
    }
    if (whence !== 0 && whence !== 1 && whence !== 2) return ERRNO_INVAL;
    const base = whence === 0
      ? 0
      : whence === 1
        ? descriptor.position
        : whence === 2
          ? this.files.get(descriptor.path)?.byteLength ?? 0
          : -1;
    const position = base + Number(offset);
    if (!Number.isSafeInteger(position) || position < 0) {
      return ERRNO_INVAL;
    }
    descriptor.position = position;
    this.view.setBigUint64(newOffset, BigInt(position), true);
    return ERRNO_SUCCESS;
  }

  private fdTell(fd: number, offset: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor || descriptor.kind !== 'file') {
      return descriptor?.kind === 'dir' ? ERRNO_ISDIR : ERRNO_BADF;
    }
    this.view.setBigUint64(offset, BigInt(descriptor.position), true);
    return ERRNO_SUCCESS;
  }

  private fdWrite(fd: number, iovs: number, iovsLen: number, nwritten: number): number {
    const descriptor = this.fds.get(fd);
    if (!descriptor) {
      return ERRNO_BADF;
    }
    let total = 0;
    if (descriptor.kind === 'stdio') {
      for (const [_source, length] of this.iovs(iovs, iovsLen)) {
        total += length;
      }
      this.view.setUint32(nwritten, total, true);
      return ERRNO_SUCCESS;
    }
    if (descriptor.kind !== 'file') {
      return ERRNO_ISDIR;
    }
    for (const [source, length] of this.iovs(iovs, iovsLen)) {
      // WASM execution is paused during this import; copy directly into the
      // owned file storage instead of allocating an intermediate chunk.
      const chunk = this.bytes.subarray(source, source + length);
      this.writeFileChunk(descriptor, chunk);
      total += length;
    }
    this.view.setUint32(nwritten, total, true);
    return ERRNO_SUCCESS;
  }

  private pathCreateDirectory(fd: number, pathPtr: number, pathLen: number): number {
    const path = this.readPath(fd, pathPtr, pathLen);
    if (!path) {
      return ERRNO_BADF;
    }
    this.ensureParentDir(path);
    if (this.files.has(path)) {
      return ERRNO_NOTDIR;
    }
    this.dirs.add(path);
    return ERRNO_SUCCESS;
  }

  private pathFilestatGet(fd: number, pathPtr: number, pathLen: number, statPtr: number): number {
    const path = this.readPath(fd, pathPtr, pathLen);
    if (!path) {
      return ERRNO_BADF;
    }
    if (this.files.has(path)) {
      this.writeFilestat(statPtr, FILETYPE_REGULAR_FILE, this.files.get(path)?.byteLength ?? 0);
      return ERRNO_SUCCESS;
    }
    if (this.dirs.has(path)) {
      this.writeFilestat(statPtr, FILETYPE_DIRECTORY, 0);
      return ERRNO_SUCCESS;
    }
    return ERRNO_NOENT;
  }

  private pathOpen(fd: number, pathPtr: number, pathLen: number, oflags: number, fdflags: number, openedFd: number): number {
    const path = this.readPath(fd, pathPtr, pathLen);
    if (!path) {
      return ERRNO_BADF;
    }
    if ((oflags & OFLAGS_CREAT) && (oflags & OFLAGS_EXCL) && (this.files.has(path) || this.dirs.has(path))) {
      return ERRNO_EXIST;
    }
    const wantsDirectory = Boolean(oflags & OFLAGS_DIRECTORY);
    if (wantsDirectory) {
      if (!this.dirs.has(path)) {
        return this.files.has(path) ? ERRNO_NOTDIR : ERRNO_NOENT;
      }
      return this.openDescriptor({ kind: 'dir', path, position: 0 }, openedFd);
    }

    if (!this.files.has(path)) {
      if (!(oflags & OFLAGS_CREAT)) {
        return this.dirs.has(path) ? ERRNO_ISDIR : ERRNO_NOENT;
      }
      this.ensureParentDir(path);
      this.files.set(path, new Uint8Array());
    } else if (oflags & OFLAGS_TRUNC) {
      this.files.set(path, new Uint8Array());
    }

    return this.openDescriptor(
      {
        kind: 'file',
        path,
        position: Boolean(fdflags & FDFLAGS_APPEND) ? this.files.get(path)?.byteLength ?? 0 : 0,
        append: Boolean(fdflags & FDFLAGS_APPEND)
      },
      openedFd
    );
  }

  private pathRemoveDirectory(fd: number, pathPtr: number, pathLen: number): number {
    const path = this.readPath(fd, pathPtr, pathLen);
    if (!path) {
      return ERRNO_BADF;
    }
    if (path === '/' || path === '/work') {
      return ERRNO_NOTEMPTY;
    }
    for (const dir of this.dirs) {
      if (dir !== path && dirname(dir) === path) {
        return ERRNO_NOTEMPTY;
      }
    }
    for (const file of this.files.keys()) {
      if (dirname(file) === path) {
        return ERRNO_NOTEMPTY;
      }
    }
    return this.dirs.delete(path) ? ERRNO_SUCCESS : ERRNO_NOENT;
  }

  private pathUnlinkFile(fd: number, pathPtr: number, pathLen: number): number {
    const path = this.readPath(fd, pathPtr, pathLen);
    if (!path) {
      return ERRNO_BADF;
    }
    return this.files.delete(path) ? ERRNO_SUCCESS : ERRNO_NOENT;
  }

  private pollOneoff(nevents: number): number {
    this.view.setUint32(nevents, 0, true);
    return ERRNO_SUCCESS;
  }

  private randomGet(buf: number, bufLen: number): number {
    const target = this.bytes.subarray(buf, buf + bufLen);
    const crypto = globalThis.crypto;
    if (crypto?.getRandomValues) {
      crypto.getRandomValues(target);
    } else {
      for (let index = 0; index < target.length; index += 1) {
        target[index] = Math.floor(Math.random() * 256);
      }
    }
    return ERRNO_SUCCESS;
  }

  private writeStringList(values: string[], pointersPtr: number, bufferPtr: number): number {
    let offset = bufferPtr;
    for (let index = 0; index < values.length; index += 1) {
      const encoded = new TextEncoder().encode(values[index]);
      this.view.setUint32(pointersPtr + index * 4, offset, true);
      this.bytes.set(encoded, offset);
      this.bytes[offset + encoded.byteLength] = 0;
      offset += encoded.byteLength + 1;
    }
    return ERRNO_SUCCESS;
  }

  private iovs(iovs: number, iovsLen: number): Array<[number, number]> {
    const result: Array<[number, number]> = [];
    for (let index = 0; index < iovsLen; index += 1) {
      const ptr = iovs + index * 8;
      result.push([this.view.getUint32(ptr, true), this.view.getUint32(ptr + 4, true)]);
    }
    return result;
  }

  private readPath(fd: number, pathPtr: number, pathLen: number): string | null {
    const base = this.fds.get(fd);
    if (!base || base.kind !== 'dir') {
      return null;
    }
    const rawPath = new TextDecoder().decode(this.bytes.subarray(pathPtr, pathPtr + pathLen));
    return resolvePath(base.path, rawPath);
  }

  private openDescriptor(descriptor: FileDescriptor, openedFd: number): number {
    const fd = this.nextFd++;
    this.fds.set(fd, descriptor);
    this.view.setUint32(openedFd, fd, true);
    return ERRNO_SUCCESS;
  }

  private writeFilestat(statPtr: number, filetype: number, size: number): void {
    this.bytes.fill(0, statPtr, statPtr + 64);
    this.bytes[statPtr + 16] = filetype;
    this.view.setBigUint64(statPtr + 24, 1n, true);
    this.view.setBigUint64(statPtr + 32, BigInt(size), true);
  }

  private writeInitialFile(path: string, bytes: Uint8Array): void {
    const normalized = normalizePath(path);
    this.ensureParentDir(normalized);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    this.files.set(normalized, copy);
  }

  private ensureParentDir(path: string): void {
    const parent = dirname(path);
    if (parent === path || this.dirs.has(parent)) {
      return;
    }
    this.ensureParentDir(parent);
    this.dirs.add(parent);
  }

  private writeFileChunk(descriptor: Extract<FileDescriptor, { kind: 'file' }>, chunk: Uint8Array): void {
    // A zero-byte write must not extend a file after seeking beyond EOF.
    if (!chunk.byteLength) return;
    const previous = this.files.get(descriptor.path) ?? new Uint8Array();
    const position = descriptor.append ? previous.byteLength : descriptor.position;
    const nextLength = Math.max(previous.byteLength, position + chunk.byteLength);
    // Keep the map's view at logical length so reads, seeks and stat never
    // expose spare capacity. Grow geometrically to amortize incremental writes.
    let next: Uint8Array;
    if (nextLength <= previous.buffer.byteLength) {
      next = new Uint8Array(previous.buffer, 0, nextLength);
    } else {
      const storage = new Uint8Array(Math.max(nextLength, previous.buffer.byteLength * 2));
      storage.set(previous);
      next = storage.subarray(0, nextLength);
    }
    next.set(chunk, position);
    this.files.set(descriptor.path, next);
    descriptor.position = position + chunk.byteLength;
  }
}

function encodedStringListSize(values: string[]): number {
  return values.reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength + 1, 0);
}

function fileTypeForDescriptor(descriptor: FileDescriptor): number {
  switch (descriptor.kind) {
    case 'dir':
      return FILETYPE_DIRECTORY;
    case 'file':
      return FILETYPE_REGULAR_FILE;
    default:
      return FILETYPE_CHARACTER_DEVICE;
  }
}

function resolvePath(base: string, path: string): string {
  if (path.startsWith('/')) {
    return normalizePath(path);
  }
  return normalizePath(`${base}/${path}`);
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return '/';
  }
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}
