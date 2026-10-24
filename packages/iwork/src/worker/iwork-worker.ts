import { loadArchivePackage } from '../parser/archive';
import { detectIworkType } from '../parser/detect';
import { buildNumbersSheetAt, buildParsedDocument, type SemanticBuildContext } from '../parser/semantic';
import type { IworkTypeHint, ParsedIworkDocument, ParsedNumbersSheet } from '../types';

interface DocumentRequest {
  kind: 'document';
  id: number;
  bytes: ArrayBuffer;
  hint?: IworkTypeHint;
  sourceName?: string;
}

interface SheetRequest {
  kind: 'sheet';
  id: number;
  index: number;
}

type WorkerRequest = DocumentRequest | SheetRequest | { kind: 'clear' };

interface ParseResponse {
  id: number;
  document?: ParsedIworkDocument;
  sheet?: ParsedNumbersSheet;
  error?: string;
}

let context: SemanticBuildContext | null = null;

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === 'clear') {
    context = null;
    return;
  }
  try {
    if (request.kind === 'sheet') {
      if (context?.archive.type !== 'numbers') {
        throw new Error('No Numbers document is loaded.');
      }
      const sheet = buildNumbersSheetAt(context, request.index);
      if (!sheet) {
        throw new Error(`Numbers sheet ${request.index + 1} was not found.`);
      }
      self.postMessage({ id: request.id, sheet } satisfies ParseResponse);
      return;
    }

    context = null;
    const bytes = new Uint8Array(request.bytes);
    const type = await detectIworkType(bytes, { hint: request.hint });
    const archivePackage = await loadArchivePackage(bytes, type, { sourceName: request.sourceName });
    context = { archive: archivePackage.archive, media: archivePackage.media };
    const document = buildParsedDocument(
      context,
      type === 'numbers' ? { numbersSheetIndexes: new Set([0]) } : undefined
    );
    self.postMessage({ id: request.id, document } satisfies ParseResponse);
  } catch (error) {
    if (request.kind === 'document') context = null;
    const response: ParseResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(response);
  }
});
