import type {
  ConversionRequest,
  ConversionResult,
  ConverterClient,
  PreviewLoadContext,
  PreviewSource
} from '@filens/core';
import { base64ToBytes, isConversionSourceUrl, isDataUrl, readDataUrl, throwIfAborted, waitForConversion } from './source';

export * from './wasm-client';

export interface HttpConverterClientOptions {
  endpoint: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | ((request: ConversionRequest) => HeadersInit | undefined);
  credentials?: RequestCredentials;
  responseType?: 'json' | 'blob';
}

export interface MockConversionRule {
  sourceFormat: string;
  targetFormat: string;
  source: PreviewSource | ((request: ConversionRequest) => PreviewSource | Promise<PreviewSource>);
  contentType?: string;
  warnings?: string[];
  cacheKey?: string;
}

export interface HttpConversionErrorResult {
  ok?: boolean;
  format?: string;
  sourceFormat?: string;
  targetFormat?: string;
  backend?: string;
  fidelity?: string;
  contentType?: string;
  warnings?: string[];
  errorCode?: string;
  errorMessage?: string;
  metrics?: Record<string, unknown>;
}

export class HttpConversionError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly result?: HttpConversionErrorResult
  ) {
    const statusMessage = `Conversion failed: ${status} ${statusText}`.trim();
    const detail = result?.errorMessage || result?.errorCode;
    super(detail ? `${statusMessage}: ${detail}` : statusMessage);
    this.name = 'HttpConversionError';
  }
}

export function createHttpConverterClient(options: HttpConverterClientOptions): ConverterClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('A fetch implementation is required for HTTP conversion.');
  }

  return {
    async convert(request, context) {
      const signal = context.signal;
      throwIfAborted(signal);
      const body = new FormData();
      body.set('sourceFormat', request.sourceFormat);
      body.set('targetFormat', request.targetFormat);
      if (request.name) body.set('name', request.name);
      if (request.password) body.set('password', request.password);
      if (request.locale) body.set('locale', request.locale);
      body.set('file', await sourceToBlob(request.source, request, fetchImpl, signal), inferUploadFileName(request));
      throwIfAborted(signal);

      const headers = typeof options.headers === 'function' ? options.headers(request) : options.headers;
      throwIfAborted(signal);
      const response = await waitForConversion(fetchImpl(options.endpoint, {
        method: 'POST',
        body,
        signal,
        credentials: options.credentials,
        headers
      }), signal);
      throwIfAborted(signal);

      if (!response.ok) {
        throw await waitForConversion(httpConversionError(response, request), signal);
      }

      if ((options.responseType ?? 'json') === 'blob') {
        return waitForConversion(blobResponseToConversionResult(response, request.targetFormat), signal);
      }

      const payload = await waitForConversion(response.json(), signal);
      throwIfAborted(signal);
      return jsonResponseToConversionResult(payload, request, response);
    }
  };
}

async function httpConversionError(response: Response, request: ConversionRequest): Promise<HttpConversionError> {
  return new HttpConversionError(response.status, response.statusText, await readHttpErrorResult(response, request));
}

export function createMockConverterClient(rules: MockConversionRule[]): ConverterClient {
  return {
    async convert(request) {
      const rule = rules.find(
        (item) => normalizeFormat(item.sourceFormat) === normalizeFormat(request.sourceFormat)
          && normalizeFormat(item.targetFormat) === normalizeFormat(request.targetFormat)
      );
      if (!rule) {
        throw new Error(`No mock conversion registered for ${request.sourceFormat} -> ${request.targetFormat}.`);
      }

      return {
        source: typeof rule.source === 'function' ? await rule.source(request) : rule.source,
        format: rule.targetFormat,
        contentType: rule.contentType,
        warnings: rule.warnings,
        cacheKey: rule.cacheKey
      };
    }
  };
}

async function readHttpErrorResult(response: Response, request: ConversionRequest): Promise<HttpConversionErrorResult | undefined> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return normalizeHttpErrorResult(await response.json(), request);
    } catch {
      return undefined;
    }
  }

  const headerResult = httpErrorResultFromHeaders(response.headers, request);
  return headerResult.errorCode || headerResult.errorMessage ? headerResult : undefined;
}

