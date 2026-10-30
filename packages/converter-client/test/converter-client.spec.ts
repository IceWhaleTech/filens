import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  createHttpConverterClient,
  createMockConverterClient,
  createWasmConverterClient,
  HttpConversionError,
  WasmConversionError
} from '../src';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function inferTestSourceFormat(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'dockerfile' || normalized.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  if (normalized === 'makefile' || normalized === 'gnumakefile' || normalized === 'bsdmakefile') {
    return 'make';
  }
  if (normalized === 'cmakelists.txt') {
    return 'cmake';
  }
  const lastSegment = normalized.split(/[\\/]/).pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex === 0 && lastSegment.indexOf('.', 1) < 0) {
    return lastSegment.slice(1);
  }
  return dotIndex >= 0 ? lastSegment.slice(dotIndex + 1) : lastSegment;
}

describe('converter client adapters', () => {
  it('converts through a JSON HTTP endpoint', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('sourceFormat')).toBe('doc');
      expect(form.get('targetFormat')).toBe('docx');
      expect(form.get('name')).toBe('legacy.doc');
      expect(form.get('file')).toBeInstanceOf(Blob);
      return new Response(
        JSON.stringify({
          base64: btoa('converted'),
          format: 'docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          warnings: ['Converted by mock endpoint.'],
          cacheKey: 'cache:1'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });
    const client = createHttpConverterClient({
      endpoint: '/convert',
      fetch: fetchMock
    });

    const result = await client.convert(
      {
        source: new Uint8Array([1, 2, 3]),
        sourceFormat: 'doc',
        targetFormat: 'docx',
        name: 'legacy.doc'
      },
      {
        descriptor: {
          source: new Uint8Array([1, 2, 3]),
          name: 'legacy.doc',
          extension: 'doc'
        }
      }
    );

    expect(result).toMatchObject({
      format: 'docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      warnings: ['Converted by mock endpoint.'],
      cacheKey: 'cache:1'
    });
    expect(new TextDecoder().decode(result.source as Uint8Array)).toBe('converted');
    expect(fetchMock).toHaveBeenCalledWith('/convert', expect.objectContaining({ method: 'POST' }));
  });

  it('converts through a blob HTTP endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Blob([new Uint8Array([80, 75, 3, 4])], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), {
        status: 200,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'x-preview-format': 'pptx',
          'x-preview-warnings': 'Converted to PPTX|Fonts substituted',
          'x-preview-cache-key': 'cache:pptx'
        }
      })
    );
    const client = createHttpConverterClient({
      endpoint: '/convert',
      fetch: fetchMock,
      responseType: 'blob'
    });

    const result = await client.convert(
      {
        source: 'data:text/plain,hello',
        sourceFormat: 'ppt',
        targetFormat: 'pptx',
        name: 'legacy.ppt'
      },
      {
        descriptor: {
          source: 'data:text/plain,hello',
          name: 'legacy.ppt',
          extension: 'ppt'
        }
      }
    );

    expect(result.format).toBe('pptx');
    expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(result.warnings).toEqual(['Converted to PPTX', 'Fonts substituted']);
    expect(result.cacheKey).toBe('cache:pptx');
    expect(result.source).toMatchObject({
      size: 13,
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });
  });

  it('labels manifest-listed legacy and compatible documents for HTTP converters', async () => {
    const seenTypes: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get('file') as Blob;
      seenTypes.push(file.type);
      return new Response(
        JSON.stringify({
          base64: btoa('converted'),
          format: form.get('targetFormat'),
          contentType: 'application/octet-stream'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });
    const client = createHttpConverterClient({
      endpoint: '/convert',
      fetch: fetchMock
    });

    const cases = [
      ['legacy.ppt', 'pptx'],
      ['show.pps', 'pptx'],
      ['template.pot', 'pptx'],
      ['macro.pptm', 'pptx'],
      ['show.ppsx', 'pptx'],
      ['macro.ppsm', 'pptx'],
      ['template.potx', 'pptx'],
      ['macro.potm', 'pptx'],
      ['slides.dps', 'pptx'],
      ['template.dpt', 'pptx'],
      ['slides.odp', 'pptx'],
      ['template.otp', 'pptx'],
      ['flat.fodp', 'pptx'],
      ['legacy.sxi', 'pptx'],
      ['template.sti', 'pptx'],
      ['drawing.odg', 'pptx'],
      ['template.otg', 'pptx'],
      ['drawing.fodg', 'pptx'],
      ['legacy.sxd', 'pptx'],
      ['template.std', 'pptx'],
      ['draft.doc', 'docx'],
      ['macro.docm', 'docx'],
      ['template.dot', 'docx'],
      ['template.dotx', 'docx'],
      ['template.dotm', 'docx'],
      ['writer.wps', 'docx'],
      ['template.wpt', 'docx'],
      ['notes.rtf', 'docx'],
      ['text.odt', 'docx'],
      ['template.ott', 'docx'],
      ['flat.fodt', 'docx'],
      ['legacy.sxw', 'docx'],
      ['template.stw', 'docx'],
      ['plain.txt', 'docx'],
      ['notes.md', 'docx'],
      ['notes.markdown', 'docx'],
      ['notes.mkd', 'docx'],
      ['notes.mkdn', 'docx'],
      ['notes.mdown', 'docx'],
      ['page.html', 'docx'],
      ['page.xhtml', 'docx'],
      ['page.xht', 'docx'],
      ['page.xhtm', 'docx'],
      ['book.epub', 'docx'],
      ['book.fb2', 'docx'],
      ['data.xml', 'docx'],
      ['feed.rss', 'docx'],
      ['feed.atom', 'docx'],
      ['place.kml', 'docx'],
      ['track.gpx', 'docx'],
      ['captions.ttml', 'docx'],
      ['captions.dfxp', 'docx'],
      ['schema.xsd', 'docx'],
      ['style.xsl', 'docx'],
      ['style.xslt', 'docx'],
      ['service.wsdl', 'docx'],
      ['prefs.plist', 'docx'],
      ['pom.pom', 'docx'],
      ['config.yaml', 'docx'],
      ['config.cfg', 'docx'],
      ['notes.rest', 'docx'],
      ['doc.asc', 'docx'],
      ['paper.ltx', 'docx'],
      ['script.ts', 'docx'],
      ['code.cxx', 'docx'],
      ['script.fsx', 'docx'],
      ['matrix.m', 'docx'],
      ['app.csproj', 'docx'],
      ['solution.sln', 'docx'],
      ['page.cshtml', 'docx'],
      ['template.haml', 'docx'],
      ['template.slim', 'docx'],
      ['analysis.r', 'docx'],
      ['Dockerfile', 'docx'],
      ['Makefile', 'docx'],
      ['component.svelte', 'docx'],
      ['diagram.mermaid', 'docx'],
      ['shader.wgsl', 'docx'],
      ['shell.bash', 'docx'],
      ['captions.sbv', 'docx'],
      ['captions.ass', 'docx'],
      ['captions.ssa', 'docx'],
      ['message.eml', 'docx'],
      ['mailbox.mbox', 'docx'],
      ['message.msg', 'docx'],
      ['template.oft', 'docx'],
      ['modules.gitmodules', 'docx'],
      ['sheet.xls', 'xlsx'],
      ['macro.xlsm', 'xlsx'],
      ['template.xlt', 'xlsx'],
      ['template.xltx', 'xlsx'],
      ['template.xltm', 'xlsx'],
      ['sheet.et', 'xlsx'],
      ['template.ett', 'xlsx'],
      ['sheet.ods', 'xlsx'],
      ['template.ots', 'xlsx'],
      ['flat.fods', 'xlsx'],
      ['legacy.sxc', 'xlsx'],
      ['template.stc', 'xlsx'],
      ['table.dbf', 'xlsx'],
      ['table.slk', 'xlsx'],
      ['table.dif', 'xlsx'],
      ['table.csv', 'xlsx'],
      ['table.tsv', 'xlsx'],
      ['table.tab', 'xlsx'],
      ['table.psv', 'xlsx'],
      ['data.json', 'xlsx'],
      ['data.jsonl', 'xlsx'],
      ['data.ndjson', 'xlsx'],
      ['data.jsonlines', 'xlsx'],
      ['data.ldjson', 'xlsx']
    ] as const;

    for (const [name, targetFormat] of cases) {
      await client.convert(
        {
          source: new Uint8Array([1]),
          sourceFormat: inferTestSourceFormat(name),
          targetFormat,
          name
        },
        {
          descriptor: {
            source: new Uint8Array([1]),
            name
          }
        }
      );
    }

    expect(seenTypes).toEqual([
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-powerpoint.presentation.macroenabled.12',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
      'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
      'application/vnd.openxmlformats-officedocument.presentationml.template',
      'application/vnd.ms-powerpoint.template.macroenabled.12',
      'application/vnd.ms-powerpoint',
      'application/wps-office.dpt',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.oasis.opendocument.presentation-template',
      'application/vnd.oasis.opendocument.presentation-flat-xml',
      'application/vnd.sun.xml.impress',
      'application/vnd.sun.xml.impress.template',
      'application/vnd.oasis.opendocument.graphics',
      'application/vnd.oasis.opendocument.graphics-template',
      'application/vnd.oasis.opendocument.graphics-flat-xml',
      'application/vnd.sun.xml.draw',
      'application/vnd.sun.xml.draw.template',
      'application/msword',
      'application/vnd.ms-word.document.macroenabled.12',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
      'application/vnd.ms-word.template.macroenabled.12',
      'application/vnd.ms-works',
      'application/wps-office.wpt',
      'application/rtf',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.text-template',
      'application/vnd.oasis.opendocument.text-flat-xml',
      'application/vnd.sun.xml.writer',
      'application/vnd.sun.xml.writer.template',
      'text/plain',
      'text/markdown',
      'text/markdown',
      'text/markdown',
      'text/markdown',
      'text/markdown',
      'text/html',
      'application/xhtml+xml',
      'application/xhtml+xml',
      'application/xhtml+xml',
      'application/epub+zip',
      'application/x-fictionbook+xml',
      'application/xml',
      'application/rss+xml',
      'application/atom+xml',
      'application/vnd.google-earth.kml+xml',
      'application/gpx+xml',
      'application/ttml+xml',
      'application/ttml+xml',
      'application/xsd+xml',
      'application/xslt+xml',
      'application/xslt+xml',
      'application/wsdl+xml',
      'application/x-plist',
      'application/xml',
      'application/yaml',
      'text/x-config',
      'text/x-rst',
      'text/asciidoc',
      'application/x-tex',
      'text/typescript',
      'text/x-c++src',
      'text/x-fsharp',
      'text/x-matlab',
      'application/x-msbuild',
      'text/x-ms-sln',
      'text/x-cshtml',
      'text/x-haml',
      'text/x-slim',
      'text/x-r',
      'text/x-dockerfile',
      'text/x-makefile',
      'text/x-svelte',
      'text/vnd.mermaid',
      'text/wgsl',
      'application/x-sh',
      'text/x-sbv',
      'text/x-ass',
      'text/x-ssa',
      'message/rfc822',
      'application/mbox',
      'application/vnd.ms-outlook',
      'application/vnd.ms-outlook',
      'text/x-gitmodules',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroenabled.12',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
      'application/vnd.ms-excel.template.macroenabled.12',
      'application/vnd.ms-excel',
      'application/wps-office.ett',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.spreadsheet-template',
      'application/vnd.oasis.opendocument.spreadsheet-flat-xml',
      'application/vnd.sun.xml.calc',
      'application/vnd.sun.xml.calc.template',
      'application/x-dbf',
      'text/spreadsheet',
      'application/x-dif',
      'text/csv',
      'text/tab-separated-values',
      'text/tab-separated-values',
      'text/x-pipe-separated-values',
      'application/json',
      'application/x-ndjson',
      'application/x-ndjson',
      'application/x-ndjson',
      'application/x-ndjson'
    ]);
  });

  it('falls back to sourceFormat when naming HTTP converter uploads', async () => {
    const seenFiles: Array<{ name: string; type: string }> = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get('file') as File;
      seenFiles.push({ name: file.name, type: file.type });
      return new Response(
        JSON.stringify({
          base64: btoa('converted'),
          format: form.get('targetFormat'),
          contentType: 'application/octet-stream'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    });
    const client = createHttpConverterClient({
      endpoint: '/convert',
      fetch: fetchMock
    });

    await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'dps',
        targetFormat: 'pptx'
      },
      {
        descriptor: {
          source: new Uint8Array([1])
        }
      }
    );
    await client.convert(
      {
        source: new Blob([new Uint8Array([1])]),
        sourceFormat: 'wps',
        targetFormat: 'docx'
      },
      {
        descriptor: {
          source: new Uint8Array([1])
        }
      }
    );
    await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'ods',
        targetFormat: 'xlsx'
      },
      {
        descriptor: {
          source: new Uint8Array([1])
        }
      }
    );
    await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'txt',
        targetFormat: 'docx'
      },
      {
        descriptor: {
          source: new Uint8Array([1])
        }
      }
    );
    await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'jsonl',
        targetFormat: 'xlsx'
      },
      {
        descriptor: {
          source: new Uint8Array([1])
        }
      }
    );
    await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'dbf',
        targetFormat: 'xlsx'
      },
      {
        descriptor: {
          source: new Uint8Array([1])
        }
      }
    );
    await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'rtf',
        targetFormat: 'docx',
        name: 'untitled'
      },
      {
        descriptor: {
          source: new Uint8Array([1]),
          name: 'untitled'
        }
      }
    );
    await client.convert(
      {
        source: 'data:;base64,YQ==',
        sourceFormat: 'doc',
        targetFormat: 'docx',
        name: '../unsafe draft'
      },
      {
        descriptor: {
          source: new Uint8Array([1]),
          name: '../unsafe draft'
        }
      }
    );

    expect(seenFiles).toEqual([
      { name: 'input.dps', type: 'application/vnd.ms-powerpoint' },
      { name: 'input.wps', type: 'application/vnd.ms-works' },
      { name: 'input.ods', type: 'application/vnd.oasis.opendocument.spreadsheet' },
      { name: 'input.txt', type: 'text/plain' },
      { name: 'input.jsonl', type: 'application/x-ndjson' },
      { name: 'input.dbf', type: 'application/x-dbf' },
      { name: 'untitled.rtf', type: 'application/rtf' },
      { name: 'unsafe_draft.doc', type: 'application/msword' }
    ]);
  });

  it('uses registered mock conversions', async () => {
    const client = createMockConverterClient([
      {
        sourceFormat: 'ppt',
        targetFormat: 'pptx',
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        warnings: ['Mock converted presentation.'],
        source: (request) => new Uint8Array([request.sourceFormat.length, request.targetFormat.length])
      }
    ]);

    const result = await client.convert(
      {
        source: new Uint8Array([1]),
        sourceFormat: 'ppt',
        targetFormat: 'pptx'
      },
      {
        descriptor: {
          source: new Uint8Array([1]),
          extension: 'ppt'
        }
      }
    );

    expect(result).toMatchObject({
      format: 'pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      warnings: ['Mock converted presentation.']
    });
    expect(Array.from(result.source as Uint8Array)).toEqual([3, 4]);
  });

  it('throws clear errors for missing mock conversions and bad HTTP responses', async () => {
    const mockClient = createMockConverterClient([]);
    await expect(
      mockClient.convert(
        {
          source: new Uint8Array([1]),
          sourceFormat: 'doc',
          targetFormat: 'docx'
        },
        {
          descriptor: {
            source: new Uint8Array([1])
          }
        }
      )
    ).rejects.toThrow('No mock conversion registered');

    const httpClient = createHttpConverterClient({
      endpoint: '/convert',
      fetch: vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' }))
    });
    await expect(
      httpClient.convert(
        {
          source: new Uint8Array([1]),
          sourceFormat: 'doc',
          targetFormat: 'docx'
        },
        {
          descriptor: {
            source: new Uint8Array([1])
          }
        }
      )
    ).rejects.toThrow('Conversion failed: 500 Server Error');
  });

  it('throws structured HTTP conversion errors when the endpoint returns stable error JSON', async () => {
    const httpClient = createHttpConverterClient({
      endpoint: '/convert',
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            sourceFormat: 'webp',
            targetFormat: 'png',
            backend: 'wasi',
            fidelity: 'wasi',
            warnings: ['Standalone image conversion only supports PNG routes.'],
            errorCode: 'unsupported_format',
            errorMessage: 'unsupported conversion pair: webp -> png',
            metrics: { elapsedMs: 1 }
          }),
          {
            status: 415,
            statusText: 'Unsupported Media Type',
            headers: {
              'content-type': 'application/problem+json'
            }
          }
        )
      )
    });

    await expect(
      httpClient.convert(
        {
          source: new Uint8Array([1]),
          sourceFormat: 'webp',
          targetFormat: 'png',
          name: 'image.webp'
        },
        {
          descriptor: {
            source: new Uint8Array([1]),
            name: 'image.webp'
          }
        }
      )
    ).rejects.toMatchObject({
      status: 415,
      statusText: 'Unsupported Media Type',
      result: {
        ok: false,
        sourceFormat: 'webp',
        targetFormat: 'png',
        backend: 'wasi',
        fidelity: 'wasi',
        warnings: ['Standalone image conversion only supports PNG routes.'],
        errorCode: 'unsupported_format',
        errorMessage: 'unsupported conversion pair: webp -> png',
        metrics: { elapsedMs: 1 }
      }
    } satisfies Partial<HttpConversionError>);
  });

  it('treats ok:false JSON responses as structured HTTP conversion errors even with 2xx status', async () => {
    const httpClient = createHttpConverterClient({
      endpoint: '/convert',
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            sourceFormat: 'doc',
            targetFormat: 'docx',
            backend: 'wasi',
            fidelity: 'wasi',
            warnings: ['WASM engine is disabled.'],
            errorCode: 'engine_unavailable',
            errorMessage: 'wasm path is not configured',
            metrics: { elapsedMs: 0 }
          }),
          {
            status: 200,
            statusText: 'OK',
            headers: {
              'content-type': 'application/json'
            }
          }
        )
      )
    });

    await expect(
      httpClient.convert(
        {
          source: new Uint8Array([1]),
          sourceFormat: 'doc',
          targetFormat: 'docx',
          name: 'draft.doc'
        },
        {
          descriptor: {
            source: new Uint8Array([1]),
            name: 'draft.doc'
          }
        }
      )
    ).rejects.toMatchObject({
      status: 200,
      result: {
        ok: false,
        sourceFormat: 'doc',
        targetFormat: 'docx',
        backend: 'wasi',
        fidelity: 'wasi',
        warnings: ['WASM engine is disabled.'],
        errorCode: 'engine_unavailable',
        errorMessage: 'wasm path is not configured',
        metrics: { elapsedMs: 0 }
      }
    } satisfies Partial<HttpConversionError>);
  });

  it('uses preview error headers when an HTTP endpoint returns a non-JSON error body', async () => {
    const httpClient = createHttpConverterClient({
      endpoint: '/convert',
      fetch: vi.fn(async () =>
        new Response('service unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: {
            'x-preview-ok': 'false',
            'x-preview-source-format': 'doc',
            'x-preview-target-format': 'docx',
            'x-preview-backend': 'wasi',
            'x-preview-fidelity': 'wasi',
            'x-preview-error-code': 'engine_unavailable',
            'x-preview-error-message': 'wasm path is not configured'
          }
        })
      )
    });

    await expect(
      httpClient.convert(
        {
          source: new Uint8Array([1]),
          sourceFormat: 'doc',
          targetFormat: 'docx',
          name: 'draft.doc'
        },
        {
          descriptor: {
            source: new Uint8Array([1]),
            name: 'draft.doc'
          }
        }
      )
    ).rejects.toMatchObject({
      status: 503,
      result: {
        ok: false,
        sourceFormat: 'doc',
        targetFormat: 'docx',
        backend: 'wasi',
        fidelity: 'wasi',
        errorCode: 'engine_unavailable',
        errorMessage: 'wasm path is not configured'
      }
    } satisfies Partial<HttpConversionError>);
  });

  it(
    'converts through converter-core.wasm without an HTTP backend',
    async () => {
      const [wasm, input] = await Promise.all([
        readFile(path.join(repoRoot, 'wasm/converter-core/dist/converter-core.wasm')),
        readFile(path.join(repoRoot, 'examples/go-wazero-converter/fixtures/doc/sample.rtf'))
      ]);
      const wasmUrl = '/assets/converter-core.wasm';
      const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
        expect(String(url)).toBe(wasmUrl);
        return new Response(new Uint8Array(wasm), {
          headers: {
            'content-type': 'application/wasm'
          }
        });
      });
      const client = createWasmConverterClient({
        wasm: wasmUrl,
        fetch: fetchMock
      });

      const result = await client.convert(
        {
          source: new Uint8Array(input),
          sourceFormat: 'rtf',
          targetFormat: 'docx',
          name: 'sample.rtf',
          locale: 'zh-CN'
        },
        {
          descriptor: {
            source: new Uint8Array(input),
            name: 'sample.rtf',
            extension: 'rtf'
          }
        }
      );

      expect(result).toMatchObject({
        format: 'docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      expect(Array.from((result.source as Uint8Array).subarray(0, 4))).toEqual([80, 75, 3, 4]);
      expect(result.warnings?.join('\n')).toContain('RTF backend performed lightweight text extraction');
      expect(fetchMock).toHaveBeenCalledWith(wasmUrl);
    },
    20000
  );

  it(
    'converts legacy Office and tabular content through the front-end WASM client',
    async () => {
      const wasm = await readFile(path.join(repoRoot, 'wasm/converter-core/dist/converter-core.wasm'));
      const client = createWasmConverterClient({
        wasm: new Uint8Array(wasm)
      });

      const cases = [
        {
          name: 'sample.doc',
          source: buildWordBinaryCompoundFile('Alpha\rBeta'),
          sourceFormat: 'doc',
          targetFormat: 'docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          requiredEntries: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
          contentEntry: 'word/document.xml',
          expectedText: ['Alpha', 'Beta']
        },
        {
          name: 'sample.xls',
          source: buildBIFFCompoundFile(),
          sourceFormat: 'xls',
          targetFormat: 'xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          requiredEntries: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
          contentEntry: 'xl/worksheets/sheet1.xml',
          expectedText: ['Front-end WASM spreadsheet', '42.5']
        },
        {
          name: 'sample.dbf',
          source: buildDBFFile(),
          sourceFormat: 'dbf',
          targetFormat: 'xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          requiredEntries: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
          contentEntry: 'xl/worksheets/sheet1.xml',
          expectedText: ['Front-end WASM DBF', '55.5', '2026-06-06']
        },
        {
          name: 'sample.md',
          source: new TextEncoder().encode('# Front-end WASM Markdown\n\n- text route item\n'),
          sourceFormat: 'md',
          targetFormat: 'docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          requiredEntries: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
          contentEntry: 'word/document.xml',
          expectedText: ['Front-end WASM Markdown', 'text route item']
        },
        {
          name: 'sample.jsonl',
          source: new TextEncoder().encode('{"name":"Front-end WASM JSONL","value":77.5}\n'),
          sourceFormat: 'jsonl',
          targetFormat: 'xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          requiredEntries: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
          contentEntry: 'xl/worksheets/sheet1.xml',
          expectedText: ['Front-end WASM JSONL', '77.5']
        },
        {
          name: 'sample.ppt',
          source: buildPPTBinaryCompoundFile(),
          sourceFormat: 'ppt',
          targetFormat: 'pptx',
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          requiredEntries: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml'],
          contentEntry: 'ppt/slides/slide1.xml',
          expectedText: ['Deck Title', 'Bullet one']
        }
      ] as const;

      for (const testCase of cases) {
        const result = await client.convert(
          {
            source: testCase.source,
            sourceFormat: testCase.sourceFormat,
            targetFormat: testCase.targetFormat,
            name: testCase.name,
            locale: 'zh-CN'
          },
          {
            descriptor: {
              source: testCase.source,
              name: testCase.name,
              extension: testCase.sourceFormat
            }
          }
        );

        expect(result).toMatchObject({
          format: testCase.targetFormat,
          contentType: testCase.contentType
        });
        expect(Array.from((result.source as Uint8Array).subarray(0, 4))).toEqual([80, 75, 3, 4]);
        expectZipEntries(result.source as Uint8Array, testCase.requiredEntries);
        const content = readZipTextEntry(result.source as Uint8Array, testCase.contentEntry);
        for (const expected of testCase.expectedText) {
          expect(content).toContain(expected);
        }
        expect(content).not.toContain('No ');
        expect(content).not.toContain('content found');
        expect(content).not.toContain('cells found');
        expect(result.warnings?.join('\n')).toMatch(/not preserved|simplified or omitted/);
      }
    },
    30000
  );

  it('converts P3, P6 and 16-bit PPM to PNG through the shared WASM core', async () => {
    const wasm = new Uint8Array(await readFile(path.join(repoRoot, 'wasm/converter-core/dist/converter-core.wasm')));
    const client = createWasmConverterClient({ wasm });
    const inputs = [
      new TextEncoder().encode('P3\n# RGB\n2 1\n255\n255 0 0 0 255 0\n'),
      new Uint8Array([...new TextEncoder().encode('P6\n2 1\n255\n'), 255, 0, 0, 0, 255, 0]),
      new Uint8Array([...new TextEncoder().encode('P6\n2 1\n65535\n'), 255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0])
    ];
    for (const [index, source] of inputs.entries()) {
      const result = await client.convert(
        { source, name: 'image.ppm', sourceFormat: 'ppm', targetFormat: 'png' },
        { descriptor: { source, name: 'image.ppm', extension: 'ppm' } }
      );
      expect(result).toMatchObject({ format: 'png', contentType: 'image/png', warnings: [] });
      const output = result.source as Uint8Array;
      expect(Array.from(output.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
      expect([view.getUint32(16), view.getUint32(20), output[24], output[25]]).toEqual([2, 1, index === 2 ? 16 : 8, 2]);
    }
    const source = new TextEncoder().encode('P6\n2 1\n255\n');
    await expect(client.convert(
      { source, name: 'broken.ppm', sourceFormat: 'ppm', targetFormat: 'png' },
      { descriptor: { source, name: 'broken.ppm', extension: 'ppm' } }
    )).rejects.toMatchObject({ result: { errorCode: 'conversion_failed' } });
  });

  it(
    'loads converter-image.wasm only for image conversion routes',
    async () => {
      const imageWasm = await readFile(path.join(repoRoot, 'wasm/converter-image/dist/converter-image.wasm'));
      const imageWasmUrl = '/assets/converter-image.wasm';
      let coreLoadCount = 0;
      const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
        expect(String(url)).toBe(imageWasmUrl);
        return new Response(new Uint8Array(imageWasm), {
          headers: {
            'content-type': 'application/wasm'
          }
        });
      });
      const client = createWasmConverterClient({
        wasm: () => {
          coreLoadCount += 1;
          throw new Error('converter-core.wasm should not load for ICNS conversion.');
        },
        imageWasm: imageWasmUrl,
        fetch: fetchMock
      });

      const result = await client.convert(
        {
          source: buildIcnsFixture(),
          sourceFormat: 'icns',
          targetFormat: 'png',
          name: 'sample.icns'
        },
        {
          descriptor: {
            source: buildIcnsFixture(),
            name: 'sample.icns',
            extension: 'icns'
          }
        }
      );

      expect(result).toMatchObject({
        format: 'png',
        contentType: 'image/png'
      });
      expect(Array.from((result.source as Uint8Array).subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(coreLoadCount).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
    20000
  );

  it(
    'rejects unsupported WASM pairs before loading the module',
    async () => {
      let loadCount = 0;
      const client = createWasmConverterClient({
        wasm: () => {
          loadCount += 1;
          throw new Error('WASM loader should not run for unsupported pairs.');
        }
      });

      await expect(
        client.convert(
          {
            source: new Uint8Array([1, 2, 3]),
            sourceFormat: 'webp',
            targetFormat: 'png',
            name: 'image.webp'
          },
          {
            descriptor: {
              source: new Uint8Array([1, 2, 3]),
              name: 'image.webp',
              extension: 'webp'
            }
          }
        )
      ).rejects.toMatchObject({
        result: {
          ok: false,
          sourceFormat: 'webp',
          targetFormat: 'png',
          errorCode: 'unsupported_format'
        }
      } satisfies Partial<WasmConversionError>);

      expect(loadCount).toBe(0);
    },
    20000
  );

  it(
    'returns structured WASM conversion failures',
    async () => {
      const wasm = await readFile(path.join(repoRoot, 'wasm/converter-core/dist/converter-core.wasm'));
      const client = createWasmConverterClient({
        wasm: new Uint8Array(wasm)
      });

      const cases = [
        { name: 'image.webp', sourceFormat: 'webp', targetFormat: 'png' },
        { name: 'sheet.numbers', sourceFormat: 'numbers', targetFormat: 'xlsx' },
        { name: 'binary.xlsb', sourceFormat: 'xlsb', targetFormat: 'xlsx' }
      ];

      for (const testCase of cases) {
        await expect(
          client.convert(
            {
              source: new Uint8Array([1, 2, 3]),
              sourceFormat: testCase.sourceFormat,
              targetFormat: testCase.targetFormat,
              name: testCase.name
            },
            {
              descriptor: {
                source: new Uint8Array([1, 2, 3]),
                name: testCase.name,
                extension: testCase.sourceFormat
              }
            }
          )
        ).rejects.toMatchObject({
          result: {
            ok: false,
            errorCode: 'unsupported_format'
          }
        } satisfies Partial<WasmConversionError>);
      }
    },
    20000
  );

  it(
    'surfaces password errors from converter-core.wasm',
    async () => {
      const wasm = await readFile(path.join(repoRoot, 'wasm/converter-core/dist/converter-core.wasm'));
      const client = createWasmConverterClient({
        wasm: new Uint8Array(wasm)
      });
      const encryptedDoc = buildEncryptedCompoundFile();

      for (const testCase of [
        { password: undefined, errorCode: 'password_required' },
        { password: 'secret', errorCode: 'parse_error' }
      ]) {
        await expect(
          client.convert(
            {
              source: encryptedDoc,
              sourceFormat: 'doc',
              targetFormat: 'docx',
              name: 'encrypted.doc',
              password: testCase.password
            },
            {
              descriptor: {
                source: encryptedDoc,
                name: 'encrypted.doc',
                extension: 'doc'
              }
            }
          )
        ).rejects.toMatchObject({
          result: {
            ok: false,
            errorCode: testCase.errorCode,
            backend: 'office-encryption'
          }
        } satisfies Partial<WasmConversionError>);
      }
    },
    20000
  );

  it(
    'surfaces parse errors from converter-core.wasm',
    async () => {
      const wasm = await readFile(path.join(repoRoot, 'wasm/converter-core/dist/converter-core.wasm'));
      const client = createWasmConverterClient({
        wasm: new Uint8Array(wasm)
      });
      const corruptDoc = new TextEncoder().encode('not a compound Word binary document');

      await expect(
        client.convert(
          {
            source: corruptDoc,
            sourceFormat: 'doc',
            targetFormat: 'docx',
            name: 'corrupt.doc'
          },
          {
            descriptor: {
              source: corruptDoc,
              name: 'corrupt.doc',
              extension: 'doc'
            }
          }
        )
      ).rejects.toMatchObject({
        result: {
          ok: false,
          errorCode: 'parse_error',
          backend: 'word-binary'
        }
      } satisfies Partial<WasmConversionError>);
    },
    20000
  );
});

function buildEncryptedCompoundFile(): Uint8Array {
  return buildMinimalCompoundFile(['EncryptionInfo', 'EncryptedPackage']);
}

function buildIcnsFixture(): Uint8Array {
  const png = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 64, 0, 0, 0, 64,
    8, 6, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 73, 69, 78, 68,
    0, 0, 0, 0
  ]);
  const output = new Uint8Array(16 + png.length);
  output.set([105, 99, 110, 115], 0);
  new DataView(output.buffer).setUint32(4, output.length);
  output.set([105, 99, 48, 55], 8);
  new DataView(output.buffer).setUint32(12, 8 + png.length);
  output.set(png, 16);
  return output;
}

