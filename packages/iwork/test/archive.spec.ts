import { describe, expect, it } from 'vitest';
import type { IworkArchiveRecord } from '../src/types';

function createRecord(id: number, typeName: string, value: unknown): IworkArchiveRecord {
  return {
    id,
    archiveId: 1,
    messageIndex: 0,
    typeId: id,
    typeName,
    value,
    objectReferences: [],
    dataReferences: []
  };
}

describe('archive data entry normalization', () => {
  it('resolves media paths from documentResourceLocator and metadata references', async () => {
    const { __private__ } = await import('../src/parser/archive');
    const records: Record<string, IworkArchiveRecord> = {
      '91': createRecord(91, 'TSP.DatabaseDataArchive', {
        appRelativePath: 'Metadata/DocumentStylesheet.iwa',
        displayName: 'DocumentStylesheet.iwa'
      }),
      '92': createRecord(92, 'TSP.DatabaseDataArchive', {
        appRelativePath: 'Data/texture.webp',
        displayName: 'texture.webp'
      })
    };

    const entries = __private__.normalizeDataEntries(
      {
        datas: [
          {
            identifier: 1,
            preferredFileName: 'fallback-name.png',
            documentResourceLocator: 'Data/image-001.png'
          },
          {
            identifier: 2,
            documentResourceLocator: 'texture-inline.webp'
          },
          {
            identifier: 3
          },
          {
            identifier: 4
          }
        ],
        dataMetadataMap: {
          dataMetadataEntries: [
            {
              dataIdentifier: 3,
              dataMetadata: {
                identifier: 91
              }
            },
            {
              dataIdentifier: 4,
              dataMetadata: {
                identifier: 92
              }
            }
          ]
        }
      },
      records
    );

    expect(entries['1']).toMatchObject({
      path: 'Data/fallback-name.png',
      contentType: 'image/png'
    });
    expect(entries['2']).toMatchObject({
      path: 'Data/texture-inline.webp',
      contentType: 'image/webp'
    });
    expect(entries['3']).toMatchObject({
      path: 'Metadata/DocumentStylesheet.iwa',
      contentType: 'application/octet-stream'
    });
    expect(entries['4']).toMatchObject({
      path: 'Data/texture.webp',
      fileName: 'texture.webp',
      contentType: 'image/webp'
    });
  });
});
