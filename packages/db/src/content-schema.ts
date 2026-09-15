import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { consumerUsers } from './schema.js';

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull().default('EXTERNAL'),
  objectKey: text('object_key').notNull(),
  playbackUrl: text('playback_url'),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size'),
  durationSeconds: integer('duration_seconds'),
  status: text('status').notNull().default('READY'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('media_assets_provider_object_unique').on(t.provider, t.objectKey), check('media_assets_status_check', sql`${t.status} in ('PENDING','READY','DISABLED')`), check('media_assets_size_check', sql`${t.byteSize} is null or ${t.byteSize} >= 0`), check('media_assets_duration_check', sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`)]);

export const animationSeries = pgTable('animation_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(), title: text('title').notNull(), description: text('description'), category: text('category').notNull(), coverUrl: text('cover_url'), status: text('status').notNull().default('DRAFT'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('animation_series_slug_unique').on(t.slug), index('animation_series_public_idx').on(t.status, t.category, t.title), check('animation_series_status_check', sql`${t.status} in ('DRAFT','PUBLISHED','UNPUBLISHED')`)]);

export const animationEpisodes = pgTable('animation_episodes', {
  id: uuid('id').primaryKey().defaultRandom(), seriesId: uuid('series_id').notNull().references(() => animationSeries.id, { onDelete: 'cascade' }), mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id, { onDelete: 'restrict' }),
  episodeNumber: integer('episode_number').notNull(), title: text('title').notNull(), description: text('description'), accessMode: text('access_mode').notNull().default('FREE'), previewSeconds: integer('preview_seconds'), status: text('status').notNull().default('DRAFT'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('animation_episode_number_unique').on(t.seriesId, t.episodeNumber), index('animation_episodes_series_status_idx').on(t.seriesId, t.status), check('animation_episode_number_check', sql`${t.episodeNumber} > 0`), check('animation_episode_access_check', sql`${t.accessMode} in ('FREE','PREVIEW','PAID')`), check('animation_episode_preview_check', sql`(${t.accessMode} <> 'PREVIEW') or (${t.previewSeconds} is not null and ${t.previewSeconds} > 0)`), check('animation_episode_status_check', sql`${t.status} in ('DRAFT','PUBLISHED','UNPUBLISHED')`)]);

export const contentEntitlements = pgTable('content_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(), consumerUserId: uuid('consumer_user_id').notNull().references(() => consumerUsers.id, { onDelete: 'cascade' }), seriesId: uuid('series_id').notNull().references(() => animationSeries.id, { onDelete: 'cascade' }), sourceType: text('source_type').notNull().default('ONE_TIME'), sourceReference: text('source_reference'), grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp('expires_at', { withTimezone: true }), revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [uniqueIndex('content_entitlement_owner_series_unique').on(t.consumerUserId, t.seriesId), index('content_entitlement_owner_idx').on(t.consumerUserId, t.grantedAt), check('content_entitlement_source_check', sql`${t.sourceType} in ('ONE_TIME','ADMIN','MIGRATION')`)]);

export const playbackProgress = pgTable('playback_progress', {
  id: uuid('id').primaryKey().defaultRandom(), consumerUserId: uuid('consumer_user_id').notNull().references(() => consumerUsers.id, { onDelete: 'cascade' }), episodeId: uuid('episode_id').notNull().references(() => animationEpisodes.id, { onDelete: 'cascade' }), positionSeconds: integer('position_seconds').notNull().default(0), completed: boolean('completed').notNull().default(false), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('playback_progress_owner_episode_unique').on(t.consumerUserId, t.episodeId), index('playback_progress_continue_idx').on(t.consumerUserId, t.completed, t.updatedAt), check('playback_progress_position_check', sql`${t.positionSeconds} >= 0`)]);