function buildWordBinaryCompoundFile(text: string): Uint8Array {
  const textOffset = 0x01c0;
  const encoded = utf16LEBytes(text);
  const wordDocumentSize = Math.max(512, textOffset + encoded.length + 16);
  const wordDocument = new Uint8Array(wordDocumentSize);
  const wordView = new DataView(wordDocument.buffer);

  wordView.setUint16(0, 0xa5ec, true);
  wordView.setUint16(0x0a, 0x0200, true);
  wordDocument.set(encoded, textOffset);

  const tableStream = new Uint8Array(128);
  const tableView = new DataView(tableStream.buffer);
  const plc = new Uint8Array(16);
  const plcView = new DataView(plc.buffer);
  plcView.setUint32(0, 0, true);
  plcView.setUint32(4, text.length, true);
  plcView.setUint32(10, textOffset, true);
  tableStream[0] = 0x02;
  tableView.setUint32(1, plc.length, true);
  tableStream.set(plc, 5);
  wordView.setUint32(0x01a2, 0, true);
  wordView.setUint32(0x01a6, 5 + plc.length, true);

  return buildCompoundFileWithStreams({
    WordDocument: wordDocument,
    '1Table': tableStream
  });
}

function buildBIFFCompoundFile(): Uint8Array {
  const workbook = concatBytes([
    buildBIFFRecord(0x0809, new Uint8Array([0, 0, 0, 0])),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(0, 0, 'Front-end WASM spreadsheet')),
    buildBIFFRecord(0x0203, buildBIFFNumberRecord(1, 0, 42.5)),
    buildBIFFRecord(0x000a, new Uint8Array())
  ]);
  return buildCompoundFileWithStreams({ Workbook: workbook });
}

