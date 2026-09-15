import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  animationEpisodes,
  animationSeries,
  contentEntitlements,
  mediaAssets,
  playbackProgress,
  type createDatabase,
} from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];
export class ContentError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CONTENT_LOCKED' | 'MEDIA_UNAVAILABLE') {
    super(code);
  }
}
export class ContentService {
  constructor(private readonly db: Db) {}
  async list(q?: string, category?: string) {
    const filters = [eq(animationSeries.status, 'PUBLISHED')];
    if (category) filters.push(eq(animationSeries.category, category));
    if (q)
      filters.push(
        or(ilike(animationSeries.title, `%${q}%`), ilike(animationSeries.description, `%${q}%`))!,
      );
    const rows = await this.db
      .select()
      .from(animationSeries)
      .where(and(...filters))
      .orderBy(animationSeries.title);
    return { series: rows.map(summary) };
  }
  async detail(id: string) {
    const [series] = await this.db
      .select()
      .from(animationSeries)
      .where(and(eq(animationSeries.id, id), eq(animationSeries.status, 'PUBLISHED')))
      .limit(1);
    if (!series) throw new ContentError('NOT_FOUND');
    const episodes = await this.db
      .select({ episode: animationEpisodes, durationSeconds: mediaAssets.durationSeconds })
      .from(animationEpisodes)
      .leftJoin(mediaAssets, eq(animationEpisodes.mediaAssetId, mediaAssets.id))
      .where(and(eq(animationEpisodes.seriesId, id), eq(animationEpisodes.status, 'PUBLISHED')))
      .orderBy(animationEpisodes.episodeNumber);
    const recs = await this.db
      .select()
      .from(animationSeries)
      .where(
        and(
          eq(animationSeries.status, 'PUBLISHED'),
          eq(animationSeries.category, series.category),
          sql`${animationSeries.id} <> ${id}`,
        ),
      )
      .limit(6);
    return {
      ...summary(series),
      episodes: episodes.map(({ episode, durationSeconds }) => ({
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        description: episode.description,
        accessMode: episode.accessMode,
        previewSeconds: episode.previewSeconds,
        durationSeconds,
      })),
      recommendations: recs.map(summary),
    };
  }
  async playback(consumerUserId: string | null, episodeId: string) {
    const [row] = await this.db
      .select({ episode: animationEpisodes, media: mediaAssets })
      .from(animationEpisodes)
      .innerJoin(animationSeries, eq(animationEpisodes.seriesId, animationSeries.id))
      .leftJoin(mediaAssets, eq(animationEpisodes.mediaAssetId, mediaAssets.id))
      .where(
        and(
          eq(animationEpisodes.id, episodeId),
          eq(animationEpisodes.status, 'PUBLISHED'),
          eq(animationSeries.status, 'PUBLISHED'),
        ),
      )
      .limit(1);
    if (!row) throw new ContentError('NOT_FOUND');
    let entitled = false;
    if (consumerUserId) {
      const [grant] = await this.db
        .select({ id: contentEntitlements.id })
        .from(contentEntitlements)
        .where(
          and(
            eq(contentEntitlements.consumerUserId, consumerUserId),
            eq(contentEntitlements.seriesId, row.episode.seriesId),
            isNull(contentEntitlements.revokedAt),
            or(
              isNull(contentEntitlements.expiresAt),
              sql`${contentEntitlements.expiresAt} > now()`,
            ),
          ),
        )
        .limit(1);
      entitled = Boolean(grant);
    }
    const access =
      row.episode.accessMode === 'FREE' || entitled
        ? 'FULL'
        : row.episode.accessMode === 'PREVIEW'
          ? 'PREVIEW'
          : 'LOCKED';
    if (access === 'LOCKED')
      return {
        episodeId,
        access,
        playbackUrl: null,
        previewSeconds: null,
        resumePositionSeconds: 0,
      };
    if (!row.media || row.media.status !== 'READY' || !row.media.playbackUrl)
      throw new ContentError('MEDIA_UNAVAILABLE');
    let resumePositionSeconds = 0;
    if (consumerUserId) {
      const [p] = await this.db
        .select()
        .from(playbackProgress)
        .where(
          and(
            eq(playbackProgress.consumerUserId, consumerUserId),
            eq(playbackProgress.episodeId, episodeId),
          ),
        )
        .limit(1);
      resumePositionSeconds = p?.positionSeconds ?? 0;
    }
    return {
      episodeId,
      access,
      playbackUrl: row.media.playbackUrl,
      previewSeconds: access === 'PREVIEW' ? row.episode.previewSeconds : null,
      resumePositionSeconds,
    };
  }
  async saveProgress(
    consumerUserId: string,
    episodeId: string,
    positionSeconds: number,
    completed: boolean,
  ) {
    const access = await this.playback(consumerUserId, episodeId);
    if (access.access === 'LOCKED') throw new ContentError('CONTENT_LOCKED');
    const capped =
      access.access === 'PREVIEW' && access.previewSeconds
        ? Math.min(positionSeconds, access.previewSeconds)
        : positionSeconds;
    const [row] = await this.db
      .insert(playbackProgress)
      .values({
        consumerUserId,
        episodeId,
        positionSeconds: capped,
        completed: access.access === 'FULL' && completed,
      })
      .onConflictDoUpdate({
        target: [playbackProgress.consumerUserId, playbackProgress.episodeId],
        set: {
          positionSeconds: capped,
          completed: access.access === 'FULL' && completed,
          updatedAt: new Date(),
        },
      })
      .returning();
    return {
      episodeId: row!.episodeId,
      positionSeconds: row!.positionSeconds,
      completed: row!.completed,
      updatedAt: row!.updatedAt.toISOString(),
    };
  }
  async continueWatching(consumerUserId: string) {
    const rows = await this.db
      .select({
        progress: playbackProgress,
        episode: animationEpisodes,
        series: animationSeries,
        durationSeconds: mediaAssets.durationSeconds,
      })
      .from(playbackProgress)
      .innerJoin(animationEpisodes, eq(playbackProgress.episodeId, animationEpisodes.id))
      .innerJoin(animationSeries, eq(animationEpisodes.seriesId, animationSeries.id))
      .leftJoin(mediaAssets, eq(animationEpisodes.mediaAssetId, mediaAssets.id))
      .where(
        and(
          eq(playbackProgress.consumerUserId, consumerUserId),
          eq(playbackProgress.completed, false),
          eq(animationEpisodes.status, 'PUBLISHED'),
          eq(animationSeries.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(playbackProgress.updatedAt))
      .limit(20);
    return {
      items: rows.map((r) => ({
        series: summary(r.series),
        episode: {
          id: r.episode.id,
          episodeNumber: r.episode.episodeNumber,
          title: r.episode.title,
          description: r.episode.description,
          accessMode: r.episode.accessMode,
          previewSeconds: r.episode.previewSeconds,
          durationSeconds: r.durationSeconds,
        },
        progress: {
          episodeId: r.episode.id,
          positionSeconds: r.progress.positionSeconds,
          completed: r.progress.completed,
          updatedAt: r.progress.updatedAt.toISOString(),
        },
      })),
    };
  }
  async entitlements(consumerUserId: string) {
    const rows = await this.db
      .select({ grant: contentEntitlements, series: animationSeries })
      .from(contentEntitlements)
      .innerJoin(animationSeries, eq(contentEntitlements.seriesId, animationSeries.id))
      .where(
        and(
          eq(contentEntitlements.consumerUserId, consumerUserId),
          isNull(contentEntitlements.revokedAt),
          eq(animationSeries.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(contentEntitlements.grantedAt));
    return {
      series: rows.map((r) => ({
        ...summary(r.series),
        grantedAt: r.grant.grantedAt.toISOString(),
      })),
    };
  }
  async adminList() {
    return {
      series: await this.db.select().from(animationSeries).orderBy(desc(animationSeries.updatedAt)),
      media: await this.db.select().from(mediaAssets).orderBy(desc(mediaAssets.updatedAt)),
    };
  }
  async createSeries(input: typeof animationSeries.$inferInsert) {
    const [r] = await this.db.insert(animationSeries).values(input).returning();
    return r!;
  }
  async updateSeries(id: string, input: Partial<typeof animationSeries.$inferInsert>) {
    const [r] = await this.db
      .update(animationSeries)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(animationSeries.id, id))
      .returning();
    if (!r) throw new ContentError('NOT_FOUND');
    return r;
  }
  async createEpisode(input: typeof animationEpisodes.$inferInsert) {
    const [r] = await this.db.insert(animationEpisodes).values(input).returning();
    return r!;
  }
  async createMedia(input: typeof mediaAssets.$inferInsert) {
    const [r] = await this.db.insert(mediaAssets).values(input).returning();
    return r!;
  }
}
function summary(row: typeof animationSeries.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    coverUrl: row.coverUrl,
  };
}
