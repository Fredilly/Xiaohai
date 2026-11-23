import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  I111_READONLY_PATHS,
  I111_PREFLIGHT_INTERNAL_TOKEN,
  inspectI111RuntimeResources,
  loadI111SourceState,
  runI111ReadonlyRuntimePreflight,
  secureReadFile,
  validateDockerBackendProvenance,
  validateDockerSocketEvidence,
  verifyI111BindHostSource,
  verifyGitHubApproval,
  validateI111PriceEvidence,
  validateI111RemoteBosEvidence,
} from './i111-readonly-runtime-preflight.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const reviewedSha = 'a'.repeat(40);
const mimiId = 'de0169d8-d975-4f1b-b04c-a15c25f54bdc';
const pipId = '249a719e-d284-46e0-a525-285e93270248';
const mimiReferenceId = 'fa526d14-9fc4-4cba-bf3e-ae9c8a888906';
const pipReferenceId = 'bed51270-3add-4d10-93fb-8ffa085ff7a7';
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
    REDIS_URL: 'redis://:synthetic-password@127.0.0.1:52512',
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

function migrationRows() {
  return Array.from({ length: 42 }, (_, index) => ({
    id: index + 1,
    hash: String(index).padStart(64, '0'),
    created_at: String(1_790_000_000_000 + index),
  }));
}

function expectedMigrations(rows = migrationRows()) {
  return rows.map((row, index) => ({
    tag: `${String(index).padStart(4, '0')}_synthetic`,
    hash: row.hash,
    createdAt: row.created_at,
  }));
}

function reference({ name, id, referenceId, digest, size, sortOrder, legacy = false }) {
  const key = `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/${id}/${digest}.png`;
  const mediaId =
    name === 'Mimi'
      ? '10000000-0000-4000-8000-000000000001'
      : '20000000-0000-4000-8000-000000000002';
  return {
    character_id: id,
    name,
    sort_order: sortOrder,
    confirmed: true,
    locked: true,
    reference_media_asset_id: mediaId,
    reference_id: referenceId,
    reference_row_media_asset_id: mediaId,
    reference_status: 'READY',
    reference_provider: 'IMPORTED',
    media_provider: 'BAIDU_BOS',
    media_status: 'READY',
    mime_type: 'image/png',
    object_key: key,
    playback_url: `https://${bucket}.cd.bcebos.com/${legacy ? '/' : ''}${key}`,
    byte_size: size,
  };
}

function baseRows() {
  return {
    identity: [
      {
        database_name: scope.databaseName,
        database_user: 'xiaohai_i111_app',
        transaction_read_only: 'on',
        is_replica: false,
        server_port: 5432,
        server_version_num: '170011',
      },
    ],
    role: [
      {
        rolname: 'xiaohai_i111_app',
        rolsuper: false,
        rolinherit: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
        rolreplication: false,
        rolbypassrls: false,
        can_connect: true,
      },
    ],
    migrations: migrationRows(),
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
      reference({
        name: 'Mimi',
        id: mimiId,
        referenceId: mimiReferenceId,
        digest: mimiHash,
        size: 1_843_161,
        sortOrder: 0,
        legacy: true,
      }),
      reference({
        name: 'Pip',
        id: pipId,
        referenceId: pipReferenceId,
        digest: pipHash,
        size: 738_959,
        sortOrder: 1,
      }),
    ],
    activity: [
      {
        active_ai_jobs: 0,
        active_illustrations: 0,
        active_references: 0,
        book_reference_rows: 2,
      },
    ],
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
        ['I111_ROLE', 'role'],
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
    mimiLocalPngVerified: true,
    pipLocalPngVerified: true,
    apiModeDisabled: true,
    approval: { synthetic: true },
  };
}

function validSource(rows = baseRows()) {
  return {
    errors: [],
    checkedOutSha: reviewedSha,
    reviewedSha,
    versionMatch: true,
    checkoutClean: true,
    independentReviewVerified: true,
    signedTtlSeconds: 900,
    retrySemanticsVerified: false,
    migrations: expectedMigrations(rows.migrations),
  };
}

function validRuntime() {
  return {
    probesVerified: true,
    dockerEndpointVerified: true,
    backendProvenanceVerified: true,
    gateVerified: true,
    listenerTargetsVerified: true,
    resourcesVerified: true,
    apiRunning: false,
    genericWorkerRunning: false,
  };
}

async function run({
  environment = env(),
  rows = baseRows(),
  fileResult = validFiles(),
  sourceResult = validSource(rows),
  runtimeResult = validRuntime(),
  redisResult = { verified: true, queuedJobs: 0 },
  open,
  redisInspector,
  dependencies: dependencyOverrides = {},
} = {}) {
  const database = fakeDatabase(rows);
  const result = await runI111ReadonlyRuntimePreflight({
    env: environment,
    internalToken: I111_PREFLIGHT_INTERNAL_TOKEN,
    dependencies: {
      runtimeInspector: () => runtimeResult,
      fileInspector: () => fileResult,
      sourceInspector: () => sourceResult,
      redisInspector: redisInspector ?? (() => redisResult),
      openDatabase: open ?? (() => database.client),
      ...dependencyOverrides,
    },
  });
  return { result, statements: database.statements };
}

test('rejects failed local prerequisites before runtime, TCP, Redis or PostgreSQL access', async () => {
  const cases = [
    {
      name: 'invalid Fred approval',
      source: { ...validSource(), independentReviewVerified: false, versionMatch: false },
      expectedCode: 'I111_CODE_NOT_REVIEWED',
    },
    {
      name: 'dirty source checkout',
      source: { ...validSource(), checkoutClean: false },
      expectedCode: 'I111_CODE_NOT_REVIEWED',
    },
    {
      name: 'corrupt backup',
      files: { ...validFiles(), backupVerified: false },
      expectedCode: 'I111_BACKUP_NOT_VERIFIED',
    },
    {
      name: 'untrusted approval file',
      files: { ...validFiles(), approval: null, errors: ['I111_CODE_NOT_REVIEWED'] },
      expectedCode: 'I111_CODE_NOT_REVIEWED',
    },
    {
      name: 'invalid provider configuration',
      environment: { ...env(), PICTURE_BOOK_IMAGE_MODEL: 'unexpected-model' },
      expectedCode: 'I111_PROVIDER_CONFIG_INVALID',
    },
    {
      name: 'invalid database URL',
      environment: { ...env(), DATABASE_URL: 'postgresql://user:pass@localhost/other' },
      expectedCode: 'I111_DATABASE_IDENTITY_INVALID',
    },
  ];
  for (const scenario of cases) {
    let runtimeCalls = 0;
    let tcpCalls = 0;
    let redisCalls = 0;
    let postgresCalls = 0;
    const result = await runI111ReadonlyRuntimePreflight({
      internalToken: I111_PREFLIGHT_INTERNAL_TOKEN,
      env: scenario.environment ?? env(),
      dependencies: {
        fileInspector: () => scenario.files ?? validFiles(),
        sourceInspector: () => scenario.source ?? validSource(),
        runtimeInspector: () => {
          runtimeCalls += 1;
          tcpCalls += 1;
          return validRuntime();
        },
        redisInspector: () => {
          redisCalls += 1;
          return { verified: true, queuedJobs: 0 };
        },
        openDatabase: () => {
          postgresCalls += 1;
          return fakeDatabase().client;
        },
      },
    });
    assert.equal(result.result, 'STOP', scenario.name);
    assert.equal(result.paidExecutionAuthorized, false, scenario.name);
    assert.ok(result.errorCodes.includes(scenario.expectedCode), scenario.name);
    for (const code of ['I111_REMOTE_BOS_UNVERIFIED', 'I111_PRICE_BASIS_UNVERIFIED']) {
      assert.ok(result.errorCodes.includes(code), `${scenario.name}: ${code}`);
    }
    assert.deepEqual(
      { runtimeCalls, tcpCalls, redisCalls, postgresCalls },
      { runtimeCalls: 0, tcpCalls: 0, redisCalls: 0, postgresCalls: 0 },
      scenario.name,
    );
    assert.equal(result.checks.database, 'STOP', scenario.name);
    assert.equal(result.checks.processAndRedisSampling, 'STOP', scenario.name);
  }
});

