import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  aiJobs,
  aiBudgetWindows,
  aiCostLedger,
  aiCostReservations,
  aiProjects,
  characterProfiles,
  characterReferenceImages,
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
import { createPrivateBosReferenceResolver } from '../src/private-bos-reference.js';
import {
  I111_PAID_RUN,
  I111_PROVIDER_SLOT_MARKER,
  consumeI111ProviderSlot,
  noteI111ProviderOutcome,
} from '../src/i111-paid-attempt-gate.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M10 image worker PostgreSQL integration', () => {
  const db = database!.db;

  async function reserveBudget(resourceId: string, consumerUserId: string, amountMinor = 100) {
    await db
      .insert(aiBudgetWindows)
      .values([
        {
          budgetKey: 'TEST_CUMULATIVE_500',
          scopeType: 'GLOBAL',
          consumerUserId: null,
          windowKey: 'TEST_TOTAL',
          limitMinor: 500,
          reservedMinor: amountMinor,
        },
        {
          budgetKey: 'TEST_CUMULATIVE_500',
          scopeType: 'CONSUMER',
          consumerUserId,
          windowKey: 'TEST_TOTAL',
          limitMinor: 500,
          reservedMinor: amountMinor,
        },
      ])
      .onConflictDoNothing();
    await db.insert(aiCostReservations).values({
      idempotencyKey: `worker-fixture:${resourceId}`,
      budgetKey: 'TEST_CUMULATIVE_500',
      windowKey: 'TEST_TOTAL',
      consumerUserId,
      resourceType: 'PICTURE_BOOK_IMAGE',
      resourceId,
      provider: 'BAILIAN',
      model: 'server-image-model',
      reservedMinor: amountMinor,
    });
  }

  async function queued(provider: 'MOCK' | 'BAILIAN' = 'MOCK', reserve = true) {
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
    if (provider === 'BAILIAN' && reserve) await reserveBudget(illustration!.id, user!.id);
    return { illustration: illustration!, consistency, userId: user!.id };
  }

  // Disposable integration DB only. Replicate the real #111 requirement:
  // TWO independently locked characters with selected private BOS PNG assets.
  async function queuedWithTwoLockedBosReferences() {
    const fixture = await queued('BAILIAN');
    const [page] = await db
      .select({ bookId: workPages.pictureBookId })
      .from(workPages)
      .where(eq(workPages.id, fixture.illustration.pageId));
    const [mimi] = await db
      .select()
      .from(characterProfiles)
      .where(eq(characterProfiles.pictureBookId, page!.bookId));
    if (!mimi) throw new Error('TEST_MIMI_MISSING');

    const [pip] = await db
      .insert(characterProfiles)
      .values({
        pictureBookId: page!.bookId,
        name: 'Pip',
        description: 'sky-blue bird child',
        visualPrompt: 'blue bird with green cap and yellow striped scarf',
        confirmed: true,
        locked: true,
        sortOrder: 1,
      })
      .returning();
    const bucket = 'xiaohai-i111-work-2ec3900280';
    const origin = `https://${bucket}.cd.bcebos.com`;
    const prefix = `picture-books/character-references/i111/${fixture.userId}/${page!.bookId}`;
    const keys = [mimi.id, pip!.id].map(
      (id, i) => `${prefix}/${id}/${String(i + 1).repeat(64)}.png`,
    );
    const references = await db
      .insert(mediaAssets)
      .values(
        keys.map((key) => ({
          provider: 'BAIDU_BOS' as const,
          objectKey: key,
          playbackUrl: `${origin}/${key}`,
          mimeType: 'image/png',
          status: 'READY' as const,
        })),
      )
      .returning();
    await db
      .update(characterProfiles)
      .set({
        name: 'Mimi',
        description: 'red panda child',
        visualPrompt: 'red panda with yellow knit scarf, blue overalls',
        confirmed: true,
        locked: true,
        referenceMediaAssetId: references[0]!.id,
      })
      .where(eq(characterProfiles.id, mimi.id));
    await db
      .update(characterProfiles)
      .set({ referenceMediaAssetId: references[1]!.id })
      .where(eq(characterProfiles.id, pip!.id));

    await db.insert(characterReferenceImages).values([
      {
        characterProfileId: mimi.id,
        revisionNumber: 1,
        status: 'READY',
        provider: 'IMPORTED',
        model: 'OWNER_SUPPLIED_PNG',
        mediaAssetId: references[0]!.id,
      },
      {
        characterProfileId: pip!.id,
        revisionNumber: 1,
        status: 'READY',
        provider: 'IMPORTED',
        model: 'OWNER_SUPPLIED_PNG',
        mediaAssetId: references[1]!.id,
      },
    ]);
    const consistency = [
      {
        consistencyKey: mimi.consistencyKey,
        visualPrompt: 'red panda with yellow knit scarf, blue overalls',
        referenceMediaAssetId: references[0]!.id,
      },
      {
        consistencyKey: pip!.consistencyKey,
        visualPrompt: 'blue bird with green cap and yellow striped scarf',
        referenceMediaAssetId: references[1]!.id,
      },
    ];
    await db
      .update(workPageIllustrations)
      .set({ consistency })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    return { ...fixture, references, keys, origin, bucket, consistency };
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
      mimeType: 'image/png',
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

  it('passes two signed private references before the Bailian call', async () => {
    const fixture = await queuedWithTwoLockedBosReferences();
    const signedKeys: string[] = [];
    const signer = {
      generatePresignedUrl: vi.fn((_bucket: string, key: string) => {
        signedKeys.push(key);
        return `https://cd.bcebos.com/${key}?authorization=synthetic-private-signature`;
      }),
    };
    const resolver = createPrivateBosReferenceResolver(
      {
        endpoint: 'https://cd.bcebos.com',
        publicOrigin: fixture.origin,
        bucket: fixture.bucket,
        accessKeyId: 'synthetic-ak',
        secretAccessKey: 'synthetic-sk',
      },
      signer,
    );
    const generate = vi.fn<ImageProvider['generate']>((input) => {
      expect(signedKeys).toEqual(fixture.keys);
      expect(input.referenceImages).toHaveLength(2);
      expect(input.referenceImages).toEqual(
        fixture.keys.map(
          (key) => `https://cd.bcebos.com/${key}?authorization=synthetic-private-signature`,
        ),
      );
      expect(input.referenceImages).not.toContain(fixture.references[0]!.playbackUrl);
      expect(input.referenceImages).not.toContain(fixture.references[1]!.playbackUrl);
      expect(input.consistency).toEqual(fixture.consistency);
      return Promise.resolve({
        assetProvider: 'BAIDU_BOS',
        objectKey: `picture-books/bailian/${fixture.illustration.id}.png`,
        playbackUrl: `https://assets.example.test/picture-books/bailian/${fixture.illustration.id}.png`,
        mimeType: 'image/png',
        byteSize: 9,
        providerRequestId: 'synthetic-request-id',
      });
    });
    const logger = { error: vi.fn() };

    await new ImageJobProcessor(
      db,
      { name: 'BAILIAN', generate },
      5_000,
      logger,
      resolver,
    ).processOne();

    expect(signer.generatePresignedUrl).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(saved).toMatchObject({ status: 'READY', errorCode: null });
  });

  for (const reason of ['missing', 'signing-failed', 'invalid-metadata'] as const) {
    it(`fails closed on ${reason} without a paid call or URL leakage`, async () => {
      const fixture = await queuedWithTwoLockedBosReferences();
      if (reason === 'missing') {
        await db
          .update(workPageIllustrations)
          .set({
            consistency: [
              fixture.consistency[0]!,
              { ...fixture.consistency[1]!, referenceMediaAssetId: crypto.randomUUID() },
            ],
          })
          .where(eq(workPageIllustrations.id, fixture.illustration.id));
      } else if (reason === 'invalid-metadata') {
        await db
          .update(mediaAssets)
          .set({ playbackUrl: 'https://untrusted.example.test/invalid.png' })
          .where(eq(mediaAssets.id, fixture.references[1]!.id));
      }
      const signature = 'synthetic-private-signature-do-not-log';
      const signer = {
        generatePresignedUrl: vi.fn((_bucket: string, key: string) =>
          reason === 'signing-failed' && key === fixture.keys[1]
            ? 'https://untrusted.example.test/invalid.png?authorization=' + signature
            : `https://cd.bcebos.com/${key}?authorization=${signature}`,
        ),
      };
      const resolver = createPrivateBosReferenceResolver(
        {
          endpoint: 'https://cd.bcebos.com',
          publicOrigin: fixture.origin,
          bucket: fixture.bucket,
          accessKeyId: 'synthetic-ak',
          secretAccessKey: 'synthetic-sk',
        },
        signer,
      );
      const generate = vi.fn<ImageProvider['generate']>();
      const logger = { error: vi.fn() };

      await new ImageJobProcessor(
        db,
        { name: 'BAILIAN', generate },
        5_000,
        logger,
        resolver,
      ).processOne();

      expect(generate).not.toHaveBeenCalled();
      const [saved] = await db
        .select()
        .from(workPageIllustrations)
        .where(eq(workPageIllustrations.id, fixture.illustration.id));
      expect(saved).toMatchObject({
        status: 'FAILED',
        errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
        mediaAssetId: null,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'VALIDATION',
          validationCode: 'INVALID_REFERENCE_ASSET',
        }),
        expect.any(String),
      );
      const safeLog = JSON.stringify(logger.error.mock.calls);
      expect(safeLog).not.toContain(signature);
      expect(safeLog).not.toContain('?authorization=');
      expect(safeLog).not.toContain(fixture.references[0]!.playbackUrl);
      const [reservation] = await db
        .select()
        .from(aiCostReservations)
        .where(eq(aiCostReservations.resourceId, fixture.illustration.id));
      expect(reservation).toMatchObject({
        status: 'SETTLED',
        uncertainty: 'NONE',
        actualMinor: 0,
      });
      const ledger = await db
        .select()
        .from(aiCostLedger)
        .where(eq(aiCostLedger.resourceId, fixture.illustration.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ outcome: 'FAILED', amountMinor: 0 });
    });
  }

  it('rejects a legacy BAILIAN task without a reservation before Provider.generate', async () => {
    const fixture = await queued('BAILIAN', false);
    const generate = vi.fn<ImageProvider['generate']>();
    const errorLogger = vi.fn();
    await new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000, {
      error: errorLogger,
    }).processOne();
    expect(generate).not.toHaveBeenCalled();
    expect(errorLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        illustrationId: fixture.illustration.id,
        stage: 'BUDGET_VALIDATION',
        validationCode: 'AI_BUDGET_RESERVATION_REQUIRED',
      }),
      expect.any(String),
    );
  });

  it('does not settle another consumer window when a pre-provider job fails', async () => {
    const consumerA = await queued('BAILIAN');
    const consumerB = await queued('BAILIAN');
    await db
      .update(aiBudgetWindows)
      .set({ reservedMinor: 200 })
      .where(eq(aiBudgetWindows.scopeType, 'GLOBAL'));

    const [invalidReference] = await db
      .insert(mediaAssets)
      .values({
        provider: 'BAIDU_BOS',
        objectKey: 'picture-books/bailian/invalid-ref-multi-user.png',
        playbackUrl: 'http://untrusted.example.test/invalid-ref.png',
        mimeType: 'image/png',
        status: 'READY',
      })
      .returning();
    await db
      .update(workPageIllustrations)
      .set({
        createdAt: new Date('2020-01-01T00:00:00Z'),
        consistency: [
          { ...consumerA.consistency[0]!, referenceMediaAssetId: invalidReference!.id },
        ],
      })
      .where(eq(workPageIllustrations.id, consumerA.illustration.id));

    const generate = vi.fn<ImageProvider['generate']>();
    await new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000).processOne();
    expect(generate).not.toHaveBeenCalled();

    const windows = await db.select().from(aiBudgetWindows);
    expect(windows.find((row) => row.scopeType === 'GLOBAL')).toMatchObject({
      reservedMinor: 100,
      actualMinor: 0,
    });
    expect(windows.find((row) => row.consumerUserId === consumerA.userId)).toMatchObject({
      reservedMinor: 0,
      actualMinor: 0,
    });
    expect(windows.find((row) => row.consumerUserId === consumerB.userId)).toMatchObject({
      reservedMinor: 100,
      actualMinor: 0,
    });
    const [otherReservation] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.resourceId, consumerB.illustration.id));
    expect(otherReservation).toMatchObject({
      status: 'RESERVED',
      uncertainty: 'NONE',
      reservedMinor: 100,
      actualMinor: null,
    });
    const [failedReservation] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.resourceId, consumerA.illustration.id));
    expect(failedReservation).toMatchObject({
      status: 'SETTLED',
      uncertainty: 'NONE',
      actualMinor: 0,
    });
    const ledgers = await db.select().from(aiCostLedger);
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]).toMatchObject({
      resourceId: consumerA.illustration.id,
      outcome: 'FAILED',
      amountMinor: 0,
    });
  });

  it('leaves the budget ledger untouched when an owned settlement window is missing', async () => {
    const fixture = await queued('BAILIAN');
    await db.delete(aiBudgetWindows).where(eq(aiBudgetWindows.consumerUserId, fixture.userId));
    const [invalidReference] = await db
      .insert(mediaAssets)
      .values({
        provider: 'BAIDU_BOS',
        objectKey: 'picture-books/bailian/invalid-ref-missing-budget.png',
        playbackUrl: 'http://untrusted.example.test/missing-budget.png',
        mimeType: 'image/png',
        status: 'READY',
      })
      .returning();
    await db
      .update(workPageIllustrations)
      .set({
        consistency: [{ ...fixture.consistency[0]!, referenceMediaAssetId: invalidReference!.id }],
      })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const generate = vi.fn<ImageProvider['generate']>();
    await expect(
      new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000).processOne(),
    ).rejects.toThrow('AI_BUDGET_WINDOW_INVALID');
    expect(generate).not.toHaveBeenCalled();
    expect(await db.select().from(aiCostLedger)).toHaveLength(0);
    const [reservation] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.resourceId, fixture.illustration.id));
    expect(reservation).toMatchObject({
      status: 'RESERVED',
      uncertainty: 'NONE',
      actualMinor: null,
    });
    const [globalWindow] = await db
      .select()
      .from(aiBudgetWindows)
      .where(eq(aiBudgetWindows.scopeType, 'GLOBAL'));
    expect(globalWindow).toMatchObject({ reservedMinor: 100, actualMinor: 0 });
  });

  it('never marks the whole book READY from MOCK page media', async () => {
    const fixture = await queued('MOCK');
    await new ImageJobProcessor(db, new MockImageProvider(), 5_000).processOne();

    const [illustration] = await db
      .select({ status: workPageIllustrations.status })
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    const [book] = await db
      .select({ status: pictureBooks.status })
      .from(pictureBooks)
      .innerJoin(workPages, eq(workPages.pictureBookId, pictureBooks.id))
      .where(eq(workPages.id, fixture.illustration.pageId));

    expect(illustration?.status).toBe('READY');
    expect(book?.status).toBe('PLANNED');
  });

  it('requires real BOS media on every page before marking the book READY', async () => {
    const fixture = await queued('BAILIAN');
    const [book] = await db
      .select({ id: pictureBooks.id, status: pictureBooks.status })
      .from(pictureBooks)
      .innerJoin(workPages, eq(workPages.pictureBookId, pictureBooks.id))
      .where(eq(workPages.id, fixture.illustration.pageId));
    const [cover] = await db
      .insert(workPages)
      .values({
        pictureBookId: book!.id,
        pageNumber: 0,
        pageKind: 'COVER',
        sceneDescription: 'forest cover',
        illustrationPrompt: 'storybook forest cover',
      })
      .returning();
    const [coverIllustration] = await db
      .insert(workPageIllustrations)
      .values({
        pageId: cover!.id,
        revisionNumber: 1,
        prompt: 'storybook forest cover',
        provider: 'BAILIAN',
        model: 'server-image-model',
        consistency: fixture.consistency,
      })
      .returning();
    await reserveBudget(coverIllustration!.id, fixture.userId);
    const generate = vi.fn<ImageProvider['generate']>((input) =>
      Promise.resolve({
        assetProvider: 'BAIDU_BOS',
        objectKey: `picture-books/bailian/${input.generationKey}.png`,
        playbackUrl: `https://assets.example.test/picture-books/bailian/${input.generationKey}.png`,
        mimeType: 'image/png',
        byteSize: 9,
        providerRequestId: 'test-bailian-request',
      }),
    );
    const processor = new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000);
    await processor.processOne();

    const [partiallyReady] = await db
      .select({ status: pictureBooks.status })
      .from(pictureBooks)
      .where(eq(pictureBooks.id, book!.id));
    expect(partiallyReady?.status).toBe('PLANNED');

    await processor.processOne();
    const [completed] = await db
      .select({ status: pictureBooks.status })
      .from(pictureBooks)
      .where(eq(pictureBooks.id, book!.id));
    expect(completed?.status).toBe('READY');
    expect(generate).toHaveBeenCalledTimes(2);
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
    const errorLogger = vi.fn();

    await new ImageJobProcessor(db, { name: 'BAILIAN', generate }, 5_000, {
      error: errorLogger,
    }).processOne();

    const [saved] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    expect(generate).not.toHaveBeenCalled();
    expect(saved).toMatchObject({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_UNAVAILABLE' });
    expect(errorLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'VALIDATION',
        validationCode: 'INVALID_REFERENCE_ASSET',
      }),
      expect.any(String),
    );
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
    expect(generate).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ status: 'READY', errorCode: null, mediaAssetId: asset!.id });
    expect(asset).toMatchObject({
      provider: 'BAIDU_BOS',
      status: 'READY',
      byteSize: 9,
      playbackUrl: `https://assets.example.com/picture-books/bailian/${fixture.illustration.id}.png`,
    });
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
  it('consumes one durable #111 slot under concurrent claim and never retries or opens fourth', async () => {
    const fixture = await queued('BAILIAN', false);
    const [firstPage] = await db
      .select()
      .from(workPages)
      .where(eq(workPages.id, fixture.illustration.pageId));
    const [page2] = await db
      .insert(workPages)
      .values({
        pictureBookId: firstPage!.pictureBookId,
        pageNumber: 2,
        storyText: 'synthetic second scene',
        sceneDescription: 'forest map',
        illustrationPrompt: 'Mimi and Pip with map',
      })
      .returning();
    const scope = {
      ...I111_PAID_RUN,
      bookId: firstPage!.pictureBookId,
      ownerId: fixture.userId,
      page1Id: firstPage!.id,
      page2Id: page2!.id,
      budgetKey: 'TEST_I111_' + crypto.randomUUID(),
      windowKey: 'ONLY_ISOLATED_TEST',
    };

    const prepare = async (id: string) => {
      await db.insert(aiCostReservations).values({
        idempotencyKey: 'i111:' + id,
        budgetKey: scope.budgetKey,
        windowKey: scope.windowKey,
        consumerUserId: scope.ownerId,
        resourceType: 'PICTURE_BOOK_IMAGE',
        resourceId: id,
        provider: 'BAILIAN',
        model: scope.model,
        reservedMinor: scope.reservationMinor,
      });
      await db
        .update(aiBudgetWindows)
        .set({
          reservedMinor: scope.reservationMinor,
        })
        .where(eq(aiBudgetWindows.budgetKey, scope.budgetKey));
    };
    await db.insert(aiBudgetWindows).values([
      {
        budgetKey: scope.budgetKey,
        windowKey: scope.windowKey,
        scopeType: 'GLOBAL',
        limitMinor: 200,
        consumerUserId: null,
      },
      {
        budgetKey: scope.budgetKey,
        windowKey: scope.windowKey,
        scopeType: 'CONSUMER',
        limitMinor: 200,
        consumerUserId: fixture.userId,
      },
    ]);

    await db
      .update(workPageIllustrations)
      .set({ model: scope.model, status: 'RUNNING' })
      .where(eq(workPageIllustrations.id, fixture.illustration.id));
    await prepare(fixture.illustration.id);

    const [a, b] = await Promise.allSettled([
      consumeI111ProviderSlot(db, fixture.illustration.id, scope),
      consumeI111ProviderSlot(db, fixture.illustration.id, scope),
    ]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((a.status === 'fulfilled' ? a.value : b.status === 'fulfilled' ? b.value : null)).toBe(1);

    const [firstLedger] = await db.select().from(aiCostLedger);
    expect(firstLedger).toMatchObject({
      resourceId: fixture.illustration.id,
      outcome: 'AT_RISK',
      failureCode: I111_PROVIDER_SLOT_MARKER,
      amountMinor: 25,
    });
    await expect(consumeI111ProviderSlot(db, fixture.illustration.id, scope)).rejects.toThrow(
      'I111_PAID_ATTEMPT_STOP',
    );
    await noteI111ProviderOutcome(db, fixture.illustration.id, 'synthetic-request-1', undefined, scope);
    const [atRisk] = await db
      .select()
      .from(aiCostReservations)
      .where(eq(aiCostReservations.resourceId, fixture.illustration.id));
    expect(atRisk).toMatchObject({
      status: 'RESERVED',
      uncertainty: 'AT_RISK',
      providerRequestId: 'synthetic-request-1',
    });

    const settle = async (id: string, requestId: string) => {
      await db
        .update(aiCostReservations)
        .set({
          status: 'SETTLED',
          uncertainty: 'NONE',
          providerRequestId: requestId,
          actualMinor: 22,
        })
        .where(eq(aiCostReservations.resourceId, id));
      await db
        .update(aiCostLedger)
        .set({ outcome: 'SUCCEEDED', providerRequestId: requestId, amountMinor: 22 })
        .where(eq(aiCostLedger.resourceId, id));
      await db
        .update(aiBudgetWindows)
        .set({
          reservedMinor: 0,
          actualMinor: 22,
        })
        .where(eq(aiBudgetWindows.budgetKey, scope.budgetKey));
    };
    await settle(fixture.illustration.id, 'synthetic-request-1');

    for (const [revision, ordinal] of [
      [1, 2],
      [2, 3],
    ] as const) {
      const [illustration] = await db
        .insert(workPageIllustrations)
        .values({
          pageId: page2!.id,
          revisionNumber: revision,
          prompt: 'synthetic map',
          provider: 'BAILIAN',
          model: scope.model,
          consistency: fixture.consistency,
          status: 'RUNNING',
        })
        .returning();
      await prepare(illustration!.id);
      expect(await consumeI111ProviderSlot(db, illustration!.id, scope)).toBe(ordinal);
      await noteI111ProviderOutcome(
        db,
        illustration!.id,
        'synthetic-request-' + ordinal,
        undefined,
        scope,
      );
      await settle(illustration!.id, 'synthetic-request-' + ordinal);
    }

    const [fourth] = await db
      .insert(workPageIllustrations)
      .values({
        pageId: page2!.id,
        revisionNumber: 3,
        prompt: 'forbidden fourth',
        provider: 'BAILIAN',
        model: scope.model,
        consistency: fixture.consistency,
        status: 'RUNNING',
      })
      .returning();
    await prepare(fourth!.id);
    await expect(consumeI111ProviderSlot(db, fourth!.id, scope)).rejects.toThrow(
      'I111_PAID_ATTEMPT_STOP',
    );
    const ledgerRows = await db.select().from(aiCostLedger);
    expect(ledgerRows).toHaveLength(3);
    expect(ledgerRows.every((row) => row.failureCode === I111_PROVIDER_SLOT_MARKER)).toBe(true);
    await db.delete(aiBudgetWindows).where(eq(aiBudgetWindows.budgetKey, scope.budgetKey));
  });

});
