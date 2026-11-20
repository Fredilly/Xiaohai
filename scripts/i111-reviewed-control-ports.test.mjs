import test from 'node:test';
import assert from 'node:assert/strict';
import { createI111ReviewedControlPorts } from './i111-reviewed-control-ports.mjs';
import { coordinateI111OneShot } from './i111-one-shot-orchestration.mjs';

const stop = 'I111_CONTROL_PORTS_STOP';

test('source-bound control ports do not accept flags or provide a paid executor', async () => {
  assert.throws(() => createI111ReviewedControlPorts(), new RegExp(stop, 'u'));
  const client = { query: async () => ({ rows: [] }) };
  const ports = createI111ReviewedControlPorts(client);
  assert.deepEqual(Object.keys(ports).sort(), [
    'readFinalEvidence',
    'verifyExactlyOneReservation',
    'verifyOwnerOperationGrant',
    'verifySlotFreshBeforePrepare',
    'withExclusiveIsolation',
  ]);
  assert.deepEqual(await coordinateI111OneShot(ports), {
    verdict: 'STOP',
    errorCode: 'I111_EXECUTOR_PORTS_UNAVAILABLE',
    paidExecutionAuthorized: false,
  });
});

test('holds one real session lock through the callback, then releases it', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      return { rows: [{ [sql.includes('unlock') ? 'unlocked' : 'locked']: true }] };
    },
  };
  const ports = createI111ReviewedControlPorts(client);
  assert.equal(
    await ports.withExclusiveIsolation(async () => {
      assert.equal(calls.length, 1);
      return 'safe-preview';
    }),
    'safe-preview',
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /pg_try_advisory_lock/u);
  assert.match(calls[1], /pg_advisory_unlock/u);
});

test('owner grant port rejects a mismatched request without any external fetch', async () => {
  const client = { query: async () => ({ rows: [] }) };
  const ports = createI111ReviewedControlPorts(client);
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => {
      throw new Error('NETWORK_MUST_NOT_RUN');
    };
    assert.equal(
      await ports.verifyOwnerOperationGrant({
        exactCodeSha: 'not-an-exact-sha',
        bookId: 'wrong',
        pageId: 'wrong',
        revisionNumber: 99,
      }),
      'STOP',
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('invalid lock acquisition stops before any evidence callback', async () => {
  let callbackCalls = 0;
  const ports = createI111ReviewedControlPorts({
    async query() {
      return { rows: [{ locked: false }] };
    },
  });
  await assert.rejects(
    ports.withExclusiveIsolation(async () => {
      callbackCalls += 1;
    }),
    /I111_EXCLUSIVE_LOCK_REQUIRED/u,
  );
  assert.equal(callbackCalls, 0);
});
