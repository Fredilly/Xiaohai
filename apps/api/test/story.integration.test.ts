import Fastify from 'fastify';
import { count, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiJobs, consumerUsers, createDatabase, workVersions } from '@xiaohai/db';
import { ConsumerSessionService } from '../src/auth/session.js';
import { registerStoryRoutes } from '../src/story/story-routes.js';
import { StoryService } from '../src/story/story-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

const consumerSessionSecret = 'm9-story-consumer-session-secret-at-least-32-characters';

suite('M9 Story AI PostgreSQL integration and ownership', () => {
  const db = database!.db;
  const sessions = new ConsumerSessionService(consumerSessionSecret, 300);
  let notifications: string[] = [];

  const config = {
    enabled: true,
    provider: 'MOCK' as const,
    model: 'server-controlled-story-model',
    maxAttempts: 2,
    timeoutMs: 5_000,
  };

  const resetDatabase = async () => {
    await database!.pool.query(`
      TRUNCATE TABLE
        work_versions,
        works,
        ai_job_attempts,
        ai_jobs,
        ai_projects,
        consumer_users
      CASCADE
    `);
    notifications = [];
  };

  beforeEach(resetDatabase);
  afterEach(resetDatabase);
  afterAll(async () => database?.pool.end());

  const queue = {
    notify: (jobId: string) => {
      notifications.push(jobId);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  function service() {
    return new StoryService(db, queue, config);
  }

  async function createUser() {
    const [user] = await db.insert(consumerUsers).values({}).returning({ id: consumerUsers.id });

    return user!.id;
  }

  function token(userId: string) {
    return sessions.issue(userId).token;
  }

  async function createApp(story = service()) {
    const app = Fastify({ logger: false });

    registerStoryRoutes(app, {
      story,
      consumerSessions: sessions,
    });

    return app;
  }

  async function createWork(
    story: StoryService,
    userId: string,
    idea = '一只小狐狸帮助迷路的小鸟回家',
  ) {
    return story.createWork(userId, {
      title: '森林里的小灯塔',
      idea,
      ageRange: '6-8',
      theme: '勇气与互助',
      style: '温暖童话',
    });
  }

  async function succeed(jobId: string, text: string) {
    await db
      .update(aiJobs)
      .set({
        status: 'SUCCEEDED',
        result: { text, assetReferences: [] },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId));
  }

  it('requires Consumer Session and isolates works between consumers', async () => {
    const app = await createApp();

    try {
      const alice = await createUser();
      const bob = await createUser();

      let response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/story/works',
        payload: {
          idea: '没有登录不能创建',
          ageRange: '6-8',
          theme: '友情',
          style: '童话',
        },
      });

      expect(response.statusCode).toBe(401);

      response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/story/works',
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {
          title: 'Alice 的故事',
          idea: '一只小熊第一次独自去图书馆',
          ageRange: '6-8',
          theme: '成长',
          style: '温暖童话',
        },
      });

      expect(response.statusCode).toBe(201);
      const work = response.json<{ id: string }>();

      const aliceDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/story/works/${work.id}`,
        headers: { authorization: `Bearer ${token(alice)}` },
      });

      expect(aliceDetail.statusCode).toBe(200);

      const bobDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/story/works/${work.id}`,
        headers: { authorization: `Bearer ${token(bob)}` },
      });

      expect(bobDetail.statusCode).toBe(404);

      const bobList = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/story/works',
        headers: { authorization: `Bearer ${token(bob)}` },
      });

      expect(bobList.statusCode).toBe(200);
      expect(bobList.json()).toEqual({ works: [] });
    } finally {
      await app.close();
    }
  });

  it('creates Story jobs with server-controlled provider, model and opaque queue notification', async () => {
    const story = service();
    const app = await createApp(story);

    try {
      const alice = await createUser();
      const bob = await createUser();
      const work = await createWork(story, alice);

      let response = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/story/works/${work.id}/generate`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {
          operation: 'OUTLINE',
          provider: 'DEEPSEEK',
          model: 'client-must-not-control-this',
        },
      });

      expect(response.statusCode).toBe(400);

      response = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/story/works/${work.id}/generate`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: { operation: 'OUTLINE' },
      });

      expect(response.statusCode).toBe(202);

      const accepted = response.json<{
        workId: string;
        jobId: string;
        operation: string;
        status: string;
      }>();

      expect(accepted).toMatchObject({
        workId: work.id,
        operation: 'OUTLINE',
        status: 'QUEUED',
      });

      expect(notifications).toEqual([accepted.jobId]);

      const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, accepted.jobId));

      expect(job).toMatchObject({
        jobType: 'STORY_OUTLINE',
        provider: 'MOCK',
        model: 'server-controlled-story-model',
        status: 'QUEUED',
      });

      expect(job!.input.context).toEqual({
        kind: 'STORY',
        workId: work.id,
        operation: 'OUTLINE',
        sourceVersionId: null,
      });

      const aliceJob = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/story/jobs/${accepted.jobId}`,
        headers: { authorization: `Bearer ${token(alice)}` },
      });

      expect(aliceJob.statusCode).toBe(200);
      expect(aliceJob.json()).toMatchObject({
        jobId: accepted.jobId,
        workId: work.id,
        generatedText: null,
        savedVersionId: null,
      });

      const bobJob = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/story/jobs/${accepted.jobId}`,
        headers: { authorization: `Bearer ${token(bob)}` },
      });

      expect(bobJob.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('enforces source-version semantics and prevents cross-work or cross-user version use', async () => {
    const story = service();
    const alice = await createUser();
    const bob = await createUser();

    const aliceWork = await createWork(story, alice);
    const bobWork = await createWork(story, bob, 'Bob 的独立故事，不应读取 Alice 版本');

    const outlineJob = await story.generate(alice, aliceWork.id, {
      operation: 'OUTLINE',
    });

    await succeed(outlineJob.jobId, '1. 开端\n2. 发展\n3. 转折\n4. 结尾');

    const [firstSave, secondSave] = await Promise.all([
      story.saveVersion(alice, aliceWork.id, outlineJob.jobId),
      story.saveVersion(alice, aliceWork.id, outlineJob.jobId),
    ]);

    expect(firstSave.id).toBe(secondSave.id);
    expect(firstSave).toMatchObject({
      versionNumber: 1,
      contentKind: 'OUTLINE',
      operation: 'OUTLINE',
      sourceVersionId: null,
    });

    const [versionCount] = await db
      .select({ value: count() })
      .from(workVersions)
      .where(eq(workVersions.sourceAiJobId, outlineJob.jobId));

    expect(versionCount?.value).toBe(1);

    await expect(
      story.generate(alice, aliceWork.id, {
        operation: 'REWRITE',
        sourceVersionId: firstSave.id,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SOURCE_VERSION',
    });

    await expect(
      story.generate(bob, bobWork.id, {
        operation: 'BODY',
        sourceVersionId: firstSave.id,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SOURCE_VERSION',
    });

    const bodyJob = await story.generate(alice, aliceWork.id, {
      operation: 'BODY',
      sourceVersionId: firstSave.id,
    });

    await succeed(bodyJob.jobId, '这是根据大纲生成的完整故事正文。');

    const bodyVersion = await story.saveVersion(alice, aliceWork.id, bodyJob.jobId);

    expect(bodyVersion).toMatchObject({
      versionNumber: 2,
      contentKind: 'BODY',
      operation: 'BODY',
      sourceVersionId: firstSave.id,
    });

    await expect(story.getWork(bob, aliceWork.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(story.saveVersion(bob, aliceWork.id, bodyJob.jobId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps committed Story jobs recoverable when Redis notification fails and does not log prompt content', async () => {
    const logger = { warn: vi.fn() };
    const unavailableQueue = {
      notify: () => Promise.reject(new Error('redis unavailable')),
      close: async () => {},
    };

    const story = new StoryService(db, unavailableQueue, config, logger);

    const alice = await createUser();
    const work = await createWork(story, alice, 'SENSITIVE-STORY-IDEA-MUST-NOT-ENTER-LOGS');

    const accepted = await story.generate(alice, work.id, {
      operation: 'OUTLINE',
    });

    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, accepted.jobId));

    expect(job?.status).toBe('QUEUED');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'SENSITIVE-STORY-IDEA-MUST-NOT-ENTER-LOGS',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'STORY_AI_QUEUE_NOTIFY_FAILED',
        jobId: accepted.jobId,
        workId: work.id,
      }),
      expect.any(String),
    );
  });

  it('fails closed while Story AI is disabled', async () => {
    const disabled = new StoryService(db, queue, {
      ...config,
      enabled: false,
    });

    const alice = await createUser();
    const work = await createWork(disabled, alice);

    await expect(
      disabled.generate(alice, work.id, {
        operation: 'OUTLINE',
      }),
    ).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });

    expect(await db.select().from(aiJobs)).toHaveLength(0);
  });

  it('does not save unfinished or failed jobs as work versions', async () => {
    const story = service();
    const alice = await createUser();
    const work = await createWork(story, alice);

    const accepted = await story.generate(alice, work.id, {
      operation: 'OUTLINE',
    });

    await expect(story.saveVersion(alice, work.id, accepted.jobId)).rejects.toMatchObject({
      code: 'JOB_NOT_READY',
    });

    await db
      .update(aiJobs)
      .set({
        status: 'FAILED',
        lastErrorCode: 'PROVIDER_UNAVAILABLE',
        completedAt: new Date(),
      })
      .where(eq(aiJobs.id, accepted.jobId));

    await expect(story.saveVersion(alice, work.id, accepted.jobId)).rejects.toMatchObject({
      code: 'JOB_NOT_READY',
    });

    expect(await db.select().from(workVersions)).toHaveLength(0);
  });
});
