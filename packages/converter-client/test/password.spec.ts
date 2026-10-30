import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWasmConverterClient } from '../src';
import type { ConverterClient } from '@filens/core';

const password = ' filens 密码🔐 ';
let client: ConverterClient;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
beforeAll(async () => {
  client = createWasmConverterClient({ wasm: new Uint8Array(await readFile(path.join(root, 'wasm/converter-core/dist/converter-core.wasm'))) });
});

async function convert(fixture: string, sourceFormat: string, targetFormat: string, suppliedPassword?: string) {
  const source = new Uint8Array(await readFile(path.join(root, 'packages/converter-client/test/fixtures/password', fixture)));
  return client.convert({ source, sourceFormat, targetFormat, password: suppliedPassword }, { descriptor: { source, name: fixture } });
}

describe('Office document decryption in the shared WASM core', () => {
  it.each([
    ['docx', 'word/document.xml', 'Fixture DOCX document'],
    ['xlsx', 'xl/worksheets/sheet1.xml', 'Fixture XLSX workbook'],
    ['pptx', 'ppt/slides/slide1.xml', 'Fixture PPTX presentation slide']
  ])('opens an independently encrypted %s, distinguishing missing and wrong passwords', async (format, part, text) => {
    await expect(convert(`agile.${format}`, format, format)).rejects.toMatchObject({ result: { errorCode: 'password_required' } });
    await expect(convert(`agile.${format}`, format, format, 'wrong')).rejects.toMatchObject({ result: { errorCode: 'password_invalid' } });
    const result = await convert(`agile.${format}`, format, format, password);
    const zip = await JSZip.loadAsync(result.source as Uint8Array);
    expect(await zip.file(part)?.async('string')).toContain(text);
    expect(result.format).toBe(format);
    expect(zip.file('vbaProject.bin')).toBeNull();
  });

  it.each([['docx', 'docm'], ['xlsx', 'xlsm'], ['pptx', 'pptm']])('decrypts a %s envelope through its %s conversion route', async (target, source) => {
    const result = await convert(`agile.${target}`, source, target, password);
    expect(result.format).toBe(target);
    expect((result.source as Uint8Array).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  });

  it('rejects damaged ciphertext as a document error after a correct password', async () => {
    await expect(convert('tampered.docx', 'docx', 'docx', password)).rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
  });

  it.each([
    ['ecma376standard_password.docx', 'docx', 'docx', 'word/document.xml', 'Password1234_'],
    ['rc4cryptoapi_password.doc', 'doc', 'docx', 'word/document.xml', 'Password1234_'],
    ['rc4cryptoapi_password.xls', 'xls', 'xlsx', 'xl/worksheets/sheet1.xml', 'Password1234_'],
    ['rc4cryptoapi_password.ppt', 'ppt', 'pptx', 'ppt/slides/slide1.xml', 'Password1234_'],
    ['xor_password_123456789012345.xls', 'xls', 'xlsx', 'xl/worksheets/sheet1.xml', '123456789012345']
  ])('opens the upstream reference %s', async (fixture, source, target, part, key) => {
    await expect(convert(`reference/${fixture}`, source, target)).rejects.toMatchObject({ result: { errorCode: 'password_required' } });
    await expect(convert(`reference/${fixture}`, source, target, 'wrong')).rejects.toMatchObject({ result: { errorCode: 'password_invalid' } });
    const result = await convert(`reference/${fixture}`, source, target, key);
    const zip = await JSZip.loadAsync(result.source as Uint8Array);
    expect(await zip.file(part)?.async('string')).toContain('<?xml');
  });
});
