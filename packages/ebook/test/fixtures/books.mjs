import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

// Fixed dates and deterministic contents make browser measurements reproducible.
const date = new Date('2020-01-01T00:00:00Z');

export async function createComicFixture(count = 200) {
  const zip = new JSZip();
  // Descending unpadded names exercise natural page ordering.
  for (let page = count; page > 0; page--) {
    zip.file(`pages/page-${page}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#e0e7ff"/><text x="40" y="100" font-size="40">Page ${page}</text></svg>`, { date });
  }
  zip.file('notes.txt', 'Deterministic comic preview fixture.', { date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createBookFixture(count = 40, paragraphs = 150) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { date });
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>', { date });
  const manifest = [], spine = [];
  for (let chapter = 1; chapter <= count; chapter++) {
    const id = `chapter-${chapter}`;
    manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    zip.file(`OPS/${id}.xhtml`, `<html><head><title>Chapter ${chapter}</title></head><body><h1>Chapter ${chapter}</h1>${Array.from({ length: paragraphs }, (_, index) => `<p id="p${index}">Paragraph ${index + 1}: A field guide to the night sky, with observations of stars, planets, and the changing seasons.</p>`).join('')}</body></html>`, { date });
  }
  zip.file('OPS/package.opf', `<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Night Sky</dc:title></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`, { date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// Original test font: .notdef plus a rectangular A, generated with FontBuilder.
export async function createStyledBookFixture() {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>', { date });
  zip.file('OPS/package.opf', `<package><metadata><title>Styled book</title></metadata><manifest>
    <item id="first" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="last" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="styles/main.css" media-type="text/css"/>
    <item id="font" href="fonts/preview.woff" media-type="font/woff"/>
    <item id="image" href="images/sky%20blue.svg" media-type="image/svg+xml"/>
    <item id="escaped" href="images/paren)%20blue.svg" media-type="image/svg+xml"/>
  </manifest><spine><itemref idref="first"/><itemref idref="last"/></spine></package>`, { date });
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="64"><rect width="80" height="64" fill="#e0e7ff"/></svg>';
  zip.file('OPS/images/sky blue.svg', image, { date });
  zip.file('OPS/images/paren) blue.svg', image, { date });
  const fontFile = './preview-font.woff';
  zip.file('OPS/fonts/preview.woff', await readFile(new URL(fontFile, import.meta.url)), { date });
  zip.file('OPS/styles/main.css', `@import "nested/colors.css" screen;
    @import url("cycle.css");
    @font-face{font-family:EpubFixture;src:url('../fonts/preview.woff?version=1#face') format('woff')}
    .font{font-family:EpubFixture}
    .cover{width:80px;height:64px;background-image:url("../images/sky%20blue.svg?version=2#scene")}
    .escaped{background-image:url(../images/paren\\)\\20 blue.svg)}
    .literal::before{content:"url(../not-a-resource.svg)"}
    /* url(../also-not-a-resource.svg) */`, { date });
  zip.file('OPS/styles/nested/colors.css', '.imported{color:rgb(18,52,86)}', { date });
  zip.file('OPS/styles/cycle.css', '@import "main.css";.cycle{color:rgb(101,67,33)}', { date });
  const chapter = title => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>
    <link rel="stylesheet" href="../styles/main.css"/>
    <style>.inline{background-image:url('../images/sky%20blue.svg')}</style></head>
    <body><h1>${title}</h1><p class="imported">Imported stylesheet</p><p class="cycle">Cycle terminates</p>
    <p class="font">A</p><div class="cover"></div><div class="cover inline"></div><div class="cover escaped"></div>
    <div class="cover" style="background-image:url('../images/sky%20blue.svg')"></div>
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="80" height="64"><image width="80" height="64" xlink:href="../images/sky%20blue.svg"/></svg>
    <img src="../images/sky%20blue.svg?version=1"/></body></html>`;
  zip.file('OPS/text/chapter1.xhtml', chapter('First chapter'), { date });
  zip.file('OPS/text/chapter 2.xhtml', chapter('Last chapter'), { date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createAssetBookFixture(count = 200) {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>', { date });
  const manifest = ['<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>'];
  for (let index = 0; index < count; index++) {
    manifest.push(`<item id="image${index}" href="images/image${index}.svg" media-type="image/svg+xml"/>`);
    zip.file(`OPS/images/image${index}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="64"><text x="1" y="20">${index}</text></svg>`, { date });
  }
  zip.file('OPS/package.opf', `<package><metadata><title>Illustrations</title></metadata><manifest>${manifest.join('')}</manifest><spine><itemref idref="chapter"/></spine></package>`, { date });
  zip.file('OPS/chapter.xhtml', `<html><head><title>Illustrations</title></head><body><img src="images/image0.svg"/><img src="images/image${count - 1}.svg"/></body></html>`, { date });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
