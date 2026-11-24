/**
 * #111: pure review of a classified snapshot for a future one-shot runner.
 * Never performs I/O or authorizes a provider request. The eventual runtime
 * must independently verify all values and obtain a new owner approval.
 */
export const I111_ONE_SHOT_SCOPE = Object.freeze({
  bookId: '90d7f77e-ae23-40ef-90b6-a672412c6318',
  ownerId: '11111111-1111-4111-8111-111111111111',
  coverId: '74e77a71-6670-46cb-bd76-ef06edd6b888',
  page1Id: '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb',
  page2Id: 'eae00ed5-6026-4a41-b95a-6c9eea09d076',
  databaseName: 'xiaohai_i111_mac_20261116',
  budgetKey: 'I111_MAC_PLAN_B_THREE_PAID_IMAGE_CALLS',
  windowKey: 'I111_20261117_ISOLATED_BOOK_ONLY',
  provider: 'BAILIAN',
  model: 'qwen-image-3.0',
  maxCalls: 3,
  reservationMinor: 25,
  budgetLimitMinor: 200,
  signedTtlSeconds: 900,
});

const ORDER = [
  { pageId: I111_ONE_SHOT_SCOPE.page1Id, revisionNumber: 1 },
  { pageId: I111_ONE_SHOT_SCOPE.page2Id, revisionNumber: 1 },
  { pageId: I111_ONE_SHOT_SCOPE.page2Id, revisionNumber: 2 },
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

// Accept only bounded, plain JSON-shaped data. Reject accessors, sparse arrays,
// non-JSON values, cycles, symbols and custom prototypes before reading fields.
// This is only an input check, not authentication of self-reported facts.
function isPlainJsonData(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 12 || seen.has(value)) return false;
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256 || (array && (value.length > 255 || keys.length !== value.length + 1))) {
    return false;
  }
  seen.add(value);
  const dataKeys = array ? Array.from({ length: value.length }, (_, i) => String(i)) : keys;
  for (const key of dataKeys) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      !isPlainJsonData(descriptor.value, seen, depth + 1)
    ) {
      return false;
    }
  }
  seen.delete(value);
  return true;
}

