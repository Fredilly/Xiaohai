import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assessI111OneShotSnapshot,
  I111_ONE_SHOT_SCOPE as scope,
} from './i111-one-shot-policy.mjs';

const attempt = (pageId, revisionNumber) => ({
  pageId,
  revisionNumber,
  outcome: 'SUCCEEDED',
  mediaReady: true,
  settled: true,
  completeCostVerified: true,
  providerRequestIdPresent: true,
  reservedMinor: scope.reservationMinor,
  actualMinor: 22,
});
const reference = (name) => ({
  name,
  confirmed: true,
  locked: true,
  status: 'READY',
  imported: true,
  privateBos: true,
  objectKeyMatched: true,
  sha256Matched: true,
});

function fixture() {
  return {
    checkedOutSha: 'c'.repeat(40),
    reviewedSha: 'c'.repeat(40),
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
    references: [reference('Mimi'), reference('Pip')],
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
      reservationMinor: 25,
      globalLimitMinor: 200,
      consumerLimitMinor: 200,
      costBasisVerified: true,
      unaccountedReservations: 0,
      unaccountedLedgerEntries: 0,
      unsettledAtRisk: 0,
      globalWindow: { actualMinor: 0, reservedMinor: 0 },
      consumerWindow: { actualMinor: 0, reservedMinor: 0 },
    },
    attempts: [],
    requestedPageId: scope.page1Id,
    requestedRevisionNumber: 1,
  };
}

test('static review is not authorization, even if snapshot assertions are true', () => {
  assert.deepEqual(assessI111OneShotSnapshot(fixture()), {
    verdict: 'STATIC_REVIEW_ONLY',
    errorCodes: [],
    paidExecutionAuthorized: false,
  });
  assert.equal(assessI111OneShotSnapshot(null).verdict, 'STOP');
});

test('only previously settled and fully charged successes may advance', () => {
  const s = fixture();
  s.attempts.push(attempt(scope.page1Id, 1));
  s.budget.globalWindow.actualMinor = 22;
  s.budget.consumerWindow.actualMinor = 22;
  s.requestedPageId = scope.page2Id;
  assert.equal(assessI111OneShotSnapshot(s).verdict, 'STATIC_REVIEW_ONLY');
  s.attempts.push(attempt(scope.page2Id, 1));
  s.budget.globalWindow.actualMinor = 44;
  s.budget.consumerWindow.actualMinor = 44;
  s.requestedRevisionNumber = 2;
  assert.equal(assessI111OneShotSnapshot(s).verdict, 'STATIC_REVIEW_ONLY');
});

function denies(label, errorCode, change) {
  test('fails closed: ' + label, () => {
    const snapshot = fixture();
    change(snapshot);
    const result = assessI111OneShotSnapshot(snapshot);
    assert.equal(result.verdict, 'STOP');
    assert.equal(result.paidExecutionAuthorized, false);
    assert.ok(result.errorCodes.includes(errorCode), JSON.stringify(result.errorCodes));
  });
}

denies('review SHA', 'I111_CODE_NOT_REVIEWED', (s) => {
  s.reviewedSha = 'a'.repeat(40);
});
denies('production', 'I111_ENV_INVALID', (s) => {
  s.appEnv = 'prod';
});
denies('database identity', 'I111_DATABASE_IDENTITY_INVALID', (s) => {
  s.databaseName = 'wrong';
});
denies('backup', 'I111_BACKUP_NOT_VERIFIED', (s) => {
  s.backupSha256Matched = false;
});
denies('book identity', 'I111_BOOK_SCOPE_INVALID', (s) => {
  s.book.id = 'wrong';
});
denies('unlocked Mimi', 'I111_REFERENCES_INVALID', (s) => {
  s.references[0].locked = false;
});
denies('duplicate Mimi', 'I111_REFERENCES_INVALID', (s) => {
  s.references[1].name = 'Mimi';
});
denies('generic Worker', 'I111_RUNTIME_NOT_ISOLATED', (s) => {
  s.runtime.genericWorkerRunning = true;
});
denies('unrelated work', 'I111_RUNTIME_NOT_ISOLATED', (s) => {
  s.runtime.unrelatedQueuedJobs = 1;
});
denies('implicit retry', 'I111_RUNTIME_NOT_ISOLATED', (s) => {
  s.runtime.autoRetryEnabled = true;
});
denies('wrong Workspace', 'I111_PROVIDER_CONFIG_INVALID', (s) => {
  s.runtime.beijingWorkspaceBound = false;
});
denies('old TTL', 'I111_PROVIDER_CONFIG_INVALID', (s) => {
  s.runtime.signedTtlSeconds = 300;
});
denies('unsafe timeout', 'I111_PROVIDER_CONFIG_INVALID', (s) => {
  s.runtime.imageTimeoutMs = 800_000;
});
denies('wrong reserve', 'I111_BUDGET_INVALID', (s) => {
  s.budget.reservationMinor = 22;
});
denies('AT_RISK open', 'I111_BUDGET_INVALID', (s) => {
  s.budget.unsettledAtRisk = 1;
});
denies('unverified price', 'I111_BUDGET_INVALID', (s) => {
  s.budget.costBasisVerified = false;
});
denies('COVER generation', 'I111_NEXT_SLOT_INVALID', (s) => {
  s.requestedPageId = scope.coverId;
});
denies('wrong revision', 'I111_NEXT_SLOT_INVALID', (s) => {
  s.requestedRevisionNumber = 2;
});
denies('unknown prior outcome', 'I111_PREVIOUS_ATTEMPT_INVALID', (s) => {
  s.attempts.push({ ...attempt(scope.page1Id, 1), outcome: 'UNKNOWN' });
  s.requestedPageId = scope.page2Id;
});
denies('unsettled prior call', 'I111_PREVIOUS_ATTEMPT_INVALID', (s) => {
  s.attempts.push({ ...attempt(scope.page1Id, 1), settled: false });
  s.requestedPageId = scope.page2Id;
});
denies('fourth provider call', 'I111_ATTEMPT_COUNT_INVALID', (s) => {
  s.attempts = [attempt(scope.page1Id, 1), attempt(scope.page2Id, 1), attempt(scope.page2Id, 2)];
  s.requestedPageId = scope.page2Id;
  s.requestedRevisionNumber = 3;
});

