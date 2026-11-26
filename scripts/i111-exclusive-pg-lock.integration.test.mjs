import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { withI111ExclusivePgLock } from './i111-exclusive-pg-lock.mjs';

const STOP = 'I111_EXCLUSIVE_LOCK_DATABASE_GUARD_STOP';
const ROLE = 'xiaohai_i111_require_new_test';
const KEY = Object.freeze([111, 20261119]);
const requireFromDb = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pg = requireFromDb('pg');

function stop() {
  throw new Error(STOP);
}

function integer(value, minimum, maximum) {
  if (!value || !/^\d+$/u.test(value)) stop();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) stop();
  return parsed;
}

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    stop();
  }
}

function assertI111ExclusiveLockIntegrationConfig(env) {
  if (env.I111_EXCLUSIVE_LOCK_PG_TEST_REQUIRED !== '1') return null;
  if (
    env.NODE_ENV !== 'test' ||
    env.APP_ENV !== 'dev' ||
    env.I111_REQUIRE_NEW_PG_TEST !== '1' ||
    !env.DATABASE_URL ||
    env.DATABASE_URL !== env.TEST_DATABASE_URL
  ) {
    stop();
  }
  const runId = env.I111_REQUIRE_NEW_TEST_RUN_ID;
  if (!runId || !/^[a-z0-9]{12,32}$/u.test(runId)) stop();

  let url;
  try {
    url = new URL(env.TEST_DATABASE_URL);
  } catch {
    stop();
  }
  const databaseName = `xiaohai_i111_require_new_${runId}`;
  const hostPort = integer(url.port, 1024, 65535);
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    [5432, 52511, 55000].includes(hostPort) ||
    decoded(url.username) !== ROLE ||
    !url.password ||
    decoded(url.pathname.slice(1)) !== databaseName ||
    url.search ||
    url.hash
  ) {
    stop();
  }

  const expectedServerAddress = env.I111_REQUIRE_NEW_EXPECTED_SERVER_ADDRESS;
  const expectedServerVersion = env.I111_REQUIRE_NEW_EXPECTED_SERVER_VERSION;
  const expectedSystemIdentifier = env.I111_REQUIRE_NEW_EXPECTED_SYSTEM_IDENTIFIER;
  if (
    !expectedServerAddress ||
    isIP(expectedServerAddress) === 0 ||
    !expectedServerVersion ||
    !/^17\.\d+$/u.test(expectedServerVersion) ||
    !expectedSystemIdentifier ||
    !/^\d{10,24}$/u.test(expectedSystemIdentifier)
  ) {
    stop();
  }
  return Object.freeze({
    databaseName,
    databaseComment: `xiaohai-i111-require-new-disposable:${runId}`,
    expectedDatabaseOid: integer(env.I111_REQUIRE_NEW_EXPECTED_DATABASE_OID, 16_384, 2_147_483_647),
    expectedServerAddress,
    expectedServerPort: integer(env.I111_REQUIRE_NEW_EXPECTED_SERVER_PORT, 1, 65_535),
    expectedServerVersion,
    expectedSystemIdentifier,
    url: env.TEST_DATABASE_URL,
  });
}

const config = assertI111ExclusiveLockIntegrationConfig(process.env);
const integration = config ? test : test.skip;

async function waitForDestroyedPool(pool) {
  const deadline = Date.now() + 2_000;
  while (pool.totalCount !== 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(pool.totalCount, 0, 'uncertain session must be removed from the pool');
}

integration('destroys a session whose advisory-lock result is unknown', async () => {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: 2,
    connectionTimeoutMillis: 2_000,
  });
  try {
    const identityClient = await pool.connect();
    try {
      const identity = await identityClient.query(`
        select
          current_database() as "databaseName",
          current_user as "roleName",
          host(inet_server_addr()) as "serverAddress",
          inet_server_port()::int as "serverPort",
          current_setting('server_version') as "serverVersion",
          database.oid::int as "databaseOid",
          shobj_description(database.oid, 'pg_database') as "databaseComment",
          control.system_identifier::text as "systemIdentifier"
        from pg_database database
        cross join pg_control_system() control
        where database.datname = current_database()
      `);
      assert.deepEqual(identity.rows, [
        {
          databaseName: config.databaseName,
          roleName: ROLE,
          serverAddress: config.expectedServerAddress,
          serverPort: config.expectedServerPort,
          serverVersion: config.expectedServerVersion,
          databaseOid: config.expectedDatabaseOid,
          databaseComment: config.databaseComment,
          systemIdentifier: config.expectedSystemIdentifier,
        },
      ]);
    } finally {
      identityClient.release();
    }

    const uncertain = await pool.connect();
    const uncertainPid = uncertain.processID;
    const realQuery = uncertain.query.bind(uncertain);
    let serverLockConfirmed = false;
    uncertain.query = async (statement, parameters) => {
      if (typeof statement === 'string' && statement.includes('pg_try_advisory_lock')) {
        const result = await realQuery(statement, parameters);
        assert.deepEqual(result.rows, [{ locked: true }]);
        serverLockConfirmed = true;
        throw new Error('I111_TEST_LOST_LOCK_RESPONSE');
      }
      return realQuery(statement, parameters);
    };

    await assert.rejects(
      withI111ExclusivePgLock(uncertain, async () => {
        assert.fail('callback must not run after an unknown lock result');
      }),
      { message: 'I111_EXCLUSIVE_LOCK_REQUIRED' },
    );
    assert.equal(serverLockConfirmed, true);
    await waitForDestroyedPool(pool);

    const replacement = await pool.connect();
    try {
      assert.notEqual(replacement.processID, uncertainPid);
      let acquired = false;
      const deadline = Date.now() + 2_000;
      while (!acquired && Date.now() < deadline) {
        const result = await replacement.query(
          'select pg_try_advisory_lock($1::int4, $2::int4) as locked',
          KEY,
        );
        acquired = result.rows[0]?.locked === true;
        if (!acquired) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(acquired, true, 'a new independent session must eventually acquire the lock');
      const unlocked = await replacement.query(
        'select pg_advisory_unlock($1::int4, $2::int4) as unlocked',
        KEY,
      );
      assert.deepEqual(unlocked.rows, [{ unlocked: true }]);
    } finally {
      replacement.release();
    }
  } finally {
    await pool.end();
  }
});