function isNonNegativeMinor(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalidSnapshot() {
  return {
    verdict: 'STOP',
    errorCodes: ['I111_SNAPSHOT_INVALID'],
    paidExecutionAuthorized: false,
  };
}

/** Returns allowlisted codes only, never an untrusted value or secret. */
export function assessI111OneShotSnapshot(snapshot) {
  try {
    if (!isObject(snapshot) || !isPlainJsonData(snapshot)) return invalidSnapshot();
    return assessParsedI111OneShotSnapshot(snapshot);
  } catch {
    // No accessor/proxy error or untrusted value may escape the fixed-code API.
    return invalidSnapshot();
  }
}

function assessParsedI111OneShotSnapshot(snapshot) {
  const errors = [];
  const requireValue = (code, condition) => {
    if (!condition) errors.push(code);
  };
  const scope = I111_ONE_SHOT_SCOPE;
  const book = isObject(snapshot.book) ? snapshot.book : {};
  const runtime = isObject(snapshot.runtime) ? snapshot.runtime : {};
  const budget = isObject(snapshot.budget) ? snapshot.budget : {};
  const references = Array.isArray(snapshot.references) ? snapshot.references : [];
  const attempts = Array.isArray(snapshot.attempts) ? snapshot.attempts : [];
  requireValue('I111_ATTEMPTS_INVALID', Array.isArray(snapshot.attempts));

  requireValue(
    'I111_CODE_NOT_REVIEWED',
    isSha(snapshot.checkedOutSha) &&
      isSha(snapshot.reviewedSha) &&
      snapshot.checkedOutSha === snapshot.reviewedSha,
  );
  requireValue('I111_ENV_INVALID', snapshot.appEnv === 'dev');
  requireValue(
    'I111_DATABASE_IDENTITY_INVALID',
    snapshot.databaseName === scope.databaseName && snapshot.dbIdentityVerified === true,
  );
  requireValue(
    'I111_BACKUP_NOT_VERIFIED',
    snapshot.originalBackupVerified === true && snapshot.backupSha256Matched === true,
  );
  requireValue(
    'I111_BOOK_SCOPE_INVALID',
    book.id === scope.bookId &&
      book.ownerId === scope.ownerId &&
      book.coverId === scope.coverId &&
      book.page1Id === scope.page1Id &&
      book.page2Id === scope.page2Id &&
      ['PLANNED', 'ILLUSTRATING', 'READY'].includes(book.status),
  );
  requireValue(
    'I111_REFERENCES_INVALID',
    references.length === 2 &&
      ['Mimi', 'Pip'].every((name) => {
        const matches = references.filter((ref) => ref?.name === name);
        return (
          matches.length === 1 &&
          matches[0].locked === true &&
          matches[0].confirmed === true &&
          matches[0].status === 'READY' &&
          matches[0].imported === true &&
          matches[0].privateBos === true &&
          matches[0].objectKeyMatched === true &&
          matches[0].sha256Matched === true
        );
      }),
  );
  requireValue(
    'I111_RUNTIME_NOT_ISOLATED',
    runtime.apiRunning === false &&
      runtime.genericWorkerRunning === false &&
      runtime.unrelatedQueuedJobs === 0 &&
      runtime.otherActiveJobs === 0 &&
      runtime.autoRetryEnabled === false,
  );
  requireValue(
    'I111_PROVIDER_CONFIG_INVALID',
    runtime.imageEnabled === true &&
      runtime.provider === scope.provider &&
      runtime.model === scope.model &&
      runtime.beijingWorkspaceBound === true &&
      runtime.signedTtlSeconds === scope.signedTtlSeconds &&
      Number.isInteger(runtime.imageTimeoutMs) &&
      runtime.imageTimeoutMs >= 600_000 &&
      runtime.imageTimeoutMs <= 780_000,
  );
  const previousCostValid = attempts.every(
    (attempt) =>
      isObject(attempt) &&
      attempt.reservedMinor === scope.reservationMinor &&
      isNonNegativeMinor(attempt.actualMinor) &&
      attempt.actualMinor <= attempt.reservedMinor,
  );
  const settledTotalMinor = previousCostValid
    ? attempts.reduce((sum, attempt) => sum + attempt.actualMinor, 0)
    : null;
  const globalWindow = isObject(budget.globalWindow) ? budget.globalWindow : {};
  const consumerWindow = isObject(budget.consumerWindow) ? budget.consumerWindow : {};
  const windowWithinLimit = (window) =>
    isNonNegativeMinor(window.actualMinor) &&
    isNonNegativeMinor(window.reservedMinor) &&
    window.actualMinor === settledTotalMinor &&
    window.reservedMinor === 0 &&
    window.actualMinor + window.reservedMinor + scope.reservationMinor <= scope.budgetLimitMinor;
  requireValue(
    'I111_BUDGET_INVALID',
    budget.enabled === true &&
      budget.budgetKey === scope.budgetKey &&
      budget.windowKey === scope.windowKey &&
      budget.reservationMinor === scope.reservationMinor &&
      budget.globalLimitMinor === scope.budgetLimitMinor &&
      budget.consumerLimitMinor === scope.budgetLimitMinor &&
      budget.costBasisVerified === true &&
      budget.unaccountedReservations === 0 &&
      budget.unaccountedLedgerEntries === 0 &&
      budget.unsettledAtRisk === 0 &&
      previousCostValid &&
      windowWithinLimit(globalWindow) &&
      windowWithinLimit(consumerWindow),
  );

  requireValue('I111_ATTEMPT_COUNT_INVALID', attempts.length < scope.maxCalls);
  requireValue(
    'I111_PREVIOUS_ATTEMPT_INVALID',
    attempts.length < scope.maxCalls &&
      attempts.every((attempt, index) => {
        const expected = ORDER[index];
        return (
          expected &&
          attempt?.pageId === expected.pageId &&
          attempt.revisionNumber === expected.revisionNumber &&
          attempt.outcome === 'SUCCEEDED' &&
          attempt.mediaReady === true &&
          attempt.settled === true &&
          attempt.completeCostVerified === true &&
          attempt.providerRequestIdPresent === true &&
          attempt.reservedMinor === scope.reservationMinor &&
          isNonNegativeMinor(attempt.actualMinor) &&
          attempt.actualMinor <= attempt.reservedMinor
        );
      }),
  );
  const next = ORDER[attempts.length];
  requireValue(
    'I111_NEXT_SLOT_INVALID',
    next !== undefined &&
      snapshot.requestedPageId === next.pageId &&
      snapshot.requestedRevisionNumber === next.revisionNumber,
  );
  return {
    verdict: errors.length ? 'STOP' : 'STATIC_REVIEW_ONLY',
    errorCodes: errors,
    paidExecutionAuthorized: false,
  };
}