test('uses only a read-only transaction, separates remote proof, and never authorizes payment', async () => {
  const { result, statements } = await run();
  assert.equal(result.result, 'STOP');
  assert.ok(result.errorCodes.includes('I111_PRICE_BASIS_UNVERIFIED'));
  assert.ok(result.errorCodes.includes('I111_REMOTE_BOS_UNVERIFIED'));
  assert.equal(result.checks.localPngFingerprints, 'PASS');
  assert.equal(result.checks.databaseReferenceMetadata, 'PASS');
  assert.equal(result.checks.remoteBos, 'STOP');
  assert.equal(result.paidExecutionAuthorized, false);
  assert.equal(statements[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.ok(
    statements.every(
      (sql) => !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|COMMIT)\b/i.test(sql),
    ),
  );
});

test('independent BOS and price evidence can clear only those preflight gates', async () => {
  const { result } = await run({
    dependencies: {
      remoteBosVerifier: async ({ source }) => ({
        kind: 'I111_REMOTE_BOS_EVIDENCE',
        authenticated: true,
        checkedOutSha: source.checkedOutSha,
        bookId: scope.bookId,
        ownerId: scope.ownerId,
        bucket,
        endpoint: 'https://cd.bcebos.com',
        observedAt: 1,
        expiresAt: 2,
        objects: [
          {
            name: 'Mimi',
            statusCode: 200,
            private: true,
            objectKey: `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/mimi.png`,
            sha256: 'a'.repeat(64),
          },
          {
            name: 'Pip',
            statusCode: 200,
            private: true,
            objectKey: `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/pip.png`,
            sha256: 'b'.repeat(64),
          },
        ],
      }),
      priceVerifier: async ({ source }) => ({
        kind: 'I111_PRICE_EVIDENCE',
        authenticated: true,
        checkedOutSha: source.checkedOutSha,
        provider: scope.provider,
        model: scope.model,
        currency: 'CNY',
        inputImages: 2,
        outputImages: 1,
        maxCalls: 3,
        reservationMinor: 25,
        maxSpendMinor: 200,
        expectedChargeMinor: 22,
        observedAt: 1,
        expiresAt: 2,
      }),
    },
  });
  assert.equal(result.result, 'STOP');
  assert.deepEqual(result.errorCodes, ['I111_BUDGET_INVALID', 'I111_RUNTIME_NOT_ISOLATED']);
  assert.equal(result.checks.remoteBos, 'PASS');
  assert.equal(result.checks.budget, 'STOP');
  assert.equal(result.checks.atomicIsolation, 'DEFERRED_TO_TRUSTED_COORDINATOR');
  assert.equal(result.checks.retrySemantics, 'DEFERRED_TO_TRUSTED_COORDINATOR');
  assert.equal(result.paidExecutionAuthorized, false);
});

test('evidence validators reject booleans, wrong scope, stale hashes and malformed manifests', () => {
  const source = { checkedOutSha: reviewedSha };
  const environment = { BAIDU_BOS_BUCKET: bucket, BAIDU_BOS_ENDPOINT: 'https://cd.bcebos.com' };
  assert.equal(validateI111RemoteBosEvidence(true, { env: environment, source }), false);
  assert.equal(validateI111PriceEvidence(true, { source }), false);
  const remote = {
    kind: 'I111_REMOTE_BOS_EVIDENCE',
    authenticated: true,
    checkedOutSha: reviewedSha,
    bookId: scope.bookId,
    ownerId: scope.ownerId,
    bucket,
    endpoint: environment.BAIDU_BOS_ENDPOINT,
    observedAt: 1,
    expiresAt: 2,
    objects: [
      {
        name: 'Mimi',
        statusCode: 200,
        private: true,
        objectKey: `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/mimi`,
        sha256: 'a'.repeat(64),
      },
      {
        name: 'Pip',
        statusCode: 200,
        private: true,
        objectKey: `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/pip`,
        sha256: 'b'.repeat(64),
      },
    ],
  };
  assert.equal(validateI111RemoteBosEvidence(remote, { env: environment, source }), true);
  assert.equal(
    validateI111RemoteBosEvidence(
      { ...remote, checkedOutSha: 'f'.repeat(40) },
      { env: environment, source },
    ),
    false,
  );
  assert.equal(
    validateI111RemoteBosEvidence(
      { ...remote, objects: remote.objects.slice(0, 1) },
      { env: environment, source },
    ),
    false,
  );
  const price = {
    kind: 'I111_PRICE_EVIDENCE',
    authenticated: true,
    checkedOutSha: reviewedSha,
    provider: scope.provider,
    model: scope.model,
    currency: 'CNY',
    inputImages: 2,
    outputImages: 1,
    maxCalls: 3,
    reservationMinor: 25,
    maxSpendMinor: 200,
    expectedChargeMinor: 22,
    observedAt: 1,
    expiresAt: 2,
  };
  assert.equal(validateI111PriceEvidence(price, { source }), true);
  assert.equal(validateI111PriceEvidence({ ...price, model: 'other' }, { source }), false);
});

test('rejects wrong database identity and restricted-role privilege drift before scoped reads', async () => {
  for (const mutate of [
    (rows) => (rows.identity[0].database_name = 'wrong'),
    (rows) => (rows.identity[0].database_user = 'wrong'),
    (rows) => (rows.identity[0].server_port = 5433),
    (rows) => (rows.role[0].rolsuper = true),
    (rows) => (rows.role[0].rolinherit = true),
  ]) {
    const rows = baseRows();
    mutate(rows);
    const { result, statements } = await run({ rows, sourceResult: validSource(rows) });
    assert.ok(result.errorCodes.includes('I111_DATABASE_IDENTITY_INVALID'));
    assert.equal(result.checks.database, 'STOP');
    assert.ok(!statements.some((sql) => sql.includes('I111_BOOK')));
  }
});

test('compares ordered Drizzle SQL hashes and marks database STOP on replacement', async () => {
  const rows = baseRows();
  const source = validSource(rows);
  rows.migrations[20].hash = 'f'.repeat(64);
  const { result } = await run({ rows, sourceResult: source });
  assert.ok(result.errorCodes.includes('I111_MIGRATION_STATE_INVALID'));
  assert.equal(result.checks.database, 'STOP');
});

test('requires exact Mimi then Pip identity on every page and all character rows', async () => {
  const mutations = [
    (rows) => (rows.pages[0].character_ids = [mimiId, mimiId]),
    (rows) => (rows.pages[1].character_ids = [pipId, mimiId]),
    (rows) => (rows.pages[2].character_ids = [mimiId, '99999999-9999-4999-8999-999999999999']),
    (rows) => rows.references.push({ ...rows.references[1], character_id: 'extra', name: 'Other' }),
    (rows) => rows.references.reverse(),
    (rows) => (rows.activity[0].book_reference_rows = 3),
  ];
  for (const mutate of mutations) {
    const rows = baseRows();
    mutate(rows);
    const { result } = await run({ rows, sourceResult: validSource(rows) });
    assert.ok(
      result.errorCodes.includes('I111_BOOK_SCOPE_INVALID') ||
        result.errorCodes.includes('I111_REFERENCES_INVALID'),
    );
    assert.equal(result.checks.database, 'STOP');
  }
});

test('accepts only the narrow historical double slash and rejects a nondefault BOS port', async () => {
  const legacy = await run();
  assert.equal(legacy.result.checks.databaseReferenceMetadata, 'PASS');
  const rows = baseRows();
  rows.references[0].playback_url = rows.references[0].playback_url.replace(
    '.bcebos.com',
    '.bcebos.com:444',
  );
  const { result } = await run({ rows, sourceResult: validSource(rows) });
  assert.ok(result.errorCodes.includes('I111_REFERENCES_INVALID'));
});

test('fails closed for probe failure, active unrelated image work, Redis queues and Redis errors', async () => {
  const probe = validRuntime();
  probe.probesVerified = false;
  assert.ok(
    (await run({ runtimeResult: probe })).result.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'),
  );

  const rows = baseRows();
  rows.activity[0].active_illustrations = 1;
  assert.ok(
    (await run({ rows, sourceResult: validSource(rows) })).result.errorCodes.includes(
      'I111_RUNTIME_NOT_ISOLATED',
    ),
  );

  assert.ok(
    (await run({ redisResult: { verified: false, queuedJobs: 1 } })).result.errorCodes.includes(
      'I111_REDIS_CHECK_FAILED',
    ),
  );
  assert.ok(
    (
      await run({
        redisInspector: () => {
          throw new Error('redis private detail');
        },
      })
    ).result.errorCodes.includes('I111_REDIS_CHECK_FAILED'),
  );
});

test('does not open PostgreSQL or Redis before every resource identity check passes', async () => {
  for (const field of [
    'probesVerified',
    'dockerEndpointVerified',
    'backendProvenanceVerified',
    'gateVerified',
    'listenerTargetsVerified',
    'resourcesVerified',
  ]) {
    const runtime = validRuntime();
    runtime[field] = false;
    let databaseCalls = 0;
    let redisCalls = 0;
    const { result } = await run({
      runtimeResult: runtime,
      open: () => {
        databaseCalls += 1;
        throw new Error('must not open PostgreSQL');
      },
      redisInspector: () => {
        redisCalls += 1;
        throw new Error('must not open Redis');
      },
    });
    assert.equal(databaseCalls, 0, field);
    assert.equal(redisCalls, 0, field);
    assert.equal(result.checks.postgresResource, 'STOP');
    assert.ok(result.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'));
  }
});

function runtimeResourceHarness({
  dockerContext,
  listenerExecutable,
  publishedPort,
  persistedHostPort,
  daemonId,
  wrongContainerId = false,
  wrongImage = false,
  wrongVolume = false,
  wrongPlan = false,
  missingSourceId = false,
  missingSourceVolume = false,
  misplacedSourceId = false,
  misplacedSourceVolume = false,
  extraMount = false,
  missingBind = false,
  wrongBindSource = false,
  wrongBindDestination = false,
  bindWritableRuntime = false,
  bindWritablePersisted = false,
  wrongBindPropagation = false,
  wrongPersistedMount = false,
  persistedBindUsesMacPath = false,
  persistedVolumeReadOnly = undefined,
  missingPersistedBindReadOnly = false,
  wrongVolumeMountpoint = false,
  unsafeBindSource = false,
  alteredResource = 'postgres',
  separateRedisBackend = false,
  gateSha = '6898d09a3fcf76c5006ab271d0168643de2bf1fd',
  dirty = false,
  workerRunning = false,
  socketReplacementPhase,
  multiplePostgresPids = false,
  signatureTeamId = '9BNSXJN65R',
  signatureCdHash = '54c72e39ae7276bc1a096e7494615a690a0d31d8',
  signatureOuTeamId = '9BNSXJN65R',
  signatureOuQuoted = true,
  signatureOuMissing = false,
  signatureVerifyFailed = false,
  executableUid = 501,
} = {}) {
  let dockerCalls = 0;
  let tcpCalls = 0;
  const commandRunner = async (command, args) => {
    const success = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    if (command === 'git') {
      return success(args.includes('status') ? (dirty ? ' M tracked-file\n' : '') : `${gateSha}\n`);
    }
    if (command === '/usr/sbin/lsof' && args.includes('-iTCP:52513')) {
      return { status: 1, stdout: '', stderr: '' };
    }
    if (command === '/usr/sbin/lsof' && args.some((value) => value.startsWith('-iTCP:'))) {
      const port = args.find((value) => value.startsWith('-iTCP:'))?.slice(6);
      const executable = listenerExecutable ?? 'com.docke';
      const pid = port === '52512' && separateRedisBackend ? 7001 : port === '52512' ? 5917 : 5916;
      const extra =
        port === '52511' && multiplePostgresPids
          ? `${executable} 5918 li 43u IPv4 0x1 0t0 TCP 127.0.0.1:${port} (LISTEN)\n`
          : '';
      return success(
        `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${executable} ${pid} li 42u IPv4 0x0 0t0 TCP 127.0.0.1:${port} (LISTEN)\n${extra}`,
      );
    }
    if (command === '/usr/sbin/lsof' && args.includes('-d')) {
      const pid = args[args.indexOf('-p') + 1];
      return success(
        `p${pid}\nf txt\nD0x1000004\ni3424107\nn/Applications/Docker.app/Contents/MacOS/com.docker.backend\n`,
      );
    }
    if (command === '/usr/sbin/lsof') {
      return success(
        'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncom.docke 5916 li 42u unix 0x0 0t0 /Users/li/.docker/run/docker.sock\n',
      );
    }
    if (command === '/bin/ps' && args.includes('pid=,ppid=,uid=,comm=')) {
      return success(
        `5908 1 501 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n5916 5908 501 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n5917 5908 501 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n5918 5908 501 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n${
          separateRedisBackend
            ? '7000 1 501 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n7001 7000 501 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n'
            : ''
        }`,
      );
    }
    if (command === '/bin/ps') {
      return success(
        workerRunning ? 'node apps/worker/dist/worker.js\n' : 'node harmless-script.mjs\n',
      );
    }
    if (command === '/usr/bin/stat') {
      return success(`16777220:3424107:${executableUid}:-rwxr-xr-x\n`);
    }
    if (command === '/usr/bin/codesign' && args[0] === '--verify') {
      return signatureVerifyFailed ? { status: 1, stdout: '', stderr: '' } : success();
    }
    if (command === '/usr/bin/codesign') {
      const ou = signatureOuMissing
        ? ''
        : ` and certificate leaf[subject.OU] = ${signatureOuQuoted ? `"${signatureOuTeamId}"` : signatureOuTeamId}`;
      return {
        status: 0,
        stdout: '',
        stderr: `Identifier=com.docker.docker\nTeamIdentifier=${signatureTeamId}\nCDHash=${signatureCdHash}\ndesignated => anchor apple generic${ou}\n`,
      };
    }
    assert.equal(command, '/Applications/Docker.app/Contents/Resources/bin/docker');
    dockerCalls += 1;
    assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///Users/li/.docker/run/docker.sock']);
    if (args[2] === 'info') {
      return success(
        JSON.stringify({
          ID: daemonId ?? '85a4eb36-df0b-474f-854d-52a141733ea8',
          Name: 'docker-desktop',
          OperatingSystem: 'Docker Desktop',
          OSType: 'linux',
          DockerRootDir: '/var/lib/docker',
          ServerVersion: '29.8.0',
        }),
      );
    }
    if (args[2] === 'inspect') {
      const postgres = args[3] === 'xiaohai-i111-planb-fixed-postgres';
      const altered = (postgres ? 'postgres' : 'redis') === alteredResource;
      const port = postgres ? '52511' : '52512';
      const containerPort = postgres ? '5432' : '6379';
      const volume = postgres
        ? 'xiaohai_i111_planb_fixed_pgdata'
        : 'xiaohai_i111_planb_fixed_redisdata';
      const sourceId = postgres
        ? 'fdede2cf57f70465a950b0a4ea2d13cb6894cc13bc97b540ecf660b9c1629f24'
        : '920804ca22010bfe8ae8791e9f6ec88604d870151685ea6a31e66dc23182f031';
      const sourceVolume = postgres ? 'xiaohai_i111_planb_pgdata' : 'xiaohai_i111_planb_redisdata';
      const image = postgres
        ? 'sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73'
        : 'sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf';
      const destination = postgres ? '/var/lib/postgresql/data' : '/data';
      const hostSource = `/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/secrets/${postgres ? 'postgres_bootstrap_password' : 'redis.conf'}`;
      const dockerSource = `/host_mnt${hostSource}`;
      const bindDestination = postgres
        ? '/run/secrets/postgres_bootstrap_password'
        : '/usr/local/etc/redis/redis.conf';
      const volumeMountpoint = `/var/lib/docker/volumes/${volume}/_data`;
      return success(
        JSON.stringify([
          {
            Id:
              altered && wrongContainerId
                ? '0'.repeat(64)
                : postgres
                  ? '3fdfd302d45de4f487197bdc0e335f8f3f6dec8a38cd6eb16b1ead883fe3b87f'
                  : '9a57c5bd1e310f47880c5fba3e7be21c76441359eeda82d3f897f34937be02e1',
            Name: `/${args[3]}`,
            State: { Running: true },
            Image: altered && wrongImage ? `sha256:${'0'.repeat(64)}` : image,
            Config: {
              Labels: {
                'com.xiaohai.issue': '111',
                'com.xiaohai.plan': altered && wrongPlan ? 'plan-b' : 'plan-b-fixed-ports-v1',
                'com.xiaohai.source-container':
                  altered && (missingSourceId || misplacedSourceId) ? '0'.repeat(64) : sourceId,
                'com.xiaohai.source-volume':
                  altered && (missingSourceVolume || misplacedSourceVolume)
                    ? 'wrong-source-volume'
                    : sourceVolume,
                ...(altered && misplacedSourceId
                  ? { 'com.xiaohai.source-container-id': sourceId }
                  : {}),
                ...(altered && misplacedSourceVolume
                  ? { 'unrelated.source-volume': sourceVolume }
                  : {}),
              },
            },
            HostConfig: {
              Binds: null,
              Mounts: [
                {
                  Type: 'volume',
                  Source: volume,
                  Target: destination,
                  ...(altered && persistedVolumeReadOnly !== undefined
                    ? { ReadOnly: persistedVolumeReadOnly }
                    : {}),
                },
                ...(altered && missingBind
                  ? []
                  : [
                      {
                        Type: 'bind',
                        Source:
                          altered && (wrongBindSource || wrongPersistedMount)
                            ? '/host_mnt/Volumes/Data/untrusted-secret'
                            : altered && persistedBindUsesMacPath
                              ? hostSource
                              : dockerSource,
                        Target:
                          altered && (wrongBindDestination || wrongPersistedMount)
                            ? '/unexpected-secret'
                            : bindDestination,
                        ...(altered && missingPersistedBindReadOnly
                          ? {}
                          : { ReadOnly: altered && bindWritablePersisted ? false : true }),
                      },
                    ]),
              ],
              PortBindings: {
                [`${containerPort}/tcp`]: [
                  { HostIp: '127.0.0.1', HostPort: persistedHostPort ?? port },
                ],
              },
            },
            NetworkSettings: {
              Ports: {
                [`${containerPort}/tcp`]: [
                  { HostIp: '127.0.0.1', HostPort: publishedPort ?? port },
                ],
              },
            },
            Mounts: [
              {
                Destination: destination,
                Type: 'volume',
                Name: altered && wrongVolume ? 'untrusted-volume' : volume,
                RW: true,
                Source:
                  altered && wrongVolumeMountpoint
                    ? '/var/lib/docker/volumes/other/_data'
                    : volumeMountpoint,
              },
              ...(altered && missingBind
                ? []
                : [
                    {
                      Destination:
                        altered && wrongBindDestination ? '/unexpected-secret' : bindDestination,
                      Type: 'bind',
                      Name: null,
                      Source:
                        altered && wrongBindSource ? '/host_mnt/Volumes/Data/other' : dockerSource,
                      RW: altered && bindWritableRuntime ? true : false,
                      Propagation: altered && wrongBindPropagation ? 'rshared' : 'rprivate',
                    },
                  ]),
              ...(altered && extraMount
                ? [{ Destination: '/unexpected', Type: 'volume', Name: sourceVolume, RW: true }]
                : []),
            ],
          },
        ]),
      );
    }
    if (args[2] === 'volume') {
      return success(
        JSON.stringify([
          {
            Name: args[4],
            Driver: 'local',
            Scope: 'local',
            Mountpoint: `/var/lib/docker/volumes/${args[4]}/_data`,
          },
        ]),
      );
    }
    if (args[2] === 'port') {
      const port = args[3] === 'xiaohai-i111-planb-fixed-postgres' ? '52511' : '52512';
      return success(`127.0.0.1:${port}\n`);
    }
    throw new Error('unexpected synthetic command');
  };
  return {
    dependencies: {
      commandRunner,
      env: dockerContext ? { DOCKER_CONTEXT: dockerContext } : {},
      uid: 501,
      bindInspector: async (bind) =>
        !(
          unsafeBindSource &&
          (bind.destination.startsWith('/run/secrets') ? 'postgres' : 'redis') === alteredResource
        ),
      socketInspector: async () => ({
        verified: true,
        identity: {
          symbolicLink: false,
          socket: true,
          dev: 1,
          ino: 2,
          uid: 501,
          mode: 0o140600,
        },
      }),
      socketRechecker: async (_identity, _dependencies, phase) => phase !== socketReplacementPhase,
      tcpProbe: async (port) => {
        tcpCalls += 1;
        return port === '52513' ? 'closed' : 'open';
      },
    },
    dockerCalls: () => dockerCalls,
    tcpCalls: () => tcpCalls,
  };
}

test('pins the local Docker endpoint and binds listeners to published container ports', async () => {
  const paths = { gateRoot: '/synthetic/gate' };
  const trusted = runtimeResourceHarness();
  const verified = await inspectI111RuntimeResources(paths, trusted.dependencies);
  assert.equal(verified.dockerEndpointVerified, true);
  assert.equal(verified.backendProvenanceVerified, true);
  assert.equal(verified.listenerTargetsVerified, true);
  assert.equal(verified.resourcesVerified, true);
  assert.ok(trusted.dockerCalls() > 0);

  // Match the *observed* Docker Desktop HostConfig.Mounts JSON shape:
  // persisted bind Source uses /host_mnt, whereas a writable named volume
  // does not serialize any ReadOnly field at all.
  for (const name of ['xiaohai-i111-planb-fixed-postgres', 'xiaohai-i111-planb-fixed-redis']) {
    const inspected = await trusted.dependencies.commandRunner(
      '/Applications/Docker.app/Contents/Resources/bin/docker',
      ['--host', 'unix:///Users/li/.docker/run/docker.sock', 'inspect', name],
    );
    const [{ HostConfig: host }] = JSON.parse(inspected.stdout);
    assert.equal(Object.hasOwn(host.Mounts[0], 'ReadOnly'), false);
    assert.match(host.Mounts[1].Source, /^\/host_mnt\/Volumes\/Data\//);
    assert.equal(host.Mounts[1].ReadOnly, true);
    assert.equal(host.Binds, null);
  }

  for (const fixture of [
    runtimeResourceHarness({ dockerContext: 'remote-attacker' }),
    runtimeResourceHarness({ listenerExecutable: 'socat' }),
    runtimeResourceHarness({ publishedPort: '59999' }),
  ]) {
    const runtime = await inspectI111RuntimeResources(paths, fixture.dependencies);
    assert.equal(runtime.resourcesVerified, false);
    let databaseCalls = 0;
    let redisCalls = 0;
    await run({
      runtimeResult: runtime,
      open: () => {
        databaseCalls += 1;
        throw new Error('must not open PostgreSQL');
      },
      redisInspector: () => {
        redisCalls += 1;
        throw new Error('must not open Redis');
      },
    });
    assert.equal(databaseCalls, 0);
    assert.equal(redisCalls, 0);
  }
});

test('stopped containers created with dynamic host ports cannot satisfy fixed-port provenance', async () => {
  const fixture = runtimeResourceHarness({ persistedHostPort: '' });
  const runtime = await inspectI111RuntimeResources(
    { gateRoot: '/synthetic/gate' },
    fixture.dependencies,
  );
  assert.equal(runtime.resourcesVerified, false);
  assert.equal(fixture.tcpCalls(), 0);

  let databaseCalls = 0;
  let redisCalls = 0;
  const { result } = await run({
    runtimeResult: runtime,
    open: () => {
      databaseCalls += 1;
      throw new Error('must not connect to PostgreSQL');
    },
    redisInspector: () => {
      redisCalls += 1;
      throw new Error('must not connect to Redis');
    },
  });
  assert.equal(databaseCalls, 0);
  assert.equal(redisCalls, 0);
  assert.ok(result.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'));
});

test('new fixed-port resource identity drift stops before TCP and PostgreSQL/Redis connectors', async () => {
  const cases = [
    { wrongContainerId: true },
    { wrongImage: true },
    { wrongVolume: true },
    { wrongPlan: true },
    { missingSourceId: true },
    { missingSourceVolume: true },
    { misplacedSourceId: true },
    { misplacedSourceVolume: true },
    { extraMount: true },
    { missingBind: true },
    { wrongBindSource: true },
    { wrongBindDestination: true },
    { bindWritableRuntime: true },
    { bindWritablePersisted: true },
    { wrongBindPropagation: true },
    { wrongPersistedMount: true },
    { persistedBindUsesMacPath: true },
    { persistedVolumeReadOnly: false },
    { persistedVolumeReadOnly: true },
    { missingPersistedBindReadOnly: true },
    { wrongVolumeMountpoint: true },
    { unsafeBindSource: true },
    { persistedHostPort: '' },
    { persistedHostPort: '59999' },
    { publishedPort: '59999' },
  ];
  for (const alteredResource of ['postgres', 'redis']) {
    for (const alteration of cases) {
      const fixture = runtimeResourceHarness({ alteredResource, ...alteration });
      const runtime = await inspectI111RuntimeResources(
        { gateRoot: '/synthetic/gate' },
        fixture.dependencies,
      );
      const reason = `${alteredResource}:${Object.keys(alteration).join(',')}`;
      assert.equal(runtime.resourcesVerified, false, reason);
      assert.equal(fixture.tcpCalls(), 0, reason);
      let databaseCalls = 0;
      let redisCalls = 0;
      const { result } = await run({
        runtimeResult: runtime,
        open: () => {
          databaseCalls += 1;
          throw new Error('must not connect to PostgreSQL');
        },
        redisInspector: () => {
          redisCalls += 1;
          throw new Error('must not connect to Redis');
        },
      });
      assert.equal(databaseCalls, 0, reason);
      assert.equal(redisCalls, 0, reason);
      assert.ok(result.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'), reason);
    }
  }
});

test('uses the independently protected approval record, never the older Gate B approval', () => {
  assert.equal(
    I111_READONLY_PATHS.approval,
    '/Volumes/Data/Xiaohai-i111-pr242-runtime-approval/i111-readonly-runtime-approval.json',
  );
  assert.ok(!I111_READONLY_PATHS.approval.startsWith(`${I111_READONLY_PATHS.gateRoot}/`));
});

test('bind source inspection is metadata-only and fails closed on ownership, ACL, flags or drift', async () => {
  const expected = {
    volumeRoot: '/Volumes/Data',
    volumeUuid: '512BF66D-91B9-4789-93A8-42BB83B1E0B9',
    hostSource: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/secrets/redis.conf',
    ino: 576877,
  };
  const cases = [
    {},
    { uid: 0 },
    { gid: 0 },
    { mode: 0o100660 },
    { nlink: 2 },
    { dev: 8 },
    { volumeDevice: 8 },
    { volumeUuid: '00000000-0000-0000-0000-000000000000' },
    { filesystem: 'HFS+' },
    { mountPoint: '/Volumes/Other' },
    { diskutilFailed: true },
    { volumeChanged: true },
    { ino: 5 },
    { symlink: true },
    { replaced: true },
    { parentReplaced: true },
    { parentWritable: true },
    { parentAcl: true },
    { parentFlag: true },
    { ls: '-rw-------+ 1 li staff - 20 Nov 19 12:00 redis.conf\n' },
    { ls: '-rw------- 1 li staff uchg 20 Nov 19 12:00 redis.conf\n' },
    { ls: '-rw-------@ 1 li staff - 20 Nov 19 12:00 redis.conf\n' },
    { ls: '-rw------- 1 li staff - 20 Nov 19 12:00 redis.conf\n 0: allow everyone read\n' },
    { lsFailed: true },
  ];
  for (const [index, alteration] of cases.entries()) {
    let fileChecks = 0;
    let calls = 0;
    let diskutilCalls = 0;
    const result = await verifyI111BindHostSource(expected, {
      realpath: async (path) =>
        alteration.symlink && path === expected.hostSource ? '/unexpected' : path,
      lstat: async (path) => {
        if (path !== expected.hostSource) {
          const protectedDirectory = path.endsWith('/.i111-plan-b') || path.endsWith('/secrets');
          return {
            isDirectory: () => true,
            isSymbolicLink: () => false,
            uid: path === '/' || path === '/Volumes' ? 0 : 501,
            mode:
              alteration.parentWritable && path.endsWith('/secrets')
                ? 0o40777
                : protectedDirectory
                  ? 0o40700
                  : 0o40755,
            dev: alteration.volumeDevice && path === '/Volumes/Data' ? 8 : 1,
            ino: alteration.parentReplaced && fileChecks > 0 && path === '/Volumes/Data' ? 3 : 2,
          };
        }
        fileChecks += 1;
        return {
          isFile: () => true,
          isSymbolicLink: () => Boolean(alteration.symlink),
          uid: alteration.uid ?? 501,
          gid: alteration.gid ?? 20,
          mode: alteration.mode ?? 0o100600,
          nlink: alteration.nlink ?? 1,
          dev: alteration.dev ?? 1,
          ino: alteration.replaced && fileChecks > 1 ? 6 : (alteration.ino ?? 576877),
          size: 20,
          mtimeMs: 1,
          ctimeMs: 1,
        };
      },
      commandRunner: async (command, args) => {
        calls += 1;
        if (command === '/usr/sbin/diskutil') {
          diskutilCalls += 1;
          assert.deepEqual(args, ['info', expected.volumeRoot]);
          return {
            status: alteration.diskutilFailed ? 1 : 0,
            stderr: '',
            stdout:
              `   File System Personality: ${alteration.filesystem ?? 'APFS'}\n` +
              `   Mount Point: ${alteration.mountPoint ?? expected.volumeRoot}\n` +
              `   Volume UUID: ${alteration.volumeChanged && diskutilCalls > 1 ? '00000000-0000-0000-0000-000000000000' : (alteration.volumeUuid ?? expected.volumeUuid)}\n`,
          };
        }
        assert.equal(command, '/bin/ls');
        assert.equal(args[0], '-ldeO@');
        const file = args[1] === expected.hostSource;
        const parentMode = args[1] === I111_READONLY_PATHS.gateRoot ? 'drwxr-xr-x' : 'drwx------';
        return {
          status: alteration.lsFailed ? 1 : 0,
          stderr: '',
          stdout: file
            ? (alteration.ls ?? '-rw------- 1 li staff - 20 Nov 19 12:00 redis.conf\n')
            : `${parentMode}${alteration.parentAcl ? '+' : alteration.parentFlag ? '@' : ''} 3 li staff - 96 Nov 19 12:00 secrets\n`,
        };
      },
    });
    if (alteration.volumeChanged) {
      assert.equal(diskutilCalls, 2, `case ${index}`);
    }
    assert.equal(result, index === 0, `case ${index}`);
    assert.ok(calls <= 6, `case ${index}: unexpected metadata calls`);
  }
});

test('stops before TCP probing when the Docker endpoint static identity fails', async () => {
  const paths = { gateRoot: '/synthetic/gate' };
  for (const fixture of [
    runtimeResourceHarness({ dockerContext: 'remote-attacker' }),
    runtimeResourceHarness({ daemonId: 'different-daemon' }),
  ]) {
    const runtime = await inspectI111RuntimeResources(paths, fixture.dependencies);
    assert.equal(runtime.dockerEndpointVerified, false);
    assert.equal(runtime.resourcesVerified, false);
    assert.equal(fixture.tcpCalls(), 0);
  }
});

test('preserves socket identity across daemon and backend sampling before any TCP or connector', async () => {
  for (const phase of [
    'after-daemon',
    'after-socket-process',
    'before-backend-provenance',
    'after-backend-provenance',
    'before-tcp',
  ]) {
    const fixture = runtimeResourceHarness({ socketReplacementPhase: phase });
    const runtime = await inspectI111RuntimeResources(
      { gateRoot: '/synthetic/gate' },
      fixture.dependencies,
    );
    assert.equal(runtime.resourcesVerified, false, phase);
    assert.equal(fixture.tcpCalls(), 0, phase);
    let databaseCalls = 0;
    let redisCalls = 0;
    await run({
      runtimeResult: runtime,
      open: () => {
        databaseCalls += 1;
      },
      redisInspector: () => {
        redisCalls += 1;
      },
    });
    assert.equal(databaseCalls, 0, phase);
    assert.equal(redisCalls, 0, phase);
  }
});

test('wrong Gate SHA, dirty tracked checkout and running Worker stop before TCP and connectors', async () => {
  for (const fixture of [
    runtimeResourceHarness({ gateSha: '0'.repeat(40) }),
    runtimeResourceHarness({ dirty: true }),
    runtimeResourceHarness({ workerRunning: true }),
  ]) {
    const runtime = await inspectI111RuntimeResources(
      { gateRoot: '/synthetic/gate' },
      fixture.dependencies,
    );
    assert.equal(runtime.gateVerified, false);
    assert.equal(runtime.resourcesVerified, false);
    assert.equal(fixture.tcpCalls(), 0);
    let databaseCalls = 0;
    let redisCalls = 0;
    await run({
      runtimeResult: runtime,
      open: () => {
        databaseCalls += 1;
      },
      redisInspector: () => {
        redisCalls += 1;
      },
    });
    assert.equal(databaseCalls, 0);
    assert.equal(redisCalls, 0);
  }
});

test('accepts multiple same-root listener PIDs and rejects signature or vnode-owner drift', async () => {
  const multiple = runtimeResourceHarness({ multiplePostgresPids: true });
  const verified = await inspectI111RuntimeResources(
    { gateRoot: '/synthetic/gate' },
    multiple.dependencies,
  );
  assert.equal(verified.backendProvenanceVerified, true);
  assert.equal(verified.resourcesVerified, true);

  for (const fixture of [
    runtimeResourceHarness({ signatureTeamId: 'WRONGTEAM' }),
    runtimeResourceHarness({ signatureCdHash: '0'.repeat(40) }),
    runtimeResourceHarness({ signatureOuTeamId: 'WRONGTEAM' }),
    runtimeResourceHarness({ signatureOuQuoted: false }),
    runtimeResourceHarness({ signatureOuMissing: true }),
    runtimeResourceHarness({ signatureVerifyFailed: true }),
    runtimeResourceHarness({ executableUid: 0 }),
  ]) {
    const runtime = await inspectI111RuntimeResources(
      { gateRoot: '/synthetic/gate' },
      fixture.dependencies,
    );
    assert.equal(runtime.backendProvenanceVerified, false);
    assert.equal(runtime.resourcesVerified, false);
    assert.equal(fixture.tcpCalls(), 0);
  }
});

test('requires socket, PostgreSQL and Redis listeners to share one verified backend root', async () => {
  const fixture = runtimeResourceHarness({ separateRedisBackend: true });
  const runtime = await inspectI111RuntimeResources(
    { gateRoot: '/synthetic/gate' },
    fixture.dependencies,
  );
  assert.equal(runtime.socketBackendVerified, true);
  assert.equal(runtime.postgresBackendVerified, true);
  assert.equal(runtime.redisBackendVerified, true);
  assert.equal(runtime.backendProvenanceVerified, false);
  assert.equal(runtime.resourcesVerified, false);
  assert.equal(fixture.tcpCalls(), 0);
  let databaseCalls = 0;
  let redisCalls = 0;
  await run({
    runtimeResult: runtime,
    open: () => {
      databaseCalls += 1;
    },
    redisInspector: () => {
      redisCalls += 1;
    },
  });
  assert.equal(databaseCalls, 0);
  assert.equal(redisCalls, 0);
});

test('rejects wrong Docker socket type, owner, replaced path and daemon provenance', () => {
  const evidence = {
    canonicalPath: '/Users/li/.docker/run/docker.sock',
    uid: 501,
    before: { symbolicLink: false, socket: true, dev: 1, ino: 2, uid: 501, mode: 0o140600 },
    after: { symbolicLink: false, socket: true, dev: 1, ino: 2, uid: 501, mode: 0o140600 },
  };
  assert.equal(validateDockerSocketEvidence(evidence), true);
  assert.equal(
    validateDockerSocketEvidence({ ...evidence, before: { ...evidence.before, socket: false } }),
    false,
  );
  assert.equal(validateDockerSocketEvidence({ ...evidence, uid: 502 }), false);
  assert.equal(
    validateDockerSocketEvidence({ ...evidence, after: { ...evidence.after, ino: 3 } }),
    false,
  );
  assert.equal(
    validateDockerSocketEvidence({ ...evidence, canonicalPath: '/tmp/replaced.sock' }),
    false,
  );

  const processRow = (pid, ppid) => ({
    pid,
    ppid,
    uid: 501,
    executable: '/Applications/Docker.app/Contents/MacOS/com.docker.backend',
  });
  const processes = new Map([
    [10, processRow(10, 1)],
    [11, processRow(11, 10)],
    [12, processRow(12, 10)],
  ]);
  const vnodes = new Map([
    [11, { dev: 1, ino: 2 }],
    [12, { dev: 1, ino: 2 }],
  ]);
  const provenance = validateDockerBackendProvenance({
    groups: { socket: [11], postgres: [11], redis: [12] },
    processes,
    executable: { signatureVerified: false, dev: 1, ino: 2, uid: 501 },
    vnodes,
    uid: 501,
  });
  assert.equal(provenance.commonBackendVerified, false);
});

test('detects a Worker or Redis task appearing between the two non-atomic samples', async () => {
  let runtimeCalls = 0;
  const workerRace = await runI111ReadonlyRuntimePreflight({
    env: env(),
    internalToken: I111_PREFLIGHT_INTERNAL_TOKEN,
    dependencies: {
      fileInspector: () => validFiles(),
      sourceInspector: () => validSource(),
      runtimeInspector: () => {
        runtimeCalls += 1;
        return { ...validRuntime(), genericWorkerRunning: runtimeCalls === 2 };
      },
      redisInspector: () => ({ verified: true, queuedJobs: 0 }),
      openDatabase: () => fakeDatabase().client,
    },
  });
  assert.equal(runtimeCalls, 2);
  assert.ok(workerRace.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'));
  assert.equal(workerRace.checks.processAndRedisSampling, 'STOP');

  let redisCalls = 0;
  const queueRace = await runI111ReadonlyRuntimePreflight({
    env: env(),
    internalToken: I111_PREFLIGHT_INTERNAL_TOKEN,
    dependencies: {
      fileInspector: () => validFiles(),
      sourceInspector: () => validSource(),
      runtimeInspector: () => validRuntime(),
      redisInspector: () => {
        redisCalls += 1;
        return { verified: true, queuedJobs: redisCalls === 1 ? 0 : 1 };
      },
      openDatabase: () => fakeDatabase().client,
    },
  });
  assert.equal(redisCalls, 2);
  assert.ok(queueRace.errorCodes.includes('I111_RUNTIME_NOT_ISOLATED'));
  assert.equal(queueRace.checks.redis, 'STOP');
});

test('never treats source regexes as proof that provider retry semantics are disabled', async () => {
  const { result } = await run();
  assert.ok(!result.errorCodes.includes('I111_RETRY_SEMANTICS_UNVERIFIED'));
  assert.equal(result.checks.retrySemantics, 'DEFERRED_TO_TRUSTED_COORDINATOR');
  assert.equal(result.checks.atomicIsolation, 'DEFERRED_TO_TRUSTED_COORDINATOR');
  assert.equal(result.checks.processAndRedisSampling, 'PASS');
});

test('verifies the exact GitHub review identity, state, URL and commit through the API path', async () => {
  const sha = '1'.repeat(40);
  const approval = {
    approvedBy: 'Fredilly',
    approvedCommit: sha,
    approvalUrl: 'https://github.com/Fredilly/Xiaohai/pull/242#pullrequestreview-12345',
  };
  const valid = {
    id: 12345,
    user: { login: 'Fredilly' },
    state: 'APPROVED',
    commit_id: sha,
    html_url: approval.approvalUrl,
  };
  const commandRunner = async (command, args) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, [
      'api',
      '--hostname',
      'github.com',
      '--method',
      'GET',
      'repos/Fredilly/Xiaohai/pulls/242/reviews/12345',
    ]);
    return { status: 0, stdout: JSON.stringify(valid), stderr: '' };
  };
  assert.equal(
    await verifyGitHubApproval(approval, sha, {
      commandRunner,
      env: { GH_HOST: 'attacker.example.invalid' },
    }),
    true,
  );
  for (const mutation of [
    { id: 54321 },
    { user: { login: 'someone-else' } },
    { state: 'COMMENTED' },
    { commit_id: '2'.repeat(40) },
    { html_url: approval.approvalUrl + '-wrong' },
  ]) {
    assert.equal(
      await verifyGitHubApproval(approval, sha, {
        commandRunner: async () => ({
          status: 0,
          stdout: JSON.stringify({ ...valid, ...mutation }),
          stderr: '',
        }),
      }),
      false,
    );
  }
  assert.equal(
    await verifyGitHubApproval(approval, sha, {
      commandRunner: async () => ({ status: 1, stdout: '', stderr: 'redacted failure' }),
      env: { GH_HOST: 'attacker.example.invalid' },
    }),
    false,
  );
  for (const alteredApproval of [
    { approvedCommit: '2'.repeat(40) },
    { approvedBy: 'unknown' },
    { approvalUrl: 'https://attacker.example/Fredilly/Xiaohai/pull/239#pullrequestreview-12345' },
    { approvalUrl: 'https://github.com/Other/Xiaohai/pull/239#pullrequestreview-12345' },
    { approvalUrl: 'https://github.com/Fredilly/Xiaohai/pull/239#pullrequestreview-12345' },
    { approvalUrl: 'https://github.com/Fredilly/Xiaohai/pull/0#pullrequestreview-12345' },
  ]) {
    let reviewQueries = 0;
    assert.equal(
      await verifyGitHubApproval({ ...approval, ...alteredApproval }, sha, {
        commandRunner: async () => {
          reviewQueries += 1;
          throw new Error('invalid approval should not query GitHub');
        },
      }),
      false,
    );
    assert.equal(reviewQueries, 0);
  }
});

test('real source inspection separates local consistency from independent review proof', async () => {
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const sha = '3'.repeat(40);
  const commandRunner = async (_command, args) => {
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${sha}\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const unsigned = await loadI111SourceState(root, null, {
    secureRead: readFile,
    commandRunner,
    reviewVerifier: async () => {
      throw new Error('must not query review without a consistent local record');
    },
  });
  assert.equal(unsigned.localApprovalRecordConsistent, false);
  assert.equal(unsigned.independentReviewVerified, false);
  assert.ok(unsigned.errors.includes('I111_CODE_NOT_REVIEWED'));

  const approval = {
    schemaVersion: 1,
    approvedBy: 'Fredilly',
    approvalUrl: 'https://github.com/Fredilly/Xiaohai/pull/242#pullrequestreview-12345',
    approvedCommit: sha,
    migrationDigest: unsigned.migrationDigest,
    sourceSha256: unsigned.sourceHashes,
  };
  const verified = await loadI111SourceState(root, approval, {
    secureRead: readFile,
    commandRunner,
    reviewVerifier: async () => true,
  });
  assert.equal(verified.localApprovalRecordConsistent, true);
  assert.equal(verified.independentReviewVerified, true);
  assert.equal(verified.signedTtlSeconds, 900);
  assert.deepEqual(verified.errors, []);

  const wrongPrApproval = {
    ...approval,
    approvalUrl: 'https://github.com/Fredilly/Xiaohai/pull/239#pullrequestreview-12345',
  };
  let wrongPrReviewQueries = 0;
  const wrongPr = await loadI111SourceState(root, wrongPrApproval, {
    secureRead: readFile,
    commandRunner,
    reviewVerifier: async () => {
      wrongPrReviewQueries += 1;
      return true;
    },
  });
  assert.equal(wrongPr.localApprovalRecordConsistent, false);
  assert.equal(wrongPr.independentReviewVerified, false);
  assert.equal(wrongPrReviewQueries, 0);
  assert.ok(wrongPr.errors.includes('I111_CODE_NOT_REVIEWED'));

  const drifted = structuredClone(approval);
  drifted.sourceSha256['apps/worker/src/image-processor.ts'] = '0'.repeat(64);
  let reviewCalled = false;
  const rejected = await loadI111SourceState(root, drifted, {
    secureRead: readFile,
    commandRunner,
    reviewVerifier: async () => {
      reviewCalled = true;
      return true;
    },
  });
  assert.equal(reviewCalled, false);
  assert.equal(rejected.localApprovalRecordConsistent, false);
  assert.ok(rejected.errors.includes('I111_CODE_NOT_REVIEWED'));
});

test('requires trusted approval, clean source, signer TTL and migration provenance', async () => {
  for (const mutate of [
    (source) => {
      source.versionMatch = false;
      source.errors = ['I111_CODE_NOT_REVIEWED'];
    },
    (source) => (source.signedTtlSeconds = 300),
    (source) => (source.migrations = []),
  ]) {
    const source = validSource();
    mutate(source);
    const { result } = await run({ sourceResult: source });
    assert.ok(
      result.errorCodes.includes('I111_CODE_NOT_REVIEWED') ||
        result.errorCodes.includes('I111_PROVIDER_CONFIG_INVALID') ||
        result.errorCodes.includes('I111_MIGRATION_STATE_INVALID'),
    );
    assert.equal(result.paidExecutionAuthorized, false);
  }
});

test('classifies any extraneous budget window or reservation as STOP', async () => {
  const rows = baseRows();
  rows.windows.push({
    budget_key: 'UNEXPECTED',
    window_key: 'OTHER',
    scope_type: 'GLOBAL',
    consumer_user_id: null,
    limit_minor: 200,
    reserved_minor: 0,
    actual_minor: 0,
  });
  const { result } = await run({ rows, sourceResult: validSource(rows) });
  assert.ok(result.errorCodes.includes('I111_BUDGET_INVALID'));
});

test('stops on backup mismatch, insufficient headroom, and unsettled AT_RISK cost', async () => {
  const backup = validFiles();
  backup.backupVerified = false;
  backup.errors = ['I111_BACKUP_NOT_VERIFIED'];
  assert.ok(
    (await run({ fileResult: backup })).result.errorCodes.includes('I111_BACKUP_NOT_VERIFIED'),
  );

  const budgetRows = baseRows();
  budgetRows.windows = [
    {
      budget_key: scope.budgetKey,
      window_key: scope.windowKey,
      scope_type: 'GLOBAL',
      consumer_user_id: null,
      limit_minor: 200,
      reserved_minor: 0,
      actual_minor: 190,
    },
    {
      budget_key: scope.budgetKey,
      window_key: scope.windowKey,
      scope_type: 'CONSUMER',
      consumer_user_id: scope.ownerId,
      limit_minor: 200,
      reserved_minor: 0,
      actual_minor: 190,
    },
  ];
  assert.ok(
    (
      await run({ rows: budgetRows, sourceResult: validSource(budgetRows) })
    ).result.errorCodes.includes('I111_BUDGET_INVALID'),
  );

  const atRiskRows = baseRows();
  atRiskRows.reservations.push({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    budget_key: scope.budgetKey,
    window_key: scope.windowKey,
    consumer_user_id: scope.ownerId,
    resource_type: 'PICTURE_BOOK_IMAGE',
    resource_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    status: 'RESERVED',
    uncertainty: 'AT_RISK',
    provider: 'BAILIAN',
    model: scope.model,
    reserved_minor: 25,
    actual_minor: null,
    provider_request_id: null,
  });
  assert.ok(
    (
      await run({ rows: atRiskRows, sourceResult: validSource(atRiskRows) })
    ).result.errorCodes.includes('I111_BUDGET_INVALID'),
  );
});

test('requires a real READY media join for historical successful illustrations', async () => {
  const rows = baseRows();
  const illustrationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  rows.illustrations.push({
    id: illustrationId,
    book_id: scope.bookId,
    page_id: scope.page1Id,
    revision_number: 1,
    provider: 'BAILIAN',
    model: scope.model,
    status: 'READY',
    media_asset_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    media_id: null,
  });
  rows.reservations.push({
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    budget_key: scope.budgetKey,
    window_key: scope.windowKey,
    consumer_user_id: scope.ownerId,
    resource_type: 'PICTURE_BOOK_IMAGE',
    resource_id: illustrationId,
    status: 'SETTLED',
    uncertainty: 'NONE',
    provider: 'BAILIAN',
    model: scope.model,
    reserved_minor: 25,
    actual_minor: 22,
    provider_request_id: 'opaque-request',
  });
  rows.ledgers.push({
    reservation_id: rows.reservations[0].id,
    consumer_user_id: scope.ownerId,
    resource_type: 'PICTURE_BOOK_IMAGE',
    resource_id: illustrationId,
    provider: 'BAILIAN',
    model: scope.model,
    outcome: 'SUCCEEDED',
    amount_minor: 22,
    usage: slotMarker,
    provider_request_id: 'opaque-request',
  });
  const { result } = await run({ rows, sourceResult: validSource(rows) });
  assert.ok(result.errorCodes.includes('I111_BUDGET_INVALID'));
  assert.ok(result.errorCodes.includes('I111_PRICE_BASIS_UNVERIFIED'));
});

test('rejects unallowlisted connection URLs without opening a connection', async () => {
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

test('rejects CLI arguments before any filesystem, runtime, Redis or database inspection', async () => {
  let touched = false;
  const result = await runI111ReadonlyRuntimePreflight({
    argv: ['--execute'],
    dependencies: {
      fileInspector: () => {
        touched = true;
      },
      runtimeInspector: () => {
        touched = true;
      },
      redisInspector: () => {
        touched = true;
      },
      openDatabase: () => {
        touched = true;
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
  const emptyOverride = await runI111ReadonlyRuntimePreflight({ argv: [] });
  assert.deepEqual(emptyOverride, {
    result: 'STOP',
    errorCodes: ['I111_ARGUMENTS_FORBIDDEN'],
    paidExecutionAuthorized: false,
    checks: {},
  });
});

test('rejects symlinks and detects same-handle metadata changes', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.i111-secure-read-'));
  try {
    const target = join(directory, 'target');
    const link = join(directory, 'link');
    await writeFile(target, 'safe', { mode: 0o600 });
    await symlink(target, link);
    await assert.rejects(() => secureReadFile(link, { mode: 0o600, maxBytes: 16 }));

    const linkedParent = join(directory, 'linked-parent');
    await symlink(directory, linkedParent);
    await assert.rejects(() =>
      secureReadFile(join(linkedParent, 'target'), { mode: 0o600, maxBytes: 16 }),
    );

    let statCall = 0;
    const fakeStat = () => {
      statCall += 1;
      return {
        isFile: () => true,
        dev: 1n,
        ino: 2n,
        size: 4n,
        mode: 0o100600n,
        uid: BigInt(process.getuid()),
        mtimeNs: BigInt(statCall),
        ctimeNs: 1n,
      };
    };
    const fakeHandle = {
      stat: async () => fakeStat(),
      read: async (buffer, offset, length) => {
        const bytes = Buffer.from('safe');
        if (offset >= bytes.length) return { bytesRead: 0, buffer };
        const bytesRead = Math.min(length, bytes.length - offset);
        bytes.copy(buffer, offset, offset, offset + bytesRead);
        return { bytesRead, buffer };
      },
      close: async () => {},
    };
    await assert.rejects(() =>
      secureReadFile(target, { mode: 0o600, maxBytes: 16 }, { open: async () => fakeHandle }),
    );

    const stableStat = {
      isFile: () => true,
      dev: 1n,
      ino: 2n,
      size: 4n,
      mode: 0o100600n,
      uid: BigInt(process.getuid()),
      mtimeNs: 1n,
      ctimeNs: 1n,
    };
    const growingHandle = {
      stat: async () => stableStat,
      read: async (buffer, offset, length) => {
        const bytes = Buffer.from('safex');
        if (offset >= bytes.length) return { bytesRead: 0, buffer };
        const bytesRead = Math.min(length, bytes.length - offset);
        bytes.copy(buffer, offset, offset, offset + bytesRead);
        return { bytesRead, buffer };
      },
      close: async () => {},
    };
    await assert.rejects(() =>
      secureReadFile(target, { mode: 0o600, maxBytes: 16 }, { open: async () => growingHandle }),
    );

    let watchedParentCalls = 0;
    await assert.rejects(() =>
      secureReadFile(
        target,
        { mode: 0o600, maxBytes: 16 },
        {
          lstat: async (path) => {
            const info = await lstat(path);
            if (path !== directory || (watchedParentCalls += 1) === 1) return info;
            return new Proxy(info, {
              get(object, property) {
                if (property === 'ino') return object.ino + 1;
                const value = object[property];
                return typeof value === 'function' ? value.bind(object) : value;
              },
            });
          },
        },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('redacts configuration and backend failures', async () => {
  const secret = 'private-secret-never-echo';
  const environment = env();
  environment.PICTURE_BOOK_IMAGE_BASE_URL = 'https://wrong.example.invalid';
  environment.DASHSCOPE_API_KEY = secret;
  delete environment.BAIDU_BOS_SECRET_ACCESS_KEY;
  const configResult = (await run({ environment })).result;
  assert.ok(configResult.errorCodes.includes('I111_PROVIDER_CONFIG_INVALID'));
  assert.ok(configResult.errorCodes.includes('I111_PROVIDER_CREDENTIALS_MISSING'));
  assert.ok(!JSON.stringify(configResult).includes(secret));

  const databaseResult = (
    await run({
      open: () => {
        throw new Error(secret);
      },
    })
  ).result;
  assert.ok(databaseResult.errorCodes.includes('I111_DATABASE_CHECK_FAILED'));
  assert.ok(!JSON.stringify(databaseResult).includes(secret));
  assert.equal(databaseResult.paidExecutionAuthorized, false);
});
