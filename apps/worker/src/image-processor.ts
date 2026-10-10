import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  characterProfiles,
  characterReferenceImages,
  mediaAssets,
  workPageIllustrations,
  type createDatabase,
} from '@xiaohai/db';
import type { ImageProvider } from './image-provider.js';
import { ImageProviderError } from './image-provider.js';

type Db = ReturnType<typeof createDatabase>['db'];
type ImageLogger = { error: (fields: Record<string, unknown>, message: string) => void };
type IllustrationInputRow = {
  id: string;
  model: string;
  provider: string;
  prompt: string;
  pageId: string;
  consistency: Array<{
    referenceMediaAssetId: string | null;
    consistencyKey: string;
    visualPrompt: string;
  }>;
};

export class ImageJobProcessor {
  constructor(
    private readonly db: Db,
    private readonly provider: ImageProvider,
    private readonly timeoutMs: number,
    private readonly logger?: ImageLogger,
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
      if (!illustration) {
        const [reference] = await tx
          .select({ reference: characterReferenceImages, character: characterProfiles })
          .from(characterReferenceImages)
          .innerJoin(
            characterProfiles,
            eq(characterProfiles.id, characterReferenceImages.characterProfileId),
          )
          .where(
            and(
              eq(characterReferenceImages.status, 'QUEUED'),
              eq(characterReferenceImages.provider, this.provider.name),
            ),
          )
          .orderBy(asc(characterReferenceImages.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!reference) return null;
        const [updated] = await tx
          .update(characterReferenceImages)
          .set({ status: 'RUNNING', errorCode: null, updatedAt: new Date() })
          .where(
            and(
              eq(characterReferenceImages.id, reference.reference.id),
              eq(characterReferenceImages.status, 'QUEUED'),
            ),
          )
          .returning();
        return updated
          ? {
              kind: 'REFERENCE' as const,
              row: { ...updated, prompt: reference.character.visualPrompt },
            }
          : null;
      }
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
      return updated ? { kind: 'ILLUSTRATION' as const, row: updated } : null;
    });
    if (!claimed) return null;
    const row = claimed.row;
    const isReference = claimed.kind === 'REFERENCE';
    const illustrationRow = isReference ? null : (row as IllustrationInputRow);

    const generationStartedAt = Date.now();
    const effectiveTimeoutMs = Math.max(this.timeoutMs, 600_000);
    try {
      // MOCK uses consistency metadata only. Never pass its local display URL
      // to an image provider as an I2I input. BAILIAN keeps strict HTTPS checks.
      const referenceUrls =
        illustrationRow && this.provider.name === 'BAILIAN'
          ? await this.referenceUrls(illustrationRow.consistency)
          : [];
      const result = await this.provider.generate({
        generationKey: row.id,
        model: row.model,
        prompt: illustrationRow ? illustrationRow.prompt : (row as { prompt: string }).prompt,
        consistency: illustrationRow ? illustrationRow.consistency : [],
        referenceImages: referenceUrls,
        signal: AbortSignal.timeout(effectiveTimeoutMs),
      });
      try {
        await this.db.transaction(async (tx) => {
          const [current] = isReference
            ? await tx
                .select({ status: characterReferenceImages.status })
                .from(characterReferenceImages)
                .where(eq(characterReferenceImages.id, row.id))
                .for('update')
            : await tx
                .select({ status: workPageIllustrations.status })
                .from(workPageIllustrations)
                .where(eq(workPageIllustrations.id, row.id))
                .for('update');
          if (current?.status !== 'RUNNING') return;
          const [asset] = await tx
            .insert(mediaAssets)
            .values({
              provider: result.assetProvider,
              objectKey: result.objectKey,
              playbackUrl: result.playbackUrl,
              mimeType: result.mimeType,
              byteSize: result.byteSize,
              status: 'READY',
            })
            .onConflictDoUpdate({
              target: [mediaAssets.provider, mediaAssets.objectKey],
              set: {
                playbackUrl: result.playbackUrl,
                mimeType: result.mimeType,
                byteSize: result.byteSize,
                status: 'READY',
                updatedAt: new Date(),
              },
            })
            .returning({ id: mediaAssets.id });
          const table = isReference ? characterReferenceImages : workPageIllustrations;
          await tx
            .update(table)
            .set({
              status: 'READY',
              mediaAssetId: asset!.id,
              ...(isReference ? { providerRequestId: result.providerRequestId } : {}),
              errorCode: null,
              updatedAt: new Date(),
            })
            .where(and(eq(table.id, row.id), eq(table.status, 'RUNNING')));
          if (!isReference)
            await tx.execute(sql`
          update picture_books pb
          set status = 'READY', updated_at = now()
          where pb.id = (
            select wp.picture_book_id from work_pages wp where wp.id = ${illustrationRow?.pageId}
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
        throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
          stage: 'DB_READY_WRITEBACK',
          safeMessage: sanitizeErrorMessage(error),
        });
      }
    } catch (error) {
      const code =
        error instanceof ImageProviderError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'IMAGE_PROVIDER_TIMEOUT'
            : 'IMAGE_PROVIDER_UNAVAILABLE';
      const details = error instanceof ImageProviderError ? error.details : {};
      this.logger?.error(
        {
          imageJobId: row.id,
          elapsedMs: Date.now() - generationStartedAt,
          configuredTimeoutMs: this.timeoutMs,
          effectiveTimeoutMs,
          illustrationId: isReference ? undefined : row.id,
          provider: row.provider,
          model: row.model,
          stage: details.stage ?? 'BAILIAN_REQUEST',
          errorCode: code,
          httpStatus: details.httpStatus,
          providerErrorCode: details.providerErrorCode,
          validationCode: details.validationCode,
          safeMessage: details.safeMessage,
          providerRequestId: details.providerRequestId,
        },
        'Picture book image generation failed',
      );
      await this.db
        .update(isReference ? characterReferenceImages : workPageIllustrations)
        .set({ status: 'FAILED', errorCode: code, updatedAt: new Date() })
        .where(
          and(
            eq((isReference ? characterReferenceImages : workPageIllustrations).id, row.id),
            eq((isReference ? characterReferenceImages : workPageIllustrations).status, 'RUNNING'),
          ),
        );
    }
    return row.id;
  }

  private async referenceUrls(consistency: Array<{ referenceMediaAssetId: string | null }>) {
    const ids = consistency
      .map((item) => item.referenceMediaAssetId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];
    if (ids.length > 3)
      throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', { stage: 'VALIDATION' });
    const rows = await this.db
      .select({
        id: mediaAssets.id,
        provider: mediaAssets.provider,
        url: mediaAssets.playbackUrl,
        status: mediaAssets.status,
      })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, ids));
    const realReferenceRows = rows.filter((row) => row.provider === 'BAIDU_BOS');
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) =>
          row.status !== 'READY' ||
          (row.provider !== 'MOCK_IMAGE' &&
            (row.provider !== 'BAIDU_BOS' || !row.url || !row.url.startsWith('https://'))),
      )
    )
      throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
        stage: 'VALIDATION',
        validationCode: 'INVALID_REFERENCE_ASSET',
      });
    return ids
      .map((id) => realReferenceRows.find((row) => row.id === id)?.url)
      .filter((url): url is string => Boolean(url));
  }
}

const sanitizeErrorMessage = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) return undefined;
  return error.message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?key|secret|ak|sk|signature|token)["'=:\s]+)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 256);
};
