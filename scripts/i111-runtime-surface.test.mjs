import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { coordinateI111OneShot } from './i111-one-shot-orchestration.mjs';
import { createI111ReviewedControlPorts } from './i111-reviewed-control-ports.mjs';

test('the caller-injected generic API/Worker adapter has no runtime module', async () => {
  await assert.rejects(stat(new URL('./i111-formal-api-worker-ports.mjs', import.meta.url)), {
    code: 'ENOENT',
  });
  const entries = await readdir(new URL('.', import.meta.url));
  for (const entry of entries.filter(
    (name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'),
  )) {
    const contents = await readFile(new URL(`./${entry}`, import.meta.url), 'utf8');
    assert.doesNotMatch(contents, /createI111FormalApiWorkerPorts|processTargetIdOnce/u, entry);
  }
});

test('reviewed real control ports still cannot execute the paid sequence', async () => {
  const pg = {
    query: async () => {
      throw new Error('must not connect');
    },
  };
  const ports = createI111ReviewedControlPorts(pg);
  assert.deepEqual(
    Object.keys(ports).sort(),
    [
      'readFinalEvidence',
      'verifyExactlyOneReservation',
      'verifyOwnerOperationGrant',
      'verifySlotFreshBeforePrepare',
      'withExclusiveIsolation',
    ].sort(),
  );
  assert.equal(Object.isFrozen(ports), true);
  assert.deepEqual(await coordinateI111OneShot(ports), {
    verdict: 'STOP',
    errorCode: 'I111_EXECUTOR_PORTS_UNAVAILABLE',
    paidExecutionAuthorized: false,
  });
});
