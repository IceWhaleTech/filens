import JSZip from 'jszip';
import { uncompress as snappyUncompress } from 'snappyjs';
import type {
  IworkArchiveDataEntry,
  IworkArchiveIndex,
  IworkArchiveRecord,
  IworkImageAsset,
  IworkType
} from '../types';
import { decodeTypedMessage, getArchiveInfoType, getTypeName } from './protobuf';

export interface LoadedArchivePackage {
  type: IworkType;
  archive: IworkArchiveIndex;
  media: Record<string, IworkImageAsset>;
  zip: JSZip;
}

export interface LoadArchivePackageOptions {
  sourceName?: string;
}

interface ArchiveInfoValue {
  identifier?: number;
  messageInfos?: Array<{
    type?: number;
    length?: number;
    objectReferences?: number[];
    dataReferences?: number[];
  }>;
}

export async function loadArchivePackage(
  bytes: Uint8Array,
  type: IworkType,
  options: LoadArchivePackageOptions = {}
): Promise<LoadedArchivePackage> {
  const zip = await JSZip.loadAsync(bytes);
  const archive = await decodeArchiveZip(zip, type, options);
  const media = await buildMediaMap(zip, archive);
  return {
    type,
    archive,
    media,
    zip
  };
}

async function decodeArchiveZip(
  zip: JSZip,
  type: IworkType,
  options: LoadArchivePackageOptions = {}
): Promise<IworkArchiveIndex> {
  const records: Record<string, IworkArchiveRecord> = {};
  const warnings: string[] = [];
  const unsupportedRecordTypes = new Map<number, { count: number; examples: number[] }>();

  const iwaEntries = Object.keys(zip.files)
    .filter((name) => name.endsWith('.iwa'))
    .sort((left, right) => left.localeCompare(right));

  for (const entryName of iwaEntries) {
    const file = zip.file(entryName);
    if (!file) {
      continue;
    }

    const chunk = new Uint8Array(await file.async('uint8array'));
    decodeIwaBuffer(chunk, type, records, warnings, unsupportedRecordTypes);
  }

  const references = buildReferenceMaps(records);
  const packageMetadata = Object.values(records).find((record) => record.typeName === 'TSP.PackageMetadata')?.value;
  const dataEntries = normalizeDataEntries(packageMetadata, records);

  for (const [typeId, summary] of unsupportedRecordTypes.entries()) {
    const hint = summary.examples.length ? ` (e.g. archive ${summary.examples.slice(0, 3).join(', ')})` : '';
    warnings.push(`Unsupported iWork record type ${typeId} encountered ${summary.count} time${summary.count === 1 ? '' : 's'}.${hint}`.trim());
  }

  return {
    type,
    records,
    references,
    dataEntries,
    packageMetadata,
    sourceName: options.sourceName,
    warnings
  };
}

