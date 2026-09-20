import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type PagedPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewSession
} from '@filens/core';

const PDF_ROUTE: FormatDefinition = {
  extensions: ['pdf'],
  family: 'paged',
  driverId: 'pdf',
  targetFormat: 'pdf',
  contentTypes: ['application/pdf']
};

export function createPdfPreviewDriver(): PreviewDriver<PagedPreviewState> {
  return {
    id: 'pdf',
    family: 'paged',
    supports: (format) => format.replace(/^\./, '').toLowerCase() === 'pdf',
    createSession(host): PreviewSession<PagedPreviewState> {
      const listeners = new Map<PreviewEventName, Set<(payload: never) => void>>();
      const state: PagedPreviewState = {
        loading: false,
        error: null,
        family: 'paged',
        warnings: [],
        capabilities: { paged: true },
        pageIndex: 0,
        pageCount: 1,
        scale: 1,
        fit: 'contain'
      };
      const emit = <T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]) => {
        for (const handler of listeners.get(event) ?? []) handler(payload as never);
      };
      return {
        async load() {
          const canvas = document.createElement('canvas');
          canvas.className = 'pdfv-page';
          host.replaceChildren(canvas);
          emit('rendered', state);
          emit('statechange', state);
        },
        destroy: () => host.replaceChildren(),
        getState: () => state,
        on(event, handler) {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(handler as never);
          listeners.set(event, handlers);
          return () => handlers.delete(handler as never);
        }
      };
    }
  };
}

export function createPdfPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [PDF_ROUTE, ...baseRoutes.filter((route) => !route.extensions.includes('pdf'))];
}
