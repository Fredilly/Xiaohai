import { loadDatabaseConfig } from '@xiaohai/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
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
