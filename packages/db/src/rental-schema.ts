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
import { skus } from './commerce-schema.js';
import { consumerUsers, staffAccounts } from './schema.js';
import { stores } from './store-schema.js';

export const rentalOrders = pgTable(
  'rental_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rentalNumber: text('rental_number').notNull(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('RESERVED'),
    clientRequestId: text('client_request_id').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    version: integer('version').notNull().default(0),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
    borrowedAt: timestamp('borrowed_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rental_orders_number_unique').on(t.rentalNumber),
    uniqueIndex('rental_orders_consumer_request_unique').on(t.consumerUserId, t.clientRequestId),
    index('rental_orders_consumer_status_idx').on(t.consumerUserId, t.status, t.createdAt),
    index('rental_orders_store_status_idx').on(t.storeId, t.status, t.createdAt),
    check(
      'rental_orders_status_check',
      sql`${t.status} in ('RESERVED','BORROWED','OVERDUE','RETURNED','CANCELLED')`,
    ),
    check('rental_orders_version_check', sql`${t.version} >= 0`),
    check(
      'rental_orders_lifecycle_check',
      sql`
    (${t.status} = 'RESERVED' and ${t.borrowedAt} is null and ${t.dueAt} is null and ${t.returnedAt} is null and ${t.cancelledAt} is null) or
    (${t.status} in ('BORROWED','OVERDUE') and ${t.borrowedAt} is not null and ${t.dueAt} is not null and ${t.returnedAt} is null and ${t.cancelledAt} is null) or
    (${t.status} = 'RETURNED' and ${t.borrowedAt} is not null and ${t.dueAt} is not null and ${t.returnedAt} is not null and ${t.cancelledAt} is null) or
    (${t.status} = 'CANCELLED' and ${t.borrowedAt} is null and ${t.dueAt} is null and ${t.returnedAt} is null and ${t.cancelledAt} is not null)
  `,
    ),
  ],
);

export const rentalItems = pgTable(
  'rental_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rentalOrderId: uuid('rental_order_id')
      .notNull()
      .references(() => rentalOrders.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('rental_items_order_sku_unique').on(t.rentalOrderId, t.skuId),
    index('rental_items_sku_idx').on(t.skuId),
    check('rental_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rentalOrderId: uuid('rental_order_id')
      .notNull()
      .references(() => rentalOrders.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    reservationType: text('reservation_type').notNull().default('RENTAL'),
    status: text('status').notNull().default('ACTIVE'),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('inventory_reservations_rental_sku_unique').on(t.rentalOrderId, t.skuId),
    index('inventory_reservations_store_sku_status_idx').on(t.storeId, t.skuId, t.status),
    check('inventory_reservations_type_check', sql`${t.reservationType} = 'RENTAL'`),
    check(
      'inventory_reservations_status_check',
      sql`${t.status} in ('ACTIVE','COMPLETED','RELEASED')`,
    ),
    check('inventory_reservations_quantity_check', sql`${t.quantity} > 0`),
    check(
      'inventory_reservations_end_check',
      sql`(${t.status} = 'ACTIVE' and ${t.endedAt} is null) or (${t.status} in ('COMPLETED','RELEASED') and ${t.endedAt} is not null)`,
    ),
  ],
);

export const rentalEvents = pgTable(
  'rental_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rentalOrderId: uuid('rental_order_id')
      .notNull()
      .references(() => rentalOrders.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorConsumerUserId: uuid('actor_consumer_user_id').references(() => consumerUsers.id, {
      onDelete: 'restrict',
    }),
    actorStaffAccountId: uuid('actor_staff_account_id').references(() => staffAccounts.id, {
      onDelete: 'restrict',
    }),
    idempotencyKey: text('idempotency_key').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rental_events_order_type_unique').on(t.rentalOrderId, t.eventType),
    uniqueIndex('rental_events_idempotency_unique').on(t.idempotencyKey),
    index('rental_events_order_created_idx').on(t.rentalOrderId, t.createdAt),
    check(
      'rental_events_type_check',
      sql`${t.eventType} in ('RESERVED','BORROWED','OVERDUE','RETURNED','CANCELLED')`,
    ),
    check('rental_events_actor_type_check', sql`${t.actorType} in ('CONSUMER','STAFF','SYSTEM')`),
    check(
      'rental_events_actor_shape_check',
      sql`
    (${t.actorType} = 'CONSUMER' and ${t.actorConsumerUserId} is not null and ${t.actorStaffAccountId} is null) or
    (${t.actorType} = 'STAFF' and ${t.actorStaffAccountId} is not null and ${t.actorConsumerUserId} is null) or
    (${t.actorType} = 'SYSTEM' and ${t.actorStaffAccountId} is null and ${t.actorConsumerUserId} is null)
  `,
    ),
  ],
);
