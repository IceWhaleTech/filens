import { openZipArchive, type ZipEntry } from '@filens/core/zip';
import { uncompress as snappyUncompress } from 'snappyjs';
import type { DetectIworkTypeOptions, IworkSource, IworkType } from '../types';
import { loadSourceBytes } from './load-source';
import { decodeTypedMessage } from './protobuf';

const EXTENSION_MAP: Record<string, IworkType> = {
  '.key': 'key',
  '.pages': 'pages',
  '.numbers': 'numbers'
};

export async function detectIworkType(source: IworkSource, options: DetectIworkTypeOptions = {}): Promise<IworkType> {
  if (options.hint && options.hint !== 'auto') {
    return options.hint;
  }

  const byName = detectIworkTypeByName(source);
  if (byName) {
    return byName;
  }

  const bytes = await loadSourceBytes(source, {
    signal: options.signal
  });
  const zip = await openZipArchive(bytes);
  const entryNames = [...zip.keys()];

  const byArchiveTypes = await detectIworkTypeByArchiveTypes(zip);
  if (byArchiveTypes) {
    return byArchiveTypes;
  }

  if (entryNames.some((entry) => /^Index\/MasterSlide-/i.test(entry))) {
    return 'key';
  }

  if (entryNames.some((entry) => /^Index\/Tables\//i.test(entry))) {
    if (entryNames.some((entry) => /^Metadata\//i.test(entry))) {
      return 'numbers';
    }
    return 'pages';
  }

  if (entryNames.some((entry) => /^Metadata\//i.test(entry))) {
    return 'key';
  }

  throw new Error('Unable to detect iWork document type. Pass an explicit type hint.');
}

export function detectIworkTypeByName(source: IworkSource): IworkType | null {
  if (typeof source === 'string') {
    return detectIworkTypeFromPath(source);
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return detectIworkTypeFromPath(source.name);
  }

  return null;
}

function detectIworkTypeFromPath(path: string): IworkType | null {
  const normalized = path.toLowerCase().split('?')[0].split('#')[0];
  for (const [extension, type] of Object.entries(EXTENSION_MAP)) {
    if (normalized.endsWith(extension)) {
      return type;
    }
  }
  return null;
}

async function detectIworkTypeByArchiveTypes(zip: Map<string, ZipEntry>): Promise<IworkType | null> {
  const file = zip.get('Index/Document.iwa');
  if (!file) {
    return null;
  }

  const bytes = await file.bytes();
  const typeIds = peekMessageTypesFromIwa(bytes);
  if (typeIds.some((typeId) => typeId >= 10000 && typeId < 11000)) {
    return 'pages';
  }
  if (typeIds.some((typeId) => typeId >= 12000 || typeId === 3061 || typeId === 6030 || typeId === 6316)) {
    return 'numbers';
  }
  if (typeIds.some((typeId) => typeId === 2 || (typeId >= 4 && typeId <= 148))) {
    return 'key';
  }
  return null;
}

function peekMessageTypesFromIwa(source: Uint8Array): number[] {
  const bytes = unsnap(source);
  const types: number[] = [];
  let cursor = 0;

  while (cursor < bytes.length) {
    const lengthInfo = readVarUint(bytes, cursor);
    cursor = lengthInfo.nextOffset;
    const archiveChunk = bytes.subarray(cursor, cursor + lengthInfo.value);
    cursor += lengthInfo.value;
    const info = decodeTypedMessage('TSP.ArchiveInfo', archiveChunk) as { messageInfos?: Array<{ type?: number; length?: number }> };
    for (const messageInfo of info.messageInfos ?? []) {
      if (typeof messageInfo.type === 'number') {
        types.push(messageInfo.type);
      }
      cursor += Number(messageInfo.length ?? 0);
    }
  }

  return types;
}

function unsnap(source: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const compressedLength = source[cursor + 1] | (source[cursor + 2] << 8) | (source[cursor + 3] << 16);
    cursor += 4;
    const compressed = source.subarray(cursor, cursor + compressedLength);
    cursor += compressedLength;
    const uncompressed = snappyUncompress(compressed);
    chunks.push(uncompressed);
    totalLength += uncompressed.length;
  }

  if (chunks.length === 1) return chunks[0];
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function readVarUint(bytes: Uint8Array, startOffset: number): { value: number; nextOffset: number } {
  let value = 0;
  let shift = 0;
  let offset = startOffset;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    value |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) {
      return {
        value,
        nextOffset: offset
      };
    }
    shift += 7;
  }
  throw new Error('Unexpected end of iWork archive while reading varint.');
}
