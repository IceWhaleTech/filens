import { describe, expect, it } from 'vitest';
import { buildTextFrameFromStorage, pathSourceToGeometry } from '../src/parser/helpers';
import type { IworkArchiveIndex, IworkArchiveRecord } from '../src/types';

function createArchive(records: IworkArchiveRecord[]): IworkArchiveIndex {
  return {
    type: 'pages',
    records: Object.fromEntries(records.map((record) => [String(record.id), record])),
    references: {
      outgoing: {},
      incoming: {}
    },
    dataEntries: {},
    warnings: []
  };
}

function createRecord(id: number, typeName: string, value: unknown): IworkArchiveRecord {
  return {
    id,
    archiveId: 1,
    messageIndex: id,
    typeId: id,
    typeName,
    value,
    objectReferences: [],
    dataReferences: []
  };
}

function buildStorage(text: string, attachmentIds: number[]) {
  const attachmentIndexes = Array.from(text.matchAll(/\uFFFC/g), (match) => match.index ?? -1);
  return {
    text: [text],
    tableAttachment: {
      entries: attachmentIndexes.map((characterIndex, index) => ({
        characterIndex,
        object: { identifier: attachmentIds[index] }
      }))
    }
  };
}

describe('buildTextFrameFromStorage', () => {
  it('renders smart field attachments as visible text', () => {
    const text = 'Link: \uFFFC\nMerge: \uFFFC\nBookmark: \uFFFC\nTOC: \uFFFC';
    const archive = createArchive([
      createRecord(1, 'TSWP.HyperlinkFieldArchive', {
        super: {
          textAttributeUuidString: 'link-style'
        },
        urlRef: 'https://example.com'
      }),
      createRecord(2, 'TSWP.MergeSmartFieldArchive', {
        super: {
          super: {
            textAttributeUuidString: 'merge-style'
          },
          scriptTag: 'contact_name'
        },
        contactsLabel: 'Client Name'
      }),
      createRecord(3, 'TSWP.BookmarkFieldArchive', {
        super: {
          textAttributeUuidString: 'bookmark-style'
        },
        name: 'Chapter 1'
      }),
      createRecord(4, 'TSWP.TOCSmartFieldArchive', {
        super: {
          super: {
            textAttributeUuidString: 'toc-style'
          },
          scriptTag: 'table_of_contents'
        },
        tocEntries: [
          { bookmarkName: 'Intro' },
          { bookmarkName: 'Agenda' }
        ]
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [1, 2, 3, 4]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Link: https://example.com',
      'Merge: Client Name',
      'Bookmark: Chapter 1',
      'TOC: Intro, Agenda'
    ]);
  });

  it('renders snake_case smart field attachment properties as visible text', () => {
    const text = 'Link: \uFFFC\nLegacy link: \uFFFC\nMerge: \uFFFC\nRuby: \uFFFC';
    const archive = createArchive([
      createRecord(20, 'TSWP.HyperlinkFieldArchive', {
        url_ref: 'https://example.com/snake'
      }),
      createRecord(21, 'TSWP.UnsupportedHyperlinkFieldArchive', {
        url_original_ref: 'https://legacy.example.com/snake'
      }),
      createRecord(22, 'TSWP.MergeSmartFieldArchive', {
        contacts_label: 'Snake Client'
      }),
      createRecord(23, 'TSWP.RubyFieldArchive', {
        ruby_text: 'ふりがな'
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [20, 21, 22, 23]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Link: https://example.com/snake',
      'Legacy link: https://legacy.example.com/snake',
      'Merge: Snake Client',
      'Ruby: ふりがな'
    ]);
  });

  it('falls back through smart field super chains when direct display text is missing', () => {
    const text = 'File: \uFFFC\nLegacy link: \uFFFC';
    const archive = createArchive([
      createRecord(5, 'TSWP.FilenameSmartFieldArchive', {
        super: {
          super: {
            textAttributeUuidString: 'file-style'
          },
          scriptTag: 'document_name'
        }
      }),
      createRecord(6, 'TSWP.UnsupportedHyperlinkFieldArchive', {
        super: {
          super: {
            textAttributeUuidString: 'legacy-link-style'
          },
          scriptTag: 'legacy_link'
        },
        urlOriginalRef: 'https://legacy.example.com'
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [5, 6]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'File: document_name',
      'Legacy link: https://legacy.example.com'
    ]);
  });

  it('falls back through snake_case old_super smart field chains when direct display text is missing', () => {
    const text = 'Legacy bookmark: \uFFFC';
    const archive = createArchive([
      createRecord(19, 'TSWP.BookmarkFieldArchive', {
        old_super: {
          name: 'Legacy Section Anchor'
        }
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [19]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Legacy bookmark: Legacy Section Anchor'
    ]);
  });

  it('prefers archive source name for filename smart fields', () => {
    const text = 'File: \uFFFC';
    const archive = createArchive([
      createRecord(18, 'TSWP.FilenameSmartFieldArchive', {
        super: {
          super: {
            textAttributeUuidString: 'file-style'
          },
          scriptTag: 'document_name'
        }
      })
    ]);
    archive.sourceName = 'Quarterly Report.pages';

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [18]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'File: Quarterly Report'
    ]);
  });

  it('renders footnote, citation, bibliography, and ruby attachments as visible text', () => {
    const text = 'Footnote: \uFFFC\nCitation: \uFFFC\nBibliography: \uFFFC\nRuby: \uFFFC';
    const archive = createArchive([
      createRecord(7, 'TSWP.FootnoteReferenceAttachmentArchive', {
        super: {
          stringEquivalent: ''
        },
        customMarkString: '†'
      }),
      createRecord(8, 'TSWP.CitationRecordArchive', {
        authorsString: 'Ada Lovelace',
        year: '1843',
        title: 'Sketch of the Analytical Engine',
        pageRange: '12-18',
        prefix: 'see',
        suffix: 'n.1'
      }),
      createRecord(9, 'TSWP.CitationSmartFieldArchive', {
        citationRecords: [{ identifier: 8 }]
      }),
      createRecord(10, 'TSWP.CitationRecordArchive', {
        authorsString: 'Grace Hopper',
        year: '1952',
        title: 'The Education of a Computer'
      }),
      createRecord(11, 'TSWP.BibliographySmartFieldArchive', {
        citationRecords: [{ identifier: 10 }]
      }),
      createRecord(12, 'TSWP.RubyFieldArchive', {
        rubyText: 'ふりがな'
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [7, 9, 11, 12]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Footnote: †',
      'Citation: see Ada Lovelace, 1843, Sketch of the Analytical Engine, 12-18 n.1',
      'Bibliography: Grace Hopper, 1952, The Education of a Computer',
      'Ruby: ふりがな'
    ]);
  });

  it('formats DateTime smart fields with extended Apple-style date tokens', () => {
    const text = 'DateTime: \uFFFC';
    const archive = createArchive([
      createRecord(13, 'TSWP.DateTimeSmartFieldArchive', {
        format: "YYYY-'Q'Q LLLL dd EEEE DDD ww HH:mm:ss",
        localeIdentifier: 'en_US',
        date: {
          seconds: 731340429
        }
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [13]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'DateTime: 2024-Q1 March 05 Tuesday 065 10 14:07:09'
    ]);
  });

  it('reads smart fields from parallel storage attribute tables instead of only tableAttachment', () => {
    const archive = createArchive([
      createRecord(14, 'TSWP.BookmarkFieldArchive', {
        name: 'Section Anchor'
      }),
      createRecord(15, 'TSWP.DateTimeSmartFieldArchive', {
        format: 'yyyy-MM-dd',
        date: {
          seconds: 731340429
        }
      }),
      createRecord(16, 'TSWP.FootnoteReferenceAttachmentArchive', {
        customMarkString: '‡'
      }),
      createRecord(17, 'TSWP.RubyFieldArchive', {
        rubyText: 'ルビ'
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, {
      text: ['Bookmark \uFFFC Date \uFFFC Footnote \uFFFC Ruby \uFFFC'],
      tableBookmark: {
        entries: [
          {
            characterIndex: 9,
            object: { identifier: 14 }
          }
        ]
      },
      tableSmartfield: {
        entries: [
          {
            characterIndex: 16,
            object: { identifier: 15 }
          }
        ]
      },
      tableFootnote: {
        entries: [
          {
            characterIndex: 27,
            object: { identifier: 16 }
          }
        ]
      },
      tableRubyfield: {
        entries: [
          {
            characterIndex: 34,
            object: { identifier: 17 }
          }
        ]
      }
    });

    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Bookmark Section Anchor Date 2024-03-05 Footnote ‡ Ruby ルビ'
    ]);
  });

  it('merges entries from multiple storage object tables in character order', () => {
    const archive = createArchive([
      createRecord(18, 'TSWP.BookmarkFieldArchive', {
        name: 'Bookmark'
      }),
      createRecord(19, 'TSWP.DateTimeSmartFieldArchive', {
        format: 'yyyy-MM-dd',
        date: {
          seconds: 731340429
        }
      }),
      createRecord(20, 'TSWP.FootnoteReferenceAttachmentArchive', {
        customMarkString: '*'
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, {
      text: ['A \uFFFC B \uFFFC C \uFFFC'],
      tableFootnote: {
        entries: [
          {
            characterIndex: 10,
            object: { identifier: 20 }
          }
        ]
      },
      tableBookmark: {
        entries: [
          {
            characterIndex: 2,
            object: { identifier: 18 }
          }
        ]
      },
      tableSmartfield: {
        entries: [
          {
            characterIndex: 6,
            object: { identifier: 19 }
          }
        ]
      }
    });

    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'A Bookmark B 2024-03-05 C *'
    ]);
  });

  it('supports snake_case text style and attachment fields', () => {
    const archive = createArchive([
      createRecord(1, 'TSWP.BookmarkFieldArchive', {
        name: 'Snake Bookmark'
      }),
      createRecord(2, 'TSWP.ParagraphStyleArchive', {
        char_properties: {
          font_size: 18,
          font_name: 'Alias Font',
          font_color: { r: 1, g: 0, b: 0, a: 1 }
        },
        para_properties: {
          alignment: 2,
          outline_level: 1,
          left_indent: 11,
          first_line_indent: 5,
          space_before: 3,
          space_after: 4,
          list_style_null: true
        }
      }),
      createRecord(3, 'TSWP.CharacterStyleArchive', {
        char_properties: {
          italic: true,
          baseline_shift: 1,
          font_color: { r: 0, g: 0, b: 1, a: 1 }
        }
      })
    ]);

    const textFrame = buildTextFrameFromStorage(archive, {
      text: ['A \uFFFC styled'],
      table_attachment: {
        entries: [
          {
            character_index: 2,
            object: { identifier: 1 }
          }
        ]
      },
      table_para_style: {
        entries: [
          {
            character_index: 0,
            object: { identifier: 2 }
          }
        ]
      },
      table_char_style: {
        entries: [
          {
            character_index: 4,
            object: { identifier: 3 }
          }
        ]
      }
    });

    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs).toHaveLength(1);
    expect(textFrame?.paragraphs[0]).toMatchObject({
      align: 'center',
      level: 1,
      marginLeft: 11,
      indent: 5,
      spaceBefore: 3,
      spaceAfter: 4
    });
    expect(textFrame?.paragraphs[0]?.runs).toMatchObject([
      {
        text: 'A Snake Bookmark ',
        fontSize: 18,
        fontFamily: 'Alias Font',
        color: '#ff0000'
      },
      {
        text: 'styled',
        italic: true,
        baselineShift: 1,
        fontSize: 18,
        fontFamily: 'Alias Font',
        color: '#0000ff'
      }
    ]);
  });

  it('supports snake_case smart field, attachment, and package metadata fields', () => {
    const text = 'Number: \uFFFC\nFootnote: \uFFFC\nTOC: \uFFFC\nDateTime: \uFFFC\nFile: \uFFFC';
    const archive = createArchive([
      createRecord(30, 'TSWP.NumberAttachmentArchive', {
        string_value: '42'
      }),
      createRecord(31, 'TSWP.FootnoteReferenceAttachmentArchive', {
        super: {
          string_equivalent: ''
        },
        custom_mark_string: '§'
      }),
      createRecord(32, 'TSWP.TOCSmartFieldArchive', {
        super: {
          script_tag: 'table_of_contents'
        },
        toc_entries: [
          { bookmark_name: 'Overview' },
          { bookmark_name: 'Results' }
        ]
      }),
      createRecord(33, 'TSWP.DateTimeSmartFieldArchive', {
        format: 'LLLL dd, YYYY',
        locale_identifier: 'en_US',
        date: {
          seconds: 731340429
        }
      }),
      createRecord(34, 'TSWP.FilenameSmartFieldArchive', {
        super: {
          script_tag: 'document_name'
        }
      })
    ]);
    archive.packageMetadata = {
      preferred_file_name: 'Snake Case Report.pages'
    };

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [30, 31, 32, 33, 34]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'Number: 42',
      'Footnote: §',
      'TOC: Overview, Results',
      'DateTime: March 05, 2024',
      'File: Snake Case Report'
    ]);
  });

  it('falls back to snake_case document resource locator for filename smart fields', () => {
    const text = 'File: \uFFFC';
    const archive = createArchive([
      createRecord(40, 'TSWP.FilenameSmartFieldArchive', {
        super: {
          script_tag: 'document_name'
        }
      })
    ]);
    archive.packageMetadata = {
      datas: [
        {
          document_resource_locator: 'black/QuarterlySummary'
        }
      ]
    };

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [40]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'File: QuarterlySummary'
    ]);
  });

  it('supports snake_case DateTime style fields and package display names', () => {
    const text = 'DateTime: \uFFFC\nFile: \uFFFC';
    const archive = createArchive([
      createRecord(41, 'TSWP.DateTimeSmartFieldArchive', {
        date_style: 2,
        locale_identifier: 'en_US',
        date: {
          seconds: 731340429
        }
      }),
      createRecord(42, 'TSWP.FilenameSmartFieldArchive', {
        super: {
          script_tag: 'document_name'
        }
      })
    ]);
    archive.packageMetadata = {
      display_name: 'Snake Display.pages'
    };

    const textFrame = buildTextFrameFromStorage(archive, buildStorage(text, [41, 42]));
    expect(textFrame).toBeTruthy();
    expect(textFrame?.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual([
      'DateTime: Mar 5, 2024',
      'File: Snake Display'
    ]);
  });

  it('maps text-frame layout hints from shape property aliases', () => {
    const archive = createArchive([]);
    const verticalFrame = buildTextFrameFromStorage(
      archive,
      {
        text: ['Vertical columns']
      },
      {
        shapeProperties: {
          shrink_to_fit: true,
          vertical_text: true,
          columns: {
            equal_columns: {
              count: 2
            }
          }
        }
      }
    );

    expect(verticalFrame).toMatchObject({
      direction: 'vertical',
      columns: 2,
      autofit: {
        type: 'normal'
      }
    });

    const rotatedFrame = buildTextFrameFromStorage(
      archive,
      {
        text: ['Rotated vertical']
      },
      {
        shapeProperties: {
          verticalText40: true
        }
      }
    );

    expect(rotatedFrame?.direction).toBe('vertical270');
  });

  it('supports snake_case bezier path sources', () => {
    const geometry = pathSourceToGeometry({
      bezier_path_source: {
        path: {
          elements: [
            {
              type: 1,
              points: [{ x: 0, y: 0 }]
            },
            {
              type: 2,
              points: [{ x: 100, y: 0 }]
            },
            {
              type: 2,
              points: [{ x: 100, y: 50 }]
            },
            {
              type: 5,
              points: []
            }
          ]
        },
        natural_size: {
          width: 100,
          height: 50
        }
      }
    }, 100, 50);

    expect(geometry).toMatchObject({
      type: 'custom',
      paths: [
        {
          width: 100,
          height: 50,
          commands: [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 100, y: 0 },
            { type: 'L', x: 100, y: 50 },
            { type: 'Z' }
          ]
        }
      ]
    });
  });

  it('supports snake_case editable bezier path source containers', () => {
    const geometry = pathSourceToGeometry({
      editable_bezier_path_source: {
        subpaths: [
          {
            closed: true,
            nodes: [
              {
                node_point: { x: 0, y: 0 },
                out_control_point: { x: 0, y: 0 }
              },
              {
                node_point: { x: 80, y: 40 },
                in_control_point: { x: 80, y: 40 }
              }
            ]
          }
        ]
      }
    }, 80, 40);

    expect(geometry).toMatchObject({
      type: 'custom',
      paths: [
        {
          width: 80,
          height: 40,
          commands: [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 80, y: 40 },
            { type: 'Z' }
          ]
        }
      ]
    });
  });
});
