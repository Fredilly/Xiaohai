import { loadDatabaseConfig } from '@xiaohai/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { PoolClient } from 'pg';
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

export function assertTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');

  let databaseName: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgresql:') throw new Error('unsupported protocol');
    databaseName = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!databaseName || databaseName === 'xiaohai_dev') {
    throw new Error('TEST_DATABASE_URL must name a disposable test database');
  }
  if (!/(^|[_-])(test|tests|testing|ci|e2e|disposable)([_-]|$)/.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL must name a disposable test database');
  }

  return value;
}

export function createDatabase(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDatabaseConfig(env);
  const connectionString =
    env.NODE_ENV === 'test' ? assertTestDatabaseUrl(env.TEST_DATABASE_URL) : config.DATABASE_URL;
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

/** Common query/transaction surface, independent of the driver's client kind. */
export type DatabaseHandle = Omit<ReturnType<typeof createDatabase>['db'], '$client'>;

const i111Sessions = new WeakMap<object, { client: PoolClient; backendPid: number }>();

function readBackendPid(client: PoolClient | null | undefined): unknown {
  return client ? Reflect.get(client, 'processID') : undefined;
}

/** Reject a pooled or independently constructed Drizzle handle in I111 paths. */
export function assertI111SessionBoundDatabase(db: DatabaseHandle): void {
  const binding = db && i111Sessions.get(db);
  const currentPid = readBackendPid(binding?.client);
  if (
    process.env.APP_ENV !== 'dev' ||
    !binding ||
    currentPid !== binding.backendPid ||
    typeof binding.client.release !== 'function'
  ) {
    throw new Error('I111_SESSION_DB_STOP');
  }
}

/**
 * Build a Drizzle handle on the ALREADY checked-out I111 PostgreSQL client.
 * Unlike createDatabase(), this must never allocate or use a connection pool.
 * It does not connect, acquire a lock, authorize an operation, or release the
 * client; a future trusted coordinator must own the complete client lifetime.
 */
export function createI111SessionBoundDatabase(client: PoolClient) {
  const backendPid = readBackendPid(client);
  if (
    process.env.APP_ENV !== 'dev' ||
    !client ||
    typeof client.query !== 'function' ||
    typeof client.release !== 'function' ||
    typeof backendPid !== 'number' ||
    !Number.isSafeInteger(backendPid) ||
    backendPid <= 0
  ) {
    throw new Error('I111_SESSION_DB_STOP');
  }
  const db = drizzle(client, { schema }) satisfies DatabaseHandle;
  i111Sessions.set(db, { client, backendPid });
  return db;
}
