import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

/**
 * Read-only PostgreSQL evidence for the #111 one-shot coordinator. The caller
 * must supply a *dedicated, already authenticated* Gate B application session
 * and keep its session-scoped exclusive lock for the full operation.
 *
 * These samples do NOT prove an atomic paid boundary, Redis isolation, price
 * basis, owner approval, provider retry behavior or remote BOS provenance.
 * They may not substitute for any of those independent gates.
 */

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const EXPECTED_ROLE = 'xiaohai_i111_app';
const BOOK_MEDIA_ORIGIN = 'xiaohai-i111-work-2ec3900280.cd.bcebos.com';

const ORDER = Object.freeze([
  Object.freeze({ pageId: scope.page1Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 1, regenerate: false }),
  Object.freeze({ pageId: scope.page2Id, revisionNumber: 2, regenerate: true }),
]);

// Must match the immutable marker in apps/worker/src/i111-paid-attempt-gate.ts.
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

const QUERIES = Object.freeze({
  identity: `/* I111_ONE_SHOT_IDENTITY */ SELECT current_database() AS database_name,
    current_user AS database_user, current_setting('transaction_read_only') AS transaction_read_only,
    pg_is_in_recovery() AS is_replica, inet_server_port() AS server_port,
    current_setting('server_version_num') AS server_version_num`,
  role: `/* I111_ONE_SHOT_ROLE */ SELECT rolname, rolsuper, rolinherit, rolcreaterole,
    rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,
    has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect
    FROM pg_roles WHERE rolname = current_user`,
  pages: `/* I111_ONE_SHOT_PAGES */ SELECT p.id AS page_id, p.page_number,
    p.page_kind, p.picture_book_id, b.consumer_user_id, b.status AS book_status
    FROM work_pages p JOIN picture_books b ON b.id = p.picture_book_id
    ORDER BY p.page_number, p.id`,
  illustrations: `/* I111_ONE_SHOT_ILLUSTRATIONS */ SELECT i.id, i.page_id,
    i.revision_number, i.provider, i.model, i.status, i.media_asset_id,
    p.picture_book_id, m.id AS media_id, m.provider AS media_provider,
    m.status AS media_status, m.mime_type AS media_mime_type,
    m.object_key AS media_object_key, m.playback_url AS media_playback_url,
    m.byte_size AS media_byte_size
    FROM work_page_illustrations i JOIN work_pages p ON p.id = i.page_id
    LEFT JOIN media_assets m ON m.id = i.media_asset_id
    ORDER BY i.created_at, i.id`,
  reservations: `/* I111_ONE_SHOT_RESERVATIONS */ SELECT id, budget_key,
    window_key, consumer_user_id, resource_type, resource_id, provider, model,
    reserved_minor, actual_minor, status, uncertainty, provider_request_id
    FROM ai_cost_reservations ORDER BY created_at, id`,
  ledgers: `/* I111_ONE_SHOT_LEDGERS */ SELECT id, reservation_id,
    consumer_user_id, resource_type, resource_id, provider, model,
    amount_minor, outcome, usage, provider_request_id
    FROM ai_cost_ledger ORDER BY created_at, id`,
  windows: `/* I111_ONE_SHOT_WINDOWS */ SELECT budget_key, window_key,
    scope_type, consumer_user_id, limit_minor, reserved_minor, actual_minor
    FROM ai_budget_windows ORDER BY created_at, id`,
  activity: `/* I111_ONE_SHOT_ACTIVITY */ SELECT
    (SELECT count(*)::int FROM ai_jobs WHERE status IN ('QUEUED','RUNNING')) AS ai_jobs,
    (SELECT count(*)::int FROM character_reference_images WHERE status IN ('QUEUED','RUNNING')) AS references,
    (SELECT count(*)::int FROM work_page_illustrations WHERE status IN ('QUEUED','RUNNING')) AS illustrations`,
});

async function readState(pg) {
  if (!pg || typeof pg.query !== 'function') return null;
  let inTransaction = false;
  try {
    await pg.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTransaction = true;
    await pg.query("SET LOCAL lock_timeout = '1500ms'");
    await pg.query("SET LOCAL statement_timeout = '8000ms'");
    const data = {};
    for (const [key, statement] of Object.entries(QUERIES)) {
      const result = await pg.query(statement);
      if (!Array.isArray(result?.rows) || result.rows.length > 30) throw new Error('STOP');
      data[key] = result.rows;
    }
    await pg.query('COMMIT');
    inTransaction = false;
    return data;
  } catch {
    if (inTransaction) {
      try {
        await pg.query('ROLLBACK');
      } catch {
        // The outer coordinator treats every failure as STOP.
      }
    }
    return null;
  }
}

