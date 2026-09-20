import { MediaRegistry, renderSlideToElement, type ParsedPresentation, type SlideModel } from '@filens/core';
import type { IworkCanvasModel, ParsedIworkDocument } from '../types';

const DEFAULT_THEME: ParsedPresentation['theme'] = {
  colors: {},
  fonts: {}
};

export function createMediaRegistry(document: ParsedIworkDocument): MediaRegistry {
  return new MediaRegistry(presentationForDocument(document));
}

export function documentCanvases(document: ParsedIworkDocument): IworkCanvasModel[] {
  if (document.kind === 'key') {
    return document.slides;
  }
  if (document.kind === 'pages') {
    return document.pages.map((page) => page.canvas);
  }
  return document.sheets.map((sheet) => sheet.canvas);
}

export function createCanvasElement(documentLike: Document, document: ParsedIworkDocument, canvas: IworkCanvasModel, registry?: MediaRegistry): HTMLElement {
  const presentation = presentationForCanvas(document, canvas.slide);
  const activeRegistry = registry ?? new MediaRegistry(presentation);
  const shell = documentLike.createElement('div');
  shell.className = document.kind === 'numbers' ? 'iworkv-page-shell iworkv-sheet-shell' : 'iworkv-page-shell';
  const content = renderSlideToElement(canvas.slide, presentation, {
    mediaRegistry: activeRegistry
  });
  shell.appendChild(content);
  return shell;
}

function presentationForCanvas(document: ParsedIworkDocument, slide: SlideModel): ParsedPresentation {
  if (document.kind === 'key') {
    return {
      ...document.presentation,
      slides: [slide]
    };
  }

  return {
    size: {
      width: slide.width,
      height: slide.height
    },
    theme: DEFAULT_THEME,
    slides: [slide],
    media: document.media,
    warnings: document.warnings.slice()
  };
}

function presentationForDocument(document: ParsedIworkDocument): ParsedPresentation {
  if (document.kind === 'key') {
    return document.presentation;
  }

  return {
    size: {
      width: 1,
      height: 1
    },
    theme: DEFAULT_THEME,
    slides: documentCanvases(document).map((canvas) => canvas.slide),
    media: document.media,
    warnings: document.warnings.slice()
  };
}
