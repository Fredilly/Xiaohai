import Fastify from 'fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  animationEpisodes,
  animationSeries,
  consumerUsers,
  contentEntitlements,
  createDatabase,
  mediaAssets,
  permissions,
  playbackProgress,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
} from '@xiaohai/db';
import { ConsumerSessionService } from '../src/auth/session.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { CONTENT_MANAGE_PERMISSION, registerContentRoutes } from '../src/content/content-routes.js';
import { ContentService } from '../src/content/content-service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;

const consumerSessionSecret = 'content-consumer-session-secret-at-least-32-characters';
const staffSessionSecret = 'content-staff-session-secret-at-least-32-characters';
const storeId = '11111111-1111-4111-8111-111111111111';

testSuite('M7 content PostgreSQL integration and security', () => {
  const content = new ContentService(database!.db);
  let sequence = 0;

  const resetDatabase = async () => {
    await database!.pool.query(
      'TRUNCATE TABLE animation_series, media_assets, consumer_users, staff_accounts, roles, permissions CASCADE',
    );
  };

  beforeEach(resetDatabase);
  afterEach(resetDatabase);
  afterAll(async () => database?.pool.end());

  async function createUser() {
    const [user] = await database!.db
      .insert(consumerUsers)
      .values({})
      .returning({ id: consumerUsers.id });

    return user!.id;
  }

  async function createSeries(status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' = 'PUBLISHED') {
    const current = ++sequence;
    const [series] = await database!.db
      .insert(animationSeries)
      .values({
        slug: `series-${current}`,
        title: `Series ${current}`,
        description: `Description ${current}`,
        category: 'fairy-tale',
        status,
      })
      .returning();

    return series!;
  }

  async function createMedia() {
    const current = ++sequence;
    const [media] = await database!.db
      .insert(mediaAssets)
      .values({
        objectKey: `media-${current}.mp4`,
        playbackUrl: `https://media.example.test/${current}.mp4`,
        mimeType: 'video/mp4',
        durationSeconds: 600,
        status: 'READY',
      })
      .returning();

    return media!;
  }

  async function createEpisode(
    seriesId: string,
    accessMode: 'FREE' | 'PREVIEW' | 'PAID',
    episodeNumber: number,
    status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' = 'PUBLISHED',
    previewSeconds: number | null = null,
  ) {
    const media = await createMedia();
    const [episode] = await database!.db
      .insert(animationEpisodes)
      .values({
        seriesId,
        mediaAssetId: media.id,
        episodeNumber,
        title: `Episode ${episodeNumber}`,
        accessMode,
        previewSeconds,
        status,
      })
      .returning();

    return episode!;
  }

  it('only exposes published series and published episodes publicly', async () => {
    const published = await createSeries('PUBLISHED');
    const draft = await createSeries('DRAFT');
    const unpublished = await createSeries('UNPUBLISHED');

    const publishedEpisode = await createEpisode(published.id, 'FREE', 1, 'PUBLISHED');
    await createEpisode(published.id, 'FREE', 2, 'DRAFT');
    await createEpisode(draft.id, 'FREE', 1, 'PUBLISHED');
    await createEpisode(unpublished.id, 'FREE', 1, 'PUBLISHED');

    const list = await content.list();

    expect(list.series.map((series) => series.id)).toEqual([published.id]);

    const detail = await content.detail(published.id);

    expect(detail.episodes.map((episode) => episode.id)).toEqual([publishedEpisode.id]);

    await expect(content.detail(draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(content.detail(unpublished.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps paid playback locked unless the requesting consumer owns a valid entitlement', async () => {
    const series = await createSeries();
    const paidEpisode = await createEpisode(series.id, 'PAID', 1);
    const entitledUser = await createUser();
    const otherUser = await createUser();

    expect((await content.playback(null, paidEpisode.id)).access).toBe('LOCKED');
    expect((await content.playback(otherUser, paidEpisode.id)).access).toBe('LOCKED');

    await database!.db.insert(contentEntitlements).values({
      consumerUserId: entitledUser,
      seriesId: series.id,
      sourceType: 'ONE_TIME',
    });

    const entitledPlayback = await content.playback(entitledUser, paidEpisode.id);

    expect(entitledPlayback.access).toBe('FULL');
    expect(entitledPlayback.playbackUrl).not.toBeNull();

    expect((await content.playback(otherUser, paidEpisode.id)).access).toBe('LOCKED');
  });

  it('caps preview progress and refuses progress writes for locked paid content', async () => {
    const series = await createSeries();
    const previewEpisode = await createEpisode(series.id, 'PREVIEW', 1, 'PUBLISHED', 30);
    const paidEpisode = await createEpisode(series.id, 'PAID', 2);
    const userId = await createUser();

    const progress = await content.saveProgress(userId, previewEpisode.id, 120, true);

    expect(progress.positionSeconds).toBe(30);
    expect(progress.completed).toBe(false);

    const [stored] = await database!.db
      .select()
      .from(playbackProgress)
      .where(
        and(
          eq(playbackProgress.consumerUserId, userId),
          eq(playbackProgress.episodeId, previewEpisode.id),
        ),
      );

    expect(stored?.positionSeconds).toBe(30);
    expect(stored?.completed).toBe(false);

    await expect(content.saveProgress(userId, paidEpisode.id, 10, false)).rejects.toMatchObject({
      code: 'CONTENT_LOCKED',
    });

    const lockedRows = await database!.db
      .select()
      .from(playbackProgress)
      .where(
        and(
          eq(playbackProgress.consumerUserId, userId),
          eq(playbackProgress.episodeId, paidEpisode.id),
        ),
      );

    expect(lockedRows).toHaveLength(0);
  });

  it('requires both content.manage permission and GLOBAL scope for Staff content APIs', async () => {
    const staffSessions = new StaffSessionService(staffSessionSecret, 300);
    const staffAuthorization = new StaffAuthorizationService(
      new DrizzleStaffAuthorizationRepository(database!.db),
      staffSessions,
    );

    const app = Fastify({ logger: false });

    registerContentRoutes(app, {
      content,
      consumerSessions: new ConsumerSessionService(consumerSessionSecret, 300),
      staffAuthorization,
    });

    try {
      const [staff] = await database!.db
        .insert(staffAccounts)
        .values({
          loginIdentifier: 'content-manager@example.com',
          passwordHash: 'test-only-not-a-login-hash',
        })
        .returning({ id: staffAccounts.id });

      const token = staffSessions.issue(staff!.id).token;

      let response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/content',
      });

      expect(response.statusCode).toBe(401);

      const [permission] = await database!.db
        .insert(permissions)
        .values({
          key: CONTENT_MANAGE_PERMISSION,
          displayName: CONTENT_MANAGE_PERMISSION,
        })
        .returning({ id: permissions.id });

      const [role] = await database!.db
        .insert(roles)
        .values({
          key: 'content-manager',
          displayName: 'Content manager',
        })
        .returning({ id: roles.id });

      await database!.db.insert(rolePermissions).values({
        roleId: role!.id,
        permissionId: permission!.id,
      });

      await database!.db.insert(staffRoles).values({
        staffAccountId: staff!.id,
        roleId: role!.id,
      });

      await database!.db.insert(staffDataScopes).values({
        staffAccountId: staff!.id,
        scopeType: 'STORE',
        scopeId: storeId,
      });

      response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/content',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);

      await database!.db
        .delete(staffDataScopes)
        .where(eq(staffDataScopes.staffAccountId, staff!.id));

      await database!.db.insert(staffDataScopes).values({
        staffAccountId: staff!.id,
        scopeType: 'GLOBAL',
        scopeId: null,
      });

      response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/content',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);

      await database!.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.permissionId, permission!.id));

      response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/content',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
