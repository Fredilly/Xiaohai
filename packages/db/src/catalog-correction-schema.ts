import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { skus } from './commerce-schema.js';
import { staffAccounts } from './schema.js';
import { stores } from './store-schema.js';

/** Independent daily catalog proposal records; never mutate master catalog or inventory. */
export const catalogCorrectionRequests = pgTable(
  'catalog_correction_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id').notNull().references(() => skus.id, { onDelete: 'restrict' }),
    sourceProductId: uuid('source_product_id').notNull(),
    field: text('field').notNull(),
    originalValue: text('original_value'),
    proposedValue: text('proposed_value').notNull(),
    expectedInventoryVersion: integer('expected_inventory_version').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('PENDING'),
    requestedByStaffAccountId: uuid('requested_by_staff_account_id').notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    reviewedByStaffAccountId: uuid('reviewed_by_staff_account_id')
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    reviewReason: text('review_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [
    index('catalog_correction_requests_store_created_idx').on(t.storeId, t.createdAt),
    uniqueIndex('catalog_correction_requests_one_pending_idx')
      .on(t.storeId, t.skuId, t.field)
      .where(sql.raw('"status" = \'PENDING\'')),
    check('catalog_correction_requests_field_check',
      sql.raw('"field" IN (\'productName\', \'bookTitle\', \'author\', \'publisher\', \'isbn\', \'priceMinor\')')),
    check('catalog_correction_requests_status_check',
      sql.raw('"status" IN (\'PENDING\', \'ACCEPTED\', \'REJECTED\')')),
    check('catalog_correction_requests_version_check', sql.raw('"expected_inventory_version" >= 0')),
    check('catalog_correction_requests_reason_check', sql.raw('length(trim("reason")) > 0')),
    check('catalog_correction_requests_value_check', sql.raw('length(trim("proposed_value")) > 0')),
    check('catalog_correction_requests_review_shape_check', sql.raw(
      '("status" = \'PENDING\' AND "reviewed_by_staff_account_id" IS NULL AND "review_reason" IS NULL AND "reviewed_at" IS NULL) OR ("status" IN (\'ACCEPTED\', \'REJECTED\') AND "reviewed_by_staff_account_id" IS NOT NULL AND "review_reason" IS NOT NULL AND "reviewed_at" IS NOT NULL)',
    )),
  ],
);
