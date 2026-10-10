import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  characterProfiles,
  characterReferenceImages,
  aiBudgetWindows,
  aiCostLedger,
  aiCostReservations,
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
    let providerInvoked = false;
    try {
      if (this.provider.name === 'BAILIAN') {
        const [reservation] = await this.db
          .select({
            status: aiCostReservations.status,
            uncertainty: aiCostReservations.uncertainty,
          })
          .from(aiCostReservations)
          .where(
            and(
              eq(aiCostReservations.resourceId, row.id),
              eq(aiCostReservations.resourceType, 'PICTURE_BOOK_IMAGE'),
            ),
          )
          .orderBy(sql`${aiCostReservations.createdAt} desc`)
          .limit(1);
        if (
          !reservation ||
          reservation.status !== 'RESERVED' ||
          reservation.uncertainty !== 'NONE'
        ) {
          throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', {
            stage: 'BUDGET_VALIDATION',
            validationCode: 'AI_BUDGET_RESERVATION_REQUIRED',
          });
        }
      }
      // MOCK uses consistency metadata only. Never pass its local display URL
      // to an image provider as an I2I input. BAILIAN keeps strict HTTPS checks.
      const referenceUrls =
        illustrationRow && this.provider.name === 'BAILIAN'
          ? await this.referenceUrls(illustrationRow.consistency)
          : [];
      providerInvoked = true;
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
          and exists (
            select 1 from work_pages page where page.picture_book_id = pb.id
          )
          and not exists (
            select 1 from work_pages page
            where page.picture_book_id = pb.id
              and not exists (
                select 1 from work_page_illustrations illustration
                join media_assets media on media.id = illustration.media_asset_id
                where illustration.page_id = page.id
                  and illustration.status = 'READY'
                  and illustration.provider = 'BAILIAN'
                  and media.status = 'READY'
                  and media.provider = 'BAIDU_BOS'
                  and media.mime_type like 'image/%'
                  and media.playback_url ~* '^https://[^/?#]+/[^?#]+[.](png|jpg|jpeg|webp|gif)([?][^#]*)?$'
              )
          )
        `);
        });
        await this.recordBudgetOutcome(row.id, 'AT_RISK', null, result.providerRequestId);
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
      await this.recordBudgetOutcome(
        row.id,
        providerInvoked ? (code === 'IMAGE_PROVIDER_TIMEOUT' ? 'TIMED_OUT' : 'AT_RISK') : 'FAILED',
        providerInvoked ? null : 0,
        details.providerRequestId,
        code,
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

  private async recordBudgetOutcome(
    resourceId: string,
    outcome: 'FAILED' | 'TIMED_OUT' | 'AT_RISK',
    actualMinor: number | null,
    providerRequestId?: string,
    failureCode?: string,
  ) {
    await this.db.transaction(async (tx) => {
      const [reservation] = await tx
        .select()
        .from(aiCostReservations)
        .where(
          and(
            eq(aiCostReservations.resourceId, resourceId),
            eq(aiCostReservations.resourceType, 'PICTURE_BOOK_IMAGE'),
          ),
        )
        .for('update');
      if (
        !reservation ||
        reservation.status !== 'RESERVED' ||
        reservation.uncertainty === 'AT_RISK'
      )
        return;
      const uncertain = outcome === 'AT_RISK' || actualMinor === null;
      await tx.insert(aiCostLedger).values({
        reservationId: reservation.id,
        consumerUserId: reservation.consumerUserId,
        resourceType: reservation.resourceType,
        resourceId: reservation.resourceId,
        provider: reservation.provider,
        model: reservation.model,
        amountMinor: actualMinor ?? reservation.reservedMinor,
        outcome,
        providerRequestId,
        failureCode,
      });
      await tx
        .update(aiCostReservations)
        .set({
          status: uncertain ? 'RESERVED' : 'SETTLED',
          uncertainty: uncertain ? 'AT_RISK' : 'NONE',
          actualMinor,
          providerRequestId,
          failureCode,
          settledAt: uncertain ? null : new Date(),
        })
        .where(eq(aiCostReservations.id, reservation.id));
      if (!uncertain) {
        const windows = await tx
          .select()
          .from(aiBudgetWindows)
          .where(
            and(
              eq(aiBudgetWindows.budgetKey, reservation.budgetKey),
              eq(aiBudgetWindows.windowKey, reservation.windowKey),
              or(
                and(
                  eq(aiBudgetWindows.scopeType, 'GLOBAL'),
                  isNull(aiBudgetWindows.consumerUserId),
                ),
                and(
                  eq(aiBudgetWindows.scopeType, 'CONSUMER'),
                  eq(aiBudgetWindows.consumerUserId, reservation.consumerUserId!),
                ),
              ),
            ),
          )
          .for('update');
        if (
          windows.length !== 2 ||
          windows.filter((window) => window.scopeType === 'GLOBAL').length !== 1 ||
          windows.filter(
            (window) =>
              window.scopeType === 'CONSUMER' &&
              window.consumerUserId === reservation.consumerUserId,
          ).length !== 1 ||
          windows.some((window) => window.reservedMinor < reservation.reservedMinor)
        ) {
          throw new Error('AI_BUDGET_WINDOW_INVALID');
        }
        for (const window of windows) {
          await tx
            .update(aiBudgetWindows)
            .set({
              reservedMinor: window.reservedMinor - reservation.reservedMinor,
              actualMinor: window.actualMinor + (actualMinor ?? 0),
              updatedAt: new Date(),
            })
            .where(eq(aiBudgetWindows.id, window.id));
        }
      }
    });
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
      rows.some((row) => row.provider !== 'MOCK_IMAGE' && row.provider !== 'BAIDU_BOS') ||
      realReferenceRows.some(
        (row) => row.status !== 'READY' || !row.url || !row.url.startsWith('https://'),
      )
    )
      throw new ImageProviderError('IMAGE_PROVIDER_UNAVAILABLE', { stage: 'VALIDATION' });
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
