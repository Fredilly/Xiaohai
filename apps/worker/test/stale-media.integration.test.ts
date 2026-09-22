import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiAnimations,
  aiJobs,
  aiProjects,
  animationCompositions,
  consumerUsers,
  createDatabase,
  works,
  workVersions,
} from '@xiaohai/db';
import { recoverStaleMedia } from '../src/stale-media.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M23 stale media PostgreSQL integration', () => {
  const db = database!.db;

  beforeEach(async () => database!.pool.query('TRUNCATE TABLE consumer_users CASCADE'));
  afterAll(async () => database?.pool.end());

  async function staleComposition() {
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
    const [version] = await db
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
    const [animationProject] = await db
      .insert(aiProjects)
      .values({
        projectType: 'ANIMATION',
        title: 'Animation',
        createdByConsumerUserId: user!.id,
      })
      .returning();
    const [animation] = await db
      .insert(aiAnimations)
      .values({
        consumerUserId: user!.id,
        aiProjectId: animationProject!.id,
        storyWorkId: work!.id,
        sourceStoryVersionId: version!.id,
        title: 'Animation',
        status: 'COMPOSING',
      })
      .returning();
    const [composition] = await db
      .insert(animationCompositions)
      .values({
        animationId: animation!.id,
        revisionNumber: 1,
        status: 'RUNNING',
        progressPercent: 5,
        startedAt: new Date('2020-01-01T00:00:00.000Z'),
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      })
      .returning();
    return { animation: animation!, composition: composition! };
  }

  it('atomically fails a stale latest composition and returns its parent to GENERATING', async () => {
    const fixture = await staleComposition();
    const recoveredAt = Date.parse('2026-09-22T00:00:00.000Z');
    const timeouts = { imageMs: 5_000, videoMs: 5_000, compositionMs: 5_000 };

    expect((await recoverStaleMedia(db, timeouts, recoveredAt)).compositions).toBe(1);

    const [composition] = await db
      .select()
      .from(animationCompositions)
      .where(eq(animationCompositions.id, fixture.composition.id));
    const [animation] = await db
      .select()
      .from(aiAnimations)
      .where(eq(aiAnimations.id, fixture.animation.id));

    expect(composition).toMatchObject({
      status: 'FAILED',
      errorCode: 'COMPOSITION_WORKER_TIMEOUT',
      mediaAssetId: null,
    });
    expect(composition!.completedAt?.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(animation!.status).toBe('GENERATING');

    expect((await recoverStaleMedia(db, timeouts, recoveredAt)).compositions).toBe(0);
    const [unchanged] = await db
      .select({ status: aiAnimations.status })
      .from(aiAnimations)
      .where(eq(aiAnimations.id, fixture.animation.id));
    expect(unchanged!.status).toBe('GENERATING');
  });
});
