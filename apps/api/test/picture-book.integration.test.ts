import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aiJobs,
  aiProjects,
  characterProfiles,
  characterReferenceImages,
  consumerUsers,
  createDatabase,
  mediaAssets,
  pictureBooks,
  workPageIllustrations,
  workPages,
  workVersions,
  works,
} from '@xiaohai/db';
import { ConsumerSessionService } from '../src/auth/session.js';
import { registerPictureBookRoutes } from '../src/picture-book/picture-book-routes.js';
import {
  PictureBookService,
  type PictureBookAiConfig,
} from '../src/picture-book/picture-book-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

const sessionSecret = 'm10-picture-book-consumer-session-secret-at-least-32-characters';

suite('M10 Picture Book PostgreSQL integration and ownership', () => {
  const db = database!.db;
  const sessions = new ConsumerSessionService(sessionSecret, 300);

  let notifications: string[] = [];

  const config: PictureBookAiConfig = {
    enabled: true,
    provider: 'MOCK',
    model: 'server-controlled-picture-book-model',
    maxAttempts: 2,
    timeoutMs: 5_000,
    imageEnabled: true,
    imageProvider: 'MOCK',
    imageModel: 'server-controlled-image-model',
  };

  const resetDatabase = async () => {
    await database!.pool.query(`
      TRUNCATE TABLE
        work_page_illustrations,
        character_reference_images,
        work_pages,
        character_profiles,
        picture_books,
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

  const imageQueue = queue;

  function service(overrides: Partial<PictureBookAiConfig> = {}) {
    return new PictureBookService(db, queue, imageQueue, { ...config, ...overrides });
  }

  async function createApp(pictureBook = service()) {
    const app = Fastify({ logger: false });

    registerPictureBookRoutes(app, {
      pictureBook,
      consumerSessions: sessions,
    });

    return app;
  }

  async function createUser() {
    const [user] = await db.insert(consumerUsers).values({}).returning({ id: consumerUsers.id });

    return user!.id;
  }

  function token(userId: string) {
    return sessions.issue(userId).token;
  }

  async function createStorySource(userId: string) {
    const [project] = await db
      .insert(aiProjects)
      .values({
        projectType: 'STORY',
        title: '森林里的小灯塔',
        createdByConsumerUserId: userId,
      })
      .returning();

    const [work] = await db
      .insert(works)
      .values({
        consumerUserId: userId,
        aiProjectId: project!.id,
        workType: 'STORY',
        title: '森林里的小灯塔',
        idea: '小狐狸帮助迷路的小鸟回家',
        ageRange: '6-8',
        theme: '勇气与互助',
        style: '温暖童话',
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
        input: {
          prompt: 'outline',
          context: {
            kind: 'STORY',
            workId: work!.id,
            operation: 'OUTLINE',
            sourceVersionId: null,
          },
        },
        result: {
          text: '故事大纲',
          assetReferences: [],
        },
        maxAttempts: 1,
        timeoutMs: 5_000,
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
        sourceVersionId: null,
        sourceAiJobId: outlineJob!.id,
        content: '故事大纲',
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
        input: {
          prompt: 'body',
          context: {
            kind: 'STORY',
            workId: work!.id,
            operation: 'BODY',
            sourceVersionId: outline!.id,
          },
        },
        result: {
          text: '清晨，小狐狸在森林里遇见一只迷路的小鸟，并帮助它回到了家。',
          assetReferences: [],
        },
        maxAttempts: 1,
        timeoutMs: 5_000,
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
        content: JSON.stringify({
          title: '森林里的小灯塔',
          outline: '小狐狸帮助迷路的小鸟回家。',
          characters: [
            {
              name: '小狐狸',
              description: '勇敢温柔的朋友',
              visualDescription: '橙色狐狸，绿色围巾，圆眼睛',
            },
            {
              name: '小鸟',
              description: '迷路的小鸟',
              visualDescription: '蓝色小鸟，黄色肚子，小红书包',
            },
          ],
          pages: Array.from({ length: 10 }, (_, index) => ({
            pageNumber: index + 1,
            scene: '森林',
            text: '小狐狸帮助小鸟。',
          })),
        }),
      })
      .returning();

    return {
      work: work!,
      outline: outline!,
      body: body!,
    };
  }

  async function createBook(pictureBook: PictureBookService, userId: string) {
    const source = await createStorySource(userId);

    const book = await pictureBook.createPictureBook(userId, {
      storyWorkId: source.work.id,
      sourceStoryVersionId: source.body.id,
      title: '森林里的小灯塔绘本',
      layoutPreset: 'AUTO',
    });

    return { source, book };
  }

  async function prepareReadyCharacterReferences(
    pictureBook: PictureBookService,
    userId: string,
    pictureBookId: string,
  ) {
    const detail = await pictureBook.getPictureBook(userId, pictureBookId);
    for (const character of detail.characters) {
      const [asset] = await db
        .insert(mediaAssets)
        .values({
          provider: 'BAIDU_BOS',
          objectKey: `picture-book-test/reference/${character.characterId}.png`,
          playbackUrl: `https://bos.example.test/reference/${character.characterId}.png`,
          mimeType: 'image/png',
          byteSize: 1,
          status: 'READY',
        })
        .returning();
      const [revision] = await db
        .insert(characterReferenceImages)
        .values({
          characterProfileId: character.characterId,
          revisionNumber: 1,
          status: 'READY',
          provider: 'MOCK',
          model: 'fixture-reference-model',
          mediaAssetId: asset!.id,
          providerRequestId: `fixture-${character.characterId}`,
        })
        .returning();
      await pictureBook.selectCharacterReference(
        userId,
        pictureBookId,
        character.characterId,
        revision!.id,
      );
    }
  }

  async function succeed(jobId: string, text: string) {
    await db
      .update(aiJobs)
      .set({
        status: 'SUCCEEDED',
        result: {
          text,
          assetReferences: [],
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId));
  }

  async function applyCharacters(
    pictureBook: PictureBookService,
    userId: string,
    pictureBookId: string,
  ) {
    await prepareReadyCharacterReferences(pictureBook, userId, pictureBookId);
    const detail = await pictureBook.confirmCharacters(userId, pictureBookId);
    return { accepted: null, detail };
  }

  async function applyStoryboard(
    pictureBook: PictureBookService,
    userId: string,
    pictureBookId: string,
  ) {
    await applyCharacters(pictureBook, userId, pictureBookId);
    const accepted = await pictureBook.generate(userId, pictureBookId, { operation: 'STORYBOARD' });
    await succeed(
      accepted.jobId,
      JSON.stringify({
        cover: {
          characterKeys: ['小狐狸', '小鸟'],
          sceneDescription: '森林封面',
          illustrationPrompt: 'orange fox and blue bird in a forest',
        },
        pages: [
          {
            characterKeys: ['小狐狸'],
            storyText: '小狐狸遇见了小鸟。',
            sceneDescription: '森林小路',
            illustrationPrompt: 'orange fox meets a small blue bird',
          },
        ],
      }),
    );
    return pictureBook.applyJob(userId, pictureBookId, accepted.jobId);
  }

  it('requires Consumer Session, isolates ownership and only accepts owned BODY sources', async () => {
    const pictureBook = service();
    const app = await createApp(pictureBook);

    try {
      const alice = await createUser();
      const bob = await createUser();
      const aliceSource = await createStorySource(alice);

      let response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/picture-books',
        payload: {
          storyWorkId: aliceSource.work.id,
          sourceStoryVersionId: aliceSource.body.id,
        },
      });

      expect(response.statusCode).toBe(401);

      response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/picture-books',
        headers: {
          authorization: `Bearer ${token(bob)}`,
        },
        payload: {
          storyWorkId: aliceSource.work.id,
          sourceStoryVersionId: aliceSource.body.id,
        },
      });

      expect(response.statusCode).toBe(409);

      response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/picture-books',
        headers: {
          authorization: `Bearer ${token(alice)}`,
        },
        payload: {
          storyWorkId: aliceSource.work.id,
          sourceStoryVersionId: aliceSource.outline.id,
        },
      });

      expect(response.statusCode).toBe(409);

      response = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/picture-books',
        headers: {
          authorization: `Bearer ${token(alice)}`,
        },
        payload: {
          storyWorkId: aliceSource.work.id,
          sourceStoryVersionId: aliceSource.body.id,
        },
      });

      expect(response.statusCode).toBe(201);

      const book = response.json<{ id: string }>();

      const bobDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/picture-books/${book.id}`,
        headers: {
          authorization: `Bearer ${token(bob)}`,
        },
      });

      expect(bobDetail.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('keeps provider and model server-controlled and queues opaque job ids', async () => {
    const pictureBook = service();
    const app = await createApp(pictureBook);

    try {
      const alice = await createUser();
      const { book } = await createBook(pictureBook, alice);

      let response = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/generate`,
        headers: {
          authorization: `Bearer ${token(alice)}`,
        },
        payload: {
          operation: 'CHARACTERS',
          provider: 'DEEPSEEK',
          model: 'client-must-not-control-this',
        },
      });

      expect(response.statusCode).toBe(400);

      response = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/generate`,
        headers: {
          authorization: `Bearer ${token(alice)}`,
        },
        payload: {
          operation: 'CHARACTERS',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(notifications).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('enforces CHARACTERS -> STORYBOARD order and preserves character consistency references', async () => {
    const pictureBook = service();
    const app = await createApp(pictureBook);

    try {
      const alice = await createUser();
      const { book } = await createBook(pictureBook, alice);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/generate`,
        headers: {
          authorization: `Bearer ${token(alice)}`,
        },
        payload: {
          operation: 'STORYBOARD',
        },
      });

      expect(response.statusCode).toBe(409);

      const charactersResult = await applyCharacters(pictureBook, alice, book.id);

      expect(charactersResult.detail.characters).toHaveLength(2);

      const [fox, bird] = charactersResult.detail.characters;

      expect(fox!.consistencyKey).not.toBe(bird!.consistencyKey);

      const storyboard = await pictureBook.generate(alice, book.id, { operation: 'STORYBOARD' });

      const [storyboardJob] = await db.select().from(aiJobs).where(eq(aiJobs.id, storyboard.jobId));

      const prompt = String(storyboardJob!.input.prompt);

      expect(prompt).toContain(fox!.consistencyKey);
      expect(prompt).toContain(fox!.visualPrompt);
      expect(prompt).toContain(bird!.consistencyKey);
      expect(prompt).toContain(bird!.visualPrompt);

      await succeed(
        storyboard.jobId,
        JSON.stringify({
          cover: {
            characterKeys: ['小狐狸', '小鸟'],
            sceneDescription: '晨光森林里的小狐狸与小鸟',
            illustrationPrompt: 'storybook cover, orange fox with green scarf and small blue bird',
          },
          pages: [
            {
              characterKeys: ['小狐狸'],
              storyText: '清晨，小狐狸沿着森林小路出发。',
              sceneDescription: '森林入口，晨光穿过树叶。',
              illustrationPrompt: 'orange fox with green scarf walking on a forest path',
            },
            {
              characterKeys: ['小狐狸', '小鸟'],
              storyText: '它遇见了迷路的小鸟。',
              sceneDescription: '小狐狸蹲下来安慰小鸟。',
              illustrationPrompt:
                'orange fox with green scarf beside small blue bird with red satchel',
            },
          ],
        }),
      );

      const detail = await pictureBook.applyJob(alice, book.id, storyboard.jobId);

      expect(detail.pictureBook.status).toBe('PLANNED');

      expect(
        detail.pages.map((page) => ({
          number: page.pageNumber,
          kind: page.pageKind,
        })),
      ).toEqual([
        { number: 0, kind: 'COVER' },
        { number: 1, kind: 'CONTENT' },
        { number: 2, kind: 'CONTENT' },
      ]);

      expect(detail.pages.every((page) => page.sourceAiJobId === storyboard.jobId)).toBe(true);

      const secondApply = await pictureBook.applyJob(alice, book.id, storyboard.jobId);

      expect(secondApply.pages).toHaveLength(3);

      const rows = await db.select().from(workPages).where(eq(workPages.pictureBookId, book.id));

      expect(rows).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('initializes Character Bible from Story characters with stable IDs', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { source, book } = await createBook(pictureBook, alice);
    const detail = await pictureBook.getPictureBook(alice, book.id);

    expect(detail.characters).toHaveLength(2);
    expect(new Set(detail.characters.map((character) => character.characterId)).size).toBe(2);
    expect(detail.characters.every((character) => !character.confirmed && !character.locked)).toBe(
      true,
    );
    expect(
      (await db.select().from(workVersions).where(eq(workVersions.id, source.body.id)))[0]!.content,
    ).toContain('绿色围巾');
  });

  it('deduplicates active reference jobs', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);
    const character = (await pictureBook.getPictureBook(alice, book.id)).characters[0]!;

    const [first, second] = await Promise.all([
      pictureBook.generateCharacterReference(alice, book.id, character.characterId),
      pictureBook.generateCharacterReference(alice, book.id, character.characterId),
    ]);

    expect([first.status, second.status]).toEqual(['QUEUED', 'QUEUED']);
    expect(first.referenceRevisionId).toBe(second.referenceRevisionId);
    expect(first.revisionNumber).toBe(1);
    expect(second.revisionNumber).toBe(1);

    let rows = await db
      .select()
      .from(characterReferenceImages)
      .where(eq(characterReferenceImages.characterProfileId, character.characterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      revisionNumber: 1,
      provider: 'MOCK',
      model: 'server-controlled-image-model',
    });

    await db
      .update(characterReferenceImages)
      .set({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_UNAVAILABLE', updatedAt: new Date() })
      .where(eq(characterReferenceImages.id, first.referenceRevisionId));

    const retry = await pictureBook.generateCharacterReference(
      alice,
      book.id,
      character.characterId,
    );
    expect(retry.revisionNumber).toBe(2);
    expect(retry.referenceRevisionId).not.toBe(first.referenceRevisionId);
    rows = await db
      .select()
      .from(characterReferenceImages)
      .where(eq(characterReferenceImages.characterProfileId, character.characterId));
    expect(rows.map((row) => row.revisionNumber).sort()).toEqual([1, 2]);
  });

  it('rejects selecting a different reference while locked and permits it after reopen', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);
    const [character] = (await pictureBook.getPictureBook(alice, book.id)).characters;
    const [firstAsset, secondAsset] = await db
      .insert(mediaAssets)
      .values([
        {
          provider: 'BAIDU_BOS',
          objectKey: `picture-book-test/reference/${character!.characterId}-1.png`,
          playbackUrl: 'https://bos.example.test/reference/one.png',
          mimeType: 'image/png',
          byteSize: 1,
          status: 'READY',
        },
        {
          provider: 'BAIDU_BOS',
          objectKey: `picture-book-test/reference/${character!.characterId}-2.png`,
          playbackUrl: 'https://bos.example.test/reference/two.png',
          mimeType: 'image/png',
          byteSize: 1,
          status: 'READY',
        },
      ])
      .returning();
    const [firstRevision, secondRevision] = await db
      .insert(characterReferenceImages)
      .values([
        {
          characterProfileId: character!.characterId,
          revisionNumber: 1,
          status: 'READY',
          provider: 'MOCK',
          model: 'server-controlled-image-model',
          mediaAssetId: firstAsset!.id,
          providerRequestId: 'fixture-reference-one',
        },
        {
          characterProfileId: character!.characterId,
          revisionNumber: 2,
          status: 'READY',
          provider: 'MOCK',
          model: 'server-controlled-image-model',
          mediaAssetId: secondAsset!.id,
          providerRequestId: 'fixture-reference-two',
        },
      ])
      .returning();

    await pictureBook.selectCharacterReference(
      alice,
      book.id,
      character!.characterId,
      firstRevision!.id,
    );
    const otherCharacter = (await pictureBook.getPictureBook(alice, book.id)).characters.find(
      (row) => row.characterId !== character!.characterId,
    )!;
    const [otherAsset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'BAIDU_BOS',
        objectKey: `picture-book-test/reference/${otherCharacter.characterId}.png`,
        playbackUrl: 'https://bos.example.test/reference/other.png',
        mimeType: 'image/png',
        byteSize: 1,
        status: 'READY',
      })
      .returning();
    await db.insert(characterReferenceImages).values({
      characterProfileId: otherCharacter.characterId,
      revisionNumber: 1,
      status: 'READY',
      provider: 'MOCK',
      model: 'server-controlled-image-model',
      mediaAssetId: otherAsset!.id,
      providerRequestId: 'fixture-reference-other',
    });
    await pictureBook.selectCharacterReference(
      alice,
      book.id,
      otherCharacter.characterId,
      (
        await db
          .select({ id: characterReferenceImages.id })
          .from(characterReferenceImages)
          .where(eq(characterReferenceImages.characterProfileId, otherCharacter.characterId))
      )[0]!.id,
    );
    await pictureBook.confirmCharacters(alice, book.id);
    const lockedBefore = (await pictureBook.getPictureBook(alice, book.id)).characters.find(
      (row) => row.characterId === character!.characterId,
    )!;
    await expect(
      pictureBook.selectCharacterReference(
        alice,
        book.id,
        character!.characterId,
        secondRevision!.id,
      ),
    ).rejects.toMatchObject({ code: 'CHARACTER_LOCKED' });
    const lockedAfter = (await pictureBook.getPictureBook(alice, book.id)).characters.find(
      (row) => row.characterId === character!.characterId,
    )!;
    expect(lockedAfter).toMatchObject({
      referenceMediaAssetId: lockedBefore.referenceMediaAssetId,
      confirmed: true,
      locked: true,
    });

    await pictureBook.reopenCharacters(alice, book.id);
    await pictureBook.selectCharacterReference(
      alice,
      book.id,
      character!.characterId,
      secondRevision!.id,
    );
    const selected = (await pictureBook.getPictureBook(alice, book.id)).characters.find(
      (row) => row.characterId === character!.characterId,
    )!;
    expect(selected).toMatchObject({
      referenceMediaAssetId: secondAsset!.id,
      confirmed: false,
      locked: false,
    });
    await pictureBook.confirmCharacters(alice, book.id);
    expect(
      (await pictureBook.getPictureBook(alice, book.id)).characters.every(
        (row) => row.confirmed && row.locked,
      ),
    ).toBe(true);
  });

  it('supports Character Bible edit, confirm, reopen, ownership, and validation through HTTP', async () => {
    const pictureBook = service();
    const app = await createApp(pictureBook);

    try {
      const alice = await createUser();
      const bob = await createUser();
      const { source, book } = await createBook(pictureBook, alice);
      const initialSourceContent = (
        await db.select().from(workVersions).where(eq(workVersions.id, source.body.id))
      )[0]!.content;
      const initial = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/picture-books/${book.id}`,
        headers: { authorization: `Bearer ${token(alice)}` },
      });
      const initialCharacter = initial.json<{ characters: Array<{ characterId: string }> }>()
        .characters[0]!;

      const edited = await app.inject({
        method: 'PATCH',
        url: `/api/v1/ai/picture-books/${book.id}/characters/${initialCharacter.characterId}`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {
          name: '改名小狐狸',
          description: '编辑后的勇敢朋友',
          canonicalVisualPrompt: 'orange fox with a green scarf and warm storybook light',
        },
      });
      expect(edited.statusCode).toBe(200);

      const reloaded = await app.inject({
        method: 'GET',
        url: `/api/v1/ai/picture-books/${book.id}`,
        headers: { authorization: `Bearer ${token(alice)}` },
      });
      expect(reloaded.statusCode).toBe(200);
      const reloadedBody = reloaded.json<{ characters: Array<Record<string, unknown>> }>();
      expect(reloadedBody.characters[0]).toMatchObject({
        characterId: initialCharacter.characterId,
        name: '改名小狐狸',
        description: '编辑后的勇敢朋友',
        canonicalVisualPrompt: 'orange fox with a green scarf and warm storybook light',
        confirmed: false,
        locked: false,
      });

      for (const payload of [
        { name: '', description: 'valid', canonicalVisualPrompt: 'valid' },
        { name: 'valid', description: '', canonicalVisualPrompt: 'valid' },
        { name: 'valid', description: 'valid', canonicalVisualPrompt: '' },
        { name: '   ', description: 'valid', canonicalVisualPrompt: 'valid' },
        { name: 'valid', description: '   ', canonicalVisualPrompt: 'valid' },
        { name: 'valid', description: 'valid', canonicalVisualPrompt: '   ' },
      ]) {
        const invalid = await app.inject({
          method: 'PATCH',
          url: `/api/v1/ai/picture-books/${book.id}/characters/${initialCharacter.characterId}`,
          headers: { authorization: `Bearer ${token(alice)}` },
          payload,
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json<{ error: { code: string } }>().error.code).toBe('INVALID_REQUEST');
      }

      await prepareReadyCharacterReferences(pictureBook, alice, book.id);
      const confirmed = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/characters/confirm`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {},
      });
      expect(confirmed.statusCode).toBe(200);
      const confirmedBody = confirmed.json<{
        characters: Array<{ confirmed: boolean; locked: boolean }>;
      }>();
      expect(
        confirmedBody.characters.every((character) => character.confirmed && character.locked),
      ).toBe(true);

      const lockedUpdate = await app.inject({
        method: 'PATCH',
        url: `/api/v1/ai/picture-books/${book.id}/characters/${initialCharacter.characterId}`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {
          name: '不应保存',
          description: '不应保存',
          canonicalVisualPrompt: '不应保存',
        },
      });
      expect(lockedUpdate.statusCode).toBe(409);
      expect(lockedUpdate.json<{ error: { code: string } }>().error.code).toBe('CHARACTER_LOCKED');

      for (const path of ['confirm', 'reopen']) {
        const otherUser = await app.inject({
          method: 'POST',
          url: `/api/v1/ai/picture-books/${book.id}/characters/${path}`,
          headers: { authorization: `Bearer ${token(bob)}` },
          payload: {},
        });
        expect(otherUser.statusCode).toBe(404);
        expect(otherUser.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
      }
      const otherEdit = await app.inject({
        method: 'PATCH',
        url: `/api/v1/ai/picture-books/${book.id}/characters/${initialCharacter.characterId}`,
        headers: { authorization: `Bearer ${token(bob)}` },
        payload: {
          name: '越权',
          description: '越权',
          canonicalVisualPrompt: '越权',
        },
      });
      expect(otherEdit.statusCode).toBe(404);
      expect(otherEdit.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');

      const reopened = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/characters/reopen`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {},
      });
      expect(reopened.statusCode).toBe(200);
      const reopenedBody = reopened.json<{
        characters: Array<{ confirmed: boolean; locked: boolean }>;
      }>();
      expect(
        reopenedBody.characters.every((character) => !character.confirmed && !character.locked),
      ).toBe(true);

      const editedAgain = await app.inject({
        method: 'PATCH',
        url: `/api/v1/ai/picture-books/${book.id}/characters/${initialCharacter.characterId}`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: {
          name: '再次编辑的小狐狸',
          description: '重新编辑后的描述',
          canonicalVisualPrompt: 'orange fox, green scarf, revised canonical prompt',
        },
      });
      expect(editedAgain.statusCode).toBe(200);

      const finalSourceContent = (
        await db.select().from(workVersions).where(eq(workVersions.id, source.body.id))
      )[0]!.content;
      expect(finalSourceContent).toBe(initialSourceContent);
      expect(
        (
          await db
            .select()
            .from(characterProfiles)
            .where(eq(characterProfiles.id, initialCharacter.characterId))
        )[0],
      ).toMatchObject({ name: '再次编辑的小狐狸', confirmed: false, locked: false });
    } finally {
      await app.close();
    }
  });

  it('rejects invalid structured AI output without persisting partial storyboard data', async () => {
    const pictureBook = service();

    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);

    await applyCharacters(pictureBook, alice, book.id);

    const storyboard = await pictureBook.generate(alice, book.id, { operation: 'STORYBOARD' });

    await succeed(
      storyboard.jobId,
      JSON.stringify({
        cover: {
          characterKeys: ['小狐狸', '小鸟'],
          sceneDescription: '有效封面',
          illustrationPrompt: 'valid cover prompt',
        },
        pages: [
          {
            characterKeys: ['小狐狸', '小鸟'],
            storyText: '第一页有效。',
            sceneDescription: '第一页场景',
            illustrationPrompt: 'page one',
          },
          {
            sceneDescription: '第二页缺少 storyText',
            illustrationPrompt: 'page two',
          },
        ],
      }),
    );

    await expect(pictureBook.applyJob(alice, book.id, storyboard.jobId)).rejects.toMatchObject({
      code: 'INVALID_JOB_OUTPUT',
    });

    const pages = await db.select().from(workPages).where(eq(workPages.pictureBookId, book.id));

    expect(pages).toHaveLength(0);

    const [bookRow] = await db.select().from(pictureBooks).where(eq(pictureBooks.id, book.id));

    expect(bookRow!.status).toBe('DRAFT');
  });

  it('fails closed while Picture Book AI is disabled', async () => {
    const pictureBook = service({ enabled: false });

    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);

    await expect(
      pictureBook.generate(alice, book.id, { operation: 'CHARACTERS' }),
    ).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });

    const jobs = await db
      .select()
      .from(aiJobs)
      .where(
        eq(
          aiJobs.projectId,
          (
            await db
              .select({ aiProjectId: pictureBooks.aiProjectId })
              .from(pictureBooks)
              .where(eq(pictureBooks.id, book.id))
          )[0]!.aiProjectId,
        ),
      );

    expect(jobs).toHaveLength(0);
  });

  it('regenerates legacy failed illustrations without reference images', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);
    const detail = await applyStoryboard(pictureBook, alice, book.id);
    const [page, newPage] = detail.pages;

    await db
      .update(characterProfiles)
      .set({ referenceMediaAssetId: null })
      .where(eq(characterProfiles.pictureBookId, book.id));

    await expect(pictureBook.generateIllustration(alice, book.id, newPage!.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });

    const [old] = await db
      .insert(workPageIllustrations)
      .values({
        pageId: page!.id,
        revisionNumber: 1,
        prompt: 'legacy illustration prompt',
        provider: 'MOCK',
        model: 'legacy-model',
        consistency: [],
        status: 'FAILED',
        errorCode: 'IMAGE_PROVIDER_TIMEOUT',
      })
      .returning();

    const retry = await pictureBook.generateIllustration(alice, book.id, page!.id);
    expect(retry.revisionNumber).toBe(2);
    expect(retry.illustrationId).not.toBe(old!.id);

    const [stored] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, retry.illustrationId));
    expect(stored!.consistency.every((item) => item.referenceMediaAssetId === null)).toBe(true);
  });

  it('deduplicates active illustration jobs', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);
    const detail = await applyStoryboard(pictureBook, alice, book.id);
    const page = detail.pages[0]!;

    const [first, second] = await Promise.all([
      pictureBook.generateIllustration(alice, book.id, page.id),
      pictureBook.generateIllustration(alice, book.id, page.id),
    ]);

    expect(first.illustrationId).toBe(second.illustrationId);
    expect(first.revisionNumber).toBe(1);
    expect(second.revisionNumber).toBe(1);
    let revisions = await pictureBook.listIllustrations(alice, book.id, page.id);
    expect(revisions.illustrations.map((row) => row.revisionNumber)).toEqual([1]);
    expect(revisions.illustrations[0]).toMatchObject({
      provider: 'MOCK',
      model: 'server-controlled-image-model',
    });
    const duplicateNotifications = notifications.filter((id) => id === first.illustrationId);
    expect(duplicateNotifications.length).toBeGreaterThanOrEqual(1);

    const [character] = await db
      .select()
      .from(characterProfiles)
      .where(eq(characterProfiles.pictureBookId, book.id));
    const [stored] = await db
      .select()
      .from(workPageIllustrations)
      .where(eq(workPageIllustrations.id, first.illustrationId));
    expect(stored!.consistency[0]).toMatchObject({
      consistencyKey: character!.consistencyKey,
      visualPrompt: character!.visualPrompt,
    });
    expect(stored!.consistency[0]!.referenceMediaAssetId).toBe(character!.referenceMediaAssetId);
    expect(stored!.consistency[0]!.referenceMediaAssetId).toEqual(expect.any(String));

    await db
      .update(workPageIllustrations)
      .set({ status: 'FAILED', errorCode: 'IMAGE_PROVIDER_UNAVAILABLE', updatedAt: new Date() })
      .where(eq(workPageIllustrations.id, first.illustrationId));
    const retry = await pictureBook.generateIllustration(alice, book.id, page.id);
    expect(retry.revisionNumber).toBe(2);
    expect(retry.illustrationId).not.toBe(first.illustrationId);
    revisions = await pictureBook.listIllustrations(alice, book.id, page.id);
    expect(revisions.illustrations.map((row) => row.revisionNumber)).toEqual([1, 2]);
  });

  it('exposes only a READY media asset playback URL for illustration previews', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);
    const detail = await applyStoryboard(pictureBook, alice, book.id);
    const page = detail.pages[0]!;
    const accepted = await pictureBook.generateIllustration(alice, book.id, page.id);
    const [asset] = await db
      .insert(mediaAssets)
      .values({
        provider: 'BAIDU_BOS',
        objectKey: `picture-book-test/${accepted.illustrationId}.png`,
        playbackUrl: 'https://bos.example.test/picture-book-test/image.png',
        mimeType: 'image/png',
        byteSize: 1,
        status: 'READY',
      })
      .returning();
    await db
      .update(workPageIllustrations)
      .set({ status: 'READY', mediaAssetId: asset!.id })
      .where(eq(workPageIllustrations.id, accepted.illustrationId));

    const refreshed = await pictureBook.getPictureBook(alice, book.id);
    expect(refreshed.pages[0]!.illustrations[0]).toMatchObject({
      status: 'READY',
      mediaAssetId: asset!.id,
      playbackUrl: 'https://bos.example.test/picture-book-test/image.png',
    });
    expect(
      (await pictureBook.listIllustrations(alice, book.id, page.id)).illustrations[0],
    ).toMatchObject({
      playbackUrl: 'https://bos.example.test/picture-book-test/image.png',
    });
  });

  it('fails illustration requests closed, enforces ownership and rejects provider/model input', async () => {
    const pictureBook = service();
    const app = await createApp(pictureBook);
    try {
      const alice = await createUser();
      const bob = await createUser();
      const { book } = await createBook(pictureBook, alice);
      const detail = await applyStoryboard(pictureBook, alice, book.id);
      const page = detail.pages[0]!;

      const injected = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/pages/${page.id}/illustrations`,
        headers: { authorization: `Bearer ${token(alice)}` },
        payload: { provider: 'DEEPSEEK', model: 'client-model' },
      });
      expect(injected.statusCode).toBe(400);

      const foreign = await app.inject({
        method: 'POST',
        url: `/api/v1/ai/picture-books/${book.id}/pages/${page.id}/illustrations`,
        headers: { authorization: `Bearer ${token(bob)}` },
        payload: {},
      });
      expect(foreign.statusCode).toBe(404);

      await expect(
        service({ imageEnabled: false }).generateIllustration(alice, book.id, page.id),
      ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    } finally {
      await app.close();
    }
  });
});
