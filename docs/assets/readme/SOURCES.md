# README visuals

- `overview.webp` combines eight actual filens preview captures (PPTX, DOCX, XLSX, PDF, Keynote, DXF, the project-authored Viking helmet OBJ, and panorama) and locally drawn file badges. It includes cropped, pale-blue aurora photography by **Carsten** (CC BY 2.0) and a perspective view of **Greg Zaal / Poly Haven**'s Rogland Clear Night (CC0). The composite is distributed under CC BY-SA 4.0.
- `demo.gif` is a resized, accelerated derivative of the project's actual screen recording, including zooming and orbiting the Viking horned helmet, distributed under CC BY-SA 4.0. Both READMEs link to the full-speed MP4 with translated captions.
- `zimaos-banner.zh-CN.png` and `zimaos-banner.en.png` are compact, project-composed promotional banners using the [official ZimaOS logo](../../../apps/demo/public/brand/SOURCES.md). The logo is resized without changing its artwork. These banners are separate from the preview composites' CC BY-SA license; the ZimaOS brand belongs to IceWhale. Regenerate them with `python3 scripts/generate-zimaos-banners.py` (requires `rsvg-convert` from librsvg and a Chinese sans-serif font such as PingFang SC or Noto Sans CJK SC). Each PNG is rendered at 1280×256 and displayed at 640×128 in its README.
- The document is a fictional polar field guide; the workbook contains fictional observation data. The aurora is artistically color-graded, while the 360° source is a complete equirectangular Milky Way panorama.

Photo links, licenses, preparation steps, document provenance, and recording details: [homepage visual sources](../../../apps/demo/public/home/SOURCES.md).

Regenerate the captures first, then run `node scripts/generate-readme-assets.mjs`. The script requires Playwright Chromium and FFmpeg. Both language versions use the same preview visuals; ZimaOS banners have localized copy.

README banner links use `utm_source=github`, `utm_medium=referral`, `utm_campaign=filens_zimaos`, and `utm_content=readme_banner_zh` / `readme_banner_en` to distinguish the two languages. Their destinations remain the matching Chinese and English ZimaOS product pages.