function normalizeHttpErrorResult(payload: unknown, request: ConversionRequest): HttpConversionErrorResult | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  return {
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    format: typeof record.format === 'string' ? normalizeFormat(record.format) : undefined,
    sourceFormat:
      typeof record.sourceFormat === 'string' ? normalizeFormat(record.sourceFormat) : normalizeFormat(request.sourceFormat),
    targetFormat:
      typeof record.targetFormat === 'string' ? normalizeFormat(record.targetFormat) : normalizeFormat(request.targetFormat),
    backend: typeof record.backend === 'string' ? record.backend : undefined,
    fidelity: typeof record.fidelity === 'string' ? record.fidelity : undefined,
    contentType: typeof record.contentType === 'string' ? record.contentType : undefined,
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : [],
    errorCode: typeof record.errorCode === 'string' ? record.errorCode : undefined,
    errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : undefined,
    metrics: record.metrics && typeof record.metrics === 'object' ? (record.metrics as Record<string, unknown>) : undefined
  };
}

function httpErrorResultFromHeaders(headers: Headers, request: ConversionRequest): HttpConversionErrorResult {
  return {
    ok: readHeader(headers, 'x-preview-ok') === 'true' ? true : readHeader(headers, 'x-preview-ok') === 'false' ? false : undefined,
    format: readHeader(headers, 'x-preview-format') ?? undefined,
    sourceFormat: readHeader(headers, 'x-preview-source-format') ?? normalizeFormat(request.sourceFormat),
    targetFormat: readHeader(headers, 'x-preview-target-format') ?? normalizeFormat(request.targetFormat),
    backend: readHeader(headers, 'x-preview-backend') ?? undefined,
    fidelity: readHeader(headers, 'x-preview-fidelity') ?? undefined,
    warnings: parseWarningsHeader(headers) ?? [],
    errorCode: readHeader(headers, 'x-preview-error-code') ?? undefined,
    errorMessage: readHeader(headers, 'x-preview-error-message') ?? undefined
  };
}

async function sourceToBlob(source: PreviewSource, request: ConversionRequest, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Blob> {
  const inferredType = inferContentType(request.name, request.sourceFormat);
  if (source instanceof Blob) {
    if (source.type || inferredType === 'application/octet-stream') {
      return source;
    }
    return new Blob([source], {
      type: inferredType
    });
  }
  if (typeof source === 'string') {
    if (isDataUrl(source)) {
      return dataUrlToBlob(source, inferredType);
    }
    if (isConversionSourceUrl(source)) {
      const response = await waitForConversion(fetchImpl(source, { signal }), signal);
      throwIfAborted(signal);
      if (!response.ok) throw new Error(`Failed to fetch conversion source: ${response.status} ${response.statusText}`.trim());
      const blob = await waitForConversion(response.blob(), signal);
      throwIfAborted(signal);
      return blob.type ? blob : new Blob([blob], { type: inferredType });
    }
    return new Blob([source], {
      type: inferredType === 'application/octet-stream' ? 'text/plain' : inferredType
    });
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    if (bytes.buffer instanceof ArrayBuffer) return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: inferredType });
    // Blob rejects SharedArrayBuffer views; keep a snapshot for those callers.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer as ArrayBuffer], {
      type: inferredType
    });
  }
  return new Blob([source], {
    type: inferredType
  });
}

function jsonResponseToConversionResult(payload: unknown, request: ConversionRequest, response: Response): ConversionResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Conversion response must be a JSON object.');
  }

  const record = payload as Record<string, unknown>;
  if (record.ok === false || typeof record.errorCode === 'string' || typeof record.errorMessage === 'string') {
    throw new HttpConversionError(response.status, response.statusText, normalizeHttpErrorResult(record, request));
  }
  const source = decodeJsonSource(record);
  const format = String(record.format ?? record.targetFormat ?? request.targetFormat);
  return {
    source,
    format,
    contentType: typeof record.contentType === 'string' ? record.contentType : undefined,
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : undefined,
    cacheKey: typeof record.cacheKey === 'string' ? record.cacheKey : undefined
  };
}

