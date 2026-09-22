import { describe, expect, it } from 'vitest';
import { buildTextFrameFromStorage } from '../src/parser/helpers';
import { buildParsedDocument } from '../src/parser/semantic';
import type { IworkArchiveIndex, IworkImageAsset } from '../src/types';

function createEmptyArchive(): IworkArchiveIndex {
  return {
    type: 'key',
    records: {},
    references: {
      outgoing: {},
      incoming: {}
    },
    dataEntries: {},
    warnings: []
  };
}

describe('keynote semantic builder', () => {
  it('includes template placeholders and visible slide numbers in rendered slides', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 },
        isSlideNumberVisible: true
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [20, 11],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        templateSlide: { identifier: 20 },
        drawablesZOrder: [{ identifier: 11 }],
        ownedDrawables: [{ identifier: 11 }],
        titlePlaceholder: { identifier: 12 },
        slideNumberPlaceholder: { identifier: 13 }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 4,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [12],
      dataReferences: [],
      value: {
        style: { identifier: 51 },
        drawablesZOrder: [{ identifier: 12 }],
        ownedDrawables: [{ identifier: 12 }],
        titlePlaceholder: { identifier: 12 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 7,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [101, 201],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 260 },
              size: { width: 500, height: 120 },
              angle: 0
            }
          },
          style: { identifier: 101 },
          ownedStorage: { identifier: 201 }
        }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 8,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [102, 202],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 100, y: 80 },
                size: { width: 640, height: 140 },
                angle: 0
              }
            },
            style: { identifier: 102 }
          },
          ownedStorage: { identifier: 202 },
          isTextBox: true
        },
        kind: 2
      }
    };
    archive.records['13'] = {
      id: 13,
      archiveId: 1,
      messageIndex: 9,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [103, 203],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 900, y: 700 },
                size: { width: 0, height: 0 },
                angle: 0
              }
            },
            style: { identifier: 103 }
          },
          ownedStorage: { identifier: 203 },
          isTextBox: true
        },
        kind: 1
      }
    };

    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 10,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['102'] = {
      id: 102,
      archiveId: 1,
      messageIndex: 11,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['103'] = {
      id: 103,
      archiveId: 1,
      messageIndex: 12,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };

    archive.records['201'] = {
      id: 201,
      archiveId: 1,
      messageIndex: 13,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Body text']
      }
    };
    archive.records['202'] = {
      id: 202,
      archiveId: 1,
      messageIndex: 14,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Template title']
      }
    };
    archive.records['203'] = {
      id: 203,
      archiveId: 1,
      messageIndex: 15,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [204],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 204 }
            }
          ]
        }
      }
    };
    archive.records['204'] = {
      id: 204,
      archiveId: 1,
      messageIndex: 16,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          stringEquivalent: '',
          kind: 0
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    expect(document.slides).toHaveLength(1);
    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(' | '));

    expect(texts).toContain('Template title');
    expect(texts).toContain('Body text');
    expect(texts).toContain('1');

    const slideNumberItem = document.slides[0].slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === '1'))
    );
    expect(slideNumberItem?.transform.width).toBeGreaterThan(0);
    expect(slideNumberItem?.transform.height).toBeGreaterThan(0);
  });

  it('reads snake_case Keynote show tree and slide-number visibility fields', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slide_tree: { slides: [{ identifier: 3 }] },
        slide_numbers_visible: false,
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 },
        is_slide_number_visible: true
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [13],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        slide_number_placeholder: { identifier: 13 }
      }
    };
    archive.records['13'] = {
      id: 13,
      archiveId: 1,
      messageIndex: 4,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [103, 203],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 900, y: 700 },
                size: { width: 0, height: 0 },
                angle: 0
              }
            },
            style: { identifier: 103 }
          },
          ownedStorage: { identifier: 203 },
          isTextBox: true
        },
        kind: 1
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['103'] = {
      id: 103,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['203'] = {
      id: 203,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [204],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 204 }
            }
          ]
        }
      }
    };
    archive.records['204'] = {
      id: 204,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          stringEquivalent: '',
          kind: 0
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    expect(document.slides).toHaveLength(1);
    const slideNumberItem = document.slides[0].slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === '1'))
    );
    expect(slideNumberItem?.transform.width).toBeGreaterThan(0);
    expect(slideNumberItem?.transform.height).toBeGreaterThan(0);
  });

  it('includes Keynote placeholders listed in aggregate placeholder fields', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        placeholderDrawables: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [51, 101],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 80, y: 120 },
                size: { width: 640, height: 90 },
                angle: 0
              }
            },
            style: { identifier: 51 }
          },
          ownedStorage: { identifier: 101 },
          isTextBox: true
        },
        kind: 3
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Agenda placeholder']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('Agenda placeholder');
  });

  it('inherits Keynote slide background from template slides when local fill is empty', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [20, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        templateSlide: { identifier: 20 }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 4,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [51],
      dataReferences: [],
      value: {
        style: { identifier: 51 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {}
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    expect(document.slides[0].slide.background).toMatchObject({
      type: 'solid',
      color: '#3366cc',
      alpha: 1
    });
  });

  it('inherits Keynote drawable fill from parent shape style properties', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }],
        ownedDrawables: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [101, 201],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 180 },
              size: { width: 220, height: 100 },
              angle: 0
            }
          },
          style: { identifier: 101 },
          ownedStorage: { identifier: 201 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['100'] = {
      id: 100,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          shapeProperties: {
            fill: {
              color: { r: 0.2, g: 0.6, b: 1, a: 1 }
            },
            stroke: {
              color: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
              width: 2
            },
            opacity: 0.75
          }
        },
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          parent: { identifier: 100 }
        },
        shapeProperties: {
          padding: { left: 4, top: 4, right: 4, bottom: 4 }
        }
      }
    };
    archive.records['201'] = {
      id: 201,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Styled shape']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0]?.slide.items.find((item) => item.kind === 'shape');
    expect(shape?.kind).toBe('shape');
    if (!shape || shape.kind !== 'shape') {
      return;
    }

    expect(shape.fill).toMatchObject({
      type: 'solid',
      color: '#3399ff',
      alpha: 1
    });
    expect(shape.line).toMatchObject({
      color: '#1a334d',
      width: 2
    });
    expect(shape.opacity).toBe(0.75);
  });

  it('deduplicates shared Keynote drawables across template slide inheritance', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [20, 11],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        templateSlide: { identifier: 20 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 4,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11],
      dataReferences: [],
      value: {
        style: { identifier: 51 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 5,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60, 61],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 260 },
              size: { width: 500, height: 120 },
              angle: 0
            }
          },
          style: { identifier: 60 },
          ownedStorage: { identifier: 61 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {}
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 7,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {}
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['61'] = {
      id: 61,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Shared drawable']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const sharedItems = document.slides[0].slide.items.filter(
      (item) =>
        'textFrame' in item &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Shared drawable'))
    );
    expect(sharedItems).toHaveLength(1);
  });

  it('hides Keynote placeholders when slide style visibility disables them', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 },
        isSlideNumberVisible: true
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [50, 11, 12],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        titlePlaceholder: { identifier: 11 },
        slideNumberPlaceholder: { identifier: 12 }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [51, 101],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 80, y: 120 },
                size: { width: 640, height: 90 },
                angle: 0
              }
            },
            style: { identifier: 51 }
          },
          ownedStorage: { identifier: 101 },
          isTextBox: true
        },
        kind: 2
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 5,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [52, 102],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 900, y: 700 },
                size: { width: 60, height: 30 },
                angle: 0
              }
            },
            style: { identifier: 52 }
          },
          ownedStorage: { identifier: 102 },
          isTextBox: true
        },
        kind: 1
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          },
          titlePlaceholderVisibility: false,
          slideNumberPlaceholderVisibility: false
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['52'] = {
      id: 52,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Hidden title']
      }
    };
    archive.records['102'] = {
      id: 102,
      archiveId: 1,
      messageIndex: 10,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['1']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).not.toContain('Hidden title');
    expect(texts).not.toContain('1');
  });

  it('uses show-level Keynote slide number visibility when slide nodes do not override it', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 },
        slideNumbersVisible: true
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [12, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        slideNumberPlaceholder: { identifier: 12 }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 4,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [52, 102],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 900, y: 700 },
                size: { width: 60, height: 30 },
                angle: 0
              }
            },
            style: { identifier: 52 }
          },
          ownedStorage: { identifier: 102 },
          isTextBox: true
        },
        kind: 1
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['52'] = {
      id: 52,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['102'] = {
      id: 102,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['1']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('1');
  });

  it('falls back to Keynote thumbnail placeholder text when placeholder storage is missing', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        titlePlaceholder: { identifier: 11 },
        thumbnailTextForTitlePlaceholder: 'Title fallback text'
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [51],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 80, y: 120 },
                size: { width: 640, height: 90 },
                angle: 0
              }
            },
            style: { identifier: 51 }
          },
          isTextBox: true
        },
        kind: 2
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('Title fallback text');
  });

  it('falls back to Keynote instructional text when drawable storage is missing', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }],
        instructionalTextMap: {
          instructionalTextForInfos: [
            {
              info: { identifier: 11 },
              instructionalText: 'Instructional fallback text'
            }
          ]
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [51],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 260 },
              size: { width: 500, height: 120 },
              angle: 0
            }
          },
          style: { identifier: 51 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('Instructional fallback text');
  });

  it('reads snake_case Keynote instructional text fallback fields', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawables_z_order: [{ identifier: 11 }],
        instructional_text_map: {
          instructional_text_for_infos: [
            {
              info: { identifier: 11 },
              instructional_text: 'Snake instructional text'
            }
          ]
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [51],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 260 },
              size: { width: 500, height: 120 },
              angle: 0
            }
          },
          style: { identifier: 51 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('Snake instructional text');
  });

  it('renders Keynote infos linked through object placeholder geometry refs', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [12, 11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        objectPlaceholder: { identifier: 12 },
        infoUsingObjectPlaceholderGeometry: { identifier: 11 }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [51, 101],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 140, y: 220 },
              size: { width: 420, height: 90 },
              angle: 0
            }
          },
          style: { identifier: 51 },
          ownedStorage: { identifier: 101 }
        }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 5,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [52],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 120, y: 180 },
                size: { width: 480, height: 140 },
                angle: 0
              }
            },
            style: { identifier: 52 }
          },
          isTextBox: true
        },
        kind: 4
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['52'] = {
      id: 52,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Object placeholder linked text']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('Object placeholder linked text');
  });

  it('falls back to Keynote sage tag info refs for object placeholders', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [12, 11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        objectPlaceholder: { identifier: 12 },
        sageTagToInfoMap: [
          {
            tag: 'object',
            info: { identifier: 11 }
          }
        ]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [51, 101],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 140, y: 220 },
              size: { width: 420, height: 90 },
              angle: 0
            }
          },
          style: { identifier: 51 },
          ownedStorage: { identifier: 101 }
        }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 5,
      typeId: 7,
      typeName: 'KN.PlaceholderArchive',
      objectReferences: [52],
      dataReferences: [],
      value: {
        super: {
          super: {
            super: {
              geometry: {
                position: { x: 120, y: 180 },
                size: { width: 480, height: 140 },
                angle: 0
              }
            },
            style: { identifier: 52 }
          },
          isTextBox: true
        },
        kind: 4
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['52'] = {
      id: 52,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          verticalAlignment: 0
        }
      }
    };
    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Sage tag linked text']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const texts = document.slides[0].slide.items
      .filter((item) => 'textFrame' in item && item.textFrame)
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(texts).toContain('Sage tag linked text');
  });

  it('builds synthetic Keynote placeholder items from slide geometry fields when placeholder records are absent', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 },
        isSlideNumberVisible: true
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        titlePlaceholderGeometry: {
          position: { x: 100, y: 80 },
          size: { width: 640, height: 120 },
          angle: 0
        },
        titleLayoutProperties: {
          padding: { top: 8, right: 10, bottom: 8, left: 10 },
          verticalAlignment: 0
        },
        slideNumberPlaceholderGeometry: {
          position: { x: 900, y: 700 },
          size: { width: 40, height: 24 },
          angle: 0
        },
        slideNumberLayoutProperties: {
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          verticalAlignment: 0
        },
        thumbnailTextForTitlePlaceholder: 'Geometry title fallback'
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 4,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const textItems = document.slides[0].slide.items.filter(
      (item): item is Extract<(typeof document.slides)[0]['slide']['items'][number], { kind: 'text' }> =>
        item.kind === 'text'
    );
    const texts = textItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('')
    );

    expect(texts).toContain('Geometry title fallback');
    expect(texts).toContain('1');

    const syntheticTitle = textItems.find((item) =>
      item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Geometry title fallback'))
    );
    expect(syntheticTitle?.transform.width).toBe(640);
    expect(syntheticTitle?.placeholder).toMatchObject({ type: 'title' });
  });

  it('resolves Keynote image drawables from imageData aliases', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '90': {
        id: '90',
        path: 'Data/photo.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3007,
      typeName: 'TSD.ImageArchive',
      objectReferences: [],
      dataReferences: [90],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            }
          }
        },
        imageData: { identifier: 90 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const image = document.slides[0].slide.items.find((item) => item.kind === 'image');
    expect(image).toMatchObject({
      mediaId: '90',
      name: 'Data/photo.png'
    });
  });

  it('falls back to drawable dataReferences when media fields are absent', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '90': {
        id: '90',
        path: 'Data/fallback-photo.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3005,
      typeName: 'TSD.ImageArchive',
      objectReferences: [],
      dataReferences: [90],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 40, y: 50 },
              size: { width: 120, height: 80 },
              angle: 0
            }
          }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const image = document.slides[0].slide.items.find((item) => item.kind === 'image');
    expect(image).toMatchObject({
      mediaId: '90',
      name: 'Data/fallback-photo.png'
    });
  });

  it('uses database-backed image aliases when direct media fields are absent', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '92': {
        id: '92',
        path: 'Data/database-photo.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      },
      '93': {
        id: '93',
        path: 'Data/database-photo-thumb.png',
        contentType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3005,
      typeName: 'TSD.ImageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 40, y: 50 },
              size: { width: 120, height: 80 },
              angle: 0
            }
          }
        },
        databaseData: { identifier: 92 },
        databaseThumbnailData: { identifier: 93 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const image = document.slides[0].slide.items.find((item) => item.kind === 'image');
    expect(image).toMatchObject({
      mediaId: '92',
      name: 'Data/database-photo.png'
    });
  });

  it('preserves drawable hyperlink urls on rendered image items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '90': {
        id: '90',
        path: 'Data/link-photo.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3005,
      typeName: 'TSD.ImageArchive',
      objectReferences: [],
      dataReferences: [90],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            },
            hyperlinkUrl: 'https://example.com/pptx-previewer/iwork-image'
          }
        },
        imageData: { identifier: 90 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const image = document.slides[0].slide.items.find((item) => item.kind === 'image');
    expect(image).toMatchObject({
      mediaId: '90',
      href: 'https://example.com/pptx-previewer/iwork-image',
      name: 'Data/link-photo.png'
    });
  });

  it('reads snake_case drawable hyperlink urls on rendered image items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '90': {
        id: '90',
        path: 'Data/link-photo.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawables_z_order: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3005,
      typeName: 'TSD.ImageArchive',
      objectReferences: [],
      dataReferences: [90],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            },
            hyperlink_url: 'https://example.com/pptx-previewer/iwork-image'
          }
        },
        image_data: { identifier: 90 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const image = document.slides[0].slide.items.find((item) => item.kind === 'image');
    expect(image).toMatchObject({
      mediaId: '90',
      href: 'https://example.com/pptx-previewer/iwork-image',
      name: 'Data/link-photo.png'
    });
  });

  it('maps media style opacity onto rendered image items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '90': {
        id: '90',
        path: 'Data/opacity-photo.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3005,
      typeName: 'TSD.ImageArchive',
      objectReferences: [60],
      dataReferences: [90],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        },
        imageData: { identifier: 90 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2026,
      typeName: 'TSD.MediaStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        mediaProperties: {
          opacity: 0.72
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const image = document.slides[0].slide.items.find((item) => item.kind === 'image');
    expect(image).toMatchObject({
      mediaId: '90',
      opacity: 0.72,
      name: 'Data/opacity-photo.png'
    });
  });

  it('maps Keynote shape style opacity onto rendered shape and text items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 12, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }, { identifier: 12 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Translucent shape',
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 5,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [61, 201],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 460, y: 140 },
              size: { width: 240, height: 120 },
              angle: 0
            }
          },
          style: { identifier: 61 },
          ownedStorage: { identifier: 201 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          opacity: 0.4,
          fill: {
            color: { r: 0.98, g: 0.57, b: 0.15, a: 1 }
          }
        }
      }
    };
    archive.records['61'] = {
      id: 61,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          opacity: 0.55,
          verticalAlignment: 0
        }
      }
    };
    archive.records['201'] = {
      id: 201,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Translucent text']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape' && item.name === 'Translucent shape');
    const text = document.slides[0].slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Translucent text'))
    );

    expect(shape).toMatchObject({
      opacity: 0.4
    });
    expect(text).toMatchObject({
      opacity: 0.55
    });
  });

  it('maps Keynote shadow opacity onto rendered drawable shadows', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Shadowed shape',
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 160 },
              size: { width: 280, height: 160 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          fill: {
            color: { r: 0.98, g: 0.57, b: 0.15, a: 1 }
          },
          shadow: {
            color: { r: 0, g: 0, b: 0, a: 0.8 },
            angle: 315,
            offset: 5,
            radius: 4,
            opacity: 0.25,
            isEnabled: true
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape' && item.name === 'Shadowed shape');
    expect(shape).toMatchObject({
      shadow: {
        color: '#000000',
        alpha: 0.2,
        blur: 4,
        distance: 5,
        angle: 315
      }
    });
  });

  it('ignores Keynote shadows disabled through snake_case shadow flags', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Disabled snake shadow shape',
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 160 },
              size: { width: 280, height: 160 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          fill: {
            color: { r: 0.98, g: 0.57, b: 0.15, a: 1 }
          },
          shadow: {
            color: { r: 0, g: 0, b: 0, a: 1 },
            angle: 315,
            offset: 5,
            radius: 4,
            is_enabled: false
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape' && item.name === 'Disabled snake shadow shape');
    expect(shape).toBeTruthy();
    if (!shape || shape.kind !== 'shape') {
      return;
    }
    expect(shape.shadow).toBeUndefined();
  });

  it('maps Keynote gradient fills onto rendered shape items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          fill: {
            gradient: {
              type: 0,
              opacity: 0.8,
              anglegradient: {
                gradientangle: 45
              },
              stops: [
                {
                  color: { r: 0.184, g: 0.42, b: 1, a: 1 },
                  fraction: 0
                },
                {
                  color: { r: 0.145, g: 0.655, b: 0.773, a: 0.75 },
                  fraction: 1
                }
              ]
            }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape');
    expect(shape).toMatchObject({
      fill: {
        type: 'gradient',
        angle: 45,
        stops: [
          { position: 0 },
          { position: 1 }
        ]
      }
    });
    if (!shape || shape.kind !== 'shape' || shape.fill.type !== 'gradient') {
      return;
    }
    expect(shape.fill.stops?.[0]).toMatchObject({
      color: '#2f6bff',
      alpha: 0.8
    });
    expect(shape.fill.stops?.[1]).toMatchObject({
      color: '#25a7c5',
      alpha: 0.6
    });
  });

  it('resolves keynote style inheritance through snake_case style_sheet references', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawables_z_order: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Stylesheet inherited shape',
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [70],
      dataReferences: [],
      value: {
        style_identifier: 'shape/base',
        style_sheet: { identifier: 70 }
      }
    };
    archive.records['70'] = {
      id: 70,
      archiveId: 1,
      messageIndex: 7,
      typeId: 401,
      typeName: 'TSS.StylesheetArchive',
      objectReferences: [71],
      dataReferences: [],
      value: {
        identifier_to_style_map: [
          {
            identifier: 'shape/base',
            style: { identifier: 71 }
          }
        ]
      }
    };
    archive.records['71'] = {
      id: 71,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          fill: {
            color: { r: 0.95, g: 0.3, b: 0.2, a: 0.8 }
          },
          stroke: {
            color: { r: 0.4, g: 0.1, b: 0.1, a: 1 },
            width: 2
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape');
    expect(shape).toMatchObject({
      name: 'Stylesheet inherited shape',
      fill: {
        type: 'solid',
        color: '#f24d33',
        alpha: 0.8
      },
      line: {
        color: '#661a1a',
        width: 2
      }
    });
  });

  it('reads snake_case connection line path sources as line geometry', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawables_z_order: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3009,
      typeName: 'TSD.ConnectionLineArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Snake line',
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 120 },
              angle: 0
            }
          },
          style: { identifier: 60 },
          pathsource: {
            connection_line_path_source: {
              super: {
                path: {
                  elements: [
                    {
                      type: 1,
                      points: [{ x: 0, y: 0 }]
                    },
                    {
                      type: 2,
                      points: [{ x: 300, y: 120 }]
                    }
                  ]
                },
                naturalSize: {
                  width: 300,
                  height: 120
                }
              }
            }
          }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          stroke: {
            color: { r: 0.1, g: 0.2, b: 0.9, a: 1 },
            width: 3
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const lineShape = document.slides[0].slide.items.find((item) => item.kind === 'shape');
    expect(lineShape).toMatchObject({
      shapeType: 'line',
      name: 'Snake line',
      geometry: {
        type: 'custom',
        paths: [
          {
            width: 300,
            height: 120,
            commands: [
              { type: 'M', x: 0, y: 0 },
              { type: 'L', x: 300, y: 120 }
            ]
          }
        ]
      }
    });
  });

  it('maps Keynote picture fills onto rendered shape items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '94': {
        id: '94',
        path: 'Data/fill-texture.png',
        contentType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          fill: {
            image: {
              databaseImagedata: { identifier: 94 },
              opacity: 0.42,
              technique: 2
            }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape');
    expect(shape).toMatchObject({
      fill: {
        type: 'picture',
        mediaId: '94',
        alpha: 0.42,
        tile: true
      }
    });
  });

  it('preserves geometry flip flags on rendered keynote drawable items, including snake_case aliases', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '95': {
        id: '95',
        path: 'Data/flipped-photo.png',
        contentType: 'image/png',
        data: new Uint8Array([9, 5, 1]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 12, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }, { identifier: 12 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Flipped shape',
        super: {
          super: {
            geometry: {
              position: { x: 100, y: 120 },
              size: { width: 300, height: 180 },
              angle: 0,
              horizontalFlip: true,
              verticalFlip: true
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 5,
      typeId: 3002,
      typeName: 'TSD.ImageArchive',
      objectReferences: [61],
      dataReferences: [95],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 460, y: 140 },
              size: { width: 220, height: 140 },
              angle: 0,
              horizontal_flip: true,
              vertical_flip: false
            }
          },
          style: { identifier: 61 }
        },
        data: {
          identifier: 95
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 6,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          fill: {
            color: { r: 0.98, g: 0.57, b: 0.15, a: 1 }
          }
        }
      }
    };
    archive.records['61'] = {
      id: 61,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        mediaProperties: {}
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape' && item.name === 'Flipped shape');
    const image = document.slides[0].slide.items.find((item) => item.kind === 'image' && item.mediaId === '95');

    expect(shape).toMatchObject({
      transform: {
        flipH: true,
        flipV: true
      }
    });
    expect(image).toMatchObject({
      transform: {
        flipH: true,
        flipV: false
      }
    });
  });

  it('reads snake_case keynote drawable storage, z-order, and vertical alignment fields', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 20, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        template_slide: { identifier: 20 },
        drawables_z_order: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60, 201],
      dataReferences: [],
      value: {
        title: 'Snake case text box',
        super: {
          super: {
            geometry: {
              position: { x: 140, y: 180 },
              size: { width: 280, height: 140 },
              angle: 0
            }
          },
          style: { identifier: 60 },
          owned_storage: { identifier: 201 }
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 5,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [12, 51],
      dataReferences: [],
      value: {
        style: { identifier: 51 },
        owned_drawables: [{ identifier: 12 }]
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 6,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [61, 202],
      dataReferences: [],
      value: {
        title: 'Snake case template text box',
        super: {
          super: {
            geometry: {
              position: { x: 80, y: 60 },
              size: { width: 320, height: 110 },
              angle: 0
            }
          },
          style: { identifier: 61 },
          owned_storage: { identifier: 202 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 7,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['51'] = {
      id: 51,
      archiveId: 1,
      messageIndex: 8,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slide_properties: {
          fill: {
            color: { r: 0.25, g: 0.5, b: 0.75, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 0 }
          },
          vertical_alignment: 2,
          paragraph_style: { identifier: 70 }
        }
      }
    };
    archive.records['61'] = {
      id: 61,
      archiveId: 1,
      messageIndex: 10,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 0 }
          }
        }
      }
    };
    archive.records['70'] = {
      id: 70,
      archiveId: 1,
      messageIndex: 11,
      typeId: 2101,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        char_properties: {
          font_size: 19,
          font_name: 'Alias Font',
          font_color: { r: 1, g: 0, b: 0, a: 1 }
        }
      }
    };
    archive.records['201'] = {
      id: 201,
      archiveId: 1,
      messageIndex: 12,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Snake case body text']
      }
    };
    archive.records['202'] = {
      id: 202,
      archiveId: 1,
      messageIndex: 13,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Template alias text']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    expect(document.slides[0].slide.background).toMatchObject({
      type: 'solid',
      color: '#4080bf',
      alpha: 1
    });

    const templateText = document.slides[0].slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Template alias text'))
    );
    const text = document.slides[0].slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Snake case body text'))
    );

    expect(templateText).toBeTruthy();
    expect(text).toMatchObject({
      textFrame: {
        verticalAlign: 'bottom',
        paragraphs: [
          {
            runs: [
              {
                text: 'Snake case body text',
                fontSize: 19,
                fontFamily: 'Alias Font',
                color: '#ff0000'
              }
            ]
          }
        ]
      }
    });
  });

  it('reads snake_case deprecated_storage for keynote drawable text', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawables_z_order: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60, 201],
      dataReferences: [],
      value: {
        title: 'Deprecated storage text box',
        super: {
          super: {
            geometry: {
              position: { x: 140, y: 180 },
              size: { width: 280, height: 140 },
              angle: 0
            }
          },
          style: { identifier: 60 },
          deprecated_storage: { identifier: 201 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 0 }
          }
        }
      }
    };
    archive.records['201'] = {
      id: 201,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Deprecated storage body text']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const text = document.slides[0].slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Deprecated storage body text'))
    );

    expect(text).toBeTruthy();
  });

  it('maps Keynote stroke dash patterns and miter limits onto rendered shape items', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [60],
      dataReferences: [],
      value: {
        title: 'Dashed stroke shape',
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 160 },
              size: { width: 280, height: 160 },
              angle: 0
            }
          },
          style: { identifier: 60 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['60'] = {
      id: 60,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shapeProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 0 }
          },
          stroke: {
            color: { r: 0.121, g: 0.235, b: 0.921, a: 1 },
            opacity: 0.35,
            width: 6,
            join: 0,
            miterLimit: 7,
            pattern: {
              type: 0,
              count: 2,
              pattern: [3, 1, 0, 0, 0, 0]
            }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const shape = document.slides[0].slide.items.find((item) => item.kind === 'shape' && item.name === 'Dashed stroke shape');
    expect(shape).toMatchObject({
      line: {
        color: '#1f3ceb',
        alpha: 0.35,
        width: 6,
        lineJoin: 'miter',
        dash: 'lgDash',
        miterLimit: 7
      }
    });
  });

  it('uses a secondary data reference as poster media for videos when explicit poster fields are absent', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '90': {
        id: '90',
        path: 'Data/clip.mp4',
        contentType: 'video/mp4',
        data: new Uint8Array([1, 2, 3]),
        role: 'video'
      },
      '91': {
        id: '91',
        path: 'Data/clip-poster.png',
        contentType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3007,
      typeName: 'TSD.MovieArchive',
      objectReferences: [],
      dataReferences: [90, 91],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 60, y: 70 },
              size: { width: 320, height: 180 },
              angle: 0
            }
          }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const mediaItem = document.slides[0].slide.items.find((item) => item.kind === 'media');
    expect(mediaItem).toMatchObject({
      mediaId: '90',
      posterMediaId: '91',
      mediaType: 'video',
      name: 'Data/clip.mp4'
    });
  });

  it('uses database-backed movie aliases when direct movie fields are absent', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '92': {
        id: '92',
        path: 'Data/database-clip.mp4',
        contentType: 'video/mp4',
        data: new Uint8Array([1, 2, 3]),
        role: 'video'
      },
      '93': {
        id: '93',
        path: 'Data/database-clip-poster.png',
        contentType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3007,
      typeName: 'TSD.MovieArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 60, y: 70 },
              size: { width: 320, height: 180 },
              angle: 0
            }
          }
        },
        databaseMovieData: { identifier: 92 },
        databasePosterImageData: { identifier: 93 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const mediaItem = document.slides[0].slide.items.find((item) => item.kind === 'media');
    expect(mediaItem).toMatchObject({
      mediaId: '92',
      posterMediaId: '93',
      mediaType: 'video',
      name: 'Data/database-clip.mp4'
    });
  });

  it('treats audio-only movies as audio media and preserves audio poster aliases', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '92': {
        id: '92',
        path: 'Data/audio-only-track.mp4',
        contentType: 'video/mp4',
        data: new Uint8Array([1, 2, 3]),
        role: 'video'
      },
      '93': {
        id: '93',
        path: 'Data/audio-only-poster.png',
        contentType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3007,
      typeName: 'TSD.MovieArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 60, y: 70 },
              size: { width: 320, height: 180 },
              angle: 0
            }
          }
        },
        audioOnly: true,
        databaseMovieData: { identifier: 92 },
        databaseAudioOnlyImageData: { identifier: 93 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const mediaItem = document.slides[0].slide.items.find((item) => item.kind === 'media');
    expect(mediaItem).toMatchObject({
      mediaId: '92',
      posterMediaId: '93',
      mediaType: 'audio',
      name: 'Data/audio-only-track.mp4'
    });
  });

  it('reads snake_case audio-only drawable media fields', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {
      '92': {
        id: '92',
        path: 'Data/audio-only-track.mp4',
        contentType: 'video/mp4',
        data: new Uint8Array([1, 2, 3]),
        role: 'video'
      },
      '93': {
        id: '93',
        path: 'Data/audio-only-poster.png',
        contentType: 'image/png',
        data: new Uint8Array([4, 5, 6]),
        role: 'image'
      }
    };

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawables_z_order: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3007,
      typeName: 'TSD.MovieArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 60, y: 70 },
              size: { width: 320, height: 180 },
              angle: 0
            }
          }
        },
        audio_only: true,
        database_movie_data: { identifier: 92 },
        database_audio_only_image_data: { identifier: 93 }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const mediaItem = document.slides[0].slide.items.find((item) => item.kind === 'media');
    expect(mediaItem).toMatchObject({
      mediaId: '92',
      posterMediaId: '93',
      mediaType: 'audio',
      name: 'Data/audio-only-track.mp4'
    });
  });

  it('maps list styles into paragraph bullets and hanging indents', () => {
    const archive = createEmptyArchive();

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [10, 11],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n'],
        tableParaStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 10 }
            }
          ]
        },
        tableListStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 11 }
            }
          ]
        }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 12
        },
        paraProperties: {
          outlineLevel: 4294967295,
          leftIndent: 0,
          firstLineIndent: 0
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2023,
      typeName: 'TSWP.ListStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        labelTypes: [2, 3],
        strings: ['•'],
        numberTypes: [0, 9],
        indents: [18, 36],
        textIndents: [1, 1.5],
        fontName: 'Arial',
        fontColor: {
          r: 1,
          g: 0,
          b: 0,
          a: 1
        }
      }
    };

    const frame = buildTextFrameFromStorage(archive, { identifier: 1 });
    expect(frame).toBeTruthy();
    if (!frame) {
      return;
    }

    expect(frame.paragraphs).toHaveLength(2);
    expect(frame.paragraphs[0].level).toBe(0);
    expect(frame.paragraphs[0].bullet).toMatchObject({
      char: '•',
      fontFamily: 'Arial',
      color: '#ff0000'
    });
    expect(frame.paragraphs[0].marginLeft).toBe(18);
    expect(frame.paragraphs[0].indent).toBe(-12);
    expect(frame.paragraphs[1].bullet).toMatchObject({
      char: '•',
      fontFamily: 'Arial',
      color: '#ff0000'
    });
    expect(frame.paragraphs[1].marginLeft).toBe(18);
    expect(frame.paragraphs[1].indent).toBe(-12);
  });

  it('builds pages template background and header text from section templates', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3, 4],
      dataReferences: [],
      value: {
        text: ['Body line\n'],
        tableSection: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [5, 6],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 5 },
        firstSectionTemplatePage: { identifier: 6 },
        oddSectionTemplatePage: { identifier: 6 }
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 7 }],
        footers: []
      }
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        backgroundFill: {
          color: { r: 1, g: 0.95, b: 0.8, a: 1 }
        }
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Header title']
      }
    };

    archive.references.outgoing = {
      '1': [2],
      '2': [3],
      '3': [5, 6],
      '5': [7],
      '6': [],
      '7': []
    };
    archive.references.incoming = {
      '2': [1],
      '3': [2],
      '5': [3],
      '6': [3],
      '7': [5]
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(1);
    expect(document.pages[0].canvas.slide.background).toMatchObject({
      type: 'solid',
      color: '#fff2cc'
    });
    const headerItem = document.pages[0].canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    expect(headerItem && headerItem.kind === 'text').toBe(true);
    if (headerItem && headerItem.kind === 'text') {
      expect(headerItem.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Header title');
    }
  });

  it('falls back to TP.PageTemplateArchive storage refs for pages headers and footers', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        text: ['Body line\n'],
        tableSection: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 4 },
        firstSectionTemplatePage: { identifier: 5 },
        oddSectionTemplatePage: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        headers: [],
        footers: []
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [6, 7, 8, 9, 10, 11],
      dataReferences: [],
      value: {}
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Header left']
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Header center']
      }
    };
    archive.records['8'] = {
      id: 8,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Header right']
      }
    };
    archive.records['9'] = {
      id: 9,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Footer left']
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Footer center']
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 10,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Footer right']
      }
    };

    archive.references.outgoing = {
      '1': [2],
      '2': [3],
      '3': [4, 5],
      '4': [],
      '5': [6, 7, 8, 9, 10, 11],
      '6': [],
      '7': [],
      '8': [],
      '9': [],
      '10': [],
      '11': []
    };
    archive.references.incoming = {
      '2': [1],
      '3': [2],
      '4': [3],
      '5': [3],
      '6': [5],
      '7': [5],
      '8': [5],
      '9': [5],
      '10': [5],
      '11': [5]
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const headerTexts = document.pages[0]?.canvas.slide.items
      .filter((item) => item.kind === 'text' && item.name?.startsWith('header-'))
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));
    const footerTexts = document.pages[0]?.canvas.slide.items
      .filter((item) => item.kind === 'text' && item.name?.startsWith('footer-'))
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''));

    expect(headerTexts).toEqual(['Header left', 'Header center', 'Header right']);
    expect(footerTexts).toEqual(['Footer left', 'Footer center', 'Footer right']);
  });

  it('reads snake_case pages document and section template fields', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        page_width: 600,
        page_height: 800,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        text: ['Body line\n'],
        table_section: {
          entries: [
            {
              character_index: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [5, 6],
      dataReferences: [],
      value: {
        user_defined_guide_storage: { identifier: 5 },
        first_section_template_page: { identifier: 6 },
        odd_section_template_page: { identifier: 6 }
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 7 }],
        footers: []
      }
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        background_fill: {
          color: { r: 0.9, g: 0.95, b: 1, a: 1 }
        }
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Snake header']
      }
    };

    archive.references.outgoing = {
      '1': [2],
      '2': [3],
      '3': [5, 6],
      '5': [7],
      '6': [],
      '7': []
    };
    archive.references.incoming = {
      '2': [1],
      '3': [2],
      '5': [3],
      '6': [3],
      '7': [5]
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages[0].canvas.slide.background).toMatchObject({
      type: 'solid',
      color: '#e6f2ff'
    });
    const headerItem = document.pages[0].canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    expect(headerItem && headerItem.kind === 'text').toBe(true);
    if (headerItem && headerItem.kind === 'text') {
      expect(headerItem.textFrame.paragraphs[0]?.runs[0]?.text).toBe('Snake header');
    }
  });

  it('hides pages headers and footers when page templates use snake_case hide_headers_footers', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        text: ['Body line\n'],
        tableSection: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 4 },
        firstSectionTemplatePage: { identifier: 5 },
        oddSectionTemplatePage: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 6 }],
        footers: [{ identifier: 7 }]
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        hide_headers_footers: true
      }
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Header']
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Footer']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const headerFooterItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && (item.name?.startsWith('header-') || item.name?.startsWith('footer-'))
    );
    expect(headerFooterItems).toHaveLength(0);
  });

  it('uses section page number start for pages headers and respects disabled headers/footers settings', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3, 8],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        settings: { identifier: 8 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        text: ['Page one paragraph\nPage two paragraph\n'],
        tableSection: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 4 },
        sectionPageNumberStart: 3,
        firstSectionTemplatePage: { identifier: 5 },
        oddSectionTemplatePage: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 6 }],
        footers: [{ identifier: 7 }]
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [9],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 9 }
            }
          ]
        }
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 10 }
            }
          ]
        }
      }
    };
    archive.records['8'] = {
      id: 8,
      archiveId: 1,
      messageIndex: 7,
      typeId: 10012,
      typeName: 'TP.SettingsArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        headers: false,
        footers: false
      }
    };
    archive.records['9'] = {
      id: 9,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 0
        }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 1
        }
      }
    };

    archive.references.outgoing = {
      '1': [2, 3, 8],
      '2': [3],
      '3': [4, 5],
      '4': [6, 7],
      '5': [],
      '6': [9],
      '7': [10],
      '8': [],
      '9': [],
      '10': []
    };
    archive.references.incoming = {
      '2': [1],
      '3': [1, 2],
      '4': [3],
      '5': [3],
      '6': [4],
      '7': [4],
      '8': [1],
      '9': [6],
      '10': [7]
    };

    const hiddenDocument = buildParsedDocument({ archive, media });
    expect(hiddenDocument.kind).toBe('pages');
    if (hiddenDocument.kind !== 'pages') {
      return;
    }

    const hiddenHeaderFooterItems = hiddenDocument.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && (item.name?.startsWith('header-') || item.name?.startsWith('footer-'))
    );
    expect(hiddenHeaderFooterItems).toHaveLength(0);

    archive.records['8'] = {
      ...archive.records['8'],
      value: {}
    };

    const visibleDocument = buildParsedDocument({ archive, media });
    expect(visibleDocument.kind).toBe('pages');
    if (visibleDocument.kind !== 'pages') {
      return;
    }

    const headerItem = visibleDocument.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    expect(headerItem && headerItem.kind === 'text').toBe(true);
    if (headerItem && headerItem.kind === 'text') {
      expect(headerItem.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('3');
    }

    const footerItem = visibleDocument.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'footer-0'
    );
    expect(footerItem && footerItem.kind === 'text').toBe(true);
    if (footerItem && footerItem.kind === 'text') {
      expect(footerItem.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('1');
    }
  });

  it('formats supported pages section page number kinds in header and footer attachments', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3, 11],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        section: { identifier: 3 },
        deprecatedLayoutState: { identifier: 11 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['One\nTwo\n']
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 4 },
        sectionPageNumberKind: 1,
        sectionPageNumberStart: 4,
        firstSectionTemplatePage: { identifier: 5 },
        oddSectionTemplatePage: { identifier: 5 },
        evenSectionTemplatePage: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 6 }],
        footers: [{ identifier: 7 }]
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [8],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 8 }
            }
          ]
        }
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [9],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 9 }
            }
          ]
        }
      }
    };
    archive.records['8'] = {
      id: 8,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 0
        }
      }
    };
    archive.records['9'] = {
      id: 9,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 1
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 9,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 3 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 440, height: 120 }
                  }
                ]
              },
              {
                targetHints: [
                  {
                    range: { location: 4, length: 3 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 440, height: 120 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).not.toContain(
      'Pages section page number kind 1 is not fully supported; using numeric fallback.'
    );
    expect(document.pages).toHaveLength(2);

    const page1Header = document.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    const page2Header = document.pages[1]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    const page1Footer = document.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'footer-0'
    );

    expect(page1Header && page1Header.kind === 'text').toBe(true);
    expect(page2Header && page2Header.kind === 'text').toBe(true);
    expect(page1Footer && page1Footer.kind === 'text').toBe(true);

    if (page1Header && page1Header.kind === 'text') {
      expect(page1Header.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('IV');
    }
    if (page2Header && page2Header.kind === 'text') {
      expect(page2Header.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('V');
    }
    if (page1Footer && page1Footer.kind === 'text') {
      expect(page1Footer.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('II');
    }
  });

  it('reads snake_case pages section page number kind and start fields', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3, 11],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        section: { identifier: 3 },
        deprecatedLayoutState: { identifier: 11 },
        page_width: 600,
        page_height: 800,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['One\nTwo\n']
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        user_defined_guide_storage: { identifier: 4 },
        section_page_number_kind: 1,
        section_page_number_start: 4,
        first_section_template_page: { identifier: 5 },
        odd_section_template_page: { identifier: 5 },
        even_section_template_page: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 6 }],
        footers: [{ identifier: 7 }]
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [8],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        table_attachment: {
          entries: [
            {
              character_index: 0,
              object: { identifier: 8 }
            }
          ]
        }
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [9],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        table_attachment: {
          entries: [
            {
              character_index: 0,
              object: { identifier: 9 }
            }
          ]
        }
      }
    };
    archive.records['8'] = {
      id: 8,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 0
        }
      }
    };
    archive.records['9'] = {
      id: 9,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 1
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 9,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        section_hints: [
          {
            start_page_index: 0,
            page_hints: [
              {
                target_hints: [
                  {
                    range: { location: 0, length: 3 },
                    double_origin: { x: 0, y: 0 },
                    double_size: { width: 440, height: 120 }
                  }
                ]
              },
              {
                target_hints: [
                  {
                    range: { location: 4, length: 3 },
                    double_origin: { x: 0, y: 0 },
                    double_size: { width: 440, height: 120 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).not.toContain(
      'Pages section page number kind 1 is not fully supported; using numeric fallback.'
    );
    expect(document.pages).toHaveLength(2);

    const page1Header = document.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    const page2Header = document.pages[1]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    const page1Footer = document.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'footer-0'
    );

    expect(page1Header && page1Header.kind === 'text').toBe(true);
    expect(page2Header && page2Header.kind === 'text').toBe(true);
    expect(page1Footer && page1Footer.kind === 'text').toBe(true);

    if (page1Header && page1Header.kind === 'text') {
      expect(page1Header.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('IV');
    }
    if (page2Header && page2Header.kind === 'text') {
      expect(page2Header.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('V');
    }
    if (page1Footer && page1Footer.kind === 'text') {
      expect(page1Footer.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('II');
    }
  });

  it('respects snake_case Numbers page-number visibility and start-page fields in headers and footers', () => {
    const archive = createEmptyArchive();
    archive.type = 'numbers';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 12000,
      typeName: 'TN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        sheets: [{ identifier: 2 }],
        page_size: {
          width: 600,
          height: 800
        }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 12001,
      typeName: 'TN.SheetArchive',
      objectReferences: [3, 4],
      dataReferences: [],
      value: {
        name: 'Sheet 1',
        show_page_numbers: false,
        using_start_page_number: true,
        start_page_number: 7,
        last_page_count: 4,
        print_margins: {
          top: 72,
          left: 72,
          bottom: 72,
          right: 72
        },
        page_header_inset: 18,
        page_footer_inset: 18,
        headers: [{ identifier: 3 }],
        footers: [{ identifier: 4 }]
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [5],
      dataReferences: [],
      value: {
        text: ['Page \uFFFC'],
        table_attachment: {
          entries: [
            {
              character_index: 5,
              object: { identifier: 5 }
            }
          ]
        }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [6],
      dataReferences: [],
      value: {
        text: ['\uFFFC'],
        table_attachment: {
          entries: [
            {
              character_index: 0,
              object: { identifier: 6 }
            }
          ]
        }
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 0
        }
      }
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2043,
      typeName: 'TSWP.NumberAttachmentArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        super: {
          kind: 1
        }
      }
    };

    const hiddenDocument = buildParsedDocument({ archive, media });
    expect(hiddenDocument.kind).toBe('numbers');
    if (hiddenDocument.kind !== 'numbers') {
      return;
    }

    const hiddenHeader = hiddenDocument.sheets[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    const hiddenFooter = hiddenDocument.sheets[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'footer-0'
    );
    expect(hiddenHeader && hiddenHeader.kind === 'text').toBe(true);
    expect(hiddenFooter).toBeUndefined();
    if (hiddenHeader && hiddenHeader.kind === 'text') {
      expect(hiddenHeader.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('Page ');
    }

    archive.records['2'] = {
      ...archive.records['2'],
      value: {
        ...(archive.records['2']?.value as Record<string, unknown>),
        show_page_numbers: true
      }
    };

    const visibleDocument = buildParsedDocument({ archive, media });
    expect(visibleDocument.kind).toBe('numbers');
    if (visibleDocument.kind !== 'numbers') {
      return;
    }

    const visibleHeader = visibleDocument.sheets[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'header-0'
    );
    const visibleFooter = visibleDocument.sheets[0]?.canvas.slide.items.find(
      (item) => item.kind === 'text' && item.name === 'footer-0'
    );
    expect(visibleHeader && visibleHeader.kind === 'text').toBe(true);
    expect(visibleFooter && visibleFooter.kind === 'text').toBe(true);
    if (visibleHeader && visibleHeader.kind === 'text') {
      expect(visibleHeader.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('Page 7');
    }
    if (visibleFooter && visibleFooter.kind === 'text') {
      expect(visibleFooter.textFrame.paragraphs[0]?.runs.map((run) => run.text).join('')).toBe('4');
    }
  });

  it('passes text-frame direction, columns, and autofit through drawable shape properties', () => {
    const archive = createEmptyArchive();
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 1,
      typeName: 'KN.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        show: { identifier: 2 }
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2,
      typeName: 'KN.ShowArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        slideTree: { slides: [{ identifier: 3 }] },
        size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 4,
      typeName: 'KN.SlideNodeArchive',
      objectReferences: [10],
      dataReferences: [],
      value: {
        slide: { identifier: 10 }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 3,
      typeId: 5,
      typeName: 'KN.SlideArchive',
      objectReferences: [11, 50],
      dataReferences: [],
      value: {
        style: { identifier: 50 },
        drawablesZOrder: [{ identifier: 11 }],
        ownedDrawables: [{ identifier: 11 }]
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [101, 201],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 160 },
              size: { width: 320, height: 180 },
              angle: 0
            }
          },
          style: { identifier: 101 },
          ownedStorage: { identifier: 201 }
        }
      }
    };
    archive.records['50'] = {
      id: 50,
      archiveId: 1,
      messageIndex: 5,
      typeId: 9,
      typeName: 'KN.SlideStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        slideProperties: {
          fill: {
            color: { r: 1, g: 1, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['101'] = {
      id: 101,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          shrink_to_fit: true,
          vertical_text_40: true,
          columns: {
            equal_columns: {
              count: 3
            }
          }
        }
      }
    };
    archive.records['201'] = {
      id: 201,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Vertical columns']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const item = document.slides[0]?.slide.items.find(
      (candidate) =>
        'textFrame' in candidate &&
        candidate.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Vertical columns'))
    );
    expect(item?.textFrame).toMatchObject({
      direction: 'vertical270',
      columns: 3,
      autofit: {
        type: 'normal'
      }
    });
  });

  it('hides first-page headers and footers when the section requests it', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 3],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        text: ['Only page\n'],
        tableSection: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 4 },
        sectionTemplateFirstPageHidesHeaderFooter: true,
        firstSectionTemplatePage: { identifier: 5 },
        oddSectionTemplatePage: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [6, 7],
      dataReferences: [],
      value: {
        headers: [{ identifier: 6 }],
        footers: [{ identifier: 7 }]
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['6'] = {
      id: 6,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Header']
      }
    };
    archive.records['7'] = {
      id: 7,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Footer']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const headerFooterItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && (item.name?.startsWith('header-') || item.name?.startsWith('footer-'))
    );
    expect(headerFooterItems).toHaveLength(0);
  });

  it('sorts snake_case pages template placeholder drawables by z_index', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 72,
        rightMargin: 72,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [3],
      dataReferences: [],
      value: {
        text: ['Body line\n'],
        tableSection: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 3 }
            }
          ]
        }
      }
    };
    archive.records['3'] = {
      id: 3,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10011,
      typeName: 'TP.SectionArchive',
      objectReferences: [4, 5],
      dataReferences: [],
      value: {
        userDefinedGuideStorage: { identifier: 4 },
        firstSectionTemplatePage: { identifier: 5 },
        oddSectionTemplatePage: { identifier: 5 }
      }
    };
    archive.records['4'] = {
      id: 4,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10016,
      typeName: 'TP.SectionTemplateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        headers: [],
        footers: []
      }
    };
    archive.records['5'] = {
      id: 5,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10024,
      typeName: 'TP.PageTemplateArchive',
      objectReferences: [20, 30],
      dataReferences: [],
      value: {
        placeholder_drawables: [
          {
            z_index: 9,
            drawable: { identifier: 30 }
          },
          {
            z_index: 2,
            drawable: { identifier: 20 }
          }
        ]
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 5,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [21, 22],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 80, y: 100 },
              size: { width: 180, height: 48 },
              angle: 0
            }
          },
          style: { identifier: 21 },
          ownedStorage: { identifier: 22 }
        }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Lower z']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 8,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [31, 32],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 80, y: 180 },
              size: { width: 180, height: 48 },
              angle: 0
            }
          },
          style: { identifier: 31 },
          ownedStorage: { identifier: 32 }
        }
      }
    };
    archive.records['31'] = {
      id: 31,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['32'] = {
      id: 32,
      archiveId: 1,
      messageIndex: 10,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Higher z']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const placeholderTexts = document.pages[0]?.canvas.slide.items
      .filter((item) => item.kind === 'text')
      .map((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join(''))
      .filter((text) => text === 'Lower z' || text === 'Higher z');

    expect(placeholderTexts).toEqual(['Lower z', 'Higher z']);
  });

  it('positions pages inline attachments directly after the preceding body text', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [10, 11, 20],
      dataReferences: [],
      value: {
        text: ['A very long paragraph that should wrap across many visual lines in order to increase its estimated height significantly for attachment layout.\nShort paragraph \uFFFC\n'],
        tableParaStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 10 }
            },
            {
              characterIndex: 132,
              object: { identifier: 11 }
            }
          ]
        },
        tableAttachment: {
          entries: [
            {
              characterIndex: 148,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 22
        },
        paraProperties: {
          outlineLevel: 0
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 3,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 12
        },
        paraProperties: {
          outlineLevel: 0
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2044,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 },
        hOffset: 0,
        vOffset: 0
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 5,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22],
      dataReferences: [1],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 120, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 22 }
        },
        data: {
          identifier: 1
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        mediaProperties: {
          fill: {
            color: { r: 1, g: 0, b: 0, a: 1 }
          }
        }
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const attachmentBlock = document.pages[0]?.blocks.find((block) => block.kind === 'drawable');
    const attachmentItem = attachmentBlock?.item;
    expect(attachmentItem).toBeTruthy();
    if (!attachmentItem) {
      return;
    }
    expect(['image', 'shape', 'media']).toContain(attachmentItem.kind);

    const precedingTextItem = document.pages[0]?.canvas.slide.items
      .filter((item) => item.kind === 'text' && item.transform.y < attachmentItem.transform.y)
      .at(-1);
    expect(precedingTextItem).toBeTruthy();
    expect(attachmentItem.transform.y).toBeCloseTo(
      (precedingTextItem?.transform.y ?? 0) + (precedingTextItem?.transform.height ?? 0)
    );
  });

  it('positions same-paragraph pages inline attachments using character progress within the paragraph', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 320,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [10, 20, 30],
      dataReferences: [],
      value: {
        text: ['Alpha \uFFFC beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma \uFFFC tau upsilon phi chi psi omega\n'],
        tableParaStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 10 }
            }
          ]
        },
        tableAttachment: {
          entries: [
            {
              characterIndex: 6,
              object: { identifier: 20 }
            },
            {
              characterIndex: 101,
              object: { identifier: 30 }
            }
          ]
        }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 20
        },
        paraProperties: {
          outlineLevel: 0
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 3,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 40, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment 1']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [31],
      dataReferences: [],
      value: {
        drawable: { identifier: 31 }
      }
    };
    archive.records['31'] = {
      id: 31,
      archiveId: 1,
      messageIndex: 8,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [32, 33],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 40, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 32 },
          ownedStorage: { identifier: 33 }
        }
      }
    };
    archive.records['32'] = {
      id: 32,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['33'] = {
      id: 33,
      archiveId: 1,
      messageIndex: 10,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment 2']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const drawableBlocks = document.pages[0]?.blocks.filter((block) => block.kind === 'drawable') ?? [];
    expect(drawableBlocks).toHaveLength(2);
    expect(drawableBlocks[1]?.item.transform.y).toBeGreaterThan(drawableBlocks[0]?.item.transform.y ?? 0);
  });

  it('uses pages layout-state anchor hints for attachment page assignment and absolute positioning', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['Body paragraph \uFFFC\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 15,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 },
        hOffset: 0,
        vOffset: 0
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 120, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        mediaProperties: {
          fill: {
            color: { r: 0, g: 0.5, b: 1, a: 1 }
          }
        }
      }
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 6,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {},
              {
                anchoredAttachmentsMap: [
                  {
                    attachment: { identifier: 20 },
                    doublePosition: { x: 210, y: 320 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    const firstPageAttachment = document.pages[0]?.blocks.find((block) => block.kind === 'drawable');
    expect(firstPageAttachment).toBeUndefined();

    const secondPageAttachment = document.pages[1]?.blocks.find((block) => block.kind === 'drawable');
    expect(secondPageAttachment?.item.transform.x).toBe(210);
    expect(secondPageAttachment?.item.transform.y).toBe(320);
  });

  it('supports pages attachment offset types used by anchored drawables and keeps placement stable', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['Body paragraph \uFFFC\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 15,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 },
        hOffsetType: 3,
        hOffset: 12,
        vOffsetType: 4,
        vOffset: 24
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 120, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        mediaProperties: {
          fill: {
            color: { r: 1, g: 0, b: 0, a: 1 }
          }
        }
      }
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).not.toContain(
      'Pages attachment horizontal offset type 3 is not fully supported; using margin-relative fallback.'
    );
    expect(document.warnings).not.toContain(
      'Pages attachment vertical offset type 4 is not fully supported; using margin-relative fallback.'
    );

    const attachmentBlock = document.pages[0]?.blocks.find((block) => block.kind === 'drawable');
    expect(attachmentBlock?.item.transform.x).toBe(92);
    expect(attachmentBlock?.item.transform.y).toBeGreaterThan(96);
  });

  it('reads snake_case pages attachment offset and position hint fields', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        page_width: 600,
        page_height: 800,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20, 24],
      dataReferences: [],
      value: {
        text: ['Body \uFFFC hint\nBody \uFFFC offset\n'],
        table_attachment: {
          entries: [
            {
              character_index: 5,
              object: { identifier: 20 }
            },
            {
              character_index: 17,
              object: { identifier: 24 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Hint attachment']
      }
    };
    archive.records['24'] = {
      id: 24,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [25],
      dataReferences: [],
      value: {
        drawable: { identifier: 25 },
        h_offset_type: 3,
        h_offset: 12,
        v_offset_type: 4,
        v_offset: 24
      }
    };
    archive.records['25'] = {
      id: 25,
      archiveId: 1,
      messageIndex: 7,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [26, 27],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 120, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 26 },
          ownedStorage: { identifier: 27 }
        }
      }
    };
    archive.records['26'] = {
      id: 26,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['27'] = {
      id: 27,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Offset attachment']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 10,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        section_hints: [
          {
            start_page_index: 0,
            page_hints: [
              {
                anchored_attachments_map: [
                  {
                    attachment: { identifier: 20 },
                    double_position: { x: 210, y: 320 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const drawableBlocks = document.pages[0]?.blocks.filter((block) => block.kind === 'drawable') ?? [];
    expect(drawableBlocks).toHaveLength(2);
    expect(drawableBlocks[0]?.item.transform.x).toBe(210);
    expect(drawableBlocks[0]?.item.transform.y).toBe(320);
    expect(drawableBlocks[1]?.item.transform.x).toBe(92);
    expect(drawableBlocks[1]?.item.transform.y).toBeGreaterThan(96);
    expect(document.warnings).not.toContain(
      'Pages attachment horizontal offset type 3 is not fully supported; using margin-relative fallback.'
    );
    expect(document.warnings).not.toContain(
      'Pages attachment vertical offset type 4 is not fully supported; using margin-relative fallback.'
    );
  });

  it('still warns for unknown pages attachment offset types', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['Body paragraph \uFFFC\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 15,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 },
        hOffsetType: 7,
        hOffset: 12,
        vOffsetType: 8,
        vOffset: 24
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 120, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).toContain(
      'Pages attachment horizontal offset type 7 is not fully supported; using margin-relative fallback.'
    );
    expect(document.warnings).toContain(
      'Pages attachment vertical offset type 8 is not fully supported; using margin-relative fallback.'
    );
  });

  it('keeps blank pages declared by pages layout state even without body or floating content', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 600,
        pageHeight: 800,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Body paragraph\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [{}, {}, {}]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(3);
    expect(document.pages[1]?.blocks).toHaveLength(0);
    expect(document.pages[2]?.blocks).toHaveLength(0);
  });

  it('uses pages target hints to override heuristic body pagination at paragraph boundaries', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 600,
        pageHeight: 2000,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 }
                  }
                ]
              },
              {
                targetHints: [
                  {
                    range: { location: 6, length: 5 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    expect(
      document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Alpha']);
    expect(
      document.pages[1]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Beta']);
  });

  it('reads snake_case Pages layout hint fields for pagination and body fragment geometry', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        page_width: 600,
        page_height: 2000,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        section_hints: [
          {
            start_page_index: 0,
            page_hints: [
              {
                target_hints: [
                  {
                    anchored_range: { location: 0, length: 6 },
                    double_origin: { x: 10, y: 20 },
                    double_size: { width: 220, height: 120 },
                    column_count: 2
                  }
                ]
              },
              {
                target_hints: [
                  {
                    anchored_range: { location: 6, length: 5 },
                    double_origin: { x: 30, y: 40 },
                    double_size: { width: 200, height: 100 },
                    column_count: 2
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    expect(
      document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Alpha']);
    expect(
      document.pages[1]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Beta']);

    const firstBodyItem = document.pages[0]?.canvas.slide.items.find((item) => item.kind === 'text' && item.name === 'Body');
    const secondBodyItem = document.pages[1]?.canvas.slide.items.find((item) => item.kind === 'text' && item.name === 'Body');
    expect(firstBodyItem?.transform).toMatchObject({
      x: 90,
      y: 92,
      width: 220
    });
    expect(secondBodyItem?.transform).toMatchObject({
      x: 110,
      y: 112,
      width: 200
    });
    expect(firstBodyItem?.textFrame.columns).toBe(2);
    expect(secondBodyItem?.textFrame.columns).toBe(2);
    expect(document.warnings).not.toContain(
      'Pages text hint column count 2 is not fully supported; using fragment-based fallback.'
    );
  });

  it('falls back to pages flow hints when target hints are absent', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 600,
        pageHeight: 2000,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['One\nTwo\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                flowHints: [
                  {
                    range: { location: 0, length: 4 }
                  }
                ]
              },
              {
                flowHints: [
                  {
                    range: { location: 4, length: 4 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    expect(
      document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['One']);
    expect(
      document.pages[1]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Two']);
  });

  it('reads snake_case pages layout_state references for body pagination', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        deprecated_layout_state: { identifier: 30 },
        page_width: 600,
        page_height: 2000,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['One\nTwo\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        section_hints: [
          {
            start_page_index: 0,
            page_hints: [
              {
                flow_hints: [
                  {
                    range: { location: 0, length: 4 }
                  }
                ]
              },
              {
                flow_hints: [
                  {
                    range: { location: 4, length: 4 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    expect(
      document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['One']);
    expect(
      document.pages[1]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Two']);
  });

  it('creates multiple pages body text items from target hint fragments with hint-relative geometry', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['A1\nA2\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 3 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 180, height: 320 }
                  },
                  {
                    range: { location: 3, length: 3 },
                    doubleOrigin: { x: 220, y: 0 },
                    doubleSize: { width: 180, height: 320 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems[0]?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 180,
      height: 320
    });
    expect(bodyItems[1]?.transform).toMatchObject({
      x: 300,
      y: 72,
      width: 180,
      height: 320
    });
    expect(bodyItems[0]?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual(['A1']);
    expect(bodyItems[1]?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual(['A2']);
    expect(
      document.pages[0]?.blocks
        .filter((block) => block.kind === 'paragraphs')
        .map((block) => block.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join('')))
    ).toEqual([
      ['A1'],
      ['A2']
    ]);
  });

  it('positions pages inline attachments relative to the resolved body fragment when layout anchor hints are absent', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['Lead paragraph\nAnchor paragraph \uFFFC\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 32,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 },
        hOffset: 12,
        vOffset: 16
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 100, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        mediaProperties: {
          fill: {
            color: { r: 0, g: 0.7, b: 0.3, a: 1 }
          }
        }
      }
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 6,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 15 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 180, height: 240 }
                  },
                  {
                    range: { location: 15, length: 19 },
                    doubleOrigin: { x: 220, y: 40 },
                    doubleSize: { width: 180, height: 220 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(document.pages[0]?.blocks.slice(0, 3).map((block) => block.kind)).toEqual([
      'paragraphs',
      'paragraphs',
      'drawable'
    ]);
    expect(document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Lead paragraph'
    ]);
    expect(document.pages[0]?.blocks[1]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Anchor paragraph '
    ]);
    const attachmentBlock = document.pages[0]?.blocks.find((block) => block.kind === 'drawable');
    expect(attachmentBlock?.item.transform.x).toBe(312);
    expect(attachmentBlock?.item.transform.y).toBeGreaterThanOrEqual(128);
    expect(attachmentBlock?.item.transform.y).toBeLessThanOrEqual(308);
  });

  it('resolves Pages inline drawable attachments from snake_case storage object tables', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['Lead paragraph\nAnchor paragraph \uFFFC\n'],
        table_bookmark: {
          entries: [
            {
              character_index: 32,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 },
        hOffset: 12,
        vOffset: 16
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 100, height: 40 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3015,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        media_properties: {
          fill: {
            color: { r: 0, g: 0.7, b: 0.3, a: 1 }
          }
        }
      }
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 6,
      typeId: 210,
      typeName: 'TSK.ViewStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        pageHintForTarget: [
          {
            target: { identifier: 2 },
            pageInfos: [
              {
                pageIndex: 0,
                bodyPageHint: {
                  targetInfos: [
                    {
                      range: { location: 0, length: 15 },
                      rect: { origin: { x: 80, y: 72 }, size: { width: 200, height: 80 } }
                    },
                    {
                      range: { location: 15, length: 18 },
                      rect: { origin: { x: 300, y: 120 }, size: { width: 180, height: 140 } }
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      ['Lead paragraph'],
      ['Anchor paragraph ']
    ]);
    expect(bodyItems[0]?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 200,
      height: 80
    });
    expect(bodyItems[1]?.transform).toMatchObject({
      x: 300,
      y: 120,
      width: 180
    });

    const attachmentBlock = document.pages[0]?.blocks.find((block) => block.kind === 'drawable');
    expect(attachmentBlock?.item).toBeTruthy();
    expect(attachmentBlock?.item.transform.x).toBe(312);
    expect(attachmentBlock?.item.transform.y).toBeGreaterThanOrEqual(136);
    expect(attachmentBlock?.item.transform.y).toBeLessThanOrEqual(276);
  });

  it('reads snake_case pages floating drawable page groups', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        floating_drawables: { identifier: 30 },
        page_width: 640,
        page_height: 900,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Body paragraph\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10040,
      typeName: 'TP.FloatingDrawablesArchive',
      objectReferences: [41],
      dataReferences: [],
      value: {
        page_groups: [
          {
            page_index: 1,
            drawables: [{ drawable: { identifier: 41 } }]
          }
        ]
      }
    };
    archive.records['41'] = {
      id: 41,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [42, 43],
      dataReferences: [],
      value: {
        title: 'Floating alias shape',
        super: {
          super: {
            geometry: {
              position: { x: 120, y: 160 },
              size: { width: 180, height: 60 },
              angle: 0
            }
          },
          style: { identifier: 42 },
          owned_storage: { identifier: 43 }
        }
      }
    };
    archive.records['42'] = {
      id: 42,
      archiveId: 1,
      messageIndex: 4,
      typeId: 3015,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        shape_properties: {
          fill: {
            color: { r: 0.2, g: 0.6, b: 0.9, a: 1 }
          }
        }
      }
    };
    archive.records['43'] = {
      id: 43,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Floating text']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    const firstPageFloating = document.pages[0]?.canvas.slide.items.find(
      (item) => item.kind === 'shape' && item.name === 'Floating alias shape'
    );
    const secondPageFloating = document.pages[1]?.canvas.slide.items.find(
      (item) => item.kind === 'shape' && item.name === 'Floating alias shape'
    );

    expect(firstPageFloating).toBeUndefined();
    expect(secondPageFloating).toMatchObject({
      transform: {
        x: 120,
        y: 160,
        width: 180,
        height: 60
      }
    });
  });

  it('resolves pages layout state through view-state root references', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        body_storage: { identifier: 2 },
        view_state: { identifier: 30 },
        page_width: 640,
        page_height: 900,
        left_margin: 80,
        right_margin: 80,
        top_margin: 72,
        bottom_margin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\nGamma\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 210,
      typeName: 'TSK.ViewStateArchive',
      objectReferences: [31],
      dataReferences: [],
      value: {
        view_state_root: { identifier: 31 }
      }
    };
    archive.records['31'] = {
      id: 31,
      archiveId: 1,
      messageIndex: 3,
      typeId: 10041,
      typeName: 'TP.UIStateArchive',
      objectReferences: [32],
      dataReferences: [],
      value: {}
    };
    archive.records['32'] = {
      id: 32,
      archiveId: 1,
      messageIndex: 4,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        section_hints: [
          {
            start_page_index: 0,
            page_hints: [
              {
                target_hints: [
                  {
                    range: { location: 0, length: 6 },
                    column_count: 1,
                    double_origin: { x: 0, y: 0 },
                    double_size: { width: 200, height: 120 }
                  }
                ]
              },
              {
                target_hints: [
                  {
                    range: { location: 6, length: 11 },
                    column_count: 1,
                    double_origin: { x: 0, y: 0 },
                    double_size: { width: 200, height: 180 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    archive.references.outgoing = {
      '1': [2, 30],
      '2': [],
      '30': [31],
      '31': [32],
      '32': []
    };
    archive.references.incoming = {
      '2': [1],
      '30': [1],
      '31': [30],
      '32': [31]
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]?.canvas.slide.items.filter((item) => item.kind === 'text' && item.name === 'Body')).toHaveLength(1);
    expect(document.pages[1]?.canvas.slide.items.filter((item) => item.kind === 'text' && item.name === 'Body')).toHaveLength(1);
    const pageTexts = document.pages.map((page) =>
      page.canvas.slide.items
        .filter((item) => item.kind === 'text' && item.name === 'Body')
        .flatMap((item) => item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')))
    );
    expect(pageTexts).toEqual([['Alpha'], ['Beta', 'Gamma']]);
  });

  it('does not warn when contiguous implicit pages text hints can be merged into declared columns', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    columnCount: 3
                  },
                  {
                    range: { location: 6, length: 5 },
                    columnCount: 3
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).not.toContain(
      'Pages text hint column count 3 is not fully supported; using fragment-based fallback.'
    );
    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(1);
    expect(bodyItems[0]?.textFrame.columns).toBe(3);
    expect(bodyItems[0]?.textFrame.paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join('')
    )).toEqual([
      'Alpha',
      'Beta'
    ]);
  });

  it('merges contiguous pages text hint fragments into a multi-column body item when geometry is implicit', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    columnCount: 2
                  },
                  {
                    range: { location: 6, length: 5 },
                    columnCount: 2
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).not.toContain(
      'Pages text hint column count 2 is not fully supported; using fragment-based fallback.'
    );
    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(1);
    expect(bodyItems[0]?.textFrame.columns).toBe(2);
    expect(bodyItems[0]?.textFrame.paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join('')
    )).toEqual([
      'Alpha',
      'Beta'
    ]);
    expect(bodyItems[0]?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 480
    });
  });

  it('does not warn for pages text hints with explicit geometry when declared columns exceed fragment count', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    columnCount: 3,
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 200, height: 320 }
                  },
                  {
                    range: { location: 6, length: 5 },
                    columnCount: 3,
                    doubleOrigin: { x: 220, y: 0 },
                    doubleSize: { width: 200, height: 320 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems[0]?.textFrame.columns).toBe(3);
    expect(bodyItems[1]?.textFrame.columns).toBe(3);
    expect(document.warnings).not.toContain(
      'Pages text hint column count 3 is not fully supported; using fragment-based fallback.'
    );
  });

  it('supports pages layout target hints that split body text inside a paragraph', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha Beta']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 220, height: 120 }
                  }
                ]
              },
              {
                targetHints: [
                  {
                    range: { location: 6, length: 4 },
                    doubleOrigin: { x: 30, y: 40 },
                    doubleSize: { width: 200, height: 100 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(2);
    expect(
      document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Alpha ']);
    expect(
      document.pages[1]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Beta']);

    const firstBodyItem = document.pages[0]?.canvas.slide.items.find((item) => item.kind === 'text' && item.name === 'Body');
    const secondBodyItem = document.pages[1]?.canvas.slide.items.find((item) => item.kind === 'text' && item.name === 'Body');
    expect(firstBodyItem?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 220
    });
    expect(secondBodyItem?.transform).toMatchObject({
      x: 110,
      y: 112,
      width: 200
    });
    expect(document.warnings).not.toContain(
      'Pages layout target hints split body text inside a paragraph; falling back to estimated paragraph pagination.'
    );
  });

  it('supports same-page pages layout fragments that split a paragraph across columns', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha Beta']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    columnCount: 2,
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 220, height: 120 }
                  },
                  {
                    range: { location: 6, length: 4 },
                    columnCount: 2,
                    doubleOrigin: { x: 30, y: 0 },
                    doubleSize: { width: 200, height: 120 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(1);
    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      ['Alpha '],
      ['Beta']
    ]);
    expect(bodyItems[0]?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 220
    });
    expect(bodyItems[1]?.transform).toMatchObject({
      x: 110,
      y: 72,
      width: 200
    });
    expect(bodyItems[0]?.textFrame.columns).toBe(2);
    expect(bodyItems[1]?.textFrame.columns).toBe(2);
    expect(document.warnings).not.toContain(
      'Pages layout target hints overlap body paragraphs; falling back to estimated paragraph pagination.'
    );
    expect(document.warnings).not.toContain(
      'Pages layout target hints split body text inside a paragraph; falling back to estimated paragraph pagination.'
    );
  });

  it('prefers split pages layout target hints over a redundant parent body fragment', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 11 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 440, height: 320 }
                  },
                  {
                    range: { location: 0, length: 6 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 200, height: 320 }
                  },
                  {
                    range: { location: 6, length: 5 },
                    doubleOrigin: { x: 220, y: 0 },
                    doubleSize: { width: 200, height: 320 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems[0]?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 200
    });
    expect(bodyItems[1]?.transform).toMatchObject({
      x: 300,
      y: 72,
      width: 200
    });
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      ['Alpha'],
      ['Beta']
    ]);
    expect(document.warnings).not.toContain(
      'Pages layout target hints overlap body paragraphs; falling back to estimated paragraph pagination.'
    );
  });

  it('treats pages layout target hint range ends at paragraph boundaries as non-overlapping', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\nBeta\nGamma\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 180, height: 120 }
                  },
                  {
                    range: { location: 6, length: 5 },
                    doubleOrigin: { x: 200, y: 0 },
                    doubleSize: { width: 180, height: 120 }
                  },
                  {
                    range: { location: 11, length: 6 },
                    doubleOrigin: { x: 400, y: 0 },
                    doubleSize: { width: 180, height: 120 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(3);
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      ['Alpha'],
      ['Beta'],
      ['Gamma']
    ]);
    expect(document.warnings).not.toContain(
      'Pages layout target hints overlap body paragraphs; falling back to estimated paragraph pagination.'
    );
  });

  it('ignores duplicate pages layout target hints for the same text fragment', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Alpha\n']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 2,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 220, height: 120 }
                  },
                  {
                    range: { location: 0, length: 6 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 220, height: 120 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(1);
    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(1);
    expect(bodyItems[0]?.transform).toMatchObject({
      x: 80,
      y: 72,
      width: 220,
      height: 120
    });
    expect(bodyItems[0]?.textFrame.paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join('')
    )).toEqual(['Alpha']);
    expect(document.warnings).not.toContain(
      'Pages layout target hints overlap body paragraphs; falling back to estimated paragraph pagination.'
    );
  });

  it('places pages inline attachments into the matching same-page split fragment', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2, 30],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        deprecatedLayoutState: { identifier: 30 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['Alpha \uFFFCBeta'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 6,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 6,
      typeId: 10031,
      typeName: 'TP.LayoutStateArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        sectionHints: [
          {
            startPageIndex: 0,
            pageHints: [
              {
                targetHints: [
                  {
                    range: { location: 0, length: 6 },
                    doubleOrigin: { x: 0, y: 0 },
                    doubleSize: { width: 220, height: 120 }
                  },
                  {
                    range: { location: 7, length: 4 },
                    doubleOrigin: { x: 30, y: 0 },
                    doubleSize: { width: 200, height: 120 }
                  }
                ]
              }
            ]
          }
        ]
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]?.blocks.map((block) => block.kind)).toEqual([
      'paragraphs',
      'drawable',
      'paragraphs'
    ]);
    expect(
      document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Alpha ']);
    expect(
      document.pages[0]?.blocks[2]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    ).toEqual(['Beta']);

    const attachmentBlock = document.pages[0]?.blocks[1];
    expect(attachmentBlock?.kind).toBe('drawable');
    expect(attachmentBlock?.item.transform.x).toBe(110);
    expect(attachmentBlock?.item.transform.y).toBeGreaterThanOrEqual(72);
    expect(attachmentBlock?.item.transform.y).toBeLessThanOrEqual(162);
  });

  it('places pages inline attachments before the paragraph block when the attachment marker is at paragraph start', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20],
      dataReferences: [],
      value: {
        text: ['\uFFFC Prefixed paragraph\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages[0]?.blocks.map((block) => block.kind)).toEqual([
      'drawable',
      'paragraphs'
    ]);
    expect(document.pages[0]?.blocks[1]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      ' Prefixed paragraph'
    ]);
  });

  it('splits pages paragraph blocks around inline attachments embedded in the middle of a paragraph', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [10, 11, 20],
      dataReferences: [],
      value: {
        text: ['Alpha \uFFFC Beta\n'],
        tableParaStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 10 }
            }
          ]
        },
        tableListStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 11 }
            }
          ]
        },
        tableAttachment: {
          entries: [
            {
              characterIndex: 6,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 14
        },
        paraProperties: {
          outlineLevel: 0,
          spaceBefore: 8,
          spaceAfter: 10
        }
      }
    };
    archive.records['11'] = {
      id: 11,
      archiveId: 1,
      messageIndex: 3,
      typeId: 2023,
      typeName: 'TSWP.ListStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        labelTypes: [2],
        strings: ['•']
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 5,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.warnings).not.toContain(
      'Pages inline attachments embedded in the middle of paragraph text are not fully supported; using paragraph-level fallback.'
    );
    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      ['Alpha '],
      [' Beta']
    ]);
    expect(bodyItems[0]?.transform.y).toBeLessThan(bodyItems[1]?.transform.y);
    expect(document.pages[0]?.blocks.map((block) => block.kind)).toEqual([
      'paragraphs',
      'drawable',
      'paragraphs'
    ]);
    expect(document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Alpha '
    ]);
    expect(document.pages[0]?.blocks[0]?.paragraphs?.[0]).toMatchObject({
      spaceBefore: 8,
      spaceAfter: 0,
      bullet: {
        char: '•'
      }
    });
    expect(document.pages[0]?.blocks[2]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      ' Beta'
    ]);
    expect(document.pages[0]?.blocks[2]?.paragraphs?.[0]).toMatchObject({
      spaceBefore: 0,
      spaceAfter: 10,
      bullet: undefined,
      bulletDisabled: true
    });
  });

  it('splits pages paragraph blocks around multiple inline attachments in the same paragraph', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20, 30],
      dataReferences: [],
      value: {
        text: ['A \uFFFC B \uFFFC C\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 2,
              object: { identifier: 20 }
            },
            {
              characterIndex: 6,
              object: { identifier: 30 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment 1']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [31],
      dataReferences: [],
      value: {
        drawable: { identifier: 31 }
      }
    };
    archive.records['31'] = {
      id: 31,
      archiveId: 1,
      messageIndex: 7,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [32, 33],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 32 },
          ownedStorage: { identifier: 33 }
        }
      }
    };
    archive.records['32'] = {
      id: 32,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['33'] = {
      id: 33,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment 2']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(3);
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      ['A '],
      [' B '],
      [' C']
    ]);
    expect(document.pages[0]?.blocks.map((block) => block.kind)).toEqual([
      'paragraphs',
      'drawable',
      'paragraphs',
      'drawable',
      'paragraphs'
    ]);
    expect(document.pages[0]?.blocks[0]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'A '
    ]);
    expect(document.pages[0]?.blocks[2]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      ' B '
    ]);
    expect(document.pages[0]?.blocks[4]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      ' C'
    ]);
  });

  it('preserves character run styling when splitting pages paragraphs around inline attachments', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [10, 12, 13, 20],
      dataReferences: [],
      value: {
        text: ['Red \uFFFC Blue\n'],
        tableParaStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 10 }
            }
          ]
        },
        tableCharStyle: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 12 }
            },
            {
              characterIndex: 5,
              object: { identifier: 13 }
            }
          ]
        },
        tableAttachment: {
          entries: [
            {
              characterIndex: 4,
              object: { identifier: 20 }
            }
          ]
        }
      }
    };
    archive.records['10'] = {
      id: 10,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2022,
      typeName: 'TSWP.ParagraphStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        paraProperties: {
          outlineLevel: 0
        }
      }
    };
    archive.records['12'] = {
      id: 12,
      archiveId: 1,
      messageIndex: 3,
      typeId: 2024,
      typeName: 'TSWP.CharacterStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 18,
          fontName: 'PingFang SC Bold',
          bold: true,
          fontColor: {
            r: 1,
            g: 0,
            b: 0,
            a: 1
          }
        }
      }
    };
    archive.records['13'] = {
      id: 13,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2024,
      typeName: 'TSWP.CharacterStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        charProperties: {
          fontSize: 12,
          fontName: 'Helvetica Neue',
          italic: true,
          underline: 1,
          fontColor: {
            r: 0,
            g: 0,
            b: 1,
            a: 1
          }
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 6,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 7,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems).toHaveLength(2);
    expect(bodyItems[0]?.textFrame.paragraphs[0]?.runs[0]).toMatchObject({
      text: 'Red ',
      bold: true,
      fontSize: 18,
      fontFamily: 'PingFang SC Bold',
      color: '#ff0000'
    });
    expect(bodyItems[1]?.textFrame.paragraphs[0]?.runs[0]).toMatchObject({
      text: ' Blue',
      italic: true,
      underline: true,
      fontSize: 12,
      fontFamily: 'Helvetica Neue',
      color: '#0000ff'
    });
    expect(document.pages[0]?.blocks[0]?.paragraphs?.[0]?.runs[0]).toMatchObject({
      text: 'Red ',
      color: '#ff0000'
    });
    expect(document.pages[0]?.blocks[2]?.paragraphs?.[0]?.runs[0]).toMatchObject({
      text: ' Blue',
      color: '#0000ff'
    });
  });

  it('keeps mixed prefix and middle inline attachments in stable body flow order', () => {
    const archive = createEmptyArchive();
    archive.type = 'pages';
    const media: Record<string, IworkImageAsset> = {};

    archive.records['1'] = {
      id: 1,
      archiveId: 1,
      messageIndex: 0,
      typeId: 10000,
      typeName: 'TP.DocumentArchive',
      objectReferences: [2],
      dataReferences: [],
      value: {
        bodyStorage: { identifier: 2 },
        pageWidth: 640,
        pageHeight: 900,
        leftMargin: 80,
        rightMargin: 80,
        topMargin: 72,
        bottomMargin: 72
      }
    };
    archive.records['2'] = {
      id: 2,
      archiveId: 1,
      messageIndex: 1,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [20, 30],
      dataReferences: [],
      value: {
        text: ['\uFFFC Alpha \uFFFC Beta\n'],
        tableAttachment: {
          entries: [
            {
              characterIndex: 0,
              object: { identifier: 20 }
            },
            {
              characterIndex: 8,
              object: { identifier: 30 }
            }
          ]
        }
      }
    };
    archive.records['20'] = {
      id: 20,
      archiveId: 1,
      messageIndex: 2,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [21],
      dataReferences: [],
      value: {
        drawable: { identifier: 21 }
      }
    };
    archive.records['21'] = {
      id: 21,
      archiveId: 1,
      messageIndex: 3,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [22, 23],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 22 },
          ownedStorage: { identifier: 23 }
        }
      }
    };
    archive.records['22'] = {
      id: 22,
      archiveId: 1,
      messageIndex: 4,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['23'] = {
      id: 23,
      archiveId: 1,
      messageIndex: 5,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment 1']
      }
    };
    archive.records['30'] = {
      id: 30,
      archiveId: 1,
      messageIndex: 6,
      typeId: 2003,
      typeName: 'TSWP.DrawableAttachmentArchive',
      objectReferences: [31],
      dataReferences: [],
      value: {
        drawable: { identifier: 31 }
      }
    };
    archive.records['31'] = {
      id: 31,
      archiveId: 1,
      messageIndex: 7,
      typeId: 3004,
      typeName: 'TSD.ShapeArchive',
      objectReferences: [32, 33],
      dataReferences: [],
      value: {
        super: {
          super: {
            geometry: {
              position: { x: 0, y: 0 },
              size: { width: 60, height: 30 },
              angle: 0
            }
          },
          style: { identifier: 32 },
          ownedStorage: { identifier: 33 }
        }
      }
    };
    archive.records['32'] = {
      id: 32,
      archiveId: 1,
      messageIndex: 8,
      typeId: 2025,
      typeName: 'TSWP.ShapeStyleArchive',
      objectReferences: [],
      dataReferences: [],
      value: {}
    };
    archive.records['33'] = {
      id: 33,
      archiveId: 1,
      messageIndex: 9,
      typeId: 2001,
      typeName: 'TSWP.StorageArchive',
      objectReferences: [],
      dataReferences: [],
      value: {
        text: ['Attachment 2']
      }
    };

    const document = buildParsedDocument({ archive, media });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages[0]?.blocks.map((block) => block.kind)).toEqual([
      'drawable',
      'paragraphs',
      'drawable',
      'paragraphs'
    ]);
    expect(document.pages[0]?.blocks[1]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      ' Alpha '
    ]);
    expect(document.pages[0]?.blocks[3]?.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      ' Beta'
    ]);

    const itemNames = document.pages[0]?.canvas.slide.items.map((item) => item.name ?? '') ?? [];
    expect(itemNames).toHaveLength(4);
    expect(itemNames[0]).not.toBe('Body');
    expect(itemNames[1]).toBe('Body');
    expect(itemNames[2]).not.toBe('Body');
    expect(itemNames[3]).toBe('Body');
    const bodyItems = document.pages[0]?.canvas.slide.items.filter(
      (item) => item.kind === 'text' && item.name === 'Body'
    ) ?? [];
    expect(bodyItems.map((item) =>
      item.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    )).toEqual([
      [' Alpha '],
      [' Beta']
    ]);
  });

  it('renders Keynote pencil annotations and grouped drawing children', () => {
    const archive = createEmptyArchive();
    archive.records['1'] = {
      id: 1, archiveId: 1, messageIndex: 0, typeId: 1, typeName: 'KN.DocumentArchive',
      objectReferences: [2], dataReferences: [], value: { show: { identifier: 2 } }
    };
    archive.records['2'] = {
      id: 2, archiveId: 1, messageIndex: 1, typeId: 2, typeName: 'KN.ShowArchive',
      objectReferences: [3], dataReferences: [], value: {
        slideTree: { slides: [{ identifier: 3 }] }, size: { width: 1024, height: 768 }
      }
    };
    archive.records['3'] = {
      id: 3, archiveId: 1, messageIndex: 2, typeId: 4, typeName: 'KN.SlideNodeArchive',
      objectReferences: [10], dataReferences: [], value: { slide: { identifier: 10 } }
    };
    archive.records['10'] = {
      id: 10, archiveId: 1, messageIndex: 3, typeId: 5, typeName: 'KN.SlideArchive',
      objectReferences: [20, 22, 30], dataReferences: [], value: {
        drawablesZOrder: [{ identifier: 20 }, { identifier: 22 }, { identifier: 30 }],
        ownedDrawables: [{ identifier: 20 }, { identifier: 22 }, { identifier: 30 }]
      }
    };
    archive.records['20'] = {
      id: 20, archiveId: 1, messageIndex: 4, typeId: 3008, typeName: 'TSD.GroupArchive',
      objectReferences: [21], dataReferences: [], value: {
        super: { geometry: { position: { x: 50, y: 60 }, size: { width: 300, height: 200 } } },
        children: [{ identifier: 21 }]
      }
    };
    archive.records['21'] = {
      id: 21, archiveId: 1, messageIndex: 5, typeId: 3004, typeName: 'TSD.ShapeArchive',
      objectReferences: [], dataReferences: [], value: {
        super: { geometry: { position: { x: 80, y: 90 }, size: { width: 120, height: 80 } } },
        pathsource: {
          path: { elements: [
            { type: 1, points: [{ x: 0, y: 0 }] },
            { type: 2, points: [{ x: 120, y: 80 }] }
          ] },
          naturalSize: { width: 120, height: 80 }
        }
      }
    };
    archive.records['22'] = {
      id: 22, archiveId: 1, messageIndex: 6, typeId: 3008, typeName: 'TSD.GroupArchive',
      objectReferences: [23], dataReferences: [], value: {
        super: { geometry: { position: { x: 200, y: 210 }, size: { width: 90, height: 70 } } },
        '.TSD.freehandDrawingArchive': { spacerShape: { identifier: 23 }, opacity: 0.5 }
      }
    };
    archive.records['23'] = {
      id: 23, archiveId: 1, messageIndex: 7, typeId: 3004, typeName: 'TSD.ShapeArchive',
      objectReferences: [], dataReferences: [], value: {
        super: { geometry: { position: { x: 210, y: 220 }, size: { width: 60, height: 40 } } },
        pathsource: {
          path: { elements: [
            { type: 1, points: [{ x: 0, y: 40 }] },
            { type: 2, points: [{ x: 60, y: 0 }] }
          ] },
          naturalSize: { width: 60, height: 40 }
        }
      }
    };
    archive.records['30'] = {
      id: 30, archiveId: 1, messageIndex: 8, typeId: 3002, typeName: 'TSD.DrawableArchive',
      objectReferences: [31, 32], dataReferences: [], value: {
        geometry: { position: { x: 100, y: 120 }, size: { width: 400, height: 300 } },
        pencilAnnotations: [{ identifier: 31 }]
      }
    };
    archive.records['31'] = {
      id: 31, archiveId: 1, messageIndex: 9, typeId: 3086, typeName: 'TSD.PencilAnnotationArchive',
      objectReferences: [32], dataReferences: [], value: { pencilAnnotationStorage: { identifier: 32 } }
    };
    archive.records['32'] = {
      id: 32, archiveId: 1, messageIndex: 10, typeId: 242, typeName: 'TSD.PencilAnnotationStorageArchive',
      objectReferences: [], dataReferences: [], value: {
        drawingPath: { elements: [
          { type: 1, points: [{ x: 0, y: 0 }] },
          { type: 2, points: [{ x: 100, y: 50 }] }
        ] },
        strokesBoundingBoxOrigin: { x: 20, y: 30 },
        strokesBoundingBoxSize: { width: 100, height: 50 },
        penColor: { r: 1, g: 0, b: 0, a: 0.75 },
        toolType: 0,
        pencilAnnotationDrawingScale: 1.5
      }
    };

    const document = buildParsedDocument({ archive, media: {} });
    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const items = document.slides[0]?.slide.items ?? [];
    const drawing = items.find((item) => item.name === 'Pencil annotation');
    expect(drawing).toMatchObject({
      kind: 'shape',
      transform: { x: 120, y: 150, width: 100, height: 50 },
      line: { color: '#ff0000', alpha: 0.75, width: 3 }
    });
    expect(items.some((item) => item.kind === 'shape' && item.transform.x === 80 && item.transform.y === 90)).toBe(true);
    expect(items.find((item) => item.kind === 'shape' && item.transform.x === 210 && item.transform.y === 220)).toMatchObject({
      opacity: 0.5
    });
  });
});