function decodeIwaBuffer(
  source: Uint8Array,
  type: IworkType,
  records: Record<string, IworkArchiveRecord>,
  warnings: string[],
  unsupportedRecordTypes: Map<number, { count: number; examples: number[] }>
): void {
  const bytes = unsnap(source);
  const archiveInfoType = getArchiveInfoType();
  let cursor = 0;

  while (cursor < bytes.length) {
    const lengthInfo = readVarUint(bytes, cursor);
    cursor = lengthInfo.nextOffset;
    if (lengthInfo.value <= 0) {
      break;
    }

    const archiveChunk = bytes.subarray(cursor, cursor + lengthInfo.value);
    cursor += lengthInfo.value;
    const archiveInfo = archiveInfoType.decode(archiveChunk);
    const infoValue = archiveInfoType.toObject(archiveInfo, {
      defaults: false,
      arrays: true,
      objects: true,
      longs: Number
    }) as ArchiveInfoValue;
    const archiveId = Number(infoValue.identifier ?? 0);

    for (let index = 0; index < (infoValue.messageInfos?.length ?? 0); index += 1) {
      const messageInfo = infoValue.messageInfos?.[index];
      const payloadLength = Number(messageInfo?.length ?? 0);
      const payload = bytes.subarray(cursor, cursor + payloadLength);
      cursor += payloadLength;

      const typeId = Number(messageInfo?.type ?? 0);
      const typeName = getTypeName(type, typeId);
      let value: unknown = null;

      if (typeName) {
        try {
          value = decodeTypedMessage(typeName, payload);
        } catch (error) {
          warnings.push(
            `Failed to decode iWork record ${archiveId} as ${typeName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } else {
        noteUnsupportedRecordType(unsupportedRecordTypes, typeId, archiveId);
      }

      const nextRecord: IworkArchiveRecord = {
        id: archiveId,
        archiveId,
        messageIndex: index,
        typeId,
        typeName: typeName ?? `unknown:${typeId}`,
        value,
        objectReferences: (messageInfo?.objectReferences ?? []).map(Number),
        dataReferences: (messageInfo?.dataReferences ?? []).map(Number)
      };

      const existing = records[String(archiveId)];
      if (value != null || !existing) {
        records[String(archiveId)] = nextRecord;
      }
    }
  }
}

function noteUnsupportedRecordType(
  bucket: Map<number, { count: number; examples: number[] }>,
  typeId: number,
  archiveId: number
): void {
  if (!Number.isFinite(typeId) || typeId <= 0) {
    return;
  }
  const existing = bucket.get(typeId) ?? { count: 0, examples: [] };
  existing.count += 1;
  if (existing.examples.length < 6 && Number.isFinite(archiveId) && archiveId > 0 && !existing.examples.includes(archiveId)) {
    existing.examples.push(archiveId);
  }
  bucket.set(typeId, existing);
}

function unsnap(source: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const kind = source[cursor];
    if (kind !== 0) {
      throw new Error(`Unsupported iWork snappy chunk header ${kind}.`);
    }

    const compressedLength = source[cursor + 1] | (source[cursor + 2] << 8) | (source[cursor + 3] << 16);
    cursor += 4;
    const compressed = source.subarray(cursor, cursor + compressedLength);
    cursor += compressedLength;
    const uncompressed = snappyUncompress(compressed);
    const normalized = uncompressed instanceof Uint8Array ? uncompressed : new Uint8Array(uncompressed);
    chunks.push(normalized);
    totalLength += normalized.length;
  }

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

function buildReferenceMaps(records: Record<string, IworkArchiveRecord>): IworkArchiveIndex['references'] {
  const outgoing: Record<string, number[]> = {};
  const incoming: Record<string, number[]> = {};

  for (const record of Object.values(records)) {
    const refs = Array.from(new Set(record.objectReferences)).filter((value) => Number.isFinite(value) && value > 0);
    outgoing[String(record.id)] = refs;
    for (const ref of refs) {
      const key = String(ref);
      const bucket = incoming[key] ?? [];
      bucket.push(record.id);
      incoming[key] = bucket;
    }
  }

  return {
    outgoing,
    incoming
  };
}

function normalizeDataEntries(
  packageMetadata: unknown,
  records: Record<string, IworkArchiveRecord>
): Record<string, IworkArchiveDataEntry> {
  const entries: Record<string, IworkArchiveDataEntry> = {};
  const metadata = asObject(packageMetadata);
  if (!metadata) {
    return entries;
  }

  const metadataById = buildDataMetadataMap(metadata, records);
  const datas = asArray<Record<string, unknown>>(metadata.datas);
  for (const item of datas) {
    const id = Number(item.identifier ?? 0);
    if (!id) {
      continue;
    }

    const dataMetadata = metadataById[String(id)];
    const fileName = asOptionalString(item.fileName) ?? asOptionalString(dataMetadata?.displayName);
    const preferredFileName = asOptionalString(item.preferredFileName);
    const resolvedPath = resolveDataPath(item, dataMetadata);

    entries[String(id)] = {
      id,
      path: resolvedPath,
      preferredFileName,
      fileName,
      contentType: resolveContentType(resolvedPath || fileName || preferredFileName || '')
    };
  }

  return entries;
}

function resolveDataPath(item: Record<string, unknown>, dataMetadata?: Record<string, unknown>): string {
  const fileName = asOptionalString(item.fileName);
  if (fileName) {
    return `Data/${fileName}`;
  }
  const preferredFileName = asOptionalString(item.preferredFileName);
  if (preferredFileName) {
    return `Data/${preferredFileName}`;
  }

  const locatorPath = normalizeDataLocatorPath(asOptionalString(item.documentResourceLocator));
  if (locatorPath) {
    return locatorPath;
  }

  const appRelativePath = normalizeDataLocatorPath(asOptionalString(dataMetadata?.appRelativePath));
  if (appRelativePath) {
    return appRelativePath;
  }

  const displayName = asOptionalString(dataMetadata?.displayName);
  if (displayName) {
    return `Data/${displayName}`;
  }

  return '';
}

function buildDataMetadataMap(
  packageMetadata: Record<string, unknown>,
  records: Record<string, IworkArchiveRecord>
): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  const entries = asArray<Record<string, unknown>>(readField(packageMetadata, ['dataMetadataEntries']));
  if (entries.length) {
    for (const entry of entries) {
      const id = Number(entry.dataIdentifier ?? 0);
      const metadata = resolveDataMetadataRecord(readField(entry, ['dataMetadata']), records);
      if (id && metadata) {
        map[String(id)] = metadata;
      }
    }
    return map;
  }

  const nestedMap = asObject(readField(packageMetadata, ['dataMetadataMap']));
  const nestedEntries = asArray<Record<string, unknown>>(readField(nestedMap, ['dataMetadataEntries']));
  for (const entry of nestedEntries) {
    const id = Number(entry.dataIdentifier ?? 0);
    const metadata = resolveDataMetadataRecord(readField(entry, ['dataMetadata']), records);
    if (id && metadata) {
      map[String(id)] = metadata;
    }
  }

  return map;
}

function resolveDataMetadataRecord(
  value: unknown,
  records: Record<string, IworkArchiveRecord>
): Record<string, unknown> | undefined {
  const inline = asObject(value);
  const identifier = Number(readField<number>(inline, ['identifier']) ?? 0);
  if (identifier) {
    return asObject(records[String(identifier)]?.value);
  }

  return inline;
}

function normalizeDataLocatorPath(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('Data/')) {
    return normalized;
  }

  const slashIndex = normalized.indexOf('/');
  if (slashIndex >= 0) {
    const root = normalized.slice(0, slashIndex);
    if (root === 'Data' || root === 'Metadata' || root === 'Index') {
      return normalized;
    }
  }

  return `Data/${normalized.replace(/^\/+/, '')}`;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readField<T = unknown>(value: Record<string, unknown> | undefined, keys: string[]): T | undefined {
  if (!value) {
    return undefined;
  }
  for (const key of keys) {
    if (key in value) {
      return value[key] as T;
    }
  }
  return undefined;
}

async function buildMediaMap(zip: JSZip, archive: IworkArchiveIndex): Promise<Record<string, IworkImageAsset>> {
  const media: Record<string, IworkImageAsset> = {};

  for (const entry of Object.values(archive.dataEntries)) {
    if (!entry.path) {
      continue;
    }

    const file = zip.file(entry.path);
    if (!file) {
      continue;
    }

    const data = new Uint8Array(await file.async('uint8array'));
    media[String(entry.id)] = {
      id: String(entry.id),
      path: entry.path,
      contentType: entry.contentType ?? 'application/octet-stream',
      data,
      role: resolveMediaRole(entry.path)
    };
  }

  return media;
}

function resolveMediaRole(path: string): IworkImageAsset['role'] {
  const normalized = path.toLowerCase();
  if (/\.(mp4|mov|m4v|webm)$/i.test(normalized)) {
    return 'video';
  }
  if (/\.(mp3|m4a|wav|aac)$/i.test(normalized)) {
    return 'audio';
  }
  return 'image';
}

function resolveContentType(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.heic')) return 'image/heic';
  if (normalized.endsWith('.tif') || normalized.endsWith('.tiff')) return 'image/tiff';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.mp4') || normalized.endsWith('.m4v')) return 'video/mp4';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.m4a')) return 'audio/mp4';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

export const __private__ = {
  normalizeDataEntries
};
