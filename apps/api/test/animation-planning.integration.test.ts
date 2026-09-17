import Fastify from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aiAnimations,
  aiJobs,
  aiProjects,
  animationCharacters,
  animationScenes,
  consumerUsers,
  createDatabase,
  workVersions,
  works,
} from '@xiaohai/db';
import { ConsumerSessionService } from '../src/auth/session.js';
import { registerAnimationRoutes } from '../src/animation/animation-routes.js';
import { AnimationService, type AnimationAiConfig } from '../src/animation/animation-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M11 Animation planning PostgreSQL integration and ownership', () => {
  if (!database) return;
  const db = database.db;
  const sessions = new ConsumerSessionService(
    'm11-animation-session-secret-at-least-32-characters',
    300,
  );
  const notifications: string[] = [];
  const queue = {
    notify: (id: string) => {
      notifications.push(id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
  const config: AnimationAiConfig = {
    enabled: true,
    provider: 'MOCK',
    model: 'server-animation-text',
    maxAttempts: 2,
    timeoutMs: 5000,
  };
  const service = (overrides: Partial<AnimationAiConfig> = {}) =>
    new AnimationService(db, queue, { ...config, ...overrides });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE consumer_users CASCADE');
    notifications.length = 0;
  });
  afterAll(async () => database.pool.end());

  async function user() {
    const [row] = await db.insert(consumerUsers).values({}).returning();
    return row!.id;
  }
  async function story(owner: string) {
    const [project] = await db
      .insert(aiProjects)
      .values({ projectType: 'STORY', title: '故事', createdByConsumerUserId: owner })
      .returning();
    const [work] = await db
      .insert(works)
      .values({
        consumerUserId: owner,
        aiProjectId: project!.id,
        title: '森林故事',
        idea: '帮助朋友',
        ageRange: '6-8',
        theme: '友谊',
        style: '温暖',
      })
      .returning();
    const [outlineJob] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        jobType: 'STORY_OUTLINE',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'outline' },
        result: { text: '大纲', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();
    const [outline] = await db
      .insert(workVersions)
      .values({
        workId: work!.id,
        versionNumber: 1,
        contentKind: 'OUTLINE',
        operation: 'OUTLINE',
        sourceAiJobId: outlineJob!.id,
        content: '大纲',
      })
      .returning();
    const [bodyJob] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        jobType: 'STORY_BODY',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'body' },
        result: { text: '故事正文', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();
    const [body] = await db
      .insert(workVersions)
      .values({
        workId: work!.id,
        versionNumber: 2,
        contentKind: 'BODY',
        operation: 'BODY',
        sourceVersionId: outline!.id,
        sourceAiJobId: bodyJob!.id,
        content: '小狐狸帮助小鸟回家。',
      })
      .returning();
    return { work: work!, outline: outline!, body: body! };
  }
  async function animation(owner: string) {
    const source = await story(owner);
    const created = await service().createAnimation(owner, {
      storyWorkId: source.work.id,
      sourceStoryVersionId: source.body.id,
    });
    return { source, created };
  }
  async function succeed(jobId: string, text: string) {
    await db
      .update(aiJobs)
      .set({ status: 'SUCCEEDED', result: { text, assetReferences: [] }, completedAt: new Date() })
      .where(eq(aiJobs.id, jobId));
  }
  const scriptOutput = JSON.stringify({
    title: '森林动画',
    synopsis: '互助故事',
    script: '小狐狸遇见小鸟并帮助它回家。',
  });
  const storyboardOutput = JSON.stringify({
    characters: [
      {
        name: '小狐狸',
        role: 'MAIN',
        description: '温柔勇敢',
        visualPrompt: 'orange fox, green scarf',
      },
    ],
    scenes: [
      {
        scriptText: '小狐狸走进森林。',
        narration: '清晨。',
        dialogue: [{ speaker: '小狐狸', text: '你好。' }],
        visualDescription: '晨光森林',
        generationPrompt: 'orange fox in morning forest',
        plannedDurationMs: 5000,
      },
    ],
  });

  it('requires a session, strict input, ownership and an owned BODY source', async () => {
    const alice = await user();
    const bob = await user();
    const source = await story(alice);
    const app = Fastify();
    registerAnimationRoutes(app, { animation: service(), consumerSessions: sessions });
    const noSession = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/animations',
      payload: { storyWorkId: source.work.id, sourceStoryVersionId: source.body.id },
    });
    expect(noSession.statusCode).toBe(401);
    const injection = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/animations',
      headers: { authorization: `Bearer ${sessions.issue(alice).token}` },
      payload: {
        storyWorkId: source.work.id,
        sourceStoryVersionId: source.body.id,
        provider: 'DEEPSEEK',
      },
    });
    expect(injection.statusCode).toBe(400);
    await expect(
      service().createAnimation(bob, {
        storyWorkId: source.work.id,
        sourceStoryVersionId: source.body.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_VERSION' });
    await expect(
      service().createAnimation(alice, {
        storyWorkId: source.work.id,
        sourceStoryVersionId: source.outline.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_VERSION' });
    await app.close();
  });

  it('creates isolated project and server-controlled SCRIPT job, then applies idempotently', async () => {
    const alice = await user();
    const { created } = await animation(alice);
    const accepted = await service().generate(alice, created.id, { operation: 'SCRIPT' });
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, accepted.jobId));
    expect(job).toMatchObject({
      provider: 'MOCK',
      model: 'server-animation-text',
      jobType: 'ANIMATION_SCRIPT',
    });
    expect(job!.input.context).toEqual({
      kind: 'ANIMATION',
      animationId: created.id,
      operation: 'SCRIPT',
    });
    expect(notifications).toContain(job!.id);
    await succeed(job!.id, scriptOutput);
    const first = await service().applyJob(alice, created.id, job!.id);
    const second = await service().applyJob(alice, created.id, job!.id);
    expect(first.animation.status).toBe('SCRIPT_READY');
    expect(second.animation.scriptSourceAiJobId).toBe(job!.id);
  });

  it('rejects storyboard before script and includes applied script in its prompt', async () => {
    const alice = await user();
    const { created } = await animation(alice);
    await expect(
      service().generate(alice, created.id, { operation: 'STORYBOARD' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const script = await service().generate(alice, created.id, { operation: 'SCRIPT' });
    await succeed(script.jobId, scriptOutput);
    await service().applyJob(alice, created.id, script.jobId);
    const storyboard = await service().generate(alice, created.id, { operation: 'STORYBOARD' });
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, storyboard.jobId));
    expect(job!.input.prompt).toContain('小狐狸遇见小鸟并帮助它回家。');
  });

  it('applies valid storyboard once and preserves stable character consistency', async () => {
    const alice = await user();
    const { created } = await animation(alice);
    const script = await service().generate(alice, created.id, { operation: 'SCRIPT' });
    await succeed(script.jobId, scriptOutput);
    await service().applyJob(alice, created.id, script.jobId);
    const storyboard = await service().generate(alice, created.id, { operation: 'STORYBOARD' });
    await succeed(storyboard.jobId, storyboardOutput);
    const first = await service().applyJob(alice, created.id, storyboard.jobId);
    const key = first.characters[0]!.consistencyKey;
    const second = await service().applyJob(alice, created.id, storyboard.jobId);
    expect(second.animation.status).toBe('STORYBOARD_READY');
    expect(second.characters).toHaveLength(1);
    expect(second.scenes).toHaveLength(1);
    expect(second.characters[0]!.consistencyKey).toBe(key);
  });

  it('fails closed for invalid output and unfinished jobs without partial planning rows', async () => {
    const alice = await user();
    const { created } = await animation(alice);
    const script = await service().generate(alice, created.id, { operation: 'SCRIPT' });
    await expect(service().applyJob(alice, created.id, script.jobId)).rejects.toMatchObject({
      code: 'JOB_NOT_READY',
    });
    await succeed(script.jobId, scriptOutput);
    await service().applyJob(alice, created.id, script.jobId);
    const storyboard = await service().generate(alice, created.id, { operation: 'STORYBOARD' });
    await succeed(storyboard.jobId, '{"characters":[],"scenes":[]}');
    await expect(service().applyJob(alice, created.id, storyboard.jobId)).rejects.toMatchObject({
      code: 'INVALID_JOB_OUTPUT',
    });
    expect(
      await db
        .select()
        .from(animationCharacters)
        .where(eq(animationCharacters.animationId, created.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(animationScenes).where(eq(animationScenes.animationId, created.id)),
    ).toHaveLength(0);
  });

  it('rejects cross-user/cross-animation jobs and fails closed when disabled', async () => {
    const alice = await user();
    const bob = await user();
    const one = await animation(alice);
    const two = await animation(alice);
    await expect(service().getAnimation(bob, one.created.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service({ enabled: false }).generate(alice, one.created.id, { operation: 'SCRIPT' }),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    const foreign = await service().generate(alice, two.created.id, { operation: 'SCRIPT' });
    await succeed(foreign.jobId, scriptOutput);
    await expect(service().applyJob(alice, one.created.id, foreign.jobId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const [oneRow] = await db
      .select()
      .from(aiAnimations)
      .where(and(eq(aiAnimations.id, one.created.id), eq(aiAnimations.consumerUserId, alice)));
    expect(oneRow!.scriptSourceAiJobId).toBeNull();
  });

  it('prevents duplicate active planning cost but permits retry after terminal failure', async () => {
    const alice = await user();
    const one = await animation(alice);
    const two = await animation(alice);
    const first = await service().generate(alice, one.created.id, { operation: 'SCRIPT' });
    await expect(
      service().generate(alice, one.created.id, { operation: 'SCRIPT' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const other = await service().generate(alice, two.created.id, { operation: 'SCRIPT' });
    expect(other.jobId).not.toBe(first.jobId);
    await db.update(aiJobs).set({ status: 'FAILED' }).where(eq(aiJobs.id, first.jobId));
    const retry = await service().generate(alice, one.created.id, { operation: 'SCRIPT' });
    expect(retry.jobId).not.toBe(first.jobId);
    await db.update(aiJobs).set({ status: 'CANCELLED' }).where(eq(aiJobs.id, retry.jobId));
    await expect(
      service().generate(alice, one.created.id, { operation: 'SCRIPT' }),
    ).resolves.toMatchObject({ operation: 'SCRIPT', status: 'QUEUED' });

    const three = await animation(alice);
    const concurrent = await Promise.allSettled([
      service().generate(alice, three.created.id, { operation: 'SCRIPT' }),
      service().generate(alice, three.created.id, { operation: 'SCRIPT' }),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('prevents duplicate active STORYBOARD planning jobs', async () => {
    const alice = await user();
    const { created } = await animation(alice);
    const script = await service().generate(alice, created.id, { operation: 'SCRIPT' });
    await succeed(script.jobId, scriptOutput);
    await service().applyJob(alice, created.id, script.jobId);
    await service().generate(alice, created.id, { operation: 'STORYBOARD' });
    await expect(
      service().generate(alice, created.id, { operation: 'STORYBOARD' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
