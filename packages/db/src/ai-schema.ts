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
import { consumerUsers, staffAccounts } from './schema.js';

export const aiProjects = pgTable(
  'ai_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectType: text('project_type').notNull().default('PLATFORM_SANDBOX'),
    title: text('title').notNull(),
    createdByStaffAccountId: uuid('created_by_staff_account_id').references(
      () => staffAccounts.id,
      { onDelete: 'restrict' },
    ),
    createdByConsumerUserId: uuid('created_by_consumer_user_id').references(
      () => consumerUsers.id,
      { onDelete: 'restrict' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ai_projects_type_check',
      sql`${t.projectType} in ('PLATFORM_SANDBOX','STORY','PICTURE_BOOK')`,
    ),
    check(
      'ai_projects_owner_check',
      sql`(${t.createdByStaffAccountId} is not null and ${t.createdByConsumerUserId} is null)
        or (${t.createdByStaffAccountId} is null and ${t.createdByConsumerUserId} is not null)`,
    ),
    index('ai_projects_staff_creator_idx').on(t.createdByStaffAccountId),
    index('ai_projects_consumer_creator_idx').on(t.createdByConsumerUserId),
  ],
);

export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull().default('PLATFORM_TEXT'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull().default('QUEUED'),
    input: jsonb('input')
      .$type<{
        prompt: string;
        context?:
          | {
              kind: 'STORY';
              workId: string;
              operation: 'OUTLINE' | 'BODY' | 'REWRITE' | 'CONTINUE' | 'POLISH';
              sourceVersionId?: string | null;
            }
          | {
              kind: 'PICTURE_BOOK';
              pictureBookId: string;
              operation: 'CHARACTERS' | 'STORYBOARD';
            };
      }>()
      .notNull(),
    result: jsonb('result').$type<{ text?: string; assetReferences?: string[] }>(),
    moderation: jsonb('moderation').$type<{
      input: string;
      output?: string;
      reasonCodes: string[];
    }>(),
    usage: jsonb('usage').$type<{
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }>(),
    costMetadata: jsonb('cost_metadata').$type<Record<string, unknown>>(),
    maxAttempts: integer('max_attempts').notNull().default(3),
    attemptBudgetStart: integer('attempt_budget_start').notNull().default(0),
    timeoutMs: integer('timeout_ms').notNull().default(30000),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'ai_jobs_type_check',
      sql`${t.jobType} in ('PLATFORM_TEXT','STORY_OUTLINE','STORY_BODY','STORY_REWRITE','STORY_CONTINUE','STORY_POLISH','PICTURE_BOOK_CHARACTERS','PICTURE_BOOK_STORYBOARD')`,
    ),
    check('ai_jobs_provider_check', sql`${t.provider} in ('MOCK','DEEPSEEK')`),
    check(
      'ai_jobs_status_check',
      sql`${t.status} in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')`,
    ),
    check('ai_jobs_attempts_check', sql`${t.maxAttempts} between 1 and 10`),
    check('ai_jobs_attempt_budget_start_check', sql`${t.attemptBudgetStart} >= 0`),
    check('ai_jobs_timeout_check', sql`${t.timeoutMs} between 1000 and 300000`),
    index('ai_jobs_claim_idx').on(t.status, t.runAfter, t.createdAt),
    index('ai_jobs_project_created_idx').on(t.projectId, t.createdAt),
  ],
);

export const aiJobAttempts = pgTable(
  'ai_job_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    providerRequestId: text('provider_request_id'),
    status: text('status').notNull().default('RUNNING'),
    usage: jsonb('usage').$type<{
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }>(),
    costMetadata: jsonb('cost_metadata').$type<Record<string, unknown>>(),
    moderation: jsonb('moderation').$type<{
      input: string;
      output?: string;
      reasonCodes: string[];
    }>(),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ai_job_attempts_job_number_unique').on(t.jobId, t.attemptNumber),
    check('ai_job_attempts_number_check', sql`${t.attemptNumber} > 0`),
    check(
      'ai_job_attempts_status_check',
      sql`${t.status} in ('RUNNING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED')`,
    ),
  ],
);
