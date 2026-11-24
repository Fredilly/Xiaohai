import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectI111Database } from './i111-readonly-runtime-preflight.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const enabled = process.env.I111_DISPOSABLE_DATABASE === 'YES';
const integration = enabled ? test : test.skip;
const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { drizzle } = requireFromDb('drizzle-orm/node-postgres');
const { migrate } = requireFromDb('drizzle-orm/node-postgres/migrator');
const migrationsFolder = fileURLToPath(new URL('../packages/db/migrations/', import.meta.url));
const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8'));
const migrations = journal.entries.map((entry) => ({
  tag: entry.tag,
  hash: createHash('sha256')
    .update(readFileSync(`${migrationsFolder}/${entry.tag}.sql`))
    .digest('hex'),
  createdAt: String(entry.when),
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
  const migrationPool = new pg.Pool({ connectionString: appUrl.toString(), max: 1 });
  await migrate(drizzle(migrationPool), { migrationsFolder });
  await migrationPool.end();
  await owner.connect();
  try {
    await owner.query(`
      INSERT INTO consumer_users (id) VALUES ('${scope.ownerId}');
      INSERT INTO ai_projects (id, project_type, title, created_by_consumer_user_id)
        VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'STORY', 'fixture', '${scope.ownerId}');
      INSERT INTO ai_jobs
        (id, project_id, job_type, provider, model, status, input, max_attempts, timeout_ms)
        VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'STORY_OUTLINE', 'MOCK', 'fixture',
         'SUCCEEDED', '{"prompt":"fixture"}'::jsonb, 1, 30000);
      INSERT INTO works
        (id, consumer_user_id, ai_project_id, work_type, title, idea, age_range, theme, style)
        VALUES
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${scope.ownerId}',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'STORY', 'fixture', 'fixture',
         '3-6', 'fixture', 'fixture');
      INSERT INTO work_versions
        (id, work_id, version_number, content_kind, operation, source_ai_job_id, content)
        VALUES
        ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
         'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 1, 'OUTLINE', 'OUTLINE',
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fixture');
      INSERT INTO picture_books
        (id, consumer_user_id, ai_project_id, story_work_id, source_story_version_id,
         title, status, layout_preset)
        VALUES
        ('${scope.bookId}', '${scope.ownerId}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
         'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
         'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'fixture', 'PLANNED', 'AUTO');
    `);
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
        `INSERT INTO media_assets
          (id, provider, status, mime_type, object_key, playback_url, byte_size)
         VALUES ($1,'BAIDU_BOS','READY','image/png',$2,$3,$4)`,
        [
          character.media,
          key,
          `https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/${key}`,
          character.bytes,
        ],
      );
      await owner.query(
        `INSERT INTO character_profiles
          (id, picture_book_id, name, role, description, visual_prompt, confirmed, locked,
           reference_media_asset_id, sort_order)
         VALUES ($1,$2,$3,'MAIN','fixture','fixture',true,true,$5,$4)`,
        [character.id, scope.bookId, character.name, character.sort, character.media],
      );
      await owner.query(
        `INSERT INTO character_reference_images
          (id, character_profile_id, media_asset_id, revision_number, status, provider, model)
         VALUES ($1,$2,$3,1,'READY','IMPORTED','imported-fixture')`,
        [character.reference, character.id, character.media],
      );
    }
    for (const [id, number, kind] of [
      [scope.coverId, 0, 'COVER'],
      [scope.page1Id, 1, 'CONTENT'],
      [scope.page2Id, 2, 'CONTENT'],
    ]) {
      await owner.query(
        `INSERT INTO work_pages
          (id, picture_book_id, page_number, page_kind, story_text, source_ai_job_id, character_ids)
         VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
        [
          id,
          scope.bookId,
          number,
          kind,
          kind === 'CONTENT' ? 'fixture' : null,
          characters.map((character) => character.id),
        ],
      );
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
