import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { aiJobAttempts, aiJobs, aiProjects, createDatabase, staffAccounts } from '@xiaohai/db';
import { AiPlatformService } from '../src/ai/ai-service.js';
const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
suite('M8 AI platform PostgreSQL integration', () => {
  const db = database?.db as NonNullable<typeof database>['db'];
  const notifications: string[] = [];
  const staffIds: string[] = [];
  const service = new AiPlatformService(db, {
    notify: (id) => {
      notifications.push(id);
      return Promise.resolve();
    },
    close: async () => {},
  });
  beforeEach(async () => {
    await db.delete(aiJobAttempts);
    await db.delete(aiJobs);
    await db.delete(aiProjects);
    notifications.length = 0;
  });
  afterEach(async () => {
    await db.delete(aiJobAttempts);
    await db.delete(aiJobs);
    await db.delete(aiProjects);
    if (staffIds.length) await db.delete(staffAccounts).where(inArray(staffAccounts.id, staffIds));
    staffIds.length = 0;
  });
  afterAll(async () => database?.pool.end());
  async function staff() {
    const [row] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: randomUUID(), passwordHash: 'integration-only' })
      .returning();
    staffIds.push(row!.id);
    return row!.id;
  }
  it('creates project/job atomically and sends only job ID to Redis queue', async () => {
    const result = await service.enqueue(await staff(), {
      projectTitle: 'Platform probe',
      prompt: 'not a story workflow',
      provider: 'MOCK',
      model: 'mock-v1',
      timeoutMs: 1000,
      maxAttempts: 2,
    });
    expect(result.status).toBe('QUEUED');
    expect(notifications).toEqual([result.id]);
    expect(await db.select().from(aiProjects)).toHaveLength(1);
    expect(await db.select().from(aiJobs)).toHaveLength(1);
  });
  it('treats enqueue and retry notifications as best-effort after PostgreSQL commits', async () => {
    const logger = { warn: vi.fn() };
    const unavailableQueue = {
      notify: () => Promise.reject(new Error('redis unavailable')),
      close: () => Promise.resolve(),
    };
    const bestEffort = new AiPlatformService(db, unavailableQueue, logger);
    const created = await bestEffort.enqueue(await staff(), {
      projectTitle: 'Best effort wake-up',
      prompt: 'must not enter logs',
      provider: 'MOCK',
      model: 'mock-v1',
      timeoutMs: 1000,
      maxAttempts: 2,
    });
    expect(created.status).toBe('QUEUED');
    expect(await db.select().from(aiProjects)).toHaveLength(1);
    expect(await db.select().from(aiJobs)).toHaveLength(1);
    await db.update(aiJobs).set({ status: 'FAILED' }).where(eq(aiJobs.id, created.id));
    expect((await bestEffort.retry(created.id)).status).toBe('QUEUED');
    expect(await db.select().from(aiProjects)).toHaveLength(1);
    expect(await db.select().from(aiJobs)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('must not enter logs');
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'AI_QUEUE_NOTIFY_FAILED',
        jobId: created.id,
        operation: 'enqueue',
      }),
      expect.any(String),
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ operation: 'retry' }),
      expect.any(String),
    );
  });
  it('enforces status transitions and cancellation wins over running completion', async () => {
    const result = await service.enqueue(await staff(), {
      projectTitle: 'P',
      prompt: 'x',
      provider: 'MOCK',
      model: 'm',
      timeoutMs: 1000,
      maxAttempts: 1,
    });
    expect((await service.cancel(result.id)).status).toBe('CANCELLED');
    await expect(service.retry(result.id)).rejects.toMatchObject({ code: 'INVALID_AI_JOB_STATE' });
    await db.update(aiJobs).set({ status: 'FAILED' });
    expect((await service.retry(result.id)).status).toBe('QUEUED');
    await db.update(aiJobs).set({ status: 'RUNNING' });
    expect((await service.cancel(result.id)).status).toBe('CANCELLED');
  });
  it('manual retry advances the budget start without deleting attempt history', async () => {
    const created = await service.enqueue(await staff(), {
      projectTitle: 'Manual retry budget',
      prompt: 'platform probe',
      provider: 'MOCK',
      model: 'mock-v1',
      timeoutMs: 1000,
      maxAttempts: 1,
    });
    await db.insert(aiJobAttempts).values({
      jobId: created.id,
      attemptNumber: 1,
      status: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
      finishedAt: new Date(),
    });
    await db.update(aiJobs).set({ status: 'FAILED' }).where(eq(aiJobs.id, created.id));
    const historyBeforeRetry = await db
      .select()
      .from(aiJobAttempts)
      .where(eq(aiJobAttempts.jobId, created.id));
    expect(historyBeforeRetry).toHaveLength(1);

    expect((await service.retry(created.id)).status).toBe('QUEUED');
    const [retried] = await db.select().from(aiJobs).where(eq(aiJobs.id, created.id));
    const historyAfterRetry = await db
      .select()
      .from(aiJobAttempts)
      .where(eq(aiJobAttempts.jobId, created.id));
    expect(retried).toMatchObject({ status: 'QUEUED', attemptBudgetStart: 1 });
    expect(historyAfterRetry).toEqual(historyBeforeRetry);
  });
  it('database rejects invalid states, attempts and broken foreign keys', async () => {
    const result = await service.enqueue(await staff(), {
      projectTitle: 'P',
      prompt: 'x',
      provider: 'MOCK',
      model: 'm',
      timeoutMs: 1000,
      maxAttempts: 1,
    });
    await expect(
      db.update(aiJobs).set({ status: 'PAID' }).where(eq(aiJobs.id, result.id)),
    ).rejects.toThrow();
    await expect(
      db.insert(aiJobAttempts).values({ jobId: randomUUID(), attemptNumber: 1 }),
    ).rejects.toThrow();
  });
});
