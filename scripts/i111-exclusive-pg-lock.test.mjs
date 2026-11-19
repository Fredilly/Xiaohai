import test from 'node:test';
import assert from 'node:assert/strict';
import { withI111ExclusivePgLock } from './i111-exclusive-pg-lock.mjs';

function client({ lock = true, unlock = true, throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(statement, params) {
      calls.push({ statement, params });
      if (throwOn && calls.length === throwOn) throw new Error('untrusted provider token');
      if (statement.includes('try_advisory_lock')) {
        return { rows: [{ locked: lock }] };
      }
      return { rows: [{ unlocked: unlock }] };
    },
  };
}

test('acquires one fixed advisory lock, executes once, always releases it', async () => {
  const pg = client();
  let callbacks = 0;
  const result = await withI111ExclusivePgLock(pg, async () => {
    callbacks += 1;
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(callbacks, 1);
  assert.equal(pg.calls.length, 2);
  assert.deepEqual(pg.calls[0].params, [111, 20261119]);
  assert.deepEqual(pg.calls[1].params, [111, 20261119]);
  assert.match(pg.calls[0].statement, /pg_try_advisory_lock/);
  assert.match(pg.calls[1].statement, /pg_advisory_unlock/);
});

test('a competing owner fails before the callback or any provider call', async () => {
  const pg = client({ lock: false });
  let callbacks = 0;
  await assert.rejects(
    withI111ExclusivePgLock(pg, () => {
      callbacks++;
    }),
  );
  assert.equal(callbacks, 0);
  assert.equal(pg.calls.length, 1);
});

test('callback failure releases the lock and redacts the exception', async () => {
  const pg = client();
  await assert.rejects(
    withI111ExclusivePgLock(pg, () => {
      throw new Error('untrusted provider token');
    }),
    (error) => {
      assert.equal(error.message, 'I111_EXCLUSIVE_LOCK_REQUIRED');
      assert.ok(!error.message.includes('untrusted provider'));
      return true;
    },
  );
  assert.equal(pg.calls.length, 2);
});

test('unlock failure never claims lock success', async () => {
  for (const pg of [client({ unlock: false }), client({ throwOn: 2 })]) {
    await assert.rejects(withI111ExclusivePgLock(pg, async () => true));
    assert.equal(pg.calls.length, 2);
  }
});

test('connection failure and missing client fail before callback', async () => {
  const pg = client({ throwOn: 1 });
  await assert.rejects(withI111ExclusivePgLock(pg, () => true));
  assert.equal(pg.calls.length, 1);
  await assert.rejects(withI111ExclusivePgLock(null, () => true));
});
