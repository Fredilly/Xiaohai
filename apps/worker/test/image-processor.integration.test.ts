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
import {
  ImageProviderError,
  MockImageProvider,
  type ImageProvider,
} from '../src/image-provider.js';
import { recoverStaleMedia } from '../src/stale-media.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M10 image worker PostgreSQL integration', () => {
  const db = database!.db;

  async function queued(provider: 'MOCK' | 'BAILIAN' = 'MOCK') {
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
    const [outlineJob] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'fixture outline' },
        result: { text: 'fixture outline', assetReferences: [] },
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
        content: 'fixture outline',
      })
      .returning();
    const [bodyJob] = await db
      .insert(aiJobs)
      .values({
        projectId: project!.id,
        provider: 'MOCK',
        model: 'fixture',
        status: 'SUCCEEDED',
        input: { prompt: 'fixture body' },
        result: { text: 'fixture story', assetReferences: [] },
        completedAt: new Date(),
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
        sourceAiJobId: bodyJob!.id,
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
        provider,
        model: 'server-image-model',
        consistency,
      })
      .returning();
    return { illustration: illustration!, consistency };
  }

  afterEach(async () => {
    await database!.pool.query(`TRUNCATE TABLE media_assets, consumer_users CASCADE`);
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
    expect(asset).toMatchObject({
      provider: 'MOCK_IMAGE',
      mimeType: 'image/jpeg',
      status: 'READY',
    });
    expect(asset!.objectKey).not.toMatch(/base64|data:/i);
    expect(asset!.playbackUrl).not.toMatch(/base64|data:/i);
  });

  it('does not pass a MOCK local display URL as an I2I reference and reaches READY', async () => {
    const fixture = await queued();
    const [referenceAsset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'MOCK_IMAGE',
        objectKey: 'picture-books/mock/reference.jpg',
        playbackUrl: 'http://127.0.0.1:3000/api/v1/dev/mock-images/reference.jpg',
        mimeType: 'image/jpeg',
        status: 'READY',
      })
      .returning();
    await db
      .update(workPageIllustrations)
      .set({
        consistency: [{ ...fixture.consistency[0]!, referenceMediaAssetId: referenceAsset!.id }],
      })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const generate = vi.fn<ImageProvider['generate']>((input) => {
      expect(input.referenceImages).toEqual([]);
      return new MockImageProvider().generate(input);
    });

    await new ImageJobProcessor(db, { name: 'MOCK', generate }, 5_000).processOne();

    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'READY' });
    expect(saved!.mediaAssetId).toBeTruthy();
  });

  it('skips MOCK references for BAILIAN while preserving consistency descriptions', async () => {
    const fixture = await queued('BAILIAN');
    const [referenceAsset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'MOCK_IMAGE',
        objectKey: 'picture-books/mock/reference-http.jpg',
        playbackUrl: 'http://127.0.0.1:3000/api/v1/dev/mock-images/reference.jpg',
        mimeType: 'image/jpeg',
        status: 'READY',
      })
      .returning();
    await db
      .update(workPageIllustrations)
      .set({
        consistency: [{ ...fixture.consistency[0]!, referenceMediaAssetId: referenceAsset!.id }],
      })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const generate = vi.fn<ImageProvider['generate']>((input) => {
      expect(input.referenceImages).toEqual([]);
      expect(input.consistency).toEqual([
        expect.objectContaining({
          consistencyKey: fixture.consistency[0]!.consistencyKey,
          visualPrompt: fixture.consistency[0]!.visualPrompt,
          referenceMediaAssetId: referenceAsset!.id,
        }),
      ]);
      return Promise.resolve({
        assetProvider: 'BAIDU_BOS',
        objectKey: `picture-books/bailian/${fixture.illustration.id}.png`,
        playbackUrl: `https://assets.example.test/picture-books/bailian/${fixture.illustration.id}.png`,
        mimeType: 'image/png',
        byteSize: 9,
        providerRequestId: 'test-bailian-request',
      });
    });

    await new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000).processOne();

    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(generate).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ status: 'READY', errorCode: null });
  });

  it('rejects non-HTTPS real BOS references before provider generation', async () => {
    const fixture = await queued('BAILIAN');
    const [referenceAsset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'BAIDU_BOS',
        objectKey: 'picture-books/bailian/reference.jpg',
        playbackUrl: 'http://assets.example.com/reference.jpg',
        mimeType: 'image/jpeg',
        status: 'READY',
      })
      .returning();
    await db
      .update(workPageIllustrations)
      .set({
        consistency: [{ ...fixture.consistency[0]!, referenceMediaAssetId: referenceAsset!.id }],
      })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const generate = vi.fn<ImageProvider['generate']>();

    await new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000).processOne();

    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(generate).not.toHaveBeenCalled();
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_UNAVAILABLE' });
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

  it('logs Bailian request timeout with its request stage', async () => {
    const fixture = await queued('BAILIAN');
    const errorLogger = vi.fn();
    const provider: ImageProvider = {
      name: 'BAILIAN',
      generate: () =>
        Promise.reject(
          new ImageProviderError('IMAGE_PROVIDER_TIMEOUT', { stage: 'BAILIAN_REQUEST' }),
        ),
    };
    await new ImageJobProcessor(db, provider, 5_000, { error: errorLogger }).processOne();
    expect(errorLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        illustrationId: fixture.illustration.id,
        stage: 'BAILIAN_REQUEST',
        errorCode: 'IMAGE_PROVIDER_TIMEOUT',
      }),
      expect.any(String),
    );
    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_TIMEOUT' });
  });

  it('logs temporary download timeout without exposing prompt or secret', async () => {
    await queued('BAILIAN');
    const errorLogger = vi.fn();
    const provider: ImageProvider = {
      name: 'BAILIAN',
      generate: () =>
        Promise.reject(
          new ImageProviderError('IMAGE_PROVIDER_TIMEOUT', {
            stage: 'TEMPORARY_IMAGE_DOWNLOAD',
            safeMessage: undefined,
          }),
        ),
    };
    await new ImageJobProcessor(db, provider, 5_000, { error: errorLogger }).processOne();
    const fields = (errorLogger.mock.calls as unknown[][])[0]?.[0];
    expect(fields).toMatchObject({
      stage: 'TEMPORARY_IMAGE_DOWNLOAD',
      errorCode: 'IMAGE_PROVIDER_TIMEOUT',
    });
    expect(JSON.stringify(fields)).not.toContain('fox in a forest');
    expect(JSON.stringify(fields)).not.toContain('secret');
  });

  it('logs READY writeback failures separately and leaves the revision failed', async () => {
    const fixture = await queued('BAILIAN');
    const errorLogger = vi.fn();
    const provider: ImageProvider = {
      name: 'BAILIAN',
      generate: () =>
        Promise.resolve({
          assetProvider: 'BAIDU_BOS',
          objectKey: `picture-books/bailian/${fixture.illustration.id}.png`,
          playbackUrl: 'https://assets.example.com/image.png',
          mimeType: 'image/png',
          byteSize: -1,
          providerRequestId: 'req-1',
        }),
    };
    await new ImageJobProcessor(db, provider, 5_000, { error: errorLogger }).processOne();
    expect(errorLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'DB_READY_WRITEBACK',
        errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
      }),
      expect.any(String),
    );
    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_UNAVAILABLE' });
    expect(saved!.mediaAssetId).toBeNull();
  });

  it('publishes a Bailian revision only with its permanent BOS media asset', async () => {
    const fixture = await queued('BAILIAN');
    const generate = vi.fn<ImageProvider['generate']>().mockResolvedValue({
      assetProvider: 'BAIDU_BOS',
      objectKey: `picture-books/bailian/${fixture.illustration.id}.png`,
      playbackUrl: `https://assets.example.com/picture-books/bailian/${fixture.illustration.id}.png`,
      mimeType: 'image/png',
      byteSize: 9,
      providerRequestId: 'req-1',
    });
    await new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000).processOne();

    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, saved!.mediaAssetId!));
    expect(saved).toMatchObject({ status: 'READY', errorCode: null });
    expect(asset).toMatchObject({ provider: 'BAIDU_BOS', status: 'READY', byteSize: 9 });
  });

  it('marks an orphaned image terminal once without publishing a stale asset', async () => {
    const fixture = await queued();
    await db
      .update(workPageIllustrations)
      .set({ status: 'RUNNING', updatedAt: new Date('2020-01-01') })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const timeouts = { imageMs: 5_000, videoMs: 5_000, compositionMs: 5_000 };
    expect((await recoverStaleMedia(db, timeouts)).images).toBe(1);
    expect((await recoverStaleMedia(db, timeouts)).images).toBe(0);
    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'IMAGE_WORKER_TIMEOUT' });
    expect(saved!.mediaAssetId).toBeNull();
  });
});
