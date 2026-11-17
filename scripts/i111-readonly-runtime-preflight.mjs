import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  assessI111OneShotSnapshot,
  I111_ONE_SHOT_SCOPE as scope,
} from './i111-one-shot-policy.mjs';

const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));

export const I111_READONLY_PATHS = Object.freeze({
  gateRoot: '/Volumes/Data/Xiaohai-i111-gate-b',
  backup:
    '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/evidence/storyboard-preapply-699ab7c-20261116T170840.dump',
  mimi: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/assets/mimi_reference_candidate.png',
  pip: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/assets/pip_reference_candidate.png',
  apiMode: '/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/api.mode',
});

const EXPECTED = Object.freeze({
  gateSha: '6898d09a3fcf76c5006ab271d0168643de2bf1fd',
  databaseUser: 'xiaohai_i111_app',
  databasePort: '52511',
  bucket: 'xiaohai-i111-work-2ec3900280',
  bosEndpoint: 'https://cd.bcebos.com/',
  backupSha256: 'a920f381a1aab434cef041c6d6ab470a3d546f245426185aaea606ec4cede603',
  backupBytes: 338_025,
  mimiSha256: 'a50abb6b7195a2be7886b47351f259c930aca36ebacec500b6fbfab65136f304',
  mimiBytes: 1_843_161,
  pipSha256: 'af3845b30a28a82c7cbcc491b76c1291355009c347274437ff23968ee144c06d',
  pipBytes: 738_959,
  migrationCount: 42,
});

const ALLOWED_CODES = new Set([
  'I111_ARGUMENTS_FORBIDDEN',
  'I111_ATTEMPTS_INVALID',
  'I111_ATTEMPT_COUNT_INVALID',
  'I111_BACKUP_NOT_VERIFIED',
  'I111_BOOK_SCOPE_INVALID',
  'I111_BUDGET_INVALID',
  'I111_CODE_NOT_REVIEWED',
  'I111_DATABASE_CHECK_FAILED',
  'I111_DATABASE_IDENTITY_INVALID',
  'I111_ENV_INVALID',
  'I111_MIGRATION_STATE_INVALID',
  'I111_PRICE_BASIS_UNVERIFIED',
  'I111_PREVIOUS_ATTEMPT_INVALID',
  'I111_PROVIDER_CONFIG_INVALID',
  'I111_PROVIDER_CREDENTIALS_MISSING',
  'I111_REFERENCES_INVALID',
  'I111_RUNTIME_NOT_ISOLATED',
  'I111_NEXT_SLOT_INVALID',
  'I111_SNAPSHOT_INVALID',
  'I111_UNEXPECTED_FAILURE',
]);

