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
import { skus } from './commerce-schema.js';
import { staffAccounts } from './schema.js';
import { stores } from './store-schema.js';

export const storeInventory = pgTable(
  'store_inventory',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    rentalReserved: integer('rental_reserved').notNull().default(0),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.skuId], name: 'store_inventory_pk' }),
    index('store_inventory_sku_id_idx').on(t.skuId),
    check(
      'store_inventory_nonnegative_check',
      sql`${t.onHand} >= 0 and ${t.reserved} >= 0 and ${t.rentalReserved} >= 0`,
    ),
    check(
      'store_inventory_allocated_check',
      sql`${t.reserved} + ${t.rentalReserved} <= ${t.onHand}`,
    ),
    check('store_inventory_version_nonnegative_check', sql`${t.version} >= 0`),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('suppliers_code_unique').on(t.code),
    index('suppliers_status_name_idx').on(t.status, t.name),
    check('suppliers_status_check', sql`${t.status} in ('ACTIVE','INACTIVE')`),
  ],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: text('order_number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'),
    notes: text('notes'),
    expectedAt: timestamp('expected_at', { withTimezone: true }),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('purchase_orders_number_unique').on(t.orderNumber),
    index('purchase_orders_store_status_idx').on(t.storeId, t.status, t.createdAt),
    index('purchase_orders_supplier_idx').on(t.supplierId, t.createdAt),
    check(
      'purchase_orders_status_check',
      sql`${t.status} in ('DRAFT','SUBMITTED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')`,
    ),
  ],
);

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    orderedQuantity: integer('ordered_quantity').notNull(),
    receivedQuantity: integer('received_quantity').notNull().default(0),
    unitCostMinor: integer('unit_cost_minor'),
  },
  (t) => [
    uniqueIndex('purchase_order_items_order_sku_unique').on(t.purchaseOrderId, t.skuId),
    index('purchase_order_items_sku_idx').on(t.skuId),
    check(
      'purchase_order_items_quantity_check',
      sql`${t.orderedQuantity} > 0 and ${t.receivedQuantity} >= 0 and ${t.receivedQuantity} <= ${t.orderedQuantity}`,
    ),
    check(
      'purchase_order_items_cost_check',
      sql`${t.unitCostMinor} is null or ${t.unitCostMinor} >= 0`,
    ),
  ],
);

export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptNumber: text('receipt_number').notNull(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'),
    notes: text('notes'),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    postedByStaffAccountId: uuid('posted_by_staff_account_id').references(() => staffAccounts.id, {
      onDelete: 'restrict',
    }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('goods_receipts_number_unique').on(t.receiptNumber),
    index('goods_receipts_order_status_idx').on(t.purchaseOrderId, t.status),
    index('goods_receipts_store_created_idx').on(t.storeId, t.createdAt),
    check('goods_receipts_status_check', sql`${t.status} in ('DRAFT','POSTED')`),
  ],
);

export const goodsReceiptItems = pgTable(
  'goods_receipt_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goodsReceiptId: uuid('goods_receipt_id')
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: 'cascade' }),
    purchaseOrderItemId: uuid('purchase_order_item_id')
      .notNull()
      .references(() => purchaseOrderItems.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('goods_receipt_items_receipt_po_item_unique').on(
      t.goodsReceiptId,
      t.purchaseOrderItemId,
    ),
    check('goods_receipt_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);

export const inventoryTransactions = pgTable(
  'inventory_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    transactionType: text('transaction_type').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('inventory_transactions_idempotency_unique').on(t.idempotencyKey),
    uniqueIndex('inventory_transactions_reference_unique').on(
      t.referenceType,
      t.referenceId,
      t.storeId,
      t.skuId,
      t.transactionType,
    ),
    index('inventory_transactions_store_sku_created_idx').on(t.storeId, t.skuId, t.createdAt),
    index('inventory_transactions_reference_idx').on(t.referenceType, t.referenceId),
    check(
      'inventory_transactions_type_check',
      sql`${t.transactionType} in ('PURCHASE_RECEIPT','SALE','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT','STOCKTAKE_GAIN','STOCKTAKE_LOSS','TRANSFER_OUT','TRANSFER_IN','RETURN_TO_SUPPLIER')`,
    ),
    check('inventory_transactions_delta_nonzero_check', sql`${t.quantityDelta} <> 0`),
    check('inventory_transactions_balance_nonnegative_check', sql`${t.balanceAfter} >= 0`),
  ],
);

export const stocktakes = pgTable(
  'stocktakes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stocktakeNumber: text('stocktake_number').notNull(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'),
    notes: text('notes'),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    reviewedByStaffAccountId: uuid('reviewed_by_staff_account_id').references(
      () => staffAccounts.id,
      { onDelete: 'restrict' },
    ),
    postedByStaffAccountId: uuid('posted_by_staff_account_id').references(() => staffAccounts.id, {
      onDelete: 'restrict',
    }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stocktakes_number_unique').on(t.stocktakeNumber),
    index('stocktakes_store_status_idx').on(t.storeId, t.status, t.createdAt),
    check(
      'stocktakes_status_check',
      sql`${t.status} in ('DRAFT','COUNTING','REVIEWED','POSTED','CANCELLED')`,
    ),
  ],
);

export const stocktakeItems = pgTable(
  'stocktake_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stocktakeId: uuid('stocktake_id')
      .notNull()
      .references(() => stocktakes.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    expectedQuantity: integer('expected_quantity').notNull(),
    expectedVersion: integer('expected_version').notNull(),
    countedQuantity: integer('counted_quantity'),
  },
  (t) => [
    uniqueIndex('stocktake_items_stocktake_sku_unique').on(t.stocktakeId, t.skuId),
    check(
      'stocktake_items_values_check',
      sql`${t.expectedQuantity} >= 0 and ${t.expectedVersion} >= 0 and (${t.countedQuantity} is null or ${t.countedQuantity} >= 0)`,
    ),
  ],
);

export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferNumber: text('transfer_number').notNull(),
    sourceStoreId: uuid('source_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    destinationStoreId: uuid('destination_store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('DRAFT'),
    notes: text('notes'),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_transfers_number_unique').on(t.transferNumber),
    index('stock_transfers_source_status_idx').on(t.sourceStoreId, t.status, t.createdAt),
    index('stock_transfers_destination_status_idx').on(t.destinationStoreId, t.status, t.createdAt),
    check(
      'stock_transfers_distinct_stores_check',
      sql`${t.sourceStoreId} <> ${t.destinationStoreId}`,
    ),
    check(
      'stock_transfers_status_check',
      sql`${t.status} in ('DRAFT','SUBMITTED','IN_TRANSIT','RECEIVED','CANCELLED')`,
    ),
  ],
);

export const stockTransferItems = pgTable(
  'stock_transfer_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stockTransferId: uuid('stock_transfer_id')
      .notNull()
      .references(() => stockTransfers.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('stock_transfer_items_transfer_sku_unique').on(t.stockTransferId, t.skuId),
    check('stock_transfer_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);
