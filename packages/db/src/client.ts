import { loadDatabaseConfig } from '@xiaohai/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as coreSchema from './schema.js';
import * as cmsSchema from './cms-schema.js';
import * as commerceSchema from './commerce-schema.js';
import * as paymentSchema from './payment-schema.js';
import * as contentSchema from './content-schema.js';

const schema = {
  ...coreSchema,
  ...cmsSchema,
  ...commerceSchema,
  ...paymentSchema,
  ...contentSchema,
};
export function createDatabase(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDatabaseConfig(env);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  return { db: drizzle(pool, { schema }), pool };
}
