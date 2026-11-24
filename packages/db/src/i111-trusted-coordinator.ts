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
const CONNECT_TIMEOUT_MS = 5_000;
const QUERY_TIMEOUT_MS = 5_000;

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

function safeCoordinatorFailure(error: unknown): CoordinatorStop {
  if (error instanceof CoordinatorStop) {
    if (error.code === STOP || error.code === DISABLED || error.code === PORTS_NOT_WIRED) {
      return error;
    }
  }
  return new CoordinatorStop(STOP);
}

type QueryRow = Record<string, unknown>;

function rowsOf(result: unknown): QueryRow[] {
  if (!result || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is QueryRow => row !== null && typeof row === 'object');
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
  queryUnsettled: boolean;
  pinnedPid?: number;
};

async function withBoundedOperation<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  onLateSuccess?: (value: T) => void,
): Promise<T> {
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const operationPromise = Promise.resolve()
    .then(operation)
    .then(
      (value) => {
        if (timedOut && onLateSuccess) {
          try {
            onLateSuccess(value);
          } catch {
            // The invocation is already STOP; late cleanup cannot authorize anything.
          }
        }
        return value;
      },
      (error) => {
        // This handler prevents an unhandled late rejection while preserving the
        // original rejection for the bounded race when it wins in time.
        throw error;
      },
    );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new CoordinatorStop(STOP));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operationPromise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function queryOwned(
  client: PoolClient,
  state: LockState,
  text: string,
  values?: readonly unknown[],
): Promise<unknown> {
  try {
    return await withBoundedOperation(
      () => client.query(text, values ? [...values] : undefined),
      QUERY_TIMEOUT_MS,
    );
  } catch (error) {
    // Any query rejection is ambiguous: pg's query_timeout can report an
    // ordinary Error before the server-side operation has actually ended.
    state.queryUnsettled = true;
    throw error;
  }
}

async function acquireOwnedLock(client: PoolClient, state: LockState): Promise<void> {
  const pinnedPid = requireBackendPid(client);
  state.pinnedPid = pinnedPid;
  state.lockAttempted = true;
  const locked = rowsOf(
    await queryOwned(client, state, 'select pg_try_advisory_lock($1::int4, $2::int4) as locked', [
      ...LOCK_KEY,
    ]),
  );
  if (locked.length !== 1 || locked[0]?.locked !== true) {
    if (locked.length === 1 && locked[0]?.locked === false) {
      state.lockConfirmedNotAcquired = true;
    }
    throw new CoordinatorStop(STOP);
  }
  state.acquired = true;
  const backend = rowsOf(
    await queryOwned(client, state, 'select pg_backend_pid()::int4 as backend_pid'),
  );
  if (backend.length !== 1 || backend[0]?.backend_pid !== pinnedPid) {
    throw new CoordinatorStop(STOP);
  }
}

async function releaseOwnedLock(
  client: PoolClient,
  state: LockState,
  pinnedPid: number,
): Promise<void> {
  const backend = rowsOf(
    await queryOwned(client, state, 'select pg_backend_pid()::int4 as backend_pid'),
  );
  if (backend.length !== 1 || backend[0]?.backend_pid !== pinnedPid) {
    throw new CoordinatorStop(STOP);
  }
  const unlocked = rowsOf(
    await queryOwned(client, state, 'select pg_advisory_unlock($1::int4, $2::int4) as unlocked', [
      ...LOCK_KEY,
    ]),
  );
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
  let pool: pg.Pool | undefined;
  let client: PoolClient | undefined;
  const lockState: LockState = {
    acquired: false,
    lockAttempted: false,
    lockConfirmedNotAcquired: false,
    queryUnsettled: false,
  };
  let primaryFailure: unknown;
  let cleanupFailure: unknown;
  try {
    pool = new pg.Pool({
      connectionString,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
    });
    client = await withBoundedOperation(
      () => pool!.connect(),
      CONNECT_TIMEOUT_MS,
      (lateClient) => {
        try {
          lateClient.release(new Error(STOP));
        } catch {
          // The late client is untrusted; the invocation remains STOP.
        }
      },
    );
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
    if (
      client &&
      lockState.acquired &&
      !lockState.queryUnsettled &&
      lockState.pinnedPid !== undefined
    ) {
      try {
        await releaseOwnedLock(client, lockState, lockState.pinnedPid);
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
    if (pool) {
      try {
        await endOwnedPool(pool);
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
  }
  if (cleanupFailure) throw safeCoordinatorFailure(cleanupFailure);
  if (primaryFailure) throw safeCoordinatorFailure(primaryFailure);
  throw new CoordinatorStop(STOP);
}

void executeOwnedLifecycle;