function identityVerified(state) {
  if (
    !state ||
    !Array.isArray(state.identity) ||
    !Array.isArray(state.role) ||
    !Array.isArray(state.pages)
  )
    return false;
  const id = state?.identity?.[0];
  const role = state?.role?.[0];
  const pages = state?.pages;
  return (
    state.identity.length === 1 &&
    state.role.length === 1 &&
    id.database_name === scope.databaseName &&
    id.database_user === EXPECTED_ROLE &&
    id.transaction_read_only === 'on' &&
    id.is_replica === false &&
    Number(id.server_port) === 5432 &&
    /^17\d{4}$/u.test(String(id.server_version_num)) &&
    role.rolname === EXPECTED_ROLE &&
    role.rolsuper === false &&
    role.rolinherit === false &&
    role.rolcreaterole === false &&
    role.rolcreatedb === false &&
    role.rolcanlogin === true &&
    role.rolreplication === false &&
    role.rolbypassrls === false &&
    role.can_connect === true &&
    pages.length === 3 &&
    [scope.coverId, scope.page1Id, scope.page2Id].every((id, index) => {
      const row = pages[index];
      return (
        row.page_id === id &&
        row.page_number === index &&
        row.page_kind === (index === 0 ? 'COVER' : 'CONTENT') &&
        row.picture_book_id === scope.bookId &&
        row.consumer_user_id === scope.ownerId &&
        ['PLANNED', 'ILLUSTRATING', 'READY'].includes(row.book_status)
      );
    })
  );
}

