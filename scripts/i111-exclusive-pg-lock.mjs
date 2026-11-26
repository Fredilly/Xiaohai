/**
 * One real PostgreSQL session-scoped advisory lock for the #111 one-shot
 * callback. The caller must first authenticate that `client` is connected to
 * the allowlisted local DB/role. This is NOT an alternative to checking that
 * ordinary API/Worker processes and unrelated jobs are stopped.
 *
 * It never connects, opens a transaction, creates a job or invokes a provider
 * by itself. The caller owns normal client lifetime and must not return it to
 * a pool while this callback is running. If lock/session state becomes
 * uncertain, this helper calls `release(error)` exactly once to destroy the
 * checked-out connection; callers must not release that stopped lease again.
 */
const KEY = Object.freeze([111, 20261119]);
const LOCK = 'select pg_try_advisory_lock($1::int4, $2::int4) as locked';
const UNLOCK = 'select pg_advisory_unlock($1::int4, $2::int4) as unlocked';
const BACKEND = 'select pg_backend_pid()::int4 as backend_pid';

export class I111ExclusiveLockStop extends Error {
  constructor() {
    super('I111_EXCLUSIVE_LOCK_REQUIRED');
  }
}

export async function withI111ExclusivePgLock(client, callback) {
  // pg.Pool.query() can run successive statements on DIFFERENT backends.
  // Only accept an already checked-out, connected PoolClient: its `release`
  // function and positive backend PID are absent on the Pool itself. This is
  // a defensive shape check, not proof of an authenticated DB identity.
  if (
    !client ||
    typeof client.query !== 'function' ||
    typeof client.release !== 'function' ||
    !Number.isSafeInteger(client.processID) ||
    client.processID <= 0 ||
    typeof callback !== 'function'
  ) {
    throw new I111ExclusiveLockStop();
  }
  const pinnedBackendPid = client.processID;
  let acquired = false;
  let destroyUncertainClient = false;
  let result;
  let failure;
  try {
    let lock;
    try {
      lock = await client.query(LOCK, KEY);
    } catch {
      // PostgreSQL may have acquired the session lock before the client lost
      // the response. The only safe unlock is to terminate this session.
      destroyUncertainClient = true;
      throw new I111ExclusiveLockStop();
    }
    if (lock?.rows?.length !== 1 || typeof lock.rows[0]?.locked !== 'boolean') {
      destroyUncertainClient = true;
      throw new I111ExclusiveLockStop();
    }
    if (lock.rows[0].locked !== true) {
      throw new I111ExclusiveLockStop();
    }
    acquired = true;
    let observed;
    try {
      observed = await client.query(BACKEND);
    } catch {
      destroyUncertainClient = true;
      throw new I111ExclusiveLockStop();
    }
    if (
      observed?.rows?.length !== 1 ||
      observed.rows[0]?.backend_pid !== pinnedBackendPid ||
      client.processID !== pinnedBackendPid
    ) {
      destroyUncertainClient = true;
      throw new I111ExclusiveLockStop();
    }
    result = await callback();
  } catch {
    // The orchestrator must stop with a fixed code on unknown side effects.
    failure = new I111ExclusiveLockStop();
  } finally {
    if (acquired && !destroyUncertainClient) {
      try {
        const observed = await client.query(BACKEND);
        if (
          observed?.rows?.length !== 1 ||
          observed.rows[0]?.backend_pid !== pinnedBackendPid ||
          client.processID !== pinnedBackendPid
        ) {
          destroyUncertainClient = true;
        } else {
          const unlocked = await client.query(UNLOCK, KEY);
          if (unlocked?.rows?.length !== 1 || unlocked.rows[0]?.unlocked !== true) {
            destroyUncertainClient = true;
          }
        }
      } catch {
        destroyUncertainClient = true;
      }
      if (destroyUncertainClient) failure = new I111ExclusiveLockStop();
    }
    if (destroyUncertainClient) {
      try {
        client.release(new Error('I111_EXCLUSIVE_LOCK_REQUIRED'));
      } catch {
        // The session is already unusable or its owner rejected destruction.
        // Either state remains the same fixed STOP and is never retried.
      }
    }
  }
  if (failure) throw failure;
  return result;
}
