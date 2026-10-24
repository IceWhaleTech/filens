import type { LoadIworkOptions, ParsedIworkDocument } from '../types';
import { loadSourceBytes } from './load-source';
import { detectIworkType, detectIworkTypeByName } from './detect';
import { loadArchivePackage } from './archive';
import { buildParsedDocument } from './semantic';

export async function loadIwork(source: unknown, options: LoadIworkOptions = {}): Promise<ParsedIworkDocument> {
  const bytes = await loadSourceBytes(source as never, {
    signal: options.signal
  });
  const type = options.hint && options.hint !== 'auto' ? options.hint
    : detectIworkTypeByName(source as never) ?? await detectIworkType(bytes, options);
  const archivePackage = await loadArchivePackage(bytes, type, {
    sourceName: options.sourceName ?? resolveSourceName(source)
  });
  return buildParsedDocument({
    archive: archivePackage.archive,
    media: archivePackage.media
  });
}

function resolveSourceName(source: unknown): string | undefined {
  if (typeof source === 'string') {
    return extractSourceName(source);
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return source.name;
  }

  return undefined;
}

function extractSourceName(path: string): string | undefined {
  const normalized = path.split('?')[0]?.split('#')[0] ?? '';
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) {
    return undefined;
  }

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}
