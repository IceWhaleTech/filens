import { Root, Type } from 'protobufjs';
import descriptorJson from '../generated/iwork-proto';
import { commonTypeMap, keynoteTypeMap, numbersTypeMap, pagesTypeMap } from '../generated/type-maps';
import type { IworkType } from '../types';

type TypeMap = Record<string, string>;

const root = Root.fromJSON(descriptorJson as Parameters<typeof Root.fromJSON>[0]);
const typeCache = new Map<string, Type>();
const archiveInfoType = lookupType('TSP.ArchiveInfo');
const typeMaps: Record<IworkType, TypeMap> = {
  key: {
    ...(commonTypeMap as TypeMap),
    ...(keynoteTypeMap as TypeMap)
  },
  pages: {
    ...(commonTypeMap as TypeMap),
    ...(pagesTypeMap as TypeMap)
  },
  numbers: {
    ...(commonTypeMap as TypeMap),
    ...(numbersTypeMap as TypeMap)
  }
};

export function getArchiveInfoType(): Type {
  return archiveInfoType;
}

export function getTypeName(type: IworkType, typeId: number): string | null {
  return typeMaps[type][String(typeId)] ?? null;
}

export function decodeTypedMessage(typeName: string, payload: Uint8Array): unknown {
  const messageType = lookupType(typeName);
  const decoded = messageType.decode(payload);
  return normalizeDecodedValue(decoded);
}

function lookupType(typeName: string): Type {
  const cached = typeCache.get(typeName);
  if (cached) {
    return cached;
  }

  const resolved = root.lookupType(typeName);
  typeCache.set(typeName, resolved);
  return resolved;
}

function normalizeDecodedValue(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDecodedValue(entry));
  }

  if (isLongLike(value)) {
    return value.toNumber();
  }

  if (typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeDecodedValue(entry);
    }
    return normalized;
  }

  return value;
}

function isLongLike(value: unknown): value is { toNumber(): number } {
  return typeof value === 'object' && value !== null && typeof (value as { toNumber?: unknown }).toNumber === 'function';
}
