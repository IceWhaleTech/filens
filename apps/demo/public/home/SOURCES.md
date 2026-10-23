# Homepage visual assets

All preview screenshots and the walkthrough were captured from this project's running previewers. No competitor screenshots, customer endorsements, or partner logos are used. The format badges are locally drawn identifiers for file families.

- `presentation.webp`: the project-created `samples/filens-field-notes.pptx` sample. Its lake photograph is by **Ricardo Gomez Angel**, [Unsplash source](https://unsplash.com/photos/brown-wooden-house-near-lake-and-mountain-pR5uo2ED_hg), Unsplash License. The image is cropped in the slide.
- `landscape.webp`: resized WebP derivative of that same photograph.
- `document.webp`: the project-generated `generated.docx` sample, a fictional weekend travel guide. All groups, places, dates, and figures are made up.
- `spreadsheet.webp`: ExcelJS `rich-xlsx-many-columns.xlsx` test document (MIT); see [sample sources](../samples/SOURCES.md).
- `iwork.webp`: the project-created `filens-weekend.key` three-slide fictional outdoor presentation, rendered by filens. It uses the credited Alpine lake photograph above.
- `cad.webp`: the project-generated `filens-cafe.dxf` fictional cafe floor plan.
- `model.webp`: the project-generated Crystal Crown OBJ sample.
- `panorama.webp`: the existing **Kochelsee Panorama** by **SimonWaldherr**, [Wikimedia source](https://commons.wikimedia.org/wiki/File:Kochelsee_Panorama.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Rendered as a perspective view, resized and surrounded by the viewer UI. This derivative is distributed under CC BY-SA 4.0.
- `filens-demo.mp4`: a real screen recording of the above sample files, with page navigation, format switching, and a panorama drag. The recording includes Kochelsee Panorama and is distributed under CC BY-SA 4.0. It has no narration. `demo-zh.vtt` and `demo-en.vtt` provide translated chapter captions.
- `demo-poster.webp`: still frame from the walkthrough showing Field Notes, with the photograph credit above.

Regenerate with `node scripts/capture-homepage-demo.mjs` while the local demo server is running. It uses Playwright Chromium and FFmpeg. `FILENS_DEMO_URL` can override the default local URL. Images are encoded as WebP with browser canvas; videos are H.264 MP4 with fast-start metadata. The homepage shows one preview at a time and does not preload video bytes.