const SLOT_MARKER = JSON.stringify({
  benchmark: 'I111_MAC_PLAN_B',
  marker: 'PROVIDER_POST_SLOT_CONSUMED',
  inputImageCount: 2,
  outputImageCount: 1,
  expectedInputUnitMinor: 2,
  expectedOutputUnitMinor: 18,
  expectedChargeMinor: 22,
  actualChargeVerified: false,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function integer(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function secretPresent(value) {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 512 &&
    !value.startsWith('INJECT_') &&
    !/placeholder|example|changeme/i.test(value)
  );
}

function safeCodes(codes) {
  if (codes.some((code) => !ALLOWED_CODES.has(code))) return ['I111_UNEXPECTED_FAILURE'];
  return [...new Set(codes)].sort();
}

function validateLocalDatabaseUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'postgresql:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== EXPECTED.databasePort ||
      url.pathname !== '/' + scope.databaseName ||
      url.username !== EXPECTED.databaseUser ||
      !url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function inspectConfiguration(env, signedTtlSeconds) {
  const errors = [];
  const timeout = integer(env.PICTURE_BOOK_IMAGE_TIMEOUT_MS);
  const reservation = integer(env.PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR);
  const globalLimit = integer(env.PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR);
  const consumerLimit = integer(env.PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR);
  let workspaceBound = false;
  try {
    const workspace = env.DASHSCOPE_WORKSPACE_ID;
    const endpoint = new URL(env.PICTURE_BOOK_IMAGE_BASE_URL);
    workspaceBound =
      typeof workspace === 'string' &&
      /^ws-[a-z0-9-]{6,80}$/.test(workspace) &&
      endpoint.protocol === 'https:' &&
      endpoint.hostname === workspace + '.cn-beijing.maas.aliyuncs.com' &&
      endpoint.pathname === '/compatible-mode/v1' &&
      !endpoint.port &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash;
  } catch {
    workspaceBound = false;
  }

  let bosBound = false;
  try {
    const endpoint = new URL(env.BAIDU_BOS_ENDPOINT);
    const origin = new URL(env.BAIDU_BOS_PUBLIC_ORIGIN);
    bosBound =
      env.BAIDU_BOS_BUCKET === EXPECTED.bucket &&
      endpoint.toString() === EXPECTED.bosEndpoint &&
      origin.protocol === 'https:' &&
      origin.hostname === EXPECTED.bucket + '.cd.bcebos.com' &&
      origin.pathname === '/' &&
      !origin.port &&
      !origin.search &&
      !origin.hash &&
      !origin.username &&
      !origin.password;
  } catch {
    bosBound = false;
  }

  const imageEnabled = env.PICTURE_BOOK_IMAGE_ENABLED === 'true';
  const budgetEnabled = env.PICTURE_BOOK_IMAGE_BUDGET_ENABLED === 'true';
  if (
    env.APP_ENV !== 'dev' ||
    env.NODE_ENV === 'production' ||
    env.TEST_DATABASE_URL !== undefined
  ) {
    errors.push('I111_ENV_INVALID');
  }
  if (
    !imageEnabled ||
    env.PICTURE_BOOK_IMAGE_PROVIDER !== scope.provider ||
    env.PICTURE_BOOK_IMAGE_MODEL !== scope.model ||
    !workspaceBound ||
    !bosBound ||
    signedTtlSeconds !== scope.signedTtlSeconds ||
    timeout === null ||
    timeout < 600_000 ||
    timeout > 780_000
  ) {
    errors.push('I111_PROVIDER_CONFIG_INVALID');
  }
  if (
    !budgetEnabled ||
    env.PICTURE_BOOK_IMAGE_BUDGET_KEY !== scope.budgetKey ||
    env.PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY !== scope.windowKey ||
    reservation !== scope.reservationMinor ||
    globalLimit !== scope.budgetLimitMinor ||
    consumerLimit !== scope.budgetLimitMinor
  ) {
    errors.push('I111_BUDGET_INVALID');
  }
  if (
    !secretPresent(env.DASHSCOPE_API_KEY) ||
    !secretPresent(env.BAIDU_BOS_ACCESS_KEY_ID) ||
    !secretPresent(env.BAIDU_BOS_SECRET_ACCESS_KEY)
  ) {
    errors.push('I111_PROVIDER_CREDENTIALS_MISSING');
  }

  return {
    errors,
    runtime: {
      imageEnabled,
      provider: env.PICTURE_BOOK_IMAGE_PROVIDER,
      model: env.PICTURE_BOOK_IMAGE_MODEL,
      beijingWorkspaceBound: workspaceBound,
      signedTtlSeconds,
      imageTimeoutMs: timeout,
    },
    budget: {
      enabled: budgetEnabled,
      budgetKey: env.PICTURE_BOOK_IMAGE_BUDGET_KEY,
      windowKey: env.PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY,
      reservationMinor: reservation,
      globalLimitMinor: globalLimit,
      consumerLimitMinor: consumerLimit,
      // Offline configuration and a planning estimate cannot prove the provider invoice.
      costBasisVerified: false,
    },
  };
}

async function inspectFile(path, expectedHash, expectedBytes, dependencies) {
  const [bytes, info] = await Promise.all([dependencies.readFile(path), dependencies.stat(path)]);
  return (
    info.isFile() &&
    (info.mode & 0o777) === 0o600 &&
    bytes.byteLength === expectedBytes &&
    sha256(bytes) === expectedHash
  );
}

async function inspectFiles(paths, dependencies) {
  const errors = [];
  let backupVerified = false;
  let mimiMatched = false;
  let pipMatched = false;
  let apiModeDisabled = false;
  try {
    const backup = await dependencies.readFile(paths.backup);
    const backupInfo = await dependencies.stat(paths.backup);
    backupVerified =
      backupInfo.isFile() &&
      (backupInfo.mode & 0o777) === 0o600 &&
      backup.byteLength === EXPECTED.backupBytes &&
      backup.subarray(0, 5).toString('ascii') === 'PGDMP' &&
      sha256(backup) === EXPECTED.backupSha256;
    [mimiMatched, pipMatched] = await Promise.all([
      inspectFile(paths.mimi, EXPECTED.mimiSha256, EXPECTED.mimiBytes, dependencies),
      inspectFile(paths.pip, EXPECTED.pipSha256, EXPECTED.pipBytes, dependencies),
    ]);
    apiModeDisabled = (await dependencies.readFile(paths.apiMode, 'utf8')).trim() === 'disabled';
  } catch {
    // The fixed error codes below deliberately omit paths and underlying messages.
  }
  if (!backupVerified) errors.push('I111_BACKUP_NOT_VERIFIED');
  if (!mimiMatched || !pipMatched) errors.push('I111_REFERENCES_INVALID');
  if (!apiModeDisabled) errors.push('I111_RUNTIME_NOT_ISOLATED');
  return { errors, backupVerified, mimiMatched, pipMatched };
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status === null) throw new Error('COMMAND_FAILED');
  return { status: result.status, stdout: result.stdout };
}

function defaultRuntimeInspector(paths) {
  const gateHead = runCommand('git', ['-C', paths.gateRoot, 'rev-parse', 'HEAD']).stdout.trim();
  const gateStatus = runCommand('git', [
    '-C',
    paths.gateRoot,
    'status',
    '--porcelain=v1',
    '--untracked-files=no',
  ]);
  const lsof = runCommand('lsof', ['-nP', '-iTCP:52513', '-sTCP:LISTEN']);
  const ps = runCommand('ps', ['-axo', 'command=']);
  const workerPattern = /(?:apps\/worker|@xiaohai\/worker|dist\/[^ ]*worker)/;
  return {
    gateVerified:
      gateHead === EXPECTED.gateSha && gateStatus.status === 0 && gateStatus.stdout === '',
    apiRunning: lsof.status === 0 && lsof.stdout.trim() !== '',
    genericWorkerRunning:
      ps.status !== 0 || ps.stdout.split('\n').some((line) => workerPattern.test(line)),
  };
}

function defaultGitSha(root) {
  const result = runCommand('git', ['rev-parse', 'HEAD'], root);
  if (result.status !== 0 || !/^[0-9a-f]{40}\n?$/.test(result.stdout))
    throw new Error('GIT_FAILED');
  return result.stdout.trim();
}

function referenceFingerprint(row) {
  const digest = row.name === 'Mimi' ? EXPECTED.mimiSha256 : EXPECTED.pipSha256;
  const expectedBytes = row.name === 'Mimi' ? EXPECTED.mimiBytes : EXPECTED.pipBytes;
  const expectedKey = `picture-books/character-references/i111/${scope.ownerId}/${scope.bookId}/${row.character_id}/${digest}.png`;
  let privateBos = false;
  try {
    const playback = new URL(row.playback_url);
    privateBos =
      playback.protocol === 'https:' &&
      playback.hostname === EXPECTED.bucket + '.cd.bcebos.com' &&
      [new URL('/' + expectedKey, playback).pathname, '//' + expectedKey].includes(
        playback.pathname,
      ) &&
      !playback.search &&
      !playback.hash &&
      !playback.username &&
      !playback.password;
  } catch {
    privateBos = false;
  }
  return {
    name: row.name,
    confirmed: row.confirmed === true,
    locked: row.locked === true,
    status: row.reference_status,
    imported: row.reference_provider === 'IMPORTED',
    privateBos:
      privateBos &&
      row.media_provider === 'BAIDU_BOS' &&
      row.media_status === 'READY' &&
      row.mime_type === 'image/png',
    objectKeyMatched: row.object_key === expectedKey && Number(row.byte_size) === expectedBytes,
    sha256Matched: row.name === 'Mimi' || row.name === 'Pip',
  };
}

function emptyWindow() {
  return { actualMinor: 0, reservedMinor: 0 };
}

function classifyCosts(illustrations, reservations, ledgers, windows) {
  const plan = [
    { pageId: scope.page1Id, revisionNumber: 1 },
    { pageId: scope.page2Id, revisionNumber: 1 },
    { pageId: scope.page2Id, revisionNumber: 2 },
  ];
  const attempts = [];
  let invalid = false;
  for (let index = 0; index < illustrations.length; index += 1) {
    const illustration = illustrations[index];
    const expected = plan[index];
    const matches = reservations.filter((item) => item.resource_id === illustration.id);
    const reservation = matches[0];
    const ledgerMatches = reservation
      ? ledgers.filter((item) => item.reservation_id === reservation.id)
      : [];
    const ledger = ledgerMatches[0];
    if (
      !expected ||
      illustration.page_id !== expected.pageId ||
      illustration.revision_number !== expected.revisionNumber ||
      illustration.provider !== scope.provider ||
      illustration.model !== scope.model ||
      matches.length !== 1 ||
      ledgerMatches.length !== 1 ||
      reservation.budget_key !== scope.budgetKey ||
      reservation.window_key !== scope.windowKey ||
      reservation.consumer_user_id !== scope.ownerId ||
      reservation.resource_type !== 'PICTURE_BOOK_IMAGE' ||
      reservation.provider !== scope.provider ||
      reservation.model !== scope.model ||
      reservation.reserved_minor !== scope.reservationMinor ||
      ledger.consumer_user_id !== scope.ownerId ||
      ledger.resource_type !== 'PICTURE_BOOK_IMAGE' ||
      ledger.resource_id !== illustration.id ||
      ledger.provider !== scope.provider ||
      ledger.model !== scope.model ||
      ledger.usage !== SLOT_MARKER
    ) {
      invalid = true;
      continue;
    }
    attempts.push({
      pageId: illustration.page_id,
      revisionNumber: illustration.revision_number,
      outcome: ledger.outcome,
      mediaReady: illustration.status === 'READY' && Boolean(illustration.media_asset_id),
      settled: reservation.status === 'SETTLED' && reservation.uncertainty === 'NONE',
      completeCostVerified:
        ledger.outcome === 'SUCCEEDED' &&
        reservation.actual_minor !== null &&
        ledger.amount_minor === reservation.actual_minor,
      providerRequestIdPresent:
        Boolean(reservation.provider_request_id) &&
        reservation.provider_request_id === ledger.provider_request_id,
      reservedMinor: reservation.reserved_minor,
      actualMinor: reservation.actual_minor,
    });
  }
  if (reservations.length !== illustrations.length || ledgers.length !== illustrations.length) {
    invalid = true;
  }
  if (![0, 2].includes(windows.length)) invalid = true;

  const globalRows = windows.filter(
    (row) => row.scope_type === 'GLOBAL' && row.consumer_user_id === null,
  );
  const consumerRows = windows.filter(
    (row) => row.scope_type === 'CONSUMER' && row.consumer_user_id === scope.ownerId,
  );
  const noCosts = illustrations.length === 0 && reservations.length === 0 && ledgers.length === 0;
  const window = (rows) => {
    if (rows.length === 0 && noCosts) return emptyWindow();
    if (rows.length !== 1 || rows[0].limit_minor !== scope.budgetLimitMinor) {
      invalid = true;
      return {};
    }
    return { actualMinor: rows[0].actual_minor, reservedMinor: rows[0].reserved_minor };
  };
  const unsettledAtRisk =
    reservations.filter((row) => row.uncertainty === 'AT_RISK').length +
    ledgers.filter((row) => row.outcome === 'AT_RISK').length;
  return {
    attempts,
    invalid,
    unsettledAtRisk,
    globalWindow: window(globalRows),
    consumerWindow: window(consumerRows),
  };
}

async function collectDatabase(connectionString, openDatabase, expectedMigrationTimes) {
  const client = await openDatabase(connectionString);
  let transaction = false;
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const identity = await client.query(
      "/* I111_IDENTITY */ SELECT current_database() AS database_name, current_user AS database_user, current_setting('transaction_read_only') AS transaction_read_only, pg_is_in_recovery() AS is_replica",
    );
    const id = identity.rows[0];
    if (
      identity.rows.length !== 1 ||
      id.database_name !== scope.databaseName ||
      id.database_user !== EXPECTED.databaseUser ||
      id.transaction_read_only !== 'on' ||
      id.is_replica !== false
    ) {
      return { errors: ['I111_DATABASE_IDENTITY_INVALID'] };
    }
    const migration = await client.query(
      '/* I111_MIGRATIONS */ SELECT created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    const migrationValid =
      expectedMigrationTimes.length === EXPECTED.migrationCount &&
      migration.rows.length === EXPECTED.migrationCount &&
      migration.rows.every(
        (row, index) => String(row.created_at) === String(expectedMigrationTimes[index]),
      );
    const bookResult = await client.query(
      '/* I111_BOOK */ SELECT id, consumer_user_id, ai_project_id, status FROM picture_books WHERE id = $1',
      [scope.bookId],
    );
    const pageResult = await client.query(
      '/* I111_PAGES */ SELECT id, page_number, page_kind, source_ai_job_id, character_ids FROM work_pages WHERE picture_book_id = $1 ORDER BY page_number',
      [scope.bookId],
    );
    const referenceResult = await client.query(
      `/* I111_REFERENCES */ SELECT c.id AS character_id, c.name, c.confirmed, c.locked,
       r.status AS reference_status, r.provider AS reference_provider,
       m.provider AS media_provider, m.status AS media_status, m.mime_type, m.object_key,
       m.playback_url, m.byte_size
       FROM character_profiles c
       JOIN character_reference_images r ON r.character_profile_id = c.id AND r.media_asset_id = c.reference_media_asset_id
       JOIN media_assets m ON m.id = c.reference_media_asset_id
       WHERE c.picture_book_id = $1 ORDER BY c.sort_order`,
      [scope.bookId],
    );
    const activity = await client.query(
      `/* I111_ACTIVITY */ SELECT
       (SELECT count(*)::int FROM ai_jobs WHERE status IN ('QUEUED','RUNNING')) AS active_jobs,
       (SELECT count(*)::int FROM ai_jobs WHERE project_id = $1) AS project_jobs`,
      [bookResult.rows[0]?.ai_project_id ?? null],
    );
    const illustrations = await client.query(
      `/* I111_ILLUSTRATIONS */ SELECT i.id, i.page_id, i.revision_number, i.provider, i.model,
       i.status, i.media_asset_id FROM work_page_illustrations i
       JOIN work_pages p ON p.id = i.page_id WHERE p.picture_book_id = $1
       ORDER BY i.created_at, i.id`,
      [scope.bookId],
    );
    const reservations = await client.query(
      `/* I111_RESERVATIONS */ SELECT id, budget_key, window_key, consumer_user_id,
       resource_type, resource_id, status, uncertainty, provider, model, reserved_minor,
       actual_minor, provider_request_id FROM ai_cost_reservations
       WHERE budget_key = $1 OR resource_id = ANY($2::uuid[]) ORDER BY created_at, id`,
      [scope.budgetKey, illustrations.rows.map((row) => row.id)],
    );
    const ledgers = await client.query(
      `/* I111_LEDGERS */ SELECT l.reservation_id, l.consumer_user_id, l.resource_type,
       l.resource_id, l.provider, l.model, l.outcome, l.amount_minor, l.usage,
       l.provider_request_id FROM ai_cost_ledger l
       JOIN ai_cost_reservations r ON r.id = l.reservation_id
       WHERE r.budget_key = $1 ORDER BY l.created_at, l.id`,
      [scope.budgetKey],
    );
    const windows = await client.query(
      `/* I111_WINDOWS */ SELECT scope_type, consumer_user_id, limit_minor, reserved_minor,
       actual_minor FROM ai_budget_windows WHERE budget_key = $1 AND window_key = $2`,
      [scope.budgetKey, scope.windowKey],
    );

    const book = bookResult.rows[0];
    const pages = pageResult.rows;
    const pageValid =
      pages.length === 3 &&
      pages[0]?.id === scope.coverId &&
      pages[0]?.page_number === 0 &&
      pages[0]?.page_kind === 'COVER' &&
      pages[1]?.id === scope.page1Id &&
      pages[1]?.page_number === 1 &&
      pages[1]?.page_kind === 'CONTENT' &&
      pages[2]?.id === scope.page2Id &&
      pages[2]?.page_number === 2 &&
      pages[2]?.page_kind === 'CONTENT' &&
      pages.every(
        (page) =>
          page.source_ai_job_id === null &&
          Array.isArray(page.character_ids) &&
          page.character_ids.length === 2,
      );
    const bookValid =
      bookResult.rows.length === 1 &&
      book.id === scope.bookId &&
      book.consumer_user_id === scope.ownerId &&
      ['PLANNED', 'ILLUSTRATING', 'READY'].includes(book.status) &&
      pageValid;
    const references = referenceResult.rows.map(referenceFingerprint);
    const referencesValid =
      references.length === 2 &&
      ['Mimi', 'Pip'].every(
        (name) => references.filter((item) => item.name === name).length === 1,
      ) &&
      references.every(
        (item) =>
          item.confirmed &&
          item.locked &&
          item.status === 'READY' &&
          item.imported &&
          item.privateBos &&
          item.objectKeyMatched,
      );
    const costs = classifyCosts(illustrations.rows, reservations.rows, ledgers.rows, windows.rows);
    const errors = [];
    if (!migrationValid) errors.push('I111_MIGRATION_STATE_INVALID');
    if (!bookValid) errors.push('I111_BOOK_SCOPE_INVALID');
    if (!referencesValid) errors.push('I111_REFERENCES_INVALID');
    if (activity.rows[0]?.active_jobs !== 0 || activity.rows[0]?.project_jobs !== 0) {
      errors.push('I111_RUNTIME_NOT_ISOLATED');
    }
    if (costs.invalid || costs.unsettledAtRisk > 0) errors.push('I111_BUDGET_INVALID');
    return {
      errors,
      databaseName: id.database_name,
      dbIdentityVerified: true,
      book: bookValid
        ? {
            id: book.id,
            ownerId: book.consumer_user_id,
            coverId: pages[0].id,
            page1Id: pages[1].id,
            page2Id: pages[2].id,
            status: book.status,
          }
        : {},
      references,
      activity: {
        unrelatedQueuedJobs: activity.rows[0]?.active_jobs ?? -1,
        otherActiveJobs: activity.rows[0]?.project_jobs ?? -1,
      },
      attempts: costs.attempts,
      budget: {
        unaccountedReservations: costs.invalid ? 1 : 0,
        unaccountedLedgerEntries: costs.invalid ? 1 : 0,
        unsettledAtRisk: costs.unsettledAtRisk,
        globalWindow: costs.globalWindow,
        consumerWindow: costs.consumerWindow,
      },
    };
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

function defaultOpenDatabase(connectionString) {
  const pg = requireFromDb('pg');
  return new pg.Client({
    connectionString,
    ssl: false,
    connectionTimeoutMillis: 3_000,
    query_timeout: 8_000,
    options: '-c default_transaction_read_only=on',
  });
}

export async function runI111ReadonlyRuntimePreflight(options = {}) {
  const root = options.root ?? resolve(fileURLToPath(new URL('..', import.meta.url)));
  const env = options.env ?? process.env;
  const paths = options.paths ?? I111_READONLY_PATHS;
  const dependencies = {
    readFile: options.dependencies?.readFile ?? readFile,
    stat: options.dependencies?.stat ?? stat,
    gitSha: options.dependencies?.gitSha ?? defaultGitSha,
    runtimeInspector: options.dependencies?.runtimeInspector ?? defaultRuntimeInspector,
    openDatabase: options.dependencies?.openDatabase ?? defaultOpenDatabase,
    // Test-only raw filesystem adapter; the direct CLI always uses inspectFiles above.
    fileInspector: options.dependencies?.fileInspector ?? inspectFiles,
  };
  const errors = [];
  try {
    if ((options.argv ?? process.argv.slice(2)).length !== 0) {
      return {
        result: 'STOP',
        errorCodes: ['I111_ARGUMENTS_FORBIDDEN'],
        paidExecutionAuthorized: false,
        checks: {},
      };
    }
    const connectionString = validateLocalDatabaseUrl(env.DATABASE_URL);
    if (!connectionString) errors.push('I111_DATABASE_IDENTITY_INVALID');

    const ttlSource = await dependencies.readFile(
      resolve(root, 'packages/config/src/image-runtime-safety.ts'),
      'utf8',
    );
    const ttlMatch = ttlSource.match(
      /^export const PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS = ([\d_]+);$/m,
    );
    const workerSignerSource = await dependencies.readFile(
      resolve(root, 'apps/worker/src/private-bos-reference.ts'),
      'utf8',
    );
    const workerUsesReviewedTtl =
      /export const PRIVATE_REFERENCE_TTL_SECONDS\s*=\s*PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS;/.test(
        workerSignerSource,
      ) &&
      /generatePresignedUrl\([\s\S]*?PRIVATE_REFERENCE_TTL_SECONDS,[\s\S]*?\)/.test(
        workerSignerSource,
      );
    const signedTtlSeconds =
      ttlMatch && workerUsesReviewedTtl ? Number(ttlMatch[1].replaceAll('_', '')) : null;
    const journal = JSON.parse(
      await dependencies.readFile(
        resolve(root, 'packages/db/migrations/meta/_journal.json'),
        'utf8',
      ),
    );
    const migrationTimes = Array.isArray(journal.entries)
      ? journal.entries.map((entry) => entry?.when)
      : [];
    const config = inspectConfiguration(env, signedTtlSeconds);
    errors.push(...config.errors);

    const files = await dependencies.fileInspector(paths, dependencies);
    errors.push(...files.errors);
    let runtime;
    try {
      runtime = await dependencies.runtimeInspector(paths);
      if (!runtime.gateVerified || runtime.apiRunning || runtime.genericWorkerRunning) {
        errors.push('I111_RUNTIME_NOT_ISOLATED');
      }
    } catch {
      runtime = { gateVerified: false, apiRunning: true, genericWorkerRunning: true };
      errors.push('I111_RUNTIME_NOT_ISOLATED');
    }

    let database = { errors: ['I111_DATABASE_IDENTITY_INVALID'] };
    if (connectionString) {
      try {
        database = await collectDatabase(
          connectionString,
          dependencies.openDatabase,
          migrationTimes,
        );
      } catch {
        database = { errors: ['I111_DATABASE_CHECK_FAILED'] };
      }
    }
    errors.push(...database.errors);

    const checkedOutSha = await dependencies.gitSha(root);
    const reviewedSha = env.I111_REVIEWED_SHA;
    if (
      !/^[0-9a-f]{40}$/.test(checkedOutSha) ||
      !/^[0-9a-f]{40}$/.test(reviewedSha ?? '') ||
      checkedOutSha !== reviewedSha
    ) {
      errors.push('I111_CODE_NOT_REVIEWED');
    }

    // A local estimate or environment assertion cannot independently verify the provider invoice.
    errors.push('I111_PRICE_BASIS_UNVERIFIED');
    const attempts = database.attempts ?? [];
    const next = [
      { pageId: scope.page1Id, revisionNumber: 1 },
      { pageId: scope.page2Id, revisionNumber: 1 },
      { pageId: scope.page2Id, revisionNumber: 2 },
    ][attempts.length] ?? { pageId: '', revisionNumber: 0 };
    const snapshot = {
      checkedOutSha,
      reviewedSha,
      appEnv: env.APP_ENV,
      databaseName: database.databaseName,
      dbIdentityVerified: database.dbIdentityVerified === true,
      originalBackupVerified: files.backupVerified,
      backupSha256Matched: files.backupVerified,
      book: database.book ?? {},
      references: (database.references ?? []).map((item) => ({
        ...item,
        sha256Matched:
          item.name === 'Mimi' ? files.mimiMatched : item.name === 'Pip' && files.pipMatched,
      })),
      runtime: {
        ...config.runtime,
        apiRunning: runtime.apiRunning,
        genericWorkerRunning: runtime.genericWorkerRunning,
        unrelatedQueuedJobs: database.activity?.unrelatedQueuedJobs ?? -1,
        otherActiveJobs: database.activity?.otherActiveJobs ?? -1,
        autoRetryEnabled: false,
      },
      budget: {
        ...config.budget,
        ...(database.budget ?? {}),
      },
      attempts,
      requestedPageId: next.pageId,
      requestedRevisionNumber: next.revisionNumber,
    };
    const policy = assessI111OneShotSnapshot(snapshot);
    errors.push(...policy.errorCodes);
    const errorCodes = safeCodes(errors);
    return {
      result: errorCodes.length === 0 && policy.verdict === 'STATIC_REVIEW_ONLY' ? 'PASS' : 'STOP',
      errorCodes,
      paidExecutionAuthorized: false,
      checks: {
        code: errorCodes.includes('I111_CODE_NOT_REVIEWED') ? 'STOP' : 'PASS',
        database: errorCodes.some((code) =>
          ['I111_DATABASE_CHECK_FAILED', 'I111_DATABASE_IDENTITY_INVALID'].includes(code),
        )
          ? 'STOP'
          : 'PASS',
        backup: files.backupVerified ? 'PASS' : 'STOP',
        references:
          files.mimiMatched && files.pipMatched && !errorCodes.includes('I111_REFERENCES_INVALID')
            ? 'PASS'
            : 'STOP',
        runtime: errorCodes.includes('I111_RUNTIME_NOT_ISOLATED') ? 'STOP' : 'PASS',
        providerConfig: errorCodes.some((code) =>
          ['I111_PROVIDER_CONFIG_INVALID', 'I111_PROVIDER_CREDENTIALS_MISSING'].includes(code),
        )
          ? 'STOP'
          : 'PASS',
        budget: errorCodes.some((code) =>
          ['I111_BUDGET_INVALID', 'I111_PRICE_BASIS_UNVERIFIED'].includes(code),
        )
          ? 'STOP'
          : 'PASS',
      },
    };
  } catch {
    return {
      result: 'STOP',
      errorCodes: ['I111_UNEXPECTED_FAILURE'],
      paidExecutionAuthorized: false,
      checks: {},
    };
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = await runI111ReadonlyRuntimePreflight();
  console.log(JSON.stringify(result));
  process.exitCode = result.result === 'PASS' ? 0 : 1;
}
