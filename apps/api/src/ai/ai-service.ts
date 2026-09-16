import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  aiJobAttempts,
  aiJobs,
  aiProjects,
  resetAiJobAttemptBudget,
  type createDatabase,
} from '@xiaohai/db';
import type { z } from 'zod';
import type { createAiJobRequestSchema } from '@xiaohai/contracts/ai';
import type { AiQueue } from './ai-queue.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Input = z.infer<typeof createAiJobRequestSchema>;
export class AiPlatformError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_AI_JOB_STATE') {
    super(code);
  }
}
type AiPlatformLogger = {
  warn(bindings: Record<string, unknown>, message: string): void;
};
export class AiPlatformService {
  constructor(
    private readonly db: Db,
    private readonly queue: AiQueue,
    private readonly logger?: AiPlatformLogger,
  ) {}
  async enqueue(staffId: string, input: Input) {
    const job = await this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(aiProjects)
        .values({ title: input.projectTitle, createdByStaffAccountId: staffId })
        .returning();
      const [created] = await tx
        .insert(aiJobs)
        .values({
          projectId: project!.id,
          provider: input.provider,
          model: input.model,
          input: { prompt: input.prompt },
          timeoutMs: input.timeoutMs,
          maxAttempts: input.maxAttempts,
        })
        .returning();
      return created!;
    });
    try {
      await this.queue.notify(job.id);
    } catch {
      this.logger?.warn(
        { event: 'AI_QUEUE_NOTIFY_FAILED', jobId: job.id, operation: 'enqueue' },
        'AI queue notification failed; PostgreSQL polling will recover the job',
      );
    }
    return this.get(job.id);
  }
  async list() {
    const rows = await this.db
      .select({ job: aiJobs, project: aiProjects })
      .from(aiJobs)
      .innerJoin(aiProjects, eq(aiJobs.projectId, aiProjects.id))
      .orderBy(desc(aiJobs.createdAt))
      .limit(100);
    return {
      jobs: await Promise.all(rows.map(({ job, project }) => this.view(job, project.title))),
    };
  }
  async get(id: string) {
    const [row] = await this.db
      .select({ job: aiJobs, project: aiProjects })
      .from(aiJobs)
      .innerJoin(aiProjects, eq(aiJobs.projectId, aiProjects.id))
      .where(eq(aiJobs.id, id));
    if (!row) throw new AiPlatformError('NOT_FOUND');
    return this.view(row.job, row.project.title);
  }
  async cancel(id: string) {
    const [updated] = await this.db
      .update(aiJobs)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiJobs.id, id), inArray(aiJobs.status, ['QUEUED', 'RUNNING'])))
      .returning();
    if (!updated) {
      const current = await this.get(id);
      if (current.status !== 'CANCELLED') throw new AiPlatformError('INVALID_AI_JOB_STATE');
    }
    return this.get(id);
  }
  async retry(id: string) {
    if (!(await resetAiJobAttemptBudget(this.db, id)))
      throw new AiPlatformError('INVALID_AI_JOB_STATE');
    try {
      await this.queue.notify(id);
    } catch {
      this.logger?.warn(
        { event: 'AI_QUEUE_NOTIFY_FAILED', jobId: id, operation: 'retry' },
        'AI queue notification failed; PostgreSQL polling will recover the job',
      );
    }
    return this.get(id);
  }
  private async view(job: typeof aiJobs.$inferSelect, projectTitle: string) {
    const [attempts] = await this.db
      .select({ value: count() })
      .from(aiJobAttempts)
      .where(eq(aiJobAttempts.jobId, job.id));
    return {
      id: job.id,
      projectId: job.projectId,
      projectTitle,
      provider: job.provider,
      model: job.model,
      status: job.status,
      result: job.result,
      moderation: job.moderation,
      usage: job.usage,
      costMetadata: job.costMetadata,
      attemptCount: attempts?.value ?? 0,
      maxAttempts: job.maxAttempts,
      timeoutMs: job.timeoutMs,
      lastErrorCode: job.lastErrorCode,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
