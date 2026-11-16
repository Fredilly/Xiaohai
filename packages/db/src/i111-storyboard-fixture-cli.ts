/**
 * #111 isolated Mac Plan B ONLY. Manual, one-time fixture insert. No AI job,
 * provider call, queue notification, migration, or other database target.
 *
 * Default --plan runs in a transaction that always ROLLBACKs. --apply requires
 * a separately reviewed code version, backup evidence and explicit opt-in.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  createI111FixturePages,
  I111_BOOK_ID,
  I111_DATABASE,
  I111_OWNER_ID,
  matchExistingI111Pages,
} from './i111-storyboard-fixture.js';

type RawPage = {
  page_number: number;
  page_kind: string;
  story_text: string | null;
  scene_description: string | null;
  illustration_prompt: string | null;
  character_ids: string[];
  source_ai_job_id: string | null;
};
type Book = { id: string; consumer_user_id: string; ai_project_id: string; status: string; layout_preset: string };
type Character = {
  id: string;
  name: string;
  confirmed: boolean;
  locked: boolean;
  reference_media_asset_id: string | null;
  media_status: string;
  media_provider: string;
  mime_type: string;
};

function fail(code: string): never {
  throw new Error(code);
}

function validateLocalTarget(env: NodeJS.ProcessEnv) {
  if (env.APP_ENV !== 'dev' || env.NODE_ENV === 'production' || env.NODE_ENV === 'test') {
    fail('I111_ENVIRONMENT_NOT_DEV');
  }
  if (!env.DATABASE_URL) fail('I111_DATABASE_URL_MISSING');
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    fail('I111_DATABASE_URL_INVALID');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '52511' ||
    url.pathname !== '/' + I111_DATABASE ||
    decodeURIComponent(url.username) !== 'xiaohai_i111_app' ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    fail('I111_DATABASE_ALLOWLIST_REJECTED');
  }
  return env.DATABASE_URL;
}

async function run() {
  const mode = process.argv.slice(2);
  if (mode.length !== 1 || !['--plan', '--apply'].includes(mode[0]!)) {
    fail('I111_EXPLICIT_PLAN_OR_APPLY_REQUIRED');
  }
  const apply = mode[0] === '--apply';
  if (
    apply &&
    (process.env.I111_STORYBOARD_APPLY_AUTHORIZATION !== 'I111_MAC_PLAN_B_PAGES_0_1_2_ONLY' ||
      process.env.I111_BACKUP_VERIFIED !== 'YES')
  ) {
    fail('I111_APPLY_APPROVAL_OR_BACKUP_MISSING');
  }

  const connectionString = validateLocalTarget(process.env);
  // Script is run from its TypeScript source via tsx; fail if the fixed fixture
  // cannot be loaded from the reviewed repository path.
  const fixturePath = fileURLToPath(
    new URL('../../../benchmarks/picture-book-quality/FIXTURE.json', import.meta.url),
  );
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
  const client = new pg.Client({
    connectionString,
    ssl: false,
    connectionTimeoutMillis: 3_000,
    query_timeout: 8_000,
  });
  let inTransaction = false;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    inTransaction = true;
    await client.query("SET LOCAL lock_timeout = '2500ms'");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const identity = await client.query<{
      db_name: string;
      db_user: string;
      is_replica: boolean;
    }>(
      'SELECT current_database() AS db_name, current_user AS db_user, pg_is_in_recovery() AS is_replica',
    );
    if (
      identity.rows[0]?.db_name !== I111_DATABASE ||
      identity.rows[0]?.db_user !== 'xiaohai_i111_app' ||
      identity.rows[0]?.is_replica !== false
    ) {
      fail('I111_CONNECTED_DATABASE_IDENTITY_MISMATCH');
    }
    const migration = await client.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM drizzle.__drizzle_migrations',
    );
    if (migration.rows[0]?.total !== '42') fail('I111_MIGRATION_JOURNAL_MISMATCH');

    const lockedBook = await client.query<Book>(
      'SELECT id, consumer_user_id, ai_project_id, status, layout_preset FROM picture_books WHERE id = $1 AND consumer_user_id = $2 FOR UPDATE',
      [I111_BOOK_ID, I111_OWNER_ID],
    );
    if (lockedBook.rows.length !== 1) fail('I111_OWNER_BOOK_MISMATCH');
    const book = lockedBook.rows[0]!;
    if (!['DRAFT', 'PLANNED'].includes(book.status)) fail('I111_BOOK_STATE_MISMATCH');

    const characters = await client.query<Character>(
      [
        'SELECT c.id, c.name, c.confirmed, c.locked, c.reference_media_asset_id,',
        'm.status AS media_status, m.provider AS media_provider, m.mime_type',
        'FROM character_profiles c',
        'JOIN media_assets m ON m.id = c.reference_media_asset_id',
        'WHERE c.picture_book_id = $1 ORDER BY c.sort_order',
      ].join(' '),
      [I111_BOOK_ID],
    );
    const c = characters.rows;
    if (
      c.length !== 2 ||
      c[0]?.name !== 'Mimi' ||
      c[1]?.name !== 'Pip' ||
      c.some(
        (character) =>
          !character.confirmed ||
          !character.locked ||
          !character.reference_media_asset_id ||
          character.media_status !== 'READY' ||
          character.media_provider !== 'BAIDU_BOS' ||
          character.mime_type !== 'image/png',
      )
    ) {
      fail('I111_LOCKED_REFERENCES_MISMATCH');
    }

    const fixturePages = createI111FixturePages(fixture, { mimi: c[0]!.id, pip: c[1]!.id });
    const activeJobs = await client.query(
      "SELECT id FROM ai_jobs WHERE project_id = $1 AND status IN ('QUEUED','RUNNING') LIMIT 1",
      [book.ai_project_id],
    );
    if (activeJobs.rows.length) fail('I111_ACTIVE_AI_JOB_EXISTS');
    const currentPages = await client.query<RawPage>(
      [
        'SELECT page_number, page_kind, story_text, scene_description,',
        'illustration_prompt, character_ids, source_ai_job_id',
        'FROM work_pages WHERE picture_book_id = $1 ORDER BY page_number',
      ].join(' '),
      [I111_BOOK_ID],
    );
    const existingIllustrations = await client.query<{ total: string }>(
      [
        'SELECT count(*)::text AS total FROM work_page_illustrations',
        'WHERE page_id IN (SELECT id FROM work_pages WHERE picture_book_id = $1)',
      ].join(' '),
      [I111_BOOK_ID],
    );
    if (existingIllustrations.rows[0]?.total !== '0') fail('I111_EXISTING_ILLUSTRATIONS');

    if (currentPages.rows.length) {
      if (
        book.status !== 'PLANNED' ||
        !matchExistingI111Pages(currentPages.rows, fixturePages)
      ) {
        fail('I111_EXISTING_PAGES_CONFLICT');
      }
      await client.query('ROLLBACK');
      inTransaction = false;
      console.log(JSON.stringify({ result: 'ALREADY_APPLIED_NO_WRITE', pages: [0, 1, 2] }));
      return;
    }
    if (book.status !== 'DRAFT') fail('I111_BOOK_NOT_DRAFT');
    if (!apply) {
      await client.query('ROLLBACK');
      inTransaction = false;
      console.log(JSON.stringify({ result: 'PLAN_PASS_NO_WRITE', pages: [0, 1, 2] }));
      return;
    }

    const inserted = [];
    for (const page of fixturePages) {
      const result = await client.query<{ id: string }>(
        [
          'INSERT INTO work_pages',
          '(picture_book_id, page_number, page_kind, story_text, scene_description,',
          'illustration_prompt, character_ids, layout_preset, source_ai_job_id)',
          'VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8,NULL) RETURNING id',
        ].join(' '),
        [
          book.id,
          page.pageNumber,
          page.pageKind,
          page.storyText,
          page.sceneDescription,
          page.illustrationPrompt,
          page.characterIds,
          book.layout_preset,
        ],
      );
      if (result.rows.length !== 1) fail('I111_INSERT_COUNT_INVALID');
      inserted.push(result.rows[0]!.id);
    }
    const updated = await client.query(
      "UPDATE picture_books SET status = 'PLANNED', updated_at = now() WHERE id = $1 AND status = 'DRAFT' RETURNING id",
      [I111_BOOK_ID],
    );
    if (updated.rows.length !== 1 || inserted.length !== 3) {
      fail('I111_ATOMIC_UPDATE_FAILED');
    }
    await client.query('COMMIT');
    inTransaction = false;
    console.log(
      JSON.stringify({
        result: 'APPLIED_ONCE',
        bookId: I111_BOOK_ID,
        pages: [0, 1, 2].map((pageNumber, i) => ({ pageNumber, pageId: inserted[i] })),
        noAiJobCreated: true,
        noProviderCall: true,
      }),
    );
  } finally {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Connection failure still prevents a successful commit.
      }
    }
    await client.end().catch(() => undefined);
  }
}

run().catch((error: unknown) => {
  const safe =
    error instanceof Error && /^I111_[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'I111_UNEXPECTED_FAILURE';
  console.error('I111_STOP:' + safe);
  process.exitCode = 1;
});
