import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { openZipArchive } from '../src/parser/zip';

describe('Shared ZIP reader', () => {
  it.each(['STORE', 'DEFLATE'] as const)('reads %s files, directories, dates, Unicode paths and sliced input', async compression => {
    const zip = new JSZip();
    const date = new Date('2025-04-02T12:34:56Z');
    zip.file('目录/hello.txt', '中文 & hello', { date });
    zip.file('empty.bin', new Uint8Array(), { date });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression, comment: 'ZIP comment' });
    const padded = new Uint8Array(bytes.length + 10);
    padded.set(bytes, 5);
    const entries = await openZipArchive(padded.subarray(5, bytes.length + 5));
    expect(entries.get('目录/')?.directory).toBe(true);
    expect(entries.get('目录/hello.txt')?.modified).toBe(date.getTime());
    await expect(entries.get('目录/hello.txt')?.text()).resolves.toBe('中文 & hello');
    await expect(entries.get('empty.bin')?.bytes()).resolves.toHaveLength(0);
  });

  it('finds the directory when a ZIP signature appears in the comment', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hello');
    const entries = await openZipArchive(await zip.generateAsync({ type: 'uint8array', comment: 'PK\u0005\u0006 inside comment' }));
    await expect(entries.get('hello.txt')?.text()).resolves.toBe('hello');
  });

  it('inflates a large binary entry without changing its bytes', async () => {
    const data = Uint8Array.from({ length: 1024 * 1024 }, (_, index) => index % 251);
    const zip = new JSZip();
    zip.file('large.bin', data);
    const archive = await openZipArchive(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    expect(await archive.get('large.bin')?.bytes()).toEqual(data);
  });

  it('lists without inflating corrupt content and fails when that entry is opened', async () => {
    const zip = new JSZip();
    zip.file('bad.txt', 'text', { createFolders: false });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const view = new DataView(bytes.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[start] = 7;
    const archive = await openZipArchive(bytes);
    expect([...archive.keys()]).toEqual(['bad.txt']);
    await expect(archive.get('bad.txt')?.bytes()).rejects.toThrow();
  });

  it('normalizes parent components in entry names', async () => {
    const zip = new JSZip();
    zip.file('nested/../value.txt', 'value', { createFolders: false });
    const archive = await openZipArchive(await zip.generateAsync({ type: 'uint8array' }));
    expect([...archive.keys()]).toEqual(['value.txt']);
    await expect(archive.get('value.txt')?.text()).resolves.toBe('value');
  });

  it.each([3, 5])('rejects a forged uncompressed size of %i bytes', async size => {
    const zip = new JSZip();
    zip.file('test.txt', 'abcd');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(bytes.length - 6, true);
    view.setUint32(directory + 24, size, true);
    const archive = await openZipArchive(bytes);
    await expect(archive.get('test.txt')?.bytes()).rejects.toThrow('Invalid ZIP entry size');
  });

  it('rejects truncated archives', async () => {
    const zip = new JSZip();
    zip.file('value.txt', 'value');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(openZipArchive(bytes.subarray(0, bytes.length - 1))).rejects.toThrow();
    await expect(openZipArchive(new Uint8Array())).rejects.toThrow();
  });
});
