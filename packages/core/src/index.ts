import './styles/index.css';

export { createViewer, init, PptxViewer } from './viewer';
export { loadPptx } from './parser/load-pptx';
export { MediaRegistry, renderSlideToElement } from './render/dom';
export type { MediaResolver, RenderSlideOptions } from './render/dom';
export * from './preview';
export type {
  Model3dPreviewNode,
  Model3dPreviewState,
  PreviewDisplayMode,
  PreviewFontResolveRequest,
  PreviewFontResolveResult,
  PreviewFontResolver,
  PreviewMaterialInfo,
  PreviewSnapshotBackground,
  PreviewSectionInfo,
  PreviewerInstance,
  PreviewResourceResolveRequest,
  PreviewResourceResolveResult,
  PreviewResourceResolver,
  PreviewerFactory,
  PreviewSession
} from './preview/types';
export type * from './types';
