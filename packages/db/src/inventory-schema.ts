import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { skus } from './commerce-schema.js';
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
  (table) => [
    primaryKey({ columns: [table.storeId, table.skuId], name: 'store_inventory_pk' }),
    index('store_inventory_sku_id_idx').on(table.skuId),
    check(
      'store_inventory_nonnegative_check',
      sql`${table.onHand} >= 0 and ${table.reserved} >= 0 and ${table.rentalReserved} >= 0`,
    ),
    check(
      'store_inventory_allocated_check',
      sql`${table.reserved} + ${table.rentalReserved} <= ${table.onHand}`,
    ),
    check('store_inventory_version_nonnegative_check', sql`${table.version} >= 0`),
  ],
);
