import { drizzle } from 'drizzle-orm/node-postgres';
import pg, { type PoolClient } from 'pg';
import * as coreSchema from './schema.js';
import * as cmsSchema from './cms-schema.js';
import * as commerceSchema from './commerce-schema.js';
import * as paymentSchema from './payment-schema.js';
import * as contentSchema from './content-schema.js';
import * as aiSchema from './ai-schema.js';
import * as aiBudgetSchema from './ai-budget-schema.js';

const schema = {
  ...coreSchema,
  ...cmsSchema,
  ...commerceSchema,
  ...paymentSchema,
  ...contentSchema,
  ...aiSchema,
  ...aiBudgetSchema,
};

const STOP = 'I111_TRUSTED_COORDINATOR_STOP';
const DISABLED = 'I111_TRUSTED_COORDINATOR_NOT_ENABLED';
const PORTS_NOT_WIRED = 'I111_TRUSTED_COORDINATOR_PORTS_NOT_WIRED';
const LOCK_KEY = Object.freeze([111, 20261119]);
const POOL_END_TIMEOUT_MS = 1_000;

/**
 * This is the first, non-operational ownership kernel for a future
 * Trusted Coordinator. It deliberately has no public client/DB/port input.
 * The public function below always stops; the private lifecycle is retained
 * only as a reviewable shape for the later, separately approved wiring.
 */
export async function runI111TrustedCoordinator(...args: readonly unknown[]) {
  await Promise.resolve();
  if (args.length !== 0) {
    return Object.freeze({ verdict: 'STOP', errorCode: STOP, paidExecutionAuthorized: false });
  }
  return Object.freeze({ verdict: 'STOP', errorCode: DISABLED, paidExecutionAuthorized: false });
}

export const I111_TRUSTED_SESSION_NEGATIVE_CASES = Object.freeze([
  'pool-query-wrapper',
  'bare-pool',
  'caller-client-or-drizzle',
  'two-distinct-clients',
  'premature-or-double-release',
  'backend-pid-change',
  'cross-backend-transaction',
  'in-flight-query-at-release',
  'lock-query-transaction-unlock-release-failure',
  'unknown-provider-result',
]);

class CoordinatorStop extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type QueryRow = Record<string, unknown>;

function rowsOf(result: unknown): QueryRow[] {
  if (!result || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is QueryRow => row !== null && typeof row === 'object',
  );
}

function requireBackendPid(client: PoolClient): number {
  const value: unknown = (client as PoolClient & { processID?: unknown }).processID;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new CoordinatorStop(STOP);
  }
  return value;
}

/** Defense in depth only: server-side pg_backend_pid remains authoritative. */
type LockState = {
  acquired: boolean;
  lockAttempted: boolean;
  lockConfirmedNotAcquired: boolean;
  pinnedPid?: number;
};

async function acquireOwnedLock(client: PoolClient, state: LockState): Promise<void> {
  const pinnedPid = requireBackendPid(client);
  state.pinnedPid = pinnedPid;
  state.lockAttempted = true;
  const locked = rowsOf(await client.query(
    'select pg_try_advisory_lock($1::int4, $2::int4) as locked',
    [...LOCK_KEY],
  ));
  if (locked.length !== 1 || locked[0]?.locked !== true) {
    if (locked.length === 1 && locked[0]?.locked === false) {
      state.lockConfirmedNotAcquired = true;
    }
    throw new CoordinatorStop(STOP);
  }
  state.acquired = true;
  const backend = rowsOf(await client.query('select pg_backend_pid()::int4 as backend_pid'));
  if (backend.length !== 1 || backend[0]?.backend_pid !== pinnedPid) {
    throw new CoordinatorStop(STOP);
  }
}

async function releaseOwnedLock(client: PoolClient, pinnedPid: number): Promise<void> {
  const backend = rowsOf(await client.query('select pg_backend_pid()::int4 as backend_pid'));
  if (backend.length !== 1 || backend[0]?.backend_pid !== pinnedPid) {
    throw new CoordinatorStop(STOP);
  }
  const unlocked = rowsOf(await client.query(
    'select pg_advisory_unlock($1::int4, $2::int4) as unlocked',
    [...LOCK_KEY],
  ));
  if (unlocked.length !== 1 || unlocked[0]?.unlocked !== true) {
    throw new CoordinatorStop(STOP);
  }
}

/** Never let an unreleased client make cleanup wait without a bound. */
async function endOwnedPool(pool: pg.Pool): Promise<void> {
  let ending: Promise<void>;
  try {
    ending = pool.end();
  } catch {
    throw new CoordinatorStop(STOP);
  }
  // Keep a late rejection from becoming an unhandled rejection after timeout.
  void ending.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CoordinatorStop(STOP)), POOL_END_TIMEOUT_MS);
  });
  try {
    await Promise.race([ending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Private lifecycle shape. It is unreachable from the public entry until a
 * separately reviewed change wires real source-bound API/Worker ports. The
 * pool, checked-out client, Drizzle handle, lock and release are owned here;
 * no caller can supply any of them.
 */
async function executeOwnedLifecycle(connectionString: string): Promise<never> {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new CoordinatorStop(STOP);
  }
  const pool = new pg.Pool({ connectionString });
  let client: PoolClient | undefined;
  const lockState: LockState = {
    acquired: false,
    lockAttempted: false,
    lockConfirmedNotAcquired: false,
  };
  let primaryFailure: unknown;
  let cleanupFailure: unknown;
  try {
    client = await pool.connect();
    const db = drizzle(client, { schema });
    await acquireOwnedLock(client, lockState);

    // No executable composition is permitted in this round. A future change
    // must pass this exact `db` and `client` only to source-bound ports and
    // keep the lock for their complete API/Worker/evidence lifecycle.
    void db;
    throw new CoordinatorStop(PORTS_NOT_WIRED);
  } catch (error) {
    primaryFailure = error;
  } finally {
    let safeToRelease = !lockState.lockAttempted || lockState.lockConfirmedNotAcquired;
    if (client && lockState.acquired && lockState.pinnedPid !== undefined) {
      try {
        await releaseOwnedLock(client, lockState.pinnedPid);
        safeToRelease = true;
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (client && safeToRelease) {
      try {
        client.release();
      } catch (error) {
        cleanupFailure ??= error;
      }
    } else if (client && lockState.lockAttempted) {
      // An unknown lock state must not return a possibly-held session to the pool.
      // pg treats release(error) as a destroy request; either way this invocation
      // remains STOP and never claims that the lock or connection was released.
      try {
        client.release(new Error(STOP));
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    try {
      await endOwnedPool(pool);
    } catch (error) {
      cleanupFailure ??= error;
    }
  }
  if (cleanupFailure) throw new CoordinatorStop(STOP);
  if (primaryFailure) {
    throw primaryFailure instanceof Error ? primaryFailure : new CoordinatorStop(STOP);
  }
  throw new CoordinatorStop(STOP);
}

void executeOwnedLifecycle;
