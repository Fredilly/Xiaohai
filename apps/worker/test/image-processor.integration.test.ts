import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiJobs,
  aiProjects,
  characterProfiles,
  consumerUsers,
  createDatabase,
  mediaAssets,
  pictureBooks,
  workPageIllustrations,
  workPages,
  works,
  workVersions,
} from '@xiaohai/db';
import { ImageJobProcessor } from '../src/image-processor.js';
import { MockImageProvider, type ImageProvider } from '../src/image-provider.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M10 image worker PostgreSQL integration', () => {
  const db = database!.db;

  async function queued() {
    const [user] = await db.insert(consumerUsers).values({}).returning();
    const [project] = await db
      .insert(aiProjects)
      .values({ projectType: 'STORY', title: 'fixture', createdByConsumerUserId: user!.id })
      .returning();
    const [work] = await db
      .insert(works)
      .values({
        consumerUserId: user!.id,
        aiProjectId: project!.id,
        workType: 'STORY',
        title: 'fixture',
        idea: 'fixture',
        ageRange: '6-8',
        theme: 'friendship',
        style: 'storybook',
      })
      .returning();
    const [job] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'fixture' },
        result: { text: 'fixture', assetReferences: [] },
        completedAt: new Date(),
      })
      .returning();
    const [version] = await db
      .insert(workVersions)
      .values({
        workId: work!.id,
        versionNumber: 1,
        contentKind: 'BODY',
        operation: 'BODY',
        sourceAiJobId: job!.id,
        content: 'fixture story',
      })
      .returning();
    const [bookProject] = await db
      .insert(aiProjects)
      .values({ projectType: 'PICTURE_BOOK', title: 'book', createdByConsumerUserId: user!.id })
      .returning();
    const [book] = await db
      .insert(pictureBooks)
      .values({
        consumerUserId: user!.id,
        aiProjectId: bookProject!.id,
        storyWorkId: work!.id,
        sourceStoryVersionId: version!.id,
        title: 'book',
        status: 'PLANNED',
      })
      .returning();
    const consistencyKey = crypto.randomUUID();
    await db.insert(characterProfiles).values({
      pictureBookId: book!.id,
      name: '小狐狸',
      description: '友善的小狐狸',
      visualPrompt: 'orange fox with green scarf',
      consistencyKey,
    });
    const [page] = await db
      .insert(workPages)
      .values({
        pictureBookId: book!.id,
        pageNumber: 1,
        storyText: '小狐狸出发。',
        sceneDescription: '森林',
        illustrationPrompt: 'fox in a forest',
      })
      .returning();
    const consistency = [
      {
        consistencyKey,
        visualPrompt: 'orange fox with green scarf',
        referenceMediaAssetId: null,
      },
    ];
    const [illustration] = await db
      .insert(workPageIllustrations)
      .values({
        pageId: page!.id,
        revisionNumber: 1,
        prompt: page!.illustrationPrompt!,
        provider: 'MOCK',
        model: 'server-image-model',
        consistency,
      })
      .returning();
    return { illustration: illustration!, consistency };
  }

  afterEach(async () => {
    await database!.pool.query(`TRUNCATE TABLE consumer_users CASCADE`);
  });
  afterAll(async () => database?.pool.end());

  it('propagates consistency constraints and persists a media reference without image binary', async () => {
    const fixture = await queued();
    const generate = vi.fn<ImageProvider['generate']>(async (input) =>
      new MockImageProvider().generate(input),
    );
    await new ImageJobProcessor(db, { name: 'MOCK', generate }, 5_000).processOne();

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ consistency: fixture.consistency }),
    );
    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'READY', errorCode: null });
    expect(saved!.mediaAssetId).toBeTruthy();
    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, saved!.mediaAssetId!));
    expect(asset).toMatchObject({ provider: 'MOCK_IMAGE', mimeType: 'image/png', status: 'READY' });
    expect(asset!.objectKey).not.toMatch(/base64|data:/i);
    expect(asset!.playbackUrl).not.toMatch(/base64|data:/i);
  });

  it('records provider failure without creating a false READY asset', async () => {
    const fixture = await queued();
    const provider: ImageProvider = {
      name: 'MOCK',
      generate: () => Promise.reject(new Error('unavailable')),
    };
    await new ImageJobProcessor(db, provider, 5_000).processOne();
    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_UNAVAILABLE' });
    expect(saved!.mediaAssetId).toBeNull();
    expect(await db.select().from(mediaAssets)).toHaveLength(0);
  });
});
