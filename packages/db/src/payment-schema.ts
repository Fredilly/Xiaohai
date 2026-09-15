import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { orders } from './commerce-schema.js';
import { staffAccounts } from './schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    merchantId: text('merchant_id').notNull(),
    appId: text('app_id').notNull(),
    outTradeNo: text('out_trade_no').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('CNY'),
    status: text('status').notNull().default('PENDING'),
    providerTransactionId: text('provider_transaction_id'),
    reviewRequired: boolean('review_required').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_order_unique').on(t.orderId),
    uniqueIndex('payments_out_trade_unique').on(t.outTradeNo),
    uniqueIndex('payments_provider_transaction_unique').on(t.providerTransactionId),
    check('payments_amount_check', sql`${t.amountMinor} > 0 and ${t.currency} = 'CNY'`),
    check('payments_status_check', sql`${t.status} in ('PENDING','SUCCEEDED','CLOSED')`),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    outRefundNo: text('out_refund_no').notNull(),
    providerRefundId: text('provider_refund_id'),
    amountMinor: integer('amount_minor').notNull(),
    status: text('status').notNull().default('PENDING'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => staffAccounts.id),
    originalOrderStatus: text('original_order_status').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refunds_payment_unique').on(t.paymentId),
    uniqueIndex('refunds_out_refund_unique').on(t.outRefundNo),
    uniqueIndex('refunds_provider_unique').on(t.providerRefundId),
    check('refunds_amount_check', sql`${t.amountMinor} > 0`),
    check(
      'refunds_status_check',
      sql`${t.status} in ('PENDING','PROCESSING','SUCCEEDED','CLOSED','ABNORMAL')`,
    ),
    check('refunds_original_status_check', sql`${t.originalOrderStatus} in ('PAID','CANCELLED')`),
  ],
);

export const paymentCallbacks = pgTable('payment_callbacks', {
  id: text('id').primaryKey(),
  bodyHash: text('body_hash').notNull(),
  eventType: text('event_type').notNull(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id),
  createdAt: createdAt(),
});

// Append-only evidence: no PII, raw callbacks, credentials or client-supplied amounts.
export const paymentLedger = pgTable(
  'payment_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    eventKey: text('event_key').notNull(),
    kind: text('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('payment_ledger_event_unique').on(t.eventKey),
    check('payment_ledger_kind_check', sql`${t.kind} in ('PAYMENT','REFUND')`),
    check('payment_ledger_amount_check', sql`${t.amountMinor} > 0`),
  ],
);

export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => staffAccounts.id),
  createdAt: createdAt(),
});
export const reconciliationItems = pgTable(
  'reconciliation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    outcome: text('outcome').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'reconciliation_outcome_check',
      sql`${t.outcome} in ('MATCHED','PENDING','REVIEW_REQUIRED','FAILED')`,
    ),
  ],
);
