import { describe, expect, it } from 'vitest';
import { deferRecordValue, findRecordByValue, resolveMergedStyle, withStyleResolutionCache } from '../src/parser/helpers';
import type { IworkArchiveIndex, IworkArchiveRecord } from '../src/types';

function archive(): IworkArchiveIndex {
  const record = (id: number, value: unknown): IworkArchiveRecord => ({ id, archiveId: id, messageIndex: 0, typeId: 1, typeName: 'style', value, objectReferences: [], dataReferences: [] });
  return { type: 'numbers', records: {
    '1': record(1, { super: { parent: { identifier: 2 } }, cellProperties: { padding: { left: 4 } } }),
    '2': record(2, { cellProperties: { padding: { top: 8 }, color: 'red' } })
  }, references: { incoming: {}, outgoing: {} }, dataEntries: {}, warnings: [] };
}

describe('iWork style resolution across semantic builds', () => {
  it('indexes accessed lazy values without decoding unrelated records and observes public edits', () => {
    const source = archive();
    let reads = 0;
    deferRecordValue(source.records['1'], () => { reads++; return { color: 'red' }; });
    deferRecordValue(source.records['2'], () => { reads++; return { color: 'blue' }; });
    withStyleResolutionCache(source, () => {
      const first = source.records['1'].value as object;
      expect(findRecordByValue(source, first)?.id).toBe(1);
      expect(reads).toBe(1);
      const second = source.records['2'].value as object;
      expect(findRecordByValue(source, second)?.id).toBe(2);
      expect(reads).toBe(2);
    });
    source.records['1'].value = source.records['2'].value;
    withStyleResolutionCache(source, () => {
      expect(findRecordByValue(source, source.records['2'].value as object)?.id).toBe(1);
    });
    deferRecordValue(source.records['2'], () => { throw new Error('unused'); });
    source.records['2'].value = { color: 'green' };
    expect(source.records['2'].value).toEqual({ color: 'green' });
  });

  it('preserves inheritance and observes parent edits in a subsequent build', () => {
    const source = archive();
    const expected = resolveMergedStyle(source, 1);
    withStyleResolutionCache(source, () => {
      expect(resolveMergedStyle(source, 1)).toEqual(expected);
      expect(resolveMergedStyle(source, 1)).toEqual(expected);
    });
    (source.records['2'].value as { cellProperties: { color: string } }).cellProperties.color = 'blue';
    const next = withStyleResolutionCache(source, () => resolveMergedStyle(source, 1));
    expect(next).toMatchObject({ cellProperties: { padding: { left: 4, top: 8 }, color: 'blue' } });
  });

  it('does not reuse ancestry-dependent partial results for cyclic styles', () => {
    const source = archive();
    (source.records['2'].value as Record<string, unknown>).super = { parent: { identifier: 1 } };
    const first = resolveMergedStyle(source, 1), second = resolveMergedStyle(source, 2);
    withStyleResolutionCache(source, () => {
      expect(resolveMergedStyle(source, 1)).toEqual(first);
      expect(resolveMergedStyle(source, 2)).toEqual(second);
      expect(resolveMergedStyle(source, 1)).toEqual(first);
    });
  });

  it('preserves the first matching record and observes record edits across builds', () => {
    const source = archive();
    const value = source.records['2'].value as object;
    source.records['3'] = { ...source.records['2'], id: 3 };
    withStyleResolutionCache(source, () => {
      expect(findRecordByValue(source, value)?.id).toBe(2);
      expect(findRecordByValue(source, {})?.id).toBeUndefined();
    });
    source.records['2'].value = {};
    withStyleResolutionCache(source, () => expect(findRecordByValue(source, value)?.id).toBe(3));
    expect(findRecordByValue(source, value)?.id).toBe(3);
  });
});
