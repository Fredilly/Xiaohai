import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runI111TrustedOneShot,
  parseI111TrustedCliArgs,
  simulateI111TrustedOneShot,
} from './i111-trusted-one-shot-runner.mjs';
import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

const attempt = (pageId, revisionNumber) => ({
  pageId,
  revisionNumber,
  outcome: 'SUCCEEDED',
  mediaReady: true,
  settled: true,
  completeCostVerified: true,
  providerRequestIdPresent: true,
  reservedMinor: 25,
  actualMinor: 22,
});

test('default trusted entrypoint is dry-run and never opens a socket', async () => {
  const result = await runI111TrustedOneShot();
  assert.equal(result.verdict, 'STOP');
  assert.equal(result.paidExecutionAuthorized, false);
  assert.deepEqual(result.events, [
    'lock',
    'grant',
    'fresh',
    'api',
    'reservation',
    'at-risk',
    'worker',
    'final',
  ]);
});

test('three exact slots can be rehearsed but a fourth call is rejected', async () => {
  const first = await simulateI111TrustedOneShot();
  assert.equal(first.errorCode, 'I111_EXECUTOR_RECONCILIATION_REQUIRED');
  const second = await simulateI111TrustedOneShot({ attempts: [attempt(scope.page1Id, 1)] });
  assert.equal(second.errorCode, 'I111_EXECUTOR_RECONCILIATION_REQUIRED');
  const third = await simulateI111TrustedOneShot({
    attempts: [attempt(scope.page1Id, 1), attempt(scope.page2Id, 1)],
  });
  assert.equal(third.errorCode, 'I111_EXECUTOR_RECONCILIATION_REQUIRED');
  const fourth = await simulateI111TrustedOneShot({
    attempts: [attempt(scope.page1Id, 1), attempt(scope.page2Id, 1), attempt(scope.page2Id, 2)],
  });
  assert.equal(fourth.errorCode, 'I111_FOURTH_CALL_REJECTED');
});

for (const fault of [
  'old-authorization',
  'wrong-page',
  'duplicate-task',
  'duplicate-reservation',
  'at-risk-persist-failure',
  'wrong-worker-id',
  'worker-result-failure',
  'provider-timeout',
  'bos-500',
]) {
  test(`fault ${fault} is a single STOP with no retry`, async () => {
    const result = await simulateI111TrustedOneShot({ fault });
    assert.equal(result.verdict, 'STOP');
    assert.equal(result.paidExecutionAuthorized, false);
    assert.equal(
      result.events.filter((event) => event === 'worker').length,
      fault === 'provider-timeout' ||
        fault === 'bos-500' ||
        fault === 'wrong-worker-id' ||
        fault === 'worker-result-failure'
        ? 1
        : 0,
    );
    assert.equal(
      result.events.filter((event) => event === 'api').length,
      fault === 'old-authorization' || fault === 'duplicate-task' ? 0 : 1,
    );
  });
}

test('live mode remains closed without an exact independently verified operation grant', async () => {
  const result = await runI111TrustedOneShot({ mode: 'live' });
  assert.deepEqual(result, {
    verdict: 'STOP',
    errorCode: 'I111_LIVE_GATE_STOP',
    paidExecutionAuthorized: false,
  });
});

test('caller cannot inject a DB, PoolClient, API or Worker port', async () => {
  assert.deepEqual(await runI111TrustedOneShot({ db: {} }), {
    verdict: 'STOP',
    errorCode: 'I111_CALLER_PORTS_FORBIDDEN',
    paidExecutionAuthorized: false,
  });
});

test('trusted CLI accepts one known mode and rejects extra or unknown arguments', () => {
  assert.deepEqual(parseI111TrustedCliArgs([]), { mode: 'dry-run' });
  assert.deepEqual(parseI111TrustedCliArgs(['live']), { mode: 'live' });
  assert.deepEqual(parseI111TrustedCliArgs(['live', '--extra']), {
    errorCode: 'I111_ARGUMENTS_INVALID',
  });
  assert.deepEqual(parseI111TrustedCliArgs(['--argv=[]']), {
    errorCode: 'I111_MODE_INVALID',
  });
});

test('runner output never includes secrets or provider response data', async () => {
  const result = await simulateI111TrustedOneShot({ fault: 'provider-timeout' });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('DASHSCOPE_API_KEY'), false);
  assert.equal(serialized.includes('postgresql://'), false);
  assert.equal(serialized.includes('signed'), false);
});