test('never echoes untrusted secrets in stop reasons', () => {
  const output = assessI111OneShotSnapshot({
    checkedOutSha: 'https://example.invalid/?signature=private',
  });
  assert.equal(output.paidExecutionAuthorized, false);
  assert.ok(!JSON.stringify(output).includes('signature'));
});

test('only an explicit dense attempts array represents first-slot history', () => {
  for (const [invalid, expectedErrorCode] of [
    [undefined, 'I111_SNAPSHOT_INVALID'],
    [null, 'I111_ATTEMPTS_INVALID'],
    ['none', 'I111_ATTEMPTS_INVALID'],
    [{}, 'I111_ATTEMPTS_INVALID'],
    [Array(2), 'I111_SNAPSHOT_INVALID'],
  ]) {
    const s = fixture();
    s.attempts = invalid;
    const result = assessI111OneShotSnapshot(s);
    assert.equal(result.verdict, 'STOP');
    assert.equal(result.paidExecutionAuthorized, false);
    assert.ok(result.errorCodes.includes(expectedErrorCode));
  }

  const missing = fixture();
  delete missing.attempts;
  const missingResult = assessI111OneShotSnapshot(missing);
  assert.equal(missingResult.verdict, 'STOP');
  assert.equal(missingResult.paidExecutionAuthorized, false);
  assert.ok(missingResult.errorCodes.includes('I111_ATTEMPTS_INVALID'));

  assert.equal(assessI111OneShotSnapshot(fixture()).verdict, 'STATIC_REVIEW_ONLY');
});

test('sparse history cannot skip the required first and second attempts', () => {
  const s = fixture();
  s.attempts = Array(2);
  s.requestedPageId = scope.page2Id;
  s.requestedRevisionNumber = 2;
  assert.deepEqual(assessI111OneShotSnapshot(s), {
    verdict: 'STOP',
    errorCodes: ['I111_SNAPSHOT_INVALID'],
    paidExecutionAuthorized: false,
  });
});

test('refuses malformed window money, exhaustion and unreconciled historical costs', () => {
  for (const [field, value] of [
    ['actualMinor', 200],
    ['actualMinor', -1],
    ['actualMinor', 1.5],
    ['actualMinor', '22'],
    ['reservedMinor', 1],
    ['reservedMinor', 200],
  ]) {
    const s = fixture();
    s.budget.globalWindow[field] = value;
    assert.ok(
      assessI111OneShotSnapshot(s).errorCodes.includes('I111_BUDGET_INVALID'),
      field + ': ' + value,
    );
  }
  const exhausted = fixture();
  exhausted.attempts.push(attempt(scope.page1Id, 1));
  exhausted.requestedPageId = scope.page2Id;
  exhausted.budget.globalWindow.actualMinor = 200;
  exhausted.budget.consumerWindow.actualMinor = 200;
  assert.ok(assessI111OneShotSnapshot(exhausted).errorCodes.includes('I111_BUDGET_INVALID'));
  for (const value of [26, -1, 1.1, '22', undefined]) {
    const invalidPast = fixture();
    invalidPast.attempts.push({ ...attempt(scope.page1Id, 1), actualMinor: value });
    invalidPast.requestedPageId = scope.page2Id;
    assert.ok(
      assessI111OneShotSnapshot(invalidPast).errorCodes.includes(
        value === undefined ? 'I111_SNAPSHOT_INVALID' : 'I111_BUDGET_INVALID',
      ),
    );
  }
});

