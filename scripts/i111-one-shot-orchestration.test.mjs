import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateI111OneShot, previewI111OneShot } from './i111-one-shot-orchestration.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const targetId = '00000000-1111-4222-8333-444444444444';

function fixture() {
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
      confirmed: true,
      locked: true,
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
      globalWindow: { actualMinor: 0, reservedMinor: 0 },
      consumerWindow: { actualMinor: 0, reservedMinor: 0 },
    },
    attempts: [],
    requestedPageId: scope.page1Id,
    requestedRevisionNumber: 1,
  };
}

function settledAttempt(pageId, revisionNumber) {
  return {
    pageId,
    revisionNumber,
    outcome: 'SUCCEEDED',
    mediaReady: true,
    settled: true,
    completeCostVerified: true,
    providerRequestIdPresent: true,
    reservedMinor: 25,
    actualMinor: 22,
  };
}

function setup(snapshot = fixture()) {
  const events = [];
  const ports = {
    withExclusiveIsolation: async (operation) => {
      events.push('lock');
      return operation();
    },
    readTrustedSnapshot: async () => {
      events.push('preflight');
      return snapshot;
    },
    verifyOwnerOperationGrant: async (details) => {
      events.push('approval');
      assert.equal(details.exactCodeSha, snapshot.checkedOutSha);
      assert.equal(details.bookId, scope.bookId);
      assert.equal(details.maxCalls, 3);
      assert.equal(details.maxSpendMinor, 200);
      return 'INDEPENDENT_VERIFIED_ONE_TIME_GRANT';
    },
    verifySlotFreshBeforePrepare: async ({ slot }) => {
      events.push('fresh');
      assert.equal(slot.pageId, snapshot.requestedPageId);
      assert.equal(slot.revisionNumber, snapshot.requestedRevisionNumber);
      return true;
    },
    prepareViaFormalApi: async ({ consumerUserId, pictureBookId, pageId, regenerate }) => {
      events.push('api');
      assert.equal(consumerUserId, scope.ownerId);
      assert.equal(pictureBookId, scope.bookId);
      assert.equal(pageId, snapshot.requestedPageId);
      assert.equal(regenerate, snapshot.requestedRevisionNumber === 2);
      return {
        pictureBookId,
        pageId,
        illustrationId: targetId,
        revisionNumber: snapshot.requestedRevisionNumber,
        status: 'QUEUED',
      };
    },
    verifyExactlyOneReservation: async ({ targetId: id }) => {
      events.push('reservation');
      assert.equal(id, targetId);
      return true;
    },
    processTargetIdWithAtomicGateOnce: async ({ targetId: id, slot }) => {
      events.push('worker');
      assert.equal(id, targetId);
      assert.equal(slot.pageId, snapshot.requestedPageId);
      assert.equal(slot.revisionNumber, snapshot.requestedRevisionNumber);
      return id;
    },
    readFinalEvidence: async (id) => {
      events.push('final');
      return {
        illustrationId: id,
        status: 'SUCCEEDED',
        mediaStatus: 'READY',
        reservationStatus: 'AT_RISK',
        ledgerStatus: 'AT_RISK',
      };
    },
  };
  return { ports, events };
}

function expectStop(result, code) {
  assert.deepEqual(result, {
    verdict: 'STOP',
    errorCode: code,
    paidExecutionAuthorized: false,
  });
}

test('no CLI adapter, missing exclusive lease or missing runtime port is always STOP', async () => {
  expectStop(await coordinateI111OneShot(), 'I111_EXECUTOR_PORTS_UNAVAILABLE');
  const { ports } = setup();
  delete ports.withExclusiveIsolation;
  expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_PORTS_UNAVAILABLE');
  const noCallback = setup();
  noCallback.ports.withExclusiveIsolation = async () => undefined;
  expectStop(await coordinateI111OneShot(noCallback.ports), 'I111_EXCLUSIVE_LOCK_REQUIRED');
});

test('static preview never claims operation authorization', () => {
  const next = previewI111OneShot(fixture());
  assert.deepEqual(next, {
    verdict: 'STATIC_REVIEW_ONLY',
    nextPageId: scope.page1Id,
    nextRevisionNumber: 1,
    paidExecutionAuthorized: false,
  });
  assert.equal(previewI111OneShot(null).verdict, 'STOP');
});

test('one invocation prepares one target-ID through formal API and never auto-advances', async () => {
  for (const [attempts, pageId, revisionNumber] of [
    [[], scope.page1Id, 1],
    [[settledAttempt(scope.page1Id, 1)], scope.page2Id, 1],
    [[settledAttempt(scope.page1Id, 1), settledAttempt(scope.page2Id, 1)], scope.page2Id, 2],
  ]) {
    const snapshot = fixture();
    snapshot.attempts = attempts;
    snapshot.requestedPageId = pageId;
    snapshot.requestedRevisionNumber = revisionNumber;
    snapshot.budget.globalWindow.actualMinor = attempts.length * 22;
    snapshot.budget.consumerWindow.actualMinor = attempts.length * 22;
    const { ports, events } = setup(snapshot);
    expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_RECONCILIATION_REQUIRED');
    assert.deepEqual(events, [
      'lock',
      'preflight',
      'approval',
      'fresh',
      'api',
      'reservation',
      'worker',
      'final',
    ]);
  }
});

