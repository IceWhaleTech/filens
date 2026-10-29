# Font diagnostics and on-demand loading

The generic preview runtime exposes optional `PreviewItemState.fonts` metadata.
PPTX, Keynote, Pages, Numbers, DXF, DOCX, and XLSX currently populate it. PDF.js
also exposes partial renderer font information as pages render. Hosts receive the
same metadata through `getState()`, `rendered`, and `statechange`, including the
Vue wrapper's `state-change` event. Missing, substituted, and browser-unsupported
fonts also produce ordinary `warnings` describing possible layout drift.

```ts
previewer.on('statechange', (state) => {
  for (const font of state.fonts ?? []) {
    console.log(font.fontFamily ?? font.fontFile, font.status, font.source);
  }
});
```

An absent `fonts` field means the driver does not expose an inventory. An empty
array means no references were discovered in its current parsed model; it does
not certify that the original file contains no fonts. Numbers diagnostics cover
the sheets parsed so far and update when another sheet finishes loading. PDF
diagnostics cover rendered pages so far; optional metadata work never blocks the
first preview and results from replaced documents are ignored.

Font downloads are opt-in. Set `fontLoading: true` on `createPreviewer()` or a
participating driver's options to enable the optional Latin/CJK packs and font-ready
relayout. The Vue `<Preview>` component accepts `:font-loading="true"`; the demo
enables it. The low-level `init()` / `createViewer()` API does not manage packs.
See [automatic loading](#automatic-font-loading) for custom sources and defaults.

## Metadata

| Field | Meaning |
| --- | --- |
| `fontFamily` | Original family referenced by parsed text, when known. |
| `fontFile` | Original file reference, such as a DXF style's `romans.shx`. |
| `styleName` | Original named style, when provided by the format. |
| `resolvedFontFamily` | Application mapping or detected automatic substitute; explicit targets are retained even when availability cannot be verified. |
| `classification` | Serif, monospace, style and script traits, with `metadata`, `known`, `name` or `unknown` evidence. |
| `substitutionReason` | Reason for an automatic substitute, such as `serif`, `monospace`, or `decorative`. |
| `matchScore` | Relative similarity score for an automatically selected candidate; not a confidence percentage. |
| `coverage` | `matched` when candidate cmap ranges cover the supplied local sample, otherwise `unknown`; does not certify whole-document coverage or shaping. |
| `embedded` | An embedded-font declaration exists; this does not certify loading or rendering. |
| `fontId` | Rendering-engine identifier, currently used for PDF.js font inventories. |
| `status` | `available`, `missing`, `substituted`, `unsupported`, or `unknown`. |
| `source` | `embedded`, `application`, `environment`, `fallback`, or `unknown`. |

`available` means that local measurements suggest the requested family is
available, or a managed `FontFace` has successfully loaded. `substituted` means a different application mapping or automatically
selected named target appears available. `missing` means the requested family or mapping target was not
detected. `unsupported` identifies references such as unmapped SHX files that
cannot be rendered directly by the browser. `unknown` means that availability
could not be determined; a CSS family stack is also left unknown because it
does not identify a single font.

`environment` deliberately does not identify an operating-system font: the same
family could come from a system installation, a page stylesheet, or an existing
`FontFace`. `application` identifies a driver-known host mapping. `fallback`
identifies an automatic similar-font substitute, missing or unsupported font
fallback, or a requested CSS generic family. `embedded` is reserved for drivers that can establish an active embedded
font's provenance; current scene discovery does not extract or load embedded
font files. DOCX reports declarations using `embedded: true`; an embedded family
that is not yet detected stays `unknown` and is not automatically replaced.
A mapping whose availability is unknown retains its application
provenance and `unknown` status.

## Discovery and availability limits

Scene discovery includes explicit or parser-resolved family names on text runs,
shape text, table cells, and bullet labels across parsed slides/pages. Grouped
PPTX objects are already flattened into those scenes. It does not scan unused
theme fonts, discover font properties absent from the scene model (for example,
chart typography), or extract embedded fonts. DOCX reuses decoded font-table declarations and font
references in parsed document parts and styles, including header/footer/notes and
numbering parts. It also reads PANOSE and pitch from the font table in the existing
document package, since docx-preview discards those fields; optional metadata
failure does not prevent rendering. XLSX reads font-table family classes, bold
states, theme Latin names/PANOSE/pitch-family values, and
cell, row, column and base-style font inheritance; rich-text run typography is
not yet preserved. Renderers can apply
additional script, symbol, or emoji fallbacks; the inventory records references,
not the actual font used for each glyph. DXF also includes declared text styles
and Big Font file references, retaining SHX warnings.

PDF.js public text styles expose renderer identifiers and CSS fallback families,
not original PDF BaseFont names, reliable embedded provenance or per-glyph font
selection. PDF entries therefore retain `unknown` status/source, even when the
CSS family is generic. PDF font replacement remains controlled by PDF.js; the
similarity matcher does not rewrite PDF content.

Availability compares a fixed multilingual sample's canvas width against several
generic fallback baselines. It never treats `document.fonts.check()` as proof of
an installed font: that API can return success for a missing font that falls back.
Unavailable canvas contexts, failed measurements, and non-browser environments
produce `unknown`, without claiming that the font is present or missing.

Measurements are a heuristic for family availability at normal weight/style,
not a guarantee of exact font identity, glyph coverage, font version, shaping,
wrapping, pagination, or layout fidelity. The same font file can render
differently across browser/platform combinations. Diagnostic snapshots do not
block the first preview on downloads or `document.fonts.ready`. With `fontLoading`
enabled, managed loads update diagnostics and trigger the participating driver's
text/layout refresh; unrelated external font loads are not observed automatically.

## Shared helpers

Custom frontend drivers can import `collectSlideFontReferences(slides)` and
`analyzePreviewFonts(references, host.ownerDocument)` from `@filens/core`. The
analysis returns `{ fonts, warnings }`; drivers merge the warnings with their
existing format warnings. `getPreviewFontWarnings(fonts)` can also produce
warnings from selected diagnostics, avoiding duplicate format-specific warnings.
References can carry an explicit
`resolvedFontFamily`, known `source`, or `browserUnsupported` flag. Drivers should
provide a source only when they know its provenance, and preserve original
references alongside mapping targets.

Analysis deduplicates family/file/style references and warnings. Probe results
are cached only within one analysis call; calling it again rechecks availability.
The preview sessions retain their diagnostic snapshot for the loaded scenes so
ordinary navigation and zoom do not rescan all text. A replacement document,
destruction, or a newly loaded Numbers sheet updates or clears that snapshot.

Diagnostics alone do not fetch fonts, upload text, add font assets, or persist a font
cache. Document text is excluded from diagnostic output and the availability
measurement sample. A host may supply an optional local `text` sample to the
similarity matcher for checking candidate glyph coverage; it is never returned
in diagnostics.
Optional Latin/CJK packs, authorized font URL/byte loading, and font-ready relayout
are available through the loader below. Emoji/math packs, licensed document-specific
subsets, and embedded extraction remain roadmap F1/F2 work.


## Automatic similar-font substitution

DOCX and XLSX enable local similar-font selection when a referenced family is
confirmed missing. The shared matcher considers:

- serif versus sans-serif and fixed versus proportional spacing;
- ordinary text, handwriting, decorative display styles, and symbol fonts;
- known CJK regions and scripts, keeping Japanese/Korean and SC/TC candidates distinct;
- common compatible substitutes, such as Times New Roman → Liberation Serif or
  Tinos, Calibri → Carlito, and Courier New → Liberation Mono or Cousine;
- family-specific PANOSE descriptors, weight, stretch and average advance width
  when available, including condensed sans-serif candidates;
- optional candidate Unicode cmap coverage, rejecting candidates known to miss
  sampled characters and prioritizing covered candidates over unknown coverage.

File metadata takes priority over a known-family catalog; font-name heuristics
are labelled `name`. DOCX and XLSX merge broad Office family classes, then
PANOSE traits, then explicit pitch; XLSX style weight takes priority over PANOSE
weight estimates. PANOSE's Any, No Fit and
reserved dimensions provide no trait; symbol and decorative descriptors are
not interpreted using text-family dimensions.
An unfamiliar family with no usable traits remains unknown in classification.
The matcher only records a named candidate after detecting it locally; a generic
`serif`, `monospace`, `cursive` or `fantasy` CSS fallback is not presented as an
installed substitute. Without reliable measurement, availability stays unknown.

```ts
import { analyzePreviewFonts, buildPreviewFontStack } from '@filens/core';

const refs = [{ fontFamily: 'Custom Book Face', traits: { serif: true } }];
const { fonts, warnings } = analyzePreviewFonts(refs, document, { substitute: true });
const preferred = fonts.flatMap(font => font.resolvedFontFamily ? [font.resolvedFontFamily] : []);
const cssStack = buildPreviewFontStack('Custom Book Face', { serif: true }, preferred);
```

`classifyPreviewFont`, `officeFontTraits`, `getFontFallbackCandidates`, and
`splitPreviewFontFamilies` are also exported for frontend drivers and hosts.
`fontTraitsFromPanose` decodes supported descriptors, and
`rankPreviewFontCandidates(reference, candidates)` ranks metadata candidates
without claiming that they are loaded. `analyzePreviewFonts` accepts an optional
`candidates` array and still checks local availability before recording a target.
Each candidate supplies `fontFamily`, optional `traits`, and optional inclusive
Unicode `coverage` ranges. Specific monospace/handwriting/decorative requests
require a candidate known to match that trait; known serif and regional script
conflicts are rejected.

`readPreviewFontMetadata(bytes)` inspects a single SFNT TTF/OTF locally, returning
family/subfamily names, OS/2 PANOSE/weight/width/average-width properties,
`post` fixed-pitch metadata, and supported Unicode cmap format 4/12 ranges.
For example, after a host has loaded its font under a CSS family name:

```ts
import { readPreviewFontMetadata } from '@filens/core';

const metadata = readPreviewFontMetadata(hostFontBytes);
const candidate = { fontFamily: loadedCssFamily, traits: metadata.traits, coverage: metadata.coverage };
const result = analyzePreviewFonts(
  [{ fontFamily: 'Custom Book Face', traits: { serif: true }, text: localTextSample }],
  document, { substitute: true, candidates: [candidate] }
);
```

The reader does not load fonts, extract outlines or open embedded font resources.
Malformed tables throw; unsupported WOFF/WOFF2/TTC containers are explicit errors.
Missing or unsupported Unicode cmap formats leave coverage unknown. Coverage
checks sample at most 256 distinct non-control code points and omit joiners and
variation selectors; they do not validate shaping, variation sequences or a
complete document. Candidate metadata must describe the font the host actually
loaded under that CSS family name.

PPTX/iWork rendering appends classified CSS fallbacks for families outside its
existing fallback catalog; its diagnostic inventory continues to describe source
references rather than claim an exact per-glyph replacement.

Explicit application mapping targets are not replaced by the automatic matcher.
DOCX theme-variable stacks and embedded declarations retain renderer-controlled
loading; declarations that cannot be rewritten are not reported as automatically
substituted. Explicit CSS family order precedes selected targets, and selected
targets precede other classified fallback candidates. XLSX uses that same target
order for rendered cells and applies parsed bold states.
Legacy Symbol/Wingdings and SHX encodings require glyph mapping, so they are not
automatically exchanged for unrelated text fonts.

This is metadata-based typography matching. It does not compare font outlines or
certify identical shaping, measured text metrics, line wrapping or pagination.
Substitution reasons remain visible in diagnostics/warnings. The optional loader
uses the same ranking for downloadable candidates and refreshes supported layouts
after a selected face loads.

## Automatic font loading

```ts
import { createPreviewer, createWebFontPacks } from '@filens/core';

// Reuse this configuration object across previews to share route measurements
// and active/inflight font assets within the same ownerDocument.
const fontLoading = {
  packs: createWebFontPacks(),
  concurrency: 3,
  timeoutMs: 4000,
  hedgeDelayMs: 200,
  budgetMs: 12000,
  maxAttempts: 3,
  backoffMs: 500,
  maxBackoffMs: 30000,
  maxFontBytes: 16 * 1024 * 1024,
  preferLocal: true
};
const previewer = createPreviewer(mount, { fontLoading });
await previewer.preview('/slides.pptx'); // Returns after the first preview.
// Listen to statechange for later font diagnostics and layout updates.
```

`fontLoading: true` uses these defaults and built-in packs. `false` or omission
disables loading. Omit `packs` to use the built-in manifests; `packs: []` restricts
loading to assets supplied by `fontResolver`. Register optional format drivers as
usual for DOCX, XLSX, iWork, or CAD; the font option does not register them.

Only required references enter the queue. XLSX loads fonts attached to parsed
cells while retaining the full font-table inventory in diagnostics. DOCX loads
families in rewritable parsed CSS declarations, excluding font-table-only entries,
theme-variable stacks and embedded declarations. Scene references distinguish
regular/bold and normal/italic variants; samples for coverage matching stay local
and are capped at 4096 characters per family/variant. Unclassified families without
an exact asset, unmapped SHX, and legacy symbol encodings retain their fallback.

The loader first checks the original or explicit host alias. An available original
needs no download. For automatic substitutions, an equally or better ranked
available local substitute takes precedence by default; `preferLocal: false`
allows a pack candidate instead. Explicit host targets are retained. If every
source for the best compatible family fails, the loader can try one other
compatible family before retaining local fallback and publishing a warning.

### Built-in packs and self-hosting

The manifests pin `@fontsource/*` packages to **5.2.6**. They contain no font
payloads and use WOFF2 files from jsDelivr and unpkg. Families are Carlito, Caladea,
Arimo, Tinos, Cousine, Noto Sans, Noto Serif, Noto Sans Mono, and Noto Sans/Serif
SC, TC, JP and KR. All include weights 400/700; Latin families include italic
except Noto Sans Mono. CJK faces currently provide normal style only. Latin packs
declare their subset's nominal Unicode ranges; CJK coverage remains unknown and
the selected full regional file can be substantially larger. Selection does not
promise complete glyph coverage. Dedicated handwriting/decorative, Emoji and math
packs are not included; hosts can supply them.

Each manifest includes an upstream `LICENSE` URL. Hosts must review those licenses
before redistribution or subsetting. To self-host the same versioned NPM directory
layout, replace the mirror bases:

```ts
const packs = createWebFontPacks({
  mirrors: ['https://fonts.example.com/npm', 'https://backup.example.com/npm']
});
// e.g. /npm/@fontsource/carlito@5.2.6/files/carlito-latin-400-normal.woff2
```

Arbitrary file layouts use custom `PreviewFontPack` manifests. Supply accurate
`traits`, optional Unicode `coverage`, and CSS `descriptors` for each face. Fonts
with unrelated outlines or legacy glyph encodings do not become compatible merely
by sharing a family alias.

### Host fonts, aliases and authorization

```ts
import type { PreviewFontAsset, PreviewFontResolver } from '@filens/core';

const book: PreviewFontAsset = {
  id: 'company-book-v3-regular',
  fontFamily: 'Company Book',
  traits: { serif: true, style: 'text', weight: 400 },
  descriptors: { weight: '400', style: 'normal' },
  sources: [
    { url: '/fonts/company-book-v3.woff2', priority: 0 },
    { url: 'https://fonts.example.com/company-book-v3.woff2', priority: 1,
      credentials: 'include', headers: { Authorization: fontAccessToken } }
  ]
};
const fontResolver: PreviewFontResolver = ({ fontFamily }) =>
  fontFamily === 'Original Book'
    ? { fontFamily: book.fontFamily, assets: [book] }
    : undefined;
const previewer = createPreviewer(mount, {
  fontLoading: { packs: [] }, fontResolver
});
```

An asset may supply `data: ArrayBuffer | Uint8Array` instead of sources, for
example bytes read from a host-selected local file. No upload is involved.
`fontResolver` remains synchronous; it supplies already known aliases/manifests,
and the loader handles fetching and decoding afterward. Return stable asset
objects to share inflight loads across sessions. An alias to an already available
family also triggers layout refresh without a download. Explicit CAD SHX aliases
can use browser-loadable host assets; this does not decode SHX glyphs.

### Routing, retry and fallback

Lower source `priority` wins among healthy sources. Within a priority, the loader
uses an exponentially weighted moving average of successful request/decode times,
origin latency, and failure penalties. Same-origin sources have a cold-start
preference; measured faster mirrors can supersede it. There are no global probes
or HEAD requests. When a route is still pending after `hedgeDelayMs`, one alternate
healthy source starts. The first successfully decoded face wins and cancels the
loser; a cancelled slow request contributes a latency lower bound, not a failure.
This adapts to observed routes; it cannot guarantee the global fastest network path.

Each asset has a total time budget and a bounded number of attempts, including
hedged requests. Downloads, body reads and decoding respect time limits. Network,
CORS, HTTP, decode and oversized-response failures try healthy alternatives before
waiting. Failed routes use exponential backoff with jitter (0.75–1.25), respect
`Retry-After`, and cool down at least five minutes after 401/403/404/410. The budget
ends an attempt sequence when the next cooldown would take too long. Concurrency
limits font jobs per preview, and a job has at most two active mirror requests.
Failure leaves the readable preview and local CSS fallbacks active, with a font
warning rather than a document error. Navigation events do not restart exhausted
font jobs for that document; later documents can retry using shared route health.

Fetch uses CORS, `credentials: 'omit'`, no referrer and the browser HTTP cache
(`force-cache`) by default. Host sources may explicitly provide credentials and
headers. Cross-origin hosts must allow the corresponding CORS requests. Versioned
URLs provide cache isolation; there is no additional persistent font database or
service worker. No document text or local coverage sample is placed in font
requests, URLs or diagnostics. Loader warnings omit source URLs and authorization.

### Layout refresh and lifetime

PPTX remounts visible slides to recalculate text metrics/autofit. Keynote and Pages
refresh their scenes; Numbers and XLSX rebuild the active table while keeping its
loaded rows. DOCX reuses the parsed document and renders an attached hidden staging
container before swapping it into view. CAD redraws SVG text while preserving
layer visibility and viewport. These paths retain the current page/sheet, supported
zoom and scroll position. PDF fonts remain under PDF.js control.

Managed `FontFace` objects and inflight requests are leased per document and
configuration object. Replacement, abort and destruction release that preview's
leases; the final owner cancels pending work and removes only its managed faces.
Late responses cannot modify a replacement document. Font loading and optional
refresh errors do not invalidate an already readable preview.

Custom drivers can provide `getFontReferences()` and `refreshFonts(update)`, then
call `bindPreviewFontLoading(session, ownerDocument, options)`. Call its
`reset(signal, sourceFormat)` for each new input and `destroy()` on teardown.
`analyzeLoadedPreviewFonts()` merges load proof with ordinary diagnostics;
`collectSlideFontLoadingReferences()` / `applySlideFontMappings()` preserve original
scene names while collecting variants and applying targets. Font changes can alter
wrapping and pagination; this refresh is not a guarantee of exact Office layout.
Embedded extraction, WOFF2 metadata inspection, glyph subsetting and measured
candidate-layout comparison remain future work.

`npm run test:fonts:browser` builds core/XLSX and checks actual Chromium font
decoding, mirror failover, changed text metrics, table replacement, retained rows
and scroll, and managed-face cleanup. It requires Playwright Chromium to be installed.
