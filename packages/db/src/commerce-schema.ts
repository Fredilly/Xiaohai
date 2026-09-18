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
import { consumerUsers } from './schema.js';

export const books = pgTable('books', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  author: text('author').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookEditions = pgTable(
  'book_editions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    isbn: text('isbn'),
    publisher: text('publisher'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('book_editions_isbn_unique').on(table.isbn)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookEditionId: uuid('book_edition_id').references(() => bookEditions.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    status: text('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('products_status_check', sql`${table.status} in ('DRAFT', 'ACTIVE', 'INACTIVE')`),
    index('products_status_name_idx').on(table.status, table.name),
  ],
);

export const skus = pgTable(
  'skus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    priceMinor: integer('price_minor').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    availableForSale: boolean('available_for_sale').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('skus_code_unique').on(table.code),
    check('skus_price_nonnegative', sql`${table.priceMinor} >= 0`),
    check('skus_status_check', sql`${table.status} in ('ACTIVE', 'INACTIVE')`),
    index('skus_product_idx').on(table.productId),
  ],
);

export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (table) => [
    check('product_media_order_nonnegative', sql`${table.displayOrder} >= 0`),
    index('product_media_product_order_idx').on(table.productId, table.displayOrder),
  ],
);

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('carts_consumer_unique').on(table.consumerUserId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cart_items_cart_sku_unique').on(table.cartId, table.skuId),
    check('cart_items_quantity_check', sql`${table.quantity} between 1 and 99`),
  ],
);

export const userAddresses = pgTable(
  'user_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'cascade' }),
    recipientName: text('recipient_name').notNull(),
    phone: text('phone').notNull(),
    region: text('region').notNull(),
    city: text('city').notNull(),
    district: text('district').notNull(),
    addressLine: text('address_line').notNull(),
    postalCode: text('postal_code'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_addresses_consumer_idx').on(table.consumerUserId),
    uniqueIndex('user_addresses_default_unique')
      .on(table.consumerUserId)
      .where(sql`${table.isDefault} = true`),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    orderNumber: text('order_number').notNull(),
    status: text('status').notNull().default('UNPAID'),
    subtotalMinor: integer('subtotal_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    addressSnapshot: jsonb('address_snapshot').$type<Record<string, unknown> | null>(),
    clientRequestId: text('client_request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('orders_number_unique').on(table.orderNumber),
    uniqueIndex('orders_consumer_request_unique').on(table.consumerUserId, table.clientRequestId),
    check(
      'orders_status_check',
      sql`${table.status} in ('UNPAID', 'PAID', 'PROCESSING', 'PICKUP_READY', 'DELIVERING', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED')`,
    ),
    check(
      'orders_amount_nonnegative',
      sql`${table.subtotalMinor} >= 0 and ${table.totalMinor} >= 0`,
    ),
    index('orders_consumer_created_idx').on(table.consumerUserId, table.createdAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    skuNameSnapshot: text('sku_name_snapshot').notNull(),
    skuCodeSnapshot: text('sku_code_snapshot').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull(),
  },
  (table) => [
    check('order_items_quantity_check', sql`${table.quantity} between 1 and 99`),
    check(
      'order_items_amount_nonnegative',
      sql`${table.unitPriceMinor} >= 0 and ${table.lineTotalMinor} >= 0`,
    ),
    index('order_items_order_idx').on(table.orderId),
  ],
);
