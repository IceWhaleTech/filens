# filens homepage

The product homepage introduces filens before visitors enter the existing file preview workbench. The workbench remains at `?view=preview`; sample links can add `&format=docx`, `&format=pano`, or `&format=showcase`.

The workbench preview toolbar starts hidden. Use the toolbar button in the preview header to show or hide it; keyboard navigation and zoom shortcuts also work while it is hidden.

The homepage, examples, and local-file preview do not require NAS authentication. Bundled examples use the configured frontend base path; external media and panorama examples use the public `/external-samples/` proxy routes. No example reads NAS storage or redirects to a host login page. Vite development/preview, `scripts/serve-static.py`, and the Vercel deployment provide these proxies; other static hosts need equivalent routes for external examples.

For a root-domain deployment, see [Deploy to Vercel / 部署到 Vercel](deploy-vercel.md). `npm run build:vercel` builds the WASM modules and sets the frontend base path to `/`; other builds keep the NAS base path.

## References and content structure

The following project pages were reviewed for their presentation patterns:

| Reference | Useful pattern | Applied to filens |
| --- | --- | --- |
| [vue-files-preview](https://github.com/VueFilesPreview/vue-files-preview) | Format-specific screenshots and direct examples | One main preview with six format tabs and links into working samples |
| [vue-office](https://github.com/501351981/vue-office) | An immediate demo | A local-file CTA and an actual recorded demo |
| [JitViewer](https://github.com/jitOffice/jit-viewer-sdk), [product page](https://jitword.com/jit-viewer.html) | Clear SDK entry points | A compact integration link and a separate interactive workbench |

The page opens with a visual introduction and switchable preview captures. A prominent ZimaOS recommendation follows the hero, before the filens principles and format samples, with a compact video walkthrough further down. The recommendation uses the official ZimaOS logo, states its deep integration with FiLens, and highlights unified file management, RAW / Live Photos / panorama viewing, data ownership and encrypted remote access, storage and backup, and the 800+ app ecosystem. Its product link follows the selected Chinese or English locale. Format support and developer documentation remain one click away.

## Chinese and English

- `?lang=zh` opens Chinese; `?lang=en` opens English.
- The navigation and footer both offer a language switch. Selection is remembered in local storage; an explicit URL parameter takes priority.
- Navigation, headings, content, labels, accessibility descriptions, metadata, and video captions have both versions.
- Existing workbench controls keep their existing language. This change translates the product homepage.

## Visuals and maintenance

The homepage uses the existing filens logo, the official ZimaOS logo, locally drawn format badges in the preview tabs, actual preview captures, and a three-slide sample presentation. Brand provenance is in [brand/SOURCES.md](../apps/demo/public/brand/SOURCES.md). The recording loads after the visitor asks to play it. Photo credits are available in a footer disclosure; detailed sources and regeneration instructions are in [home/SOURCES.md](../apps/demo/public/home/SOURCES.md).

To regenerate captures and the recording:

```sh
npm run dev --workspace @filens/demo -- --host 127.0.0.1 --port 4173
# In another terminal, with Playwright Chromium and FFmpeg available:
node scripts/capture-homepage-demo.mjs
```

The capture script also regenerates `filens-field-notes.pptx`. Format parsing and conversion remain in the shared frontend core; no backend conversion code is changed.

The public Keynote sample is a new three-slide fictional travel presentation. On macOS with Keynote installed, regenerate it with `osascript scripts/generate-keynote-sample.applescript /tmp/filens-weekend.key /absolute/path/to/photo-alpine-lake.jpg`, then copy the result to `apps/demo/public/samples/filens-weekend.key`. Regenerate the fictional cafe floor plan with `node scripts/generate-showcase-cad.mjs`. The document and workbook generators use invented travel, group, and shop data; they contain no internal project or personnel details.

After recapturing, run `node scripts/generate-readme-assets.mjs` to refresh the README overview and animated preview. Run `npm run build:vercel && npm run report:bundle-sizes` to refresh the measured size tables in both README versions.

Run the homepage interaction checks with `npx playwright test apps/demo/e2e/landing.e2e.ts` and build with `npm run build:demo`.
