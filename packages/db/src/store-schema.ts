import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
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

export const regions = pgTable(
  'regions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    countryCode: text('country_code').notNull(),
    countryName: text('country_name').notNull(),
    operationalStatus: text('operational_status').notNull().default('ACTIVE'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('regions_code_unique').on(table.code),
    index('regions_country_status_idx').on(
      table.countryCode,
      table.operationalStatus,
      table.displayOrder,
    ),
    check(
      'regions_operational_status_check',
      sql`${table.operationalStatus} in ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

export const franchisees = pgTable(
  'franchisees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    operationalStatus: text('operational_status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('franchisees_code_unique').on(table.code),
    index('franchisees_region_status_idx').on(table.regionId, table.operationalStatus),
    check(
      'franchisees_operational_status_check',
      sql`${table.operationalStatus} in ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    franchiseeId: uuid('franchisee_id').references(() => franchisees.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    countryCode: text('country_code').notNull(),
    countryName: text('country_name').notNull(),
    city: text('city').notNull(),
    timezone: text('timezone').notNull(),
    addressLine: text('address_line').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    phone: text('phone'),
    openingHoursText: text('opening_hours_text'),
    services: jsonb('services').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    operationalStatus: text('operational_status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stores_code_unique').on(table.code),
    index('stores_region_status_idx').on(table.regionId, table.operationalStatus),
    index('stores_franchisee_status_idx').on(table.franchiseeId, table.operationalStatus),
    index('stores_country_city_status_idx').on(
      table.countryCode,
      table.city,
      table.operationalStatus,
    ),
    index('stores_name_idx').on(table.name),
    check('stores_latitude_check', sql`${table.latitude} >= -90 and ${table.latitude} <= 90`),
    check(
      'stores_longitude_check',
      sql`${table.longitude} >= -180 and ${table.longitude} <= 180`,
    ),
    check(
      'stores_operational_status_check',
      sql`${table.operationalStatus} in ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);

export const storeStaff = pgTable(
  'store_staff',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    staffAccountId: uuid('staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.staffAccountId], name: 'store_staff_pk' }),
    index('store_staff_staff_account_id_idx').on(table.staffAccountId),
  ],
);
