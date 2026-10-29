# filens homepage

The product homepage introduces filens before visitors enter the existing file preview workbench. The workbench remains at `?view=preview`; sample links can add `&format=docx`, `&format=pano`, or `&format=showcase`.

The workbench uses a dark format library beside a light preview canvas. Its UI lives in `DocumentWorkbench.vue`, with format search and categories in `FormatBrowser.vue` and styles in `workbench.css`; `App.vue` supplies the existing preview state and shared conversion core. Format search spans all five families, while selecting a family restores its category list. The library can be collapsed without remounting the preview. On narrow screens it starts closed and opens as a drawer, which closes after selecting a format.

The preview toolbar starts hidden. Use the toolbar button in the preview header to show or hide it; keyboard navigation and zoom shortcuts also work while it is hidden. File details, 3D metadata, and expandable build diagnostics sit behind the information button. Preview status and measured timings appear in the preview footer. Local files can be selected or dropped onto the workbench; both paths use the same upload handler, including companion resources and ZIP bundles.

The homepage, examples, and local-file preview do not require NAS authentication. Bundled examples use the configured frontend base path; external media and panorama examples use the public `/external-samples/` proxy routes. No example reads NAS storage or redirects to a host login page. Vite development/preview, `scripts/serve-static.py`, and the Vercel deployment provide these proxies; other static hosts need equivalent routes for external examples.

The “通过链接打开” button opens a keyboard-accessible URL dialog, with focus returned to its trigger after opening a file or dismissing the dialog. Its input defaults to the project's public presentation at `https://filens-six.vercel.app/samples/filens-field-notes.pptx`.

Each recording regenerates `apps/demo/src/home-media.json` with a content hash. The homepage uses that version for the video, poster, and captions so replacing the recording also refreshes cached media.

For a root-domain deployment, see [Deploy to Vercel / 部署到 Vercel](deploy-vercel.md). `npm run build:vercel` builds the WASM modules and sets the frontend base path to `/`; other builds keep the NAS base path.

## References and content structure

The following project pages were reviewed for their presentation patterns:

| Reference | Useful pattern | Applied to filens |
| --- | --- | --- |
| [Hex](https://hex.kitlangton.com/) | Dark space, a tactile interactive object, and an action that explains the product | A file-and-lens illustration that unfolds into slides, a 3D model, and a panorama when clicked |
| [vue-files-preview](https://github.com/VueFilesPreview/vue-files-preview) | Format-specific screenshots and direct examples | One main preview with six format tabs and links into working samples |
| [vue-office](https://github.com/501351981/vue-office) | An immediate demo | A local-file CTA and an actual recorded demo |
| [JitViewer](https://github.com/jitOffice/jit-viewer-sdk), [product page](https://jitword.com/jit-viewer.html) | Clear SDK entry points | A compact integration link and a separate interactive workbench |

The page opens on a near-black background with a dimensional file-and-lens illustration, quiet warm accents, and an invitation to unfold a file. Clicking plays a finite sequence of actual preview captures: a presentation, a 3D model, and a panorama. The sequence supports pause, replay, and direct scene selection. It pauses when the tab is hidden and stops after the last scene. With reduced motion enabled, scenes change only on request and transitions are disabled.

The scroll narrative follows three chapters: see the content behind different extensions, keep local files on your device, and explore more formats through real samples. Headings and selected visuals gently enter as they reach the viewport; content remains visible without the animation API. The switchable preview captures, keyboard-operable tabs, local-file picker, and workbench entry points use the existing preview behavior.

The format samples lead into a compact video walkthrough and a playground invitation. The ZimaOS recommendation appears last in the main content, immediately before the footer. It uses the official ZimaOS logo, states its deep integration with FiLens, and highlights unified file management, RAW / Live Photos / panorama viewing, data ownership and encrypted remote access, storage and backup, and the 800+ app ecosystem. Its product link follows the selected Chinese or English locale. Format support and developer documentation remain one click away. Both READMEs also place the ZimaOS banner at the end, after Star History.

## Chinese and English

- `?lang=zh` opens Chinese; `?lang=en` opens English.
- The navigation and footer both offer a language switch. Selection is remembered in local storage; an explicit URL parameter takes priority.
- Navigation, headings, content, labels, accessibility descriptions, metadata, and video captions have both versions.
- Existing workbench controls keep their existing language. This change translates the product homepage.

## Visuals and maintenance

The homepage uses the existing filens logo, the official ZimaOS logo, locally drawn format badges in the preview tabs, actual preview captures, and a three-slide sample presentation. The interactive introduction lives in `FileStory.vue`; its file, lens, orbit, and keycap are native CSS / SVG artwork, with no extra animation dependency. Homepage styles are scoped under `.landing` in `landing.css`. Timers and scroll observers are cleaned up when entering the workbench. Brand provenance is in [brand/SOURCES.md](../apps/demo/public/brand/SOURCES.md). The recording loads after the visitor asks to play it. Photo credits are available in a footer disclosure; detailed sources and regeneration instructions are in [home/SOURCES.md](../apps/demo/public/home/SOURCES.md).

To regenerate captures and the recording:

```sh
npm run dev --workspace @filens/demo -- --host 127.0.0.1 --port 4173
# In another terminal, with Playwright Chromium and FFmpeg available:
node scripts/capture-homepage-demo.mjs
# Refresh UI captures and the walkthrough using the existing sample documents:
node scripts/capture-homepage-demo.mjs --reuse-samples
```

The capture script also regenerates `filens-field-notes.pptx`. Format parsing and conversion remain in the shared frontend core; no backend conversion code is changed.

The refreshed walkthrough shows presentation controls, format search, a collapsible library, worksheet switching, Keynote, CAD, the orbiting helmet, panorama navigation, and local document import. Both caption tracks, the poster, the homepage cache version, and the README animated preview are regenerated together.

The 3D showcase uses the original `samples/viking-helmet.obj`, generated by `node scripts/generate-showcase-helmet.mjs`. To refresh the model, homepage capture, video and its helmet poster without regenerating the other sample documents or captures, run `node scripts/capture-homepage-demo.mjs --model-only`, then `node scripts/generate-readme-assets.mjs`. The walkthrough includes zooming and orbiting the helmet, with matching Chinese and English captions.

The public Keynote sample is a new three-slide fictional travel presentation. On macOS with Keynote installed, regenerate it with `osascript scripts/generate-keynote-sample.applescript /tmp/filens-weekend.key /absolute/path/to/photo-alpine-lake.jpg`, then copy the result to `apps/demo/public/samples/filens-weekend.key`. Regenerate the fictional cafe floor plan with `node scripts/generate-showcase-cad.mjs`. The document and workbook generators use invented travel, group, and shop data; they contain no internal project or personnel details.

After recapturing, run `node scripts/generate-readme-assets.mjs` to refresh the README overview and animated preview. Run `npm run build:vercel && npm run report:bundle-sizes` to refresh the measured size tables in both README versions.

Run the interaction checks with `npx playwright test apps/demo/e2e/workbench.e2e.ts apps/demo/e2e/landing.e2e.ts apps/demo/e2e/design-samples.e2e.ts` and build with `npm run build:demo`.
