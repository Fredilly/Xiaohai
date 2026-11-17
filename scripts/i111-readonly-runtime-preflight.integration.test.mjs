import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectI111Database } from './i111-readonly-runtime-preflight.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const enabled = process.env.I111_DISPOSABLE_DATABASE === 'YES';
const integration = enabled ? test : test.skip;
const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));
const migrations = Array.from({ length: 42 }, (_, index) => ({
  tag: `${String(index).padStart(4, '0')}_synthetic`,
  hash: String(index).padStart(64, '0'),
  createdAt: String(1_790_000_000_000 + index),
}));

function guardedUrl(raw, database, user) {
  const url = new URL(raw ?? '');
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55437');
  assert.equal(url.pathname, `/${database}`);
  assert.equal(url.username, user);
  assert.ok(url.password);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url;
}

integration('runs the collector against an explicitly guarded disposable PostgreSQL', async () => {
  const adminUrl = guardedUrl(process.env.I111_DISPOSABLE_ADMIN_URL, 'postgres', 'postgres');
  const appUrl = guardedUrl(
    process.env.I111_DISPOSABLE_DATABASE_URL,
    scope.databaseName,
    'xiaohai_i111_app',
  );
  assert.equal(adminUrl.port, appUrl.port);
  assert.equal(decodeURIComponent(adminUrl.password), 'synthetic-admin-password');
  assert.equal(decodeURIComponent(appUrl.password), 'synthetic-app-password');
  const pg = requireFromDb('pg');
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      scope.databaseName,
    ]);
    assert.equal(existing.rowCount, 0, 'disposable database must start absent');
    const password = admin.escapeLiteral(decodeURIComponent(appUrl.password));
    await admin.query(
      `CREATE ROLE xiaohai_i111_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${password}`,
    );
    await admin.query(`CREATE DATABASE ${scope.databaseName} OWNER xiaohai_i111_app`);
  } finally {
    await admin.end();
  }

  const owner = new pg.Client({ connectionString: appUrl.toString() });
  await owner.connect();
  try {
    await owner.query(`
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at numeric);
      CREATE TABLE picture_books (id uuid PRIMARY KEY, consumer_user_id uuid, ai_project_id uuid, status text);
      CREATE TABLE work_pages (id uuid PRIMARY KEY, picture_book_id uuid, page_number integer, page_kind text, source_ai_job_id uuid, character_ids uuid[]);
      CREATE TABLE media_assets (id uuid PRIMARY KEY, provider text, status text, mime_type text, object_key text, playback_url text, byte_size integer);
      CREATE TABLE character_profiles (id uuid PRIMARY KEY, picture_book_id uuid, name text, sort_order integer, confirmed boolean, locked boolean, reference_media_asset_id uuid);
      CREATE TABLE character_reference_images (id uuid PRIMARY KEY, character_profile_id uuid, media_asset_id uuid, status text, provider text);
      CREATE TABLE ai_jobs (id uuid PRIMARY KEY, status text);
      CREATE TABLE work_page_illustrations (id uuid PRIMARY KEY, page_id uuid, revision_number integer, provider text, model text, status text, media_asset_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE ai_cost_reservations (id uuid PRIMARY KEY, budget_key text, window_key text, consumer_user_id uuid, resource_type text, resource_id uuid, status text, uncertainty text, provider text, model text, reserved_minor integer, actual_minor integer, provider_request_id text, created_at timestamptz DEFAULT now());
      CREATE TABLE ai_cost_ledger (id uuid PRIMARY KEY, reservation_id uuid, consumer_user_id uuid, resource_type text, resource_id uuid, provider text, model text, outcome text, amount_minor integer, usage text, provider_request_id text, created_at timestamptz DEFAULT now());
      CREATE TABLE ai_budget_windows (id uuid PRIMARY KEY, budget_key text, window_key text, scope_type text, consumer_user_id uuid, limit_minor integer, reserved_minor integer, actual_minor integer, created_at timestamptz DEFAULT now());
    `);
    for (const migration of migrations) {
      await owner.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.createdAt],
      );
    }
    await owner.query(`INSERT INTO picture_books VALUES ($1,$2,$3,'PLANNED')`, [
      scope.bookId,
      scope.ownerId,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]);
    const characters = [
      {
        id: 'de0169d8-d975-4f1b-b04c-a15c25f54bdc',
        name: 'Mimi',
        reference: 'fa526d14-9fc4-4cba-bf3e-ae9c8a888906',
        media: '10000000-0000-4000-8000-000000000001',
        digest: 'a50abb6b7195a2be7886b47351f259c930aca36ebacec500b6fbfab65136f304',
        bytes: 1_843_161,
        sort: 0,
      },
      {
        id: '249a719e-d284-46e0-a525-285e93270248',
        name: 'Pip',
        reference: 'bed51270-3add-4d10-93fb-8ffa085ff7a7',
        media: '20000000-0000-4000-8000-000000000002',
        digest: 'af3845b30a28a82c7cbcc491b76c1291355009c347274437ff23968ee144c06d',
        bytes: 738_959,
        sort: 1,
      },
    ];
    for (const character of characters) {
      const key = `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/${character.id}/${character.digest}.png`;
      await owner.query(
        `INSERT INTO media_assets VALUES ($1,'BAIDU_BOS','READY','image/png',$2,$3,$4)`,
        [
          character.media,
          key,
          `https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/${key}`,
          character.bytes,
        ],
      );
      await owner.query(`INSERT INTO character_profiles VALUES ($1,$2,$3,$4,true,true,$5)`, [
        character.id,
        scope.bookId,
        character.name,
        character.sort,
        character.media,
      ]);
      await owner.query(
        `INSERT INTO character_reference_images VALUES ($1,$2,$3,'READY','IMPORTED')`,
        [character.reference, character.id, character.media],
      );
    }
    for (const [id, number, kind] of [
      [scope.coverId, 0, 'COVER'],
      [scope.page1Id, 1, 'CONTENT'],
      [scope.page2Id, 2, 'CONTENT'],
    ]) {
      await owner.query(`INSERT INTO work_pages VALUES ($1,$2,$3,$4,NULL,$5)`, [
        id,
        scope.bookId,
        number,
        kind,
        characters.map((character) => character.id),
      ]);
    }
  } finally {
    await owner.end();
  }

  const result = await collectI111Database(
    appUrl.toString(),
    (connectionString) =>
      new pg.Client({
        connectionString,
        options: '-c default_transaction_read_only=on',
      }),
    migrations,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.dbIdentityVerified, true);
  assert.equal(result.migrationsVerified, true);
  assert.equal(result.referenceMetadataVerified, true);
});
