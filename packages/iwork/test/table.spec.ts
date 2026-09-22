import { describe, expect, it } from 'vitest';
import { buildTableItem } from '../src/parser/table';
import type { IworkArchiveIndex } from '../src/types';

function createNumbersArchive(): IworkArchiveIndex {
  return {
    type: 'numbers',
    records: {},
    references: {
      outgoing: {},
      incoming: {}
    },
    dataEntries: {},
    warnings: []
  };
}

function createControlCellBuffer(selectedIndex: number): Uint8Array {
  const buffer = new Uint8Array(16);
  const view = new DataView(buffer.buffer);
  buffer[0] = 5;
  buffer[1] = 0;
  view.setUint32(12, selectedIndex, true);
  return buffer;
}

function createTextCellBuffer(contentKey: number): Uint8Array {
  const buffer = new Uint8Array(16);
  const view = new DataView(buffer.buffer);
  buffer[0] = 5;
  buffer[1] = 3;
  view.setUint32(12, contentKey, true);
  return buffer;
}

function createTextCellBufferWithStyle(contentKey: number, styleKey: number): Uint8Array {
  const buffer = new Uint8Array(20);
  const view = new DataView(buffer.buffer);
  buffer[0] = 5;
  buffer[1] = 3;
  view.setUint32(12, contentKey, true);
  view.setUint32(16, styleKey, true);
  return buffer;
}

function createPreBncNumberCellBuffer(value: number, formatKey: number): Uint8Array {
  const buffer = new Uint8Array(24);
  const view = new DataView(buffer.buffer);
  buffer[0] = 4;
  buffer[1] = 2;
  view.setUint16(4, 3, true);
  view.setUint32(12, formatKey, true);
  view.setFloat64(16, value, true);
  return buffer;
}

function createPreBncTextCellBuffer(contentKey: number, formatKey: number): Uint8Array {
  const buffer = new Uint8Array(20);
  const view = new DataView(buffer.buffer);
  buffer[0] = 4;
  buffer[1] = 3;
  view.setUint16(4, 3, true);
  view.setUint32(12, formatKey, true);
  view.setUint32(16, contentKey, true);
  return buffer;
}

function createCellOffsets(offsets: number[]): Uint8Array {
  const buffer = new Uint8Array(offsets.length * 2);
  const view = new DataView(buffer.buffer);
  offsets.forEach((offset, index) => {
    view.setUint16(index * 2, offset, true);
  });
  return buffer;
}

function renderSingleFormattedNumber(value: number, format: Record<string, unknown>, formatKey = 12): string | undefined {
  const archive = createNumbersArchive();

  archive.records['1'] = {
    id: 1,
    archiveId: 1,
    messageIndex: 0,
    typeId: 6001,
    typeName: 'TST.TableModelArchive',
    objectReferences: [2, 3],
    dataReferences: [],
    value: {
      tableName: 'Formatted Number Table',
      numberOfColumns: 1,
      numberOfRows: 1,
      defaultColumnWidth: 72,
      defaultRowHeight: 22,
      baseDataStore: {
        tiles: {
          tiles: [
            {
              tile: { identifier: 2 }
            }
          ]
        },
        formatTablePreBnc: { identifier: 3 }
      }
    }
  };

  archive.records['2'] = {
    id: 2,
    archiveId: 1,
    messageIndex: 1,
    typeId: 6002,
    typeName: 'TST.Tile',
    objectReferences: [],
    dataReferences: [],
    value: {
      rowInfos: [
        {
          tileRowIndex: 0,
          cellCount: 1,
          cellOffsetsPreBnc: createCellOffsets([0]),
          cellStorageBufferPreBnc: createPreBncNumberCellBuffer(value, formatKey)
        }
      ]
    }
  };

  archive.records['3'] = {
    id: 3,
    archiveId: 1,
    messageIndex: 2,
    typeId: 6005,
    typeName: 'TST.TableDataList',
    objectReferences: [],
    dataReferences: [],
    value: {
      entries: [
        {
          key: formatKey,
          format
        }
      ]
    }
  };

  const table = buildTableItem(
    archive,
    {
      tableModel: { identifier: 1 }
    },
    {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      flipH: false,
      flipV: false
    },
    0
  );

  return table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text;
}

function renderSingleFormattedText(text: string, format: Record<string, unknown>, formatKey = 12): string | undefined {
  const archive = createNumbersArchive();

  archive.records['1'] = {
    id: 1,
    archiveId: 1,
    messageIndex: 0,
    typeId: 6001,
    typeName: 'TST.TableModelArchive',
    objectReferences: [2, 3, 4],
    dataReferences: [],
    value: {
      tableName: 'Formatted Text Table',
      numberOfColumns: 1,
      numberOfRows: 1,
      defaultColumnWidth: 72,
      defaultRowHeight: 22,
      baseDataStore: {
        tiles: {
          tiles: [
            {
              tile: { identifier: 2 }
            }
          ]
        },
        stringTable: { identifier: 3 },
        formatTablePreBnc: { identifier: 4 }
      }
    }
  };

  archive.records['2'] = {
    id: 2,
    archiveId: 1,
    messageIndex: 1,
    typeId: 6002,
    typeName: 'TST.Tile',
    objectReferences: [],
    dataReferences: [],
    value: {
      rowInfos: [
        {
          tileRowIndex: 0,
          cellCount: 1,
          cellOffsetsPreBnc: createCellOffsets([0]),
          cellStorageBufferPreBnc: createPreBncTextCellBuffer(1, formatKey)
        }
      ]
    }
  };

  archive.records['3'] = {
    id: 3,
    archiveId: 1,
    messageIndex: 2,
    typeId: 6005,
    typeName: 'TST.TableDataList',
    objectReferences: [],
    dataReferences: [],
    value: {
      entries: [
        {
          key: 1,
          string: text
        }
      ]
    }
  };

  archive.records['4'] = {
    id: 4,
    archiveId: 1,
    messageIndex: 3,
    typeId: 6005,
    typeName: 'TST.TableDataList',
    objectReferences: [],
    dataReferences: [],
    value: {
      entries: [
        {
          key: formatKey,
          format
        }
      ]
    }
  };

  const table = buildTableItem(
    archive,
    {
      tableModel: { identifier: 1 }
    },
    {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      flipH: false,
      flipV: false
    },
    0
  );

  return table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text;
}