test('unverified snapshot, pending cost and fourth slot stop before grant or API', async () => {
  for (const change of [
    (s) => (s.runtime.genericWorkerRunning = true),
    (s) => (s.runtime.unrelatedQueuedJobs = 1),
    (s) => (s.budget.unsettledAtRisk = 1),
    (s) => (s.reviewedSha = 'b'.repeat(40)),
    (s) => (s.requestedPageId = scope.coverId),
    (s) => (s.attempts = Array(3).fill(settledAttempt(scope.page2Id, 2))),
  ]) {
    const snapshot = fixture();
    change(snapshot);
    const { ports, events } = setup(snapshot);
    expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_PREFLIGHT_STOP');
    assert.deepEqual(events, ['lock', 'preflight']);
  }
});

test('approval cannot come from the snapshot and blocks all writes', async () => {
  const { ports, events } = setup();
  ports.verifyOwnerOperationGrant = async () => {
    events.push('approval');
    return true;
  };
  expectStop(await coordinateI111OneShot(ports), 'I111_OPERATION_APPROVAL_REQUIRED');
  assert.deepEqual(events, ['lock', 'preflight', 'approval']);
});

test('an existing active illustration cannot be reused as a new paid attempt', async () => {
  const { ports, events } = setup();
  ports.verifySlotFreshBeforePrepare = async () => {
    events.push('fresh');
    return false;
  };
  expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_SLOT_MISMATCH');
  assert.deepEqual(events, ['lock', 'preflight', 'approval', 'fresh']);
});

test('wrong API page, revision, reused/invalid target ID aborts before Worker', async () => {
  for (const delta of [
    { pageId: scope.coverId },
    { revisionNumber: 2 },
    { illustrationId: 'not-a-uuid' },
    { status: 'RUNNING' },
  ]) {
    const { ports, events } = setup();
    const prepare = ports.prepareViaFormalApi;
    ports.prepareViaFormalApi = async (args) => ({ ...(await prepare(args)), ...delta });
    expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_SLOT_MISMATCH');
    assert.deepEqual(events, ['lock', 'preflight', 'approval', 'fresh', 'api']);
  }
});

test('unverified reservation causes zero targeted Worker calls', async () => {
  const { ports, events } = setup();
  ports.verifyExactlyOneReservation = async () => {
    events.push('reservation');
    return false;
  };
  expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_RESERVATION_UNVERIFIED');
  assert.deepEqual(events, ['lock', 'preflight', 'approval', 'fresh', 'api', 'reservation']);
});

test('legacy separable paid-boundary boolean and Worker are not accepted', async () => {
  const { ports, events } = setup();
  delete ports.processTargetIdWithAtomicGateOnce;
  ports.verifyPaidBoundaryAtomically = async () => true;
  ports.processTargetIdOnce = async () => targetId;
  expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_PORTS_UNAVAILABLE');
  assert.deepEqual(events, []);
});

test('null/wrong Worker target and failed final media cannot count as success', async () => {
  for (const result of [null, 'different-id']) {
    const { ports, events } = setup();
    ports.processTargetIdWithAtomicGateOnce = async () => {
      events.push('worker');
      return result;
    };
    expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_PROCESS_UNVERIFIED');
    assert.equal(events.filter((item) => item === 'worker').length, 1);
    assert.ok(!events.includes('final'));
  }
  const { ports, events } = setup();
  ports.readFinalEvidence = async () => {
    events.push('final');
    return { illustrationId: targetId, status: 'FAILED' };
  };
  expectStop(await coordinateI111OneShot(ports), 'I111_EXECUTOR_RESULT_UNVERIFIED');
  assert.equal(events.filter((item) => item === 'worker').length, 1);
});

test('unexpected error and provider secret never escape; do not retry', async () => {
  const { ports, events } = setup();
  ports.processTargetIdWithAtomicGateOnce = async () => {
    events.push('worker');
    throw new Error('secret-provider-body-DO-NOT-LOG');
  };
  const result = await coordinateI111OneShot(ports);
  expectStop(result, 'I111_EXECUTOR_OUTCOME_UNCERTAIN');
  assert.ok(!JSON.stringify(result).includes('secret-provider-body'));
  assert.equal(events.filter((event) => event === 'worker').length, 1);
});

test('duplicate lock callback cannot invoke API or Worker twice', async () => {
  const { ports, events } = setup();
  ports.withExclusiveIsolation = async (operation) => {
    events.push('lock');
    await operation();
    return operation();
  };
  expectStop(await coordinateI111OneShot(ports), 'I111_EXCLUSIVE_LOCK_REQUIRED');
  assert.equal(events.filter((event) => event === 'api').length, 1);
  assert.equal(events.filter((event) => event === 'worker').length, 1);
});
