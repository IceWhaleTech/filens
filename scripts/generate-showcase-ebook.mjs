// Package the locally bundled, credited comic artwork as a real EPUB.
// Run: node scripts/generate-showcase-ebook.mjs
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const samples = new URL('../apps/demo/public/samples/', import.meta.url);
const zip = new JSZip();
const modified = '2026-10-30T00:00:00Z';
const date = new Date(modified);
const file = (name, data, options = {}) => zip.file(name, data, { date, createFolders: false, ...options });
const title = 'Pepper &amp; Carrot — The Potion of Flight';
const source = 'https://www.peppercarrot.com/en/webcomic/ep01_Potion-of-Flight.html';
const license = 'https://creativecommons.org/licenses/by/4.0/';

file('mimetype', 'application/epub+zip', { compression: 'STORE' });
file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
file('OPS/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:filens:pepper-carrot-potion-of-flight-excerpt</dc:identifier>
    <dc:title>${title}</dc:title><dc:creator>David Revoy</dc:creator><dc:contributor>Amireeti and Alex Gryson (proofreading)</dc:contributor><dc:language>en</dc:language>
    <dc:source>${source}</dc:source><dc:rights>Comic: CC BY 4.0. Two-page excerpt; cover panel cropped for layout.</dc:rights>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>
    <item id="comic" href="comic.xhtml" media-type="application/xhtml+xml"/>
    <item id="credits" href="credits.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="page-01" href="images/page-01.jpg" media-type="image/jpeg"/>
    <item id="page-02" href="images/page-02.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="comic"/><itemref idref="credits"/></spine>
</package>`);
const chapter = (name, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/><title>${name}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;

file('OPS/style.css', `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#f8f3e7;color:#203c35;font-family:Georgia,serif}
.comic-cover{height:100vh;display:flex;flex-direction:column;overflow:hidden}
.cover-art{display:block;width:100%;flex:1;min-height:0;background:#183c32}
.cover-caption{flex:none;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:26px 32px 24px}
.eyebrow{margin:0 0 8px;font:600 11px/1.5 system-ui,sans-serif;letter-spacing:3px;color:#a07137}
h1{margin:0;font-size:clamp(30px,4.4vw,60px);font-weight:normal;letter-spacing:-1.5px;line-height:1.06}
.episode{margin:10px 0 0;font:14px/1.5 system-ui,sans-serif;color:#617064}
.author{margin:0;text-align:right;white-space:nowrap;font:12px/1.8 system-ui,sans-serif;color:#617064}
.spread{height:100vh;display:flex;align-items:center;justify-content:center;gap:12px;padding:16px;background:#e5e6d9}
.spread img{display:block;min-width:0;max-width:calc(50% - 6px);max-height:100%;width:auto;height:auto;box-shadow:0 4px 16px #17362a24}
.credits{max-width:740px;margin:auto;padding:64px 48px;font-size:18px;line-height:1.8}.credits h1{font-size:38px}.credits a{color:#328460}
@media(max-width:600px){.cover-caption{padding:18px;gap:12px}.author{font-size:10px}.eyebrow{letter-spacing:1px}.episode{font-size:12px}.credits{padding:32px 24px}}
`);
file('OPS/cover.xhtml', chapter('The Potion of Flight', `
<main class="comic-cover">
  <svg class="cover-art" xmlns="http://www.w3.org/2000/svg" viewBox="50 16 1100 514" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Pepper and her orange cat Carrot beside a sparkling golden potion">
    <title>Pepper and Carrot — artwork by David Revoy</title>
    <image href="images/page-02.jpg" width="1200" height="1660"/>
  </svg>
  <footer class="cover-caption"><div><p class="eyebrow">A LITTLE MAGIC. A BIG ADVENTURE.</p><h1>Pepper &amp; Carrot</h1><p class="episode">01 / The Potion of Flight</p></div><p class="author">A comic by<br/><strong>David Revoy</strong><br/>CC BY 4.0</p></footer>
</main>`));
file('OPS/comic.xhtml', chapter('Read the comic', '<main class="spread"><img src="images/page-01.jpg" alt="The Potion of Flight, page 1: Pepper prepares a potion"/><img src="images/page-02.jpg" alt="The Potion of Flight, page 2: Carrot plays with a magical potion"/></main>'));
file('OPS/credits.xhtml', chapter('About &amp; credits', `
<main class="credits"><p class="eyebrow">ABOUT THIS COMIC</p><h1>${title}</h1><p>Artwork and story by <strong>David Revoy</strong>. English proofreading by <strong>Amireeti and Alex Gryson</strong>.</p><p>This FiLens sample contains the first two pages of episode 1, originally published on May 10, 2014. The opening illustration crops the first panel of page 2; the next chapter preserves both full pages.</p><p>The comic is shared under <a href="${license}">Creative Commons Attribution 4.0</a>. This EPUB packaging and cover layout were created for the FiLens demo.</p><p><a href="${source}">Read the complete episode at peppercarrot.com</a></p></main>`));
file('OPS/nav.xhtml', chapter('Contents', '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><h1>Contents</h1><ol><li><a href="cover.xhtml">The Potion of Flight</a></li><li><a href="comic.xhtml">Read the comic</a></li><li><a href="credits.xhtml">About &amp; credits</a></li></ol></nav>'));
for (const page of ['01', '02']) {
  file(`OPS/images/page-${page}.jpg`, await readFile(new URL(`showcase/pepper-carrot-page-${page}.jpg`, samples)));
}
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
await writeFile(new URL('pepper-carrot.epub', samples), bytes);
console.log(`Generated pepper-carrot.epub (${bytes.length} bytes).`);
