import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiAnimations,
  aiJobs,
  aiProjects,
  animationCharacters,
  animationSceneGenerations,
  animationScenes,
  consumerUsers,
  createDatabase,
  mediaAssets,
  works,
  workVersions,
} from '@xiaohai/db';
import { VideoJobProcessor } from '../src/video-processor.js';
import { MockVideoProvider, type VideoProvider } from '../src/video-provider.js';
import { BaselineModerationAdapter } from '../src/moderation.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M11 video worker PostgreSQL integration', () => {
  const db = database!.db;

  async function queued() {
    const [user] = await db.insert(consumerUsers).values({}).returning();

    const [storyProject] = await db
      .insert(aiProjects)
      .values({
        projectType: 'STORY',
        title: 'Story source',
        createdByConsumerUserId: user!.id,
      })
      .returning();

    const [work] = await db
      .insert(works)
      .values({
        consumerUserId: user!.id,
        aiProjectId: storyProject!.id,
        workType: 'STORY',
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
        projectId: storyProject!.id,
        jobType: 'STORY_OUTLINE',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'fixture outline' },
        result: { text: '故事大纲', assetReferences: [] },
        completedAt: new Date(),
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
        content: '故事大纲',
      })
      .returning();

    const [bodyJob] = await db
      .insert(aiJobs)
      .values({
        projectId: storyProject!.id,
        jobType: 'STORY_BODY',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'fixture body' },
        result: { text: '故事正文', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();

    const [bodyVersion] = await db
      .insert(workVersions)
      .values({
        workId: work!.id,
        versionNumber: 2,
        contentKind: 'BODY',
        operation: 'BODY',
        sourceVersionId: outlineVersion!.id,
        sourceAiJobId: bodyJob!.id,
        content: '小狐狸帮助小鸟回家。',
      })
      .returning();

    const [animationProject] = await db
      .insert(aiProjects)
      .values({
        projectType: 'ANIMATION',
        title: '森林动画',
        createdByConsumerUserId: user!.id,
      })
      .returning();

    const [animation] = await db
      .insert(aiAnimations)
      .values({
        consumerUserId: user!.id,
        aiProjectId: animationProject!.id,
        storyWorkId: work!.id,
        sourceStoryVersionId: bodyVersion!.id,
        title: '森林动画',
      })
      .returning();

    const [planningJob] = await db
      .insert(aiJobs)
      .values({
        projectId: animationProject!.id,
        jobType: 'ANIMATION_STORYBOARD',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: {
          prompt: 'fixture storyboard',
          context: {
            kind: 'ANIMATION',
            animationId: animation!.id,
            operation: 'STORYBOARD',
          },
        },
        result: { text: '{}', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();

    const consistencyKey = crypto.randomUUID();

    await db.insert(animationCharacters).values({
      animationId: animation!.id,
      name: '小狐狸',
      role: 'MAIN',
      description: '温柔勇敢的小狐狸',
      visualPrompt: 'orange fox with green scarf',
      consistencyKey,
      referenceMediaAssetId: null,
      sourceAiJobId: planningJob!.id,
      sortOrder: 0,
    });

    const [scene] = await db
      .insert(animationScenes)
      .values({
        animationId: animation!.id,
        sceneNumber: 1,
        scriptText: '小狐狸走进森林。',
        narration: '清晨，森林醒来了。',
        dialogue: [{ speaker: '小狐狸', text: '早上好。' }],
        visualDescription: '晨光下的森林小路',
        generationPrompt: 'orange fox walking through a morning forest',
        plannedDurationMs: 5200,
        sourcePlanningAiJobId: planningJob!.id,
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
      })
      .returning();

    const consistency = [
      {
        consistencyKey,
        visualPrompt: 'orange fox with green scarf',
        referenceMediaAssetId: null,
      },
    ];

    return {
      animation: animation!,
      scene: scene!,
      generation: generation!,
      consistency,
    };
  }

  beforeEach(async () => {
    await database!.pool.query('TRUNCATE TABLE media_assets, consumer_users CASCADE');
  });

  afterEach(async () => {
    await database!.pool.query('TRUNCATE TABLE media_assets, consumer_users CASCADE');
  });

  afterAll(async () => database?.pool.end());

  it('propagates scene and character constraints and persists READY video metadata', async () => {
    const fixture = await queued();

    const generate = vi.fn<VideoProvider['generate']>((input) =>
      new MockVideoProvider().generate(input),
    );

    await new VideoJobProcessor(
      db,
      { name: 'MOCK', generate },
      5_000,
      new BaselineModerationAdapter(),
    ).processOne();

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        generationKey: fixture.generation.id,
        model: 'mock-video-v1',
        prompt: fixture.scene.generationPrompt,
        plannedDurationMs: 5200,
        consistency: fixture.consistency,
      }),
    );

    const [saved] = await db
      .select()
      .from(animationSceneGenerations)
      .where(eq(animationSceneGenerations.id, fixture.generation.id));

    expect(saved).toMatchObject({
      status: 'READY',
      progressPercent: 100,
      errorCode: null,
    });
    expect(saved!.mediaAssetId).toBeTruthy();
    expect(saved!.completedAt).toBeTruthy();
    expect(saved!.usage).toEqual({ durationSeconds: 6 });

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, saved!.mediaAssetId!));

    expect(asset).toMatchObject({
      provider: 'MOCK_VIDEO',
      mimeType: 'video/mp4',
      durationSeconds: 6,
      status: 'READY',
    });
    expect(asset!.objectKey).not.toMatch(/base64|data:/i);
    expect(asset!.playbackUrl).not.toMatch(/base64|data:/i);
  });

  it('records provider failure without creating a false READY video asset', async () => {
    const fixture = await queued();

    const provider: VideoProvider = {
      name: 'MOCK',
      generate: () => Promise.reject(new Error('unavailable')),
    };

    await new VideoJobProcessor(db, provider, 5_000, new BaselineModerationAdapter()).processOne();

    const [saved] = await db
      .select()
      .from(animationSceneGenerations)
      .where(eq(animationSceneGenerations.id, fixture.generation.id));

    expect(saved).toMatchObject({
      status: 'FAILED',
      errorCode: 'VIDEO_PROVIDER_UNAVAILABLE',
    });
    expect(saved!.mediaAssetId).toBeNull();
    expect(saved!.completedAt).toBeTruthy();

    expect(await db.select().from(mediaAssets)).toHaveLength(0);
  });
});
