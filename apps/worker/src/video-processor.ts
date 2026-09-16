import { and, asc, eq } from 'drizzle-orm';
import {
  animationCharacters,
  animationSceneGenerations,
  animationScenes,
  mediaAssets,
  type createDatabase,
} from '@xiaohai/db';
import type { VideoProvider } from './video-provider.js';
import { VideoProviderError } from './video-provider.js';

type Db = ReturnType<typeof createDatabase>['db'];

export class VideoJobProcessor {
  constructor(
    private readonly db: Db,
    private readonly provider: VideoProvider,
    private readonly timeoutMs: number,
  ) {}

  async processOne(): Promise<string | null> {
    const claimed = await this.db.transaction(async (tx) => {
      const [generation] = await tx
        .select()
        .from(animationSceneGenerations)
        .where(
          and(
            eq(animationSceneGenerations.status, 'QUEUED'),
            eq(animationSceneGenerations.provider, this.provider.name),
          ),
        )
        .orderBy(asc(animationSceneGenerations.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!generation) return null;

      const [updated] = await tx
        .update(animationSceneGenerations)
        .set({
          status: 'RUNNING',
          progressPercent: 5,
          errorCode: null,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(animationSceneGenerations.id, generation.id),
            eq(animationSceneGenerations.status, 'QUEUED'),
          ),
        )
        .returning();

      return updated ?? null;
    });

    if (!claimed) return null;

    try {
      const [scene] = await this.db
        .select()
        .from(animationScenes)
        .where(
          and(
            eq(animationScenes.id, claimed.sceneId),
            eq(animationScenes.animationId, claimed.animationId),
          ),
        )
        .limit(1);

      if (!scene) {
        throw new VideoProviderError('VIDEO_PROVIDER_INVALID_OUTPUT');
      }

      const characters = await this.db
        .select()
        .from(animationCharacters)
        .where(eq(animationCharacters.animationId, claimed.animationId))
        .orderBy(asc(animationCharacters.sortOrder));

      const result = await this.provider.generate({
        generationKey: claimed.id,
        model: claimed.model,
        prompt: scene.generationPrompt,
        plannedDurationMs: scene.plannedDurationMs,
        consistency: characters.map((character) => ({
          consistencyKey: character.consistencyKey,
          visualPrompt: character.visualPrompt,
          referenceMediaAssetId: character.referenceMediaAssetId,
        })),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ status: animationSceneGenerations.status })
          .from(animationSceneGenerations)
          .where(eq(animationSceneGenerations.id, claimed.id))
          .for('update');

        if (current?.status !== 'RUNNING') return;

        const [asset] = await tx
          .insert(mediaAssets)
          .values({
            provider: 'MOCK_VIDEO',
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
          .update(animationSceneGenerations)
          .set({
            status: 'READY',
            progressPercent: 100,
            mediaAssetId: asset!.id,
            errorCode: null,
            usage: {
              durationSeconds: result.durationSeconds,
            },
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(animationSceneGenerations.id, claimed.id),
              eq(animationSceneGenerations.status, 'RUNNING'),
            ),
          );
      });
    } catch (error) {
      const code =
        error instanceof VideoProviderError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'VIDEO_PROVIDER_TIMEOUT'
            : 'VIDEO_PROVIDER_UNAVAILABLE';

      await this.db
        .update(animationSceneGenerations)
        .set({
          status: 'FAILED',
          errorCode: code,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(animationSceneGenerations.id, claimed.id),
            eq(animationSceneGenerations.status, 'RUNNING'),
          ),
        );
    }

    return claimed.id;
  }
}
