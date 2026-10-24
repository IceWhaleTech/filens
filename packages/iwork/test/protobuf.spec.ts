import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Root, Reader, Writer } from 'protobufjs';
import { uncompress } from 'snappyjs';
import descriptor from '../src/generated/iwork-proto';
import { decodeTypedMessage, getTypeName } from '../src/parser/protobuf';
import { readFixture } from './helpers';
import type { IworkType } from '../src/types';

const reference = Root.fromJSON(descriptor);
const normalize = (name: string, bytes: Uint8Array) => {
  const type = reference.lookupType(name);
  return type.toObject(type.decode(bytes), { longs: Number, arrays: true, objects: true });
};

describe('schema-directed iWork protobuf decoding', () => {
  it('matches protobufjs across complete Numbers, Pages and Keynote archives', async () => {
    let checked = 0;
    const fixtures: Array<[string, IworkType]> = [
      ['vendor/iwork-converter/testdata/a.numbers', 'numbers'],
      ['vendor/iwork-converter/testdata/a.pages', 'pages'],
      ['vendor/iwork-converter/testdata/a.key', 'key'],
      ['../../apps/demo/public/samples/a.numbers', 'numbers']
    ];
    for (const [file, kind] of fixtures) {
      const zip = await JSZip.loadAsync(await readFixture(file));
      for (const entry of Object.values(zip.files).filter(entry => entry.name.endsWith('.iwa'))) {
        const compressed = await entry.async('uint8array');
        const chunks: Uint8Array[] = [];
        for (let offset = 0; offset < compressed.length;) {
          const length = compressed[offset + 1] | compressed[offset + 2] << 8 | compressed[offset + 3] << 16;
          offset += 4;
          chunks.push(uncompress(compressed.subarray(offset, offset + length)));
          offset += length;
        }
        const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
        let cursor = 0;
        for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
        const reader = Reader.create(bytes);
        while (reader.pos < reader.len) {
          const length = reader.uint32();
          if (!length) break;
          const header = bytes.subarray(reader.pos, reader.pos + length);
          reader.pos += length;
          const info = normalize('TSP.ArchiveInfo', header);
          expect(decodeTypedMessage('TSP.ArchiveInfo', header)).toEqual(info);
          for (const message of info.messageInfos ?? []) {
            const payload = bytes.subarray(reader.pos, reader.pos + message.length);
            reader.pos += message.length;
            const name = getTypeName(kind, message.type);
            if (!name) continue;
            let expected: unknown;
            try { expected = normalize(name, payload); }
            catch {
              expect(() => decodeTypedMessage(name, payload)).toThrow();
              continue;
            }
            let actual: unknown;
            try { actual = decodeTypedMessage(name, payload); }
            catch (error) { throw new Error([file, entry.name, name, [...payload.subarray(0, 32)], JSON.stringify(expected).slice(0, 250), String(error)].join(' / ')); }
            expect(actual, name).toEqual(expected);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('handles packed and unpacked integers, 64-bit IDs and unknown fields', () => {
    const payload = Writer.create()
      .uint32(8).uint32(6001)
      .uint32(18).fork().uint32(2).uint32(300).ldelim()
      .uint32(16).uint32(4)
      .uint32(24).uint32(0)
      .uint32(42).fork().uint64(2 ** 40).uint64(7).ldelim()
      .uint32(32762).bytes(new Uint8Array([1, 2, 3])).finish();
    expect(decodeTypedMessage('TSP.MessageInfo', payload)).toEqual(normalize('TSP.MessageInfo', payload));
  });

  it('preserves 64-bit reference values across varint widths and number rounding', () => {
    for (const identifier of ['0', '127', '128', '16383', '16384', '2097151', '2097152',
      '268435455', '268435456', '4294967295', '1099511627776', '9007199254740991',
      '9007199254740993', '18446744073709551615']) {
      const payload = Writer.create().uint32(8).uint64(identifier).finish();
      expect(decodeTypedMessage('TSP.Reference', payload)).toEqual(normalize('TSP.Reference', payload));
    }
    for (const payload of [new Uint8Array([8, 128]), new Uint8Array([8, 128, 128, 128])]) {
      let expected: unknown;
      try { expected = normalize('TSP.Reference', payload); }
      catch {
        expect(() => decodeTypedMessage('TSP.Reference', payload)).toThrow();
        continue;
      }
      expect(decodeTypedMessage('TSP.Reference', payload)).toEqual(expected);
    }
  });

  it('rejects missing required fields and truncated nested messages', () => {
    expect(() => decodeTypedMessage('TSP.MessageInfo', new Uint8Array())).toThrow('required');
    expect(() => decodeTypedMessage('TSP.ArchiveInfo', new Uint8Array([18, 50, 8, 1]))).toThrow();
  });
});
