import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiAnimations,
  aiJobs,
  aiProjects,
  animationCompositionInputs,
  animationCompositions,
  animationSceneGenerations,
  animationScenes,
  consumerUsers,
  createDatabase,
  mediaAssets,
  works,
  workVersions,
} from '@xiaohai/db';
import { CompositionProcessor } from '../src/composition-processor.js';
import { MockCompositionProvider, type CompositionProvider } from '../src/composition-provider.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M11 composition worker PostgreSQL integration', () => {
  const db = database!.db;

  beforeEach(async () => database!.pool.query('TRUNCATE TABLE consumer_users CASCADE'));
  afterAll(async () => database?.pool.end());

  async function queued(revisionNumber = 1) {
    const [user] = await db.insert(consumerUsers).values({}).returning();
    const [storyProject] = await db
      .insert(aiProjects)
      .values({ projectType: 'STORY', title: 'Story', createdByConsumerUserId: user!.id })
      .returning();
    const [work] = await db
      .insert(works)
      .values({
        consumerUserId: user!.id,
        aiProjectId: storyProject!.id,
        title: 'Story',
        idea: 'Friendship',
        ageRange: '6-8',
        theme: 'Friendship',
        style: 'Warm',
      })
      .returning();
    const [outlineJob] = await db
      .insert(aiJobs)
      .values({
        projectId: storyProject!.id,
        jobType: 'STORY_OUTLINE',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'outline' },
        result: { text: 'outline', assetReferences: [] },
      })
      .returning();

    const [outlineVersion] = await db
      .insert(workVersions)
      .values({
        workId: work!.id,
        versionNumber: 1,
        contentKind: 'OUTLINE',
        operation: 'OUTLINE',
        sourceAiJobId: outlineJob!.id,
        content: 'outline',
      })
      .returning();

    const [storyJob] = await db
      .insert(aiJobs)
      .values({
        projectId: storyProject!.id,
        jobType: 'STORY_BODY',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'body' },
        result: { text: 'body', assetReferences: [] },
      })
      .returning();
    const [version] = await db
      .insert(workVersions)
      .values({
        workId: work!.id,
        versionNumber: 2,
        contentKind: 'BODY',
        operation: 'BODY',
        sourceVersionId: outlineVersion!.id,
        sourceAiJobId: storyJob!.id,
        content: 'body',
      })
      .returning();
    const [project] = await db
      .insert(aiProjects)
      .values({ projectType: 'ANIMATION', title: 'Animation', createdByConsumerUserId: user!.id })
      .returning();
    const [animation] = await db
      .insert(aiAnimations)
      .values({
        consumerUserId: user!.id,
        aiProjectId: project!.id,
        storyWorkId: work!.id,
        sourceStoryVersionId: version!.id,
        title: 'Animation',
        status: 'COMPOSING',
      })
      .returning();
    const [planningJob] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        jobType: 'ANIMATION_STORYBOARD',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: {
          prompt: 'storyboard',
          context: { kind: 'ANIMATION', animationId: animation!.id, operation: 'STORYBOARD' },
        },
        result: { text: '{}', assetReferences: [] },
      })
      .returning();
    const [scene] = await db
      .insert(animationScenes)
      .values({
        animationId: animation!.id,
        sceneNumber: 1,
        scriptText: 'scene',
        dialogue: [],
        visualDescription: 'forest',
        generationPrompt: 'forest video',
        plannedDurationMs: 5000,
        sourcePlanningAiJobId: planningJob!.id,
      })
      .returning();
    const [sceneAsset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'MOCK_VIDEO',
        objectKey: `scene-${crypto.randomUUID()}.mp4`,
        playbackUrl: 'https://mock.invalid/scene.mp4',
        mimeType: 'video/mp4',
        durationSeconds: 5,
        status: 'READY',
      })
      .returning();
    const [generation] = await db
      .insert(animationSceneGenerations)
      .values({
        animationId: animation!.id,
        sceneId: scene!.id,
        revisionNumber: 1,
        provider: 'MOCK',
        model: 'mock-video-v1',
        status: 'READY',
        progressPercent: 100,
        mediaAssetId: sceneAsset!.id,
      })
      .returning();
    const [composition] = await db
      .insert(animationCompositions)
      .values({ animationId: animation!.id, revisionNumber })
      .returning();
    await db.insert(animationCompositionInputs).values({
      animationId: animation!.id,
      compositionId: composition!.id,
      sceneGenerationId: generation!.id,
      sceneOrder: 1,
    });
    return { animation: animation!, composition: composition! };
  }

  it('creates final media and completes the latest animation revision', async () => {
    const fixture = await queued();
    await new CompositionProcessor(db, new MockCompositionProvider(), 5000).processOne();
    const [composition] = await db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.id, fixture.composition.id));
    const [animation] = await db
      .select()
      .from(aiAnimations)
      .where(eq(aiAnimations.id, fixture.animation.id));
    expect(composition).toMatchObject({ status: 'READY', progressPercent: 100 });
    expect(composition!.mediaAssetId).toBeTruthy();
    expect(animation).toMatchObject({
      status: 'READY',
      finalMediaAssetId: composition!.mediaAssetId,
    });
  });

  it('fails safely without false media and permits a later immutable revision', async () => {
    const fixture = await queued();
    const unavailable: CompositionProvider = {
      name: 'MOCK',
      compose: () => Promise.reject(new Error('unavailable')),
    };
    await new CompositionProcessor(db, unavailable, 5000).processOne();
    const [failed] = await db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.id, fixture.composition.id));
    const [animation] = await db
      .select()
      .from(aiAnimations)
      .where(eq(aiAnimations.id, fixture.animation.id));
    expect(failed).toMatchObject({ status: 'FAILED', mediaAssetId: null });
    expect(animation!.status).toBe('GENERATING');
    const [retry] = await db
      .insert(animationCompositions)
      .values({ animationId: fixture.animation.id, revisionNumber: 2 })
      .returning();
    expect(retry!.revisionNumber).toBe(2);
    expect(failed!.revisionNumber).toBe(1);
  });

  it('does not let an older stale revision overwrite a newer result', async () => {
    const fixture = await queued(1);
    const [input] = await db
      .select()
      .from(animationCompositionInputs)
      .where(eq(animationCompositionInputs.compositionId, fixture.composition.id));
    const [newer] = await db
      .insert(animationCompositions)
      .values({ animationId: fixture.animation.id, revisionNumber: 2 })
      .returning();
    await db.insert(animationCompositionInputs).values({
      animationId: input!.animationId,
      compositionId: newer!.id,
      sceneGenerationId: input!.sceneGenerationId,
      sceneOrder: input!.sceneOrder,
    });
    await new CompositionProcessor(db, new MockCompositionProvider(), 5000).processOne();
    const [animation] = await db
      .select()
      .from(aiAnimations)
      .where(eq(aiAnimations.id, fixture.animation.id));
    const [old] = await db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.id, fixture.composition.id));
    expect(old!.status).toBe('READY');
    expect(animation!.finalMediaAssetId).toBeNull();
    expect(animation!.status).toBe('COMPOSING');
  });

  it('classifies timeout without creating a false READY asset', async () => {
    const fixture = await queued();
    const timeout: CompositionProvider = {
      name: 'MOCK',
      compose: () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    };
    await new CompositionProcessor(db, timeout, 5000).processOne();
    const [composition] = await db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.id, fixture.composition.id));
    expect(composition).toMatchObject({
      status: 'FAILED',
      mediaAssetId: null,
      errorCode: 'COMPOSITION_PROVIDER_TIMEOUT',
    });
  });
});