function mediaVerified(row) {
  if (
    row.status !== 'READY' ||
    !UUID.test(row.media_asset_id ?? '') ||
    row.media_asset_id !== row.media_id
  )
    return false;
  const objectKey = `picture-books/bailian/${row.id}.png`;
  try {
    const url = new URL(row.media_playback_url);
    return (
      row.media_provider === 'BAIDU_BOS' &&
      row.media_status === 'READY' &&
      row.media_mime_type === 'image/png' &&
      row.media_object_key === objectKey &&
      Number.isSafeInteger(Number(row.media_byte_size)) &&
      Number(row.media_byte_size) > 0 &&
      url.protocol === 'https:' &&
      url.hostname === BOOK_MEDIA_ORIGIN &&
      url.pathname === `/${objectKey}` &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function rowMatchesSlot(row, slot) {
  return (
    UUID.test(row?.id ?? '') &&
    row.page_id === slot.pageId &&
    row.revision_number === slot.revisionNumber &&
    row.picture_book_id === scope.bookId &&
    row.provider === scope.provider &&
    row.model === scope.model
  );
}

function reservationMatches(row, illustration) {
  return (
    UUID.test(row?.id ?? '') &&
    row.budget_key === scope.budgetKey &&
    row.window_key === scope.windowKey &&
    row.consumer_user_id === scope.ownerId &&
    row.resource_type === 'PICTURE_BOOK_IMAGE' &&
    row.resource_id === illustration.id &&
    row.provider === scope.provider &&
    row.model === scope.model &&
    row.reserved_minor === scope.reservationMinor
  );
}

function ledgerMatches(row, reservation, illustration) {
  return (
    UUID.test(row?.id ?? '') &&
    row.reservation_id === reservation.id &&
    row.consumer_user_id === scope.ownerId &&
    row.resource_type === 'PICTURE_BOOK_IMAGE' &&
    row.resource_id === illustration.id &&
    row.provider === scope.provider &&
    row.model === scope.model &&
    row.usage === SLOT_MARKER
  );
}

function settledPrevious(illustration, reservation, ledger) {
  return (
    mediaVerified(illustration) &&
    reservation.status === 'SETTLED' &&
    reservation.uncertainty === 'NONE' &&
    Number.isSafeInteger(reservation.actual_minor) &&
    reservation.actual_minor >= 0 &&
    reservation.actual_minor <= scope.reservationMinor &&
    typeof reservation.provider_request_id === 'string' &&
    reservation.provider_request_id.length > 0 &&
    reservation.provider_request_id !== 'bailian-image-unknown' &&
    ledger.outcome === 'SUCCEEDED' &&
    ledger.amount_minor === reservation.actual_minor &&
    ledger.provider_request_id === reservation.provider_request_id
  );
}

function windowsMatch(state, committed, pending) {
  const windows = state.windows;
  if (windows.length === 0) return committed === 0 && pending === 0;
  if (windows.length !== 2) return false;
  return ['GLOBAL', 'CONSUMER'].every((type) => {
    const matches = windows.filter((row) => row.scope_type === type);
    if (matches.length !== 1) return false;
    const row = matches[0];
    return (
      row.budget_key === scope.budgetKey &&
      row.window_key === scope.windowKey &&
      row.consumer_user_id === (type === 'GLOBAL' ? null : scope.ownerId) &&
      row.limit_minor === scope.budgetLimitMinor &&
      row.actual_minor === committed &&
      row.reserved_minor === pending &&
      committed + pending + scope.reservationMinor <= scope.budgetLimitMinor
    );
  });
}

function validateStage(state, { count, stage, targetId }) {
  if (!identityVerified(state) || ![0, 1, 2].includes(count)) return false;
  const pending = stage === 'before' ? 0 : 1;
  if (!['before', 'reserved', 'finished'].includes(stage)) return false;
  const expectedLength = count + pending;
  if (
    state.illustrations.length !== expectedLength ||
    state.reservations.length !== expectedLength ||
    state.ledgers.length !== (stage === 'finished' ? expectedLength : count)
  )
    return false;
  const activity = state.activity;
  if (
    activity.length !== 1 ||
    activity[0].ai_jobs !== 0 ||
    activity[0].references !== 0 ||
    activity[0].illustrations !== (stage === 'reserved' ? 1 : 0)
  )
    return false;

  let totalSettledMinor = 0;
  for (let index = 0; index < count; index++) {
    const illustration = state.illustrations[index];
    const reservation = state.reservations[index];
    const ledger = state.ledgers[index];
    if (
      !rowMatchesSlot(illustration, ORDER[index]) ||
      !reservationMatches(reservation, illustration) ||
      !ledgerMatches(ledger, reservation, illustration) ||
      !settledPrevious(illustration, reservation, ledger)
    )
      return false;
    totalSettledMinor += reservation.actual_minor;
  }
  if (stage === 'before') return windowsMatch(state, totalSettledMinor, 0);

  const illustration = state.illustrations[count];
  const reservation = state.reservations[count];
  if (
    illustration?.id !== targetId ||
    !rowMatchesSlot(illustration, ORDER[count]) ||
    !reservationMatches(reservation, illustration) ||
    reservation.status !== 'RESERVED' ||
    reservation.actual_minor !== null
  )
    return false;
  if (stage === 'reserved') {
    if (
      illustration.status !== 'QUEUED' ||
      illustration.media_asset_id !== null ||
      reservation.uncertainty !== 'NONE' ||
      reservation.provider_request_id !== null
    )
      return false;
  } else {
    const ledger = state.ledgers[count];
    if (
      !ledgerMatches(ledger, reservation, illustration) ||
      !mediaVerified(illustration) ||
      reservation.uncertainty !== 'AT_RISK' ||
      ledger.outcome !== 'AT_RISK' ||
      ledger.amount_minor !== scope.reservationMinor ||
      typeof reservation.provider_request_id !== 'string' ||
      reservation.provider_request_id.length === 0 ||
      reservation.provider_request_id === 'bailian-image-unknown' ||
      ledger.provider_request_id !== reservation.provider_request_id
    )
      return false;
  }
  return windowsMatch(state, totalSettledMinor, scope.reservationMinor);
}

/** No SQL executes until a future trusted runtime invokes these ports. */
export function createI111DatabaseEvidencePorts(pg) {
  return {
    async verifySlotFreshBeforePrepare({ slot }) {
      try {
        const count = ORDER.findIndex(
          (expected) =>
            expected.pageId === slot?.pageId &&
            expected.revisionNumber === slot?.revisionNumber &&
            expected.regenerate === slot?.regenerate,
        );
        if (count < 0) return false;
        const state = await readState(pg);
        return Boolean(state && validateStage(state, { count, stage: 'before' }));
      } catch {
        return false;
      }
    },
    async verifyExactlyOneReservation({ slot, targetId }) {
      try {
        const count = ORDER.findIndex(
          (expected) =>
            expected.pageId === slot?.pageId &&
            expected.revisionNumber === slot?.revisionNumber &&
            expected.regenerate === slot?.regenerate,
        );
        if (count < 0 || !UUID.test(targetId ?? '')) return false;
        const state = await readState(pg);
        return Boolean(state && validateStage(state, { count, stage: 'reserved', targetId }));
      } catch {
        return false;
      }
    },
    async readFinalEvidence(targetId) {
      try {
        if (!UUID.test(targetId ?? '')) return null;
        const state = await readState(pg);
        if (!state) return null;
        const count = state.illustrations?.findIndex((row) => row.id === targetId) ?? -1;
        if (count < 0 || !validateStage(state, { count, stage: 'finished', targetId })) return null;
        return {
          illustrationId: targetId,
          status: 'SUCCEEDED',
          mediaStatus: 'READY',
          reservationStatus: 'AT_RISK',
          ledgerStatus: 'AT_RISK',
        };
      } catch {
        return null;
      }
    },
  };
}