function buildDBFFile(): Uint8Array {
  const fields = [
    { name: 'NAME', type: 'C', length: 24, decimals: 0 },
    { name: 'AMOUNT', type: 'N', length: 8, decimals: 2 },
    { name: 'STARTED', type: 'D', length: 8, decimals: 0 }
  ];
  const rows = [['Front-end WASM DBF', '55.5', '20260606']];
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((total, field) => total + field.length, 0);
  const output = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(output.buffer);
  output[0] = 0x03;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    output.set(new TextEncoder().encode(field.name).subarray(0, 11), offset);
    output[offset + 11] = field.type.charCodeAt(0);
    output[offset + 16] = field.length;
    output[offset + 17] = field.decimals;
  });
  output[32 + fields.length * 32] = 0x0d;

  rows.forEach((row, rowIndex) => {
    let offset = headerLength + rowIndex * recordLength;
    output[offset] = 0x20;
    offset += 1;
    fields.forEach((field, fieldIndex) => {
      const value = row[fieldIndex] ?? '';
      const padded = field.type === 'N'
        ? `${' '.repeat(Math.max(0, field.length - value.length))}${value}`
        : `${value}${' '.repeat(Math.max(0, field.length - value.length))}`;
      output.set(new TextEncoder().encode(padded).subarray(0, field.length), offset);
      offset += field.length;
    });
  });
  output[output.length - 1] = 0x1a;
  return output;
}

