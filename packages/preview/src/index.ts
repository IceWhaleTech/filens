import { createApp, h, shallowReactive } from 'vue';
import { Preview } from '@filens/vue';
import type { ConverterClient, PreviewOptions, PreviewSource, SourceDescriptor } from '@filens/core';
import { createWasmConverterClient } from '@filens/converter-client';
import { createWasmPanoramaProcessor, type PanoramaProcessor } from '@filens/panorama';
import coreWasm from '../../../wasm/converter-core/dist/converter-core.wasm?url';
import imageWasm from '../../../wasm/converter-image/dist/converter-image.wasm?url';

export interface BrowserPreviewOptions extends PreviewOptions {
  src: PreviewSource | SourceDescriptor;
  name?: string;
  extension?: string;
  toolbar?: boolean;
  converter?: ConverterClient;
  mediaConverter?: ConverterClient;
  panoramaProcessor?: PanoramaProcessor;
  onRendered?: (state: unknown) => void;
  onError?: (error: Error) => void;
}

/** Mount the shared Vue preview host; no framework installation is required. */
export function createPreview(element: Element | string, options: BrowserPreviewOptions) {
  const props = shallowReactive({
    ...options,
    converter: options.converter ?? createWasmConverterClient({ wasm: coreWasm, imageWasm }),
    panoramaProcessor: options.panoramaProcessor ?? createWasmPanoramaProcessor({ wasm: coreWasm, imageWasm })
  });
  const app = createApp({ render: () => h(Preview, props) });
  app.mount(element);
  return {
    /** Switch sources using the shared preview lifecycle and cancellation. */
    update(next: Partial<BrowserPreviewOptions>) { Object.assign(props, next); },
    destroy() { app.unmount(); }
  };
}
