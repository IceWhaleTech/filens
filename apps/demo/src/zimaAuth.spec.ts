import { describe, expect, it } from 'vitest';
import { getLoginPath, getLoginUrl } from './zimaAuth';

describe('ZimaOS login redirect', () => {
  it('builds the host router path with the current FiLens URL', () => {
    expect(getLoginPath('http://10.0.0.89/modules/filens/')).toBe(
      '/login?redirect=http://10.0.0.89/modules/filens/'
    );
  });

  it('matches the Photos root hash login URL', () => {
    expect(getLoginUrl('http://10.0.0.89/modules/filens/')).toBe(
      'http://10.0.0.89/#/login?redirect=http://10.0.0.89/modules/filens/'
    );
  });

  it('encodes non-ASCII redirect URLs', () => {
    expect(getLoginUrl('http://10.0.0.89/modules/filens/?name=测试')).toBe(
      'http://10.0.0.89/?name=%E6%B5%8B%E8%AF%95#/login?redirect=http://10.0.0.89/modules/filens/?name=%25E6%25B5%258B%25E8%25AF%2595'
    );
  });
});
