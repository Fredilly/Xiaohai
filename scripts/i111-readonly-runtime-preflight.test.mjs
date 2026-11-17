import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runI111ReadonlyRuntimePreflight } from './i111-readonly-runtime-preflight.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const reviewedSha = 'a'.repeat(40);
const mimiId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pipId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mimiHash = 'a50abb6b7195a2be7886b47351f259c930aca36ebacec500b6fbfab65136f304';
const pipHash = 'af3845b30a28a82c7cbcc491b76c1291355009c347274437ff23968ee144c06d';
const bucket = 'xiaohai-i111-work-2ec3900280';
const slotMarker = JSON.stringify({
  benchmark: 'I111_MAC_PLAN_B',
  marker: 'PROVIDER_POST_SLOT_CONSUMED',
  inputImageCount: 2,
  outputImageCount: 1,
  expectedInputUnitMinor: 2,
  expectedOutputUnitMinor: 18,
  expectedChargeMinor: 22,
  actualChargeVerified: false,
});

function env() {
  return {
    APP_ENV: 'dev',
    DATABASE_URL:
      'postgresql://xiaohai_i111_app:synthetic-password@127.0.0.1:52511/xiaohai_i111_mac_20261116',
    I111_REVIEWED_SHA: reviewedSha,
    PICTURE_BOOK_IMAGE_ENABLED: 'true',
    PICTURE_BOOK_IMAGE_PROVIDER: 'BAILIAN',
    PICTURE_BOOK_IMAGE_MODEL: 'qwen-image-3.0',
    PICTURE_BOOK_IMAGE_TIMEOUT_MS: '600000',
    DASHSCOPE_WORKSPACE_ID: 'ws-synthetic123',
    PICTURE_BOOK_IMAGE_BASE_URL:
      'https://ws-synthetic123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    DASHSCOPE_API_KEY: 'synthetic-dashscope-key',
    PICTURE_BOOK_IMAGE_BUDGET_ENABLED: 'true',
    PICTURE_BOOK_IMAGE_BUDGET_KEY: scope.budgetKey,
    PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY: scope.windowKey,
    PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR: '25',
    PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR: '200',
    PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR: '200',
    BAIDU_BOS_ENDPOINT: 'https://cd.bcebos.com',
    BAIDU_BOS_PUBLIC_ORIGIN: `https://${bucket}.cd.bcebos.com/`,
    BAIDU_BOS_BUCKET: bucket,
    BAIDU_BOS_ACCESS_KEY_ID: 'synthetic-bos-access-key',
    BAIDU_BOS_SECRET_ACCESS_KEY: 'synthetic-bos-secret-key',
  };
}

function baseRows() {
  const objectKey = (id, digest) =>
    `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/${id}/${digest}.png`;
  return {
    identity: [
      {
        database_name: scope.databaseName,
        database_user: 'xiaohai_i111_app',
        transaction_read_only: 'on',
        is_replica: false,
      },
    ],
    migrations: Array.from({ length: 42 }, (_, index) => ({
      created_at: String(1_790_000_000_000 + index),
    })),
    book: [
      {
        id: scope.bookId,
        consumer_user_id: scope.ownerId,
        ai_project_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'PLANNED',
      },
    ],
    pages: [
      {
        id: scope.coverId,
        page_number: 0,
        page_kind: 'COVER',
        source_ai_job_id: null,
        character_ids: [mimiId, pipId],
      },
      {
        id: scope.page1Id,
        page_number: 1,
        page_kind: 'CONTENT',
        source_ai_job_id: null,
        character_ids: [mimiId, pipId],
      },
      {
        id: scope.page2Id,
        page_number: 2,
        page_kind: 'CONTENT',
        source_ai_job_id: null,
        character_ids: [mimiId, pipId],
      },
    ],
    references: [
      {
        character_id: mimiId,
        name: 'Mimi',
        confirmed: true,
        locked: true,
        reference_status: 'READY',
        reference_provider: 'IMPORTED',
        media_provider: 'BAIDU_BOS',
        media_status: 'READY',
        mime_type: 'image/png',
        object_key: objectKey(mimiId, mimiHash),
        playback_url: `https://${bucket}.cd.bcebos.com/${objectKey(mimiId, mimiHash)}`,
        byte_size: 1_843_161,
      },
      {
        character_id: pipId,
        name: 'Pip',
        confirmed: true,
        locked: true,
        reference_status: 'READY',
        reference_provider: 'IMPORTED',
        media_provider: 'BAIDU_BOS',
        media_status: 'READY',
        mime_type: 'image/png',
        object_key: objectKey(pipId, pipHash),
        playback_url: `https://${bucket}.cd.bcebos.com/${objectKey(pipId, pipHash)}`,
        byte_size: 738_959,
      },
    ],
    activity: [{ active_jobs: 0, project_jobs: 0 }],
    illustrations: [],
    reservations: [],
    ledgers: [],
    windows: [],
  };
}