test('both scoped windows must have integer fee balances and enough next-slot margin', () => {
  for (const windowName of ['globalWindow', 'consumerWindow']) {
    for (const field of ['actualMinor', 'reservedMinor']) {
      const s = fixture();
      delete s.budget[windowName][field];
      assert.ok(assessI111OneShotSnapshot(s).errorCodes.includes('I111_BUDGET_INVALID'));
    }
  }
  const noHeadroom = fixture();
  noHeadroom.attempts.push(attempt(scope.page1Id, 1));
  noHeadroom.requestedPageId = scope.page2Id;
  noHeadroom.budget.globalWindow.actualMinor = 190;
  noHeadroom.budget.consumerWindow.actualMinor = 190;
  assert.ok(assessI111OneShotSnapshot(noHeadroom).errorCodes.includes('I111_BUDGET_INVALID'));
});

test('rejects accessor, proxy, cycle and non-JSON inputs with fixed redacted codes', () => {
  const secret = 'private-secret-never-echo';
  const getter = fixture();
  Object.defineProperty(getter, 'book', {
    enumerable: true,
    get() {
      throw new Error(secret);
    },
  });
  for (const invalid of [
    getter,
    new Proxy(fixture(), {
      getPrototypeOf() {
        throw new Error(secret);
      },
    }),
    { ...fixture(), book: new Date() },
    { ...fixture(), runtime: { ...fixture().runtime, extra: Symbol(secret) } },
  ]) {
    const result = assessI111OneShotSnapshot(invalid);
    assert.deepEqual(result, {
      verdict: 'STOP',
      errorCodes: ['I111_SNAPSHOT_INVALID'],
      paidExecutionAuthorized: false,
    });
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  const cyclic = fixture();
  cyclic.self = cyclic;
  assert.deepEqual(assessI111OneShotSnapshot(cyclic).errorCodes, ['I111_SNAPSHOT_INVALID']);
});

test('accepts 780000ms limit but rejects 780001ms and extra signed TTL', () => {
  const upper = fixture();
  upper.runtime.imageTimeoutMs = 780_000;
  assert.equal(assessI111OneShotSnapshot(upper).verdict, 'STATIC_REVIEW_ONLY');
  upper.runtime.imageTimeoutMs = 780_001;
  assert.ok(assessI111OneShotSnapshot(upper).errorCodes.includes('I111_PROVIDER_CONFIG_INVALID'));
  upper.runtime.imageTimeoutMs = 600_000;
  upper.runtime.signedTtlSeconds = 901;
  assert.ok(assessI111OneShotSnapshot(upper).errorCodes.includes('I111_PROVIDER_CONFIG_INVALID'));
});

test('the exact scope and slot order match the production paid attempt gate', async () => {
  const code = await readFile(
    new URL('../apps/worker/src/i111-paid-attempt-gate.ts', import.meta.url),
    'utf8',
  );
  const object = code.match(/export const I111_PAID_RUN = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(object);
  const actual = Object.fromEntries(
    [...object[1].matchAll(/^\s+(\w+): ('[^']*'|\d+),$/gm)].map(([, key, value]) => [
      key,
      value.startsWith("'") ? value.slice(1, -1) : Number(value),
    ]),
  );
  assert.deepEqual(actual, {
    bookId: scope.bookId,
    ownerId: scope.ownerId,
    page1Id: scope.page1Id,
    page2Id: scope.page2Id,
    budgetKey: scope.budgetKey,
    windowKey: scope.windowKey,
    model: scope.model,
    reservationMinor: scope.reservationMinor,
    totalLimitMinor: scope.budgetLimitMinor,
    maxCalls: scope.maxCalls,
  });
  const slots = code.match(
    /export function i111AllowedSlots\([\s\S]*?return \[([\s\S]*?)\] as const;/,
  );
  assert.ok(slots);
  assert.deepEqual(
    [
      ...slots[1].matchAll(
        /\{\s*pageId:\s*scope\.(page1Id|page2Id),\s*revisionNumber:\s*(\d+)\s*\}/g,
      ),
    ].map(([, key, revision]) => ({ pageId: scope[key], revisionNumber: Number(revision) })),
    [
      { pageId: scope.page1Id, revisionNumber: 1 },
      { pageId: scope.page2Id, revisionNumber: 1 },
      { pageId: scope.page2Id, revisionNumber: 2 },
    ],
  );
});

test('the 900s reference lifetime and exact timeout margin match configuration', async () => {
  const code = await readFile(
    new URL('../packages/config/src/image-runtime-safety.ts', import.meta.url),
    'utf8',
  );
  for (const [key, expected] of [
    ['PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS', scope.signedTtlSeconds],
    ['IMAGE_PROVIDER_MIN_TIMEOUT_MS', 600_000],
    ['IMAGE_REFERENCE_EXPIRY_MARGIN_MS', 120_000],
  ]) {
    const match = code.match(new RegExp('^export const ' + key + ' = ([\\d_]+);$', 'm'));
    assert.ok(match, key);
    assert.equal(Number(match[1].replaceAll('_', '')), expected, key);
  }
  assert.match(code, /Math\.max\(timeoutMs, IMAGE_PROVIDER_MIN_TIMEOUT_MS\)/);
  assert.match(
    code,
    /effectiveTimeoutMs \+ IMAGE_REFERENCE_EXPIRY_MARGIN_MS >\s+PRIVATE_BOS_IMAGE_REFERENCE_TTL_SECONDS \* 1000/,
  );
});
