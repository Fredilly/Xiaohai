import { afterAll, afterEach, describe, expect, it } from 'vitest';
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
  works,
  workVersions,
} from '@xiaohai/db';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M11 Animation schema PostgreSQL constraints', () => {
  if (!database) return;
  const { db, pool } = database;

  afterEach(async () => {
    await pool.query('TRUNCATE TABLE consumer_users CASCADE');
  });
  afterAll(async () => pool.end());

  async function storyFixture() {
    const [owner] = await db.insert(consumerUsers).values({}).returning();
    const [other] = await db.insert(consumerUsers).values({}).returning();
    const [storyProject] = await db
      .insert(aiProjects)
      .values({
        projectType: 'STORY',
        title: 'Story source',
        createdByConsumerUserId: owner!.id,
      })
      .returning();
    const [storyWork] = await db
      .insert(works)
      .values({
        consumerUserId: owner!.id,
        aiProjectId: storyProject!.id,
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
        input: { prompt: 'fixture' },
        result: { text: '故事大纲', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();
    const [outlineVersion] = await db
      .insert(workVersions)
      .values({
        workId: storyWork!.id,
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
        input: { prompt: 'fixture' },
        result: { text: '故事正文', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();
    const [bodyVersion] = await db
      .insert(workVersions)
      .values({
        workId: storyWork!.id,
        versionNumber: 2,
        contentKind: 'BODY',
        operation: 'BODY',
        sourceVersionId: outlineVersion!.id,
        sourceAiJobId: bodyJob!.id,
        content: '故事正文',
      })
      .returning();
    const [animationProject] = await db
      .insert(aiProjects)
      .values({
        projectType: 'ANIMATION',
        title: 'AI animation',
        createdByConsumerUserId: owner!.id,
      })
      .returning();
    const [animation] = await db
      .insert(aiAnimations)
      .values({
        consumerUserId: owner!.id,
        aiProjectId: animationProject!.id,
        storyWorkId: storyWork!.id,
        sourceStoryVersionId: bodyVersion!.id,
        title: '森林动画',
      })
      .returning();
    return {
      owner: owner!,
      other: other!,
      storyWork: storyWork!,
      bodyVersion: bodyVersion!,
      animationProject: animationProject!,
      animation: animation!,
    };
  }

  async function sceneFixture() {
    const fixture = await storyFixture();
    const [planningJob] = await db
      .insert(aiJobs)
      .values({
        projectId: fixture.animationProject.id,
        jobType: 'ANIMATION_STORYBOARD',
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: {
          prompt: 'fixture',
          context: {
            kind: 'ANIMATION',
            animationId: fixture.animation.id,
            operation: 'STORYBOARD',
          },
        },
        result: { text: '{}', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();
    const [scene] = await db
      .insert(animationScenes)
      .values({
        animationId: fixture.animation.id,
        sceneNumber: 1,
        scriptText: '小狐狸走进森林。',
        narration: '清晨，森林醒来了。',
        dialogue: [{ speaker: '小狐狸', text: '早上好。' }],
        visualDescription: '晨光下的森林小路',
        generationPrompt: 'cinematic forest, orange fox',
        plannedDurationMs: 5000,
        sourcePlanningAiJobId: planningJob!.id,
      })
      .returning();
    return { ...fixture, scene: scene! };
  }

  it('enforces consumer ownership and source Story relationships', async () => {
    const fixture = await storyFixture();
    await expect(
      db.insert(aiAnimations).values({
        consumerUserId: fixture.other.id,
        aiProjectId: fixture.animationProject.id,
        storyWorkId: fixture.storyWork.id,
        sourceStoryVersionId: fixture.bodyVersion.id,
        title: '越权动画',
      }),
    ).rejects.toThrow();

    await expect(
      db
        .update(aiAnimations)
        .set({ scriptText: '没有来源作业的脚本' })
        .where(eq(aiAnimations.id, fixture.animation.id)),
    ).rejects.toThrow();
  });

  it('enforces scene numbering and immutable generation revision constraints', async () => {
    const fixture = await sceneFixture();
    await expect(
      db.insert(animationScenes).values({
        animationId: fixture.animation.id,
        sceneNumber: 0,
        scriptText: 'invalid',
        dialogue: [],
        visualDescription: 'invalid',
        generationPrompt: 'invalid',
        plannedDurationMs: 1000,
        sourcePlanningAiJobId: fixture.scene.sourcePlanningAiJobId,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(animationSceneGenerations).values({
        animationId: fixture.animation.id,
        sceneId: fixture.scene.id,
        revisionNumber: 1,
        provider: 'SERVER_CONTROLLED',
        model: 'server-model',
        status: 'READY',
        progressPercent: 100,
      }),
    ).rejects.toThrow();

    await db.insert(animationSceneGenerations).values({
      animationId: fixture.animation.id,
      sceneId: fixture.scene.id,
      revisionNumber: 1,
      provider: 'SERVER_CONTROLLED',
      model: 'server-model',
    });
    await expect(
      db.insert(animationSceneGenerations).values({
        animationId: fixture.animation.id,
        sceneId: fixture.scene.id,
        revisionNumber: 1,
        provider: 'SERVER_CONTROLLED',
        model: 'server-model',
      }),
    ).rejects.toThrow();
  });

  it('keeps composition inputs inside one animation and preserves revision history', async () => {
    const fixture = await sceneFixture();
    const [generation] = await db
      .insert(animationSceneGenerations)
      .values({
        animationId: fixture.animation.id,
        sceneId: fixture.scene.id,
        revisionNumber: 1,
        provider: 'SERVER_CONTROLLED',
        model: 'server-model',
      })
      .returning();
    const [composition] = await db
      .insert(animationCompositions)
      .values({ animationId: fixture.animation.id, revisionNumber: 1 })
      .returning();
    await db.insert(animationCompositionInputs).values({
      animationId: fixture.animation.id,
      compositionId: composition!.id,
      sceneGenerationId: generation!.id,
      sceneOrder: 1,
    });

    const otherFixture = await sceneFixture();
    const [otherGeneration] = await db
      .insert(animationSceneGenerations)
      .values({
        animationId: otherFixture.animation.id,
        sceneId: otherFixture.scene.id,
        revisionNumber: 1,
        provider: 'SERVER_CONTROLLED',
        model: 'server-model',
      })
      .returning();
    await expect(
      db.insert(animationCompositionInputs).values({
        animationId: fixture.animation.id,
        compositionId: composition!.id,
        sceneGenerationId: otherGeneration!.id,
        sceneOrder: 2,
      }),
    ).rejects.toThrow();

    await expect(
      db
        .insert(animationCompositions)
        .values({ animationId: fixture.animation.id, revisionNumber: 1 }),
    ).rejects.toThrow();
  });
});