function fakeDatabase(rows = baseRows()) {
  const statements = [];
  const client = {
    async connect() {},
    async end() {},
    async query(sql) {
      statements.push(String(sql));
      if (/^BEGIN|^SET LOCAL|^ROLLBACK/.test(sql)) return { rows: [] };
      for (const [marker, key] of [
        ['I111_IDENTITY', 'identity'],
        ['I111_MIGRATIONS', 'migrations'],
        ['I111_BOOK', 'book'],
        ['I111_PAGES', 'pages'],
        ['I111_REFERENCES', 'references'],
        ['I111_ACTIVITY', 'activity'],
        ['I111_ILLUSTRATIONS', 'illustrations'],
        ['I111_RESERVATIONS', 'reservations'],
        ['I111_LEDGERS', 'ledgers'],
        ['I111_WINDOWS', 'windows'],
      ]) {
        if (String(sql).includes(marker)) return { rows: rows[key] };
      }
      throw new Error('UNEXPECTED_QUERY');
    },
  };
  return { client, statements };
}

function validFiles() {
  return {
    errors: [],
    backupVerified: true,
    mimiMatched: true,
    pipMatched: true,
  };
}

async function run({
  environment = env(),
  rows = baseRows(),
  fileResult = validFiles(),
  open,
} = {}) {
  const database = fakeDatabase(rows);
  const result = await runI111ReadonlyRuntimePreflight({
    env: environment,
    argv: [],
    dependencies: {
      gitSha: () => reviewedSha,
      runtimeInspector: () => ({
        gateVerified: true,
        apiRunning: false,
        genericWorkerRunning: false,
      }),
      fileInspector: () => fileResult,
      readFile: (path, encoding) =>
        String(path).endsWith('_journal.json')
          ? Promise.resolve(
              JSON.stringify({
                entries: rows.migrations.map((row) => ({ when: Number(row.created_at) })),
              }),
            )
          : String(path).endsWith('private-bos-reference.ts')
            ? Promise.resolve(`
                export const PRIVATE_REFERENCE_TTL_SECONDS = PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS;
                signer.generatePresignedUrl(bucket, key, now, PRIVATE_REFERENCE_TTL_SECONDS,);
              `)
            : readFile(path, encoding),
      openDatabase: open ?? (() => database.client),
    },
  });
  return { result, statements: database.statements };
}

