// Verifies the real 0036 -> 0038 migration path against a disposable CI database.
// Never run on a developer, staging or production database.
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const url = new URL(input);
if (
  process.env.CI !== 'true' ||
  process.env.NODE_ENV !== 'test' ||
  process.env.APP_ENV !== 'dev' ||
  url.hostname !== '127.0.0.1' ||
  url.pathname !== '/xiaohai_test'
) {
  throw new Error('UPGRADE_TEST_REQUIRES_DISPOSABLE_CI_XIAOHAI_TEST');
}

const databaseName = 'xiaohai_ci_0036_upgrade';
const controlUrl = new URL(url);
controlUrl.pathname = '/postgres';
const upgradeUrl = new URL(url);
upgradeUrl.pathname = '/' + databaseName;
const { Pool } = pg;
const control = new Pool({ connectionString: controlUrl.toString() });
const folder = mkdtempSync(join(tmpdir(), 'xiaohai-migration-0036-'));
const source = fileURLToPath(new URL('../migrations/', import.meta.url));
let targetPool;
let databaseCreated = false;

try {
  await control.query('CREATE DATABASE "xiaohai_ci_0036_upgrade"');
  databaseCreated = true;
  mkdirSync(join(folder, 'meta'));
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8'));
  const initial = journal.entries.filter((entry) => entry.idx <= 36);
  if (
    initial.length !== 37 ||
    journal.entries[38]?.tag !== '0038_store_catalog_direct_edit_upgrade_repair'
  ) {
    throw new Error('UNEXPECTED_MIGRATION_CHAIN');
  }
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: initial }),
  );
  for (const entry of initial) {
    copyFileSync(join(source, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  }

  targetPool = new Pool({ connectionString: upgradeUrl.toString() });
  const db = drizzle(targetPool);
  await migrate(db, { migrationsFolder: folder });
  const before = await targetPool.query(
    "SELECT to_regclass('public.store_catalog_metadata') IS NOT NULL AS present",
  );
  if (before.rows[0]?.present !== false) {
    throw new Error('EXPECTED_0036_TO_HAVE_NO_STORE_CATALOG_METADATA');
  }

  await migrate(db, { migrationsFolder: source });
  const result = await targetPool.query(`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'version'
          AND table_name IN ('books', 'book_editions', 'products', 'skus')) AS versions,
      to_regclass('public.store_catalog_metadata') IS NOT NULL AS local_table,
      (SELECT count(*)::int FROM pg_constraint
        WHERE conname IN (
          'books_version_nonnegative_check', 'book_editions_version_nonnegative_check',
          'products_version_nonnegative_check', 'skus_version_nonnegative_check'
        )) AS version_checks,
      (SELECT count(*)::int FROM permissions WHERE key = 'catalog.edit') AS edit_permission,
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrated_count
  `);
  const state = result.rows[0];
  if (
    state?.versions !== 4 ||
    state.local_table !== true ||
    state.version_checks !== 4 ||
    state.edit_permission !== 1 ||
    state.migrated_count !== 38
  ) {
    throw new Error('UPGRADE_0038_DID_NOT_REPAIR_STORE_CATALOG_SCHEMA');
  }

  await migrate(db, { migrationsFolder: source });
  const same = await targetPool.query(
    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
  );
  if (same.rows[0]?.count !== 38) {
    throw new Error('UPGRADE_MIGRATION_RERAN_UNEXPECTEDLY');
  }
  console.log(
    'PASS: disposable 0036→0038 upgrade repaired all direct-edit schema/permissions; rerun did not reapply migrations.',
  );
} finally {
  if (targetPool) await targetPool.end();
  if (databaseCreated) {
    await control.query('DROP DATABASE "xiaohai_ci_0036_upgrade" WITH (FORCE)');
  }
  await control.end();
  rmSync(folder, { recursive: true, force: true });
}
