import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aiJobs,
  aiProjects,
  characterProfiles,
  consumerUsers,
  createDatabase,
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
        content: '清晨，小狐狸在森林里遇见一只迷路的小鸟，并帮助它回到了家。',
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
    const accepted = await pictureBook.generate(userId, pictureBookId, { operation: 'CHARACTERS' });

    await succeed(
      accepted.jobId,
      JSON.stringify({
        characters: [
          {
            name: '小狐狸',
            role: 'MAIN',
            description: '勇敢、温柔，喜欢帮助朋友',
            visualPrompt: 'orange fox, green scarf, round brown eyes, small white tail tip',
          },
          {
            name: '小鸟',
            role: 'SUPPORTING',
            description: '一只迷路但很有礼貌的小鸟',
            visualPrompt: 'small blue bird, pale yellow chest, tiny red satchel',
          },
        ],
      }),
    );

    return {
      accepted,
      detail: await pictureBook.applyJob(userId, pictureBookId, accepted.jobId),
    };
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
          sceneDescription: '森林封面',
          illustrationPrompt: 'orange fox and blue bird in a forest',
        },
        pages: [
          {
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

      expect(response.statusCode).toBe(202);

      const accepted = response.json<{
        jobId: string;
        pictureBookId: string;
        operation: string;
        status: string;
      }>();

      expect(accepted).toMatchObject({
        pictureBookId: book.id,
        operation: 'CHARACTERS',
        status: 'QUEUED',
      });

      expect(notifications).toEqual([accepted.jobId]);

      const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, accepted.jobId));

      expect(job).toMatchObject({
        jobType: 'PICTURE_BOOK_CHARACTERS',
        provider: 'MOCK',
        model: 'server-controlled-picture-book-model',
      });
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

      const charactersJob = await pictureBook.getJob(alice, charactersResult.accepted.jobId);

      expect(charactersJob.applied).toBe(true);

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
            sceneDescription: '晨光森林里的小狐狸与小鸟',
            illustrationPrompt: 'storybook cover, orange fox with green scarf and small blue bird',
          },
          pages: [
            {
              storyText: '清晨，小狐狸沿着森林小路出发。',
              sceneDescription: '森林入口，晨光穿过树叶。',
              illustrationPrompt: 'orange fox with green scarf walking on a forest path',
            },
            {
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
          sceneDescription: '有效封面',
          illustrationPrompt: 'valid cover prompt',
        },
        pages: [
          {
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

  it('allocates immutable illustration revisions concurrently with server-controlled configuration', async () => {
    const pictureBook = service();
    const alice = await createUser();
    const { book } = await createBook(pictureBook, alice);
    const detail = await applyStoryboard(pictureBook, alice, book.id);
    const page = detail.pages[0]!;

    const [first, second] = await Promise.all([
      pictureBook.generateIllustration(alice, book.id, page.id),
      pictureBook.generateIllustration(alice, book.id, page.id),
    ]);

    expect([first.revisionNumber, second.revisionNumber].sort()).toEqual([1, 2]);
    const revisions = await pictureBook.listIllustrations(alice, book.id, page.id);
    expect(revisions.illustrations.map((row) => row.revisionNumber)).toEqual([1, 2]);
    expect(revisions.illustrations.every((row) => row.provider === 'MOCK')).toBe(true);
    expect(
      revisions.illustrations.every((row) => row.model === 'server-controlled-image-model'),
    ).toBe(true);
    expect(notifications).toEqual(
      expect.arrayContaining([first.illustrationId, second.illustrationId]),
    );

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
      referenceMediaAssetId: null,
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
