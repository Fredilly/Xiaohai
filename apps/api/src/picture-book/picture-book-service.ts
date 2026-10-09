import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  aiJobs,
  aiProjects,
  characterProfiles,
  characterReferenceImages,
  mediaAssets,
  pictureBooks,
  workPageIllustrations,
  workPages,
  workVersions,
  works,
  type createDatabase,
} from '@xiaohai/db';
import {
  pictureBookCharacterPlanSchema,
  pictureBookStoryboardPlanSchema,
  type CreatePictureBookRequest,
  type PictureBookGenerateRequest,
  type PictureBookTextOperation,
  updatePictureBookCharacterSchema,
} from '@xiaohai/contracts/picture-book';
import { structuredStorySchema } from '@xiaohai/contracts/story';
import type { AiQueue } from '../ai/ai-queue.js';
import type { ImageQueue } from './image-queue.js';

type Db = ReturnType<typeof createDatabase>['db'];

export type PictureBookAiConfig = {
  enabled: boolean;
  provider: 'MOCK' | 'DEEPSEEK' | 'BAILIAN';
  model: string;
  maxAttempts: number;
  timeoutMs: number;
  imageEnabled: boolean;
  imageProvider: 'MOCK' | 'BAILIAN';
  imageModel: string;
};

type PictureBookLogger = {
  warn(bindings: Record<string, unknown>, message: string): void;
};

type PictureBookContext = {
  kind: 'PICTURE_BOOK';
  pictureBookId: string;
  operation: PictureBookTextOperation;
};

export class PictureBookError extends Error {
  constructor(
    readonly code:
      | 'FEATURE_DISABLED'
      | 'NOT_FOUND'
      | 'INVALID_SOURCE_VERSION'
      | 'INVALID_STATE'
      | 'JOB_NOT_READY'
      | 'INVALID_JOB_STATE'
      | 'INVALID_JOB_OUTPUT'
      | 'CHARACTER_LOCKED',
  ) {
    super(code);
  }
}

export class PictureBookService {
  constructor(
    private readonly db: Db,
    private readonly queue: AiQueue,
    private readonly imageQueue: ImageQueue,
    private readonly config: PictureBookAiConfig,
    private readonly logger?: PictureBookLogger,
  ) {}

  async generateIllustration(consumerUserId: string, pictureBookId: string, pageId: string) {
    if (!this.config.imageEnabled) throw new PictureBookError('FEATURE_DISABLED');

    const { illustration, shouldNotify } = await this.db.transaction(async (tx) => {
      const [page] = await tx
        .select({ page: workPages, book: pictureBooks })
        .from(workPages)
        .innerJoin(pictureBooks, eq(pictureBooks.id, workPages.pictureBookId))
        .where(
          and(
            eq(workPages.id, pageId),
            eq(workPages.pictureBookId, pictureBookId),
            eq(pictureBooks.consumerUserId, consumerUserId),
          ),
        )
        .for('update');

      if (!page) throw new PictureBookError('NOT_FOUND');
      if (!page.page.illustrationPrompt) throw new PictureBookError('INVALID_STATE');

      const characters = await tx
        .select()
        .from(characterProfiles)
        .where(eq(characterProfiles.pictureBookId, pictureBookId))
        .orderBy(asc(characterProfiles.sortOrder));
      if (characters.some((character) => !character.confirmed || !character.locked)) {
        throw new PictureBookError('INVALID_STATE');
      }
      // Existing books could be illustrated before character-reference images became mandatory.
      // Allow explicit regeneration of a page with prior revisions, but keep the reference
      // requirement for its first illustration and all newly created pages.
      if (characters.some((character) => !character.referenceMediaAssetId)) {
        const [priorIllustration] = await tx
          .select({ id: workPageIllustrations.id })
          .from(workPageIllustrations)
          .where(eq(workPageIllustrations.pageId, pageId))
          .limit(1);
        if (!priorIllustration) throw new PictureBookError('INVALID_STATE');
      }
      const pageCharacterIds =
        page.page.characterIds.length > 0 ? page.page.characterIds : characters.map((c) => c.id);
      const relevant = characters.filter((character) => pageCharacterIds.includes(character.id));
      if (relevant.length === 0 || relevant.length > 3) throw new PictureBookError('INVALID_STATE');

      const [active] = await tx
        .select()
        .from(workPageIllustrations)
        .where(
          and(
            eq(workPageIllustrations.pageId, pageId),
            inArray(workPageIllustrations.status, ['QUEUED', 'RUNNING']),
          ),
        )
        .orderBy(desc(workPageIllustrations.createdAt))
        .limit(1)
        .for('update');
      if (active) {
        return { illustration: active, shouldNotify: active.status === 'QUEUED' };
      }

      const [revision] = await tx
        .select({
          value: sql<number>`coalesce(max(${workPageIllustrations.revisionNumber}), 0) + 1`,
        })
        .from(workPageIllustrations)
        .where(eq(workPageIllustrations.pageId, pageId));

      const [created] = await tx
        .insert(workPageIllustrations)
        .values({
          pageId,
          revisionNumber: Number(revision!.value),
          prompt: page.page.illustrationPrompt,
          provider: this.config.imageProvider,
          model: this.config.imageModel,
          consistency: relevant.map((character) => ({
            consistencyKey: character.consistencyKey,
            visualPrompt: character.visualPrompt,
            referenceMediaAssetId: character.referenceMediaAssetId,
          })),
        })
        .returning();

      await tx
        .update(pictureBooks)
        .set({ status: 'ILLUSTRATING', updatedAt: new Date() })
        .where(eq(pictureBooks.id, pictureBookId));
      return { illustration: created!, shouldNotify: true };
    });

    try {
      if (shouldNotify) await this.imageQueue.notify(illustration.id);
    } catch {
      this.logger?.warn(
        { event: 'PICTURE_BOOK_IMAGE_QUEUE_NOTIFY_FAILED', illustrationId: illustration.id },
        'Image queue notification failed; PostgreSQL polling will recover the illustration',
      );
    }

    return {
      pictureBookId,
      pageId,
      illustrationId: illustration.id,
      revisionNumber: illustration.revisionNumber,
      status: 'QUEUED' as const,
    };
  }

