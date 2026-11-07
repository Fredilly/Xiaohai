import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inventoryTransactions, storeInventory } from './inventory-schema.js';
import { staffAccounts } from './schema.js';

/**
 * #208 proposed packaged-food persistence. Nothing creates or mutates rows yet.
 * Untyped merchant SKUs must not become eligible for sale from these rows.
 */
export const foodBatches = pgTable(
  'food_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    skuId: uuid('sku_id').notNull(),
    lotCode: text('lot_code').notNull(),
    manufacturedOn: date('manufactured_on', { mode: 'string' }),
    expiresOn: date('expires_on', { mode: 'string' }).notNull(),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    blocked: integer('blocked').notNull().default(0),
    state: text('state').notNull().default('HELD'),
    version: integer('version').notNull().default(0),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'food_batches_inventory_fk',
      columns: [t.storeId, t.skuId],
      foreignColumns: [storeInventory.storeId, storeInventory.skuId],
    }).onDelete('restrict'),
    uniqueIndex('food_batches_store_sku_id_unique').on(t.storeId, t.skuId, t.id),
    uniqueIndex('food_batches_lot_expiry_unique').on(t.storeId, t.skuId, t.lotCode, t.expiresOn),
    index('food_batches_store_sku_expiry_idx').on(t.storeId, t.skuId, t.expiresOn),
    check(
      'food_batches_quantities_check',
      sql.raw(
        '"food_batches"."on_hand" >= 0 and "food_batches"."reserved" >= 0 and "food_batches"."blocked" >= 0 and "food_batches"."reserved" + "food_batches"."blocked" <= "food_batches"."on_hand"',
      ),
    ),
    check(
      'food_batches_status_check',
      sql.raw('"food_batches"."state" in (\'AVAILABLE\',\'HELD\',\'RECALLED\')'),
    ),
    check('food_batches_version_check', sql.raw('"food_batches"."version" >= 0')),
    check(
      'food_batches_lot_code_check',
      sql.raw('length(btrim("food_batches"."lot_code")) between 1 and 100'),
    ),
    check(
      'food_batches_dates_check',
      sql.raw(
        '"food_batches"."manufactured_on" is null or "food_batches"."expires_on" >= "food_batches"."manufactured_on"',
      ),
    ),
  ],
);

/**
 * Append-only candidate event trail, linked to existing aggregate stock events.
 * No API insert path is enabled. A SQL trigger blocks UPDATE/DELETE.
 */
export const foodBatchTransactions = pgTable(
  'food_batch_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    skuId: uuid('sku_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    transactionType: text('transaction_type').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    onHandBefore: integer('on_hand_before').notNull(),
    onHandAfter: integer('on_hand_after').notNull(),
    reservedBefore: integer('reserved_before').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    blockedBefore: integer('blocked_before').notNull(),
    blockedAfter: integer('blocked_after').notNull(),
    aggregateTransactionId: uuid('aggregate_transaction_id')
      .notNull()
      .references(() => inventoryTransactions.id, { onDelete: 'restrict' }),
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason').notNull(),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'food_batch_transactions_batch_scope_fk',
      columns: [t.storeId, t.skuId, t.batchId],
      foreignColumns: [foodBatches.storeId, foodBatches.skuId, foodBatches.id],
    }).onDelete('restrict'),
    uniqueIndex('food_batch_transactions_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('food_batch_transactions_aggregate_unique').on(t.aggregateTransactionId),
    index('food_batch_transactions_store_sku_created_idx').on(t.storeId, t.skuId, t.createdAt),
    check(
      'food_batch_transactions_type_check',
      sql.raw(
        '"food_batch_transactions"."transaction_type" in (\'EXISTING_LOT_RECEIPT\',\'DAMAGE\',\'STOCKTAKE_LOSS\')',
      ),
    ),
    check(
      'food_batch_transactions_quantity_check',
      sql.raw(
        '"food_batch_transactions"."on_hand_before" >= 0 and "food_batch_transactions"."on_hand_after" >= 0 and "food_batch_transactions"."on_hand_after" = "food_batch_transactions"."on_hand_before" + "food_batch_transactions"."quantity_delta"',
      ),
    ),
    check(
      'food_batch_transactions_direction_check',
      sql.raw(
        '(("food_batch_transactions"."transaction_type" = \'EXISTING_LOT_RECEIPT\' and "food_batch_transactions"."quantity_delta" > 0) or ("food_batch_transactions"."transaction_type" in (\'DAMAGE\',\'STOCKTAKE_LOSS\') and "food_batch_transactions"."quantity_delta" < 0))',
      ),
    ),
    check(
      'food_batch_transactions_allocation_check',
      sql.raw(
        '"food_batch_transactions"."reserved_before" >= 0 and "food_batch_transactions"."reserved_after" >= 0 and "food_batch_transactions"."blocked_before" >= 0 and "food_batch_transactions"."blocked_after" >= 0 and "food_batch_transactions"."reserved_before" = "food_batch_transactions"."reserved_after" and "food_batch_transactions"."blocked_before" = "food_batch_transactions"."blocked_after" and "food_batch_transactions"."reserved_after" + "food_batch_transactions"."blocked_after" <= "food_batch_transactions"."on_hand_after"',
      ),
    ),
    check(
      'food_batch_transactions_evidence_check',
      sql.raw(
        'length(btrim("food_batch_transactions"."idempotency_key")) between 1 and 128 and length(btrim("food_batch_transactions"."reference_type")) between 1 and 100 and length(btrim("food_batch_transactions"."reason")) between 1 and 500',
      ),
    ),
  ],
);
