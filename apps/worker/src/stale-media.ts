import { and, eq, lt } from 'drizzle-orm';
import {
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
  const cutoff = (timeoutMs: number) => new Date(now - timeoutMs - 60_000);
  const images = await db
    .update(workPageIllustrations)
    .set({ status: 'FAILED', errorCode: 'IMAGE_WORKER_TIMEOUT', updatedAt: new Date(now) })
    .where(
      and(
        eq(workPageIllustrations.status, 'RUNNING'),
        lt(workPageIllustrations.updatedAt, cutoff(timeouts.imageMs)),
      ),
    )
    .returning({ id: workPageIllustrations.id });
  const videos = await db
    .update(animationSceneGenerations)
    .set({ status: 'FAILED', errorCode: 'VIDEO_WORKER_TIMEOUT', updatedAt: new Date(now) })
    .where(
      and(
        eq(animationSceneGenerations.status, 'RUNNING'),
        lt(animationSceneGenerations.startedAt, cutoff(timeouts.videoMs)),
      ),
    )
    .returning({ id: animationSceneGenerations.id });
  const compositions = await db
    .update(animationCompositions)
    .set({ status: 'FAILED', errorCode: 'COMPOSITION_WORKER_TIMEOUT', updatedAt: new Date(now) })
    .where(
      and(
        eq(animationCompositions.status, 'RUNNING'),
        lt(animationCompositions.startedAt, cutoff(timeouts.compositionMs)),
      ),
    )
    .returning({ id: animationCompositions.id });
  return { images: images.length, videos: videos.length, compositions: compositions.length };
}