async function blobResponseToConversionResult(response: Response, targetFormat: string): Promise<ConversionResult> {
  return {
    source: await response.blob(),
    format: readHeader(response.headers, 'x-preview-format') ?? targetFormat,
    contentType: response.headers.get('content-type') ?? undefined,
    warnings: parseWarningsHeader(response.headers),
    cacheKey: readHeader(response.headers, 'x-preview-cache-key')
  };
}

function decodeJsonSource(record: Record<string, unknown>): PreviewSource {
  if (typeof record.url === 'string') {
    return record.url;
  }
  if (typeof record.dataUrl === 'string') {
    return record.dataUrl;
  }
  if (typeof record.base64 === 'string') {
    return base64ToBytes(record.base64);
  }
  if (typeof record.text === 'string') {
    return new TextEncoder().encode(record.text);
  }
  throw new Error('Conversion JSON response must include url, dataUrl, base64, or text.');
}

function dataUrlToBlob(dataUrl: string, fallbackContentType = 'application/octet-stream'): Blob {
  const { bytes, contentType } = readDataUrl(dataUrl);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: contentType ?? fallbackContentType
  });
}

function parseWarningsHeader(headers: Headers): string[] | undefined {
  const raw = readHeader(headers, 'x-preview-warnings');
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return raw.split('|').map((item) => item.trim()).filter(Boolean);
  }
}

function readHeader(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
}

function inferUploadFileName(request: ConversionRequest): string {
  const sourceFormat = normalizeFormat(request.sourceFormat);
  const targetFormat = normalizeFormat(request.targetFormat);
  const fallbackExtension = sourceFormat || targetFormat || 'bin';
  const baseName = basenameForUpload(request.name) || `input.${fallbackExtension}`;
  const extension = inferExtensionFromName(baseName);
  if (extension) {
    return baseName;
  }
  return `${baseName}.${fallbackExtension}`;
}

