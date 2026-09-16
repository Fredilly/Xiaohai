import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  aiJobAttempts,
  aiJobs,
  aiProjects,
  createDatabase,
  resetAiJobAttemptBudget,
  staffAccounts,
} from '@xiaohai/db';
import { AiJobProcessor } from '../src/ai-processor.js';
import { MockAiProvider, ProviderError, type AiProvider } from '../src/ai-provider.js';
import { BaselineModerationAdapter, type ModerationAdapter } from '../src/moderation.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M8 worker PostgreSQL integration', () => {
  const db = database!.db;
  const staffIds: string[] = [];

  async function queued(maxAttempts = 2) {
    const [staff] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: randomUUID(), passwordHash: 'integration-only' })
      .returning();
    staffIds.push(staff!.id);
    const [project] = await db
      .insert(aiProjects)
      .values({ title: 'Worker integration', createdByStaffAccountId: staff!.id })
      .returning();
    const [job] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        provider: 'MOCK',
        model: 'mock-v1',
        input: { prompt: 'platform probe' },
        timeoutMs: 1000,
        maxAttempts,
      })
      .returning();
    return job!;
  }

  afterEach(async () => {
    await db.delete(aiJobAttempts);
    await db.delete(aiJobs);
    await db.delete(aiProjects);
    if (staffIds.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, staffIds));
    staffIds.length = 0;
  });
  afterAll(async () => database?.pool.end());

  it('claims once under concurrency and persists result, usage and moderation metadata', async () => {
    const job = await queued();
    const first = new AiJobProcessor(db, new MockAiProvider(), new BaselineModerationAdapter());
    const second = new AiJobProcessor(db, new MockAiProvider(), new BaselineModerationAdapter());
    await Promise.all([first.processOne(), second.processOne()]);
    const [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    const attempts = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));
    expect(saved).toMatchObject({ status: 'SUCCEEDED' });
    expect(saved!.result?.text).toContain('platform probe');
    expect(saved!.usage?.totalTokens).toBeGreaterThan(0);
    expect(saved!.moderation?.input).toBe('REVIEW_REQUIRED');
    expect(attempts).toHaveLength(1);
  });

  it('requeues retryable failures and fails after the configured maximum', async () => {
    const job = await queued(2);
    const unavailable: AiProvider = {
      name: 'MOCK',
      generate: () => Promise.reject(new ProviderError('PROVIDER_UNAVAILABLE')),
    };
    const processor = new AiJobProcessor(db, unavailable, new BaselineModerationAdapter());
    await processor.processOne();
    await db
      .update(aiJobs)
      .set({ runAfter: new Date(0) })
      .where(eq(aiJobs.id, job.id));
    await processor.processOne();
    const [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    const attempts = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));
    expect(saved).toMatchObject({ status: 'FAILED', lastErrorCode: 'PROVIDER_UNAVAILABLE' });
    expect(attempts).toHaveLength(2);
  });

  it('executes a full fresh budget after manual retry and preserves exhausted attempts', async () => {
    const job = await queued(2);
    const generate = vi
      .fn<AiProvider['generate']>()
      .mockRejectedValueOnce(new ProviderError('PROVIDER_UNAVAILABLE'))
      .mockRejectedValueOnce(new ProviderError('PROVIDER_UNAVAILABLE'))
      .mockRejectedValueOnce(new ProviderError('PROVIDER_UNAVAILABLE'))
      .mockResolvedValueOnce({
        text: 'manual retry executed',
        assetReferences: [],
        usage: { totalTokens: 4 },
        costMetadata: { source: 'regression' },
      });
    const processor = new AiJobProcessor(
      db,
      { name: 'MOCK', generate },
      new BaselineModerationAdapter(),
    );

    await processor.processOne();
    await db
      .update(aiJobs)
      .set({ runAfter: new Date(0) })
      .where(eq(aiJobs.id, job.id));
    await processor.processOne();

    let [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    expect(saved).toMatchObject({
      status: 'FAILED',
      attemptBudgetStart: 0,
    });

    expect(await resetAiJobAttemptBudget(db, job.id)).toBe(true);

    [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    expect(saved).toMatchObject({
      status: 'QUEUED',
      attemptBudgetStart: 2,
    });

    await processor.processOne();

    [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    expect(saved).toMatchObject({
      status: 'QUEUED',
      lastErrorCode: 'PROVIDER_UNAVAILABLE',
      attemptBudgetStart: 2,
    });

    await db
      .update(aiJobs)
      .set({ runAfter: new Date(0) })
      .where(eq(aiJobs.id, job.id));
    await processor.processOne();

    [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    const attempts = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));

    expect(saved).toMatchObject({
      status: 'SUCCEEDED',
      attemptBudgetStart: 2,
    });
    expect(generate).toHaveBeenCalledTimes(4);
    expect(attempts).toHaveLength(4);
    expect(attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3, 4]);
  });

  it('records provider timeouts as timed-out attempts', async () => {
    const job = await queued(1);
    const timedOut: AiProvider = {
      name: 'MOCK',
      generate: () => Promise.reject(new ProviderError('PROVIDER_TIMEOUT')),
    };
    await new AiJobProcessor(db, timedOut, new BaselineModerationAdapter()).processOne();
    const [attempt] = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));
    expect(attempt).toMatchObject({ status: 'TIMED_OUT', errorCode: 'PROVIDER_TIMEOUT' });
  });

  it('recovers an expired worker lease and closes the abandoned attempt', async () => {
    const job = await queued(2);
    await db
      .update(aiJobs)
      .set({ status: 'RUNNING', startedAt: new Date(Date.now() - 10_000), timeoutMs: 1000 })
      .where(eq(aiJobs.id, job.id));
    await db.insert(aiJobAttempts).values({ jobId: job.id, attemptNumber: 1 });
    await new AiJobProcessor(
      db,
      new MockAiProvider(),
      new BaselineModerationAdapter(),
    ).recoverStale();
    const [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    const [attempt] = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));
    expect(saved).toMatchObject({ status: 'QUEUED', lastErrorCode: 'WORKER_LEASE_EXPIRED' });
    expect(attempt).toMatchObject({ status: 'TIMED_OUT', errorCode: 'WORKER_LEASE_EXPIRED' });
  });

  it('retries input moderation failures and leaves no running rows at max attempts', async () => {
    const job = await queued(2);
    const unavailable: ModerationAdapter = {
      moderate: () => Promise.reject(new Error('moderation unavailable')),
    };
    const processor = new AiJobProcessor(db, new MockAiProvider(), unavailable);
    await processor.processOne();
    let [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    expect(saved).toMatchObject({ status: 'QUEUED', lastErrorCode: 'MODERATION_UNAVAILABLE' });
    await db
      .update(aiJobs)
      .set({ runAfter: new Date(0) })
      .where(eq(aiJobs.id, job.id));
    await processor.processOne();
    [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    const attempts = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));
    expect(saved).toMatchObject({ status: 'FAILED', lastErrorCode: 'MODERATION_UNAVAILABLE' });
    expect(saved!.moderation).toBeNull();
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.status === 'FAILED')).toBe(true);
    expect(attempts.every((attempt) => attempt.errorCode === 'MODERATION_UNAVAILABLE')).toBe(true);
    expect(attempts.every((attempt) => attempt.moderation === null)).toBe(true);
  });

  it('classifies output moderation failures and preserves provider usage metadata', async () => {
    const job = await queued(1);
    const provider: AiProvider = {
      name: 'MOCK',
      generate: () =>
        Promise.resolve({
          text: 'provider result',
          assetReferences: [],
          providerRequestId: 'provider-request-8',
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          costMetadata: { source: 'integration', amountMinor: 7 },
        }),
    };
    const moderation: ModerationAdapter = {
      moderate: (_text, phase) =>
        phase === 'INPUT'
          ? Promise.resolve({ status: 'PASSED', reasonCodes: [] })
          : Promise.reject(new Error('output moderation unavailable')),
    };
    await new AiJobProcessor(db, provider, moderation).processOne();
    const [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id));
    const [attempt] = await db.select().from(aiJobAttempts).where(eq(aiJobAttempts.jobId, job.id));
    expect(saved).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'MODERATION_UNAVAILABLE',
      usage: { totalTokens: 5 },
      costMetadata: { source: 'integration', amountMinor: 7 },
    });
    expect(attempt).toMatchObject({
      status: 'FAILED',
      errorCode: 'MODERATION_UNAVAILABLE',
      providerRequestId: 'provider-request-8',
      usage: { totalTokens: 5 },
      costMetadata: { source: 'integration', amountMinor: 7 },
    });
    expect(attempt!.errorCode).not.toBe('PROVIDER_UNAVAILABLE');
  });
});