function buildPPTBinaryCompoundFile(): Uint8Array {
  const presentation = buildPPTRecord(
    1000,
    true,
    buildPPTRecord(4000, false, utf16LEBytes('Deck Title')),
    buildPPTRecord(4008, false, new TextEncoder().encode('Bullet one'))
  );
  return buildCompoundFileWithStreams({ 'PowerPoint Document': presentation });
}

function buildMinimalCompoundFile(streamNames: string[]): Uint8Array {
  return buildCompoundFileWithStreams(
    Object.fromEntries(streamNames.map((name) => [name, new Uint8Array(16)]))
  );
}

function buildCompoundFileWithStreams(streams: Record<string, Uint8Array>): Uint8Array {
  const sectorSize = 512;
  const directorySector = 0;
  const fatSector = 1;
  const firstStreamSector = 2;
  const streamNames = Object.keys(streams).sort();
  if (streamNames.length > 3) {
    throw new Error(`Test compound helper supports at most 3 streams, got ${streamNames.length}.`);
  }

  const layouts = new Map<string, { startSector: number; sectorCount: number }>();
  let sectorCount = firstStreamSector;
  for (const streamName of streamNames) {
    const stream = streams[streamName] ?? new Uint8Array();
    const streamSectorCount = Math.max(1, Math.ceil(stream.byteLength / sectorSize));
    layouts.set(streamName, {
      startSector: sectorCount,
      sectorCount: streamSectorCount
    });
    sectorCount += streamSectorCount;
  }

  const bytes = new Uint8Array(512 + sectorCount * sectorSize);
  const view = new DataView(bytes.buffer);

  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x18, 0x003e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, directorySector, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, compoundEndOfChain, true);
  view.setUint32(0x44, compoundEndOfChain, true);
  view.setUint32(0x4c, fatSector, true);
  for (let headerOffset = 0x50; headerOffset + 4 <= 0x200; headerOffset += 4) {
    view.setUint32(headerOffset, compoundFreeSector, true);
  }

  const directoryOffset = 512 + directorySector * sectorSize;
  writeCompoundDirectoryEntry(bytes, directoryOffset, 0, 'Root Entry', compoundDirectoryRoot, compoundEndOfChain, 0);
  streamNames.forEach((streamName, streamIndex) => {
    writeCompoundDirectoryEntry(
      bytes,
      directoryOffset,
      streamIndex + 1,
      streamName,
      compoundDirectoryStream,
      layouts.get(streamName)?.startSector ?? compoundEndOfChain,
      streams[streamName]?.byteLength ?? 0
    );
    bytes.set(streams[streamName] ?? new Uint8Array(), 512 + (layouts.get(streamName)?.startSector ?? 0) * sectorSize);
  });

  const fatOffset = 512 + fatSector * sectorSize;
  for (let fatEntryOffset = 0; fatEntryOffset < sectorSize; fatEntryOffset += 4) {
    view.setUint32(fatOffset + fatEntryOffset, compoundFreeSector, true);
  }
  view.setUint32(fatOffset + directorySector * 4, compoundEndOfChain, true);
  view.setUint32(fatOffset + fatSector * 4, compoundFATSector, true);
  streamNames.forEach((streamName) => {
    const layout = layouts.get(streamName);
    if (!layout) {
      return;
    }
    for (let index = 0; index < layout.sectorCount; index += 1) {
      const sector = layout.startSector + index;
      const next = index + 1 < layout.sectorCount ? sector + 1 : compoundEndOfChain;
      view.setUint32(fatOffset + sector * 4, next, true);
    }
  });

  return bytes;
}

