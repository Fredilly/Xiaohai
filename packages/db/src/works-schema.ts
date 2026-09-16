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
    uniqueIndex('works_ai_project_unique').on(t.aiProjectId),
    index('works_consumer_updated_idx').on(t.consumerUserId, t.updatedAt),
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
        or (${t.operation} in ('BODY','REWRITE','CONTINUE','POLISH') and ${t.sourceVersionId} is not null)`,
    ),
  ],
);
