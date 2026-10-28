import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const local = 'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_test';
const sandbox =
  'postgresql://postgres:fixture@localhost:5432/xiaohai_pr162_security_test';
const safeEnv = {
  DATABASE_URL: local,
  TEST_DATABASE_URL: local,
  NODE_ENV: 'test',
  APP_ENV: 'dev',
};

describe('Meiping apply integration disposable database guard', () => {
  it('skips only if no database was configured', () => {
    expect(assertMeipingApplyDisposableDatabase({ NODE_ENV: 'test' })).toBe(false);
  });

  it.each([local, sandbox])('permits explicitly allowlisted local disposable database %s', (url) => {
    expect(
      assertMeipingApplyDisposableDatabase({
        ...safeEnv,
        DATABASE_URL: url,
        TEST_DATABASE_URL: url,
      }),
    ).toBe(true);
  });

  it.each([
    'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_dev',
    'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_staging',
    'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_prod',
    'postgresql://postgres:fixture@127.0.0.1:5432/postgres',
    'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_pr162_security_test_backup',
    'postgresql://postgres:fixture@staging-db.example.com:5432/xiaohai_test',
    'postgresql://postgres:fixture@production-db.example.com:5432/xiaohai_test',
    'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_test?host=remote',
    'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_test/other',
    'not-a-postgresql-url',
  ])('rejects non-disposable, remote, ambiguous or malformed URL: %s', (url) => {
    expect(() =>
      assertMeipingApplyDisposableDatabase({ ...safeEnv, DATABASE_URL: url }),
    ).toThrow('local allowlisted disposable test database');
  });

  it('rejects a different effective TEST_DATABASE_URL before creating a pool', () => {
    expect(() =>
      assertMeipingApplyDisposableDatabase({
        ...safeEnv,
        TEST_DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_prod',
      }),
    ).toThrow('local allowlisted disposable test database');
    expect(() =>
      assertMeipingApplyDisposableDatabase({
        ...safeEnv,
        TEST_DATABASE_URL: sandbox,
      }),
    ).toThrow('local allowlisted disposable test database');
    expect(() =>
      assertMeipingApplyDisposableDatabase({ ...safeEnv, TEST_DATABASE_URL: undefined }),
    ).toThrow('local allowlisted disposable test database');
  });

  it.each([
    { NODE_ENV: 'production', APP_ENV: 'dev' },
    { NODE_ENV: 'test', APP_ENV: 'production' },
    { NODE_ENV: 'test', APP_ENV: 'staging' },
  ])('blocks production and staging environments even with a test-looking name: %j', (values) => {
    expect(() => assertMeipingApplyDisposableDatabase({ ...safeEnv, ...values })).toThrow(
      'local allowlisted disposable test database',
    );
  });

  it.each([
    'meiping-apply.integration.test.ts',
    'meiping-apply-safety.integration.test.ts',
    'meiping-apply-http.integration.test.ts',
  ])('requires the guard before database creation in %s', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const guard = 'assertMeipingApplyDisposableDatabase(process.env)';
    const connection = 'createDatabase(process.env)';
    expect(source.indexOf(guard)).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(connection)).toBeGreaterThan(source.indexOf(guard));
    expect(source).not.toContain('process.env.DATABASE_URL ? createDatabase(process.env)');
  });
});
