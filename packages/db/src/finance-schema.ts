import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { commissionEvents } from './commission-schema.js';
import { paymentLedger } from './payment-schema.js';
import { staffAccounts } from './schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const financeLedgerEntries = pgTable(
  'finance_ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventKey: text('event_key').notNull(),
    sourceKind: text('source_kind').notNull(),
    paymentLedgerId: uuid('payment_ledger_id').references(() => paymentLedger.id, {
      onDelete: 'restrict',
    }),
    commissionEventId: uuid('commission_event_id').references(() => commissionEvents.id, {
      onDelete: 'restrict',
    }),
    eventType: text('event_type').notNull(),
    currency: text('currency').notNull().default('CNY'),
    cashDeltaMinor: integer('cash_delta_minor').notNull().default(0),
    commissionFrozenDeltaMinor: integer('commission_frozen_delta_minor').notNull().default(0),
    commissionAvailableDeltaMinor: integer('commission_available_delta_minor').notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('finance_ledger_event_key_unique').on(t.eventKey),
    uniqueIndex('finance_ledger_payment_source_unique')
      .on(t.paymentLedgerId)
      .where(sql`${t.paymentLedgerId} is not null`),
    uniqueIndex('finance_ledger_commission_source_unique')
      .on(t.commissionEventId)
      .where(sql`${t.commissionEventId} is not null`),
    index('finance_ledger_occurred_at_idx').on(t.occurredAt),
    index('finance_ledger_type_occurred_idx').on(t.eventType, t.occurredAt),
    check(
      'finance_ledger_source_shape_check',
      sql`(${t.sourceKind} = 'PAYMENT_LEDGER' and ${t.paymentLedgerId} is not null and ${t.commissionEventId} is null)
        or (${t.sourceKind} = 'COMMISSION_EVENT' and ${t.paymentLedgerId} is null and ${t.commissionEventId} is not null)`,
    ),
    check(
      'finance_ledger_event_type_check',
      sql`${t.eventType} in ('PAYMENT','REFUND','COMMISSION_FROZEN','COMMISSION_SETTLED','COMMISSION_REVERSED','WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_PAID')`,
    ),
    check('finance_ledger_currency_check', sql`${t.currency} = 'CNY'`),
    check(
      'finance_ledger_nonzero_check',
      sql`${t.cashDeltaMinor} <> 0 or ${t.commissionFrozenDeltaMinor} <> 0 or ${t.commissionAvailableDeltaMinor} <> 0`,
    ),
  ],
);

export const financeReconciliationRuns = pgTable(
  'finance_reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestedByStaffAccountId: uuid('requested_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    rangeFrom: timestamp('range_from', { withTimezone: true }).notNull(),
    rangeTo: timestamp('range_to', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('RUNNING'),
    matchedCount: integer('matched_count').notNull().default(0),
    missingCount: integer('missing_count').notNull().default(0),
    mismatchCount: integer('mismatch_count').notNull().default(0),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('finance_reconciliation_created_idx').on(t.createdAt),
    index('finance_reconciliation_actor_created_idx').on(t.requestedByStaffAccountId, t.createdAt),
    check('finance_reconciliation_range_check', sql`${t.rangeTo} > ${t.rangeFrom}`),
    check(
      'finance_reconciliation_status_check',
      sql`${t.status} in ('RUNNING','COMPLETED','FAILED')`,
    ),
    check(
      'finance_reconciliation_counts_check',
      sql`${t.matchedCount} >= 0 and ${t.missingCount} >= 0 and ${t.mismatchCount} >= 0`,
    ),
  ],
);

export const financeReconciliationItems = pgTable(
  'finance_reconciliation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => financeReconciliationRuns.id, { onDelete: 'restrict' }),
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    eventKey: text('event_key').notNull(),
    eventType: text('event_type').notNull(),
    financeLedgerEntryId: uuid('finance_ledger_entry_id').references(
      () => financeLedgerEntries.id,
      {
        onDelete: 'restrict',
      },
    ),
    outcome: text('outcome').notNull(),
    expectedCashDeltaMinor: integer('expected_cash_delta_minor').notNull(),
    actualCashDeltaMinor: integer('actual_cash_delta_minor'),
    expectedCommissionFrozenDeltaMinor: integer('expected_commission_frozen_delta_minor').notNull(),
    actualCommissionFrozenDeltaMinor: integer('actual_commission_frozen_delta_minor'),
    expectedCommissionAvailableDeltaMinor: integer(
      'expected_commission_available_delta_minor',
    ).notNull(),
    actualCommissionAvailableDeltaMinor: integer('actual_commission_available_delta_minor'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('finance_reconciliation_item_source_unique').on(t.runId, t.sourceKind, t.sourceId),
    index('finance_reconciliation_item_outcome_idx').on(t.runId, t.outcome),
    check(
      'finance_reconciliation_item_source_kind_check',
      sql`${t.sourceKind} in ('PAYMENT_LEDGER','COMMISSION_EVENT')`,
    ),
    check(
      'finance_reconciliation_item_outcome_check',
      sql`${t.outcome} in ('MATCHED','MISSING','MISMATCH')`,
    ),
  ],
);
