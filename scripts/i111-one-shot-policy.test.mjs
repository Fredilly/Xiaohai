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

for (const [label, update, errorCode] of [
  ['review SHA mismatch', (s) => (s.reviewedSha = 'a'.repeat(40)), 'I111_CODE_NOT_REVIEWED'],
  ['production environment', (s) => (s.appEnv = 'prod'), 'I111_ENV_INVALID'],
  ['wrong database', (s) => (s.databaseName = 'wrong'), 'I111_DATABASE_IDENTITY_INVALID'],
  ['backup mismatch', (s) => (s.backupSha256Matched = false), 'I111_BACKUP_NOT_VERIFIED'],
  ['wrong book', (s) => (s.book.id = 'wrong'), 'I111_BOOK_SCOPE_INVALID'],
  ['unlocked Mimi', (s) => (s.references[0].locked = false), 'I111_REFERENCES_INVALID'],
  ['duplicate Mimi', (s) => (s.references[1].name = 'Mimi'), 'I111_REFERENCES_INVALID'],
  ['generic Worker started', (s) => (s.runtime.genericWorkerRunning = true),
    'I111_RUNTIME_NOT_ISOLATED'],
  ['unrelated work', (s) => (s.runtime.unrelatedQueuedJobs = 1),
    'I111_RUNTIME_NOT_ISOLATED'],
  ['implicit retry', (s) => (s.runtime.autoRetryEnabled = true), 'I111_RUNTIME_NOT_ISOLATED'],
  ['wrong Workspace', (s) => (s.runtime.beijingWorkspaceBound = false),
    'I111_PROVIDER_CONFIG_INVALID'],
  ['old TTL', (s) => (s.runtime.signedTtlSeconds = 300), 'I111_PROVIDER_CONFIG_INVALID'],
  ['unsafe timeout', (s) => (s.runtime.imageTimeoutMs = 800_000),
    'I111_PROVIDER_CONFIG_INVALID'],
  ['wrong reserve', (s) => (s.budget.reservationMinor = 22), 'I111_BUDGET_INVALID'],
  ['AT_RISK open', (s) => (s.budget.unsettledAtRisk = 1), 'I111_BUDGET_INVALID'],
  ['price unverified', (s) => (s.budget.costBasisVerified = false), 'I111_BUDGET_INVALID'],
  ['cover', (s) => (s.requestedPageId = scope.coverId), 'I111_NEXT_SLOT_INVALID'],
  ['wrong revision', (s) => (s.requestedRevisionNumber = 2), 'I111_NEXT_SLOT_INVALID'],
  ['unknown past outcome', (s) => {
    s.attempts.push({ ...attempt(scope.page1Id, 1), outcome: 'UNKNOWN' });
    s.requestedPageId = scope.page2Id;
  }, 'I111_PREVIOUS_ATTEMPT_INVALID'],
  ['unsettled past attempt', (s) => {
    s.attempts.push({ ...attempt(scope.page1Id, 1), settled: false });
    s.requestedPageId = scope.page2Id;
  }, 'I111_PREVIOUS_ATTEMPT_INVALID'],
  ['fourth provider call', (s) => {
    s.attempts = [
      attempt(scope.page1Id, 1),
      attempt(scope.page2Id, 1),
      attempt(scope.page2Id, 2),
    ];
    s.requestedPageId = scope.page2Id;
    s.requestedRevisionNumber = 3;
  }, 'I111_ATTEMPT_COUNT_INVALID'],
]) {
  test('fails closed on ' + label, () => {
    const snapshot = fixture();
    update(snapshot);
    const result = assessI111OneShotSnapshot(snapshot);
    assert.equal(result.verdict, 'STOP');
    assert.equal(result.paidExecutionAuthorized, false);
    assert.ok(result.errorCodes.includes(errorCode), JSON.stringify(result.errorCodes));
  });
}

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
