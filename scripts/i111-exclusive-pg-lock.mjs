/**
 * One real PostgreSQL session-scoped advisory lock for the #111 one-shot
 * callback. The caller must first authenticate that `client` is connected to
 * the allowlisted local DB/role. This is NOT an alternative to checking that
 * ordinary API/Worker processes and unrelated jobs are stopped.
 *
 * It never connects, opens a transaction, creates a job or invokes a provider
 * by itself. The caller owns client lifetime and must not return it to a pool
 * while this callback is running.
 */
const KEY = Object.freeze([111, 20261119]);
const LOCK = 'select pg_try_advisory_lock($1::int4, $2::int4) as locked';
const UNLOCK = 'select pg_advisory_unlock($1::int4, $2::int4) as unlocked';

export class I111ExclusiveLockStop extends Error {
  constructor() {
    super('I111_EXCLUSIVE_LOCK_REQUIRED');
  }
}

export async function withI111ExclusivePgLock(client, callback) {
  if (!client || typeof client.query !== 'function' || typeof callback !== 'function') {
    throw new I111ExclusiveLockStop();
  }
  let acquired = false;
  let result;
  let failure;
  try {
    const lock = await client.query(LOCK, KEY);
    if (lock?.rows?.length !== 1 || lock.rows[0]?.locked !== true) {
      throw new I111ExclusiveLockStop();
    }
    acquired = true;
    result = await callback();
  } catch {
    // The orchestrator must stop with a fixed code on unknown side effects.
    failure = new I111ExclusiveLockStop();
  } finally {
    if (acquired) {
      try {
        const unlocked = await client.query(UNLOCK, KEY);
        if (unlocked?.rows?.length !== 1 || unlocked.rows[0]?.unlocked !== true) {
          failure = new I111ExclusiveLockStop();
        }
      } catch {
        failure = new I111ExclusiveLockStop();
      }
    }
  }
  if (failure) throw failure;
  return result;
}