  async listIllustrations(consumerUserId: string, pictureBookId: string, pageId: string) {
    await this.requireOwnedPage(consumerUserId, pictureBookId, pageId);
    const rows = await this.db
      .select({ illustration: workPageIllustrations, media: mediaAssets })
      .from(workPageIllustrations)
      .leftJoin(mediaAssets, eq(workPageIllustrations.mediaAssetId, mediaAssets.id))
      .where(eq(workPageIllustrations.pageId, pageId))
      .orderBy(asc(workPageIllustrations.revisionNumber));
    return {
      illustrations: rows.map((row) => this.viewIllustration(row.illustration, row.media)),
    };
  }

  private async requireOwnedPage(consumerUserId: string, pictureBookId: string, pageId: string) {
    const [row] = await this.db
      .select({ id: workPages.id })
      .from(workPages)
      .innerJoin(pictureBooks, eq(pictureBooks.id, workPages.pictureBookId))
      .where(
        and(
          eq(workPages.id, pageId),
          eq(workPages.pictureBookId, pictureBookId),
          eq(pictureBooks.consumerUserId, consumerUserId),
        ),
      );
    if (!row) throw new PictureBookError('NOT_FOUND');
  }

  async createPictureBook(consumerUserId: string, input: CreatePictureBookRequest) {
    const [source] = await this.db
      .select({
        work: works,
        version: workVersions,
      })
      .from(works)
      .innerJoin(workVersions, eq(workVersions.workId, works.id))
      .where(
        and(
          eq(works.id, input.storyWorkId),
          eq(works.consumerUserId, consumerUserId),
          eq(workVersions.id, input.sourceStoryVersionId),
        ),
      );

    if (!source || source.version.contentKind !== 'BODY') {
      throw new PictureBookError('INVALID_SOURCE_VERSION');
    }

    let story: typeof structuredStorySchema._output;
    try {
      story = structuredStorySchema.parse(JSON.parse(source.version.content));
    } catch {
      throw new PictureBookError('INVALID_SOURCE_VERSION');
    }
    if (story.characters.length === 0) throw new PictureBookError('INVALID_SOURCE_VERSION');

    const title = input.title ?? source.work.title;

    const created = await this.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(aiProjects)
        .values({
          projectType: 'PICTURE_BOOK',
          title,
          createdByConsumerUserId: consumerUserId,
        })
        .returning();

      const [book] = await tx
        .insert(pictureBooks)
        .values({
          consumerUserId,
          aiProjectId: project!.id,
          storyWorkId: source.work.id,
          sourceStoryVersionId: source.version.id,
          title,
          layoutPreset: input.layoutPreset ?? 'AUTO',
        })
        .returning();

      await tx.insert(characterProfiles).values(
        story.characters.map((character, index) => {
          const characterId = randomUUID();
          return {
            id: characterId,
            pictureBookId: book!.id,
            name: character.name,
            description: character.description,
            visualPrompt: character.visualDescription,
            confirmed: false,
            locked: false,
            consistencyKey: characterId,
            sortOrder: index,
          };
        }),
      );

      return book!;
    });

    return this.viewPictureBook(created);
  }

  async updateCharacter(
    consumerUserId: string,
    pictureBookId: string,
    characterId: string,
    input: unknown,
  ) {
    const parsed = updatePictureBookCharacterSchema.safeParse(input);
    if (!parsed.success) throw new PictureBookError('INVALID_STATE');
    const book = await this.requireOwnedBook(consumerUserId, pictureBookId);
    const [character] = await this.db
      .select()
      .from(characterProfiles)
      .where(
        and(eq(characterProfiles.id, characterId), eq(characterProfiles.pictureBookId, book.id)),
      );
    if (!character) throw new PictureBookError('NOT_FOUND');
    if (character.locked) throw new PictureBookError('CHARACTER_LOCKED');
    await this.db
      .update(characterProfiles)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        visualPrompt: parsed.data.canonicalVisualPrompt,
        updatedAt: new Date(),
      })
      .where(eq(characterProfiles.id, character.id));
    return this.getPictureBook(consumerUserId, pictureBookId);
  }

  async confirmCharacters(consumerUserId: string, pictureBookId: string) {
    const book = await this.requireOwnedBook(consumerUserId, pictureBookId);
    const characters = await this.db
      .select()
      .from(characterProfiles)
      .where(eq(characterProfiles.pictureBookId, book.id));
    if (
      characters.length === 0 ||
      characters.some((character) => !character.referenceMediaAssetId)
    ) {
      throw new PictureBookError('INVALID_STATE');
    }
    await this.db
      .update(characterProfiles)
      .set({ confirmed: true, locked: true, updatedAt: new Date() })
      .where(eq(characterProfiles.pictureBookId, book.id));
    return this.getPictureBook(consumerUserId, pictureBookId);
  }

  async reopenCharacters(consumerUserId: string, pictureBookId: string) {
    const book = await this.requireOwnedBook(consumerUserId, pictureBookId);
    await this.db
      .update(characterProfiles)
      .set({ confirmed: false, locked: false, updatedAt: new Date() })
      .where(eq(characterProfiles.pictureBookId, book.id));
    return this.getPictureBook(consumerUserId, pictureBookId);
  }

  async generateCharacterReference(
    consumerUserId: string,
    pictureBookId: string,
    characterId: string,
  ) {
    if (!this.config.imageEnabled) throw new PictureBookError('FEATURE_DISABLED');
    const character = await this.requireOwnedCharacter(consumerUserId, pictureBookId, characterId);
    if (character.locked || character.confirmed) throw new PictureBookError('CHARACTER_LOCKED');
    const { revision, shouldNotify } = await this.db.transaction(async (tx) => {
      // Serialize revision allocation and active-job deduplication per character.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${character.id}, 0))`);
      const [active] = await tx
        .select()
        .from(characterReferenceImages)
        .where(
          and(
            eq(characterReferenceImages.characterProfileId, character.id),
            inArray(characterReferenceImages.status, ['QUEUED', 'RUNNING']),
          ),
        )
        .orderBy(desc(characterReferenceImages.createdAt))
        .limit(1)
        .for('update');
      if (active) {
        return { revision: active, shouldNotify: active.status === 'QUEUED' };
      }
      const [latest] = await tx
        .select({
          value: sql<number>`coalesce(max(${characterReferenceImages.revisionNumber}), 0) + 1`,
        })
        .from(characterReferenceImages)
        .where(eq(characterReferenceImages.characterProfileId, character.id));
      const [created] = await tx
        .insert(characterReferenceImages)
        .values({
          characterProfileId: character.id,
          revisionNumber: Number(latest!.value),
          provider: this.config.imageProvider,
          model: this.config.imageModel,
        })
        .returning();
      return { revision: created!, shouldNotify: true };
    });
    try {
      if (shouldNotify) await this.imageQueue.notify(revision.id);
    } catch {
      this.logger?.warn(
        {
          event: 'PICTURE_BOOK_REFERENCE_QUEUE_NOTIFY_FAILED',
          pictureBookId,
          characterId,
          characterReferenceRevisionId: revision.id,
        },
        'Reference image queue notification failed',
      );
    }
    return {
      pictureBookId,
      characterId,
      referenceRevisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      status: 'QUEUED' as const,
    };
  }

  async listCharacterReferences(
    consumerUserId: string,
    pictureBookId: string,
    characterId: string,
  ) {
    await this.requireOwnedCharacter(consumerUserId, pictureBookId, characterId);
    const rows = await this.db
      .select({ revision: characterReferenceImages, media: mediaAssets })
      .from(characterReferenceImages)
      .leftJoin(mediaAssets, eq(characterReferenceImages.mediaAssetId, mediaAssets.id))
      .where(eq(characterReferenceImages.characterProfileId, characterId))
      .orderBy(asc(characterReferenceImages.revisionNumber));
    return {
      references: rows.map(({ revision, media }) => ({
        ...revision,
        createdAt: revision.createdAt.toISOString(),
        updatedAt: revision.updatedAt.toISOString(),
        playbackUrl:
          revision.status === 'READY' && media?.status === 'READY' ? media.playbackUrl : null,
      })),
    };
  }

  async selectCharacterReference(
    consumerUserId: string,
    pictureBookId: string,
    characterId: string,
    revisionId: string,
  ) {
    const character = await this.requireOwnedCharacter(consumerUserId, pictureBookId, characterId);
    const [revision] = await this.db
      .select()
      .from(characterReferenceImages)
      .where(
        and(
          eq(characterReferenceImages.id, revisionId),
          eq(characterReferenceImages.characterProfileId, character.id),
        ),
      );
    if (character.confirmed || character.locked) throw new PictureBookError('CHARACTER_LOCKED');
    if (!revision || revision.status !== 'READY' || !revision.mediaAssetId)
      throw new PictureBookError('INVALID_STATE');
    await this.db
      .update(characterProfiles)
      .set({
        referenceMediaAssetId: revision.mediaAssetId,
        confirmed: false,
        locked: false,
        updatedAt: new Date(),
      })
      .where(eq(characterProfiles.id, character.id));
    return this.getPictureBook(consumerUserId, pictureBookId);
  }

  private async requireOwnedCharacter(
    consumerUserId: string,
    pictureBookId: string,
    characterId: string,
  ) {
    const [row] = await this.db
      .select({ character: characterProfiles })
      .from(characterProfiles)
      .innerJoin(pictureBooks, eq(pictureBooks.id, characterProfiles.pictureBookId))
      .where(
        and(
          eq(characterProfiles.id, characterId),
          eq(characterProfiles.pictureBookId, pictureBookId),
          eq(pictureBooks.consumerUserId, consumerUserId),
        ),
      );
    if (!row) throw new PictureBookError('NOT_FOUND');
    return row.character;
  }

  async listPictureBooks(consumerUserId: string) {
    const rows = await this.db
      .select()
      .from(pictureBooks)
      .where(eq(pictureBooks.consumerUserId, consumerUserId))
      .orderBy(desc(pictureBooks.updatedAt))
      .limit(100);
    const bookIds = rows.map((row) => row.id);
    const bookPages =
      bookIds.length === 0
        ? []
        : await this.db
            .select({
              bookId: workPages.pictureBookId,
              pageId: workPages.id,
              pageKind: workPages.pageKind,
            })
            .from(workPages)
            .where(inArray(workPages.pictureBookId, bookIds));
    const coverPages = bookPages.filter((page) => page.pageKind === 'COVER');
    const pageIds = bookPages.map((page) => page.pageId);
    const realIllustrations =
      pageIds.length === 0
        ? []
        : await this.db
            .select({
              pageId: workPageIllustrations.pageId,
              revisionNumber: workPageIllustrations.revisionNumber,
              playbackUrl: mediaAssets.playbackUrl,
            })
            .from(workPageIllustrations)
            .innerJoin(mediaAssets, eq(workPageIllustrations.mediaAssetId, mediaAssets.id))
            .where(
              and(
                inArray(workPageIllustrations.pageId, pageIds),
                eq(workPageIllustrations.status, 'READY'),
                eq(workPageIllustrations.provider, 'BAILIAN'),
                eq(mediaAssets.status, 'READY'),
                eq(mediaAssets.provider, 'BAIDU_BOS'),
                sql`${mediaAssets.mimeType} like 'image/%'`,
              ),
            )
            .orderBy(desc(workPageIllustrations.revisionNumber));
    const readyPageIds = new Set<string>();
    const coverPageById = new Map(coverPages.map((page) => [page.pageId, page.bookId]));
    const coverUrlByBook = new Map<string, string>();
    for (const illustration of realIllustrations) {
      const { pageId, playbackUrl } = illustration;
      if (!playbackUrl || !isHttpsImageUrl(playbackUrl)) continue;
      readyPageIds.add(pageId);
      const coverBookId = coverPageById.get(pageId);
      if (coverBookId && !coverUrlByBook.has(coverBookId)) {
        coverUrlByBook.set(coverBookId, playbackUrl);
      }
    }
    const pagesByBook = new Map<string, string[]>();
    for (const page of bookPages) {
      const existing = pagesByBook.get(page.bookId) ?? [];
      existing.push(page.pageId);
      pagesByBook.set(page.bookId, existing);
    }

    return {
      pictureBooks: rows.map((row) => {
        const pages = pagesByBook.get(row.id) ?? [];
        const allPagesReal =
          pages.length > 0 && pages.every((pageId) => readyPageIds.has(pageId));
        return {
          ...this.viewPictureBook(row),
          status: row.status === 'READY' && !allPagesReal ? 'ILLUSTRATING' : row.status,
          coverPlaybackUrl: coverUrlByBook.get(row.id) ?? null,
        };
      }),
    };
  }

  async getPictureBook(consumerUserId: string, pictureBookId: string) {
    const book = await this.requireOwnedBook(consumerUserId, pictureBookId);

    const characters = await this.db
      .select()
      .from(characterProfiles)
      .where(eq(characterProfiles.pictureBookId, book.id))
      .orderBy(asc(characterProfiles.sortOrder));

    const pages = await this.db
      .select()
      .from(workPages)
      .where(eq(workPages.pictureBookId, book.id))
      .orderBy(asc(workPages.pageNumber));

    const illustrations =
      pages.length === 0
        ? []
        : await this.db
            .select({ illustration: workPageIllustrations, media: mediaAssets })
            .from(workPageIllustrations)
            .leftJoin(mediaAssets, eq(workPageIllustrations.mediaAssetId, mediaAssets.id))
            .where(
              inArray(
                workPageIllustrations.pageId,
                pages.map((page) => page.id),
              ),
            )
            .orderBy(asc(workPageIllustrations.pageId), asc(workPageIllustrations.revisionNumber));

    const byPage = new Map<string, typeof illustrations>();

    for (const illustration of illustrations) {
      const rows = byPage.get(illustration.illustration.pageId) ?? [];
      rows.push(illustration);
      byPage.set(illustration.illustration.pageId, rows);
    }

    // Older rows may be marked READY because a MOCK illustration counted as complete.
    // Derive the visible status from real, attached media without mutating historical data.
    const readyPageIds = new Set(
      illustrations
        .filter(
          ({ illustration, media }) =>
            illustration.status === 'READY' &&
            illustration.provider === 'BAILIAN' &&
            media?.status === 'READY' &&
            media.provider === 'BAIDU_BOS' &&
            media.mimeType.startsWith('image/') &&
            Boolean(media.playbackUrl && isHttpsImageUrl(media.playbackUrl)),
        )
        .map(({ illustration }) => illustration.pageId),
    );
    const allPagesReal =
      pages.length > 0 && pages.every((page) => readyPageIds.has(page.id));

    return {
      pictureBook: {
        ...this.viewPictureBook(book),
        status: book.status === 'READY' && !allPagesReal ? 'ILLUSTRATING' : book.status,
      },
      characters: characters.map((row) => this.viewCharacter(row)),
      pages: pages.map((row) =>
        this.viewPage(
          row,
          (byPage.get(row.id) ?? []).map((item) =>
            this.viewIllustration(item.illustration, item.media),
          ),
        ),
      ),
    };
  }

  async generate(consumerUserId: string, pictureBookId: string, input: PictureBookGenerateRequest) {
    if (!this.config.enabled) throw new PictureBookError('FEATURE_DISABLED');

    const book = await this.requireOwnedBook(consumerUserId, pictureBookId);
    const source = await this.requireSourceStory(book);

    const characters = await this.db
      .select()
      .from(characterProfiles)
      .where(eq(characterProfiles.pictureBookId, book.id))
      .orderBy(asc(characterProfiles.sortOrder));

    const [existingPage] = await this.db
      .select({ id: workPages.id })
      .from(workPages)
      .where(eq(workPages.pictureBookId, book.id))
      .limit(1);

    if (input.operation === 'CHARACTERS') {
      if (characters.length > 0 || existingPage) {
        throw new PictureBookError('INVALID_STATE');
      }
    } else {
      if (
        characters.length === 0 ||
        characters.some((character) => !character.confirmed || !character.locked) ||
        existingPage
      ) {
        throw new PictureBookError('INVALID_STATE');
      }
    }

    const context: PictureBookContext = {
      kind: 'PICTURE_BOOK',
      pictureBookId: book.id,
      operation: input.operation,
    };

    const [job] = await this.db
      .insert(aiJobs)
      .values({
        projectId: book.aiProjectId,
        jobType: this.jobType(input.operation),
        provider: this.config.provider,
        model: this.config.model,
        input: {
          prompt: this.buildPrompt(book, source.work, source.version, input.operation, characters),
          context,
        },
        maxAttempts: this.config.maxAttempts,
        timeoutMs: this.config.timeoutMs,
      })
      .returning();

    try {
      await this.queue.notify(job!.id);
    } catch {
      this.logger?.warn(
        {
          event: 'PICTURE_BOOK_AI_QUEUE_NOTIFY_FAILED',
          jobId: job!.id,
          pictureBookId: book.id,
        },
        'Picture Book AI queue notification failed; PostgreSQL polling will recover the job',
      );
    }

    return {
      pictureBookId: book.id,
      jobId: job!.id,
      operation: input.operation,
      status: 'QUEUED' as const,
    };
  }

  async getJob(consumerUserId: string, jobId: string) {
    const { job, book, context } = await this.requireOwnedJob(consumerUserId, jobId);

    const applied =
      context.operation === 'CHARACTERS'
        ? Boolean(
            (
              await this.db
                .select({ id: characterProfiles.id })
                .from(characterProfiles)
                .where(eq(characterProfiles.sourceAiJobId, job.id))
                .limit(1)
            )[0],
          )
        : Boolean(
            (
              await this.db
                .select({ id: workPages.id })
                .from(workPages)
                .where(eq(workPages.sourceAiJobId, job.id))
                .limit(1)
            )[0],
          );

    return {
      jobId: job.id,
      pictureBookId: book.id,
      operation: context.operation,
      status: job.status as 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
      generatedText:
        job.status === 'SUCCEEDED' && typeof job.result?.text === 'string' ? job.result.text : null,
      applied,
      lastErrorCode: job.lastErrorCode ?? null,
    };
  }

  async applyJob(consumerUserId: string, pictureBookId: string, jobId: string) {
    await this.db.transaction(async (tx) => {
      const [book] = await tx
        .select()
        .from(pictureBooks)
        .where(
          and(eq(pictureBooks.id, pictureBookId), eq(pictureBooks.consumerUserId, consumerUserId)),
        )
        .for('update');

      if (!book) throw new PictureBookError('NOT_FOUND');

      const [job] = await tx
        .select()
        .from(aiJobs)
        .where(and(eq(aiJobs.id, jobId), eq(aiJobs.projectId, book.aiProjectId)));

      if (!job) throw new PictureBookError('NOT_FOUND');

      const context = this.readContext(job.input.context);

      if (context.pictureBookId !== book.id || job.jobType !== this.jobType(context.operation)) {
        throw new PictureBookError('INVALID_JOB_STATE');
      }

      if (context.operation === 'CHARACTERS') {
        const [alreadyApplied] = await tx
          .select({ id: characterProfiles.id })
          .from(characterProfiles)
          .where(eq(characterProfiles.sourceAiJobId, job.id))
          .limit(1);

        if (alreadyApplied) return;
      } else {
        const [alreadyApplied] = await tx
          .select({ id: workPages.id })
          .from(workPages)
          .where(eq(workPages.sourceAiJobId, job.id))
          .limit(1);

        if (alreadyApplied) return;
      }

      if (job.status !== 'SUCCEEDED' || typeof job.result?.text !== 'string') {
        throw new PictureBookError('JOB_NOT_READY');
      }

      if (context.operation === 'CHARACTERS') {
        const [existingCharacter] = await tx
          .select({ id: characterProfiles.id })
          .from(characterProfiles)
          .where(eq(characterProfiles.pictureBookId, book.id))
          .limit(1);

        const [existingPage] = await tx
          .select({ id: workPages.id })
          .from(workPages)
          .where(eq(workPages.pictureBookId, book.id))
          .limit(1);

        if (existingCharacter || existingPage) {
          throw new PictureBookError('INVALID_STATE');
        }

        const parsed = pictureBookCharacterPlanSchema.safeParse(
          this.normalizeCharacterPlan(this.parseJson(job.result.text)),
        );

        if (!parsed.success) throw new PictureBookError('INVALID_JOB_OUTPUT');

        await tx.insert(characterProfiles).values(
          parsed.data.characters.map((character, index) => ({
            pictureBookId: book.id,
            name: character.name,
            role: character.role,
            description: character.description,
            visualPrompt: character.visualPrompt,
            sourceAiJobId: job.id,
            sortOrder: index,
          })),
        );

        await tx
          .update(pictureBooks)
          .set({ updatedAt: new Date() })
          .where(eq(pictureBooks.id, book.id));

        return;
      }

      const characters = await tx
        .select()
        .from(characterProfiles)
        .where(eq(characterProfiles.pictureBookId, book.id));

      const [existingPage] = await tx
        .select({ id: workPages.id })
        .from(workPages)
        .where(eq(workPages.pictureBookId, book.id))
        .limit(1);

      if (characters.length === 0 || existingPage) {
        throw new PictureBookError('INVALID_STATE');
      }

      const parsed = pictureBookStoryboardPlanSchema.safeParse(this.parseJson(job.result.text));

      if (!parsed.success) throw new PictureBookError('INVALID_JOB_OUTPUT');

      await tx.insert(workPages).values([
        {
          pictureBookId: book.id,
          pageNumber: 0,
          pageKind: 'COVER',
          storyText: null,
          sceneDescription: parsed.data.cover.sceneDescription,
          illustrationPrompt: parsed.data.cover.illustrationPrompt,
          layoutPreset: parsed.data.cover.layoutPreset ?? book.layoutPreset,
          characterIds: this.mapCharacterKeys(parsed.data.cover.characterKeys, characters),
          sourceAiJobId: job.id,
        },
        ...parsed.data.pages.map((page, index) => ({
          pictureBookId: book.id,
          pageNumber: index + 1,
          pageKind: 'CONTENT' as const,
          storyText: page.storyText,
          sceneDescription: page.sceneDescription,
          illustrationPrompt: page.illustrationPrompt,
          layoutPreset: page.layoutPreset ?? book.layoutPreset,
          characterIds: this.mapCharacterKeys(page.characterKeys, characters),
          sourceAiJobId: job.id,
        })),
      ]);

      await tx
        .update(pictureBooks)
        .set({
          status: 'PLANNED',
          updatedAt: new Date(),
        })
        .where(eq(pictureBooks.id, book.id));
    });

    return this.getPictureBook(consumerUserId, pictureBookId);
  }

  private async requireOwnedBook(consumerUserId: string, pictureBookId: string) {
    const [book] = await this.db
      .select()
      .from(pictureBooks)
      .where(
        and(eq(pictureBooks.id, pictureBookId), eq(pictureBooks.consumerUserId, consumerUserId)),
      );

    if (!book) throw new PictureBookError('NOT_FOUND');
    return book;
  }

  private async requireSourceStory(book: typeof pictureBooks.$inferSelect) {
    const [source] = await this.db
      .select({
        work: works,
        version: workVersions,
      })
      .from(works)
      .innerJoin(workVersions, eq(workVersions.workId, works.id))
      .where(and(eq(works.id, book.storyWorkId), eq(workVersions.id, book.sourceStoryVersionId)));

    if (!source || source.version.contentKind !== 'BODY') {
      throw new PictureBookError('INVALID_SOURCE_VERSION');
    }

    return source;
  }

  private async requireOwnedJob(consumerUserId: string, jobId: string) {
    const [row] = await this.db
      .select({
        job: aiJobs,
        book: pictureBooks,
      })
      .from(aiJobs)
      .innerJoin(pictureBooks, eq(pictureBooks.aiProjectId, aiJobs.projectId))
      .where(and(eq(aiJobs.id, jobId), eq(pictureBooks.consumerUserId, consumerUserId)));

    if (!row) throw new PictureBookError('NOT_FOUND');

    const context = this.readContext(row.job.input.context);

    if (
      context.pictureBookId !== row.book.id ||
      row.job.jobType !== this.jobType(context.operation)
    ) {
      throw new PictureBookError('INVALID_JOB_STATE');
    }

    return { ...row, context };
  }

  private readContext(value: unknown): PictureBookContext {
    if (!value || typeof value !== 'object') {
      throw new PictureBookError('INVALID_JOB_STATE');
    }

    const context = value as Partial<PictureBookContext>;

    if (
      context.kind !== 'PICTURE_BOOK' ||
      typeof context.pictureBookId !== 'string' ||
      (context.operation !== 'CHARACTERS' && context.operation !== 'STORYBOARD')
    ) {
      throw new PictureBookError('INVALID_JOB_STATE');
    }

    return context as PictureBookContext;
  }

  private jobType(operation: PictureBookTextOperation) {
    return `PICTURE_BOOK_${operation}` as const;
  }

  private parseJson(text: string): unknown {
    const trimmed = text.trim();

    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const raw = fenced?.[1] ?? trimmed;

    try {
      return JSON.parse(raw);
    } catch {
      throw new PictureBookError('INVALID_JOB_OUTPUT');
    }
  }

  private normalizeCharacterPlan(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

    const candidate = value as { characters?: unknown };
    if (!Array.isArray(candidate.characters)) return value;
    const characters = candidate.characters as unknown[];

    return {
      ...candidate,
      characters: characters.map((character: unknown) => {
        if (!character || typeof character !== 'object' || Array.isArray(character)) {
          return character;
        }

        const item = character as Record<string, unknown>;
        return item.role === 'AUXILIARY' ? { ...item, role: 'SUPPORTING' } : item;
      }),
    };
  }

  private buildPrompt(
    book: typeof pictureBooks.$inferSelect,
    work: typeof works.$inferSelect,
    version: typeof workVersions.$inferSelect,
    operation: PictureBookTextOperation,
    characters: Array<typeof characterProfiles.$inferSelect>,
  ) {
    const common = [
      `XIAOHAI_TASK=PICTURE_BOOK_${operation}`,
      '你是小海童话的儿童绘本策划助手。',
      '只输出合法 JSON，不要输出 Markdown 代码块、解释、前言或模型身份。',
      `绘本标题：${book.title}`,
      `目标年龄：${work.ageRange}`,
      `主题：${work.theme}`,
      `画面风格：${work.style}`,
      '内容必须适龄、温和、清晰，并忠实于参考故事。',
      '参考故事正文：',
      version.content,
    ];

    if (operation === 'CHARACTERS') {
      return [
        ...common,
        '请识别绘本中需要保持视觉一致的主要与辅助角色。',
        'role 只能是 "MAIN" 或 "SUPPORTING"。MAIN 仅用于主要角色；所有配角、辅助角色、次要角色一律使用 SUPPORTING。',
        '禁止使用 AUXILIARY、SECONDARY 或任何其他 role 值。',
        'visualPrompt 必须描述稳定的外貌、服装、配色和辨识特征，不包含具体场景动作。',
        '输出格式：',
        '{"characters":[{"name":"主角名","role":"MAIN","description":"主要角色说明","visualPrompt":"稳定视觉描述"},{"name":"配角名","role":"SUPPORTING","description":"配角说明","visualPrompt":"稳定视觉描述"}]}',
      ].join('\n\n');
    }

    const characterBlock = characters.map(
      (character) =>
        `${character.name} [${character.role}] consistencyKey=${character.consistencyKey}\n${character.visualPrompt}`,
    );

    return [
      ...common,
      '角色视觉设定如下，后续每一页插画提示必须遵守这些固定特征：',
      ...characterBlock,
      '请把完整故事拆成适合儿童绘本阅读的连续页面，并设计封面。',
      'pages 数组不要提供 pageNumber，页码由服务器按数组顺序生成。',
      'illustrationPrompt 要描述该页场景，并明确沿用相关角色的固定视觉特征。',
      '每个 cover/page 必须输出 characterKeys，使用上面角色的精确 name；只填写本页实际出现的角色，最多 3 个。',
      '输出格式：',
      '{"cover":{"characterKeys":["角色名"],"sceneDescription":"封面场景","illustrationPrompt":"封面插画提示","layoutPreset":"AUTO"},"pages":[{"characterKeys":["角色名"],"storyText":"本页文字","sceneDescription":"场景说明","illustrationPrompt":"插画提示","layoutPreset":"AUTO"}]}',
    ].join('\n\n');
  }

  private viewPictureBook(book: typeof pictureBooks.$inferSelect) {
    return {
      id: book.id,
      storyWorkId: book.storyWorkId,
      sourceStoryVersionId: book.sourceStoryVersionId,
      title: book.title,
      status: book.status as 'DRAFT' | 'PLANNED' | 'ILLUSTRATING' | 'READY',
      layoutPreset: book.layoutPreset,
      createdAt: book.createdAt.toISOString(),
      updatedAt: book.updatedAt.toISOString(),
    };
  }

  private viewCharacter(character: typeof characterProfiles.$inferSelect) {
    return {
      id: character.id,
      pictureBookId: character.pictureBookId,
      name: character.name,
      role: character.role as 'MAIN' | 'SUPPORTING',
      description: character.description,
      visualPrompt: character.visualPrompt,
      canonicalVisualPrompt: character.visualPrompt,
      consistencyKey: character.consistencyKey,
      referenceMediaAssetId: character.referenceMediaAssetId,
      sourceAiJobId: character.sourceAiJobId,
      characterId: character.id,
      confirmed: character.confirmed,
      locked: character.locked,
      sortOrder: character.sortOrder,
      createdAt: character.createdAt.toISOString(),
      updatedAt: character.updatedAt.toISOString(),
    };
  }

  private viewIllustration(
    illustration: typeof workPageIllustrations.$inferSelect,
    media: typeof mediaAssets.$inferSelect | null = null,
  ) {
    return {
      id: illustration.id,
      pageId: illustration.pageId,
      revisionNumber: illustration.revisionNumber,
      prompt: illustration.prompt,
      provider: illustration.provider,
      model: illustration.model,
      status: illustration.status as 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED',
      errorCode: illustration.errorCode,
      sourceAiJobId: illustration.sourceAiJobId,
      mediaAssetId: illustration.mediaAssetId,
      playbackUrl:
        illustration.status === 'READY' && media?.status === 'READY' ? media.playbackUrl : null,
      createdAt: illustration.createdAt.toISOString(),
      updatedAt: illustration.updatedAt.toISOString(),
    };
  }

  private mapCharacterKeys(
    keys: string[],
    characters: Array<typeof characterProfiles.$inferSelect>,
  ) {
    const mapped = keys.map((key) => characters.find((character) => character.name === key)?.id);
    if (mapped.some((id) => !id) || new Set(mapped).size !== mapped.length)
      throw new PictureBookError('INVALID_JOB_OUTPUT');
    return mapped as string[];
  }

  private viewPage(
    page: typeof workPages.$inferSelect,
    illustrations: ReturnType<PictureBookService['viewIllustration']>[],
  ) {
    return {
      id: page.id,
      pictureBookId: page.pictureBookId,
      pageNumber: page.pageNumber,
      pageKind: page.pageKind as 'COVER' | 'CONTENT',
      storyText: page.storyText,
      sceneDescription: page.sceneDescription,
      illustrationPrompt: page.illustrationPrompt,
      layoutPreset: page.layoutPreset,
      sourceAiJobId: page.sourceAiJobId,
      illustrations,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    };
  }
}

function isHttpsImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