function utf16LEBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(index * 2, text.charCodeAt(index), true);
  }
  return bytes;
}

function buildBIFFRecord(id: number, data: Uint8Array): Uint8Array {
  const record = new Uint8Array(4 + data.byteLength);
  const view = new DataView(record.buffer);
  view.setUint16(0, id, true);
  view.setUint16(2, data.byteLength, true);
  record.set(data, 4);
  return record;
}

function buildBIFFLabelRecord(row: number, col: number, value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const data = new Uint8Array(6 + 3 + encoded.byteLength);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, col, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, value.length, true);
  data[8] = 0;
  data.set(encoded, 9);
  return data;
}

function buildBIFFNumberRecord(row: number, col: number, value: number): Uint8Array {
  const data = new Uint8Array(14);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, col, true);
  view.setUint16(4, 0, true);
  view.setFloat64(6, value, true);
  return data;
}

function buildPPTRecord(recordType: number, container: boolean, ...payloads: Uint8Array[]): Uint8Array {
  const size = payloads.reduce((total, payload) => total + payload.byteLength, 0);
  const output = new Uint8Array(8 + size);
  const view = new DataView(output.buffer);
  view.setUint16(0, container ? 0x000f : 0, true);
  view.setUint16(2, recordType, true);
  view.setUint32(4, size, true);
  let offset = 8;
  for (const payload of payloads) {
    output.set(payload, offset);
    offset += payload.byteLength;
  }
  return output;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function writeCompoundDirectoryEntry(
  bytes: Uint8Array,
  directoryOffset: number,
  index: number,
  name: string,
  entryType: number,
  startSector: number,
  size: number
): void {
  const view = new DataView(bytes.buffer);
  const recordOffset = directoryOffset + index * 128;
  for (let charIndex = 0; charIndex < name.length; charIndex += 1) {
    view.setUint16(recordOffset + charIndex * 2, name.charCodeAt(charIndex), true);
  }
  view.setUint16(recordOffset + name.length * 2, 0, true);
  view.setUint16(recordOffset + 0x40, (name.length + 1) * 2, true);
  bytes[recordOffset + 0x42] = entryType;
  bytes[recordOffset + 0x43] = 1;
  view.setUint32(recordOffset + 0x44, compoundFreeSector, true);
  view.setUint32(recordOffset + 0x48, compoundFreeSector, true);
  view.setUint32(recordOffset + 0x4c, compoundFreeSector, true);
  view.setUint32(recordOffset + 0x74, startSector, true);
  view.setUint32(recordOffset + 0x78, size, true);
}

const compoundFreeSector = 0xffffffff;
const compoundEndOfChain = 0xfffffffe;
const compoundFATSector = 0xfffffffd;
const compoundDirectoryStream = 2;
const compoundDirectoryRoot = 5;

function expectZipEntries(bytes: Uint8Array, requiredEntries: readonly string[]): void {
  const entries = readZipEntryNames(bytes);
  for (const entry of requiredEntries) {
    expect(entries).toContain(entry);
  }
}

function readZipTextEntry(bytes: Uint8Array, entryName: string): string {
  return new TextDecoder().decode(readZipEntry(bytes, entryName));
}

function readZipEntry(bytes: Uint8Array, entryName: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findZipEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory header at ${offset}.`);
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, '/');

    if (name === entryName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error(`Invalid ZIP local file header for ${entryName}.`);
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        return compressed;
      }
      if (compressionMethod === 8) {
        return new Uint8Array(inflateRawSync(compressed));
      }
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${entryName}.`);
    }

    offset = nameStart + nameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry ${entryName} was not found.`);
}

function readZipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findZipEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const entries: string[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory header at ${offset}.`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, '/');
    entries.push(name);
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findZipEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error('ZIP end of central directory record was not found.');
}
