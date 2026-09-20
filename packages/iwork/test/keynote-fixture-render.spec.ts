import { describe, expect, it } from 'vitest';
import { loadArchivePackage } from '../src/parser/archive';
import { buildParsedDocument } from '../src/parser/semantic';
import { readFixture } from './helpers';

describe('keynote fixture rendering fidelity', () => {
  it('maps keynote fixture shape fills and text colors', async () => {
    const bytes = await readFixture('vendor/iwork-converter/testdata/a.key');
    const archivePackage = await loadArchivePackage(bytes, 'key', { sourceName: 'a.key' });
    const document = buildParsedDocument({
      archive: archivePackage.archive,
      media: archivePackage.media
    });

    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    const slide = document.slides[0]?.slide;
    expect(slide).toBeTruthy();
    if (!slide) {
      return;
    }

    const shapes = slide.items.filter((item) => item.kind === 'shape');
    expect(shapes.length).toBeGreaterThanOrEqual(20);

    const fills = shapes.map((shape) => (shape.kind === 'shape' ? shape.fill : undefined));
    // Fixture contains several colored blocks; ensure we do not lose all fills.
    expect(fills.some((fill) => fill && fill.type !== 'none')).toBe(true);

    const hasWhiteText = shapes.some(
      (shape) =>
        shape.kind === 'shape' &&
        Boolean(
          shape.textFrame?.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim() && run.color === '#ffffff'))
        )
    );
    expect(hasWhiteText).toBe(true);
  });
});
