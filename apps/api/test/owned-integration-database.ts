import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '@xiaohai/db';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

/** An independently migrated synthetic database, never a reused test/merchant DB.
 * Required for COMMIT/parallel-connection tests of immutable ledgers: cleanup may
 * not weaken triggers or leave records for legacy broad-delete fixtures.
 */
export function createOwnedIntegrationDatabase(env: NodeJS.ProcessEnv) {
  if (!assertMeipingApplyDisposableDatabase(env)) return null;
  const name = `xiaohai_i208_test_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(env.TEST_DATABASE_URL ?? env.DATABASE_URL!);
  target.pathname = `/${name}`;
  const childEnv = { ...env, DATABASE_URL: target.href, TEST_DATABASE_URL: target.href };
  assertMeipingApplyDisposableDatabase(childEnv);
  const admin = createDatabase(env);
  const database = createDatabase(childEnv);
  let created = false;
  return {
    database,
    async start() {
      await admin.pool.query(`CREATE DATABASE "${name}"`);
      created = true;
      await migrate(database.db, {
        migrationsFolder: fileURLToPath(
          new URL('../../../packages/db/migrations', import.meta.url),
        ),
      });
    },
    async stop() {
      await database.pool.end();
      try {
        if (created) await admin.pool.query(`DROP DATABASE "${name}"`);
      } finally {
        await admin.pool.end();
      }
    },
  };
}