test('collects real-shaped rows only through a read-only transaction and never authorizes payment', async () => {
  const { result, statements } = await run();
  assert.equal(result.result, 'STOP');
  assert.deepEqual(result.errorCodes, ['I111_BUDGET_INVALID', 'I111_PRICE_BASIS_UNVERIFIED']);
  assert.equal(result.paidExecutionAuthorized, false);
  assert.equal(statements[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.ok(
    statements.every(
      (sql) => !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|COMMIT)\b/i.test(sql),
    ),
  );
});

test('stops before scoped reads for a wrong connected database or user', async () => {
  for (const field of ['database_name', 'database_user']) {
    const rows = baseRows();
    rows.identity[0][field] = 'wrong';
    const { result, statements } = await run({ rows });
    assert.ok(result.errorCodes.includes('I111_DATABASE_IDENTITY_INVALID'));
    assert.ok(!statements.some((sql) => sql.includes('I111_BOOK')));
  }
});

test('requires the exact ordered migration journal', async () => {
  const rows = baseRows();
  rows.migrations[20].created_at = '123';
  const environment = env();
  const database = fakeDatabase(rows);
  const result = await runI111ReadonlyRuntimePreflight({
    env: environment,
    argv: [],
    dependencies: {
      gitSha: () => reviewedSha,
      runtimeInspector: () => ({
        gateVerified: true,
        apiRunning: false,
        genericWorkerRunning: false,
      }),
      fileInspector: () => validFiles(),
      openDatabase: () => database.client,
      readFile: (path, encoding) => {
        if (String(path).endsWith('_journal.json')) {
          const expected = baseRows().migrations;
          return Promise.resolve(
            JSON.stringify({ entries: expected.map((row) => ({ when: Number(row.created_at) })) }),
          );
        }
        if (String(path).endsWith('private-bos-reference.ts')) {
          return Promise.resolve(`
            export const PRIVATE_REFERENCE_TTL_SECONDS = PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS;
            signer.generatePresignedUrl(bucket, key, now, PRIVATE_REFERENCE_TTL_SECONDS,);
          `);
        }
        return readFile(path, encoding);
      },
    },
  });
  assert.ok(result.errorCodes.includes('I111_MIGRATION_STATE_INVALID'));
});

test('rejects a non-allowlisted database URL without opening a connection', async () => {
  const environment = env();
  environment.DATABASE_URL =
    'postgresql://xiaohai_i111_app:synthetic-password@127.0.0.1:52511/other';
  let opened = false;
  const { result } = await run({
    environment,
    open: () => {
      opened = true;
      throw new Error('must not connect');
    },
  });
  assert.equal(opened, false);
  assert.ok(result.errorCodes.includes('I111_DATABASE_IDENTITY_INVALID'));
});

test('rejects CLI arguments before filesystem, process or database inspection', async () => {
  let touched = false;
  const result = await runI111ReadonlyRuntimePreflight({
    argv: ['--execute'],
    dependencies: {
      readFile: () => {
        touched = true;
        throw new Error('must not read');
      },
      runtimeInspector: () => {
        touched = true;
        throw new Error('must not inspect');
      },
      openDatabase: () => {
        touched = true;
        throw new Error('must not connect');
      },
    },
  });
  assert.equal(touched, false);
  assert.deepEqual(result, {
    result: 'STOP',
    errorCodes: ['I111_ARGUMENTS_FORBIDDEN'],
    paidExecutionAuthorized: false,
    checks: {},
  });
});

test('reads temporary files and rejects wrong archive and asset fingerprints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i111-readonly-'));
  try {
    const paths = {
      gateRoot: directory,
      backup: join(directory, 'backup.dump'),
      mimi: join(directory, 'mimi.png'),
      pip: join(directory, 'pip.png'),
      apiMode: join(directory, 'api.mode'),
    };
    for (const [path, body] of [
      [paths.backup, Buffer.from('PGDMP-wrong')],
      [paths.mimi, Buffer.from('not-mimi')],
      [paths.pip, Buffer.from('not-pip')],
      [paths.apiMode, Buffer.from('disabled\n')],
    ]) {
      await writeFile(path, body, { mode: 0o600 });
      await chmod(path, 0o600);
    }
    const rows = baseRows();
    const database = fakeDatabase(rows);
    const result = await runI111ReadonlyRuntimePreflight({
      env: env(),
      argv: [],
      paths,
      dependencies: {
        gitSha: () => reviewedSha,
        runtimeInspector: () => ({
          gateVerified: true,
          apiRunning: false,
          genericWorkerRunning: false,
        }),
        openDatabase: () => database.client,
        readFile: (path, encoding) =>
          String(path).endsWith('_journal.json')
            ? Promise.resolve(
                JSON.stringify({
                  entries: rows.migrations.map((row) => ({ when: Number(row.created_at) })),
                }),
              )
            : String(path).endsWith('private-bos-reference.ts')
              ? Promise.resolve(`
                  export const PRIVATE_REFERENCE_TTL_SECONDS = PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS;
                  signer.generatePresignedUrl(bucket, key, now, PRIVATE_REFERENCE_TTL_SECONDS,);
                `)
              : readFile(path, encoding),
      },
    });
    assert.ok(result.errorCodes.includes('I111_BACKUP_NOT_VERIFIED'));
    assert.ok(result.errorCodes.includes('I111_REFERENCES_INVALID'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed on missing references and mismatched backup evidence', async () => {
  const rows = baseRows();
  rows.references.pop();
  const { result } = await run({
    rows,
    fileResult: {
      errors: ['I111_BACKUP_NOT_VERIFIED'],
      backupVerified: false,
      mimiMatched: true,
      pipMatched: true,
    },
  });
  assert.ok(result.errorCodes.includes('I111_REFERENCES_INVALID'));
  assert.ok(result.errorCodes.includes('I111_BACKUP_NOT_VERIFIED'));
});

test('stops on an unexpected active task', async () => {
  const rows = baseRows();
  rows.activity[0].active_jobs = 1;
  const { result } = await run({ rows });
  assert.ok(result.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'));
});

test('stops when either budget window lacks next-slot headroom', async () => {
  const rows = baseRows();
  rows.windows = [
    {
      scope_type: 'GLOBAL',
      consumer_user_id: null,
      limit_minor: 200,
      reserved_minor: 0,
      actual_minor: 190,
    },
    {
      scope_type: 'CONSUMER',
      consumer_user_id: scope.ownerId,
      limit_minor: 200,
      reserved_minor: 0,
      actual_minor: 190,
    },
  ];
  const { result } = await run({ rows });
  assert.ok(result.errorCodes.includes('I111_BUDGET_INVALID'));
});

test('stops on an unsettled AT_RISK provider slot', async () => {
  const rows = baseRows();
  rows.illustrations = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      page_id: scope.page1Id,
      revision_number: 1,
      provider: 'BAILIAN',
      model: scope.model,
      status: 'RUNNING',
      media_asset_id: null,
    },
  ];
  rows.reservations = [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      budget_key: scope.budgetKey,
      window_key: scope.windowKey,
      consumer_user_id: scope.ownerId,
      resource_type: 'PICTURE_BOOK_IMAGE',
      resource_id: rows.illustrations[0].id,
      status: 'RESERVED',
      uncertainty: 'AT_RISK',
      provider: 'BAILIAN',
      model: scope.model,
      reserved_minor: 25,
      actual_minor: null,
      provider_request_id: null,
    },
  ];
  rows.ledgers = [
    {
      reservation_id: rows.reservations[0].id,
      consumer_user_id: scope.ownerId,
      resource_type: 'PICTURE_BOOK_IMAGE',
      resource_id: rows.illustrations[0].id,
      provider: 'BAILIAN',
      model: scope.model,
      outcome: 'AT_RISK',
      amount_minor: 25,
      usage: slotMarker,
      provider_request_id: null,
    },
  ];
  const { result } = await run({ rows });
  assert.ok(result.errorCodes.includes('I111_BUDGET_INVALID'));
  assert.ok(result.errorCodes.includes('I111_PREVIOUS_ATTEMPT_INVALID'));
});

test('rejects wrong Beijing configuration and missing secret presence without echoing values', async () => {
  const secret = 'private-secret-never-echo';
  const environment = env();
  environment.PICTURE_BOOK_IMAGE_BASE_URL = 'https://dashscope.aliyuncs.com';
  environment.DASHSCOPE_API_KEY = secret;
  delete environment.BAIDU_BOS_SECRET_ACCESS_KEY;
  const { result } = await run({ environment });
  const output = JSON.stringify(result);
  assert.ok(result.errorCodes.includes('I111_PROVIDER_CONFIG_INVALID'));
  assert.ok(result.errorCodes.includes('I111_PROVIDER_CREDENTIALS_MISSING'));
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes('dashscope.aliyuncs.com'));
});

test('redacts unexpected database failures and exits with a fixed code', async () => {
  const secret = 'database-password-never-echo';
  const { result } = await run({
    open: () => {
      throw new Error(secret);
    },
  });
  assert.ok(result.errorCodes.includes('I111_DATABASE_CHECK_FAILED'));
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.paidExecutionAuthorized, false);
});
