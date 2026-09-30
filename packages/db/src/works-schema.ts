import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { aiJobs, aiProjects } from './ai-schema.js';
import { consumerUsers } from './schema.js';

export const works = pgTable(
  'works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    aiProjectId: uuid('ai_project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'restrict' }),
    workType: text('work_type').notNull().default('STORY'),
    creationMode: text('creation_mode').notNull().default('OUTLINE_FIRST'),
    title: text('title').notNull(),
    idea: text('idea').notNull(),
    ageRange: text('age_range').notNull(),
    theme: text('theme').notNull(),
    style: text('style').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('works_type_check', sql`${t.workType} in ('STORY')`),
    check('works_creation_mode_check', sql`${t.creationMode} in ('DIRECT_BODY','OUTLINE_FIRST')`),
    uniqueIndex('works_ai_project_unique').on(t.aiProjectId),
    uniqueIndex('works_id_consumer_unique').on(t.id, t.consumerUserId),
    index('works_consumer_updated_idx').on(t.consumerUserId, t.updatedAt),
  ],
);

export const workDrafts = pgTable(
  'work_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    contentKind: text('content_kind').notNull(),
    content: text('content').notNull(),
    sourceAiJobId: uuid('source_ai_job_id').references(() => aiJobs.id, {
      onDelete: 'restrict',
    }),
    draftRevision: integer('draft_revision').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('work_drafts_work_kind_unique').on(t.workId, t.contentKind),
    uniqueIndex('work_drafts_ai_job_unique').on(t.sourceAiJobId),
    index('work_drafts_work_updated_idx').on(t.workId, t.updatedAt),
    check('work_drafts_kind_check', sql`${t.contentKind} in ('OUTLINE','BODY')`),
    check('work_drafts_content_check', sql`length(btrim(${t.content})) > 0`),
    check('work_drafts_revision_check', sql`${t.draftRevision} > 0`),
  ],
);

export const workVersions = pgTable(
  'work_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    contentKind: text('content_kind').notNull(),
    operation: text('operation').notNull(),
    sourceVersionId: uuid('source_version_id').references((): AnyPgColumn => workVersions.id, {
      onDelete: 'restrict',
    }),
    sourceAiJobId: uuid('source_ai_job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('work_versions_work_number_unique').on(t.workId, t.versionNumber),
    uniqueIndex('work_versions_ai_job_unique').on(t.sourceAiJobId),
    uniqueIndex('work_versions_id_work_unique').on(t.id, t.workId),
    index('work_versions_work_created_idx').on(t.workId, t.createdAt),
    check('work_versions_number_check', sql`${t.versionNumber} > 0`),
    check('work_versions_kind_check', sql`${t.contentKind} in ('OUTLINE','BODY')`),
    check(
      'work_versions_operation_check',
      sql`${t.operation} in ('OUTLINE','BODY','REWRITE','CONTINUE','POLISH')`,
    ),
    check(
      'work_versions_operation_kind_check',
      sql`(${t.operation} = 'OUTLINE' and ${t.contentKind} = 'OUTLINE')
        or (${t.operation} in ('BODY','REWRITE','CONTINUE','POLISH') and ${t.contentKind} = 'BODY')`,
    ),
    check(
      'work_versions_source_check',
      sql`(${t.operation} = 'OUTLINE' and ${t.sourceVersionId} is null)
        or (${t.operation} = 'BODY')
        or (${t.operation} in ('REWRITE','CONTINUE','POLISH') and ${t.sourceVersionId} is not null)`,
    ),
  ],
);
