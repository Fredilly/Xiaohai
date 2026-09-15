import { loadDatabaseConfig } from '@xiaohai/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as coreSchema from './schema.js';
import * as cmsSchema from './cms-schema.js';
import * as commerceSchema from './commerce-schema.js';

const schema = { ...coreSchema, ...cmsSchema, ...commerceSchema };

export function createDatabase(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDatabaseConfig(env);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  return { db: drizzle(pool, { schema }), pool };
}
