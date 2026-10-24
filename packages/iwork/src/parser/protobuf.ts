import { Reader, Root, Type } from 'protobufjs';
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
  try {
    return decodeMessage(messageType, Reader.create(payload), payload.length);
  } catch (error) {
    // Some older schemas misidentify newer style payloads. Retain the
    // existing decoder's permissive interpretation for those records.
    if (!(error instanceof LegacyLayoutError)) throw error;
    return normalizeDecodedValue(messageType.decode(payload));
  }
}

class LegacyLayoutError extends Error {}

interface MessageLayout {
  fields: Record<number, FieldLayout>;
  repeated: string[];
  required: string[];
  fallback: boolean;
}

interface FieldLayout {
  name: string;
  scalar?: ScalarType;
  message?: Type;
  repeated: boolean;
}

type ScalarType = 'double' | 'float' | 'int32' | 'uint32' | 'sint32' | 'fixed32' | 'sfixed32'
  | 'int64' | 'uint64' | 'sint64' | 'fixed64' | 'sfixed64' | 'bool' | 'string' | 'bytes';
const layouts = new WeakMap<Type, MessageLayout>();

// Hundreds of iWork types occur only once in a document. A schema-directed
// reader avoids generating/compiling a decoder, encoder and converter for
// each type, and produces normalized objects without a second deep copy.
function messageLayout(type: Type): MessageLayout {
  const cached = layouts.get(type);
  if (cached) return cached;
  const layout: MessageLayout = {
    fields: {}, repeated: [], required: [],
    fallback: Boolean((type as Type & { group?: boolean }).group)
  };
  for (const field of type.fieldsArray) {
    field.resolve();
    layout.fallback ||= field.map;
    if (field.repeated) layout.repeated.push(field.name);
    if (field.required) layout.required.push(field.name);
    const message = field.resolvedType instanceof Type ? field.resolvedType : undefined;
    layout.fields[field.id] = {
      name: field.name, repeated: field.repeated, message,
      scalar: message ? undefined : field.resolvedType ? 'int32' : field.type as ScalarType
    };
  }
  layouts.set(type, layout);
  return layout;
}

function decodeMessage(type: Type, reader: Reader, end: number, depth = 0): Record<string, unknown> {
  if (depth > Reader.recursionLimit) throw new Error('maximum nesting depth exceeded');
  const layout = messageLayout(type);
  // Preserve protobufjs handling for map/group schemas, which ordinary iWork
  // archive records do not use.
  if (layout.fallback) return normalizeDecodedValue(type.decode(reader, end - reader.pos)) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const name of layout.repeated) result[name] = [];
  while (reader.pos < end) {
    const tag = reader.uint32();
    const field = layout.fields[tag >>> 3];
    if (!field) { reader.skipType(tag & 7); continue; }
    if (field.repeated) {
      const values = result[field.name] as unknown[];
      if ((tag & 7) === 2 && field.scalar && field.scalar !== 'string' && field.scalar !== 'bytes') {
        const length = reader.uint32(), packedEnd = reader.pos + length;
        if (packedEnd > end) throw new RangeError('Truncated packed iWork field.');
        while (reader.pos < packedEnd) values.push(readScalar(reader, field.scalar));
        if (reader.pos !== packedEnd) throw new RangeError('Invalid packed iWork field.');
      } else {
        values.push(readFieldValue(reader, field, depth));
      }
    } else {
      result[field.name] = readFieldValue(reader, field, depth);
    }
  }
  if (reader.pos !== end) throw new LegacyLayoutError('Legacy iWork message layout: ' + type.fullName);
  for (const name of layout.required) {
    if (!Object.prototype.hasOwnProperty.call(result, name)) throw new Error('missing required ' + name);
  }
  return result;
}

function readFieldValue(reader: Reader, field: FieldLayout, depth: number): unknown {
  if (!field.message) return readScalar(reader, field.scalar!);
  const length = reader.uint32(), end = reader.pos + length;
  if (end > reader.len) throw new RangeError('Truncated iWork message.');
  return decodeMessage(field.message, reader, end, depth + 1);
}

function readScalar(reader: Reader, type: ScalarType): unknown {
  if (type === 'uint64' || type === 'int64' || type === 'sint64') {
    const value = readSmallVarint(reader);
    if (value !== undefined) return type === 'sint64' ? (value >>> 1) ^ -(value & 1) : value;
  }
  const value = reader[type]();
  if (type === 'bytes') return new Uint8Array(value as Uint8Array);
  return isLongLike(value) ? value.toNumber() : value;
}

// Archive IDs and references usually fit in four bytes. Decode those directly
// as numbers, avoiding a LongBits and Long allocation for each reference. Leave
// larger, signed-negative and malformed encodings to the established reader.
function readSmallVarint(reader: Reader): number | undefined {
  const bytes = reader.buf;
  const start = reader.pos;
  let byte = bytes[start];
  if (byte < 128) { reader.pos = start + 1; return byte; }
  let value = byte & 127;
  byte = bytes[start + 1];
  value |= (byte & 127) << 7;
  if (byte < 128) { reader.pos = start + 2; return value; }
  byte = bytes[start + 2];
  value |= (byte & 127) << 14;
  if (byte < 128) { reader.pos = start + 3; return value; }
  byte = bytes[start + 3];
  value |= (byte & 127) << 21;
  if (byte < 128) { reader.pos = start + 4; return value; }
  return undefined;
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
