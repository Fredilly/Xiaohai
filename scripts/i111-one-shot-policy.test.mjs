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
  s.requestedPageId = scope.page2Id;
  assert.equal(assessI111OneShotSnapshot(s).verdict, 'STATIC_REVIEW_ONLY');
  s.attempts.push(attempt(scope.page2Id, 1));
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

test('the exact scope remains synchronized with the production paid attempt gate', async () => {
  const code = await readFile(
    new URL('../apps/worker/src/i111-paid-attempt-gate.ts', import.meta.url),
    'utf8',
  );
  for (const key of ['bookId', 'ownerId', 'page1Id', 'page2Id', 'budgetKey', 'windowKey']) {
    assert.ok(code.includes(key + ": '" + scope[key] + "'"), key);
  }
  for (const key of ['maxCalls', 'reservationMinor']) {
    assert.ok(code.includes(key + ': ' + scope[key]), key);
  }
});
