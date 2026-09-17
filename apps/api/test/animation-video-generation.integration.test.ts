import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aiAnimations,
  aiJobs,
  aiProjects,
  animationCompositionInputs,
  animationCompositions,
  animationSceneGenerations,
  consumerUsers,
  createDatabase,
  mediaAssets,
  workVersions,
  works,
} from '@xiaohai/db';
import { ConsumerSessionService } from '../src/auth/session.js';
import { registerAnimationRoutes } from '../src/animation/animation-routes.js';
import { animationSceneGenerationAcceptedSchema } from '@xiaohai/contracts/animation';
import {
  AnimationService,
  type AnimationAiConfig,
  type AnimationVideoConfig,
} from '../src/animation/animation-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M11 Animation scene generation PostgreSQL integration', () => {
  if (!database) return;

  const db = database.db;

  const sessions = new ConsumerSessionService(
    'm11-animation-video-session-secret-at-least-32-characters',
    300,
  );

  const aiNotifications: string[] = [];
  const videoNotifications: string[] = [];
  const compositionNotifications: string[] = [];

  const aiQueue = {
    notify: (id: string) => {
      aiNotifications.push(id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const videoQueue = {
    notify: (id: string) => {
      videoNotifications.push(id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const compositionQueue = {
    notify: (id: string) => {
      compositionNotifications.push(id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const aiConfig: AnimationAiConfig = {
    enabled: true,
    provider: 'MOCK',
    model: 'server-animation-text',
    maxAttempts: 2,
    timeoutMs: 5000,
  };

  const videoConfig: AnimationVideoConfig = {
    enabled: true,
    provider: 'MOCK',
    model: 'server-video-model',
  };

  const service = (videoOverrides: Partial<AnimationVideoConfig> = {}) =>
    new AnimationService(
      db,
      aiQueue,
      aiConfig,
      undefined,
      videoQueue,
      {
        ...videoConfig,
        ...videoOverrides,
      },
      compositionQueue,
      {
        compositionEnabled: true,
        maxGenerations: 100,
        maxCompositions: 10,
        maxPlannedDurationMs: 600_000,
      },
    );

  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE consumer_users CASCADE');
    aiNotifications.length = 0;
    videoNotifications.length = 0;
    compositionNotifications.length = 0;
  });

  afterAll(async () => database.pool.end());

  async function user() {
    const [row] = await db.insert(consumerUsers).values({}).returning();
    return row!.id;
  }

  async function story(owner: string) {
    const [project] = await db
      .insert(aiProjects)
      .values({
        projectType: 'STORY',
        title: '故事',
        createdByConsumerUserId: owner,
      })
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

    return { work: work!, body: body! };
  }

  async function succeed(jobId: string, text: string) {
    await db
      .update(aiJobs)
      .set({
        status: 'SUCCEEDED',
        result: { text, assetReferences: [] },
        completedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId));
  }

  async function storyboardReady(owner: string) {
    const source = await story(owner);

    const created = await service().createAnimation(owner, {
      storyWorkId: source.work.id,
      sourceStoryVersionId: source.body.id,
    });

    const script = await service().generate(owner, created.id, {
      operation: 'SCRIPT',
    });

    await succeed(
      script.jobId,
      JSON.stringify({
        title: '森林动画',
        synopsis: '互助故事',
        script: '小狐狸遇见小鸟并帮助它回家。',
      }),
    );

    await service().applyJob(owner, created.id, script.jobId);

    const storyboard = await service().generate(owner, created.id, {
      operation: 'STORYBOARD',
    });

    await succeed(
      storyboard.jobId,
      JSON.stringify({
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
      }),
    );

    const detail = await service().applyJob(owner, created.id, storyboard.jobId);

    return {
      animation: detail.animation,
      scene: detail.scenes[0]!,
    };
  }

  it('creates a server-controlled scene generation and moves the animation to GENERATING', async () => {
    const alice = await user();
    const fixture = await storyboardReady(alice);

    const accepted = await service().generateScene(alice, fixture.animation.id, fixture.scene.id);

    expect(accepted).toMatchObject({
      animationId: fixture.animation.id,
      sceneId: fixture.scene.id,
      revisionNumber: 1,
      status: 'QUEUED',
    });

    const [generation] = await db
      .select()
      .from(animationSceneGenerations)
      .where(eq(animationSceneGenerations.id, accepted.generationId));

    expect(generation).toMatchObject({
      animationId: fixture.animation.id,
      sceneId: fixture.scene.id,
      revisionNumber: 1,
      provider: 'MOCK',
      model: 'server-video-model',
      status: 'QUEUED',
      progressPercent: 0,
    });

    expect(videoNotifications).toEqual([accepted.generationId]);

    const [animation] = await db
      .select()
      .from(aiAnimations)
      .where(eq(aiAnimations.id, fixture.animation.id));

    expect(animation!.status).toBe('GENERATING');
  });

  it('rejects an active duplicate and creates an immutable next revision after failure', async () => {
    const alice = await user();
    const fixture = await storyboardReady(alice);

    const first = await service().generateScene(alice, fixture.animation.id, fixture.scene.id);

    await expect(
      service().generateScene(alice, fixture.animation.id, fixture.scene.id),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await db
      .update(animationSceneGenerations)
      .set({
        status: 'FAILED',
        errorCode: 'VIDEO_PROVIDER_UNAVAILABLE',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(animationSceneGenerations.id, first.generationId));

    const second = await service().generateScene(alice, fixture.animation.id, fixture.scene.id);

    expect(second.revisionNumber).toBe(2);
    expect(second.generationId).not.toBe(first.generationId);

    const rows = await db
      .select()
      .from(animationSceneGenerations)
      .where(eq(animationSceneGenerations.sceneId, fixture.scene.id));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.revisionNumber).sort()).toEqual([1, 2]);
  });

  it('enforces ownership, feature gate and strict HTTP input', async () => {
    const alice = await user();
    const bob = await user();
    const fixture = await storyboardReady(alice);

    await expect(
      service().generateScene(bob, fixture.animation.id, fixture.scene.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      service({ enabled: false }).generateScene(alice, fixture.animation.id, fixture.scene.id),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });

    const app = Fastify();

    registerAnimationRoutes(app, {
      animation: service(),
      consumerSessions: sessions,
    });

    const token = sessions.issue(alice).token;

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/animations/${fixture.animation.id}/scenes/${fixture.scene.id}/generations`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        provider: 'DEEPSEEK',
        model: 'client-controlled-model',
      },
    });

    expect(invalid.statusCode).toBe(400);

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/animations/${fixture.animation.id}/scenes/${fixture.scene.id}/generations`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {},
    });

    expect(accepted.statusCode).toBe(202);

    const body = animationSceneGenerationAcceptedSchema.parse(accepted.json());

    expect(body).toMatchObject({
      animationId: fixture.animation.id,
      sceneId: fixture.scene.id,
      revisionNumber: 1,
      status: 'QUEUED',
    });

    await app.close();
  });

  it('exposes generation revisions through animation detail', async () => {
    const alice = await user();
    const fixture = await storyboardReady(alice);

    const accepted = await service().generateScene(alice, fixture.animation.id, fixture.scene.id);

    const detail = await service().getAnimation(alice, fixture.animation.id);

    expect(detail.scenes).toHaveLength(1);
    expect(detail.scenes[0]!.generations).toHaveLength(1);
    expect(detail.scenes[0]!.generations[0]).toMatchObject({
      id: accepted.generationId,
      revisionNumber: 1,
      provider: 'MOCK',
      model: 'server-video-model',
      status: 'QUEUED',
    });
  });

  it('creates immutable compositions with persisted inputs and rejects unsafe selections', async () => {
    const alice = await user();
    const bob = await user();
    const fixture = await storyboardReady(alice);
    const acceptedGeneration = await service().generateScene(
      alice,
      fixture.animation.id,
      fixture.scene.id,
    );
    const [asset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'MOCK_VIDEO',
        objectKey: `animations/mock/${acceptedGeneration.generationId}.mp4`,
        playbackUrl: `https://mock.invalid/${acceptedGeneration.generationId}.mp4`,
        mimeType: 'video/mp4',
        status: 'READY',
      })
      .returning();
    await db
      .update(animationSceneGenerations)
      .set({ status: 'READY', progressPercent: 100, mediaAssetId: asset!.id })
      .where(eq(animationSceneGenerations.id, acceptedGeneration.generationId));

    await expect(
      service().createComposition(bob, fixture.animation.id, [acceptedGeneration.generationId]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service().createComposition(alice, fixture.animation.id, [crypto.randomUUID()]),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const first = await service().createComposition(alice, fixture.animation.id, [
      acceptedGeneration.generationId,
    ]);
    expect(first).toMatchObject({ revisionNumber: 1, status: 'QUEUED' });
    expect(compositionNotifications).toEqual([first.compositionId]);
    await expect(
      service().createComposition(alice, fixture.animation.id, [acceptedGeneration.generationId]),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await db
      .update(animationCompositions)
      .set({ status: 'FAILED', errorCode: 'COMPOSITION_PROVIDER_UNAVAILABLE' })
      .where(eq(animationCompositions.id, first.compositionId));
    await db
      .update(aiAnimations)
      .set({ status: 'GENERATING' })
      .where(eq(aiAnimations.id, fixture.animation.id));
    const second = await service().createComposition(alice, fixture.animation.id, [
      acceptedGeneration.generationId,
    ]);
    expect(second.revisionNumber).toBe(2);

    const compositions = await db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.animationId, fixture.animation.id));
    const inputs = await db
      .select()
      .from(animationCompositionInputs)
      .where(eq(animationCompositionInputs.animationId, fixture.animation.id));
    expect(compositions).toHaveLength(2);
    expect(inputs).toHaveLength(2);
    const detail = await service().getAnimation(alice, fixture.animation.id);
    expect(detail.compositions.map((row) => row.inputs.length)).toEqual([1, 1]);
  });

  it('rejects strict composition injection, disabled composition, and exhausted budgets', async () => {
    const alice = await user();
    const fixture = await storyboardReady(alice);
    const app = Fastify();
    registerAnimationRoutes(app, { animation: service(), consumerSessions: sessions });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/animations/${fixture.animation.id}/compositions`,
      headers: { authorization: `Bearer ${sessions.issue(alice).token}` },
      payload: { sceneGenerationIds: [crypto.randomUUID()], provider: 'CLIENT' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();

    const disabled = new AnimationService(
      db,
      aiQueue,
      aiConfig,
      undefined,
      videoQueue,
      videoConfig,
      compositionQueue,
      {
        compositionEnabled: false,
        maxGenerations: 1,
        maxCompositions: 1,
        maxPlannedDurationMs: 600_000,
      },
    );
    await expect(
      disabled.createComposition(alice, fixture.animation.id, [crypto.randomUUID()]),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });

    await service().generateScene(alice, fixture.animation.id, fixture.scene.id);
    await db
      .update(animationSceneGenerations)
      .set({ status: 'FAILED' })
      .where(eq(animationSceneGenerations.animationId, fixture.animation.id));
    const limited = new AnimationService(
      db,
      aiQueue,
      aiConfig,
      undefined,
      videoQueue,
      videoConfig,
      compositionQueue,
      {
        compositionEnabled: true,
        maxGenerations: 1,
        maxCompositions: 1,
        maxPlannedDurationMs: 600_000,
      },
    );
    await expect(
      limited.generateScene(alice, fixture.animation.id, fixture.scene.id),
    ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
});
