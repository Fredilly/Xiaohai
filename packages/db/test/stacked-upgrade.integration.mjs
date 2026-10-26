// Verifies the real 0036 -> latest migration path against a disposable CI database.
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
let closing = false;
let unexpectedPoolError;

try {
  await control.query('CREATE DATABASE "xiaohai_ci_0036_upgrade"');
  databaseCreated = true;
  mkdirSync(join(folder, 'meta'));
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8'));
  const initial = journal.entries.filter((entry) => entry.idx <= 36);
  // 0037 retains its historical out-of-order timestamp; Drizzle records the
  // repair path once, so the applied count is one less than journal entries.
  if (
    initial.length !== 37 ||
    journal.entries.find(
      (entry) => entry.tag === '0038_store_catalog_direct_edit_upgrade_repair',
    ) === undefined
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
  // DROP DATABASE WITH FORCE may close idle clients during cleanup. Treat
  // SQLSTATE 57P01 as expected ONLY during teardown; preserve other errors.
  targetPool.on('error', (error) => {
    if (!closing || error.code !== '57P01') unexpectedPoolError = error;
  });
  const db = drizzle(targetPool);
  await migrate(db, { migrationsFolder: folder });
  const before = await targetPool.query(
    "SELECT to_regclass('public.store_catalog_metadata') IS NOT NULL AS present",
  );
  if (before.rows[0]?.present !== false) {
    throw new Error('EXPECTED_0036_TO_HAVE_NO_STORE_CATALOG_METADATA');
  }

  // Seed real pre-0039 mutable decision/correction rows in the isolated
  // 0036 schema. 0039 MUST preserve this exact current version and actor.
  const [actor] = (
    await targetPool.query(
      "INSERT INTO staff_accounts (login_identifier, password_hash) VALUES ('ci-history-0039@example.invalid', 'ci-fixture-only') RETURNING id",
    )
  ).rows;
  const [region] = (
    await targetPool.query(
      "INSERT INTO regions (code, name, country_code, country_name) VALUES ('CI-HISTORY-0039', 'History test region', 'CN', 'China') RETURNING id",
    )
  ).rows;
  const [store] = (
    await targetPool.query(
      `INSERT INTO stores
        (code, region_id, name, country_code, country_name, city, timezone, address_line, latitude, longitude)
       VALUES ('CI-HISTORY-0039-STORE', $1, 'History store', 'CN', 'China', 'Chengdu', 'Asia/Shanghai', 'Test fixture', 30, 104)
       RETURNING id`,
      [region.id],
    )
  ).rows;
  const [session] = (
    await targetPool.query(
      `INSERT INTO meiping_review_sessions (store_id, source_checksum, report, created_by_staff_account_id)
       VALUES ($1, repeat('a', 64), '{}'::jsonb, $2) RETURNING id`,
      [store.id, actor.id],
    )
  ).rows;
  await targetPool.query(
    `INSERT INTO meiping_review_decisions
      (session_id, source_row_number, action, counted_quantity, reason, version, updated_by_staff_account_id, updated_at)
      VALUES ($1, 7, 'EXCLUDE', NULL, 'CI preserved decision', 2, $2, '2026-09-30T00:00:00Z')`,
    [session.id, actor.id],
  );
  await targetPool.query(
    `INSERT INTO meiping_review_corrections
      (session_id, source_row_number, proposed_fields, reason, version, updated_by_staff_account_id, updated_at)
      VALUES ($1, 7, '{"title":"CI previous correction"}'::jsonb, 'CI preserved correction', 3, $2, '2026-09-30T01:00:00Z')`,
    [session.id, actor.id],
  );

  await migrate(db, { migrationsFolder: source });
  const snapshots = await targetPool.query(
    `SELECT
      (SELECT count(*)::int FROM meiping_review_decision_history
        WHERE session_id = $1 AND source_row_number = 7 AND version = 2
          AND action = 'EXCLUDE' AND reason = 'CI preserved decision'
          AND counted_quantity IS NULL AND updated_by_staff_account_id = $2
          AND updated_at = '2026-09-30T00:00:00Z') AS matching_decisions,
      (SELECT count(*)::int FROM meiping_review_correction_history
        WHERE session_id = $1 AND source_row_number = 7 AND version = 3
          AND reason = 'CI preserved correction'
          AND proposed_fields = '{"title":"CI previous correction"}'::jsonb
          AND updated_by_staff_account_id = $2
          AND updated_at = '2026-09-30T01:00:00Z') AS matching_corrections,
      (SELECT count(*)::int FROM inventory_transactions) AS inventory_transactions`,
    [session.id, actor.id],
  );
  if (
    snapshots.rows[0]?.matching_decisions !== 1 ||
    snapshots.rows[0]?.matching_corrections !== 1 ||
    snapshots.rows[0]?.inventory_transactions !== 0
  ) {
    throw new Error('MIGRATION_0039_BACKFILL_MISMATCH');
  }
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
    state.migrated_count !== journal.entries.length - 1
  ) {
    throw new Error('UPGRADE_0038_DID_NOT_REPAIR_STORE_CATALOG_SCHEMA');
  }

  await migrate(db, { migrationsFolder: source });
  const noDuplicates = await targetPool.query(
    `SELECT
      (SELECT count(*)::int FROM meiping_review_decision_history
        WHERE session_id = $1 AND source_row_number = 7) AS decisions,
      (SELECT count(*)::int FROM meiping_review_correction_history
        WHERE session_id = $1 AND source_row_number = 7) AS corrections`,
    [session.id],
  );
  if (noDuplicates.rows[0]?.decisions !== 1 || noDuplicates.rows[0]?.corrections !== 1) {
    throw new Error('MIGRATION_0039_RERUN_DUPLICATED_BACKFILL');
  }
  const same = await targetPool.query(
    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
  );
  if (same.rows[0]?.count !== journal.entries.length - 1) {
    throw new Error('UPGRADE_MIGRATION_RERAN_UNEXPECTEDLY');
  }
  console.log(
    `PASS: disposable 0036→latest upgrade repaired direct-edit schema/permissions; ${journal.entries.length - 1} applied migrations and rerun did not reapply migrations.`,
  );
} finally {
  closing = true;
  if (targetPool) await targetPool.end();
  if (databaseCreated) {
    await control.query('DROP DATABASE "xiaohai_ci_0036_upgrade" WITH (FORCE)');
  }
  await control.end();
  rmSync(folder, { recursive: true, force: true });
  if (unexpectedPoolError) throw unexpectedPoolError;
}
