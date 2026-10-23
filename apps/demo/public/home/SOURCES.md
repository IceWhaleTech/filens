# Homepage visual assets

All preview screenshots and the walkthrough were captured from this project's running previewers. The file badges are locally drawn identifiers. The photographs below are embedded in real sample documents; document screenshots are not flattened substitutes for those files.

- `presentation.webp`: the project-created, editable `samples/filens-field-notes.pptx` presentation, “Beyond the Visible”. The cover uses a cropped, pale-blue color grade of **Carsten**'s “Aurora Borealis Norway 2013”, [Wikimedia source](https://commons.wikimedia.org/wiki/File:Aurora_Borealis_Norway_2013.jpg), [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). The original image is green; the artistic blue grade is not a scientific color record.
- `landscape.webp`: resized derivative of that pale-blue aurora photograph.
- `document.webp`: the project-authored `filens-aurora-guide.docx`. Its fictional polar itinerary includes the same credited aurora and a NASA Webb image.
- `spreadsheet.webp`: the project-authored `filens-observatory.xlsx`. Stations, observations, scores, and exposure plans are fictional. The file contains native cell values and formulas; preview styling follows the workbook driver's current capabilities.
- `pdf.webp`: the project-authored, three-page `filens-cosmic-atlas.pdf`, with native PDF text and vectors alongside the credited aurora and NASA Webb images.
- `iwork.webp`: the native Keynote version of “Beyond the Visible”, `filens-weekend.key`, rendered by filens. It contains the credited aurora and NASA Webb imagery.
- `cad.webp`: the project-generated `filens-cafe.dxf` fictional cafe floor plan.
- `model.webp`: the project-generated Crystal Crown OBJ sample.
- `panorama.webp`: a perspective view of **Rogland Clear Night** by **Greg Zaal / Poly Haven**, [asset source](https://polyhaven.com/a/rogland_clear_night), [CC0](https://polyhaven.com/license). The bundled source remains a complete 4096×2048 equirectangular image for 360° viewing.
- `filens-demo.mp4`: a real recording of these samples, with slide navigation, format switching, and a panorama drag. It includes the credited aurora and Milky Way imagery. The recording is distributed under CC BY-SA 4.0, has no narration, and includes `demo-zh.vtt` / `demo-en.vtt` chapter captions.
- `demo-poster.webp`: a still frame from the walkthrough, with the aurora credit above.

The additional **Cosmic Cliffs** imagery in the sample documents is by **NASA, ESA, CSA, STScI**, public domain. [Original image and full credits](https://webbtelescope.org/contents/media/images/2022/031/01G77PKB8NKR7S8Z6HBXMYATGJ). [Full sample provenance and preparation](../samples/SOURCES.md).

Regenerate with `node scripts/capture-homepage-demo.mjs` while the local demo server is running. It authors the Office/PDF samples and captures their actual previews using Playwright Chromium and FFmpeg. Native Keynote is generated separately with `scripts/generate-keynote-sample.applescript`; its second argument is the absolute `samples/showcase` directory. `FILENS_DEMO_URL` overrides the default local URL. Screenshots use WebP; the walkthrough uses H.264 MP4 with fast-start metadata. The homepage shows one preview at a time and does not preload video bytes.
