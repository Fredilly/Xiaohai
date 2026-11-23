import { coordinateI111OneShot, previewI111OneShot } from './i111-one-shot-orchestration.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';
import { verifyI111OwnerGrantPort } from './i111-paid-operation-grant.mjs';
import { runI111ReadonlyRuntimePreflight } from './i111-readonly-runtime-preflight.mjs';

const LOCK_KEY = [111, 20261119];
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const STOP = 'I111_TRUSTED_RUNNER_STOP';
const UNKNOWN = 'I111_TRUSTED_RUNNER_OUTCOME_UNCERTAIN';
const CONNECT_TIMEOUT_MS = 5_000;

const slotOrder = Object.freeze([
  Object.freeze({ pageId: scope.page1Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 2, regenerate: true }),
]);

const stop = (errorCode = STOP) =>
  Object.freeze({ verdict: 'STOP', errorCode, paidExecutionAuthorized: false });

function redactedLogger() {
  return Object.freeze({
    warn: () => undefined,
    error: () => undefined,
  });
}

function noOpQueue() {
  return Object.freeze({
    notify: async () => undefined,
    close: async () => undefined,
  });
}

function bounded(operation, timeoutMs = CONNECT_TIMEOUT_MS, onLateSuccess, onTimeout) {
  let timedOut = false;
  let timer;
  const operationPromise = Promise.resolve()
    .then(operation)
    .then(
      (value) => {
        if (timedOut) onLateSuccess?.(value);
        return value;
      },
      (error) => {
        if (timedOut) return undefined;
        throw error;
      },
    );
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      reject(new Error(UNKNOWN));
    }, timeoutMs);
  });
  return Promise.race([operationPromise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function requireLiveEnvironment(env) {
  if (env.APP_ENV !== 'dev' || env.I111_EXECUTION_MODE !== 'live') return false;
  if (env.paidExecutionAuthorized === true || env.PAID_EXECUTION_AUTHORIZED === 'true') {
    return false;
  }
  return typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.startsWith('postgresql://');
}

function safeSnapshotForDryRun(attempts = []) {
  const next = slotOrder[attempts.length];
  return {
    checkedOutSha: 'a'.repeat(40),
    reviewedSha: 'a'.repeat(40),
    appEnv: 'dev',
    databaseName: scope.databaseName,
    dbIdentityVerified: true,
    originalBackupVerified: true,
    backupSha256Matched: true,
    book: {
      id: scope.bookId,
      ownerId: scope.ownerId,
      coverId: scope.coverId,
      page1Id: scope.page1Id,
      page2Id: scope.page2Id,
      status: 'PLANNED',
    },
    references: ['Mimi', 'Pip'].map((name) => ({
      name,
      locked: true,
      confirmed: true,
      status: 'READY',
      imported: true,
      privateBos: true,
      objectKeyMatched: true,
      sha256Matched: true,
    })),
    runtime: {
      apiRunning: false,
      genericWorkerRunning: false,
      unrelatedQueuedJobs: 0,
      otherActiveJobs: 0,
      autoRetryEnabled: false,
      imageEnabled: true,
      provider: scope.provider,
      model: scope.model,
      beijingWorkspaceBound: true,
      signedTtlSeconds: 900,
      imageTimeoutMs: 600_000,
    },
    budget: {
      enabled: true,
      budgetKey: scope.budgetKey,
      windowKey: scope.windowKey,
      reservationMinor: scope.reservationMinor,
      globalLimitMinor: scope.budgetLimitMinor,
      consumerLimitMinor: scope.budgetLimitMinor,
      costBasisVerified: true,
      unaccountedReservations: 0,
      unaccountedLedgerEntries: 0,
      unsettledAtRisk: 0,
      globalWindow: {
        actualMinor: attempts.reduce((sum, item) => sum + item.actualMinor, 0),
        reservedMinor: 0,
      },
      consumerWindow: {
        actualMinor: attempts.reduce((sum, item) => sum + item.actualMinor, 0),
        reservedMinor: 0,
      },
    },
    attempts,
    requestedPageId: next?.pageId ?? '',
    requestedRevisionNumber: next?.revisionNumber ?? 0,
  };
}

/**
 * Offline end-to-end rehearsal. It uses the production orchestration contract,
 * never opens a socket, and models the durable AT_RISK boundary conservatively.
 */
export async function simulateI111TrustedOneShot({ attempts = [], fault } = {}) {
  if (!Array.isArray(attempts) || attempts.length > scope.maxCalls)
    return stop('I111_SLOT_INVALID');
  if (attempts.length === scope.maxCalls) return stop('I111_FOURTH_CALL_REJECTED');
  const snapshot = safeSnapshotForDryRun(attempts);
  const targetId = '00000000-1111-4222-8333-444444444444';
  const events = [];
  const ports = {
    withExclusiveIsolation: async (operation) => {
      events.push('lock');
      return operation();
    },
    readTrustedSnapshot: async () => snapshot,
    verifyOwnerOperationGrant: async () => {
      events.push('grant');
      return fault === 'old-authorization' ? 'STOP' : 'INDEPENDENT_VERIFIED_ONE_TIME_GRANT';
    },
    verifySlotFreshBeforePrepare: async () => {
      events.push('fresh');
      return fault !== 'duplicate-task';
    },
    prepareViaFormalApi: async ({ pageId, regenerate }) => {
      events.push('api');
      if (fault === 'wrong-page')
        return { pictureBookId: scope.bookId, pageId: scope.coverId, status: 'QUEUED' };
      return {
        pictureBookId: scope.bookId,
        pageId,
        illustrationId: targetId,
        revisionNumber: regenerate ? 2 : 1,
        status: 'QUEUED',
      };
    },
    verifyExactlyOneReservation: async () => {
      events.push('reservation');
      return fault !== 'duplicate-reservation';
    },
    processTargetIdWithAtomicGateOnce: async ({ targetId: id }) => {
      events.push('at-risk');
      if (fault === 'at-risk-persist-failure') throw new Error(UNKNOWN);
      events.push('worker');
      if (fault === 'provider-timeout' || fault === 'bos-500') throw new Error(UNKNOWN);
      if (fault === 'wrong-worker-id') return '00000000-1111-4222-8333-555555555555';
      return id;
    },
    readFinalEvidence: async (id) => {
      events.push('final');
      if (fault === 'worker-result-failure') return { illustrationId: id, status: 'FAILED' };
      return {
        illustrationId: id,
        status: 'SUCCEEDED',
        mediaStatus: 'READY',
        reservationStatus: 'AT_RISK',
        ledgerStatus: 'AT_RISK',
      };
    },
  };
  const result = await coordinateI111OneShot(ports);
  return Object.freeze({ ...result, events: Object.freeze(events) });
}

async function loadRuntimeModules() {
  const [
    { PictureBookService },
    { createI111SourceBoundTargetWorker },
    pgModule,
    drizzleModule,
    operators,
    dbSchema,
  ] = await Promise.all([
    import('../apps/api/src/picture-book/picture-book-service.ts'),
    import('../apps/worker/src/i111-source-bound-target.ts'),
    import('pg'),
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm'),
    import('@xiaohai/db'),
  ]);
  return {
    PictureBookService,
    createI111SourceBoundTargetWorker,
    pg: pgModule.default,
    drizzle: drizzleModule.drizzle,
    and: operators.and,
    eq: operators.eq,
    inArray: operators.inArray,
    dbSchema,
  };
}

async function runLiveUnsafe({ env, root }) {
  if (!requireLiveEnvironment(env)) return stop('I111_LIVE_GATE_STOP');
  const preflight = await runI111ReadonlyRuntimePreflight({ root, env });
  if (preflight.result !== 'PASS' || !preflight.snapshot) return stop('I111_PREFLIGHT_STOP');
  const snapshot = preflight.snapshot;
  const preview = previewI111OneShot(snapshot);
  if (preview.verdict !== 'STATIC_REVIEW_ONLY') return stop('I111_PREFLIGHT_STOP');
  const grant = await verifyI111OwnerGrantPort({
    exactCodeSha: snapshot.checkedOutSha,
    bookId: scope.bookId,
    pageId: preview.nextPageId,
    revisionNumber: preview.nextRevisionNumber,
    maxCalls: scope.maxCalls,
    maxSpendMinor: scope.budgetLimitMinor,
  });
  if (grant !== 'INDEPENDENT_VERIFIED_ONE_TIME_GRANT')
    return stop('I111_OPERATION_APPROVAL_REQUIRED');

  const {
    PictureBookService,
    createI111SourceBoundTargetWorker,
    pg,
    drizzle,
    and,
    eq,
    inArray,
    dbSchema,
  } = await loadRuntimeModules();
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: 8_000,
    query_timeout: 8_000,
    max: 1,
  });
  let client;
  let lockAttempted = false;
  let lockAcquired = false;
  let lockUnknown = false;
  let queryUnsettled = false;
  let released = false;
  let pid;
  try {
    client = await bounded(
      () => pool.connect(),
      CONNECT_TIMEOUT_MS,
      (lateClient) => {
        try {
          lateClient.release(new Error(UNKNOWN));
        } catch {
          // The invocation is already STOP; late cleanup cannot authorize work.
        }
      },
    );
    pid = client.processID;
    if (!Number.isSafeInteger(pid) || pid <= 0) return stop('I111_BACKEND_PID_INVALID');
    const query = async (text, values) => {
      return bounded(
        () => client.query(text, values),
        8_000,
        () => {
          queryUnsettled = true;
        },
        () => {
          queryUnsettled = true;
        },
      );
    };
    lockAttempted = true;
    const lock = await query('select pg_try_advisory_lock($1::int4,$2::int4) as locked', LOCK_KEY);
    if (lock.rows.length !== 1 || lock.rows[0].locked !== true)
      return stop('I111_LOCK_NOT_ACQUIRED');
    lockAcquired = true;
    const pidCheck = await query('select pg_backend_pid()::int4 as pid');
    if (pidCheck.rows[0]?.pid !== pid) return stop('I111_BACKEND_PID_CHANGED');
    const db = drizzle(client, { schema: dbSchema });
    const imageQueue = noOpQueue();
    const api = new PictureBookService(
      db,
      noOpQueue(),
      imageQueue,
      {
        enabled: true,
        provider: 'BAILIAN',
        model: scope.model,
        maxAttempts: 1,
        timeoutMs: 600_000,
        imageEnabled: true,
        imageProvider: 'BAILIAN',
        imageModel: scope.model,
        imageBudget: {
          budgetKey: scope.budgetKey,
          amountMinor: scope.reservationMinor,
          globalLimitMinor: scope.budgetLimitMinor,
          consumerLimitMinor: scope.budgetLimitMinor,
          windowKey: scope.windowKey,
        },
      },
      redactedLogger(),
    );
    const slot = slotOrder[snapshot.attempts.length];
    if (!slot) return stop('I111_FOURTH_CALL_REJECTED');
    const [existing] = await db
      .select({
        id: dbSchema.workPageIllustrations.id,
        status: dbSchema.workPageIllustrations.status,
      })
      .from(dbSchema.workPageIllustrations)
      .where(
        and(
          eq(dbSchema.workPageIllustrations.pageId, slot.pageId),
          inArray(dbSchema.workPageIllustrations.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .limit(1);
    if (existing) return stop('I111_DUPLICATE_TASK');
    const created = await api.generateIllustration(
      scope.ownerId,
      scope.bookId,
      slot.pageId,
      slot.regenerate,
      'REQUIRE_NEW',
    );
    if (
      created.pageId !== slot.pageId ||
      created.revisionNumber !== slot.revisionNumber ||
      !UUID.test(created.illustrationId)
    )
      return stop('I111_CREATED_TARGET_INVALID');
    const reservations = await db
      .select()
      .from(dbSchema.aiCostReservations)
      .where(eq(dbSchema.aiCostReservations.resourceId, created.illustrationId));
    if (
      reservations.length !== 1 ||
      reservations[0].resourceType !== 'PICTURE_BOOK_IMAGE' ||
      reservations[0].budgetKey !== scope.budgetKey ||
      reservations[0].windowKey !== scope.windowKey ||
      reservations[0].consumerUserId !== scope.ownerId ||
      reservations[0].provider !== 'BAILIAN' ||
      reservations[0].model !== scope.model ||
      reservations[0].reservedMinor !== scope.reservationMinor ||
      reservations[0].status !== 'RESERVED' ||
      reservations[0].uncertainty !== 'NONE'
    )
      return stop('I111_RESERVATION_INVALID');
    const worker = createI111SourceBoundTargetWorker({
      db,
      targetIllustrationId: created.illustrationId,
      expectedSlot: slot,
      workspaceId: env.BAILIAN_WORKSPACE_ID,
      apiKey: env.DASHSCOPE_API_KEY,
      imageTimeoutMs: 600_000,
      bos: {
        endpoint: env.BAIDU_BOS_ENDPOINT,
        bucket: env.BAIDU_BOS_BUCKET,
        publicOrigin: env.BAIDU_BOS_PUBLIC_ORIGIN,
        accessKeyId: env.BAIDU_BOS_ACCESS_KEY_ID,
        secretAccessKey: env.BAIDU_BOS_SECRET_ACCESS_KEY,
      },
      logger: redactedLogger(),
    });
    const processed = await worker.processTargetIdWithAtomicGateOnce({
      targetId: created.illustrationId,
      slot,
    });
    if (processed !== created.illustrationId) return stop('I111_WORKER_TARGET_INVALID');
    const [finalIllustration] = await db
      .select({
        status: dbSchema.workPageIllustrations.status,
        mediaAssetId: dbSchema.workPageIllustrations.mediaAssetId,
        mediaStatus: dbSchema.mediaAssets.status,
      })
      .from(dbSchema.workPageIllustrations)
      .leftJoin(
        dbSchema.mediaAssets,
        eq(dbSchema.mediaAssets.id, dbSchema.workPageIllustrations.mediaAssetId),
      )
      .where(eq(dbSchema.workPageIllustrations.id, created.illustrationId));
    const [finalReservation] = await db
      .select({
        status: dbSchema.aiCostReservations.status,
        uncertainty: dbSchema.aiCostReservations.uncertainty,
      })
      .from(dbSchema.aiCostReservations)
      .where(eq(dbSchema.aiCostReservations.resourceId, created.illustrationId));
    const [finalLedger] = await db
      .select({ outcome: dbSchema.aiCostLedger.outcome })
      .from(dbSchema.aiCostLedger)
      .where(eq(dbSchema.aiCostLedger.resourceId, created.illustrationId));
    if (
      finalIllustration?.status !== 'READY' ||
      finalIllustration.mediaStatus !== 'READY' ||
      finalReservation?.uncertainty !== 'AT_RISK' ||
      finalLedger?.outcome !== 'AT_RISK'
    )
      return stop('I111_RESULT_INVALID');
    return stop('I111_RECONCILIATION_REQUIRED');
  } catch {
    lockUnknown = lockAttempted && !lockAcquired;
    return stop(lockUnknown ? UNKNOWN : UNKNOWN);
  } finally {
    if (client) {
      if (lockAcquired && !lockUnknown) {
        try {
          if (queryUnsettled) throw new Error(UNKNOWN);
          const pidCheck = await bounded(() =>
            client.query('select pg_backend_pid()::int4 as pid'),
          );
          if (pidCheck.rows[0]?.pid !== pid) throw new Error(UNKNOWN);
          const unlocked = await bounded(() =>
            client.query('select pg_advisory_unlock($1::int4,$2::int4) as unlocked', LOCK_KEY),
          );
          if (unlocked.rows.length !== 1 || unlocked.rows[0].unlocked !== true)
            throw new Error(UNKNOWN);
          client.release();
          released = true;
        } catch {
          if (!released) client.release(new Error(UNKNOWN));
          released = true;
        }
      } else {
        if (!released) client.release(new Error(UNKNOWN));
        released = true;
      }
    }
    await bounded(() => pool.end()).catch(() => undefined);
  }
}

async function runLive({ env, root }) {
  try {
    return await runLiveUnsafe({ env, root });
  } catch {
    return stop(UNKNOWN);
  }
}

/** Trusted entrypoint: owns the pool and never accepts a caller DB/client. */
export async function runI111TrustedOneShot(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    return stop('I111_ARGUMENTS_INVALID');
  }
  if (Object.keys(options).some((key) => !['mode', 'root'].includes(key))) {
    return stop('I111_CALLER_PORTS_FORBIDDEN');
  }
  const { mode = 'dry-run', root } = options;
  if (mode === 'dry-run') return simulateI111TrustedOneShot();
  if (mode !== 'live') return stop('I111_MODE_INVALID');
  return runLive({ env: process.env, root });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? 'dry-run';
  const result = await runI111TrustedOneShot({ mode });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
