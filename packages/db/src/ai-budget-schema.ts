import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';
import { consumerUsers } from './schema.js';

export const aiBudgetWindows = pgTable(
  'ai_budget_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetKey: text('budget_key').notNull(),
    scopeType: text('scope_type').notNull(),
    consumerUserId: uuid('consumer_user_id').references(() => consumerUsers.id, {
      onDelete: 'cascade',
    }),
    windowKey: text('window_key').notNull(),
    limitMinor: integer('limit_minor').notNull(),
    reservedMinor: integer('reserved_minor').notNull().default(0),
    actualMinor: integer('actual_minor').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_budget_windows_consumer_key_unique')
      .on(t.budgetKey, t.scopeType, t.consumerUserId, t.windowKey)
      .where(sql`${t.scopeType} = 'CONSUMER'`),
    uniqueIndex('ai_budget_windows_global_key_unique')
      .on(t.budgetKey, t.scopeType, t.windowKey)
      .where(sql`${t.scopeType} = 'GLOBAL' and ${t.consumerUserId} is null`),
    index('ai_budget_windows_scope_idx').on(t.scopeType, t.consumerUserId, t.windowKey),
    check('ai_budget_windows_scope_check', sql`${t.scopeType} in ('GLOBAL','CONSUMER')`),
    check('ai_budget_windows_limit_check', sql`${t.limitMinor} > 0`),
    check(
      'ai_budget_windows_reserved_check',
      sql`${t.reservedMinor} >= 0 and ${t.actualMinor} >= 0 and ${t.reservedMinor} + ${t.actualMinor} <= ${t.limitMinor}`,
    ),
    check(
      'ai_budget_windows_consumer_check',
      sql`(${t.scopeType} = 'GLOBAL' and ${t.consumerUserId} is null) or (${t.scopeType} = 'CONSUMER' and ${t.consumerUserId} is not null)`,
    ),
  ],
);

export const aiCostReservations = pgTable(
  'ai_cost_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: text('idempotency_key').notNull(),
    budgetKey: text('budget_key').notNull(),
    windowKey: text('window_key').notNull(),
    consumerUserId: uuid('consumer_user_id').references(() => consumerUsers.id, {
      onDelete: 'cascade',
    }),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    reservedMinor: integer('reserved_minor').notNull(),
    actualMinor: integer('actual_minor'),
    status: text('status').notNull().default('RESERVED'),
    uncertainty: text('uncertainty').notNull().default('NONE'),
    providerRequestId: text('provider_request_id'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ai_cost_reservations_idempotency_unique').on(t.idempotencyKey),
    index('ai_cost_reservations_resource_idx').on(t.resourceType, t.resourceId),
    index('ai_cost_reservations_consumer_idx').on(t.consumerUserId, t.createdAt),
    check(
      'ai_cost_reservations_status_check',
      sql`${t.status} in ('RESERVED','SETTLED','RELEASED','REJECTED')`,
    ),
    check('ai_cost_reservations_uncertainty_check', sql`${t.uncertainty} in ('NONE','AT_RISK')`),
    check('ai_cost_reservations_amount_check', sql`${t.reservedMinor} > 0`),
  ],
);

export const aiCostLedger = pgTable(
  'ai_cost_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => aiCostReservations.id, { onDelete: 'restrict' }),
    consumerUserId: uuid('consumer_user_id').references(() => consumerUsers.id, {
      onDelete: 'set null',
    }),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    outcome: text('outcome').notNull(),
    usage: text('usage'),
    failureCode: text('failure_code'),
    providerRequestId: text('provider_request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_cost_ledger_consumer_date_idx').on(t.consumerUserId, t.createdAt),
    index('ai_cost_ledger_provider_model_date_idx').on(t.provider, t.model, t.createdAt),
    check('ai_cost_ledger_amount_check', sql`${t.amountMinor} >= 0`),
    check(
      'ai_cost_ledger_outcome_check',
      sql`${t.outcome} in ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','AT_RISK')`,
    ),
  ],
);