describe('iWork table parser', () => {
  it('resolves Numbers control cells from popup-menu models', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Control Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          multipleChoiceListFormatTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: new Uint8Array([0, 0]),
            cellStorageBuffer: createControlCellBuffer(2)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [4],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            reference: { identifier: 4 }
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6206,
      typeName: 'TST.PopUpMenuModel',
      objectReferences: [],
      dataReferences: [],
      value: {
        item: [
          {
            cellValueType: 5,
            stringValue: {
              value: 'Draft'
            }
          },
          {
            cellValueType: 5,
            stringValue: {
              value: 'Published'
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table).toBeTruthy();
    expect(table?.cells).toHaveLength(1);
    const text = table?.cells[0]?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
    expect(text).toBe('Published');
  });

  it('applies Numbers mergeRegionMap spans and marks covered cells', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 5],
      dataReferences: [],
      value: {
        tableName: 'Merged Table',
        numberOfColumns: 2,
        numberOfRows: 2,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 },
          mergeRegionMap: { identifier: 5 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, 65535]),
            cellStorageBuffer: createTextCellBuffer(1)
          },
          {
            tileRowIndex: 1,
            cellCount: 2,
            cellOffsets: createCellOffsets([65535, 65535]),
            cellStorageBuffer: new Uint8Array(0)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Merged'
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6107,
      typeName: 'TST.MergeRegionMapArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellRange: [
          {
            origin: {
              packedData: 0
            },
            size: {
              numRows: 2,
              numColumns: 2
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table).toBeTruthy();
    expect(table?.cells).toHaveLength(4);

    const anchorCell = table?.cells.find((cell) => cell.row === 0 && cell.column === 0);
    expect(anchorCell).toMatchObject({
      rowSpan: 2,
      colSpan: 2,
      isMergedContinuation: false
    });
    const text = anchorCell?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
    expect(text).toBe('Merged');

    const coveredCells = table?.cells.filter((cell) => cell.isMergedContinuation) ?? [];
    expect(coveredCells.map((cell) => `${cell.row}:${cell.column}`).sort()).toEqual(['0:1', '1:0', '1:1']);
  });

  it('supports merge ranges stored through expanded coordinates and packed table sizes', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 5],
      dataReferences: [],
      value: {
        tableName: 'Packed Merge Table',
        numberOfColumns: 2,
        numberOfRows: 2,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 },
          mergeRegionMap: { identifier: 5 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([65535, 0]),
            cellStorageBuffer: createTextCellBuffer(1)
          },
          {
            tileRowIndex: 1,
            cellCount: 2,
            cellOffsets: createCellOffsets([65535, 65535]),
            cellStorageBuffer: new Uint8Array(0)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Stacked'
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6107,
      typeName: 'TST.MergeRegionMapArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellRange: [
          {
            origin: {
              expandedCoord: {
                row: 0,
                column: 1
              }
            },
            size: {
              packedData: (2 << 16) | 1
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table).toBeTruthy();
    const anchorCell = table?.cells.find((cell) => cell.row === 0 && cell.column === 1);
    expect(anchorCell).toMatchObject({
      rowSpan: 2,
      colSpan: 1,
      isMergedContinuation: false
    });
    const coveredCell = table?.cells.find((cell) => cell.row === 1 && cell.column === 1);
    expect(coveredCell?.isMergedContinuation).toBe(true);
  });

  it('reads Numbers column widths from header storage buckets and spans numberOfCells', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Bucket Width Table',
        numberOfColumns: 3,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 },
          columnHeaders: { identifier: 4 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 3,
            cellOffsets: createCellOffsets([0, 65535, 65535]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Sized'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6006,
      typeName: 'TST.HeaderStorage',
      objectReferences: [5],
      dataReferences: [],
      value: {
        buckets: [
          {
            identifier: 5
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6006,
      typeName: 'TST.HeaderStorageBucket',
      objectReferences: [],
      dataReferences: [],
      value: {
        headers: [
          {
            index: 0,
            size: 96,
            numberOfCells: 2
          },
          {
            index: 2,
            size: 144
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.columns).toEqual([96, 96, 144]);
  });

  it('keeps Pages row and column sizes when numberOfCells is the perpendicular table count', () => {
    const archive = createNumbersArchive();
    archive.type = 'pages';
    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Pages dimensions',
        numberOfColumns: 3,
        numberOfRows: 3,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [{ tile: { identifier: 2 } }]
          },
          stringTable: { identifier: 3 },
          rowHeaders: {
            headers: [{ index: 1, size: 10, numberOfCells: 3 }]
          },
          columnHeaders: {
            headers: [{ index: 1, size: 100, numberOfCells: 3 }]
          }
        }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [{ tileRowIndex: 0, cellCount: 1, cellOffsets: createCellOffsets([0]), cellStorageBuffer: createTextCellBuffer(1) }]
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: { entries: [{ key: 1, string: 'cell' }] }
    };

    const table = buildTableItem(
      archive,
      { tableModel: { identifier: 1 } },
      {
        x: 0,
        y: 0,
        width: 300,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.rows).toEqual([22, 10, 22]);
    expect(table?.columns).toEqual([72, 100, 72]);
  });

  it('keeps subtle grid lines for single-column Pages layout tables', () => {
    const archive = createNumbersArchive();
    archive.type = 'pages';
    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Pages layout table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 200,
        defaultRowHeight: 22,
        bodyCellStyle: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [{ tile: { identifier: 2 } }]
          },
          stringTable: { identifier: 3 }
        }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [{
          tileRowIndex: 0,
          cellCount: 1,
          cellOffsets: createCellOffsets([0]),
          cellStorageBuffer: createTextCellBuffer(1)
        }]
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [{ key: 1, string: 'Body text' }]
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          stroke: {
            width: 1,
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      { tableModel: { identifier: 1 } },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 22,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.borders).toMatchObject({
      top: { width: 0.5, color: '#dddddd' },
      right: { width: 0.5, color: '#dddddd' },
      bottom: { width: 0.5, color: '#dddddd' },
      left: { width: 0.5, color: '#dddddd' }
    });
  });

  it('uses header storage styles while keeping local cell styles highest priority', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4, 6, 7, 8],
      dataReferences: [],
      value: {
        tableName: 'Header Style Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 },
          rowHeaders: { identifier: 4 },
          styleTable: { identifier: 8 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBufferWithStyle(1, 2)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Styled'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6006,
      typeName: 'TST.HeaderStorage',
      objectReferences: [5],
      dataReferences: [],
      value: {
        buckets: [
          {
            identifier: 5
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6006,
      typeName: 'TST.HeaderStorageBucket',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        headers: [
          {
            index: 0,
            size: 22,
            cellStyle: { identifier: 6 },
            textStyle: { identifier: 7 }
          }
        ]
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          cellFill: {
            color: {
              r: 0,
              g: 1,
              b: 0,
              a: 1
            }
          }
        }
      }
    };

    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 18,
          fontName: 'Header Font',
          fontColor: {
            r: 0,
            g: 0,
            b: 1,
            a: 1
          }
        }
      }
    };

    archive.records['8'] = {
      id: 8,
      archiveId: 1,
      messageIndex: 7,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [9],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 2,
            reference: { identifier: 9 }
          }
        ]
      }
    };

    archive.records['9'] = {
      id: 9,
      archiveId: 1,
      messageIndex: 8,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          cellFill: {
            color: {
              r: 1,
              g: 0,
              b: 0,
              a: 1
            }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    const cell = table?.cells[0];
    expect(cell?.fill).toMatchObject({
      type: 'solid',
      color: '#ff0000'
    });
    const run = cell?.textFrame.paragraphs[0]?.runs[0];
    expect(run).toMatchObject({
      text: 'Styled',
      fontSize: 18,
      fontFamily: 'Header Font',
      color: '#0000ff'
    });
  });

  it('reads snake_case table model, storage, and style fields', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4, 5, 6],
      dataReferences: [],
      value: {
        table_name: 'Snake Table',
        number_of_columns: 1,
        number_of_rows: 1,
        default_column_width: 72,
        default_row_height: 22,
        body_cell_style: { identifier: 5 },
        body_text_style: { identifier: 6 },
        base_data_store: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          string_table: { identifier: 3 },
          style_table: { identifier: 4 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        row_infos: [
          {
            tile_row_index: 0,
            cellCount: 1,
            cell_offsets: createCellOffsets([0]),
            cell_storage_buffer: createTextCellBufferWithStyle(1, 2)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Snake Styled'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [7],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 2,
            reference: { identifier: 7 }
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cell_properties: {
          cell_fill: {
            color: {
              r: 0.1,
              g: 0.6,
              b: 0.2,
              a: 1
            }
          }
        }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        char_properties: {
          font_size: 16,
          font_name: 'Snake Font',
          font_color: {
            r: 1,
            g: 0.5,
            b: 0,
            a: 1
          }
        }
      }
    };

    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cell_properties: {
          cell_fill: {
            color: {
              r: 0.8,
              g: 0.2,
              b: 0.1,
              a: 1
            }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.name).toBe('Snake Table');
    expect(table?.cells[0]?.fill).toMatchObject({
      type: 'solid',
      color: '#cc331a'
    });
    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]).toMatchObject({
      text: 'Snake Styled',
      fontSize: 16,
      fontFamily: 'Snake Font',
      color: '#ff8000'
    });
  });

  it('reads snake_case cell_count for header inference and cell payloads', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        table_name: 'Snake Header Table',
        number_of_columns: 1,
        number_of_rows: 2,
        number_of_header_rows: 1,
        default_column_width: 72,
        default_row_height: 22,
        base_data_store: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          string_table: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        row_infos: [
          {
            tile_row_index: 0,
            cell_count: 1,
            cell_offsets: createCellOffsets([0]),
            cell_storage_buffer: createTextCellBuffer(1)
          },
          {
            tile_row_index: 1,
            cell_count: 1,
            cell_offsets_pre_bnc: createCellOffsets([0]),
            cell_storage_buffer_pre_bnc: createPreBncNumberCellBuffer(44958, 99)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Date'
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        table_model: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.find((cell) => cell.row === 0 && cell.column === 0)?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Date');
    expect(table?.cells.find((cell) => cell.row === 1 && cell.column === 0)?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('2023-02-01');
  });

  it('applies header storage style spans across numberOfCells', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4, 6],
      dataReferences: [],
      value: {
        tableName: 'Header Span Style Table',
        numberOfColumns: 2,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 },
          columnHeaders: { identifier: 4 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const buffer = new Uint8Array(firstCell.length + secondCell.length);
    buffer.set(firstCell, 0);
    buffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: buffer
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'A'
          },
          {
            key: 2,
            string: 'B'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6006,
      typeName: 'TST.HeaderStorage',
      objectReferences: [5],
      dataReferences: [],
      value: {
        buckets: [
          {
            identifier: 5
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6006,
      typeName: 'TST.HeaderStorageBucket',
      objectReferences: [6],
      dataReferences: [],
      value: {
        headers: [
          {
            index: 0,
            size: 72,
            numberOfCells: 2,
            cellStyle: { identifier: 6 }
          }
        ]
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          cellFill: {
            color: {
              r: 0,
              g: 0.5,
              b: 1,
              a: 1
            }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.map((cell) => cell.fill.color)).toEqual(['#0080ff', '#0080ff']);
  });

  it('marks rows and columns hidden by header hidingState spans', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Hidden Header Table',
        numberOfColumns: 3,
        numberOfRows: 3,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          rowHeaders: {
            headers: [
              {
                index: 1,
                size: 22,
                hidingState: 1,
                numberOfCells: 2
              }
            ]
          },
          columnHeaders: { identifier: 4 },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: firstCell
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Visible'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6006,
      typeName: 'TST.HeaderStorage',
      objectReferences: [5],
      dataReferences: [],
      value: {
        buckets: [
          {
            identifier: 5
          }
        ]
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6006,
      typeName: 'TST.HeaderStorageBucket',
      objectReferences: [],
      dataReferences: [],
      value: {
        headers: [
          {
            index: 2,
            size: 72,
            hidingState: 1,
            numberOfCells: 1
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.hiddenRows).toEqual([1, 2]);
    expect(table?.hiddenColumns).toEqual([2]);
  });

  it('marks rows and columns hidden by HiddenStatesOwner UID state', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'UID Hidden Table',
        numberOfColumns: 3,
        numberOfRows: 3,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseColumnRowUids: { identifier: 4 },
        hiddenStatesOwner: {
          hiddenStates: [
            {
              rowHiddenStateExtent: {
                baseHiddenStates: [
                  {
                    rowOrColumnUid: { upper: 10, lower: 102 },
                    userHidden: true
                  }
                ]
              },
              columnHiddenStateExtent: {
                baseHiddenStates: [
                  {
                    rowOrColumnUid: { upper: 20, lower: 203 },
                    filtered: true
                  }
                ]
              }
            }
          ]
        },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Visible'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6001,
      typeName: 'TST.CellUIDListArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowUids: [
          { upper: 10, lower: 101 },
          { upper: 10, lower: 102 },
          { upper: 10, lower: 103 }
        ],
        columnUids: [
          { upper: 20, lower: 201 },
          { upper: 20, lower: 202 },
          { upper: 20, lower: 203 }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.hiddenRows).toEqual([1]);
    expect(table?.hiddenColumns).toEqual([2]);
  });

  it('resolves hidden state UIDs through compressed lookup indexes', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Compressed UID Hidden Table',
        numberOfColumns: 2,
        numberOfRows: 2,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseColumnRowUids: { identifier: 4 },
        hiddenStatesOwner: {
          hiddenStates: [
            {
              rowHiddenStateExtent: {
                baseHiddenStates: [
                  {
                    rowOrColumnUid: { upper: 30, lower: 302 },
                    pivotHidden: true
                  }
                ]
              },
              columnHiddenStateExtent: {
                baseHiddenStates: []
              }
            }
          ]
        },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Visible'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6001,
      typeName: 'TST.CellUIDListArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        compressedRowIndexes: [1, 0],
        compressedColumnIndexes: [0, 1],
        uncompressedLookupList: {
          rowUids: {
            uuids: [
              { upper: 30, lower: 301 },
              { upper: 30, lower: 302 }
            ]
          },
          columnUids: {
            uuids: [
              { upper: 40, lower: 401 },
              { upper: 40, lower: 402 }
            ]
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.hiddenRows).toEqual([0]);
  });

  it('uses table style network defaults through a style preset', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Preset Style Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Network styled'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        bodyCellStyle: { identifier: 6 },
        bodyTextStyle: { identifier: 7 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          cellFill: {
            color: {
              r: 0.1,
              g: 0.2,
              b: 0.3,
              a: 1
            }
          }
        }
      }
    };

    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 19,
          fontName: 'Network Font',
          fontColor: {
            r: 0.9,
            g: 0.8,
            b: 0.7,
            a: 1
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    const cell = table?.cells[0];
    expect(cell?.fill).toMatchObject({
      type: 'solid',
      color: '#1a334d'
    });
    expect(cell?.textFrame.paragraphs[0]?.runs[0]).toMatchObject({
      text: 'Network styled',
      fontSize: 19,
      fontFamily: 'Network Font',
      color: '#e6ccb3'
    });
  });

  it('maps per-side cell border strokes', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Border Style Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        bodyCellStyle: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Borders'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          topStroke: {
            width: 2,
            color: { r: 1, g: 0, b: 0, a: 1 }
          },
          rightStroke: {
            width: 3,
            color: { r: 0, g: 1, b: 0, a: 1 }
          },
          bottomStroke: {
            width: 4,
            color: { r: 0, g: 0, b: 1, a: 1 }
          },
          leftStroke: {
            width: 5,
            color: { r: 1, g: 1, b: 0, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.borders).toMatchObject({
      top: { width: 2, color: '#ff0000' },
      right: { width: 3, color: '#00ff00' },
      bottom: { width: 4, color: '#0000ff' },
      left: { width: 5, color: '#ffff00' }
    });
  });

  it('respects deprecated per-side cell border empty and opacity flags', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Deprecated Cell Border Flags Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        bodyCellStyle: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Deprecated cell borders'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          deprecatedTopStroke: {
            empty: true,
            stroke: {
              width: 2,
              color: { r: 1, g: 0, b: 0, a: 1 }
            }
          },
          deprecatedRightStroke: {
            opacity: 0.5,
            stroke: {
              width: 3,
              color: { r: 0, g: 1, b: 0, a: 0.5 }
            }
          },
          stroke: {
            width: 1,
            color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.borders?.top).toBeUndefined();
    expect(table?.cells[0]?.borders?.right).toMatchObject({
      width: 3,
      color: '#00ff00',
      alpha: 0.25
    });
    expect(table?.cells[0]?.borders?.bottom).toMatchObject({
      width: 1,
      color: '#cccccc'
    });
  });

  it('applies table style banded row fill to body rows', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Banded Row Table',
        numberOfColumns: 1,
        numberOfRows: 4,
        numberOfHeaderRows: 1,
        numberOfFooterRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const thirdCell = createTextCellBuffer(3);
    const fourthCell = createTextCellBuffer(4);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: firstCell
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: secondCell
          },
          {
            tileRowIndex: 2,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: thirdCell
          },
          {
            tileRowIndex: 3,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: fourthCell
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'Header' },
          { key: 2, string: 'Body A' },
          { key: 3, string: 'Body B' },
          { key: 4, string: 'Footer' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          bandedRows: true,
          bandedFill: {
            color: {
              r: 0.8,
              g: 0.9,
              b: 1,
              a: 1
            }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.map((cell) => cell.fill)).toMatchObject([
      { type: 'none' },
      { type: 'none' },
      { type: 'solid', color: '#cce6ff' },
      { type: 'none' }
    ]);
  });

  it('applies table style body horizontal and vertical strokes', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Body Stroke Table',
        numberOfColumns: 2,
        numberOfRows: 2,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const firstRowBuffer = new Uint8Array(firstCell.length + secondCell.length);
    firstRowBuffer.set(firstCell, 0);
    firstRowBuffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: firstRowBuffer
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(3)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'A1' },
          { key: 2, string: 'A2' },
          { key: 3, string: 'B1' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          tableBodyHorizontalStroke: {
            width: 2,
            color: { r: 1, g: 0.5, b: 0, a: 1 }
          },
          tableBodyVerticalStroke: {
            width: 3,
            color: { r: 0, g: 0.5, b: 1, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.borders).toMatchObject({
      top: { width: 2, color: '#ff8000' },
      right: { width: 3, color: '#0080ff' },
      bottom: { width: 2, color: '#ff8000' },
      left: { width: 3, color: '#0080ff' }
    });
  });

  it('applies table style header and footer separator strokes', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Header Footer Stroke Table',
        numberOfColumns: 2,
        numberOfRows: 3,
        numberOfHeaderRows: 1,
        numberOfHeaderColumns: 1,
        numberOfFooterRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const firstRowBuffer = new Uint8Array(firstCell.length + secondCell.length);
    firstRowBuffer.set(firstCell, 0);
    firstRowBuffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: firstRowBuffer
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(3)
          },
          {
            tileRowIndex: 2,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(4)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'H1' },
          { key: 2, string: 'H2' },
          { key: 3, string: 'Body' },
          { key: 4, string: 'Footer' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          headerRowSeparatorStroke: {
            width: 4,
            color: { r: 1, g: 0, b: 0, a: 1 }
          },
          headerColumnSeparatorStroke: {
            width: 5,
            color: { r: 0, g: 1, b: 0, a: 1 }
          },
          footerRowSeparatorStroke: {
            width: 6,
            color: { r: 0, g: 0, b: 1, a: 1 }
          },
          footerRowBorderStroke: {
            width: 7,
            color: { r: 1, g: 1, b: 0, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.find((cell) => cell.row === 0 && cell.column === 1)?.borders).toMatchObject({
      bottom: { width: 4, color: '#ff0000' }
    });
    expect(table?.cells.find((cell) => cell.row === 1 && cell.column === 0)?.borders).toMatchObject({
      right: { width: 5, color: '#00ff00' }
    });
    expect(table?.cells.find((cell) => cell.row === 2 && cell.column === 0)?.borders).toMatchObject({
      top: { width: 6, color: '#0000ff' },
      bottom: { width: 7, color: '#ffff00' }
    });
  });

  it('honors table style stroke visibility flags while keeping local cell borders', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4, 7],
      dataReferences: [],
      value: {
        tableName: 'Hidden Stroke Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        bodyCellStyle: { identifier: 7 },
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Local border'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          hStrokesVisible: false,
          vStrokesVisible: false,
          tableBorderVisible: false,
          tableBodyHorizontalStroke: {
            width: 2,
            color: { r: 1, g: 0, b: 0, a: 1 }
          },
          tableBodyVerticalStroke: {
            width: 3,
            color: { r: 0, g: 1, b: 0, a: 1 }
          }
        }
      }
    };

    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          topStroke: {
            width: 5,
            color: { r: 0, g: 0, b: 1, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.borders?.top).toMatchObject({ width: 5, color: '#0000ff' });
    expect(table?.cells[0]?.borders?.right).toBeUndefined();
    expect(table?.cells[0]?.borders?.bottom).toBeUndefined();
    expect(table?.cells[0]?.borders?.left).toBeUndefined();
  });

  it('honors header, header-column, and footer separator visibility flags', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Hidden Separator Table',
        numberOfColumns: 2,
        numberOfRows: 3,
        numberOfHeaderRows: 1,
        numberOfHeaderColumns: 1,
        numberOfFooterRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const firstRowBuffer = new Uint8Array(firstCell.length + secondCell.length);
    firstRowBuffer.set(firstCell, 0);
    firstRowBuffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: firstRowBuffer
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(3)
          },
          {
            tileRowIndex: 2,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(4)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'H1' },
          { key: 2, string: 'H2' },
          { key: 3, string: 'Body' },
          { key: 4, string: 'Footer' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          hrSeparatorVisible: false,
          hcSeparatorVisible: false,
          footerSeparatorVisible: false,
          headerRowSeparatorStroke: {
            width: 4,
            color: { r: 1, g: 0, b: 0, a: 1 }
          },
          headerColumnSeparatorStroke: {
            width: 5,
            color: { r: 0, g: 1, b: 0, a: 1 }
          },
          footerRowSeparatorStroke: {
            width: 6,
            color: { r: 0, g: 0, b: 1, a: 1 }
          },
          tableBodyHorizontalStroke: {
            width: 1,
            color: { r: 0.2, g: 0.2, b: 0.2, a: 1 }
          },
          tableBodyVerticalStroke: {
            width: 1,
            color: { r: 0.3, g: 0.3, b: 0.3, a: 1 }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.find((cell) => cell.row === 0 && cell.column === 1)?.borders?.bottom).toBeUndefined();
    expect(table?.cells.find((cell) => cell.row === 1 && cell.column === 0)?.borders?.right).toBeUndefined();
    expect(table?.cells.find((cell) => cell.row === 2 && cell.column === 0)?.borders?.top).toBeUndefined();
  });

  it('uses deprecated table style stroke wrappers when modern stroke fields are absent', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Deprecated Stroke Table',
        numberOfColumns: 2,
        numberOfRows: 3,
        numberOfHeaderRows: 1,
        numberOfFooterRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const firstRowBuffer = new Uint8Array(firstCell.length + secondCell.length);
    firstRowBuffer.set(firstCell, 0);
    firstRowBuffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: firstRowBuffer
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(3)
          },
          {
            tileRowIndex: 2,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(4)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'H1' },
          { key: 2, string: 'H2' },
          { key: 3, string: 'Body' },
          { key: 4, string: 'Footer' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          deprecatedHeaderRowSeparatorStroke: {
            stroke: {
              width: 4,
              color: { r: 1, g: 0, b: 0, a: 1 }
            }
          },
          deprecatedTableBodyVerticalStroke: {
            stroke: {
              width: 5,
              color: { r: 0, g: 1, b: 0, a: 1 }
            }
          },
          deprecatedFooterRowBorderStroke: {
            stroke: {
              width: 6,
              color: { r: 0, g: 0, b: 1, a: 1 }
            }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.find((cell) => cell.row === 0 && cell.column === 1)?.borders?.bottom).toMatchObject({
      width: 4,
      color: '#ff0000'
    });
    expect(table?.cells.find((cell) => cell.row === 1 && cell.column === 0)?.borders?.right).toMatchObject({
      width: 5,
      color: '#00ff00'
    });
    expect(table?.cells.find((cell) => cell.row === 2 && cell.column === 0)?.borders?.bottom).toMatchObject({
      width: 6,
      color: '#0000ff'
    });
  });

  it('respects deprecated table stroke empty and opacity flags', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Deprecated Stroke Flags Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Flags'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          deprecatedTableBodyHorizontalBorderStroke: {
            empty: true,
            stroke: {
              width: 2,
              color: { r: 1, g: 0, b: 0, a: 1 }
            }
          },
          deprecatedTableBodyVerticalBorderStroke: {
            opacity: 0.25,
            stroke: {
              width: 3,
              color: { r: 0, g: 0, b: 1, a: 0.8 }
            }
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.borders?.top).toBeUndefined();
    expect(table?.cells[0]?.borders?.bottom).toBeUndefined();
    expect(table?.cells[0]?.borders?.left).toMatchObject({
      width: 3,
      color: '#0000ff',
      alpha: 0.2
    });
    expect(table?.cells[0]?.borders?.right).toMatchObject({
      width: 3,
      color: '#0000ff',
      alpha: 0.2
    });
  });

  it('uses table stroke presets as body border fallbacks and honors visible masks', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Stroke Preset Table',
        numberOfColumns: 2,
        numberOfRows: 2,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const firstRowBuffer = new Uint8Array(firstCell.length + secondCell.length);
    firstRowBuffer.set(firstCell, 0);
    firstRowBuffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: firstRowBuffer
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(3)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'A1' },
          { key: 2, string: 'A2' },
          { key: 3, string: 'B1' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          strokePresetList: {
            count: 1,
            preset: [
              {
                visibleMask: 63,
                horizontalStroke: {
                  width: 2,
                  color: { r: 1, g: 0, b: 0, a: 1 }
                },
                verticalStroke: {
                  width: 3,
                  color: { r: 0, g: 1, b: 0, a: 1 }
                },
                exteriorStroke: {
                  width: 4,
                  color: { r: 0, g: 0, b: 1, a: 1 }
                }
              }
            ]
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells.find((cell) => cell.row === 0 && cell.column === 0)?.borders).toMatchObject({
      top: { width: 4, color: '#0000ff' },
      right: { width: 3, color: '#00ff00' },
      bottom: { width: 2, color: '#ff0000' },
      left: { width: 4, color: '#0000ff' }
    });
  });

  it('uses stroke preset visible masks to suppress disabled preset sides', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'Stroke Preset Mask Table',
        numberOfColumns: 2,
        numberOfRows: 2,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        tableStylePreset: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);
    const firstRowBuffer = new Uint8Array(firstCell.length + secondCell.length);
    firstRowBuffer.set(firstCell, 0);
    firstRowBuffer.set(secondCell, firstCell.length);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 2,
            cellOffsets: createCellOffsets([0, firstCell.length]),
            cellStorageBuffer: firstRowBuffer
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(3)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          { key: 1, string: 'A1' },
          { key: 2, string: 'A2' },
          { key: 3, string: 'B1' }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6200,
      typeName: 'TST.TableStylePresetArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        styleNetwork: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 6247,
      typeName: 'TST.TableStyleNetworkArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        tableStyle: { identifier: 6 }
      }
    };

    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6003,
      typeName: 'TST.TableStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        tableProperties: {
          strokePresetList: {
            count: 1,
            preset: [
              {
                visibleMask: 15,
                horizontalStroke: {
                  width: 2,
                  color: { r: 1, g: 0, b: 0, a: 1 }
                },
                verticalStroke: {
                  width: 3,
                  color: { r: 0, g: 1, b: 0, a: 1 }
                },
                exteriorStroke: {
                  width: 4,
                  color: { r: 0, g: 0, b: 1, a: 1 }
                }
              }
            ]
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    const firstCellBorders = table?.cells.find((cell) => cell.row === 0 && cell.column === 0)?.borders;
    expect(firstCellBorders?.top).toMatchObject({ width: 4, color: '#0000ff' });
    expect(firstCellBorders?.left).toMatchObject({ width: 4, color: '#0000ff' });
    expect(firstCellBorders?.right).toBeUndefined();
    expect(firstCellBorders?.bottom).toBeUndefined();
  });

  it('applies footer row cell and text styles to trailing rows', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4, 5],
      dataReferences: [],
      value: {
        tableName: 'Footer Style Table',
        numberOfColumns: 1,
        numberOfRows: 2,
        numberOfFooterRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        footerRowStyle: { identifier: 4 },
        footerRowTextStyle: { identifier: 5 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    const firstCell = createTextCellBuffer(1);
    const secondCell = createTextCellBuffer(2);

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: firstCell
          },
          {
            tileRowIndex: 1,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: secondCell
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Body'
          },
          {
            key: 2,
            string: 'Total'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          cellFill: {
            color: {
              r: 0.2,
              g: 0.4,
              b: 0.6,
              a: 1
            }
          }
        }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 20,
          fontName: 'Footer Font',
          fontColor: {
            r: 1,
            g: 1,
            b: 1,
            a: 1
          }
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    const bodyCell = table?.cells.find((cell) => cell.row === 0);
    const footerCell = table?.cells.find((cell) => cell.row === 1);
    expect(bodyCell?.fill.type).toBe('none');
    expect(footerCell?.fill).toMatchObject({
      type: 'solid',
      color: '#336699'
    });
    expect(footerCell?.textFrame.paragraphs[0]?.runs[0]).toMatchObject({
      text: 'Total',
      fontSize: 20,
      fontFamily: 'Footer Font',
      color: '#ffffff'
    });
  });

  it('maps table cell textWrap false to nowrap text frames', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4],
      dataReferences: [],
      value: {
        tableName: 'No Wrap Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        bodyCellStyle: { identifier: 4 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          stringTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            string: 'Long text should not wrap'
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          textWrap: false
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.wrap).toBe('none');
  });

  it('preserves nowrap on rich text table cell frames', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3, 4, 5, 6, 7],
      dataReferences: [],
      value: {
        tableName: 'Rich No Wrap Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        bodyCellStyle: { identifier: 7 },
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          richTextTable: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsets: createCellOffsets([0]),
            cellStorageBuffer: createTextCellBuffer(1)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [4],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 1,
            richTextPayload: { identifier: 4 }
          }
        ]
      }
    };

    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 6218,
      typeName: 'TST.RichTextPayloadArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        storage: { identifier: 5 }
      }
    };

    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Rich no wrap'],
        tableParaStyle: {
          entries: []
        },
        tableCharStyle: {
          entries: []
        }
      }
    };

    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 5,
      typeId: 6004,
      typeName: 'TST.CellStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        cellProperties: {
          textWrap: false
        }
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.wrap).toBe('none');
    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Rich no wrap');
  });

  it('formats Numbers percent cells from format tables', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Percent Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(0.256, 7)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 7,
            format: {
              formatType: 3,
              decimalPlaces: 1
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('25.6%');
  });

  it('formats Numbers currency cells from format tables', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Currency Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(1234.5, 8)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 8,
            format: {
              currencyCode: 'CNY',
              decimalPlaces: 2,
              showThousandsSeparator: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('\u00a51,234.50');
  });

  it('formats accounting negative Numbers currency cells with parentheses', () => {
    expect(
      renderSingleFormattedNumber(-1234.5, {
        currencyCode: 'USD',
        decimalPlaces: 2,
        showThousandsSeparator: true,
        useAccountingStyle: true
      })
    ).toBe('($1,234.50)');
  });

  it('formats explicit plus signs for positive Numbers percentages', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        formatType: 3,
        decimalPlaces: 1,
        usesPlusSign: true
      })
    ).toBe('+12.5%');
  });

  it('formats custom Numbers percent formats without duplicate percent signs', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0.0%'
      })
    ).toBe('12.5%');
  });

  it('rounds custom Numbers integer percent formats', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0%'
      })
    ).toBe('13%');
  });

  it('keeps escaped percent signs as custom number literals', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0\\%'
      })
    ).toBe('12%');
  });

  it('keeps quoted percent signs as custom number literals', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0 "%"'
      })
    ).toBe('12%');
  });

  it('keeps quoted percent literals when Numbers percent formats also scale values', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0% "complete %"'
      })
    ).toBe('13%complete %');
  });

  it('keeps escaped percent literals when Numbers percent formats also scale values', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0% \\%'
      })
    ).toBe('13%%');
  });

  it('ignores percent signs inside bracketed custom number markers', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '[$%-409]0'
      })
    ).toBe('%12');
  });

  it('formats custom Numbers permille formats without duplicate permille signs', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0.0\u2030'
      })
    ).toBe('125.0\u2030');
  });

  it('keeps escaped permille signs as custom number literals', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0\\\u2030'
      })
    ).toBe('12\u2030');
  });

  it('keeps quoted permille signs as custom number literals', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0 "\u2030"'
      })
    ).toBe('12\u2030');
  });

  it('keeps quoted permille literals when Numbers permille formats also scale values', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0\u2030 "rate \u2030"'
      })
    ).toBe('125\u2030rate \u2030');
  });

  it('ignores permille signs inside bracketed custom number markers', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '[$\u2030-409]0'
      })
    ).toBe('\u203012');
  });

  it('applies text sections from Numbers custom formats', () => {
    expect(
      renderSingleFormattedText('Done', {
        customFormatString: '0;-0;0;"status: "@'
      })
    ).toBe('status: Done');
  });

  it('keeps escaped at signs as literals in Numbers text format sections', () => {
    expect(
      renderSingleFormattedText('Done', {
        customFormatString: '0;-0;0;"mail "\\@ @'
      })
    ).toBe('mail @ Done');
  });

  it('treats General as the original value in Numbers text format sections', () => {
    expect(
      renderSingleFormattedText('Done', {
        customFormatString: '0;-0;0;"status: "General'
      })
    ).toBe('status: Done');
  });

  it('does not treat General inside words as a Numbers text placeholder', () => {
    expect(
      renderSingleFormattedText('Done', {
        customFormatString: '0;-0;0;"pre"myGeneralLabel'
      })
    ).toBe('premyGeneralLabel');
  });

  it('applies simple quoted suffixes from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12.5, {
        decimalPlaces: 1,
        customFormatString: '0.0 "kg"'
      })
    ).toBe('12.5kg');
  });

  it('keeps semicolons inside quoted custom number literals', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0 "a;b";-0;"zero"'
      })
    ).toBe('12a;b');
  });

  it('keeps escaped semicolons inside custom number literals', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0\\;;-0;"zero"'
      })
    ).toBe('12;');
  });

  it('applies simple quoted prefixes from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(4, {
        decimalPlaces: 0,
        customFormatString: '"Q" 0'
      })
    ).toBe('Q4');
  });

  it('treats General as the numeric value in Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12.5, {
        customFormatString: 'General "kg"'
      })
    ).toBe('12.5kg');
  });

  it('ignores quoted General literals when finding Numbers custom number placeholders', () => {
    expect(
      renderSingleFormattedNumber(12.5, {
        customFormatString: '"General" 0.0'
      })
    ).toBe('General12.5');
  });

  it('ignores digits in quoted prefixes when finding Numbers custom number placeholders', () => {
    expect(
      renderSingleFormattedNumber(12.5, {
        customFormatString: '"v2 "0.0'
      })
    ).toBe('v2 12.5');
  });

  it('ignores digits inside bracketed markers when finding Numbers custom number placeholders', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '[$$-409]#,##0'
      })
    ).toBe('$1,234');
  });

  it('ignores spacing placeholders in Numbers accounting-style custom number formats', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '_("$"* #,##0_)'
      })
    ).toBe('$1,234');
  });

  it('keeps negative accounting literals without rendering fill placeholders', () => {
    expect(
      renderSingleFormattedNumber(-1234, {
        customFormatString: '_("$"* #,##0_);_("$"* (#,##0)_)'
      })
    ).toBe('$(1,234)');
  });

  it('keeps currency markers from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '[$\u00a5-804]#,##0'
      })
    ).toBe('\u00a51,234');
  });

  it('keeps dollar currency markers from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '[$$-409]#,##0'
      })
    ).toBe('$1,234');
  });

  it('keeps leading literals before Numbers custom currency markers', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '"pre"[$\u00a5-804]#,##0'
      })
    ).toBe('pre\u00a51,234');
  });

  it('does not misread General-prefixed words before Numbers custom currency markers', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        currencyCode: 'USD',
        customFormatString: '"GeneralStore"[$\u00a5-804]0'
      })
    ).toBe('GeneralStore\u00a51234');
  });

  it('keeps trailing custom currency markers after Numbers placeholders', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '0[$\u00a5-804]'
      })
    ).toBe('1234\u00a5');
  });

  it('infers decimal places from simple Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12.345, {
        customFormatString: '0.00 "kg"'
      })
    ).toBe('12.35kg');
  });

  it('ignores escaped placeholders when inferring Numbers custom decimal places', () => {
    expect(
      renderSingleFormattedNumber(12.345, {
        customFormatString: '\\0 0.0'
      })
    ).toBe('012.3');
  });

  it('ignores quoted placeholders when inferring Numbers custom decimal places', () => {
    expect(
      renderSingleFormattedNumber(12.345, {
        customFormatString: '"v2.00 "0.0'
      })
    ).toBe('v2.00 12.3');
  });

  it('trims optional decimal placeholders from simple Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12.5, {
        customFormatString: '0.##'
      })
    ).toBe('12.5');
  });

  it('keeps required decimal placeholders from mixed custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '0.0#'
      })
    ).toBe('12.0');
  });

  it('pads integer question mark placeholders from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(4, {
        customFormatString: '??0'
      })
    ).toBe('  4');
  });

  it('pads decimal question mark placeholders from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12.5, {
        customFormatString: '0.0?'
      })
    ).toBe('12.5 ');
  });

  it('blanks zero integer sections for optional Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0, {
        customFormatString: '#'
      })
    ).toBe('');
  });

  it('infers thousands separators from simple Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '#,##0'
      })
    ).toBe('1,234');
  });

  it('ignores bracketed digits when inferring Numbers custom thousands separators', () => {
    expect(
      renderSingleFormattedNumber(1234, {
        customFormatString: '[$$-409]0'
      })
    ).toBe('$1234');
  });

  it('scales Numbers custom number formats with trailing commas', () => {
    expect(
      renderSingleFormattedNumber(1234567, {
        customFormatString: '#,##0, "K"'
      })
    ).toBe('1,235K');
  });

  it('scales Numbers custom number formats with multiple trailing commas', () => {
    expect(
      renderSingleFormattedNumber(1234567, {
        customFormatString: '0.0,, "M"'
      })
    ).toBe('1.2M');
  });

  it('uses negative sections from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(-12, {
        customFormatString: '0;(0)'
      })
    ).toBe('(12)');
  });

  it('keeps semicolons inside bracketed custom number conditions', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '[>=1;foo]0;-0;"zero"'
      })
    ).toBe('12');
  });

  it('ignores quoted condition-looking literals in Numbers custom number sections', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '"[<0]"0;0'
      })
    ).toBe('[<0]12');
  });

  it('keeps real Numbers custom number conditions when quoted literals are also present', () => {
    expect(
      renderSingleFormattedNumber(-12, {
        customFormatString: '"[note]"[<0](0);0'
      })
    ).toBe('[note](12)');
  });

  it('still splits custom number sections after bracketed color markers', () => {
    expect(
      renderSingleFormattedNumber(-12, {
        customFormatString: '[Green]0;[Red](0)'
      })
    ).toBe('(12)');
  });

  it('uses zero sections from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0, {
        customFormatString: '0;-0;"-"'
      })
    ).toBe('-');
  });

  it('uses conditional sections from Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(125, {
        customFormatString: '[>=100]0 "large";[<100]0 "small"'
      })
    ).toBe('125large');

    expect(
      renderSingleFormattedNumber(25, {
        customFormatString: '[>=100]0 "large";[<100]0 "small"'
      })
    ).toBe('25small');
  });

  it('falls back to unconditioned sections when Numbers custom number conditions do not match', () => {
    expect(
      renderSingleFormattedNumber(12, {
        customFormatString: '[Red][<0](0);0 "ok"'
      })
    ).toBe('12ok');
  });

  it('supports not-equal conditions in Numbers custom number formats', () => {
    expect(
      renderSingleFormattedNumber(3, {
        customFormatString: '[<>0]0 "items";"none"'
      })
    ).toBe('3items');
  });

  it('formats simple Numbers scientific custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12345, {
        customFormatString: '0.00E+00'
      })
    ).toBe('1.23E+04');
  });

  it('formats optional decimals in Numbers scientific custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0.012, {
        customFormatString: '0.##E+0'
      })
    ).toBe('1.2E-2');
  });

  it('keeps simple literals around Numbers scientific custom number formats', () => {
    expect(
      renderSingleFormattedNumber(12345, {
        customFormatString: '"~"0.0E+0 "mol"'
      })
    ).toBe('~1.2E+4mol');
  });

  it('ignores quoted scientific-looking literals before real Numbers scientific formats', () => {
    expect(
      renderSingleFormattedNumber(12345, {
        customFormatString: '"0.000E+00 "0.0E+0'
      })
    ).toBe('0.000E+00 1.2E+4');
  });

  it('ignores bracketed markers before real Numbers scientific formats', () => {
    expect(
      renderSingleFormattedNumber(12345, {
        customFormatString: '[Red]0.0E+0'
      })
    ).toBe('1.2E+4');
  });

  it('keeps trailing custom currency markers in Numbers scientific formats', () => {
    expect(
      renderSingleFormattedNumber(12345, {
        customFormatString: '0.0E+0[$\u00a5-804]'
      })
    ).toBe('1.2E+4\u00a5');
  });

  it('does not duplicate currency prefixes for Numbers scientific custom currency markers', () => {
    expect(
      renderSingleFormattedNumber(12345, {
        currencyCode: 'USD',
        customFormatString: '0.0E+0[$\u00a5-804]'
      })
    ).toBe('1.2E+4\u00a5');
  });

  it('formats Numbers scientific percent formats without duplicate percent signs', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0.0E+0%'
      })
    ).toBe('1.3E+1%');
  });

  it('keeps quoted percent literals in Numbers scientific percent formats', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0.0E+0% "scaled %"'
      })
    ).toBe('1.3E+1%scaled %');
  });

  it('formats Numbers scientific permille formats without duplicate permille signs', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0.0E+0\u2030'
      })
    ).toBe('1.3E+2\u2030');
  });

  it('keeps quoted permille literals in Numbers scientific permille formats', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '0.0E+0\u2030 "scaled \u2030"'
      })
    ).toBe('1.3E+2\u2030scaled \u2030');
  });

  it('uses negative sections for Numbers scientific custom number formats', () => {
    expect(
      renderSingleFormattedNumber(-12345, {
        customFormatString: '0.0E+0;(0.0E+0)'
      })
    ).toBe('(1.2E+4)');
  });

  it('formats simple Numbers fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0.5, {
        customFormatString: '?/?'
      })
    ).toBe('1/2');
  });

  it('ignores quoted fraction-looking literals before real Numbers fraction formats', () => {
    expect(
      renderSingleFormattedNumber(0.5, {
        customFormatString: '"1/2 " ?/?'
      })
    ).toBe('1/2 1/2');
  });

  it('ignores bracketed markers before real Numbers fraction formats', () => {
    expect(
      renderSingleFormattedNumber(0.5, {
        customFormatString: '[Blue]?/?'
      })
    ).toBe('1/2');
  });

  it('keeps trailing custom currency markers in Numbers fraction formats', () => {
    expect(
      renderSingleFormattedNumber(0.5, {
        customFormatString: '?/?[$\u00a5-804]'
      })
    ).toBe('1/2\u00a5');
  });

  it('does not duplicate currency prefixes for Numbers fraction custom currency markers', () => {
    expect(
      renderSingleFormattedNumber(0.5, {
        currencyCode: 'USD',
        customFormatString: '?/?[$\u00a5-804]'
      })
    ).toBe('1/2\u00a5');
  });

  it('formats Numbers fraction percent formats without duplicate percent signs', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '?/?%'
      })
    ).toBe('25/2%');
  });

  it('keeps quoted percent literals in Numbers fraction percent formats', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '?/?% "ratio %"'
      })
    ).toBe('25/2%ratio %');
  });

  it('formats Numbers fraction permille formats without duplicate permille signs', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '?/?\u2030'
      })
    ).toBe('125/1\u2030');
  });

  it('keeps quoted permille literals in Numbers fraction permille formats', () => {
    expect(
      renderSingleFormattedNumber(0.125, {
        customFormatString: '?/?\u2030 "ratio \u2030"'
      })
    ).toBe('125/1\u2030ratio \u2030');
  });

  it('formats mixed Numbers fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(1.25, {
        customFormatString: '# ?/?'
      })
    ).toBe('1 1/4');
  });

  it('uses negative sections for Numbers fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(-1.25, {
        customFormatString: '# ?/?;(# ?/?)'
      })
    ).toBe('(1 1/4)');
  });

  it('formats fixed denominator Numbers fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0.5, {
        customFormatString: '?/8'
      })
    ).toBe('4/8');
  });

  it('formats mixed fixed denominator Numbers fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(1.25, {
        customFormatString: '# ??/16'
      })
    ).toBe('1  4/16');
  });

  it('carries rounded fixed denominator Numbers fractions into the whole part', () => {
    expect(
      renderSingleFormattedNumber(1.99, {
        customFormatString: '# ?/8'
      })
    ).toBe('2');
  });

  it('pads numerator placeholders in Numbers fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0.25, {
        customFormatString: '??/??'
      })
    ).toBe(' 1/ 4');
  });

  it('keeps blank whole placeholders in Numbers mixed fraction custom number formats', () => {
    expect(
      renderSingleFormattedNumber(0.25, {
        customFormatString: '? ??/??'
      })
    ).toBe('   1/ 4');
  });

  it('formats Numbers elapsed hour duration formats', () => {
    expect(
      renderSingleFormattedNumber(1.5, {
        dateTimeFormat: '[h]:mm:ss'
      })
    ).toBe('36:00:00');
  });

  it('formats Numbers elapsed minute duration formats', () => {
    expect(
      renderSingleFormattedNumber(1 / 24 + 30 / 24 / 60 + 5 / 24 / 60 / 60, {
        dateTimeFormat: '[m]:ss'
      })
    ).toBe('90:05');
  });

  it('formats Numbers elapsed day duration formats', () => {
    expect(
      renderSingleFormattedNumber(2.25, {
        dateTimeFormat: '[d] "days" hh:mm'
      })
    ).toBe('2 days 06:00');
  });

  it('pads Numbers elapsed day duration formats', () => {
    expect(
      renderSingleFormattedNumber(2.25, {
        dateTimeFormat: '[dd]:hh:mm:ss'
      })
    ).toBe('02:06:00:00');
  });

  it('formats Numbers fractional second duration formats', () => {
    expect(
      renderSingleFormattedNumber(1 / 24 + 30 / 24 / 60 + 5 / 24 / 60 / 60 + 678 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: '[h]:mm:ss.000'
      })
    ).toBe('1:30:05.678');
  });

  it('formats Numbers elapsed second fractional duration formats', () => {
    expect(
      renderSingleFormattedNumber(5 / 24 / 60 / 60 + 678 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: '[s].00'
      })
    ).toBe('5.67');
  });

  it('formats ICU-style fractional second duration formats', () => {
    expect(
      renderSingleFormattedNumber(5 / 24 / 60 / 60 + 678 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: '[s].SSS'
      })
    ).toBe('5.678');
  });

  it('keeps sign and literals for Numbers elapsed duration formats', () => {
    expect(
      renderSingleFormattedNumber(-1.25, {
        dateTimeFormat: '"elapsed "[h]" hours"'
      })
    ).toBe('-elapsed 30 hours');
  });

  it('keeps ICU-style quoted literals for Numbers elapsed duration formats', () => {
    expect(
      renderSingleFormattedNumber(1.25, {
        dateTimeFormat: "'elapsed' [h] 'hours'"
      })
    ).toBe('elapsed 30 hours');
  });

  it('does not treat quoted elapsed tokens as Numbers duration formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '"[h]" mmm d',
        suppressTimeFormat: true
      })
    ).toBe('[h] Feb 1');
  });

  it('does not treat escaped elapsed tokens as Numbers duration formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '\\[h\\] mmm d',
        suppressTimeFormat: true
      })
    ).toBe('[h] Feb 1');
  });

  it('formats Numbers boolean values from custom boolean strings', () => {
    expect(
      renderSingleFormattedNumber(1, {
        boolTrueString: '\u662f',
        boolFalseString: '\u5426'
      })
    ).toBe('\u662f');

    expect(
      renderSingleFormattedNumber(0, {
        boolTrueString: '\u662f',
        boolFalseString: '\u5426'
      })
    ).toBe('\u5426');
  });

  it('falls back for missing Numbers boolean labels', () => {
    expect(
      renderSingleFormattedNumber(0, {
        boolTrueString: 'Done'
      })
    ).toBe('FALSE');
  });

  it('formats Numbers date cells from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Date Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44927, 9)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 9,
            format: {
              dateTimeFormat: 'yyyy/mm/dd',
              suppressTimeFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('2023/01/01');
  });

  it('keeps common Numbers date token order when formatting dates', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Ordered Date Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44927, 11)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 11,
            format: {
              dateTimeFormat: 'dd/mm/yyyy',
              suppressTimeFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('01/01/2023');
  });

  it('formats Numbers short month names from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Short Month Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44958, 14)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 14,
            format: {
              dateTimeFormat: 'mmm d, yyyy',
              suppressTimeFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Feb 1, 2023');
  });

  it('formats Numbers long month names from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Long Month Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44958, 15)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 15,
            format: {
              dateTimeFormat: 'mmmm d, yyyy',
              suppressTimeFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('February 1, 2023');
  });

  it('formats Numbers short weekday names from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Short Weekday Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44958, 16)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 16,
            format: {
              dateTimeFormat: 'ddd, mmm d',
              suppressTimeFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Wed, Feb 1');
  });

  it('formats Numbers long weekday names from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Long Weekday Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44958, 17)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 17,
            format: {
              dateTimeFormat: 'dddd, mmmm d, yyyy',
              suppressTimeFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Wednesday, February 1, 2023');
  });

  it('strips locale markers from Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '[$-409]mmm d, yyyy',
        suppressTimeFormat: true
      })
    ).toBe('Feb 1, 2023');
  });

  it('strips calendar locale markers from Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '[$en-US-409]dddd, mmmm d',
        suppressTimeFormat: true
      })
    ).toBe('Wednesday, February 1');
  });

  it('keeps quoted locale-looking literals in Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '"[$-409]" mmm d',
        suppressTimeFormat: true
      })
    ).toBe('[$-409] Feb 1');
  });

  it('keeps escaped locale-looking literals in Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '\\[$-409\\] mmm d',
        suppressTimeFormat: true
      })
    ).toBe('[$-409] Feb 1');
  });

  it('formats Numbers single-letter month date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'mmmmm d, yyyy',
        suppressTimeFormat: true
      })
    ).toBe('F 1, 2023');
  });

  it('formats Numbers quarter date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: '"Q"q yyyy',
        suppressTimeFormat: true
      })
    ).toBe('Q1 2023');
  });

  it('pads Numbers quarter date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(45048, {
        dateTimeFormat: 'yyyy-"Q"qq',
        suppressTimeFormat: true
      })
    ).toBe('2023-Q02');
  });

  it('formats ICU-style quarter Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(45048, {
        dateTimeFormat: 'QQQ YYYY',
        suppressTimeFormat: true
      })
    ).toBe('Q2 2023');
  });

  it('formats ICU-style long quarter Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(45048, {
        dateTimeFormat: 'QQQQ YYYY',
        suppressTimeFormat: true
      })
    ).toBe('Quarter 2 2023');
  });

  it('formats ICU-style uppercase Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'MMM d, YYYY',
        suppressTimeFormat: true
      })
    ).toBe('Feb 1, 2023');
  });

  it('formats ICU-style weekday Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'EEEE, MMMM D',
        suppressTimeFormat: true
      })
    ).toBe('Wednesday, February 32');
  });

  it('formats ICU-style standalone month Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'LLLL D, YYYY',
        suppressTimeFormat: true
      })
    ).toBe('February 32, 2023');
  });

  it('formats ICU-style numeric standalone month Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'LL/d/YYYY',
        suppressTimeFormat: true
      })
    ).toBe('02/1/2023');
  });

  it('formats ICU-style narrow weekday Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'EEEEE, LLL D',
        suppressTimeFormat: true
      })
    ).toBe('W, Feb 32');
  });

  it('formats ICU-style day-of-year Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'YYYY-DDD',
        suppressTimeFormat: true
      })
    ).toBe('2023-032');
  });

  it('keeps lowercase day-of-month distinct from ICU day-of-year tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'YYYY-MM-dd',
        suppressTimeFormat: true
      })
    ).toBe('2023-02-01');
  });

  it('formats ICU-style week-of-year Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'YYYY-"W"ww',
        suppressTimeFormat: true
      })
    ).toBe('2023-W05');
  });

  it('formats unpadded ICU-style week-of-year Numbers date-time tokens', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'w',
        suppressTimeFormat: true
      })
    ).toBe('5');
  });

  it('keeps quoted literals in Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'yyyy "\u5e74" m "\u6708" d "\u65e5"',
        suppressTimeFormat: true
      })
    ).toBe('2023 \u5e74 2 \u6708 1 \u65e5');
  });

  it('keeps escaped literals in Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: 'yyyy\\\u5e74m\\\u6708d\\\u65e5',
        suppressTimeFormat: true
      })
    ).toBe('2023\u5e742\u67081\u65e5');
  });

  it('keeps ICU-style quoted literals in Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44958, {
        dateTimeFormat: "YYYY 'Q'Q",
        suppressTimeFormat: true
      })
    ).toBe('2023 Q1');
  });

  it('keeps escaped apostrophes in ICU-style Numbers date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44927.5625, {
        dateTimeFormat: "h 'o''clock' a",
        suppressDateFormat: true
      })
    ).toBe("1 o'clock PM");
  });

  it('formats Numbers time cells from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Time Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44927.5, 10)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 10,
            format: {
              dateTimeFormat: 'hh:mm:ss',
              suppressDateFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('12:00:00');
  });

  it('formats Numbers millisecond time cells from explicit date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44927.5 + 789 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: 'hh:mm:ss.000',
        suppressDateFormat: true
      })
    ).toBe('12:00:00.789');
  });

  it('formats Numbers single-digit fractional second time cells', () => {
    expect(
      renderSingleFormattedNumber(44927.5 + 789 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: 'h:mm:ss.0',
        suppressDateFormat: true
      })
    ).toBe('12:00:00.7');
  });

  it('formats ICU-style fractional second time cells', () => {
    expect(
      renderSingleFormattedNumber(44927.5 + 789 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: 'HH:mm:ss.SSS',
        suppressDateFormat: true
      })
    ).toBe('12:00:00.789');
  });

  it('formats short ICU-style fractional second time cells', () => {
    expect(
      renderSingleFormattedNumber(44927.5 + 789 / 24 / 60 / 60 / 1000, {
        dateTimeFormat: 'HH:mm:ss.S',
        suppressDateFormat: true
      })
    ).toBe('12:00:00.7');
  });

  it('formats Numbers AM/PM time cells from explicit date-time formats', () => {
    const archive = createNumbersArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 6001,
      typeName: 'TST.TableModelArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        tableName: 'Meridiem Time Table',
        numberOfColumns: 1,
        numberOfRows: 1,
        defaultColumnWidth: 72,
        defaultRowHeight: 22,
        baseDataStore: {
          tiles: {
            tiles: [
              {
                tile: { identifier: 2 }
              }
            ]
          },
          formatTablePreBnc: { identifier: 3 }
        }
      }
    };

    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 6002,
      typeName: 'TST.Tile',
      objectReferences: [],
      dataReferences: [],
      value: {
        rowInfos: [
          {
            tileRowIndex: 0,
            cellCount: 1,
            cellOffsetsPreBnc: createCellOffsets([0]),
            cellStorageBufferPreBnc: createPreBncNumberCellBuffer(44927.5625, 13)
          }
        ]
      }
    };

    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 6005,
      typeName: 'TST.TableDataList',
      objectReferences: [],
      dataReferences: [],
      value: {
        entries: [
          {
            key: 13,
            format: {
              dateTimeFormat: 'h:mm AM/PM',
              suppressDateFormat: true
            }
          }
        ]
      }
    };

    const table = buildTableItem(
      archive,
      {
        tableModel: { identifier: 1 }
      },
      {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      0
    );

    expect(table?.cells[0]?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('1:30 PM');
  });

  it('formats ICU-style meridiem time cells from explicit date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44927.5625, {
        dateTimeFormat: 'h:mm a',
        suppressDateFormat: true
      })
    ).toBe('1:30 PM');
  });

  it('formats narrow ICU-style meridiem time cells from explicit date-time formats', () => {
    expect(
      renderSingleFormattedNumber(44927.5625, {
        dateTimeFormat: 'h:mm aaaaa',
        suppressDateFormat: true
      })
    ).toBe('1:30 p');
  });
});
