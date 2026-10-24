import { unzipSync } from 'fflate';
import { openZipArchive } from './zip';

export class PptxArchiveEntry {
  private loaded?: Promise<Uint8Array>;
  constructor(private readonly data: Uint8Array | (() => Promise<Uint8Array>)) {}

  async(type: 'text'): Promise<string>;
  async(type: 'uint8array'): Promise<Uint8Array>;
  async(type: 'text' | 'uint8array'): Promise<string | Uint8Array> {
    this.loaded ??= typeof this.data === 'function' ? this.data() : Promise.resolve(this.data);
    return this.loaded.then(data => type === 'text' ? new TextDecoder().decode(data) : data);
  }
}

export interface PptxArchive {
  file(name: string): PptxArchiveEntry | null;
}

export async function loadPptxArchive(bytes: Uint8Array): Promise<PptxArchive> {
  // Index once and inflate only parts requested by the parser. Most decks
  // carry unused layouts, thumbnails and other non-preview attachments.
  const indexed = await openZipArchive(bytes).catch(() => undefined);
  if (indexed) {
    const entries = new Map([...indexed].map(([name, entry]) => [name, new PptxArchiveEntry(entry.bytes)]));
    return { file: name => entries.get(name) ?? null };
  }
  // Keep the existing reader for archives with unusual compression methods.
  // In particular, an unsupported unused attachment must stay compressed.
  const names: string[] = [];
  unzipSync(bytes, { filter: file => {
    names.push(file.name);
    return false;
  } });
  const entries = new Map(names.map(name => [name, new PptxArchiveEntry(async () =>
    unzipSync(bytes, { filter: file => file.name === name })[name]
  )]));
  return { file: name => entries.get(name) ?? null };
}
