import { and, asc, eq, sql } from 'drizzle-orm';
import { mediaAssets, workPageIllustrations, type createDatabase } from '@xiaohai/db';
import type { ImageProvider } from './image-provider.js';
import { ImageProviderError } from './image-provider.js';

type Db = ReturnType<typeof createDatabase>['db'];

export class ImageJobProcessor {
  constructor(
    private readonly db: Db,
    private readonly provider: ImageProvider,
    private readonly timeoutMs: number,
  ) {}

  async processOne(): Promise<string | null> {
    const claimed = await this.db.transaction(async (tx) => {
      const [illustration] = await tx
        .select()
        .from(workPageIllustrations)
        .where(
          and(
            eq(workPageIllustrations.status, 'QUEUED'),
            eq(workPageIllustrations.provider, this.provider.name),
          ),
        )
        .orderBy(asc(workPageIllustrations.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!illustration) return null;
      const [updated] = await tx
        .update(workPageIllustrations)
        .set({ status: 'RUNNING', errorCode: null, updatedAt: new Date() })
        .where(
          and(
            eq(workPageIllustrations.id, illustration.id),
            eq(workPageIllustrations.status, 'QUEUED'),
          ),
        )
        .returning();
      return updated ?? null;
    });
    if (!claimed) return null;

    try {
      const result = await this.provider.generate({
        model: claimed.model,
        prompt: claimed.prompt,
        consistency: claimed.consistency,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ status: workPageIllustrations.status })
          .from(workPageIllustrations)
          .where(eq(workPageIllustrations.id, claimed.id))
          .for('update');
        if (current?.status !== 'RUNNING') return;
        const [asset] = await tx
          .insert(mediaAssets)
          .values({
            provider: 'MOCK_IMAGE',
            objectKey: result.objectKey,
            playbackUrl: result.playbackUrl,
            mimeType: result.mimeType,
            byteSize: result.byteSize,
            status: 'READY',
          })
          .onConflictDoUpdate({
            target: [mediaAssets.provider, mediaAssets.objectKey],
            set: { playbackUrl: result.playbackUrl, updatedAt: new Date() },
          })
          .returning({ id: mediaAssets.id });
        await tx
          .update(workPageIllustrations)
          .set({ status: 'READY', mediaAssetId: asset!.id, errorCode: null, updatedAt: new Date() })
          .where(
            and(
              eq(workPageIllustrations.id, claimed.id),
              eq(workPageIllustrations.status, 'RUNNING'),
            ),
          );
        await tx.execute(sql`
          update picture_books pb
          set status = 'READY', updated_at = now()
          where pb.id = (
            select wp.picture_book_id from work_pages wp where wp.id = ${claimed.pageId}
          )
          and not exists (
            select 1 from work_pages page
            where page.picture_book_id = pb.id
              and not exists (
                select 1 from work_page_illustrations illustration
                where illustration.page_id = page.id and illustration.status = 'READY'
              )
          )
        `);
      });
    } catch (error) {
      const code =
        error instanceof ImageProviderError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'IMAGE_PROVIDER_TIMEOUT'
            : 'IMAGE_PROVIDER_UNAVAILABLE';
      await this.db
        .update(workPageIllustrations)
        .set({ status: 'FAILED', errorCode: code, updatedAt: new Date() })
        .where(
          and(
            eq(workPageIllustrations.id, claimed.id),
            eq(workPageIllustrations.status, 'RUNNING'),
          ),
        );
    }
    return claimed.id;
  }
}
