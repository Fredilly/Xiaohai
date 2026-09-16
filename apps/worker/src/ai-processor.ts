import { and, asc, count, eq, lte, sql } from 'drizzle-orm';
import { aiJobAttempts, aiJobs, type createDatabase } from '@xiaohai/db';
import type { AiProvider } from './ai-provider.js';
import { ProviderError } from './ai-provider.js';
import type { ModerationAdapter } from './moderation.js';
type Db = ReturnType<typeof createDatabase>['db'];
export class AiJobProcessor {
  constructor(
    private readonly db: Db,
    private readonly provider: AiProvider,
    private readonly moderation: ModerationAdapter,
  ) {}
  async recoverStale() {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        update ai_job_attempts
        set status = 'TIMED_OUT', error_code = 'WORKER_LEASE_EXPIRED', finished_at = now()
        where status = 'RUNNING' and job_id in (
          select id from ai_jobs
          where status = 'RUNNING'
            and started_at < now() - (timeout_ms * interval '1 millisecond')
        )
      `);
      await tx
        .update(aiJobs)
        .set({
          status: 'QUEUED',
          runAfter: new Date(),
          lastErrorCode: 'WORKER_LEASE_EXPIRED',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiJobs.status, 'RUNNING'),
            sql`${aiJobs.startedAt} < now() - (${aiJobs.timeoutMs} * interval '1 millisecond')`,
          ),
        );
    });
  }
  async processOne(): Promise<string | null> {
    const claimed = await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(aiJobs)
        .where(
          and(
            eq(aiJobs.status, 'QUEUED'),
            lte(aiJobs.runAfter, new Date()),
            eq(aiJobs.provider, this.provider.name),
          ),
        )
        .orderBy(asc(aiJobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return null;
      const [total] = await tx
        .select({ value: count() })
        .from(aiJobAttempts)
        .where(eq(aiJobAttempts.jobId, job.id));
      const attemptNumber = (total?.value ?? 0) + 1;
      if (attemptNumber > job.maxAttempts) {
        await tx
          .update(aiJobs)
          .set({
            status: 'FAILED',
            lastErrorCode: 'MAX_ATTEMPTS_EXCEEDED',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(aiJobs.id, job.id));
        return null;
      }
      const [attempt] = await tx
        .insert(aiJobAttempts)
        .values({ jobId: job.id, attemptNumber })
        .returning();
      await tx
        .update(aiJobs)
        .set({ status: 'RUNNING', startedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiJobs.id, job.id));
      return { job, attempt: attempt! };
    });
    if (!claimed) return null;
    const inputModeration = await this.moderation.moderate(claimed.job.input.prompt, 'INPUT');
    if (inputModeration.status === 'BLOCKED') {
      await this.finishFailure(
        claimed,
        'MODERATION_BLOCKED',
        { input: inputModeration.status, reasonCodes: inputModeration.reasonCodes },
        false,
      );
      return claimed.job.id;
    }
    try {
      const result = await this.provider.generate({
        model: claimed.job.model,
        prompt: claimed.job.input.prompt,
        signal: AbortSignal.timeout(claimed.job.timeoutMs),
      });
      const outputModeration = await this.moderation.moderate(result.text, 'OUTPUT');
      if (outputModeration.status === 'BLOCKED') {
        await this.finishFailure(
          claimed,
          'MODERATION_BLOCKED',
          {
            input: inputModeration.status,
            output: outputModeration.status,
            reasonCodes: outputModeration.reasonCodes,
          },
          false,
        );
        return claimed.job.id;
      }
      await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(aiJobs)
          .set({
            status: 'SUCCEEDED',
            result: { text: result.text, assetReferences: result.assetReferences },
            moderation: {
              input: inputModeration.status,
              output: outputModeration.status,
              reasonCodes: [...inputModeration.reasonCodes, ...outputModeration.reasonCodes],
            },
            usage: result.usage,
            costMetadata: result.costMetadata,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(aiJobs.id, claimed.job.id), eq(aiJobs.status, 'RUNNING')))
          .returning({ id: aiJobs.id });
        await tx
          .update(aiJobAttempts)
          .set({
            status: updated ? 'SUCCEEDED' : 'CANCELLED',
            providerRequestId: result.providerRequestId,
            usage: result.usage,
            costMetadata: result.costMetadata,
            moderation: {
              input: inputModeration.status,
              output: outputModeration.status,
              reasonCodes: [...inputModeration.reasonCodes, ...outputModeration.reasonCodes],
            },
            finishedAt: new Date(),
          })
          .where(eq(aiJobAttempts.id, claimed.attempt.id));
      });
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : 'PROVIDER_UNAVAILABLE';
      await this.finishFailure(
        claimed,
        code,
        { input: inputModeration.status, reasonCodes: inputModeration.reasonCodes },
        true,
      );
    }
    return claimed.job.id;
  }
  private async finishFailure(
    claimed: { job: typeof aiJobs.$inferSelect; attempt: typeof aiJobAttempts.$inferSelect },
    code: string,
    moderation: { input: string; output?: string; reasonCodes: string[] },
    retryable: boolean,
  ) {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ status: aiJobs.status })
        .from(aiJobs)
        .where(eq(aiJobs.id, claimed.job.id))
        .for('update');
      const terminal = !retryable || claimed.attempt.attemptNumber >= claimed.job.maxAttempts;
      if (current?.status === 'CANCELLED') {
        await tx
          .update(aiJobAttempts)
          .set({ status: 'CANCELLED', errorCode: 'CANCELLED', moderation, finishedAt: new Date() })
          .where(eq(aiJobAttempts.id, claimed.attempt.id));
        return;
      }
      await tx
        .update(aiJobAttempts)
        .set({
          status: code === 'PROVIDER_TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
          errorCode: code,
          moderation,
          finishedAt: new Date(),
        })
        .where(eq(aiJobAttempts.id, claimed.attempt.id));
      await tx
        .update(aiJobs)
        .set({
          status: terminal ? 'FAILED' : 'QUEUED',
          runAfter: new Date(
            Date.now() + Math.min(30000, 1000 * 2 ** (claimed.attempt.attemptNumber - 1)),
          ),
          lastErrorCode: code,
          moderation,
          completedAt: terminal ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(aiJobs.id, claimed.job.id));
    });
  }
}
