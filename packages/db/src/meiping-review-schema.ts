import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffAccounts } from './schema.js';
import { stores } from './store-schema.js';

export const meipingReviewSessions = pgTable(
  'meiping_review_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    sourceChecksum: text('source_checksum').notNull(),
    status: text('status').notNull().default('DRAFT'),
    report: jsonb('report').$type<Record<string, unknown>>().notNull(),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meiping_review_sessions_store_checksum_unique').on(t.storeId, t.sourceChecksum),
    index('meiping_review_sessions_store_created_idx').on(t.storeId, t.createdAt),
    check('meiping_review_sessions_status_check', sql.raw('"status" = \'DRAFT\'')),
    check('meiping_review_sessions_checksum_check', sql.raw('length("source_checksum") = 64')),
  ],
);

export const meipingReviewDecisions = pgTable(
  'meiping_review_decisions',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meipingReviewSessions.id, { onDelete: 'restrict' }),
    sourceRowNumber: integer('source_row_number').notNull(),
    action: text('action').notNull(),
    countedQuantity: integer('counted_quantity'),
    reason: text('reason'),
    version: integer('version').notNull().default(1),
    updatedByStaffAccountId: uuid('updated_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.sourceRowNumber], name: 'meiping_review_decisions_pk' }),
    check('meiping_review_decisions_source_row_positive', sql.raw('"source_row_number" > 0')),
    check('meiping_review_decisions_version_positive', sql.raw('"version" > 0')),
  ],
);

export const meipingReviewCorrections = pgTable(
  'meiping_review_corrections',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meipingReviewSessions.id, { onDelete: 'restrict' }),
    sourceRowNumber: integer('source_row_number').notNull(),
    proposedFields: jsonb('proposed_fields').$type<Record<string, string | number>>().notNull(),
    reason: text('reason').notNull(),
    version: integer('version').notNull().default(1),
    updatedByStaffAccountId: uuid('updated_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.sourceRowNumber], name: 'meiping_review_corrections_pk' }),
    check('meiping_review_corrections_row_positive', sql.raw('"source_row_number" > 0')),
    check('meiping_review_corrections_version_positive', sql.raw('"version" > 0')),
    check('meiping_review_corrections_reason_check', sql.raw('length(trim("reason")) > 0')),
    check('meiping_review_corrections_fields_check', sql.raw(`jsonb_typeof("proposed_fields") = 'object' AND "proposed_fields" <> '{}'::jsonb`)),
  ],
);
