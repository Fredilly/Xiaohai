import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from './client.js';

describe('test database safety guard', () => {
  it('rejects the local development database', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://user:password@127.0.0.1:5432/xiaohai_dev'),
    ).toThrow('disposable test database');
  });

  it('rejects an unclassified database name', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://user:password@127.0.0.1:5432/xiaohai_local'),
    ).toThrow('disposable test database');
  });

  it('accepts a disposable test database', () => {
    const url = 'postgresql://user:password@127.0.0.1:5432/xiaohai_test';
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });
});