function basenameForUpload(name: string | undefined): string {
  const trimmedName = String(name ?? '').split(/[?#]/, 1)[0]?.trim() ?? '';
  const lastSegment = trimmedName.split(/[\\/]/).pop()?.trim() ?? '';
  return sanitizeUploadFileName(lastSegment);
}

function sanitizeUploadFileName(name: string): string {
  const sanitized = name.replace(/[^\w.+-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return '';
  }
  return sanitized;
}

function inferContentType(name: string | undefined, fallbackFormat?: string): string {
  const extensionFromName = inferExtensionFromName(name);
  const extension = normalizeFormat(extensionFromName || fallbackFormat || '');
  switch (extension) {
    case 'dng':
    case 'cr2':
    case 'cr3':
    case 'nef':
    case 'nrw':
    case 'arw':
    case 'sr2':
    case 'srf':
    case 'orf':
    case 'rw2':
    case 'rwl':
    case 'raf':
    case 'kdc':
    case 'x3f':
    case 'pef':
    case 'srw':
    case 'erf':
    case 'mef':
    case 'mos':
    case 'mrw':
    case '3fr':
    case 'iiq':
      return 'application/octet-stream';
    case 'icns':
      return 'application/x-icns';
    case 'ppm':
      return 'image/x-portable-pixmap';
    case 'doc':
    case 'dot':
      return 'application/msword';
    case 'docm':
      return 'application/vnd.ms-word.document.macroenabled.12';
    case 'dotm':
      return 'application/vnd.ms-word.template.macroenabled.12';
    case 'dotx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.template';
    case 'odt':
      return 'application/vnd.oasis.opendocument.text';
    case 'ott':
      return 'application/vnd.oasis.opendocument.text-template';
    case 'fodt':
      return 'application/vnd.oasis.opendocument.text-flat-xml';
    case 'sxw':
      return 'application/vnd.sun.xml.writer';
    case 'stw':
      return 'application/vnd.sun.xml.writer.template';
    case 'rtf':
      return 'application/rtf';
    case 'wps':
      return 'application/vnd.ms-works';
    case 'wpt':
      return 'application/wps-office.wpt';
    case 'xls':
    case 'xlt':
    case 'et':
      return 'application/vnd.ms-excel';
    case 'xlsm':
      return 'application/vnd.ms-excel.sheet.macroenabled.12';
    case 'xltm':
      return 'application/vnd.ms-excel.template.macroenabled.12';
    case 'ett':
      return 'application/wps-office.ett';
    case 'xltx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.template';
    case 'ods':
      return 'application/vnd.oasis.opendocument.spreadsheet';
    case 'ots':
      return 'application/vnd.oasis.opendocument.spreadsheet-template';
    case 'fods':
      return 'application/vnd.oasis.opendocument.spreadsheet-flat-xml';
    case 'sxc':
      return 'application/vnd.sun.xml.calc';
    case 'stc':
      return 'application/vnd.sun.xml.calc.template';
    case 'dbf':
      return 'application/x-dbf';
    case 'slk':
      return 'text/spreadsheet';
    case 'dif':
      return 'application/x-dif';
    case 'txt':
    case 'text':
    case 'log':
      return 'text/plain';
    case 'md':
    case 'markdown':
    case 'mkd':
    case 'mkdn':
    case 'mdown':
      return 'text/markdown';
    case 'html':
    case 'htm':
    case 'shtml':
      return 'text/html';
    case 'xhtml':
    case 'xht':
    case 'xhtm':
      return 'application/xhtml+xml';
    case 'epub':
      return 'application/epub+zip';
    case 'fb2':
      return 'application/x-fictionbook+xml';
    case 'xml':
      return 'application/xml';
    case 'rss':
      return 'application/rss+xml';
    case 'atom':
      return 'application/atom+xml';
    case 'kml':
      return 'application/vnd.google-earth.kml+xml';
    case 'gpx':
      return 'application/gpx+xml';
    case 'ttml':
    case 'dfxp':
      return 'application/ttml+xml';
    case 'xsd':
      return 'application/xsd+xml';
    case 'xsl':
    case 'xslt':
      return 'application/xslt+xml';
    case 'wsdl':
      return 'application/wsdl+xml';
    case 'plist':
      return 'application/x-plist';
    case 'pom':
      return 'application/xml';
    case 'yaml':
    case 'yml':
      return 'application/yaml';
    case 'toml':
      return 'application/toml';
    case 'ini':
      return 'text/x-ini';
    case 'rst':
    case 'rest':
      return 'text/x-rst';
    case 'adoc':
    case 'asciidoc':
    case 'asc':
      return 'text/asciidoc';
    case 'tex':
    case 'latex':
    case 'ltx':
    case 'sty':
    case 'cls':
      return 'application/x-tex';
    case 'properties':
      return 'text/x-java-properties';
    case 'env':
      return 'application/x-env';
    case 'conf':
    case 'config':
    case 'cfg':
    case 'cnf':
      return 'text/x-config';
    case 'sql':
      return 'application/sql';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'text/javascript';
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'text/typescript';
    case 'vue':
      return 'text/x-vue';
    case 'css':
      return 'text/css';
    case 'scss':
    case 'sass':
      return 'text/x-scss';
    case 'less':
      return 'text/x-less';
    case 'c':
    case 'h':
      return 'text/x-csrc';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hh':
    case 'hxx':
      return 'text/x-c++src';
    case 'cs':
      return 'text/x-csharp';
    case 'go':
      return 'text/x-go';
    case 'java':
      return 'text/x-java-source';
    case 'kt':
    case 'kts':
      return 'text/x-kotlin';
    case 'lua':
      return 'text/x-lua';
    case 'php':
      return 'text/x-php';
    case 'py':
      return 'text/x-python';
    case 'rb':
      return 'text/x-ruby';
    case 'rs':
      return 'text/rust';
    case 'sh':
    case 'bash':
      return 'application/x-sh';
    case 'bat':
    case 'cmd':
      return 'application/x-msdos-program';
    case 'ps1':
      return 'text/x-powershell';
    case 'swift':
      return 'text/x-swift';
    case 'jsonc':
      return 'application/jsonc';
    case 'json5':
      return 'application/json5';
    case 'ipynb':
      return 'application/x-ipynb+json';
    case 'gql':
    case 'graphql':
      return 'application/graphql';
    case 'proto':
      return 'application/x-protobuf';
    case 'diff':
      return 'text/x-diff';
    case 'patch':
      return 'text/x-patch';
    case 'gitignore':
      return 'text/x-gitignore';
    case 'dockerignore':
      return 'text/x-dockerignore';
    case 'editorconfig':
      return 'text/x-editorconfig';
    case 'r':
      return 'text/x-r';
    case 'dart':
      return 'text/x-dart';
    case 'scala':
      return 'text/x-scala';
    case 'groovy':
    case 'gradle':
      return 'text/x-groovy';
    case 'pl':
      return 'text/x-perl';
    case 'ex':
      return 'text/x-elixir';
    case 'erl':
      return 'text/x-erlang';
    case 'fs':
    case 'fsi':
    case 'fsx':
      return 'text/x-fsharp';
    case 'vb':
      return 'text/x-vb';
    case 'clj':
      return 'text/x-clojure';
    case 'hs':
      return 'text/x-haskell';
    case 'jl':
      return 'text/x-julia';
    case 'zig':
      return 'text/x-zig';
    case 'm':
    case 'matlab':
      return 'text/x-matlab';
    case 'svelte':
      return 'text/x-svelte';
    case 'astro':
      return 'text/x-astro';
    case 'mdx':
      return 'text/mdx';
    case 'tf':
    case 'tfvars':
    case 'hcl':
      return 'text/x-hcl';
    case 'rego':
      return 'text/x-rego';
    case 'bicep':
      return 'text/x-bicep';
    case 'prisma':
      return 'text/x-prisma';
    case 'dockerfile':
      return 'text/x-dockerfile';
    case 'cmake':
      return 'text/x-cmake';
    case 'make':
    case 'mk':
      return 'text/x-makefile';
    case 'zsh':
    case 'fish':
      return 'text/x-shellscript';
    case 'csproj':
    case 'vbproj':
    case 'fsproj':
    case 'props':
    case 'targets':
      return 'application/x-msbuild';
    case 'sln':
      return 'text/x-ms-sln';
    case 'cshtml':
    case 'razor':
      return 'text/x-cshtml';
    case 'mustache':
    case 'hbs':
      return 'text/x-handlebars-template';
    case 'liquid':
      return 'text/x-liquid';
    case 'jinja':
      return 'text/x-jinja';
    case 'twig':
      return 'text/x-twig';
    case 'ejs':
      return 'text/x-ejs';
    case 'erb':
      return 'text/x-erb';
    case 'haml':
      return 'text/x-haml';
    case 'slim':
      return 'text/x-slim';
    case 'mermaid':
    case 'mmd':
      return 'text/vnd.mermaid';
    case 'puml':
      return 'text/x-plantuml';
    case 'avsc':
      return 'application/vnd.apache.avro+json';
    case 'sol':
      return 'text/x-solidity';
    case 'move':
      return 'text/x-move';
    case 'nim':
      return 'text/x-nim';
    case 'cr':
      return 'text/x-crystal';
    case 'ml':
    case 'mli':
      return 'text/x-ocaml';
    case 'elm':
      return 'text/x-elm';
    case 'rkt':
      return 'text/x-racket';
    case 'lisp':
      return 'text/x-lisp';
    case 'scm':
      return 'text/x-scheme';
    case 'asm':
    case 's':
      return 'text/x-asm';
    case 'cu':
    case 'cuh':
      return 'text/x-cuda';
    case 'd':
      return 'text/x-d';
    case 'pas':
      return 'text/x-pascal';
    case 'adb':
    case 'ads':
      return 'text/x-ada';
    case 'cob':
    case 'cbl':
      return 'text/x-cobol';
    case 'f90':
    case 'f95':
      return 'text/x-fortran';
    case 'vhd':
    case 'vhdl':
      return 'text/x-vhdl';
    case 'sv':
    case 'svh':
      return 'text/x-systemverilog';
    case 'ino':
      return 'text/x-arduino';
    case 'glsl':
    case 'vert':
    case 'frag':
      return 'text/x-glsl';
    case 'wgsl':
      return 'text/wgsl';
    case 'hlsl':
      return 'text/x-hlsl';
    case 'rmd':
      return 'text/x-r-markdown';
    case 'qmd':
      return 'text/x-quarto';
    case 'bib':
      return 'application/x-bibtex';
    case 'nix':
      return 'text/x-nix';
    case 'cue':
      return 'text/x-cue';
    case 'dhall':
      return 'text/x-dhall';
    case 'org':
      return 'text/org';
    case 'wiki':
    case 'mediawiki':
      return 'text/x-wiki';
    case 'textile':
      return 'text/x-textile';
    case 'pod':
      return 'text/x-pod';
    case 'man':
    case 'roff':
      return 'text/troff';
    case 'nfo':
      return 'text/x-nfo';
    case 'srt':
      return 'application/x-subrip';
    case 'vtt':
      return 'text/vtt';
    case 'sbv':
      return 'text/x-sbv';
    case 'ass':
      return 'text/x-ass';
    case 'ssa':
      return 'text/x-ssa';
    case 'ics':
      return 'text/calendar';
    case 'vcf':
      return 'text/vcard';
    case 'eml':
      return 'message/rfc822';
    case 'mbox':
      return 'application/mbox';
    case 'msg':
      return 'application/vnd.ms-outlook';
    case 'oft':
      return 'application/vnd.ms-outlook';
    case 'mht':
    case 'mhtml':
      return 'multipart/related';
    case 'npmrc':
      return 'text/x-npmrc';
    case 'yarnrc':
      return 'text/x-yarnrc';
    case 'gitattributes':
      return 'text/x-gitattributes';
    case 'gitmodules':
      return 'text/x-gitmodules';
    case 'csv':
      return 'text/csv';
    case 'tsv':
    case 'tab':
      return 'text/tab-separated-values';
    case 'psv':
      return 'text/x-pipe-separated-values';
    case 'json':
      return 'application/json';
    case 'jsonl':
    case 'ndjson':
    case 'jsonlines':
    case 'ldjson':
      return 'application/x-ndjson';
    case 'ppt':
    case 'pps':
    case 'pot':
    case 'dps':
      return 'application/vnd.ms-powerpoint';
    case 'dpt':
      return 'application/wps-office.dpt';
    case 'ppsx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.slideshow';
    case 'pptm':
      return 'application/vnd.ms-powerpoint.presentation.macroenabled.12';
    case 'ppsm':
      return 'application/vnd.ms-powerpoint.slideshow.macroenabled.12';
    case 'potx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.template';
    case 'potm':
      return 'application/vnd.ms-powerpoint.template.macroenabled.12';
    case 'odp':
      return 'application/vnd.oasis.opendocument.presentation';
    case 'otp':
      return 'application/vnd.oasis.opendocument.presentation-template';
    case 'fodp':
      return 'application/vnd.oasis.opendocument.presentation-flat-xml';
    case 'sxi':
      return 'application/vnd.sun.xml.impress';
    case 'sti':
      return 'application/vnd.sun.xml.impress.template';
    case 'odg':
      return 'application/vnd.oasis.opendocument.graphics';
    case 'otg':
      return 'application/vnd.oasis.opendocument.graphics-template';
    case 'fodg':
      return 'application/vnd.oasis.opendocument.graphics-flat-xml';
    case 'sxd':
      return 'application/vnd.sun.xml.draw';
    case 'std':
      return 'application/vnd.sun.xml.draw.template';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

function inferExtensionFromName(name: string | undefined): string {
  const trimmedName = String(name ?? '').split(/[?#]/, 1)[0]?.trim() ?? '';
  const lastSegment = trimmedName.split(/[\\/]/).pop() ?? '';
  const specialFormat = inferSpecialFileFormat(lastSegment);
  if (specialFormat) {
    return specialFormat;
  }
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) {
    return '';
  }
  if (dotIndex === 0 && lastSegment.indexOf('.', 1) < 0) {
    return normalizeFormat(lastSegment.slice(1));
  }
  return normalizeFormat(lastSegment.slice(dotIndex + 1));
}

function inferSpecialFileFormat(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'dockerfile' || normalized.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  if (normalized === 'makefile' || normalized === 'gnumakefile' || normalized === 'bsdmakefile') {
    return 'make';
  }
  if (normalized === 'cmakelists.txt') {
    return 'cmake';
  }
  return '';
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
}
