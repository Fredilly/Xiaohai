import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withI111ExclusivePgLock } from './i111-exclusive-pg-lock.mjs';

function client({
  lock = true,
  unlock = true,
  throwOn = null,
  backends = [1234, 1234],
  releaseThrows = false,
} = {}) {
  const calls = [];
  const releases = [];
  let backendReads = 0;
  return {
    calls,
    releases,
    processID: 1234,
    release(error) {
      releases.push(error);
      if (releaseThrows) throw new Error('I111_TEST_RELEASE_RESULT_UNKNOWN');
    },
    async query(statement, params) {
      calls.push({ statement, params });
      if (throwOn && calls.length === throwOn) throw new Error('untrusted provider token');
      if (statement.includes('try_advisory_lock')) {
        return { rows: [{ locked: lock }] };
      }
      if (statement.includes('pg_backend_pid')) {
        return { rows: [{ backend_pid: backends[backendReads++] }] };
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
  assert.equal(pg.calls.length, 4);
  assert.deepEqual(pg.calls[0].params, [111, 20261119]);
  assert.deepEqual(pg.calls[3].params, [111, 20261119]);
  assert.match(pg.calls[0].statement, /pg_try_advisory_lock/);
  assert.match(pg.calls[1].statement, /pg_backend_pid/);
  assert.match(pg.calls[2].statement, /pg_backend_pid/);
  assert.match(pg.calls[3].statement, /pg_advisory_unlock/);
  assert.equal(pg.releases.length, 0);
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
  assert.equal(pg.releases.length, 0);
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
  assert.equal(pg.calls.length, 4);
  assert.equal(pg.releases.length, 0);
});

test('unlock failure destroys the uncertain session exactly once', async () => {
  for (const pg of [client({ unlock: false }), client({ throwOn: 4 })]) {
    await assert.rejects(withI111ExclusivePgLock(pg, async () => true));
    assert.equal(pg.calls.length, 4);
    assert.equal(pg.releases.length, 1);
    assert.ok(pg.releases[0] instanceof Error);
  }
});

test('unknown lock-acquisition result destroys the session exactly once', async () => {
  for (const pg of [client({ throwOn: 1 }), client({ throwOn: 2 }), client({ lock: null })]) {
    await assert.rejects(withI111ExclusivePgLock(pg, async () => true));
    assert.equal(pg.releases.length, 1);
    assert.ok(pg.releases[0] instanceof Error);
  }
});

test('an unknown destroy result remains a fixed STOP without a second release', async () => {
  const pg = client({ throwOn: 1, releaseThrows: true });
  await assert.rejects(
    withI111ExclusivePgLock(pg, async () => true),
    {
      message: 'I111_EXCLUSIVE_LOCK_REQUIRED',
    },
  );
  assert.equal(pg.releases.length, 1);
});

test('rejects a Pool-shaped query object before acquiring any lock', async () => {
  let queries = 0;
  const pool = {
    query: async () => {
      queries++;
      return { rows: [{ locked: true }] };
    },
    connect: async () => client(),
    totalCount: 1,
  };
  await assert.rejects(withI111ExclusivePgLock(pool, async () => true));
  assert.equal(queries, 0);
});

test('rejects a backend mismatch before entering the protected callback', async () => {
  const pg = client({ backends: [9999, 1234] });
  let callbacks = 0;
  await assert.rejects(
    withI111ExclusivePgLock(pg, async () => {
      callbacks++;
    }),
  );
  assert.equal(callbacks, 0);
  assert.equal(pg.calls.length, 2);
  assert.equal(pg.releases.length, 1);
});

test('rejects a backend change while the callback is running', async () => {
  const pg = client({ backends: [1234, 9999] });
  let callbacks = 0;
  await assert.rejects(
    withI111ExclusivePgLock(pg, async () => {
      callbacks++;
    }),
  );
  assert.equal(callbacks, 1);
  assert.equal(pg.calls.length, 3);
  assert.equal(pg.releases.length, 1);
});

test('connection failure and missing client fail before callback', async () => {
  const pg = client({ throwOn: 1 });
  await assert.rejects(withI111ExclusivePgLock(pg, () => true));
  assert.equal(pg.calls.length, 1);
  assert.equal(pg.releases.length, 1);
  await assert.rejects(withI111ExclusivePgLock(null, () => true));
});

test('the real PostgreSQL lifecycle test is dedicated, guarded and non-destructive', () => {
  const source = readFileSync(
    new URL('i111-exclusive-pg-lock.integration.test.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    source.indexOf('assertI111ExclusiveLockIntegrationConfig(process.env)') <
      source.indexOf('new pg.Pool'),
  );
  assert.doesNotMatch(source, /\b(?:TRUNCATE|DROP TABLE|CREATE DATABASE)\b/iu);
  assert.doesNotMatch(source, /provider\.generate|processOne\(/u);

  const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    rootPackage.scripts?.['test:i111-exclusive-lock-integration'],
    'I111_EXCLUSIVE_LOCK_PG_TEST_REQUIRED=1 node --test scripts/i111-exclusive-pg-lock.integration.test.mjs',
  );
});
