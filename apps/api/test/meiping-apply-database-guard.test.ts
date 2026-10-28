import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const local = 'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_test';
const sandbox = 'postgresql://postgres:fixture@localhost:5432/xiaohai_pr162_security_test';
const safeEnv = {
  DATABASE_URL: local,
  TEST_DATABASE_URL: local,
  NODE_ENV: 'test',
  APP_ENV: 'dev',
};

const rejectedMessage = 'local allowlisted disposable test database';

function expectRejected(env: Parameters<typeof assertMeipingApplyDisposableDatabase>[0]) {
  expect(() => assertMeipingApplyDisposableDatabase(env)).toThrow(rejectedMessage);
}

describe('Meiping apply integration disposable database guard', () => {
  it('skips only when no database is configured', () => {
    expect(assertMeipingApplyDisposableDatabase({ NODE_ENV: 'test' })).toBe(false);
  });

  for (const url of [local, sandbox]) {
    it('accepts allowlisted local database ' + url, () => {
      const env = { ...safeEnv, DATABASE_URL: url, TEST_DATABASE_URL: url };
      expect(assertMeipingApplyDisposableDatabase(env)).toBe(true);
    });
  }

  const deniedUrls = [
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
  ];

  for (const url of deniedUrls) {
    it('rejects unsafe database URL ' + url, () => {
      expectRejected({ ...safeEnv, DATABASE_URL: url });
    });
  }

  it('rejects a production TEST_DATABASE_URL', () => {
    const url = 'postgresql://postgres:fixture@127.0.0.1:5432/xiaohai_prod';
    expectRejected({ ...safeEnv, TEST_DATABASE_URL: url });
  });

  it('rejects a different allowlisted TEST_DATABASE_URL', () => {
    expectRejected({ ...safeEnv, TEST_DATABASE_URL: sandbox });
  });

  it('rejects a missing effective TEST_DATABASE_URL', () => {
    expectRejected({ ...safeEnv, TEST_DATABASE_URL: undefined });
  });

  const unsafeEnvironments = [
    { NODE_ENV: 'production', APP_ENV: 'dev' },
    { NODE_ENV: 'test', APP_ENV: 'production' },
    { NODE_ENV: 'test', APP_ENV: 'staging' },
  ];

  for (const values of unsafeEnvironments) {
    it('rejects unsafe environment ' + JSON.stringify(values), () => {
      expectRejected({ ...safeEnv, ...values });
    });
  }

  const guardedSuites = [
    'meiping-apply.integration.test.ts',
    'meiping-apply-safety.integration.test.ts',
    'meiping-apply-http.integration.test.ts',
  ];

  for (const file of guardedSuites) {
    it('checks database target before connecting in ' + file, () => {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const guard = 'assertMeipingApplyDisposableDatabase(process.env)';
      const connection = 'createDatabase(process.env)';
      expect(source.indexOf(guard)).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(connection)).toBeGreaterThan(source.indexOf(guard));
      expect(source).not.toContain('process.env.DATABASE_URL ? createDatabase(process.env)');
    });
  }
});
