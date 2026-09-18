import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { orders } from './commerce-schema.js';
import { rentalOrders } from './rental-schema.js';
import { staffAccounts } from './schema.js';
import { stores } from './store-schema.js';

export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    region: text('region').notNull(),
    city: text('city').notNull(),
    district: text('district'),
    feeMinor: integer('fee_minor').notNull().default(0),
    providerKey: text('provider_key').notNull().default('MANUAL'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('delivery_zones_store_name_unique').on(t.storeId, t.name),
    index('delivery_zones_store_active_idx').on(t.storeId, t.active),
    index('delivery_zones_location_idx').on(t.region, t.city, t.district),
    check('delivery_zones_fee_nonnegative_check', sql`${t.feeMinor} >= 0`),
  ],
);

export const pickupCodes = pgTable(
  'pickup_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
    rentalOrderId: uuid('rental_order_id').references(() => rentalOrders.id, {
      onDelete: 'cascade',
    }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('ISSUED'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pickup_codes_order_unique').on(t.orderId),
    uniqueIndex('pickup_codes_rental_order_unique').on(t.rentalOrderId),
    index('pickup_codes_store_status_idx').on(t.storeId, t.status, t.createdAt),
    check(
      'pickup_codes_resource_shape_check',
      sql`(${t.orderId} is not null and ${t.rentalOrderId} is null) or (${t.orderId} is null and ${t.rentalOrderId} is not null)`,
    ),
    check('pickup_codes_status_check', sql`${t.status} in ('ISSUED','VERIFIED','CANCELLED')`),
    check('pickup_codes_version_check', sql`${t.version} >= 0`),
    check(
      'pickup_codes_lifecycle_check',
      sql`
        (${t.status} = 'ISSUED' and ${t.verifiedAt} is null and ${t.cancelledAt} is null) or
        (${t.status} = 'VERIFIED' and ${t.verifiedAt} is not null and ${t.cancelledAt} is null) or
        (${t.status} = 'CANCELLED' and ${t.verifiedAt} is null and ${t.cancelledAt} is not null)
      `,
    ),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    deliveryZoneId: uuid('delivery_zone_id')
      .notNull()
      .references(() => deliveryZones.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('PENDING'),
    providerKey: text('provider_key').notNull(),
    providerOrderId: text('provider_order_id'),
    feeMinor: integer('fee_minor').notNull(),
    addressSnapshot: jsonb('address_snapshot').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(0),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('deliveries_order_unique').on(t.orderId),
    index('deliveries_store_status_idx').on(t.storeId, t.status, t.createdAt),
    index('deliveries_provider_order_idx').on(t.providerKey, t.providerOrderId),
    check(
      'deliveries_status_check',
      sql`${t.status} in ('PENDING','DISPATCHED','DELIVERED','CANCELLED')`,
    ),
    check('deliveries_fee_nonnegative_check', sql`${t.feeMinor} >= 0`),
    check('deliveries_version_check', sql`${t.version} >= 0`),
    check(
      'deliveries_lifecycle_check',
      sql`
        (${t.status} = 'PENDING' and ${t.dispatchedAt} is null and ${t.deliveredAt} is null and ${t.cancelledAt} is null) or
        (${t.status} = 'DISPATCHED' and ${t.dispatchedAt} is not null and ${t.deliveredAt} is null and ${t.cancelledAt} is null) or
        (${t.status} = 'DELIVERED' and ${t.dispatchedAt} is not null and ${t.deliveredAt} is not null and ${t.cancelledAt} is null) or
        (${t.status} = 'CANCELLED' and ${t.deliveredAt} is null and ${t.cancelledAt} is not null)
      `,
    ),
  ],
);

export const deliveryEvents = pgTable(
  'delivery_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
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
    uniqueIndex('delivery_events_idempotency_unique').on(t.idempotencyKey),
    index('delivery_events_delivery_created_idx').on(t.deliveryId, t.createdAt),
    check(
      'delivery_events_type_check',
      sql`${t.eventType} in ('CREATED','DISPATCHED','DELIVERED','CANCELLED')`,
    ),
    check('delivery_events_actor_type_check', sql`${t.actorType} in ('STAFF','SYSTEM')`),
    check(
      'delivery_events_actor_shape_check',
      sql`(${t.actorType} = 'STAFF' and ${t.actorStaffAccountId} is not null) or (${t.actorType} = 'SYSTEM' and ${t.actorStaffAccountId} is null)`,
    ),
  ],
);
