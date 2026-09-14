import { loadDatabaseConfig } from '@xiaohai/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export function createDatabase(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDatabaseConfig(env);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  return { db: drizzle(pool), pool };
}
