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
import { bookEditions, books, products, skus } from './commerce-schema.js';

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

export const meipingReviewDecisionHistory = pgTable(
  'meiping_review_decision_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull(),
    sourceRowNumber: integer('source_row_number').notNull(),
    action: text('action').notNull(),
    countedQuantity: integer('counted_quantity'),
    reason: text('reason'),
    version: integer('version').notNull(),
    updatedByStaffAccountId: uuid('updated_by_staff_account_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meiping_review_decision_history_version_unique').on(
      t.sessionId,
      t.sourceRowNumber,
      t.version,
    ),
    index('meiping_review_decision_history_row_idx').on(t.sessionId, t.sourceRowNumber),
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
    primaryKey({
      columns: [t.sessionId, t.sourceRowNumber],
      name: 'meiping_review_corrections_pk',
    }),
    check('meiping_review_corrections_row_positive', sql.raw('"source_row_number" > 0')),
    check('meiping_review_corrections_version_positive', sql.raw('"version" > 0')),
    check('meiping_review_corrections_reason_check', sql.raw('length(trim("reason")) > 0')),
    check(
      'meiping_review_corrections_fields_check',
      sql.raw(`jsonb_typeof("proposed_fields") = 'object' AND "proposed_fields" <> '{}'::jsonb`),
    ),
  ],
);

export const meipingReviewCorrectionHistory = pgTable(
  'meiping_review_correction_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull(),
    sourceRowNumber: integer('source_row_number').notNull(),
    proposedFields: jsonb('proposed_fields').$type<Record<string, string | number>>().notNull(),
    reason: text('reason').notNull(),
    version: integer('version').notNull(),
    updatedByStaffAccountId: uuid('updated_by_staff_account_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meiping_review_correction_history_version_unique').on(
      t.sessionId,
      t.sourceRowNumber,
      t.version,
    ),
    index('meiping_review_correction_history_row_idx').on(t.sessionId, t.sourceRowNumber),
  ],
);

/**
 * Immutable verdict on a specific version of a human correction proposal.
 * ACCEPTED here only means a reviewer accepted the suggestion for later work;
 * it never authorizes catalog promotion, physical inventory, or sale.
 */
export const meipingCorrectionReviews = pgTable(
  'meiping_correction_reviews',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meipingReviewSessions.id, { onDelete: 'restrict' }),
    sourceRowNumber: integer('source_row_number').notNull(),
    correctionVersion: integer('correction_version').notNull(),
    verdict: text('verdict').notNull(),
    reason: text('reason').notNull(),
    reviewedByStaffAccountId: uuid('reviewed_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.sessionId, t.sourceRowNumber, t.correctionVersion],
      name: 'meiping_correction_reviews_pk',
    }),
    check('meiping_correction_reviews_source_row_positive', sql.raw('"source_row_number" > 0')),
    check(
      'meiping_correction_reviews_correction_version_positive',
      sql.raw('"correction_version" > 0'),
    ),
    check(
      'meiping_correction_reviews_verdict_check',
      sql.raw("\"verdict\" IN ('ACCEPTED','REJECTED')"),
    ),
    check('meiping_correction_reviews_reason_check', sql.raw('length(trim("reason")) > 0')),
    index('meiping_correction_reviews_session_idx').on(t.sessionId),
  ],
);

export const meipingImportBatches = pgTable(
  'meiping_import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewSessionId: uuid('review_session_id')
      .notNull()
      .references(() => meipingReviewSessions.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    sourceChecksum: text('source_checksum').notNull(),
    status: text('status').notNull().default('PREVIEW'),
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    approvedByStaffAccountId: uuid('approved_by_staff_account_id').references(
      () => staffAccounts.id,
      { onDelete: 'restrict' },
    ),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meiping_import_batches_session_unique').on(t.reviewSessionId),
    uniqueIndex('meiping_import_batches_idempotency_unique').on(t.idempotencyKey),
    index('meiping_import_batches_store_status_idx').on(t.storeId, t.status, t.createdAt),
    check(
      'meiping_import_batches_status_check',
      sql.raw("\"status\" IN ('PREVIEW','APPROVED','EXECUTING','SUCCEEDED','FAILED')"),
    ),
    check('meiping_import_batches_checksum_check', sql.raw('length("source_checksum") = 64')),
  ],
);

export const meipingImportResults = pgTable(
  'meiping_import_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => meipingImportBatches.id, { onDelete: 'cascade' }),
    sourceRowNumber: integer('source_row_number').notNull(),
    outcome: text('outcome').notNull(),
    bookId: uuid('book_id').references(() => books.id, { onDelete: 'restrict' }),
    bookEditionId: uuid('book_edition_id').references(() => bookEditions.id, {
      onDelete: 'restrict',
    }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }),
    countedQuantity: integer('counted_quantity'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meiping_import_results_batch_row_unique').on(t.batchId, t.sourceRowNumber),
    index('meiping_import_results_batch_outcome_idx').on(t.batchId, t.outcome),
    check('meiping_import_results_row_positive', sql.raw('"source_row_number" > 0')),
    check(
      'meiping_import_results_outcome_check',
      sql.raw("\"outcome\" IN ('CREATED','REUSED','EXCLUDED','CONFLICT','FAILED')"),
    ),
    check(
      'meiping_import_results_quantity_check',
      sql.raw('"counted_quantity" IS NULL OR "counted_quantity" >= 0'),
    ),
  ],
);
