import { readFile } from 'node:fs/promises';
import { createDatabase } from './client.js';

type Journal = {
  entries?: Array<{ when?: number; tag?: string }>;
};

const journalUrl = new URL('../migrations/meta/_journal.json', import.meta.url);

async function latestJournalMigration() {
  const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as Journal;
  const entries = (journal.entries ?? []).filter(
    (entry): entry is { when: number; tag?: string } =>
      typeof entry.when === 'number' && Number.isFinite(entry.when),
  );
  if (entries.length === 0) throw new Error('MIGRATION_JOURNAL_EMPTY');
  return entries.reduce((latest, entry) => (entry.when > latest.when ? entry : latest));
}

const latest = await latestJournalMigration();
const { pool } = createDatabase();

try {
  const result = await pool.query<{ latest_applied: string | null }>(
    'select max(created_at)::text as latest_applied from drizzle.__drizzle_migrations',
  );
  const latestApplied = Number(result.rows[0]?.latest_applied ?? 0);

  if (!Number.isFinite(latestApplied) || latestApplied < latest.when) {
    console.error(
      `Database migrations are stale. Latest repository migration is ${latest.tag ?? latest.when}. Run "pnpm --filter @xiaohai/db db:migrate" before any paid image job.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Database migrations are current through ${latest.tag ?? latest.when}.`);
  }
} catch (error) {
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : '';

  if (code === '42P01' || code === '3F000') {
    console.error(
      'Database migration metadata is missing. Run "pnpm --filter @xiaohai/db db:migrate" before any paid image job.',
    );
  } else {
    console.error(
      `Could not verify database migration status${code ? ` (database error ${code})` : ''}.`,
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
