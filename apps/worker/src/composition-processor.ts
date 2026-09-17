import { and, asc, desc, eq } from 'drizzle-orm';
import {
  aiAnimations,
  animationCompositionInputs,
  animationCompositions,
  animationSceneGenerations,
  mediaAssets,
  type createDatabase,
} from '@xiaohai/db';
import type { CompositionProvider } from './composition-provider.js';
import { CompositionProviderError } from './composition-provider.js';

type Db = ReturnType<typeof createDatabase>['db'];
export class CompositionProcessor {
  constructor(
    private readonly db: Db,
    private readonly provider: CompositionProvider,
    private readonly timeoutMs: number,
  ) {}
  async processOne(): Promise<string | null> {
    const claimed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(animationCompositions)
        .where(eq(animationCompositions.status, 'QUEUED'))
        .orderBy(asc(animationCompositions.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      const [updated] = await tx
        .update(animationCompositions)
        .set({
          status: 'RUNNING',
          progressPercent: 5,
          errorCode: null,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(animationCompositions.id, row.id), eq(animationCompositions.status, 'QUEUED')),
        )
        .returning();
      return updated ?? null;
    });
    if (!claimed) return null;
    try {
      const inputs = await this.db
        .select({
          sceneGenerationId: animationCompositionInputs.sceneGenerationId,
          sceneOrder: animationCompositionInputs.sceneOrder,
          generationStatus: animationSceneGenerations.status,
          playbackUrl: mediaAssets.playbackUrl,
          mimeType: mediaAssets.mimeType,
          durationSeconds: mediaAssets.durationSeconds,
        })
        .from(animationCompositionInputs)
        .innerJoin(
          animationSceneGenerations,
          eq(animationSceneGenerations.id, animationCompositionInputs.sceneGenerationId),
        )
        .innerJoin(mediaAssets, eq(mediaAssets.id, animationSceneGenerations.mediaAssetId))
        .where(eq(animationCompositionInputs.compositionId, claimed.id))
        .orderBy(asc(animationCompositionInputs.sceneOrder));
      if (
        !inputs.length ||
        inputs.some((input) => input.generationStatus !== 'READY' || !input.playbackUrl)
      )
        throw new CompositionProviderError('COMPOSITION_PROVIDER_INVALID_OUTPUT');
      const result = await this.provider.compose({
        compositionId: claimed.id,
        scenes: inputs.map((input) => ({ ...input, playbackUrl: input.playbackUrl! })),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (
        !result.storageProvider.trim() ||
        !result.objectKey.trim() ||
        !result.playbackUrl.startsWith('https://') ||
        result.playbackUrl.startsWith('data:') ||
        result.mimeType !== 'video/mp4' ||
        !Number.isFinite(result.durationSeconds) ||
        result.durationSeconds < 0
      ) {
        throw new CompositionProviderError('COMPOSITION_PROVIDER_INVALID_OUTPUT');
      }
      await this.db.transaction(async (tx) => {
        const [animation] = await tx
          .select({ id: aiAnimations.id })
          .from(aiAnimations)
          .where(eq(aiAnimations.id, claimed.animationId))
          .for('update');
        if (!animation) return;
        const [current] = await tx
          .select()
          .from(animationCompositions)
          .where(eq(animationCompositions.id, claimed.id))
          .for('update');
        if (current?.status !== 'RUNNING') return;
        const [asset] = await tx
          .insert(mediaAssets)
          .values({
            provider: result.storageProvider,
            objectKey: result.objectKey,
            playbackUrl: result.playbackUrl,
            mimeType: result.mimeType,
            byteSize: result.byteSize,
            durationSeconds: result.durationSeconds,
            status: 'READY',
          })
          .onConflictDoUpdate({
            target: [mediaAssets.provider, mediaAssets.objectKey],
            set: {
              playbackUrl: result.playbackUrl,
              durationSeconds: result.durationSeconds,
              updatedAt: new Date(),
            },
          })
          .returning({ id: mediaAssets.id });
        await tx
          .update(animationCompositions)
          .set({
            status: 'READY',
            progressPercent: 100,
            mediaAssetId: asset!.id,
            errorCode: null,
            usage: { durationSeconds: result.durationSeconds },
            costMetadata: {
              source: this.provider.name,
              providerRequestId: result.providerRequestId,
              costUnits: inputs.length,
            },
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(animationCompositions.id, claimed.id),
              eq(animationCompositions.status, 'RUNNING'),
            ),
          );
        const [latest] = await tx
          .select({ revisionNumber: animationCompositions.revisionNumber })
          .from(animationCompositions)
          .where(eq(animationCompositions.animationId, claimed.animationId))
          .orderBy(desc(animationCompositions.revisionNumber))
          .limit(1);
        if (latest?.revisionNumber === claimed.revisionNumber)
          await tx
            .update(aiAnimations)
            .set({ status: 'READY', finalMediaAssetId: asset!.id, updatedAt: new Date() })
            .where(eq(aiAnimations.id, claimed.animationId));
      });
    } catch (error) {
      const code =
        error instanceof CompositionProviderError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'COMPOSITION_PROVIDER_TIMEOUT'
            : 'COMPOSITION_PROVIDER_UNAVAILABLE';
      await this.db.transaction(async (tx) => {
        const [animation] = await tx
          .select({ id: aiAnimations.id })
          .from(aiAnimations)
          .where(eq(aiAnimations.id, claimed.animationId))
          .for('update');
        if (!animation) return;
        const [failed] = await tx
          .update(animationCompositions)
          .set({
            status: 'FAILED',
            errorCode: code,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(animationCompositions.id, claimed.id),
              eq(animationCompositions.status, 'RUNNING'),
            ),
          )
          .returning({ revisionNumber: animationCompositions.revisionNumber });
        if (!failed) return;
        const [latest] = await tx
          .select({ revisionNumber: animationCompositions.revisionNumber })
          .from(animationCompositions)
          .where(eq(animationCompositions.animationId, claimed.animationId))
          .orderBy(desc(animationCompositions.revisionNumber))
          .limit(1);
        if (latest?.revisionNumber === failed.revisionNumber) {
          await tx
            .update(aiAnimations)
            .set({ status: 'GENERATING', updatedAt: new Date() })
            .where(
              and(eq(aiAnimations.id, claimed.animationId), eq(aiAnimations.status, 'COMPOSING')),
            );
        }
      });
    }
    return claimed.id;
  }
}
