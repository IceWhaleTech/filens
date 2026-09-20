import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectIworkType: vi.fn(),
  loadSourceBytes: vi.fn(),
  loadArchivePackage: vi.fn(),
  buildParsedDocument: vi.fn()
}));

vi.mock('../src/parser/detect', () => ({
  detectIworkType: mocks.detectIworkType
}));

vi.mock('../src/parser/load-source', () => ({
  loadSourceBytes: mocks.loadSourceBytes
}));

vi.mock('../src/parser/archive', () => ({
  loadArchivePackage: mocks.loadArchivePackage
}));

vi.mock('../src/parser/semantic', () => ({
  buildParsedDocument: mocks.buildParsedDocument
}));

import { loadIwork } from '../src/parser/load-iwork';

describe('loadIwork source name propagation', () => {
  beforeEach(() => {
    mocks.detectIworkType.mockReset();
    mocks.loadSourceBytes.mockReset();
    mocks.loadArchivePackage.mockReset();
    mocks.buildParsedDocument.mockReset();
  });

  it('passes basename-derived sourceName into archive loading', async () => {
    mocks.detectIworkType.mockResolvedValue('pages');
    mocks.loadSourceBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.loadArchivePackage.mockResolvedValue({
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      media: {},
      zip: {}
    });
    mocks.buildParsedDocument.mockReturnValue({
      kind: 'pages',
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      warnings: [],
      title: 'Doc',
      pages: [],
      media: {}
    });

    await loadIwork('https://example.com/files/Quarterly%20Report.pages?download=1');

    expect(mocks.loadArchivePackage).toHaveBeenCalledWith(expect.any(Uint8Array), 'pages', {
      sourceName: 'Quarterly Report.pages'
    });
  });

  it('lets explicit sourceName override inferred names', async () => {
    mocks.detectIworkType.mockResolvedValue('pages');
    mocks.loadSourceBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.loadArchivePackage.mockResolvedValue({
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      media: {},
      zip: {}
    });
    mocks.buildParsedDocument.mockReturnValue({
      kind: 'pages',
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      warnings: [],
      title: 'Doc',
      pages: [],
      media: {}
    });

    await loadIwork('https://example.com/files/ignored.pages', {
      sourceName: 'Custom Name.pages'
    });

    expect(mocks.loadArchivePackage).toHaveBeenLastCalledWith(expect.any(Uint8Array), 'pages', {
      sourceName: 'Custom Name.pages'
    });
  });
});
