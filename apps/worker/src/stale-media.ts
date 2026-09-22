import { and, desc, eq, lt } from 'drizzle-orm';
import {
  aiAnimations,
  animationCompositions,
  animationSceneGenerations,
  workPageIllustrations,
  type createDatabase,
} from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];

// Mark orphaned work terminal after its provider deadline plus restart grace.
// Completion updates guard RUNNING, so a late provider response cannot publish an orphaned result.
export async function recoverStaleMedia(
  db: Db,
  timeouts: { imageMs: number; videoMs: number; compositionMs: number },
  now = Date.now(),
) {
  const recoveredAt = new Date(now);
  const cutoff = (timeoutMs: number) => new Date(now - timeoutMs - 60_000);
  const images = await db
    .update(workPageIllustrations)
    .set({ status: 'FAILED', errorCode: 'IMAGE_WORKER_TIMEOUT', updatedAt: recoveredAt })
    .where(
      and(
        eq(workPageIllustrations.status, 'RUNNING'),
        lt(workPageIllustrations.updatedAt, cutoff(timeouts.imageMs)),
      ),
    )
    .returning({ id: workPageIllustrations.id });
  const videos = await db
    .update(animationSceneGenerations)
    .set({ status: 'FAILED', errorCode: 'VIDEO_WORKER_TIMEOUT', updatedAt: recoveredAt })
    .where(
      and(
        eq(animationSceneGenerations.status, 'RUNNING'),
        lt(animationSceneGenerations.startedAt, cutoff(timeouts.videoMs)),
      ),
    )
    .returning({ id: animationSceneGenerations.id });

  const compositions = await db.transaction(async (tx) => {
    const stale = await tx
      .select({
        id: animationCompositions.id,
        animationId: animationCompositions.animationId,
      })
      .from(animationCompositions)
      .where(
        and(
          eq(animationCompositions.status, 'RUNNING'),
          lt(animationCompositions.startedAt, cutoff(timeouts.compositionMs)),
        ),
      )
      .for('update', { skipLocked: true });

    let recovered = 0;
    for (const composition of stale) {
      const [animation] = await tx
        .select({ id: aiAnimations.id })
        .from(aiAnimations)
        .where(eq(aiAnimations.id, composition.animationId))
        .for('update');
      if (!animation) continue;

      const [failed] = await tx
        .update(animationCompositions)
        .set({
          status: 'FAILED',
          errorCode: 'COMPOSITION_WORKER_TIMEOUT',
          completedAt: recoveredAt,
          updatedAt: recoveredAt,
        })
        .where(
          and(
            eq(animationCompositions.id, composition.id),
            eq(animationCompositions.status, 'RUNNING'),
          ),
        )
        .returning({ revisionNumber: animationCompositions.revisionNumber });
      if (!failed) continue;
      recovered += 1;

      const [latest] = await tx
        .select({ revisionNumber: animationCompositions.revisionNumber })
        .from(animationCompositions)
        .where(eq(animationCompositions.animationId, composition.animationId))
        .orderBy(desc(animationCompositions.revisionNumber))
        .limit(1);
      if (latest?.revisionNumber === failed.revisionNumber) {
        await tx
          .update(aiAnimations)
          .set({ status: 'GENERATING', updatedAt: recoveredAt })
          .where(
            and(
              eq(aiAnimations.id, composition.animationId),
              eq(aiAnimations.status, 'COMPOSING'),
            ),
          );
      }
    }
    return recovered;
  });

  return { images: images.length, videos: videos.length, compositions };
}
