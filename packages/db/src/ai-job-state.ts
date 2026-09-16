import { and, eq, sql } from 'drizzle-orm';
import { aiJobAttempts, aiJobs } from './ai-schema.js';
import type { createDatabase } from './client.js';

type Db = ReturnType<typeof createDatabase>['db'];

export async function resetAiJobAttemptBudget(db: Db, jobId: string) {
  const [updated] = await db
    .update(aiJobs)
    .set({
      status: 'QUEUED',
      runAfter: new Date(),
      startedAt: null,
      completedAt: null,
      lastErrorCode: null,
      attemptBudgetStart: sql<number>`(
        select count(*)::integer
        from ${aiJobAttempts}
        where ${aiJobAttempts.jobId} = ${aiJobs.id}
      )`,
      updatedAt: new Date(),
    })
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.status, 'FAILED')))
    .returning({ id: aiJobs.id });
  return Boolean(updated);
}
