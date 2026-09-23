import { describe, expect, it, vi } from 'vitest';
import type { ImageItem, MediaItem, ParsedPresentation, ShapeItem, SlideModel, TableItem, TextItem, UnsupportedItem } from '../src/types';
import { MediaRegistry, renderSlideToElement } from '../src/render/dom';
import { loadPptx } from '../src/parser/load-pptx';
import { fixtureExists, readFixture } from './helpers';

const BULLET = '\u2022';
const SOFT_HYPHEN = '\u00AD';
const NO_BREAK_HYPHEN = '\u2011';

describe('renderSlideToElement', () => {
  it('renders bullet paragraph spacing and indentation styles', () => {
    const slide = createBaseSlide([
      {
        id: 'text-1',
        kind: 'text',
        name: 'Bulleted text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              align: 'left',
              bullet: {
                char: BULLET
              },
              marginLeft: 20,
              indent: -10,
              spaceBefore: 12,
              spaceAfter: 8,
              lineHeight: 1.25,
              lineHeightUnit: 'multiple',
              runs: [
                {
                  text: 'Bullet paragraph'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph');
    const bullet = rendered.querySelector('.pptxv-run--bullet');

    expect(paragraph?.style.paddingLeft).toBe('20px');
    expect(paragraph?.style.textIndent).toBe('0px');
    expect(paragraph?.style.marginTop).toBe('12px');
    expect(paragraph?.style.marginBottom).toBe('8px');
    expect(paragraph?.style.lineHeight).toBe('1.25');
    expect(paragraph?.style.fontSize).toBe('16px');
    expect(bullet?.textContent).toBe(BULLET);
    expect(bullet?.style.width).toBe('10px');
    expect(bullet?.style.boxSizing).toBe('border-box');
    expect(bullet?.style.marginLeft).toBe('-10px');
  });

  it('applies paragraph default font size while using portable fallbacks for Office theme fonts and bullets', () => {
    const slide = createBaseSlide([
      {
        id: 'text-paragraph-default-font',
        kind: 'text',
        name: 'Paragraph defaults',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: BULLET,
                fontFamily: 'Wingdings'
              },
              runs: [
                {
                  text: 'Inherited paragraph font',
                  fontSize: 24,
                  fontFamily: '等线'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(paragraph?.style.fontSize).toBe('24px');
    expect(paragraph?.style.lineHeight).toBe('1');
    expect(paragraph?.style.fontFamily).not.toContain('DengXian');
    expect(paragraph?.style.fontFamily).toContain('Segoe UI');
    expect(bullet?.style.fontFamily).toContain('Segoe UI Symbol');
  });

  it.skipIf(!fixtureExists('../../tmp/feed-flow-phase1.pptx'))('decodes TIFF media to a PNG data URL for browser rendering', async () => {
    const bytes = await readFixture('../../tmp/feed-flow-phase1.pptx');
    const presentation = await loadPptx(bytes);
    const registry = new MediaRegistry(presentation);
    const originalCreateElement = document.createElement.bind(document);
    const putImageData = vi.fn();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4)
        }),
        putImageData
      })),
      toDataURL: vi.fn(() => 'data:image/png;base64,tiff-decoded')
    } as unknown as HTMLCanvasElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') {
        return mockCanvas;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    try {
      const url = registry.getUrl('ppt/media/image1.tif');

      expect(url).toBe('data:image/png;base64,tiff-decoded');
      expect(mockCanvas.width).toBeGreaterThan(0);
      expect(mockCanvas.height).toBeGreaterThan(0);
      expect(putImageData).toHaveBeenCalledTimes(1);
      expect(registry.getUrl('ppt/media/image1.tif')).toBe(url);
    } finally {
      createElementSpy.mockRestore();
      registry.destroy();
    }
  });

  it('does not omit visible Arial bullet markers on large list paragraphs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-large-arial-bullet',
        kind: 'text',
        name: 'Large Arial bullet',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: BULLET,
                fontFamily: 'Arial'
              },
              marginLeft: 24,
              indent: -24,
              runs: [
                {
                  text: 'Large visible bullet',
                  fontSize: 32,
                  fontFamily: 'Arial'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(bullet?.textContent).toBe(BULLET);
  });

  it('omits placeholder-like default Arial bullet markers while preserving hanging indents', () => {
    const slide = createBaseSlide([
      {
        id: 'text-placeholder-arial-bullet',
        kind: 'text',
        name: 'Content Placeholder 2',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: BULLET,
                fontFamily: 'Arial'
              },
              marginLeft: 24,
              indent: -24,
              runs: [
                {
                  text: 'Placeholder body line',
                  fontSize: 32,
                  fontFamily: '绛夌嚎'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(bullet).toBeNull();
    expect(paragraph?.textContent).toBe('Placeholder body line');
    expect(paragraph?.style.paddingLeft).toBe('24px');
    expect(paragraph?.style.textIndent).toBe('-24px');
  });

  it('applies reference-like negative letter spacing to standalone latin runs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-latin-letter-spacing',
        kind: 'text',
        name: 'Latin letter spacing',
        transform: {
          x: 0,
          y: 0,
          width: 420,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'pptxPreview',
                  fontSize: 60,
                  fontFamily: '等线 Light'
                },
                {
                  text: '能力测试',
                  fontSize: 60,
                  fontFamily: '等线 Light'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const runs = rendered.querySelectorAll('.pptxv-run');

    expect((runs[0] as HTMLSpanElement | undefined)?.style.letterSpacing).toBe('-0.04em');
    expect((runs[1] as HTMLSpanElement | undefined)?.style.letterSpacing).toBe('');
  });

  it('keeps theme font stacks intact for latin runs inside mixed CJK titles', () => {
    const slide = createBaseSlide([
      {
        id: 'text-mixed-script-title-font-stack',
        kind: 'text',
        name: 'Mixed script title font stack',
        transform: {
          x: 0,
          y: 0,
          width: 420,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Smart',
                  fontSize: 24,
                  fontFamily: '绛夌嚎',
                  bold: true
                },
                {
                  text: ' Art测试',
                  fontSize: 24,
                  fontFamily: '绛夌嚎',
                  bold: true
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const runs = rendered.querySelectorAll('.pptxv-run');

    const mixedRun = runs[0] as HTMLSpanElement | undefined;
    expect(mixedRun?.style.fontFamily).toContain('Segoe UI');
    expect(mixedRun?.style.letterSpacing).toBe('');
  });

  it('prefers proportional fallbacks before system monospace for mixed CJK Roboto Mono prose', () => {
    const slide = createBaseSlide([
      {
        id: 'text-mixed-cjk-roboto-mono-prose',
        kind: 'text',
        name: 'Mixed CJK Roboto Mono prose',
        transform: {
          x: 0,
          y: 0,
          width: 420,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'request和response都可以流式传输',
                  fontSize: 16,
                  fontFamily: 'Roboto Mono'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;
    const fontFamily = run?.style.fontFamily ?? '';

    expect(fontFamily).toContain('"Roboto Mono"');
    expect(fontFamily).toContain(', Roboto,');
    expect(fontFamily).toContain('"Segoe UI"');
    expect(fontFamily.indexOf(', Roboto,')).toBeLessThan(fontFamily.indexOf('"Cascadia Mono"'));
  });

  it('prefers proportional fallbacks for sentence-like Roboto Mono english prose while keeping code-capable fallbacks later', () => {
    const slide = createBaseSlide([
      {
        id: 'text-roboto-mono-english-prose',
        kind: 'text',
        name: 'Roboto Mono english prose',
        transform: {
          x: 0,
          y: 0,
          width: 420,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'response without request',
                  fontSize: 16,
                  fontFamily: 'Roboto Mono'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;
    const fontFamily = run?.style.fontFamily ?? '';

    expect(fontFamily).toContain(', Roboto,');
    expect(fontFamily.indexOf(', Roboto,')).toBeLessThan(fontFamily.indexOf('"Cascadia Mono"'));
  });

  it('keeps system monospace fallbacks ahead of proportional sans for code-like Roboto Mono text', () => {
    const slide = createBaseSlide([
      {
        id: 'text-roboto-mono-code-like',
        kind: 'text',
        name: 'Roboto Mono code like',
        transform: {
          x: 0,
          y: 0,
          width: 420,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'go test ./...',
                  fontSize: 16,
                  fontFamily: 'Roboto Mono'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;
    const fontFamily = run?.style.fontFamily ?? '';

    expect(fontFamily.indexOf('"Cascadia Mono"')).toBeGreaterThan(-1);
    expect(fontFamily.indexOf(', Roboto,')).toBeGreaterThan(fontFamily.indexOf('"Cascadia Mono"'));
  });

  it('prefers symbol fonts for portable unicode bullets even when the pptx requests a text font', () => {
    const slide = createBaseSlide([
      {
        id: 'text-portable-unicode-bullet-font',
        kind: 'text',
        name: 'Portable unicode bullet',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: '\u25CB',
                fontFamily: 'Roboto Mono'
              },
              runs: [
                {
                  text: 'Portable unicode bullet',
                  fontSize: 12,
                  fontFamily: 'Roboto Mono'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(bullet?.dataset.resolvedLabel ?? bullet?.textContent).toBe('\u25CB');
    expect(bullet?.querySelector('svg')).not.toBeNull();
    expect(bullet?.style.fontFamily).toContain('Segoe UI Symbol');
    expect(bullet?.style.fontFamily).not.toContain('Roboto Mono');
  });

  it('sizes bullet boxes from hanging indents for nested bullet paragraphs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-nested-bullet-indent',
        kind: 'text',
        name: 'Nested bullet indent',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: 'n',
                fontFamily: 'Wingdings'
              },
              marginLeft: 78,
              indent: -30,
              runs: [{ text: 'Nested bullet item', fontSize: 18 }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(paragraph?.style.paddingLeft).toBe('78px');
    expect(paragraph?.style.textIndent).toBe('0px');
    expect(bullet?.style.width).toBe('30px');
    expect(bullet?.style.marginLeft).toBe('-30px');
  });

  it('does not force lighter font weights from light family names', () => {
    const slide = createBaseSlide([
      {
        id: 'text-light-font-weight',
        kind: 'text',
        name: 'Light font weight',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Light title',
                  fontSize: 44,
                  fontFamily: 'DengXian Light'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(paragraph?.style.fontWeight).toBe('');
    expect(run?.style.fontWeight).toBe('');
  });

  it('applies a proportional synthetic light font weight when the exact light face is unavailable', () => {
    const originalCreateElement = document.createElement.bind(document);
    const targetFont = 'Mock Light Unavailable';
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() !== 'canvas') {
        return originalCreateElement(tagName);
      }

      const context = {
        _font: '',
        set font(value: string) {
          this._font = value;
        },
        get font() {
          return this._font;
        },
        measureText(_text: string) {
          const baseWidth = this._font.includes('sans-serif') ? 140 : this._font.includes('serif') ? 120 : 100;
          return { width: baseWidth };
        }
      };

      return {
        getContext: () => context
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const slide = createBaseSlide([
        {
          id: 'text-synthetic-light-weight',
          kind: 'text',
          name: 'Synthetic light weight',
          transform: {
            x: 0,
            y: 0,
            width: 320,
            height: 100,
            rotation: 0,
            flipH: false,
            flipV: false
          },
          fill: {
            type: 'none'
          },
          order: 1,
          groupPath: [],
          textFrame: {
            verticalAlign: 'top',
            padding: {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0
            },
            paragraphs: [
              {
                runs: [
                  {
                    text: 'Synthetic light title',
                    fontSize: 44,
                    fontFamily: targetFont
                  }
                ]
              }
            ]
          }
        } satisfies TextItem
      ]);

      const rendered = renderSlideToElement(slide, createPresentation(slide));
      const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
      const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

      expect(paragraph?.style.fontWeight).toBe('310');
      expect(run?.style.fontWeight).toBe('310');
    } finally {
      createElementSpy.mockRestore();
    }
  });

  it('applies proportional synthetic semibold weights when an exact weighted face is unavailable', () => {
    const originalCreateElement = document.createElement.bind(document);
    const targetFont = 'Mock Semibold Unavailable';
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() !== 'canvas') {
        return originalCreateElement(tagName);
      }

      const context = {
        _font: '',
        set font(value: string) {
          this._font = value;
        },
        get font() {
          return this._font;
        },
        measureText(_text: string) {
          const baseWidth = this._font.includes('sans-serif') ? 140 : this._font.includes('serif') ? 120 : 100;
          return { width: baseWidth };
        }
      };

      return {
        getContext: () => context
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const slide = createBaseSlide([
        {
          id: 'text-synthetic-semibold-weight',
          kind: 'text',
          name: 'Synthetic semibold weight',
          transform: {
            x: 0,
            y: 0,
            width: 320,
            height: 100,
            rotation: 0,
            flipH: false,
            flipV: false
          },
          fill: {
            type: 'none'
          },
          order: 1,
          groupPath: [],
          textFrame: {
            verticalAlign: 'top',
            padding: {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0
            },
            paragraphs: [
              {
                runs: [
                  {
                    text: 'Synthetic semibold title',
                    fontSize: 44,
                    fontFamily: targetFont
                  }
                ]
              }
            ]
          }
        } satisfies TextItem
      ]);

      const rendered = renderSlideToElement(slide, createPresentation(slide));
      const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
      const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

      expect(paragraph?.style.fontWeight).toBe('550');
      expect(run?.style.fontWeight).toBe('550');
    } finally {
      createElementSpy.mockRestore();
    }
  });

  it('keeps a real light face unweighted when the browser can distinguish it from generic fallbacks', () => {
    const originalCreateElement = document.createElement.bind(document);
    const targetFont = 'Mock Light Available';
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() !== 'canvas') {
        return originalCreateElement(tagName);
      }

      const context = {
        _font: '',
        set font(value: string) {
          this._font = value;
        },
        get font() {
          return this._font;
        },
        measureText(_text: string) {
          const baseWidth = this._font.includes('sans-serif') ? 140 : this._font.includes('serif') ? 120 : 100;
          const hasTarget = this._font.includes(`"${targetFont}"`) || this._font.includes(targetFont);
          return { width: hasTarget ? baseWidth + 12 : baseWidth };
        }
      };

      return {
        getContext: () => context
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const slide = createBaseSlide([
        {
          id: 'text-probed-light-weight',
          kind: 'text',
          name: 'Probed light weight',
          transform: {
            x: 0,
            y: 0,
            width: 320,
            height: 100,
            rotation: 0,
            flipH: false,
            flipV: false
          },
          fill: {
            type: 'none'
          },
          order: 1,
          groupPath: [],
          textFrame: {
            verticalAlign: 'top',
            padding: {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0
            },
            paragraphs: [
              {
                runs: [
                  {
                    text: 'Probed light title',
                    fontSize: 44,
                    fontFamily: targetFont
                  }
                ]
              }
            ]
          }
        } satisfies TextItem
      ]);

      const rendered = renderSlideToElement(slide, createPresentation(slide));
      const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
      const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

      expect(paragraph?.style.fontWeight).toBe('');
      expect(run?.style.fontWeight).toBe('');
    } finally {
      createElementSpy.mockRestore();
    }
  });

  it('does not render the real sample cover title with an extra inferred light font weight', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide = presentation.slides[0];

    const rendered = renderSlideToElement(slide, presentation);
    const titleShell = rendered.querySelector('[data-placeholder-type="title"]') as HTMLElement | null;
    const titleRuns = Array.from(titleShell?.querySelectorAll('.pptxv-run') ?? []) as HTMLSpanElement[];

    expect(titleRuns).toHaveLength(2);
    expect(titleRuns[0]?.textContent).toBe('pptxPreview');
    expect(titleRuns[1]?.textContent).toBe('能力测试');
    expect(titleRuns[0]?.style.fontWeight).toBe('');
    expect(titleRuns[1]?.style.fontWeight).toBe('');
  });

  it('uses system fallbacks for latin office-theme runs while keeping chinese office stacks in mixed paragraphs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-mixed-neutral-theme-run',
        kind: 'text',
        name: 'Mixed neutral theme run',
        transform: {
          x: 0,
          y: 0,
          width: 480,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'pptxPreview',
                  fontSize: 44,
                  fontFamily: 'DengXian Light'
                },
                {
                  text: '能力测试',
                  fontSize: 44,
                  fontFamily: 'DengXian Light'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const runs = Array.from(rendered.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];

    expect(paragraph?.style.fontFamily).toContain('Segoe UI');
    expect(paragraph?.style.fontFamily).toContain('Noto Sans');
    expect(runs[0]?.textContent).toBe('pptxPreview');
    expect(runs[0]?.style.fontFamily).toContain('Segoe UI');
    expect(runs[0]?.style.fontFamily).not.toContain('DengXian Light');
    expect(runs[0]?.style.fontFamily).not.toContain('Microsoft YaHei');
    expect(runs[1]?.textContent).toBe('能力测试');
    expect(runs[1]?.style.fontFamily).toContain('DengXian Light');
    expect(runs[1]?.style.fontFamily).toContain('Microsoft YaHei');
  });

  it('uses dominant visible run typography for paragraph defaults instead of the first short run', () => {
    const slide = createBaseSlide([
      {
        id: 'text-dominant-font',
        kind: 'text',
        name: 'Dominant paragraph font',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'A',
                  fontSize: 12,
                  fontFamily: 'Arial'
                },
                {
                  text: '主要标题内容',
                  fontSize: 28,
                  fontFamily: '绛夌嚎'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;

    expect(paragraph?.style.fontSize).toBe('28px');
    expect(paragraph?.style.fontFamily).toContain('Segoe UI');
    expect(paragraph?.style.fontFamily).toContain('Noto Sans');
  });

  it('adds script-aware fallback fonts for CJK text even when the declared font is latin-only', () => {
    const slide = createBaseSlide([
      {
        id: 'text-cjk-fallback',
        kind: 'text',
        name: 'CJK fallback text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: '中文内容',
                  fontSize: 20,
                  fontFamily: 'Aptos'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(run?.style.fontFamily).toContain('Aptos');
    expect(run?.style.fontFamily).toContain('Microsoft YaHei');
  });

  it('renders auto-numbered bullets with incrementing labels', () => {
    const slide = createBaseSlide([
      {
        id: 'text-ordered',
        kind: 'text',
        name: 'Ordered text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 140,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                autoType: 'arabicPeriod',
                startAt: 3
              },
              runs: [
                {
                  text: 'Third item'
                }
              ]
            },
            {
              bullet: {
                autoType: 'arabicPeriod'
              },
              runs: [
                {
                  text: 'Fourth item'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullets = Array.from(rendered.querySelectorAll('.pptxv-run--bullet')).map((node) => node.textContent);

    expect(bullets).toEqual(['3.', '4.']);
  });

  it('does not force inferred light font weight onto auto-number bullets', () => {
    const slide = createBaseSlide([
      {
        id: 'text-light-auto-bullets',
        kind: 'text',
        name: 'Light auto bullets',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 140,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                autoType: 'arabicPeriod',
                startAt: 1,
                fontFamily: 'DengXian Light'
              },
              runs: [{ text: 'First item', fontSize: 24, fontFamily: 'DengXian' }]
            },
            {
              bullet: {
                autoType: 'arabicPeriod',
                fontFamily: 'DengXian Light'
              },
              runs: [{ text: 'Second item', fontSize: 24, fontFamily: 'DengXian' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullets = Array.from(rendered.querySelectorAll('.pptxv-run--bullet')) as HTMLSpanElement[];

    expect(bullets.map((bullet) => bullet.textContent)).toEqual(['1.', '2.']);
    expect(bullets[0]?.style.fontWeight).toBe('');
    expect(bullets[1]?.style.fontWeight).toBe('');
  });

  it.skip('renders special bullet fonts and additional auto-number formats', () => {
    const slide = createBaseSlide([
      {
        id: 'text-special-bullets',
        kind: 'text',
        name: 'Special bullets',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 160,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: 'n',
                fontFamily: 'Wingdings'
              },
              runs: [{ text: 'Wingdings bullet' }]
            },
            {
              bullet: {
                autoType: 'circleNumDbPlain',
                startAt: 2
              },
              runs: [{ text: 'Circled number' }]
            },
            {
              bullet: {
                autoType: 'ea1JpnChsDbPeriod',
                startAt: 3
              },
              runs: [{ text: 'CJK number' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullets = Array.from(rendered.querySelectorAll('.pptxv-run--bullet')) as HTMLSpanElement[];

    expect(bullets[0]?.style.fontFamily).toContain('Segoe UI Symbol');
    expect(bullets[0]?.textContent).toBe('■');
    expect(bullets[1]?.textContent).toBe('②');
    expect(bullets[2]?.textContent).toBe('三.');
  });

  it('renders symbol-font bullets with mapped portable glyphs and additional auto-number formats', () => {
    const slide = createBaseSlide([
      {
        id: 'text-special-bullets-symbol-font',
        kind: 'text',
        name: 'Special bullets symbol font',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 160,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: 'n',
                fontFamily: 'Wingdings'
              },
              runs: [{ text: 'Wingdings bullet' }]
            },
            {
              bullet: {
                autoType: 'circleNumDbPlain',
                startAt: 2
              },
              runs: [{ text: 'Circled number' }]
            },
            {
              bullet: {
                autoType: 'ea1JpnChsDbPeriod',
                startAt: 3
              },
              runs: [{ text: 'CJK number' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullets = Array.from(rendered.querySelectorAll('.pptxv-run--bullet')) as HTMLSpanElement[];

    expect(bullets[0]?.style.fontFamily).toContain('Segoe UI Symbol');
    expect(bullets[0]?.dataset.resolvedLabel).toBe('\u25A0');
    expect(bullets[0]?.querySelector('svg')).not.toBeNull();
    expect(bullets[1]?.textContent).toBe('\u2461');
    expect(bullets[2]?.textContent).toBe('\u4E09.');
  });

  it.skip('renders Wingdings check bullets with mapped glyph and paragraph text color', () => {
    const slide = createBaseSlide([
      {
        id: 'text-wingdings-check',
        kind: 'text',
        name: 'Wingdings check',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: '\u00FC',
                fontFamily: 'Wingdings'
              },
              runs: [{ text: 'Checklist item', color: '#000000' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(bullet?.dataset.resolvedLabel).toBe('\u2714');
    expect(bullet?.querySelector('svg')).not.toBeNull();
    expect(bullet?.style.color).toBe('rgb(0, 0, 0)');
    expect(bullet?.style.fontFamily).toContain('Segoe UI Symbol');
  });

  it('renders Wingdings check bullets with mapped glyph and paragraph text color', () => {
    const slide = createBaseSlide([
      {
        id: 'text-wingdings-check-portable-glyph',
        kind: 'text',
        name: 'Wingdings check portable glyph',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: '\u00FC',
                fontFamily: 'Wingdings'
              },
              runs: [{ text: 'Checklist item', color: '#000000' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(bullet?.dataset.resolvedLabel).toBe('\u2714');
    expect(bullet?.querySelector('svg')).not.toBeNull();
    expect(bullet?.style.color).toBe('rgb(0, 0, 0)');
    expect(bullet?.style.fontFamily).toContain('Segoe UI Symbol');
  });

  it('prefers explicit bullet colors over paragraph text color', () => {
    const slide = createBaseSlide([
      {
        id: 'text-explicit-bullet-color',
        kind: 'text',
        name: 'Explicit bullet color',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: '\u2022',
                color: '#FF7A59'
              },
              runs: [{ text: 'Checklist item', color: '#000000' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;

    expect(bullet?.style.color).toBe('rgb(255, 122, 89)');
  });

  it('renders vertical text frame directions with writing modes', () => {
    const slide = createBaseSlide([
      {
        id: 'text-vertical-1',
        kind: 'text',
        name: 'Vertical text',
        transform: {
          x: 0,
          y: 0,
          width: 80,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          paragraphs: [
            {
              runs: [
                {
                  text: 'Vertical'
                }
              ]
            }
          ],
          verticalAlign: 'middle',
          direction: 'vertical',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          }
        }
      } satisfies TextItem,
      {
        id: 'text-vertical-2',
        kind: 'text',
        name: 'Vertical 270 text',
        transform: {
          x: 100,
          y: 0,
          width: 80,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 2,
        groupPath: [],
        textFrame: {
          paragraphs: [
            {
              runs: [
                {
                  text: 'Vertical 270'
                }
              ]
            }
          ],
          verticalAlign: 'middle',
          direction: 'vertical270',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          }
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const frames = rendered.querySelectorAll('.pptxv-item--text .pptxv-text-frame');

    expect((frames[0] as HTMLDivElement | undefined)?.style.writingMode).toBe('vertical-rl');
    expect((frames[0] as HTMLDivElement | undefined)?.style.textOrientation).toBe('mixed');
    expect((frames[1] as HTMLDivElement | undefined)?.style.writingMode).toBe('vertical-lr');
    expect((frames[1] as HTMLDivElement | undefined)?.style.textOrientation).toBe('mixed');
  });

  it('renders hyperlink runs as anchors', () => {
    const slide = createBaseSlide([
      {
        id: 'text-link',
        kind: 'text',
        name: 'Linked text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Open docs',
                  href: 'https://example.com/pptx-previewer',
                  underline: true,
                  color: '#2F6BFF'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const link = rendered.querySelector('.pptxv-run--link') as HTMLAnchorElement | null;

    expect(link?.tagName).toBe('A');
    expect(link?.href).toBe('https://example.com/pptx-previewer');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noreferrer');
    expect(link?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('renders internal slide links with slide index metadata', () => {
    const slide = createBaseSlide([
      {
        id: 'text-link-internal',
        kind: 'text',
        name: 'Linked slide text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Jump to slide three',
                  slideIndex: 2,
                  underline: true,
                  color: '#FF7A59'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const link = rendered.querySelector('.pptxv-run--link') as HTMLAnchorElement | null;

    expect(link?.dataset.slideIndex).toBe('2');
    expect(link?.getAttribute('href')).toBe('#slide-3');
    expect(link?.getAttribute('target')).toBeNull();
  });

  it('renders navigation action links with action metadata', () => {
    const slide = createBaseSlide([
      {
        id: 'text-link-action',
        kind: 'text',
        name: 'Action link',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Back to first slide',
                  navigationAction: 'first',
                  underline: true,
                  color: '#FF7A59'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const link = rendered.querySelector('.pptxv-run--link') as HTMLAnchorElement | null;

    expect(link?.dataset.slideAction).toBe('first');
    expect(link?.getAttribute('href')).toBe('#action-first');
    expect(link?.getAttribute('target')).toBeNull();
  });

  it('renders text box fill and border styles for plain text items', () => {
    const slide = createBaseSlide([
      {
        id: 'text-box-1',
        kind: 'text',
        name: 'Callout text box',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF',
          alpha: 0.2
        },
        line: {
          color: '#FF7A59',
          alpha: 0.45,
          width: 2,
          dash: 'dash'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 8,
            right: 10,
            bottom: 8,
            left: 10
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Styled text box'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const textBox = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;

    expect(textBox?.style.background).toBe('rgba(47, 107, 255, 0.2)');
    expect(textBox?.style.borderTop).toContain('2px');
    expect(textBox?.style.borderTop).toContain('dashed');
    expect(textBox?.style.borderTop).toContain('rgba(255, 122, 89, 0.45)');
  });

  it('renders gradient fills for text surfaces and SVG shapes', () => {
    const slide = createBaseSlide([
      {
        id: 'text-gradient',
        kind: 'text',
        name: 'Gradient text box',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 96,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'gradient',
          angle: 45,
          stops: [
            {
              position: 0,
              color: '#2F6BFF'
            },
            {
              position: 1,
              color: '#25A7C5',
              alpha: 0.6
            }
          ]
        },
        line: {
          color: '#2F6BFF',
          width: 1
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 8,
            right: 10,
            bottom: 8,
            left: 10
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Gradient text'
                }
              ]
            }
          ]
        }
      } satisfies TextItem,
      {
        id: 'shape-gradient',
        kind: 'shape',
        name: 'Gradient panel',
        shapeType: 'rect',
        transform: {
          x: 360,
          y: 0,
          width: 180,
          height: 96,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'gradient',
          angle: 0,
          stops: [
            {
              position: 0,
              color: '#FF7A59'
            },
            {
              position: 1,
              color: '#FFB020'
            }
          ]
        },
        line: {
          color: '#FF7A59',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const textBox = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;
    const gradient = rendered.querySelector('linearGradient');
    const rect = rendered.querySelector('rect');
    const stops = rendered.querySelectorAll('stop');

    expect(textBox?.style.backgroundImage || textBox?.style.background).toContain('linear-gradient');
    expect(textBox?.getAttribute('style')).toContain('linear-gradient(');
    expect(gradient?.id).toBe('shape-gradient-fill-gradient');
    expect(rect?.getAttribute('fill')).toBe('url(#shape-gradient-fill-gradient)');
    expect(stops).toHaveLength(2);
    expect(stops[0]?.getAttribute('stop-color')).toBe('#FF7A59');
    expect(stops[1]?.getAttribute('stop-color')).toBe('#FFB020');
  });

  it('renders gradient slide backgrounds on the slide root', () => {
    const slide = {
      ...createBaseSlide([]),
      background: {
        type: 'gradient' as const,
        angle: 90,
        stops: [
          {
            position: 0,
            color: '#F6F8FB'
          },
          {
            position: 1,
            color: '#2F6BFF',
            alpha: 0.16
          }
        ]
      }
    };

    const rendered = renderSlideToElement(slide, createPresentation(slide));

    expect(rendered.style.backgroundImage || rendered.style.background).toContain('linear-gradient');
    expect(rendered.getAttribute('style')).toContain('linear-gradient(');
  });

  it('renders rect path gradients as linear CSS and circle path gradients as radial SVG fills', () => {
    const slide = createBaseSlide([
      {
        id: 'text-radial-gradient',
        kind: 'text',
        name: 'Radial text box',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 96,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'gradient',
          gradientType: 'path',
          gradientPath: 'rect',
          stops: [
            {
              position: 0,
              color: '#FFFFFF'
            },
            {
              position: 0.35,
              color: '#FFFFFF'
            },
            {
              position: 1,
              color: '#70AD47'
            }
          ]
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 8,
            right: 10,
            bottom: 8,
            left: 10
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Rect path gradient text'
                }
              ]
            }
          ]
        }
      } satisfies TextItem,
      {
        id: 'shape-radial-gradient',
        kind: 'shape',
        name: 'Radial corner panel',
        shapeType: 'rect',
        transform: {
          x: 360,
          y: 0,
          width: 180,
          height: 96,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'gradient',
          gradientType: 'path',
          gradientPath: 'circle',
          gradientTileRect: {
            left: 0,
            top: -1,
            right: -1,
            bottom: 0
          },
          stops: [
            {
              position: 0,
              color: '#FFFFFF'
            },
            {
              position: 0.35,
              color: '#FFFFFF'
            },
            {
              position: 1,
              color: '#ED7D31'
            }
          ]
        },
        line: {
          color: '#2F4B7C',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const textBox = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;
    const radialGradient = rendered.querySelector('radialGradient');
    const rect = rendered.querySelector('rect');

    expect(textBox?.style.backgroundImage || textBox?.style.background).toContain('linear-gradient');
    expect(textBox?.getAttribute('style')).toContain('linear-gradient(90deg');
    expect(radialGradient?.id).toBe('shape-radial-gradient-fill-gradient');
    expect(radialGradient?.getAttribute('cx')).toBe('100%');
    expect(radialGradient?.getAttribute('cy')).toBe('0%');
    expect(rect?.getAttribute('fill')).toBe('url(#shape-radial-gradient-fill-gradient)');
  });

  it('renders path gradient slide backgrounds on the slide root', () => {
    const slide = {
      ...createBaseSlide([]),
      background: {
        type: 'gradient' as const,
        gradientType: 'path' as const,
        gradientPath: 'circle',
        stops: [
          {
            position: 0,
            color: '#FFFFFF'
          },
          {
            position: 0.35,
            color: '#FFFFFF'
          },
          {
            position: 1,
            color: '#70AD47'
          }
        ]
      }
    };

    const rendered = renderSlideToElement(slide, createPresentation(slide));

    expect(rendered.style.backgroundImage || rendered.style.background).toContain('radial-gradient');
    expect(rendered.getAttribute('style')).toContain('radial-gradient(circle');
  });

  it('renders rect path gradient slide backgrounds as linear gradients on the slide root', () => {
    const slide = {
      ...createBaseSlide([]),
      background: {
        type: 'gradient' as const,
        gradientType: 'path' as const,
        gradientPath: 'rect',
        gradientFillToRect: {
          left: 1,
          top: 1,
          right: 0,
          bottom: 0
        },
        stops: [
          {
            position: 0,
            color: '#002060'
          },
          {
            position: 1,
            color: '#7030A0'
          }
        ]
      }
    };

    const rendered = renderSlideToElement(slide, createPresentation(slide));

    expect(rendered.style.backgroundImage || rendered.style.background).toContain('linear-gradient');
    expect(rendered.getAttribute('style')).toContain('linear-gradient(90deg');
  });

  it('renders text highlight and strike-through styles', () => {
    const slide = createBaseSlide([
      {
        id: 'text-2',
        kind: 'text',
        name: 'Styled text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Deprecated copy',
                  strike: true,
                  underline: true,
                  colorAlpha: 0.58,
                  highlightColor: '#FFF3A3',
                  highlightAlpha: 0.42,
                  color: '#122033'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(run?.style.textDecoration).toContain('underline');
    expect(run?.style.textDecoration).toContain('line-through');
    expect(run?.style.color).toBe('rgba(18, 32, 51, 0.58)');
    expect(run?.style.backgroundColor).toBe('rgba(255, 243, 163, 0.42)');
  });

  it('renders baseline shifts for superscript and subscript runs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-baseline-1',
        kind: 'text',
        name: 'Baseline text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'CO'
                },
                {
                  text: '2',
                  baselineShift: -0.25,
                  color: '#FF7A59'
                },
                {
                  text: ' x'
                },
                {
                  text: '2',
                  baselineShift: 0.3,
                  color: '#2F6BFF'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const runs = Array.from(rendered.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];

    expect(runs[1]?.style.verticalAlign).toBe('-0.25em');
    expect(runs[3]?.style.verticalAlign).toBe('0.3em');
  });

  it('renders newline and tab control runs in sequence', () => {
    const slide = createBaseSlide([
      {
        id: 'text-control-1',
        kind: 'text',
        name: 'Control text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Line one'
                },
                {
                  text: '\n',
                  bold: true
                },
                {
                  text: 'Line two'
                },
                {
                  text: '\t'
                },
                {
                  text: 'Field tail',
                  italic: true
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const runs = Array.from(rendered.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];

    expect(runs.map((run) => run.textContent)).toEqual(['Line one', '\n', 'Line two', '\t', 'Field tail']);
    expect(runs[1]?.style.fontWeight).toBe('700');
    expect(runs[4]?.style.fontStyle).toBe('italic');
  });

  it('applies explicit paragraph tab stops to tab control runs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-tabs-1',
        kind: 'text',
        name: 'Tab stop text',
        transform: {
          x: 0,
          y: 0,
          width: 360,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              tabStops: [160, 280],
              runs: [
                {
                  text: 'Alpha',
                  fontSize: 18
                },
                {
                  text: '\t'
                },
                {
                  text: 'Beta',
                  fontSize: 18
                },
                {
                  text: '\t'
                },
                {
                  text: 'Gamma',
                  fontSize: 18
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const tabRuns = Array.from(rendered.querySelectorAll('.pptxv-run--tab')) as HTMLSpanElement[];
    const widths = tabRuns.map((run) => Number.parseFloat(run.style.width));

    expect(tabRuns.map((run) => run.textContent)).toEqual(['\t', '\t']);
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[1]).toBeGreaterThan(0);
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });

  it('renders soft hyphen and no-break hyphen runs in order', () => {
    const slide = createBaseSlide([
      {
        id: 'text-hyphen-1',
        kind: 'text',
        name: 'Hyphen text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'co'
                },
                {
                  text: SOFT_HYPHEN
                },
                {
                  text: 'operate'
                },
                {
                  text: NO_BREAK_HYPHEN
                },
                {
                  text: 'enter',
                  bold: true
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const runs = Array.from(rendered.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];

    expect(runs.map((run) => run.textContent)).toEqual(['co', SOFT_HYPHEN, 'operate', NO_BREAK_HYPHEN, 'enter']);
    expect(runs[1]?.textContent?.codePointAt(0)).toBe(0x00ad);
    expect(runs[3]?.textContent?.codePointAt(0)).toBe(0x2011);
    expect(runs[4]?.style.fontWeight).toBe('700');
  });

  it('renders symbol runs with their explicit symbol font', () => {
    const slide = createBaseSlide([
      {
        id: 'text-symbol-1',
        kind: 'text',
        name: 'Symbol text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Status '
                },
                {
                  text: '✓',
                  fontFamily: 'Segoe UI Symbol'
                },
                {
                  text: ' complete',
                  color: '#2ABF88'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const runs = Array.from(rendered.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];

    expect(runs.map((run) => run.textContent)).toEqual(['Status ', '✓', ' complete']);
    expect(runs[1]?.style.fontFamily).toContain('Segoe UI Symbol');
    expect(runs[2]?.style.color).toBe('rgb(42, 191, 136)');
  });

  it('renders standalone portable symbol runs with stable symbol visuals and symbol fallback fonts', () => {
    const slide = createBaseSlide([
      {
        id: 'text-standalone-symbol-run',
        kind: 'text',
        name: 'Standalone symbol run',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: '○',
                  fontFamily: 'Roboto Mono',
                  color: '#737373',
                  fontSize: 16
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(run?.dataset.resolvedLabel).toBe('\u25CB');
    expect(run?.querySelector('svg')).not.toBeNull();
    expect(run?.style.fontFamily).toContain('Segoe UI Symbol');
    expect(run?.style.color).toBe('rgb(115, 115, 115)');
  });

  it('prefers emoji fallback fonts for standalone emoji runs', () => {
    const slide = createBaseSlide([
      {
        id: 'text-standalone-emoji-run',
        kind: 'text',
        name: 'Standalone emoji run',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [
                {
                  text: '🟢',
                  fontFamily: 'Roboto',
                  fontSize: 16
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(run?.textContent).toBe('🟢');
    expect(run?.style.fontFamily).toContain('Segoe UI Emoji');
    expect(run?.style.fontFamily).toContain('Apple Color Emoji');
  });

  it.skip('expands Office CJK fonts into browser-friendly fallback stacks', () => {
    const slide = createBaseSlide([
      {
        id: 'text-font-stack-1',
        kind: 'text',
        name: 'CJK font stack',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: 'n',
                fontFamily: 'Wingdings'
              },
              runs: [
                {
                  text: '中文主题字体',
                  fontFamily: '等线'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;
    const run = rendered.querySelectorAll('.pptxv-run')[1] as HTMLSpanElement | undefined;

    expect(run?.style.fontFamily).toContain('"等线"');
    expect(run?.style.fontFamily).toContain('"Microsoft YaHei"');
    expect(run?.style.fontFamily).toContain('"PingFang SC"');
    expect(run?.style.fontFamily).toContain('sans-serif');
    expect(bullet?.style.fontFamily).toContain('Segoe UI Symbol');
  });

  it('expands Office CJK fonts into browser-friendly fallback stacks while preserving symbol bullets', () => {
    const slide = createBaseSlide([
      {
        id: 'text-font-stack-symbol-bullet',
        kind: 'text',
        name: 'CJK font stack symbol bullet',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              bullet: {
                char: 'n',
                fontFamily: 'Wingdings'
              },
              runs: [
                {
                  text: '涓枃涓婚瀛椾綋',
                  fontFamily: '绛夌嚎'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const bullet = rendered.querySelector('.pptxv-run--bullet') as HTMLSpanElement | null;
    const run = rendered.querySelectorAll('.pptxv-run')[1] as HTMLSpanElement | undefined;

    expect(run?.style.fontFamily).toContain('"绛夌嚎"');
    expect(run?.style.fontFamily).toContain('"Microsoft YaHei"');
    expect(run?.style.fontFamily).toContain('"PingFang SC"');
    expect(run?.style.fontFamily).toContain('sans-serif');
    expect(bullet?.dataset.resolvedLabel).toBe('\u25A0');
    expect(bullet?.querySelector('svg')).not.toBeNull();
    expect(bullet?.style.fontFamily).toContain('Segoe UI Symbol');
  });

  it('applies safer text bounds inside non-rectangular shapes', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-text-bounds-1',
        kind: 'shape',
        name: 'Arrow with text',
        shapeType: 'rightArrow',
        transform: {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 6,
            right: 8,
            bottom: 6,
            left: 8
          },
          paragraphs: [
            {
              runs: [{ text: 'Arrow text' }]
            }
          ]
        }
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const overlay = rendered.querySelector('.pptxv-shape-text') as HTMLDivElement | null;

    expect(overlay?.style.position).toBe('absolute');
    expect(overlay?.style.left).toBe('16px');
    expect(overlay?.style.top).toBe('50px');
    expect(overlay?.style.width).toBe('124px');
    expect(overlay?.style.maxHeight).toBe('68px');
    expect(overlay?.style.height).toBe('auto');
    expect(overlay?.style.transform).toBe('translateY(-50%)');
  });

  it('adds extra safety inset for thick outlined shape text bounds', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-text-bounds-thick-line',
        kind: 'shape',
        name: 'Thick outline arrow',
        shapeType: 'rightArrow',
        transform: {
          x: 0,
          y: 0,
          width: 160,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 8
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 6,
            right: 8,
            bottom: 6,
            left: 8
          },
          paragraphs: [
            {
              runs: [{ text: 'Arrow text' }]
            }
          ]
        }
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const overlay = rendered.querySelector('.pptxv-shape-text') as HTMLDivElement | null;

    expect(Number.parseFloat(overlay?.style.left ?? '0')).toBeCloseTo(15.5, 3);
    expect(Number.parseFloat(overlay?.style.top ?? '0')).toBeCloseTo(50, 3);
    expect(Number.parseFloat(overlay?.style.width ?? '0')).toBeCloseTo(93.8, 3);
    expect(Number.parseFloat(overlay?.style.maxHeight ?? '0')).toBeCloseTo(62.6, 3);
    expect(overlay?.style.height).toBe('auto');
    expect(overlay?.style.transform).toBe('translateY(-50%)');
  });

  it('uses the full ellipse box for shape text bounds and lets padding handle inset', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-text-bounds-ellipse',
        kind: 'shape',
        name: 'Ellipse text',
        shapeType: 'ellipse',
        transform: {
          x: 0,
          y: 0,
          width: 160,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 1
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 4,
            right: 5,
            bottom: 4,
            left: 5
          },
          paragraphs: [
            {
              align: 'center',
              runs: [{ text: 'Ellipse text' }]
            }
          ]
        }
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const overlay = rendered.querySelector('.pptxv-shape-text') as HTMLDivElement | null;

    expect(overlay?.style.left).toBe('0px');
    expect(overlay?.style.top).toBe('50px');
    expect(overlay?.style.width).toBe('160px');
    expect(overlay?.style.maxHeight).toBe('100px');
    expect(overlay?.style.height).toBe('auto');
    expect(overlay?.style.transform).toBe('translateY(-50%)');
  });

  it('uses the full box for rounded and snipped rectangle text bounds like the reference preview', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-text-bounds-round2diag',
        kind: 'shape',
        name: 'Rounded diagonal rect text',
        shapeType: 'round2DiagRect',
        geometry: {
          type: 'preset',
          preset: 'round2DiagRect',
          adjustments: {}
        },
        transform: {
          x: 0,
          y: 0,
          width: 194,
          height: 106.667,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1.333333
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 4.8,
            right: 9.6,
            bottom: 4.8,
            left: 9.6
          },
          paragraphs: [
            {
              align: 'center',
              runs: [{ text: '文字内容测试', fontSize: 18, color: '#FFFFFF', fontFamily: '等线' }]
            }
          ]
        }
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const overlay = rendered.querySelector('.pptxv-shape-text') as HTMLDivElement | null;

    expect(overlay?.style.left).toBe('0px');
    expect(overlay?.style.top).toBe('53.334px');
    expect(overlay?.style.width).toBe('194px');
    expect(overlay?.style.maxHeight).toBe('106.667px');
    expect(overlay?.style.height).toBe('auto');
    expect(overlay?.style.transform).toBe('translateY(-50%)');
  });

  it('keeps octagon text bounds wide enough for the real sample label density', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-text-bounds-octagon',
        kind: 'shape',
        name: 'Octagon text',
        shapeType: 'octagon',
        geometry: {
          type: 'preset',
          preset: 'octagon',
          adjustments: {
            adj: 18589
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 134.667,
          height: 122.34,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FBE5D7'
        },
        line: {
          color: '#172C51',
          width: 1.333333
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 4.8,
            right: 9.6,
            bottom: 4.8,
            left: 9.6
          },
          paragraphs: [
            {
              align: 'center',
              runs: [{ text: '文字内容测试', fontSize: 18, color: '#FFFFFF', fontFamily: '等线' }]
            }
          ]
        }
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const overlay = rendered.querySelector('.pptxv-shape-text') as HTMLDivElement | null;

    expect(Number.parseFloat(overlay?.style.left ?? '0')).toBeCloseTo(11.371, 3);
    expect(Number.parseFloat(overlay?.style.top ?? '0')).toBeCloseTo(61.17, 3);
    expect(Number.parseFloat(overlay?.style.width ?? '0')).toBeCloseTo(111.925, 3);
    expect(Number.parseFloat(overlay?.style.maxHeight ?? '0')).toBeCloseTo(99.598, 3);
    expect(overlay?.style.height).toBe('auto');
    expect(overlay?.style.transform).toBe('translateY(-50%)');
  });

  it('renders slide 3 style preset shapes with reference-like SVG primitive structure', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-half-frame-1',
        kind: 'shape',
        name: 'Half frame',
        shapeType: 'halfFrame',
        transform: { x: 0, y: 0, width: 160, height: 110, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#FFC000' },
        line: { color: '#172C51', width: 1 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-corner-1',
        kind: 'shape',
        name: 'Corner',
        shapeType: 'corner',
        transform: { x: 180, y: 0, width: 197, height: 110, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#4472C4' },
        line: { color: '#172C51', width: 1 },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-diag-1',
        kind: 'shape',
        name: 'Diag stripe',
        shapeType: 'diagStripe',
        transform: { x: 390, y: 0, width: 158, height: 110, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#70AD47' },
        line: { color: '#172C51', width: 1 },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-plus-1',
        kind: 'shape',
        name: 'Plus',
        shapeType: 'plus',
        transform: { x: 560, y: 0, width: 115, height: 109, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#7030A0' },
        line: { color: '#172C51', width: 1 },
        order: 4,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-can-1',
        kind: 'shape',
        name: 'Can',
        shapeType: 'can',
        transform: { x: 0, y: 140, width: 146, height: 140, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#548235' },
        line: { color: '#172C51', width: 1 },
        order: 5,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-cube-1',
        kind: 'shape',
        name: 'Cube',
        shapeType: 'cube',
        transform: { x: 180, y: 140, width: 155, height: 131, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#C55911' },
        line: { color: '#172C51', width: 1 },
        order: 6,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-bevel-1',
        kind: 'shape',
        name: 'Bevel',
        shapeType: 'bevel',
        transform: { x: 360, y: 140, width: 154, height: 140, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'solid', color: '#00B0F0' },
        line: { color: '#172C51', width: 1 },
        order: 7,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const readSummary = (shapeType: string) => {
      const node = rendered.querySelector(`.pptxv-item--shape[data-shape-type="${shapeType}"]`);
      return {
        pathCount: node?.querySelectorAll('svg path').length ?? 0,
        polygonCount: node?.querySelectorAll('svg polygon').length ?? 0,
        ellipseCount: node?.querySelectorAll('svg ellipse').length ?? 0
      };
    };

    expect(readSummary('halfFrame')).toEqual({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
    expect(readSummary('corner')).toEqual({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
    expect(readSummary('diagStripe')).toEqual({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
    expect(readSummary('plus')).toEqual({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
    expect(readSummary('can')).toEqual({ pathCount: 1, polygonCount: 0, ellipseCount: 1 });
    expect(readSummary('cube')).toEqual({ pathCount: 3, polygonCount: 0, ellipseCount: 0 });
    expect(readSummary('bevel')).toEqual({ pathCount: 5, polygonCount: 0, ellipseCount: 0 });
  });

  it('keeps text on a single line when body wrap is disabled', () => {
    const slide = createBaseSlide([
      {
        id: 'text-nowrap-1',
        kind: 'text',
        name: 'No wrap text',
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 60,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          wrap: 'none',
          anchorCenter: false,
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [{ text: 'This is a single line title' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const item = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;
    const frame = rendered.querySelector('.pptxv-text-frame') as HTMLDivElement | null;
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(item?.style.overflowX).toBe('clip');
    expect(item?.style.overflowY).toBe('visible');
    expect(frame?.style.overflowX).toBe('clip');
    expect(frame?.style.overflowY).toBe('visible');
    expect(paragraph?.style.whiteSpace).toBe('pre');
    expect(paragraph?.style.overflowWrap).toBe('normal');
    expect(run?.style.whiteSpace).toBe('pre');
  });

  it('shrinks shape autofit text frames so a no-wrap title stays on one line', () => {
    const slide = createBaseSlide([
      {
        id: 'text-shape-autofit-1',
        kind: 'text',
        name: 'Shape autofit title',
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 60,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          wrap: 'none',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          autofit: {
            type: 'shape'
          },
          paragraphs: [
            {
              align: 'center',
              runs: [
                {
                  text: 'feed第一期技术方案',
                  fontSize: 80,
                  fontFamily: 'Microsoft YaHei',
                  bold: true
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;
    const run = rendered.querySelector('.pptxv-run') as HTMLSpanElement | null;

    expect(parseFloat(paragraph?.style.fontSize ?? '0')).toBeLessThan(80);
    expect(parseFloat(run?.style.fontSize ?? '0')).toBeLessThan(80);
    expect(run?.style.whiteSpace).toBe('pre');
  });

  it('maps bodyPr overflow flags onto the rendered text frame', () => {
    const slide = createBaseSlide([
      {
        id: 'text-overflow-1',
        kind: 'text',
        name: 'Overflow text',
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 60,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          horizontalOverflow: 'clip',
          verticalOverflow: 'clip',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [{ text: 'Overflow clip' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const item = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;
    const frame = rendered.querySelector('.pptxv-text-frame') as HTMLDivElement | null;

    expect(item?.style.overflowX).toBe('clip');
    expect(item?.style.overflowY).toBe('clip');
    expect(frame?.style.overflowX).toBe('clip');
    expect(frame?.style.overflowY).toBe('clip');
  });

  it('supports horizontal anchor-centering at the text-frame level', () => {
    const slide = createBaseSlide([
      {
        id: 'text-anchor-center-1',
        kind: 'text',
        name: 'Centered anchor text',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          wrap: 'square',
          anchorCenter: true,
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              align: 'left',
              runs: [{ text: 'Centered block' }]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const frame = rendered.querySelector('.pptxv-text-frame') as HTMLDivElement | null;
    const paragraph = rendered.querySelector('.pptxv-paragraph') as HTMLParagraphElement | null;

    expect(frame?.style.alignItems).toBe('center');
    expect(paragraph?.style.width).toBe('fit-content');
    expect(paragraph?.style.maxWidth).toBe('100%');
  });

  it('centers zero-sized text boxes on their Keynote anchor point', () => {
    const slide = createBaseSlide([
      {
        id: 'auto-text-box-1',
        kind: 'text',
        name: 'Auto-sized label',
        transform: {
          x: 320,
          y: 200,
          width: 0,
          height: 0,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'none' },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: { top: 4, right: 4, bottom: 4, left: 4 },
          paragraphs: [{ align: 'center', runs: [{ text: 'Q3新增', fontSize: 22 }] }]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const item = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;
    const frame = rendered.querySelector('.pptxv-text-frame') as HTMLDivElement | null;

    expect(item?.style.left).toBe('320px');
    expect(item?.style.top).toBe('200px');
    expect(item?.style.width).toBe('auto');
    expect(item?.style.minWidth).toBe('fit-content');
    expect(item?.style.height).toBe('auto');
    expect(item?.style.transform).toBe('translate(-50%, -50%)');
    expect(item?.style.transformOrigin).toBe('0 0');
    expect(frame?.style.width).toBe('auto');
    expect(frame?.style.height).toBe('auto');
  });

  it('renders table border overrides from parsed cell data', () => {
    const slide = createBaseSlide([
      {
        id: 'table-1',
        kind: 'table',
        name: 'Styled table',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 12,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        columns: [480],
        rows: [12],
        cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            colSpan: 1,
            isMergedContinuation: false,
            fill: {
              type: 'none'
            },
            borders: {
              top: {
                color: '#FF7A59',
                width: 2,
                dash: 'sysDot'
              },
              left: {
                color: 'transparent',
                width: 0
              }
            },
            textFrame: {
              verticalAlign: 'middle',
              padding: {
                top: 4,
                right: 6,
                bottom: 4,
                left: 6
              },
              paragraphs: [
                {
                  runs: [
                    {
                      text: 'Cell'
                    }
                  ]
                }
              ]
            }
          }
        ]
      } satisfies TableItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const cell = rendered.querySelector('.pptxv-table-cell') as HTMLTableCellElement | null;
    const frame = cell?.querySelector('.pptxv-text-frame') as HTMLDivElement | null;
    const column = rendered.querySelector('col') as HTMLTableColElement | null;
    const row = rendered.querySelector('tr') as HTMLTableRowElement | null;

    expect(column?.style.width).toBe('240px');
    expect(row?.style.height).toBe('12px');
    expect(cell?.style.overflow).toBe('hidden');
    expect(frame?.style.position).toBe('absolute');
    expect(cell?.style.borderTop).toContain('2px');
    expect(cell?.style.borderTop).toContain('dotted');
    expect(cell?.style.borderLeft).toContain('0px');
    expect(cell?.style.borderLeft).toContain('transparent');
  });

  it('maps compound table borders to CSS double borders', () => {
    const slide = createBaseSlide([
      {
        id: 'table-double-border',
        kind: 'table',
        name: 'Double border table',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        columns: [240],
        rows: [80],
        cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            colSpan: 1,
            isMergedContinuation: false,
            fill: {
              type: 'none'
            },
            borders: {
              top: {
                color: '#2F6BFF',
                width: 3,
                compound: 'double'
              }
            },
            textFrame: {
              verticalAlign: 'middle',
              padding: {
                top: 4,
                right: 6,
                bottom: 4,
                left: 6
              },
              paragraphs: [
                {
                  runs: [
                    {
                      text: 'Cell'
                    }
                  ]
                }
              ]
            }
          }
        ]
      } satisfies TableItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const cell = rendered.querySelector('.pptxv-table-cell') as HTMLTableCellElement | null;

    expect(cell?.style.borderTop).toContain('double');
    expect(cell?.style.borderTop).toContain('3px');
  });

  it('respects explicit table cell vertical alignment in DOM output', () => {
    const slide = createBaseSlide([
      {
        id: 'table-vertical-center',
        kind: 'table',
        name: 'Aligned body table',
        transform: {
          x: 0,
          y: 0,
          width: 480,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        columns: [240, 240],
        rows: [80],
        cells: [
          createTableCell(0, 0, 'Cell', {
            textFrame: {
              verticalAlign: 'middle',
              padding: {
                top: 4,
                right: 6,
                bottom: 4,
                left: 6
              },
              paragraphs: [
                {
                  runs: [
                    {
                      text: 'Cell'
                    }
                  ]
                }
              ]
            }
          }),
          createTableCell(0, 1, 'Top aligned', {
            textFrame: {
              verticalAlign: 'top',
              padding: {
                top: 4,
                right: 6,
                bottom: 4,
                left: 6
              },
              paragraphs: [
                {
                  runs: [
                    {
                      text: 'Top aligned'
                    }
                  ]
                }
              ]
            }
          })
        ]
      } satisfies TableItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const cells = Array.from(rendered.querySelectorAll('.pptxv-table-cell')) as HTMLTableCellElement[];
    const frames = Array.from(rendered.querySelectorAll('.pptxv-table-cell .pptxv-text-frame')) as HTMLDivElement[];

    expect(cells[0]?.style.verticalAlign).toBe('middle');
    expect(frames[0]?.style.justifyContent).toBe('center');
    expect(cells[1]?.style.verticalAlign).toBe('top');
    expect(frames[1]?.style.justifyContent).toBe('flex-start');
  });

  it('renders merged table cells with HTML rowSpan and colSpan', () => {
    const slide = createBaseSlide([
      {
        id: 'table-merged',
        kind: 'table',
        name: 'Merged table',
        transform: {
          x: 0,
          y: 0,
          width: 360,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        columns: [120, 120, 120],
        rows: [40, 40, 40],
        cells: [
          createTableCell(0, 0, 'Feature'),
          createTableCell(0, 1, 'Coverage', { colSpan: 2 }),
          createTableCell(0, 2, '', { isMergedContinuation: true }),
          createTableCell(1, 0, 'Preview engine', { rowSpan: 2 }),
          createTableCell(1, 1, 'Supported'),
          createTableCell(1, 2, 'Text, shapes, media'),
          createTableCell(2, 0, '', { isMergedContinuation: true }),
          createTableCell(2, 1, 'Merged cells'),
          createTableCell(2, 2, 'HTML rendering path')
        ]
      } satisfies TableItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const cells = Array.from(rendered.querySelectorAll('.pptxv-table-cell')) as HTMLTableCellElement[];
    const coverage = cells.find((cell) => cell.textContent?.includes('Coverage'));
    const previewEngine = cells.find((cell) => cell.textContent?.includes('Preview engine'));

    expect(cells).toHaveLength(7);
    expect(coverage?.colSpan).toBe(2);
    expect(previewEngine?.rowSpan).toBe(2);
    expect(cells.some((cell) => cell.textContent?.includes('Merged continuation'))).toBe(false);
  });

  it('collapses hidden table rows and columns without applying minimum dimensions', () => {
    const slide = createBaseSlide([
      {
        id: 'table-hidden',
        kind: 'table',
        name: 'Hidden table',
        transform: {
          x: 0,
          y: 0,
          width: 300,
          height: 90,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        columns: [100, 100, 100],
        rows: [30, 30, 30],
        hiddenColumns: [1],
        hiddenRows: [2],
        cells: [
          createTableCell(0, 0, 'Visible A'),
          createTableCell(0, 1, 'Hidden column'),
          createTableCell(1, 0, 'Visible B'),
          createTableCell(2, 0, 'Hidden row')
        ]
      } satisfies TableItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const columns = Array.from(rendered.querySelectorAll('col')) as HTMLTableColElement[];
    const rows = Array.from(rendered.querySelectorAll('tr')) as HTMLTableRowElement[];

    expect(columns[1]?.style.width).toBe('0px');
    expect(columns[1]?.style.visibility).toBe('collapse');
    expect(rows[2]?.style.height).toBe('0px');
    expect(rows[2]?.style.visibility).toBe('collapse');
  });

  it('keeps inner table borders distinct from perimeter borders', () => {
    const slide = createBaseSlide([
      {
        id: 'table-border-priority',
        kind: 'table',
        name: 'Priority table',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        columns: [100, 100, 120],
        rows: [60, 60, 60],
        cells: [
          createTableCell(0, 0, 'A1', {
            borders: {
              top: { color: '#111111', width: 3 },
              left: { color: '#111111', width: 3 },
              right: { color: '#222222', width: 1 },
              bottom: { color: '#222222', width: 1 }
            }
          }),
          createTableCell(0, 1, 'A2', {
            borders: {
              top: { color: '#111111', width: 3 },
              left: { color: '#222222', width: 1 },
              right: { color: '#222222', width: 1 },
              bottom: { color: '#222222', width: 1 }
            }
          }),
          createTableCell(0, 2, 'A3', {
            borders: {
              top: { color: '#111111', width: 3 },
              right: { color: '#111111', width: 3 },
              left: { color: '#222222', width: 1 },
              bottom: { color: '#222222', width: 1 }
            }
          }),
          createTableCell(1, 0, 'B1', {
            borders: {
              top: { color: '#222222', width: 1 },
              left: { color: '#111111', width: 3 },
              right: { color: '#222222', width: 1 },
              bottom: { color: '#222222', width: 1 }
            }
          }),
          createTableCell(1, 1, 'B2', {
            borders: {
              top: { color: '#222222', width: 1 },
              left: { color: '#222222', width: 1 },
              right: { color: '#222222', width: 1 },
              bottom: { color: '#222222', width: 1 }
            }
          }),
          createTableCell(1, 2, 'B3', {
            borders: {
              top: { color: '#222222', width: 1 },
              right: { color: '#111111', width: 3 },
              left: { color: '#222222', width: 1 },
              bottom: { color: '#222222', width: 1 }
            }
          }),
          createTableCell(2, 0, 'C1', {
            borders: {
              top: { color: '#222222', width: 1 },
              left: { color: '#111111', width: 3 },
              right: { color: '#222222', width: 1 },
              bottom: { color: '#111111', width: 3 }
            }
          }),
          createTableCell(2, 1, 'C2', {
            borders: {
              top: { color: '#222222', width: 1 },
              left: { color: '#222222', width: 1 },
              right: { color: '#222222', width: 1 },
              bottom: { color: '#111111', width: 3 }
            }
          }),
          createTableCell(2, 2, 'C3', {
            borders: {
              top: { color: '#222222', width: 1 },
              right: { color: '#111111', width: 3 },
              left: { color: '#222222', width: 1 },
              bottom: { color: '#111111', width: 3 }
            }
          })
        ]
      } satisfies TableItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const cells = Array.from(rendered.querySelectorAll('.pptxv-table-cell')) as HTMLTableCellElement[];
    const centerCell = cells.find((cell) => cell.textContent?.includes('B2'));
    const perimeterCell = cells.find((cell) => cell.textContent?.includes('A1'));

    expect(centerCell?.style.borderTop).toContain('1px');
    expect(centerCell?.style.borderTop).toContain('rgb(34, 34, 34)');
    expect(centerCell?.style.borderLeft).toContain('1px');
    expect(perimeterCell?.style.borderTop).toContain('3px');
    expect(perimeterCell?.style.borderLeft).toContain('3px');
  });

  it('renders cropped image positioning from crop metadata', () => {
    const slide = createBaseSlide([
      {
        id: 'image-1',
        kind: 'image',
        name: 'Cropped image',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#FF7A59',
          width: 3,
          dash: 'dashDot'
        },
        order: 1,
        groupPath: [],
        mediaId: 'media-1',
        opacity: 0.72,
        crop: {
          left: 0.1,
          right: 0.2,
          top: 0.05,
          bottom: 0.15
        }
      } satisfies ImageItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide, {
      'media-1': {
        id: 'media-1',
        path: 'ppt/media/image1.png',
        contentType: 'image/png',
        data: new Uint8Array([137, 80, 78, 71])
      }
    }));
    const host = rendered.querySelector('.pptxv-item--image') as HTMLDivElement | null;
    const image = rendered.querySelector('.pptxv-image') as HTMLImageElement | null;

    expect(host?.style.borderTop).toContain('3px');
    expect(host?.style.borderTop).toContain('dashed');
    expect(host?.style.borderTop).toContain('rgb(255, 122, 89)');
    expect(host?.style.overflow).toBe('hidden');
    expect(image?.style.width).toBe('142.857143%');
    expect(image?.style.height).toBe('125%');
    expect(image?.style.left).toBe('-14.285714%');
    expect(image?.style.top).toBe('-6.25%');
    expect(host?.style.opacity).toBe('0.72');
    expect(image?.style.objectFit).toBe('fill');
  });

  it('applies item opacity to text and shape hosts', () => {
    const slide = createBaseSlide([
      {
        id: 'text-opacity-1',
        kind: 'text',
        name: 'Text opacity',
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        opacity: 0.45,
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'top',
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          },
          paragraphs: [
            {
              runs: [{ text: 'Semi transparent text' }]
            }
          ]
        }
      } satisfies TextItem,
      {
        id: 'shape-opacity-1',
        kind: 'shape',
        name: 'Shape opacity',
        transform: {
          x: 260,
          y: 0,
          width: 180,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4f46e5',
          alpha: 1
        },
        opacity: 0.62,
        shapeType: 'rect',
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const textHost = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;
    const shapeHost = rendered.querySelector('.pptxv-item--shape') as HTMLDivElement | null;

    expect(textHost?.style.opacity).toBe('0.45');
    expect(shapeHost?.style.opacity).toBe('0.62');
  });

  it('renders audio and video media items with native controls and poster assets', () => {
    const slide = createBaseSlide([
      {
        id: 'media-video-1',
        kind: 'media',
        name: 'flower.mp4',
        mediaType: 'video',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        mediaId: 'video-1',
        posterMediaId: 'poster-video',
        opacity: 0.84
      } satisfies MediaItem,
      {
        id: 'media-audio-1',
        kind: 'media',
        name: 'audio.mp3',
        mediaType: 'audio',
        transform: {
          x: 360,
          y: 0,
          width: 64,
          height: 64,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 2,
        groupPath: [],
        mediaId: 'audio-1',
        posterMediaId: 'poster-audio'
      } satisfies MediaItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide), {
      mediaRegistry: {
        getUrl(mediaId: string) {
          return `blob:${mediaId}`;
        }
      }
    });
    const videoHost = rendered.querySelector('.pptxv-item--media[data-media-type="video"]') as HTMLDivElement | null;
    const videoPosterFrame = videoHost?.querySelector('.pptxv-media-poster-frame') as HTMLDivElement | null;
    const videoPoster = videoHost?.querySelector('.pptxv-media-poster--video') as HTMLImageElement | null;
    const video = videoHost?.querySelector('video') as HTMLVideoElement | null;
    const audioHost = rendered.querySelector('.pptxv-item--media[data-media-type="audio"]') as HTMLDivElement | null;
    const audio = audioHost?.querySelector('audio') as HTMLAudioElement | null;

    expect(videoHost?.dataset.mediaType).toBe('video');
    expect(videoPosterFrame?.style.position).toBe('absolute');
    expect(videoPosterFrame?.style.left).toBe('0px');
    expect(videoPosterFrame?.style.top).toBe('0px');
    expect(videoPosterFrame?.style.width).toBe('320px');
    expect(videoPosterFrame?.style.height).toBe('180px');
    expect(videoPoster?.getAttribute('src')).toBe('blob:poster-video');
    expect(videoPoster?.style.width).toBe('100%');
    expect(videoPoster?.style.height).toBe('100%');
    expect(video?.getAttribute('src')).toBe('blob:video-1');
    expect(video?.getAttribute('poster')).toBeNull();
    expect(video?.getAttribute('controls')).toBe('');
    expect(video?.getAttribute('playsinline')).toBe('');
    expect(video?.getAttribute('width')).toBe('320');
    expect(video?.getAttribute('height')).toBe('180');
    expect(video?.getAttribute('autoplay')).toBeNull();
    expect(video?.getAttribute('muted')).toBeNull();
    expect(video?.getAttribute('loop')).toBeNull();
    expect(video?.muted).toBe(false);
    expect(videoHost?.style.opacity).toBe('0.84');
    expect(video?.style.position).toBe('absolute');
    expect(video?.style.left).toBe('0px');
    expect(video?.style.top).toBe('0px');
    expect(video?.style.width).toBe('');
    expect(video?.style.height).toBe('');
    expect(video?.style.objectFit).toBe('');
    expect(videoHost?.querySelector('.pptxv-video-controls')).toBeNull();

    expect(audioHost?.dataset.mediaType).toBe('audio');
    expect(audioHost?.style.width).toBe('0px');
    expect(audioHost?.style.height).toBe('0px');
    expect(audioHost?.style.overflow).toBe('visible');
    expect(audioHost?.querySelector('img')).toBeNull();
    expect(audio?.getAttribute('src')).toBe('blob:audio-1');
    expect(audio?.getAttribute('controls')).toBe('');
    expect(audio?.style.left).toBe('0px');
    expect(audio?.style.top).toBe('0px');
    expect(audio?.style.transform).toBe('translate(-50%)');
    expect(audio?.style.width).toBe('');
    expect(audio?.style.height).toBe('');
  });

  it('renders item-level slide links as overlay anchors', () => {
    const slide = createBaseSlide([
      {
        id: 'image-link-1',
        kind: 'image',
        name: 'Linked image',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: [],
        mediaId: 'media-1',
        slideIndex: 2
      } satisfies ImageItem
    ]);

    const rendered = renderSlideToElement(
      slide,
      createPresentation(slide, {
        'media-1': {
          id: 'media-1',
          path: 'ppt/media/image1.png',
          contentType: 'image/png',
          data: new Uint8Array([137, 80, 78, 71])
        }
      })
    );
    const link = rendered.querySelector('.pptxv-item--image .pptxv-item-link') as HTMLAnchorElement | null;

    expect(link?.dataset.slideIndex).toBe('2');
    expect(link?.getAttribute('href')).toBe('#slide-3');
    expect(link?.getAttribute('aria-label')).toBe('Go to slide 3: Linked image');
  });

  it('renders item-level external links as accessible overlay anchors', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-link-1',
        kind: 'shape',
        name: 'External callout',
        shapeType: 'ellipse',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 140,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 1,
        groupPath: [],
        href: 'https://example.com/pptx-previewer/grouped-media',
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 8,
            right: 12,
            bottom: 8,
            left: 12
          },
          paragraphs: [
            {
              align: 'center',
              runs: [
                {
                  text: 'Open grouped docs'
                }
              ]
            }
          ]
        }
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const link = rendered.querySelector('.pptxv-item--shape .pptxv-item-link') as HTMLAnchorElement | null;
    const text = rendered.querySelector('.pptxv-shape-text');

    expect(text?.textContent).toContain('Open grouped docs');
    expect(link?.href).toBe('https://example.com/pptx-previewer/grouped-media');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
    expect(link?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(link?.getAttribute('aria-label')).toBe('Open link: External callout');
    expect(link?.title).toBe('External callout: https://example.com/pptx-previewer/grouped-media');
  });

  it('renders SVG dash presets for line shapes', () => {
    const slide = createBaseSlide([
      {
        id: 'line-dash-1',
        kind: 'shape',
        name: 'Dashed connector',
        shapeType: 'line',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 24,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#2F6BFF',
          width: 3,
          dash: 'lgDashDotDot'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const line = rendered.querySelector('line');

    expect(line?.getAttribute('stroke-dasharray')).toBe('18 9 3 6 3 6');
  });

  it('renders exact iWork dash arrays and reconstructed line endpoints', () => {
    const slide = createBaseSlide([
      {
        id: 'iwork-line-1',
        kind: 'shape',
        name: 'Keynote connector',
        shapeType: 'line',
        transform: {
          x: 114,
          y: 504,
          width: 296,
          height: 88,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        geometry: {
          type: 'line',
          x1: 0,
          y1: 88,
          x2: 296,
          y2: 0
        },
        fill: { type: 'none' },
        line: {
          color: '#929292',
          width: 2,
          dash: 'dash',
          dashPattern: [6, 6],
          dashOffset: 1.5
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const line = rendered.querySelector('line');

    expect(line?.getAttribute('x1')).toBe('0');
    expect(line?.getAttribute('y1')).toBe('88');
    expect(line?.getAttribute('x2')).toBe('296');
    expect(line?.getAttribute('y2')).toBe('0');
    expect(line?.getAttribute('stroke-dasharray')).toBe('6 6');
    expect(line?.getAttribute('stroke-dashoffset')).toBe('1.5');
  });

  it('renders arrow preset polygons for supported shape types', () => {
    const slide = createBaseSlide([
      {
        id: 'arrow-shape-1',
        kind: 'shape',
        name: 'Bidirectional Arrow',
        shapeType: 'leftRightArrow',
        transform: {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2,
          lineJoin: 'bevel'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const polygon = rendered.querySelector('polygon');

    expect(polygon?.getAttribute('points')).toBe('48,25 152,25 152,0 200,50 152,100 152,75 48,75 48,100 0,50 48,0');
    expect(polygon?.getAttribute('stroke-linejoin')).toBe('bevel');
  });

  it('renders extended polygon presets for additional common shape types', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-notch',
        kind: 'shape',
        name: 'Notched Arrow',
        shapeType: 'notchedRightArrow',
        transform: {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-home',
        kind: 'shape',
        name: 'Home Plate',
        shapeType: 'homePlate',
        transform: {
          x: 220,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFB020'
        },
        line: {
          color: '#B45309',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-diamond',
        kind: 'shape',
        name: 'Decision Diamond',
        shapeType: 'diamond',
        transform: {
          x: 440,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-triangle',
        kind: 'shape',
        name: 'Right Triangle',
        shapeType: 'rtTriangle',
        transform: {
          x: 660,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2ABF88'
        },
        line: {
          color: '#047857',
          width: 2
        },
        order: 4,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-bevel',
        kind: 'shape',
        name: 'Bevel Panel',
        shapeType: 'bevel',
        transform: {
          x: 880,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#8A63D2'
        },
        line: {
          color: '#6D28D9',
          width: 2
        },
        order: 5,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-star',
        kind: 'shape',
        name: 'Star Badge',
        shapeType: 'star5',
        geometry: {
          type: 'preset',
          preset: 'star5',
          adjustments: {
            adj: 22000
          }
        },
        transform: {
          x: 1100,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 6,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-octagon',
        kind: 'shape',
        name: 'Octagon Chip',
        shapeType: 'octagon',
        transform: {
          x: 1320,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#25A7C5'
        },
        line: {
          color: '#0F8FAE',
          width: 2
        },
        order: 7,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = Array.from(rendered.querySelectorAll('.pptxv-item--shape'));
    const polygons = shapeItems.map((shape) =>
      Array.from(shape.querySelectorAll('polygon')).map((node) => node.getAttribute('points'))
    );
    const bevelPaths = Array.from(shapeItems[4]?.querySelectorAll('path') ?? []).map((node) => node.getAttribute('d'));

    expect(polygons).toEqual([
      ['0,25 160,25 160,0 200,50 160,100 160,75 0,75 25,50'],
      ['0,0 150,0 200,50 150,100 0,100'],
      ['100,0 200,50 100,100 0,50'],
      ['0,0 200,100 0,100'],
      [],
      ['100,0 125.863,32.202 195.106,34.549 141.846,56.798 158.779,90.451 100,72 41.221,90.451 58.154,56.798 4.894,34.549 74.137,32.202'],
      ['0,29.289 29.289,0 170.711,0 200,29.289 200,70.711 170.711,100 29.289,100 0,70.711']
    ]);
    expect(bevelPaths).toHaveLength(5);
  });

  it('renders path and faceted SVG shapes for cloud, plaque, can, pie, chord, donut, arc, frame, and cube presets', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-cloud',
        kind: 'shape',
        name: 'Process Cloud',
        shapeType: 'cloud',
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 110,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#8A63D2'
        },
        line: {
          color: '#6D28D9',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-plaque',
        kind: 'shape',
        name: 'Plaque Banner',
        shapeType: 'plaque',
        transform: {
          x: 240,
          y: 0,
          width: 180,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-can',
        kind: 'shape',
        name: 'Can Pillar',
        shapeType: 'can',
        transform: {
          x: 440,
          y: 0,
          width: 140,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2ABF88'
        },
        line: {
          color: '#047857',
          width: 2
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-pie',
        kind: 'shape',
        name: 'Pie Slice',
        shapeType: 'pie',
        transform: {
          x: 600,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 4,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-frame',
        kind: 'shape',
        name: 'Frame Focus',
        shapeType: 'frame',
        transform: {
          x: 1120,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFB020'
        },
        line: {
          color: '#B45309',
          width: 2
        },
        order: 8,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-chord',
        kind: 'shape',
        name: 'Chord Slice',
        shapeType: 'chord',
        transform: {
          x: 740,
          y: 0,
          width: 120,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 5,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-donut',
        kind: 'shape',
        name: 'Donut Ring',
        shapeType: 'donut',
        transform: {
          x: 880,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#8A63D2'
        },
        line: {
          color: '#6D28D9',
          width: 2
        },
        order: 6,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-arc',
        kind: 'shape',
        name: 'Arc Sweep',
        shapeType: 'arc',
        transform: {
          x: 1020,
          y: 10,
          width: 140,
          height: 90,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#25A7C5',
          width: 3,
          lineCap: 'round',
          lineJoin: 'round'
        },
        order: 7,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-cube',
        kind: 'shape',
        name: 'Data Cube',
        shapeType: 'cube',
        transform: {
          x: 1280,
          y: 0,
          width: 200,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#0EA5E9'
        },
        line: {
          color: '#0369A1',
          width: 2
        },
        order: 9,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');
    const cloudPath = shapeItems[0]?.querySelector('path');
    const plaquePath = shapeItems[1]?.querySelector('path');
    const canPaths = shapeItems[2]?.querySelectorAll('path');
    const canEllipses = shapeItems[2]?.querySelectorAll('ellipse');
    const piePath = shapeItems[3]?.querySelector('path');
    const framePath = shapeItems[4]?.querySelector('path');
    const chordPath = shapeItems[5]?.querySelector('path');
    const donutPath = shapeItems[6]?.querySelector('path');
    const arcPath = shapeItems[7]?.querySelector('path');
    const cubeFaces = shapeItems[8]?.querySelectorAll('polygon');
    const cubePaths = shapeItems[8]?.querySelectorAll('path');

    expect(cloudPath?.getAttribute('d')).toContain('C');
    expect(plaquePath?.getAttribute('d')).toContain('Q');
    expect(plaquePath?.getAttribute('d')).toContain('Z');
    expect(canPaths).toHaveLength(1);
    expect(canEllipses).toHaveLength(1);
    expect(canPaths?.[0]?.getAttribute('d')).toContain('A');
    expect(canPaths?.[0]?.getAttribute('d')).toContain('L');
    expect(canPaths?.[0]?.getAttribute('d')).toContain('Z');
    expect(canPaths?.[0]?.getAttribute('fill')).not.toBe('none');
    expect(canEllipses?.[0]?.getAttribute('fill')).not.toBe('none');
    expect(piePath?.getAttribute('d')).toContain('A');
    expect(piePath?.getAttribute('d')).toContain('L');
    expect(piePath?.getAttribute('d')).toContain('Z');
    expect(chordPath?.getAttribute('d')).toContain('A');
    expect(chordPath?.getAttribute('d')).toContain('Z');
    expect(donutPath?.getAttribute('d')).toContain('A');
    expect(donutPath?.getAttribute('fill-rule')).toBe('evenodd');
    expect(arcPath?.getAttribute('d')).toContain('A');
    expect(arcPath?.getAttribute('fill')).toBe('none');
    expect(framePath?.getAttribute('d')).toContain('H');
    expect(framePath?.getAttribute('d')).toContain('V');
    expect(framePath?.getAttribute('fill-rule')).toBe('evenodd');
    expect(cubeFaces).toHaveLength(0);
    expect(cubePaths).toHaveLength(3);
    expect(cubePaths?.[0]?.getAttribute('d')).toBe('M 0 30 L 170 30 L 170 120 L 0 120 Z');
    expect(cubePaths?.[1]?.getAttribute('d')).toBe('M 170 30 L 200 0 L 200 90 L 170 120 Z');
    expect(cubePaths?.[2]?.getAttribute('d')).toBe('M 0 30 L 30 0 L 200 0 L 170 30 Z');
  });

  it('renders snip rectangle presets with visible fill and outline paint', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-snip-1',
        kind: 'shape',
        name: 'Snip One Corner',
        shapeType: 'snip1Rect',
        transform: {
          x: 0,
          y: 0,
          width: 140,
          height: 90,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#CC655B'
        },
        line: {
          color: '#0A111D',
          width: 4,
          dash: 'sysDash'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-snip-2',
        kind: 'shape',
        name: 'Snip Same Side',
        shapeType: 'snip2SameRect',
        transform: {
          x: 180,
          y: 0,
          width: 140,
          height: 90,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#0A111D',
          width: 4,
          dash: 'dash'
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-snip-3',
        kind: 'shape',
        name: 'Snip Diagonal',
        shapeType: 'snip2DiagRect',
        transform: {
          x: 360,
          y: 0,
          width: 140,
          height: 90,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#0A111D',
          width: 4,
          dash: 'dashDot'
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');
    const snipOnePath = shapeItems[0]?.querySelector('path');
    const snipSamePath = shapeItems[1]?.querySelector('path');
    const snipDiagPath = shapeItems[2]?.querySelector('path');

    expect(snipOnePath?.getAttribute('fill')).toBe('#CC655B');
    expect(snipOnePath?.getAttribute('stroke')).toBe('#0A111D');
    expect(snipOnePath?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(snipSamePath?.getAttribute('fill')).toBe('#4472C4');
    expect(snipSamePath?.getAttribute('stroke')).toBe('#0A111D');
    expect(snipSamePath?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(snipDiagPath?.getAttribute('fill')).toBe('#4472C4');
    expect(snipDiagPath?.getAttribute('stroke')).toBe('#0A111D');
    expect(snipDiagPath?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('renders custom geometry shapes as SVG paths instead of rectangle fallbacks', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-custom-blob',
        kind: 'shape',
        name: 'Custom Blob',
        shapeType: 'rect',
        transform: {
          x: 0,
          y: 0,
          width: 140,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#70AD47'
        },
        line: {
          color: '#0A111D',
          width: 2,
          lineJoin: 'miter'
        },
        geometry: {
          type: 'custom',
          paths: [
            {
              width: 1106883,
              height: 832908,
              commands: [
                { type: 'M', x: 246565, y: 3521 },
                { type: 'C', x1: 427993, y1: 32549, x2: 1124679, y2: 301063, x: 1106536, y: 438949 },
                { type: 'C', x1: 1088393, y1: 576835, x2: 319136, y2: 859863, x: 137708, y: 830835 },
                { type: 'C', x1: -43720, y1: 801807, x2: -178, y2: 399035, x: 17965, y: 264778 },
                { type: 'C', x1: 36108, y1: 130521, x2: 65137, y2: -25507, x: 246565, y: 3521 },
                { type: 'Z' }
              ]
            }
          ]
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-custom-open',
        kind: 'shape',
        name: 'Custom Open Stroke',
        shapeType: 'rect',
        transform: {
          x: 180,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#0A111D',
          width: 4,
          dash: 'lgDashDotDot',
          lineJoin: 'miter'
        },
        geometry: {
          type: 'custom',
          paths: [
            {
              width: 842962,
              height: 1200150,
              fill: 'none',
              commands: [
                { type: 'M', x: 0, y: 0 },
                { type: 'L', x: 842962, y: 28575 },
                { type: 'L', x: 842962, y: 885825 },
                { type: 'L', x: 71437, y: 1200150 },
                { type: 'L', x: 28575, y: 771525 }
              ]
            }
          ]
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');
    const blobPath = shapeItems[0]?.querySelector('path');
    const openPath = shapeItems[1]?.querySelector('path');

    expect(shapeItems[0]?.querySelector('rect')).toBeNull();
    expect(blobPath?.getAttribute('d')).toContain('C');
    expect(blobPath?.getAttribute('fill')).toBe('#70AD47');
    expect(blobPath?.getAttribute('stroke')).toBe('#0A111D');
    expect(blobPath?.getAttribute('stroke-linejoin')).toBe('round');
    expect(shapeItems[1]?.querySelector('rect')).toBeNull();
    expect(openPath?.getAttribute('d')).toContain('L');
    expect(openPath?.getAttribute('fill')).toBe('none');
    expect(openPath?.getAttribute('stroke')).toBe('#0A111D');
    expect(openPath?.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(openPath?.getAttribute('stroke-linejoin')).toBe('miter');
  });

  it('expands custom geometry svg bounds when freeform control points extend beyond the declared path box', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-custom-overflow',
        kind: 'shape',
        name: 'Overflowing Freeform',
        shapeType: 'rect',
        transform: {
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#0A111D',
          width: 2
        },
        geometry: {
          type: 'custom',
          paths: [
            {
              width: 100,
              height: 100,
              fill: 'none',
              commands: [
                { type: 'M', x: -20, y: 10 },
                { type: 'C', x1: 20, y1: -30, x2: 130, y2: 40, x: 110, y: 120 }
              ]
            }
          ]
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const svg = rendered.querySelector('.pptxv-item--shape svg') as SVGSVGElement | null;

    expect(svg?.getAttribute('viewBox')).toBe('-36 -36 192 152');
    expect(svg?.style.left).toBe('-36px');
    expect(svg?.style.top).toBe('-36px');
  });

  it('renders corner and diagStripe presets with the same wide profiles used by the reference deck', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-corner-ref',
        kind: 'shape',
        name: 'Reference Corner',
        shapeType: 'corner',
        transform: {
          x: 0,
          y: 0,
          width: 197,
          height: 110,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#0A111D',
          width: 1
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-diag-ref',
        kind: 'shape',
        name: 'Reference Diag Stripe',
        shapeType: 'diagStripe',
        transform: {
          x: 220,
          y: 0,
          width: 158,
          height: 110,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#70AD47'
        },
        line: {
          color: '#0A111D',
          width: 1
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');
    const cornerPath = shapeItems[0]?.querySelector('path');
    const diagPath = shapeItems[1]?.querySelector('path');

    expect(cornerPath?.getAttribute('d')).toBe('M 0 0 L 83.889 0 L 83.889 72.778 L 197 72.778 L 197 110 L 0 110 Z');
    expect(diagPath?.getAttribute('d')).toBe('M 64.636 0 L 158 0 L 0 110 L 0 45 Z');
  });

  it('renders slide 2 snip and rounded rectangle presets with the same geometry as the remote sample deck', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-snip-round-ref',
        kind: 'shape',
        name: 'Reference Snip Round',
        shapeType: 'snipRoundRect',
        geometry: {
          type: 'preset',
          preset: 'snipRoundRect',
          adjustments: {
            adj1: 50000,
            adj2: 34849
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 118.11,
          height: 83.82,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-round-same-ref',
        kind: 'shape',
        name: 'Reference Round Same',
        shapeType: 'round2SameRect',
        geometry: {
          type: 'preset',
          preset: 'round2SameRect',
          adjustments: {
            adj1: 50000,
            adj2: 0
          }
        },
        transform: {
          x: 140,
          y: 0,
          width: 107.95,
          height: 92.71,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-snip-same-ref',
        kind: 'shape',
        name: 'Reference Snip Same',
        shapeType: 'snip2SameRect',
        geometry: {
          type: 'preset',
          preset: 'snip2SameRect',
          adjustments: {
            adj1: 36364,
            adj2: 27273
          }
        },
        transform: {
          x: 280,
          y: 0,
          width: 127,
          height: 83.82,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-snip-diag-ref',
        kind: 'shape',
        name: 'Reference Snip Diag',
        shapeType: 'snip2DiagRect',
        geometry: {
          type: 'preset',
          preset: 'snip2DiagRect',
          adjustments: {
            adj1: 17910,
            adj2: 34578
          }
        },
        transform: {
          x: 430,
          y: 0,
          width: 133.35,
          height: 85.09,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        order: 4,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-round-diag-ref',
        kind: 'shape',
        name: 'Reference Round Diag',
        shapeType: 'round2DiagRect',
        geometry: {
          type: 'preset',
          preset: 'round2DiagRect',
          adjustments: {
            adj1: 50000,
            adj2: 8750
          }
        },
        transform: {
          x: 590,
          y: 0,
          width: 184.785,
          height: 101.6,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        order: 5,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');
    const snipRoundPath = shapeItems[0]?.querySelector('path');
    const roundSamePath = shapeItems[1]?.querySelector('path');
    const snipSamePath = shapeItems[2]?.querySelector('path');
    const snipDiagPath = shapeItems[3]?.querySelector('path');
    const roundDiagPath = shapeItems[4]?.querySelector('path');

    expect(snipRoundPath?.getAttribute('d')).toBe(
      'M 41.91 0 H 88.9 L 118.11 29.21 V 83.82 H 0 V 41.91 A 41.91 41.91 0 0 1 41.91 0 Z'
    );
    expect(roundSamePath?.getAttribute('d')).toBe(
      'M 46.355 0 H 61.595 A 46.355 46.355 0 0 1 107.95 46.355 V 92.71 A 0 0 0 0 1 107.95 92.71 H 0 A 0 0 0 0 1 0 92.71 V 46.355 A 46.355 46.355 0 0 1 46.355 0 Z'
    );
    expect(snipSamePath?.getAttribute('d')).toBe('M 30.48 0 H 96.52 L 127 30.48 V 60.96 L 104.14 83.82 H 22.86 L 0 60.96 V 30.48 Z');
    expect(snipDiagPath?.getAttribute('d')).toBe(
      'M 15.24 0 H 103.928 L 133.35 29.422 V 69.85 L 118.11 85.09 H 29.422 L 0 55.668 V 15.24 Z'
    );
    expect(roundDiagPath?.getAttribute('d')).toBe(
      'M 50.8 0 H 175.895 A 8.89 8.89 0 0 1 184.785 8.89 V 50.8 A 50.8 50.8 0 0 1 133.985 101.6 H 8.89 A 8.89 8.89 0 0 1 0 92.71 V 50.8 A 50.8 50.8 0 0 1 50.8 0 Z'
    );
  });

  it('renders plus presets with axis-specific adjustment ratios from the reference deck', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-plus-ref',
        kind: 'shape',
        name: 'Reference Plus',
        shapeType: 'plus',
        geometry: {
          type: 'preset',
          preset: 'plus',
          adjustments: {
            adj: 42281
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 115,
          height: 109,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#7030A0'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        textFrame: {
          verticalAlign: 'middle',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Quad'
                }
              ]
            }
          ]
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const plusPath = rendered.querySelector('.pptxv-item--shape path');

    expect(plusPath?.getAttribute('d')).toBe(
      'M 46.086 0 L 68.914 0 L 68.914 46.086 L 115 46.086 L 115 62.914 L 68.914 62.914 L 68.914 109 L 46.086 109 L 46.086 62.914 L 0 62.914 L 0 46.086 L 46.086 46.086 Z'
    );
  });

  it('renders quad arrow presets with the reference 24-point stem and head geometry', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-quad-arrow',
        kind: 'shape',
        name: 'Reference Quad Arrow',
        shapeType: 'quadArrow',
        geometry: {
          type: 'preset',
          preset: 'quadArrow',
          adjustments: {}
        },
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#4472C4'
        },
        line: {
          color: '#172C51',
          width: 1
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const quadArrowPolygon = rendered.querySelector('.pptxv-item--shape polygon');

    expect(quadArrowPolygon?.getAttribute('points')).toBe(
      '0,90 40.5,49.5 40.5,69.75 89.75,69.75 89.75,40.5 69.5,40.5 110,0 150.5,40.5 130.25,40.5 130.25,69.75 179.5,69.75 179.5,49.5 220,90 179.5,130.5 179.5,110.25 130.25,110.25 130.25,139.5 150.5,139.5 110,180 69.5,139.5 89.75,139.5 89.75,110.25 40.5,110.25 40.5,130.5'
    );
    expect(quadArrowPolygon?.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('shortens painted svg dash segments for round-capped strokes so heavy dash-dot borders stay closer to PowerPoint', () => {
    const slide = createBaseSlide([
      {
        id: 'line-dash-round-cap',
        kind: 'shape',
        name: 'Round capped dash-dot-dot',
        shapeType: 'line',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 24,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#2F6BFF',
          width: 3,
          dash: 'lgDashDotDot',
          lineCap: 'round'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const line = rendered.querySelector('line');

    expect(line?.getAttribute('stroke-dasharray')).toBe('15 9 0.01 6 0.01 6');
  });

  it('compresses preset dash spacing for very thick strokes so shape outlines do not turn into a handful of oversized bars', () => {
    const slide = createBaseSlide([
      {
        id: 'line-dash-heavy-flat-cap',
        kind: 'shape',
        name: 'Heavy flat capped dash-dot-dot',
        shapeType: 'line',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 24,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#2F6BFF',
          width: 13.333333,
          dash: 'lgDashDotDot',
          lineCap: 'butt'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'line-dot-heavy-flat-cap',
        kind: 'shape',
        name: 'Heavy flat capped dot',
        shapeType: 'line',
        transform: {
          x: 0,
          y: 40,
          width: 240,
          height: 24,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#2F6BFF',
          width: 13.333333,
          dash: 'sysDot',
          lineCap: 'butt'
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const lines = rendered.querySelectorAll('line');

    expect(lines[0]?.getAttribute('stroke-dasharray')).toBe('80 40 13.333 26.667 13.333 26.667');
    expect(lines[1]?.getAttribute('stroke-dasharray')).toBe('13.333 24');
  });

  it('renders circular arrow, curved arrow, and smiley face presets with grouped SVG nodes', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-left-circular-arrow',
        kind: 'shape',
        name: 'Circular Loop',
        shapeType: 'leftCircularArrow',
        transform: {
          x: 0,
          y: 0,
          width: 160,
          height: 160,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2,
          lineJoin: 'round'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-curved-right-arrow',
        kind: 'shape',
        name: 'Curved Forward Arrow',
        shapeType: 'curvedRightArrow',
        transform: {
          x: 190,
          y: 10,
          width: 180,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2,
          lineJoin: 'round'
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-smiley-face',
        kind: 'shape',
        name: 'Smiley Marker',
        shapeType: 'smileyFace',
        transform: {
          x: 400,
          y: 0,
          width: 160,
          height: 160,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFEB70'
        },
        line: {
          color: '#122033',
          width: 2,
          lineJoin: 'round'
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');

    const circularArrowGroup = shapeItems[0]?.querySelector('g');
    const circularArrowPath = circularArrowGroup?.querySelector('path');
    const circularArrowHead = circularArrowGroup?.querySelector('polygon');

    const curvedArrowPaths = shapeItems[1]?.querySelectorAll('path');
    const curvedArrowCapPath = curvedArrowPaths?.[0] ?? null;
    const curvedArrowBandPath = curvedArrowPaths?.[1] ?? null;

    const smileyGroup = shapeItems[2]?.querySelector('g');
    const smileyFace = smileyGroup?.querySelector('ellipse');
    const smileyEyes = smileyGroup?.querySelectorAll('circle');
    const smileyMouth = smileyGroup?.querySelector('path');

    expect(circularArrowGroup).toBeTruthy();
    expect(circularArrowPath?.getAttribute('d')).toContain('A');
    expect(circularArrowPath?.getAttribute('d')).toContain('Z');
    expect(circularArrowHead?.getAttribute('points')).toContain(',');

    expect(curvedArrowPaths).toHaveLength(2);
    expect(curvedArrowCapPath?.getAttribute('d')).toBe(
      'M 180 0 A 180 37.5 0 0 0 0 37.5 L 0 67.5 A 180 37.5 0 0 1 180 30 Z'
    );
    expect(curvedArrowBandPath?.getAttribute('d')).toBe(
      'M 0 37.5 A 180 37.5 0 0 0 150 74.475 L 150 59.475 L 180 90 L 150 120 L 150 119.475 A 180 37.5 0 0 1 0 67.5 Z'
    );
    expect(curvedArrowCapPath?.getAttribute('fill')).not.toBe('none');
    expect(curvedArrowBandPath?.getAttribute('fill')).not.toBe('none');
    expect(curvedArrowCapPath?.getAttribute('stroke')).toBe('none');
    expect(curvedArrowBandPath?.getAttribute('stroke')).toBe('none');

    expect(smileyGroup).toBeTruthy();
    expect(smileyFace?.tagName.toLowerCase()).toBe('ellipse');
    expect(smileyEyes).toHaveLength(2);
    expect(smileyMouth?.getAttribute('d')).toContain('Q');
    expect(smileyMouth?.getAttribute('fill')).toBe('none');
    expect(smileyMouth?.getAttribute('stroke-linecap')).toBe('round');
  });

  it('renders arrow callout presets with dedicated body geometry', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-right-arrow-callout',
        kind: 'shape',
        name: 'Right Arrow Callout',
        shapeType: 'rightArrowCallout',
        transform: {
          x: 0,
          y: 0,
          width: 180,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#2F6BFF' },
        line: { color: '#1D4ED8', width: 2 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-left-arrow-callout',
        kind: 'shape',
        name: 'Left Arrow Callout',
        shapeType: 'leftArrowCallout',
        transform: {
          x: 220,
          y: 0,
          width: 120,
          height: 88,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#7C3AED' },
        line: { color: '#5B21B6', width: 2 },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-left-right-arrow-callout',
        kind: 'shape',
        name: 'Left Right Arrow Callout',
        shapeType: 'leftRightArrowCallout',
        transform: {
          x: 380,
          y: 0,
          width: 220,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#FF7A59' },
        line: { color: '#C2410C', width: 2 },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-up-arrow-callout',
        kind: 'shape',
        name: 'Up Arrow Callout',
        shapeType: 'upArrowCallout',
        transform: {
          x: 640,
          y: 0,
          width: 118,
          height: 85,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#0F766E' },
        line: { color: '#115E59', width: 2 },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-quad-arrow-callout',
        kind: 'shape',
        name: 'Quad Arrow Callout',
        shapeType: 'quadArrowCallout',
        transform: {
          x: 0,
          y: 160,
          width: 220,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#2ABF88' },
        line: { color: '#047857', width: 2 },
        order: 4,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const polygons = rendered.querySelectorAll('.pptxv-item--shape polygon');
    const pointCounts = Array.from(polygons).map((polygon) => polygon.getAttribute('points')?.trim().split(/\s+/).length ?? 0);

    expect(polygons).toHaveLength(5);
    expect(pointCounts).toEqual([11, 11, 18, 11, 32]);
    expect(Array.from(polygons).every((polygon) => polygon.getAttribute('stroke-linejoin') === 'round')).toBe(true);
    expect(polygons[0]?.getAttribute('points')).toContain('180,60');
    expect(polygons[1]?.getAttribute('points')).toBe('0,44 22,22 22,33 42.028,33 42.028,0 120,0 120,88 42.028,88 42.028,55 22,55 22,66');
    expect(polygons[2]?.getAttribute('points')).toContain('0,60');
    expect(polygons[2]?.getAttribute('points')).toContain('220,60');
    expect(polygons[3]?.getAttribute('points')).toBe(
      '0,29.77 48.375,29.77 48.375,21.25 37.75,21.25 59,0 80.25,21.25 69.625,21.25 69.625,29.77 118,29.77 118,85 0,85'
    );
    expect(polygons[4]?.getAttribute('points')).toContain('110,0');
    expect(polygons[4]?.getAttribute('points')).toContain('110,180');
  });

  it('renders bent and return arrow presets with dedicated elbow geometry', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-bent-arrow',
        kind: 'shape',
        name: 'Bent Arrow',
        shapeType: 'bentArrow',
        transform: {
          x: 0,
          y: 0,
          width: 140,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#2F6BFF' },
        line: { color: '#1D4ED8', width: 2 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-uturn-arrow',
        kind: 'shape',
        name: 'UTurn Arrow',
        shapeType: 'uturnArrow',
        transform: {
          x: 180,
          y: 0,
          width: 140,
          height: 220,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#FF7A59' },
        line: { color: '#C2410C', width: 2 },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-left-up-arrow',
        kind: 'shape',
        name: 'Left Up Arrow',
        shapeType: 'leftUpArrow',
        transform: {
          x: 360,
          y: 0,
          width: 180,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#2ABF88' },
        line: { color: '#047857', width: 2 },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-bent-up-arrow',
        kind: 'shape',
        name: 'Bent Up Arrow',
        shapeType: 'bentUpArrow',
        transform: {
          x: 580,
          y: 0,
          width: 160,
          height: 180,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#FFB020' },
        line: { color: '#B45309', width: 2 },
        order: 4,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const polygons = rendered.querySelectorAll('.pptxv-item--shape polygon');
    const paths = rendered.querySelectorAll('.pptxv-item--shape path');
    const pointCounts = Array.from(polygons).map((polygon) => polygon.getAttribute('points')?.trim().split(/\s+/).length ?? 0);

    expect(polygons).toHaveLength(2);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute('d')).toContain('M 140 33.072');
    expect(paths[0]?.getAttribute('d')).toContain('A 34.8 34.8');
    expect(paths[0]?.getAttribute('d')).toContain('A 3.6 3.6');
    expect(paths[1]?.getAttribute('d')).toContain('A');
    expect(pointCounts).toEqual([12, 9]);
    expect(polygons[0]?.getAttribute('points')).toBe(
      '0,137.195 45,94.39 45,115.793 112.5,115.793 112.5,42.805 90,42.805 135,0 180,42.805 157.5,42.805 157.5,158.598 45,158.598 45,180'
    );
    expect(polygons[1]?.getAttribute('points')).toContain('120,0');
    expect(polygons[1]?.getAttribute('points')).toContain('140,180');
  });

  it('renders left-right-up arrows with the reference slide-4 proportions', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-left-right-up-arrow',
        kind: 'shape',
        name: 'Left Right Up Arrow',
        shapeType: 'leftRightUpArrow',
        transform: {
          x: 0,
          y: 0,
          width: 233.143,
          height: 168.46,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#4472C4' },
        line: { color: '#172C51', width: 1.333 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const path = rendered.querySelector('.pptxv-item--shape path');

    expect(path?.getAttribute('d')).toBe(
      'M 0 130.556 L 37.769 92.653 L 37.769 111.605 L 97.687 111.605 L 97.687 37.904 L 78.802 37.904 L 116.572 0 L 154.341 37.904 L 135.456 37.904 L 135.456 111.605 L 195.374 111.605 L 195.374 92.653 L 233.143 130.556 L 195.374 168.46 L 195.374 149.508 L 37.769 149.508 L 37.769 168.46 Z'
    );
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('renders teardrops with adjustment-driven tips from the reference deck', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-teardrop',
        kind: 'shape',
        name: 'Teardrop',
        shapeType: 'teardrop',
        geometry: {
          type: 'preset',
          preset: 'teardrop',
          adjustments: {
            adj: 141918
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 120,
          height: 112,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#70AD47' },
        line: { color: '#385723', width: 1.333 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const path = rendered.querySelector('.pptxv-item--shape path');
    const clipPath = rendered.querySelector('.pptxv-item--shape clipPath');

    expect(path?.getAttribute('d')).toBe(
      'M 120 56 A 60 56 0 1 1 60 0 Q 102.575 0 145.151 -23.474 Q 120 16.263 120 56'
    );
    expect(clipPath).toBeNull();
  });

  it('resolves elliptical pie and chord sweep points using center-ray intersections', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-elliptical-pie',
        kind: 'shape',
        name: 'Elliptical Pie',
        shapeType: 'pie',
        geometry: {
          type: 'preset',
          preset: 'pie',
          adjustments: {
            adj1: 1442868,
            adj2: 18776329
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 132,
          height: 96,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#7030A0' },
        line: { color: '#172C51', width: 1.333 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-elliptical-chord',
        kind: 'shape',
        name: 'Elliptical Chord',
        shapeType: 'chord',
        geometry: {
          type: 'preset',
          preset: 'chord',
          adjustments: {
            adj1: 4034290,
            adj2: 20474016
          }
        },
        transform: {
          x: 160,
          y: 0,
          width: 128,
          height: 93,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#5B9BD5' },
        line: { color: '#172C51', width: 1.333 },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const paths = rendered.querySelectorAll('.pptxv-item--shape path');

    expect(paths[0]?.getAttribute('d')).toBe('M 122.255 73.103 A 66 48 0 1 1 102.991 8.247 L 66 48 Z');
    expect(paths[1]?.getAttribute('d')).toBe('M 82.662 90.979 A 64 46.5 0 1 1 121.974 26.802 Z');
  });

  it('renders striped right arrows with the reference two-stripe tail treatment', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-striped-right-arrow',
        kind: 'shape',
        name: 'Striped Right Arrow',
        shapeType: 'stripedRightArrow',
        transform: {
          x: 0,
          y: 0,
          width: 210,
          height: 82,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'solid', color: '#4472C4' },
        line: { color: '#172C51', width: 1.333 },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const polygons = rendered.querySelectorAll('.pptxv-item--shape polygon');

    expect(polygons).toHaveLength(3);
    expect(polygons[0]?.getAttribute('points')).toBe('12.958,20.5 168.535,20.5 168.535,0 210,41 168.535,82 168.535,61.5 12.958,61.5');
    expect(polygons[1]?.getAttribute('points')).toBe('0,20.5 2.592,20.5 2.592,61.5 0,61.5');
    expect(polygons[2]?.getAttribute('points')).toBe('5.183,20.5 7.775,20.5 7.775,61.5 5.183,61.5');
  });

  it('applies preset geometry adjustments from shape metadata', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-adjusted-donut',
        kind: 'shape',
        name: 'Adjusted Donut',
        shapeType: 'donut',
        geometry: {
          type: 'preset',
          preset: 'donut',
          adjustments: {
            adj: 32000
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#8A63D2'
        },
        line: {
          color: '#6D28D9',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-frame',
        kind: 'shape',
        name: 'Adjusted Frame',
        shapeType: 'frame',
        geometry: {
          type: 'preset',
          preset: 'frame',
          adjustments: {
            adj1: 28000
          }
        },
        transform: {
          x: 150,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFB020'
        },
        line: {
          color: '#B45309',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-pie',
        kind: 'shape',
        name: 'Adjusted Pie',
        shapeType: 'pie',
        geometry: {
          type: 'preset',
          preset: 'pie',
          adjustments: {
            adj1: 16200000,
            adj2: 1200000
          }
        },
        transform: {
          x: 300,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-chord',
        kind: 'shape',
        name: 'Adjusted Chord',
        shapeType: 'chord',
        geometry: {
          type: 'preset',
          preset: 'chord',
          adjustments: {
            adj1: 0,
            adj2: 16200000
          }
        },
        transform: {
          x: 450,
          y: 0,
          width: 120,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 4,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-arc',
        kind: 'shape',
        name: 'Adjusted Arc',
        shapeType: 'arc',
        geometry: {
          type: 'preset',
          preset: 'arc',
          adjustments: {
            adj1: 16200000,
            adj2: 5400000
          }
        },
        transform: {
          x: 600,
          y: 0,
          width: 120,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#25A7C5',
          width: 2,
          lineCap: 'round'
        },
        order: 5,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-left-circular-arrow',
        kind: 'shape',
        name: 'Adjusted Circular Loop',
        shapeType: 'leftCircularArrow',
        geometry: {
          type: 'preset',
          preset: 'leftCircularArrow',
          adjustments: {
            adj1: 17000,
            adj2: -3000000,
            adj3: 14400000,
            adj4: 2400000,
            adj5: 5000
          }
        },
        transform: {
          x: 750,
          y: 0,
          width: 160,
          height: 160,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2ABF88'
        },
        line: {
          color: '#047857',
          width: 2,
          lineJoin: 'round'
        },
        order: 6,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-curved-right-arrow',
        kind: 'shape',
        name: 'Adjusted Curved Arrow',
        shapeType: 'curvedRightArrow',
        geometry: {
          type: 'preset',
          preset: 'curvedRightArrow',
          adjustments: {
            adj1: 22000,
            adj2: 30000,
            adj3: 32000
          }
        },
        transform: {
          x: 940,
          y: 0,
          width: 180,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFB020'
        },
        line: {
          color: '#B45309',
          width: 2,
          lineJoin: 'round'
        },
        order: 7,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-smiley-face',
        kind: 'shape',
        name: 'Adjusted Smiley',
        shapeType: 'smileyFace',
        geometry: {
          type: 'preset',
          preset: 'smileyFace',
          adjustments: {
            adj: -3000
          }
        },
        transform: {
          x: 1140,
          y: 0,
          width: 160,
          height: 160,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFEB70'
        },
        line: {
          color: '#122033',
          width: 2,
          lineJoin: 'round'
        },
        order: 8,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = rendered.querySelectorAll('.pptxv-item--shape');
    const donutPath = shapeItems[0]?.querySelector('path');
    const framePath = shapeItems[1]?.querySelector('path');
    const piePath = shapeItems[2]?.querySelector('path');
    const chordPath = shapeItems[3]?.querySelector('path');
    const arcPath = shapeItems[4]?.querySelector('path');
    const circularArrowPath = shapeItems[5]?.querySelector('path');
    const circularArrowHead = shapeItems[5]?.querySelector('polygon');
    const curvedArrowPaths = shapeItems[6]?.querySelectorAll('path');
    const curvedArrowCapPath = curvedArrowPaths?.[0] ?? null;
    const curvedArrowBandPath = curvedArrowPaths?.[1] ?? null;
    const smileyMouth = shapeItems[7]?.querySelector('path:last-of-type');

    expect(donutPath?.getAttribute('d')).toContain('21.6');
    expect(donutPath?.getAttribute('d')).toContain('38.4');
    expect(framePath?.getAttribute('d')).toContain('M 33.6 33.6');
    expect(framePath?.getAttribute('d')).toContain('H 86.4');
    expect(framePath?.getAttribute('d')).toContain('V 86.4');
    expect(piePath?.getAttribute('d')).toContain('M 60 0');
    expect(piePath?.getAttribute('d')).toContain('A 60 60 0 0 1');
    expect(piePath?.getAttribute('d')).toContain('116.382 80.521');
    expect(piePath?.getAttribute('d')).toContain('L 60 60 Z');
    expect(chordPath?.getAttribute('d')).toBe('M 120 50 A 60 50 0 1 1 60 0 Z');
    expect(arcPath?.getAttribute('d')).toBe('M 60 0 A 60 60 0 0 1 60 120');
    expect(arcPath?.getAttribute('fill')).toBe('none');
    expect(circularArrowPath?.getAttribute('d')).toContain('M 141.284 131.423');
    expect(circularArrowPath?.getAttribute('d')).toContain('A 80 80 0 1 1 40 10.718');
    expect(circularArrowPath?.getAttribute('d')).toContain('A 52.8 52.8 0 1 0');
    expect(circularArrowHead?.getAttribute('points')).toBe('40,10.718 -6.663,64.719 53.6,34.274');
    expect(curvedArrowPaths).toHaveLength(2);
    expect(curvedArrowCapPath?.getAttribute('d')).toBe(
      'M 180 0 A 180 44.4 0 0 0 0 44.4 L 0 70.8 A 180 44.4 0 0 1 180 26.4 Z'
    );
    expect(curvedArrowBandPath?.getAttribute('d')).toBe(
      'M 0 44.4 A 180 44.4 0 0 0 141.6 87.778 L 141.6 82.978 L 180 102 L 141.6 120 L 141.6 118.978 A 180 44.4 0 0 1 0 70.8 Z'
    );
    expect(curvedArrowCapPath?.getAttribute('fill')).not.toBe('none');
    expect(curvedArrowBandPath?.getAttribute('fill')).not.toBe('none');
    expect(curvedArrowCapPath?.getAttribute('stroke')).toBe('none');
    expect(curvedArrowBandPath?.getAttribute('stroke')).toBe('none');
    expect(smileyMouth?.getAttribute('d')).toBe('M 36.639 127.133 Q 80 107.933 123.259 127.133');
    expect(smileyMouth?.getAttribute('fill')).toBe('none');
  });

  it('applies polygonal preset geometry adjustments from shape metadata', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-adjusted-right-arrow',
        kind: 'shape',
        name: 'Adjusted Right Arrow',
        shapeType: 'rightArrow',
        geometry: {
          type: 'preset',
          preset: 'rightArrow',
          adjustments: {
            adj1: 60000,
            adj2: 45000
          }
        },
        transform: {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-notched-right-arrow',
        kind: 'shape',
        name: 'Adjusted Notched Arrow',
        shapeType: 'notchedRightArrow',
        geometry: {
          type: 'preset',
          preset: 'notchedRightArrow',
          adjustments: {
            adj1: 40000,
            adj2: 50000
          }
        },
        transform: {
          x: 220,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-home-plate',
        kind: 'shape',
        name: 'Adjusted Home Plate',
        shapeType: 'homePlate',
        geometry: {
          type: 'preset',
          preset: 'homePlate',
          adjustments: {
            adj: 32000
          }
        },
        transform: {
          x: 440,
          y: 0,
          width: 120,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFB020'
        },
        line: {
          color: '#B45309',
          width: 2
        },
        order: 3,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-bevel',
        kind: 'shape',
        name: 'Adjusted Bevel',
        shapeType: 'bevel',
        geometry: {
          type: 'preset',
          preset: 'bevel',
          adjustments: {
            adj: 30000
          }
        },
        transform: {
          x: 580,
          y: 0,
          width: 120,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#8A63D2'
        },
        line: {
          color: '#6D28D9',
          width: 2
        },
        order: 4,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-chevron',
        kind: 'shape',
        name: 'Adjusted Chevron',
        shapeType: 'chevron',
        geometry: {
          type: 'preset',
          preset: 'chevron',
          adjustments: {
            adj: 30000
          }
        },
        transform: {
          x: 720,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#25A7C5'
        },
        line: {
          color: '#0F766E',
          width: 2
        },
        order: 5,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-parallelogram',
        kind: 'shape',
        name: 'Adjusted Parallelogram',
        shapeType: 'parallelogram',
        geometry: {
          type: 'preset',
          preset: 'parallelogram',
          adjustments: {
            adj: 30000
          }
        },
        transform: {
          x: 940,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2ABF88'
        },
        line: {
          color: '#15803D',
          width: 2
        },
        order: 6,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-trapezoid',
        kind: 'shape',
        name: 'Adjusted Trapezoid',
        shapeType: 'trapezoid',
        geometry: {
          type: 'preset',
          preset: 'trapezoid',
          adjustments: {
            adj: 24000
          }
        },
        transform: {
          x: 1160,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FF7A59'
        },
        line: {
          color: '#C2410C',
          width: 2
        },
        order: 7,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-hexagon',
        kind: 'shape',
        name: 'Adjusted Hexagon',
        shapeType: 'hexagon',
        geometry: {
          type: 'preset',
          preset: 'hexagon',
          adjustments: {
            adj: 25000
          }
        },
        transform: {
          x: 1380,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 8,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-hexagon-vf',
        kind: 'shape',
        name: 'Adjusted Hexagon Vf',
        shapeType: 'hexagon',
        geometry: {
          type: 'preset',
          preset: 'hexagon',
          adjustments: {
            adj: 25000,
            vf: 80000
          }
        },
        transform: {
          x: 1600,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#60A5FA'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 9,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-triangle',
        kind: 'shape',
        name: 'Adjusted Triangle',
        shapeType: 'triangle',
        geometry: {
          type: 'preset',
          preset: 'triangle',
          adjustments: {
            adj: 40000
          }
        },
        transform: {
          x: 1820,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#FFB020'
        },
        line: {
          color: '#B45309',
          width: 2
        },
        order: 10,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-pentagon',
        kind: 'shape',
        name: 'Pentagon',
        shapeType: 'pentagon',
        geometry: {
          type: 'preset',
          preset: 'pentagon',
          adjustments: {}
        },
        transform: {
          x: 2040,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#8A63D2'
        },
        line: {
          color: '#6D28D9',
          width: 2
        },
        order: 11,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-octagon',
        kind: 'shape',
        name: 'Adjusted Octagon',
        shapeType: 'octagon',
        geometry: {
          type: 'preset',
          preset: 'octagon',
          adjustments: {
            adj: 26000
          }
        },
        transform: {
          x: 2260,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#25A7C5'
        },
        line: {
          color: '#0F8FAE',
          width: 2
        },
        order: 12,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-adjusted-star',
        kind: 'shape',
        name: 'Adjusted Star',
        shapeType: 'star5',
        geometry: {
          type: 'preset',
          preset: 'star5',
          adjustments: {
            adj: 22000
          }
        },
        transform: {
          x: 2480,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        order: 13,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shapeItems = Array.from(rendered.querySelectorAll('.pptxv-item--shape'));
    const polygons = shapeItems.map((shape) =>
      Array.from(shape.querySelectorAll('polygon')).map((node) => node.getAttribute('points'))
    );
    const bevelPaths = Array.from(shapeItems[3]?.querySelectorAll('path') ?? []).map((node) => node.getAttribute('d'));

    expect(polygons).toEqual([
      ['0,30 150,30 150,0 200,50 150,100 150,70 0,70'],
      ['0,20 100,20 100,0 200,50 100,100 100,80 0,80 20,50'],
      ['0,0 88,0 120,50 88,100 0,100'],
      [],
      ['0,0 170,0 200,50 170,100 0,100 30,50'],
      ['0,100 30,0 200,0 170,100'],
      ['0,100 24,0 176,0 200,100'],
      ['0,50 25,0 175,0 200,50 175,100 25,100'],
      ['0,50 25,15.359 175,15.359 200,50 175,84.641 25,84.641'],
      ['0,100 80,0 200,100'],
      ['0,38.197 100,0 200,38.197 161.803,100 38.197,100'],
      ['0,26 26,0 174,0 200,26 200,74 174,100 26,100 0,74'],
      ['100,0 125.863,32.202 195.106,34.549 141.846,56.798 158.779,90.451 100,72 41.221,90.451 58.154,56.798 4.894,34.549 74.137,32.202']
    ]);
    expect(bevelPaths).toHaveLength(5);
  });

  it('renders picture fill layers for text surfaces', () => {
    const slide = createBaseSlide([
      {
        id: 'text-picture-fill',
        kind: 'text',
        name: 'Picture text box',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'picture',
          mediaId: 'ppt/media/image1.png',
          alpha: 0.64,
          crop: {
            left: 0.1,
            right: 0.1,
            top: 0.05,
            bottom: 0.15
          }
        },
        line: {
          color: '#2F6BFF',
          width: 2
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 8,
            right: 10,
            bottom: 8,
            left: 10
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Picture filled text surface'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide), {
      mediaRegistry: {
        getUrl: () => 'blob:text-fill'
      }
    });
    const fillLayer = rendered.querySelector('.pptxv-item--text .pptxv-fill-layer');
    const fillImage = fillLayer?.querySelector('img');
    const textFrame = rendered.querySelector('.pptxv-item--text .pptxv-text-frame');

    expect(fillLayer).toBeTruthy();
    expect(fillImage?.getAttribute('src')).toContain('blob:text-fill');
    expect(fillImage?.style.width).toBe('125%');
    expect(fillImage?.style.height).toBe('125%');
    expect(fillImage?.style.left).toBe('-12.5%');
    expect(fillImage?.style.top).toBe('-6.25%');
    expect((fillLayer as HTMLDivElement | null)?.style.opacity).toBe('0.64');
    expect((textFrame as HTMLDivElement | null)?.style.zIndex).toBe('1');
  });

  it('renders picture fills inside SVG shape defs', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-picture-fill',
        kind: 'shape',
        name: 'Picture shape',
        shapeType: 'roundRect',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'picture',
          mediaId: 'ppt/media/image1.png',
          alpha: 0.58,
          crop: {
            left: 0.12,
            right: 0.08,
            top: 0.1,
            bottom: 0.1
          }
        },
        line: {
          color: '#FF7A59',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide), {
      mediaRegistry: {
        getUrl: () => 'blob:shape-fill'
      }
    });
    const pattern = rendered.querySelector('pattern');
    const image = rendered.querySelector('pattern image');
    const shape = rendered.querySelector('rect');

    expect(pattern?.id).toBe('shape-picture-fill-fill-pattern');
    expect(image?.getAttribute('href')).toBe('blob:shape-fill');
    expect(image?.getAttribute('width')).toBe('300');
    expect(image?.getAttribute('height')).toBe('150');
    expect(image?.getAttribute('x')).toBe('-36');
    expect(image?.getAttribute('y')).toBe('-15');
    expect(image?.getAttribute('opacity')).toBe('0.58');
    expect(shape?.getAttribute('fill')).toBe('url(#shape-picture-fill-fill-pattern)');
  });

  it('renders pattern fills for text surfaces as CSS backgrounds', () => {
    const slide = createBaseSlide([
      {
        id: 'text-pattern-fill',
        kind: 'text',
        name: 'Pattern text box',
        transform: {
          x: 0,
          y: 0,
          width: 320,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'pattern',
          pattern: 'diagCross',
          foregroundColor: '#25A7C5',
          foregroundAlpha: 0.7,
          backgroundColor: '#FFFFFF',
          backgroundAlpha: 0.9
        },
        line: {
          color: '#25A7C5',
          width: 2
        },
        order: 1,
        groupPath: [],
        textFrame: {
          verticalAlign: 'middle',
          padding: {
            top: 8,
            right: 10,
            bottom: 8,
            left: 10
          },
          paragraphs: [
            {
              runs: [
                {
                  text: 'Pattern filled text surface'
                }
              ]
            }
          ]
        }
      } satisfies TextItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const textBox = rendered.querySelector('.pptxv-item--text') as HTMLDivElement | null;

    expect(textBox?.style.backgroundImage).toContain('repeating-linear-gradient');
    expect(textBox?.style.backgroundImage).toContain('rgba(37, 167, 197, 0.7)');
    expect(textBox?.style.backgroundColor).toBe('rgba(255, 255, 255, 0.9)');
  });

  it('renders pattern fills inside SVG shape defs', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-pattern-fill',
        kind: 'shape',
        name: 'Pattern shape',
        shapeType: 'roundRect',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 120,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'pattern',
          pattern: 'diagCross',
          foregroundColor: '#8A63D2',
          foregroundAlpha: 0.8,
          backgroundColor: '#FFFFFF',
          backgroundAlpha: 0.85
        },
        line: {
          color: '#8A63D2',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const pattern = rendered.querySelector('pattern');
    const rect = rendered.querySelector('pattern rect');
    const lines = rendered.querySelectorAll('pattern line');
    const shape = rendered.querySelector('.pptxv-item--shape svg > rect');

    expect(pattern?.id).toBe('shape-pattern-fill-fill-pattern');
    expect(rect?.getAttribute('fill')).toBe('#FFFFFF');
    expect(rect?.getAttribute('fill-opacity')).toBe('0.85');
    expect(lines).toHaveLength(4);
    expect(lines[0]?.getAttribute('stroke')).toBe('#8A63D2');
    expect(lines[0]?.getAttribute('stroke-opacity')).toBe('0.8');
    expect(shape?.getAttribute('fill')).toBe('url(#shape-pattern-fill-fill-pattern)');
  });

  it('renders ppt pattern fills used by the remote sample deck with dense dots and solid diamonds', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-pattern-pct5',
        kind: 'shape',
        name: 'Pct5 pattern',
        shapeType: 'rect',
        transform: {
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'pattern',
          pattern: 'pct5',
          foregroundColor: '#4472C4',
          backgroundColor: '#FFFFFF'
        },
        line: {
          color: '#172C51',
          width: 2
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem,
      {
        id: 'shape-pattern-solid-dmnd',
        kind: 'shape',
        name: 'Solid diamond pattern',
        shapeType: 'rect',
        transform: {
          x: 140,
          y: 0,
          width: 120,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'pattern',
          pattern: 'solidDmnd',
          foregroundColor: '#FFFF00',
          backgroundColor: '#FBC390'
        },
        line: {
          color: '#172C51',
          width: 2
        },
        order: 2,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const patterns = rendered.querySelectorAll('pattern');
    const pct5Pattern = patterns[0];
    const solidDmndPattern = patterns[1];

    expect(pct5Pattern?.getAttribute('width')).toBe('4');
    expect(pct5Pattern?.querySelector('circle')?.getAttribute('r')).toBe('0.45');
    expect(solidDmndPattern?.getAttribute('width')).toBe('8');
    expect(solidDmndPattern?.querySelector('polygon')?.getAttribute('points')).toBe('4,1.5 6.5,4 4,6.5 1.5,4');
  });

  it('renders item outer shadows as CSS drop-shadows', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-shadow',
        kind: 'shape',
        name: 'Shadowed shape',
        shapeType: 'roundRect',
        transform: {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'solid',
          color: '#2F6BFF'
        },
        line: {
          color: '#1D4ED8',
          width: 2
        },
        shadow: {
          color: '#122033',
          alpha: 0.28,
          blur: 8,
          distance: 6,
          angle: 45,
          offsetX: 4.243,
          offsetY: 4.243
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const shape = rendered.querySelector('.pptxv-item--shape') as HTMLDivElement | null;

    expect(shape?.style.filter).toBe('drop-shadow(4.243px 4.243px 8px rgba(18, 32, 51, 0.28))');
  });

  it('renders unsupported items as visible placeholders', () => {
    const slide = createBaseSlide([
      {
        id: 'unsupported-1',
        kind: 'unsupported',
        name: 'Unsupported Cloud',
        unsupportedType: 'cloud',
        label: 'Unsupported shape',
        transform: {
          x: 0,
          y: 0,
          width: 220,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        order: 1,
        groupPath: []
      } satisfies UnsupportedItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const placeholder = rendered.querySelector('.pptxv-item--unsupported');

    expect(placeholder?.textContent).toBe('Unsupported shape');
  });

  it('renders SVG markers for arrow and endpoint line styles', () => {
    const slide = createBaseSlide([
      {
        id: 'line-1',
        kind: 'shape',
        name: 'Arrow line',
        shapeType: 'line',
        transform: {
          x: 0,
          y: 0,
          width: 240,
          height: 24,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#2F6BFF',
          alpha: 0.52,
          width: 3,
          lineCap: 'round',
          lineJoin: 'round',
          headEnd: 'oval',
          tailEnd: 'triangle'
        },
        order: 1,
        groupPath: []
      } satisfies ShapeItem
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const line = rendered.querySelector('line');
    const markers = rendered.querySelectorAll('marker');

    expect(line?.getAttribute('marker-start')).toContain('line-1-head');
    expect(line?.getAttribute('marker-end')).toContain('line-1-tail');
    expect(line?.getAttribute('stroke')).toBe('rgba(47, 107, 255, 0.52)');
    expect(line?.getAttribute('stroke-linecap')).toBe('round');
    expect(line?.getAttribute('stroke-linejoin')).toBe('round');
    expect(markers).toHaveLength(2);
    expect(markers[0]?.firstElementChild?.getAttribute('fill')).toBe('rgba(47, 107, 255, 0.52)');
    expect(markers[1]?.firstElementChild?.getAttribute('fill')).toBe('rgba(47, 107, 255, 0.52)');
  });

  it('applies SVG miter limits for miter line joins', () => {
    const slide = createBaseSlide([
      {
        id: 'shape-miter-limit',
        kind: 'shape',
        name: 'Miter shape',
        shapeType: 'rect',
        transform: {
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        line: {
          color: '#111827',
          width: 4,
          lineJoin: 'miter',
          miterLimit: 6
        },
        order: 1,
        groupPath: []
      }
    ]);

    const rendered = renderSlideToElement(slide, createPresentation(slide));
    const rect = rendered.querySelector('.pptxv-item--shape rect');

    expect(rect?.getAttribute('stroke-linejoin')).toBe('miter');
    expect(rect?.getAttribute('stroke-miterlimit')).toBe('6');
  });
});

function createBaseSlide(items: SlideModel['items']): SlideModel {
  return {
    id: 'slide-1',
    index: 0,
    title: 'Fixture slide',
    background: {
      type: 'solid',
      color: '#FFFFFF'
    },
    width: 960,
    height: 540,
    items,
    warnings: []
  };
}

function createPresentation(slide: SlideModel, media: ParsedPresentation['media'] = {}): ParsedPresentation {
  return {
    size: {
      width: slide.width,
      height: slide.height
    },
    theme: {
      colors: {},
      fonts: {}
    },
    slides: [slide],
    media,
    warnings: []
  };
}

function createTableCell(
  row: number,
  column: number,
  text: string,
  overrides: Partial<TableItem['cells'][number]> = {}
): TableItem['cells'][number] {
  return {
    row,
    column,
    rowSpan: 1,
    colSpan: 1,
    isMergedContinuation: false,
    fill: {
      type: 'none'
    },
    textFrame: {
      verticalAlign: 'middle',
      padding: {
        top: 4,
        right: 6,
        bottom: 4,
        left: 6
      },
      paragraphs: [
        {
          runs: [
            {
              text
            }
          ]
        }
      ]
    },
    ...overrides
  };
}
