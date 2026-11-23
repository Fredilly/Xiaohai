import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readI111RequireNewDatabaseConfig } from './i111-require-new-database-guard.js';

const runId = 'a1b2c3d4e5f6';
const databaseName = `xiaohai_i111_require_new_${runId}`;
const localUrl = `postgresql://xiaohai_i111_require_new_test:fixture@127.0.0.1:55491/${databaseName}`;
const safe = {
  APP_ENV: 'dev',
  DATABASE_URL: localUrl,
  I111_REQUIRE_NEW_EXPECTED_DATABASE_OID: '24576',
  I111_REQUIRE_NEW_EXPECTED_SERVER_ADDRESS: '172.18.0.2',
  I111_REQUIRE_NEW_EXPECTED_SERVER_PORT: '5432',
  I111_REQUIRE_NEW_EXPECTED_SERVER_VERSION: '17.7',
  I111_REQUIRE_NEW_EXPECTED_SYSTEM_IDENTIFIER: '7523456789012345678',
  I111_REQUIRE_NEW_PG_TEST: '1',
  I111_REQUIRE_NEW_TEST_RUN_ID: runId,
  NODE_ENV: 'test',
  TEST_DATABASE_URL: localUrl,
};

function rejected(overrides: Record<string, string | undefined>) {
  expect(() => readI111RequireNewDatabaseConfig({ ...safe, ...overrides })).toThrow(
    'I111_REQUIRE_NEW_DATABASE_GUARD_STOP',
  );
}

describe('I111 REQUIRE_NEW disposable PostgreSQL guard', () => {
  it('skips only when no I111 integration activation field is configured', () => {
    expect(
      readI111RequireNewDatabaseConfig({
        DATABASE_URL: 'postgresql://ordinary:secret@127.0.0.1:5432/xiaohai_test',
        NODE_ENV: 'test',
      }),
    ).toBeNull();
  });

  it('accepts a complete dedicated one-time identity without retaining credentials', () => {
    expect(readI111RequireNewDatabaseConfig(safe)).toEqual({
      databaseName,
      databaseComment: `xiaohai-i111-require-new-disposable:${runId}`,
      expectedDatabaseOid: 24576,
      expectedServerAddress: '172.18.0.2',
      expectedServerPort: 5432,
      expectedServerVersion: '17.7',
      expectedSystemIdentifier: '7523456789012345678',
      runId,
    });
  });

  it.each([
    ['partial activation', { I111_REQUIRE_NEW_PG_TEST: undefined }],
    ['unsafe app environment', { APP_ENV: 'staging' }],
    ['unsafe node environment', { NODE_ENV: 'production' }],
    ['mismatched effective URL', { TEST_DATABASE_URL: localUrl.replace('55491', '55492') }],
    [
      'remote host',
      {
        DATABASE_URL: localUrl.replace('127.0.0.1', 'db.example.com'),
        TEST_DATABASE_URL: localUrl.replace('127.0.0.1', 'db.example.com'),
      },
    ],
    [
      'default PostgreSQL port',
      {
        DATABASE_URL: localUrl.replace('55491', '5432'),
        TEST_DATABASE_URL: localUrl.replace('55491', '5432'),
      },
    ],
    [
      'original I111 fixed port',
      {
        DATABASE_URL: localUrl.replace('55491', '52511'),
        TEST_DATABASE_URL: localUrl.replace('55491', '52511'),
      },
    ],
    [
      'wrong role',
      {
        DATABASE_URL: localUrl.replace('xiaohai_i111_require_new_test', 'postgres'),
        TEST_DATABASE_URL: localUrl.replace('xiaohai_i111_require_new_test', 'postgres'),
      },
    ],
    [
      'malformed encoded role',
      {
        DATABASE_URL: localUrl.replace('xiaohai_i111_require_new_test', '%E0%A4%A'),
        TEST_DATABASE_URL: localUrl.replace('xiaohai_i111_require_new_test', '%E0%A4%A'),
      },
    ],
    [
      'original I111 database',
      {
        DATABASE_URL: localUrl.replace(databaseName, 'xiaohai_i111_mac_20261116'),
        TEST_DATABASE_URL: localUrl.replace(databaseName, 'xiaohai_i111_mac_20261116'),
      },
    ],
    [
      'staging database',
      {
        DATABASE_URL: localUrl.replace(databaseName, 'xiaohai_staging'),
        TEST_DATABASE_URL: localUrl.replace(databaseName, 'xiaohai_staging'),
      },
    ],
    [
      'URL parameters',
      {
        DATABASE_URL: `${localUrl}?sslmode=disable`,
        TEST_DATABASE_URL: `${localUrl}?sslmode=disable`,
      },
    ],
    ['short run ID', { I111_REQUIRE_NEW_TEST_RUN_ID: 'short' }],
    ['missing database OID', { I111_REQUIRE_NEW_EXPECTED_DATABASE_OID: undefined }],
    ['invalid server address', { I111_REQUIRE_NEW_EXPECTED_SERVER_ADDRESS: 'localhost' }],
    ['invalid system identifier', { I111_REQUIRE_NEW_EXPECTED_SYSTEM_IDENTIFIER: 'unknown' }],
    ['wrong PostgreSQL major', { I111_REQUIRE_NEW_EXPECTED_SERVER_VERSION: '16.9' }],
  ])('rejects %s', (_name, overrides) => rejected(overrides));

  it('keeps the integration suite opt-in, pre-connection guarded and non-destructive', () => {
    const source = readFileSync(
      new URL('i111-require-new.integration.test.ts', import.meta.url),
      'utf8',
    );
    expect(source.indexOf('readI111RequireNewDatabaseConfig(process.env)')).toBeGreaterThanOrEqual(
      0,
    );
    expect(source.indexOf('createDatabase(process.env)')).toBeGreaterThan(
      source.indexOf('readI111RequireNewDatabaseConfig(process.env)'),
    );
    expect(source.indexOf('await verifyDisposableIdentity')).toBeLessThan(
      source.indexOf('await seedFixture'),
    );
    expect(source).not.toMatch(/\b(?:TRUNCATE|DROP TABLE|CREATE DATABASE)\b/iu);
    expect(source).not.toContain('.delete(');
    expect(source).not.toContain('provider.generate');
    expect(source).not.toContain('processOne(');
  });
});
