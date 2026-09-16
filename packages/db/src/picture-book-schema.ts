import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiJobs, aiProjects } from './ai-schema.js';
import { mediaAssets } from './content-schema.js';
import { consumerUsers } from './schema.js';
import { works, workVersions } from './works-schema.js';

export const pictureBooks = pgTable(
  'picture_books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    aiProjectId: uuid('ai_project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'restrict' }),
    storyWorkId: uuid('story_work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'restrict' }),
    sourceStoryVersionId: uuid('source_story_version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('DRAFT'),
    layoutPreset: text('layout_preset').notNull().default('AUTO'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('picture_books_ai_project_unique').on(t.aiProjectId),
    index('picture_books_consumer_updated_idx').on(t.consumerUserId, t.updatedAt),
    index('picture_books_story_source_idx').on(t.storyWorkId, t.sourceStoryVersionId),
    check(
      'picture_books_status_check',
      sql`${t.status} in ('DRAFT','PLANNED','ILLUSTRATING','READY')`,
    ),
    check(
      'picture_books_layout_preset_check',
      sql`char_length(btrim(${t.layoutPreset})) between 1 and 64`,
    ),
  ],
);

export const characterProfiles = pgTable(
  'character_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pictureBookId: uuid('picture_book_id')
      .notNull()
      .references(() => pictureBooks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull().default('MAIN'),
    description: text('description').notNull(),
    visualPrompt: text('visual_prompt').notNull(),
    consistencyKey: uuid('consistency_key').notNull().defaultRandom(),
    referenceMediaAssetId: uuid('reference_media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'restrict',
    }),
    sourceAiJobId: uuid('source_ai_job_id').references(() => aiJobs.id, {
      onDelete: 'restrict',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('character_profiles_book_name_unique').on(t.pictureBookId, t.name),
    uniqueIndex('character_profiles_book_sort_unique').on(t.pictureBookId, t.sortOrder),
    index('character_profiles_book_idx').on(t.pictureBookId),
    check('character_profiles_role_check', sql`${t.role} in ('MAIN','SUPPORTING')`),
    check('character_profiles_sort_check', sql`${t.sortOrder} >= 0`),
  ],
);

export const workPages = pgTable(
  'work_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pictureBookId: uuid('picture_book_id')
      .notNull()
      .references(() => pictureBooks.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    pageKind: text('page_kind').notNull().default('CONTENT'),
    storyText: text('story_text'),
    sceneDescription: text('scene_description'),
    illustrationPrompt: text('illustration_prompt'),
    layoutPreset: text('layout_preset').notNull().default('AUTO'),
    sourceAiJobId: uuid('source_ai_job_id').references(() => aiJobs.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('work_pages_book_number_unique').on(t.pictureBookId, t.pageNumber),
    index('work_pages_book_idx').on(t.pictureBookId, t.pageNumber),
    check(
      'work_pages_number_kind_check',
      sql`(${t.pageKind} = 'COVER' and ${t.pageNumber} = 0)
        or (${t.pageKind} = 'CONTENT' and ${t.pageNumber} > 0)`,
    ),
    check('work_pages_kind_check', sql`${t.pageKind} in ('COVER','CONTENT')`),
    check(
      'work_pages_content_text_check',
      sql`${t.pageKind} = 'COVER'
        or (${t.storyText} is not null and char_length(btrim(${t.storyText})) > 0)`,
    ),
    check(
      'work_pages_layout_preset_check',
      sql`char_length(btrim(${t.layoutPreset})) between 1 and 64`,
    ),
  ],
);

export const workPageIllustrations = pgTable(
  'work_page_illustrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => workPages.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    prompt: text('prompt').notNull(),
    provider: text('provider').notNull().default('MOCK'),
    model: text('model').notNull(),
    consistency: jsonb('consistency')
      .$type<
        Array<{
          consistencyKey: string;
          visualPrompt: string;
          referenceMediaAssetId: string | null;
        }>
      >()
      .notNull(),
    status: text('status').notNull().default('QUEUED'),
    errorCode: text('error_code'),
    sourceAiJobId: uuid('source_ai_job_id').references(() => aiJobs.id, {
      onDelete: 'restrict',
    }),
    mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('work_page_illustrations_page_revision_unique').on(t.pageId, t.revisionNumber),
    index('work_page_illustrations_page_status_idx').on(t.pageId, t.status),
    check('work_page_illustrations_revision_check', sql`${t.revisionNumber} > 0`),
    check('work_page_illustrations_provider_check', sql`${t.provider} in ('MOCK')`),
    check(
      'work_page_illustrations_status_check',
      sql`${t.status} in ('QUEUED','RUNNING','READY','FAILED')`,
    ),
    check(
      'work_page_illustrations_ready_asset_check',
      sql`${t.status} <> 'READY' or ${t.mediaAssetId} is not null`,
    ),
  ],
);
