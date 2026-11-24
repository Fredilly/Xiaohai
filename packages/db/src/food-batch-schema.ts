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
import { orderItems } from './commerce-schema.js';
import { inventoryTransactions, storeInventory, stockTransferItems } from './inventory-schema.js';
import { staffAccounts } from './schema.js';

/**
 * #208 packaged-food persistence; guarded intake is default disabled.
 * Untyped merchant SKUs must not become eligible for sale from these rows.
 */
export const foodBatches = pgTable(
  'food_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id').notNull(),
    skuId: uuid('sku_id').notNull(),
    lotCode: text('lot_code').notNull(),
    foodKind: text('food_kind').$type<'PACKAGED_FOOD' | 'SEALED_BEVERAGE'>(),
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
    index('food_batches_sku_idx').on(t.skuId),
    check(
      'food_batches_kind_check',
      sql`${t.foodKind} is null or ${t.foodKind} in ('PACKAGED_FOOD','SEALED_BEVERAGE')`,
    ),
    check(
      'food_batches_quantities_check',
      sql.raw(
        '"food_batches"."on_hand" >= 0 and "food_batches"."reserved" >= 0 and "food_batches"."blocked" >= 0 and "food_batches"."reserved" + "food_batches"."blocked" <= "food_batches"."on_hand"',
      ),
    ),
    check(
      'food_batches_status_check',
      sql.raw("\"food_batches\".\"state\" in ('AVAILABLE','HELD','RECALLED')"),
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
 * Guarded API inserts require explicit environment activation. SQL blocks UPDATE/DELETE.
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
    aggregateTransactionId: uuid('aggregate_transaction_id').notNull(),
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
    foreignKey({
      name: 'food_batch_transactions_aggregate_scope_fk',
      columns: [t.storeId, t.skuId, t.aggregateTransactionId],
      foreignColumns: [
        inventoryTransactions.storeId,
        inventoryTransactions.skuId,
        inventoryTransactions.id,
      ],
    }).onDelete('restrict'),
    uniqueIndex('food_batch_transactions_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('food_batch_transactions_aggregate_batch_unique').on(
      t.aggregateTransactionId,
      t.batchId,
    ),
    index('food_batch_transactions_store_sku_created_idx').on(t.storeId, t.skuId, t.createdAt),
    check(
      'food_batch_transactions_type_check',
      sql.raw(
        "\"food_batch_transactions\".\"transaction_type\" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT','DAMAGE','STOCKTAKE_LOSS','DISPOSAL','SALE','PHYSICAL_RETURN','TRANSFER_OUT','TRANSFER_IN')",
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
        "((\"food_batch_transactions\".\"transaction_type\" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT','PHYSICAL_RETURN','TRANSFER_IN') and \"food_batch_transactions\".\"quantity_delta\" > 0) or (\"food_batch_transactions\".\"transaction_type\" in ('DAMAGE','STOCKTAKE_LOSS','DISPOSAL','SALE','TRANSFER_OUT') and \"food_batch_transactions\".\"quantity_delta\" < 0))",
      ),
    ),
    check(
      'food_batch_transactions_allocation_check',
      sql.raw(
        '"food_batch_transactions"."reserved_before" >= 0 and "food_batch_transactions"."reserved_after" >= 0 and "food_batch_transactions"."blocked_before" >= 0 and "food_batch_transactions"."blocked_after" >= 0 and (("food_batch_transactions"."transaction_type" = \'SALE\' and "food_batch_transactions"."reserved_after" = "food_batch_transactions"."reserved_before" + "food_batch_transactions"."quantity_delta") or ("food_batch_transactions"."transaction_type" <> \'SALE\' and "food_batch_transactions"."reserved_before" = "food_batch_transactions"."reserved_after")) and "food_batch_transactions"."blocked_before" = "food_batch_transactions"."blocked_after" and "food_batch_transactions"."reserved_after" + "food_batch_transactions"."blocked_after" <= "food_batch_transactions"."on_hand_after"',
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

/** One immutable order-item/lot assignment; only its lifecycle status changes.
 * The event table below captures every reservation/release transition.
 */
export const foodBatchReservations = pgTable(
  'food_batch_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id').notNull(),
    skuId: uuid('sku_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: text('status').notNull().default('RESERVED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'food_batch_reservations_scope_fk',
      columns: [t.storeId, t.skuId, t.batchId],
      foreignColumns: [foodBatches.storeId, foodBatches.skuId, foodBatches.id],
    }).onDelete('restrict'),
    uniqueIndex('food_batch_reservations_order_batch_unique').on(t.orderItemId, t.batchId),
    index('food_batch_reservations_batch_status_idx').on(t.batchId, t.status),
    check('food_batch_reservations_quantity_check', sql`${t.quantity} between 1 and 1000000`),
    check(
      'food_batch_reservations_status_check',
      sql`${t.status} in ('RESERVED','RELEASED','SOLD')`,
    ),
  ],
);

/** Append-only evidence for allocation changes; no zero-delta aggregate stock events. */
export const foodBatchReservationEvents = pgTable(
  'food_batch_reservation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => foodBatchReservations.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    quantity: integer('quantity').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('food_batch_reservation_events_key_unique').on(t.idempotencyKey),
    index('food_batch_reservation_events_reservation_idx').on(t.reservationId, t.createdAt),
    check('food_batch_reservation_events_quantity_check', sql`${t.quantity} between 1 and 1000000`),
    check(
      'food_batch_reservation_events_type_check',
      sql`${t.eventType} in ('RESERVE','RELEASE','SALE')`,
    ),
    check(
      'food_batch_reservation_events_key_check',
      sql`length(btrim(${t.idempotencyKey})) between 1 and 128`,
    ),
  ],
);

/** Physical return evidence is independent of the financial refund lifecycle. */
export const foodPhysicalReturns = pgTable(
  'food_physical_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => foodBatchReservations.id, { onDelete: 'restrict' }),
    returnedBatchId: uuid('returned_batch_id')
      .notNull()
      .references(() => foodBatches.id, { onDelete: 'restrict' }),
    aggregateTransactionId: uuid('aggregate_transaction_id')
      .notNull()
      .references(() => inventoryTransactions.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    reason: text('reason').notNull(),
    sourceRef: text('source_ref').notNull(),
    actorStaffAccountId: uuid('actor_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('food_physical_returns_key_unique').on(t.idempotencyKey),
    uniqueIndex('food_physical_returns_batch_unique').on(t.returnedBatchId),
    uniqueIndex('food_physical_returns_evidence_unique').on(t.reservationId, t.sourceRef),
    index('food_physical_returns_reservation_idx').on(t.reservationId),
    check('food_physical_returns_quantity_check', sql`${t.quantity} between 1 and 1000000`),
  ],
);

/** A transfer retains each source lot and its separately inspected destination lot. */
export const foodTransferAllocations = pgTable(
  'food_transfer_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferItemId: uuid('transfer_item_id')
      .notNull()
      .references(() => stockTransferItems.id, { onDelete: 'restrict' }),
    sourceBatchId: uuid('source_batch_id')
      .notNull()
      .references(() => foodBatches.id, { onDelete: 'restrict' }),
    destinationBatchId: uuid('destination_batch_id').references(() => foodBatches.id, {
      onDelete: 'restrict',
    }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('food_transfer_allocations_item_batch_unique').on(
      t.transferItemId,
      t.sourceBatchId,
    ),
    uniqueIndex('food_transfer_allocations_destination_unique').on(t.destinationBatchId),
    check('food_transfer_allocations_quantity_check', sql`${t.quantity} between 1 and 1000000`),
  ],
);
