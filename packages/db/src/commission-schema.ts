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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { orders } from './commerce-schema.js';
import { refunds } from './payment-schema.js';
import { consumerUsers, staffAccounts } from './schema.js';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const referralLinks = pgTable(
  'referral_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerConsumerUserId: uuid('owner_consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    label: text('label'),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('referral_links_code_unique').on(t.code),
    index('referral_links_owner_created_idx').on(t.ownerConsumerUserId, t.createdAt),
    check('referral_links_status_check', sql`${t.status} in ('ACTIVE','DISABLED')`),
  ],
);

export const referralAttributions = pgTable(
  'referral_attributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    referralLinkId: uuid('referral_link_id')
      .notNull()
      .references(() => referralLinks.id, { onDelete: 'restrict' }),
    referredConsumerUserId: uuid('referred_consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    beneficiaryConsumerUserId: uuid('beneficiary_consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('referral_attributions_order_unique').on(t.orderId),
    index('referral_attributions_beneficiary_idx').on(t.beneficiaryConsumerUserId, t.createdAt),
    check(
      'referral_attributions_no_self_check',
      sql`${t.referredConsumerUserId} <> ${t.beneficiaryConsumerUserId}`,
    ),
  ],
);

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: text('status').notNull().default('DRAFT'),
    basis: text('basis').notNull().default('ORDER_TOTAL'),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    freezeDays: integer('freeze_days').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdByStaffAccountId: uuid('created_by_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('commission_rules_status_check', sql`${t.status} in ('DRAFT','ACTIVE','INACTIVE')`),
    check('commission_rules_basis_check', sql`${t.basis} = 'ORDER_TOTAL'`),
    check('commission_rules_rate_check', sql`${t.rateBasisPoints} between 0 and 10000`),
    check('commission_rules_freeze_days_check', sql`${t.freezeDays} between 0 and 365`),
    check(
      'commission_rules_window_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    index('commission_rules_active_window_idx').on(t.status, t.effectiveFrom, t.effectiveTo),
  ],
);

export const withdrawalRequests = pgTable(
  'withdrawal_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    amountMinor: integer('amount_minor').notNull(),
    status: text('status').notNull().default('REQUESTED'),
    clientRequestId: text('client_request_id').notNull(),
    reviewedByStaffAccountId: uuid('reviewed_by_staff_account_id').references(
      () => staffAccounts.id,
      { onDelete: 'restrict' },
    ),
    reviewNote: text('review_note'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('withdrawal_requests_consumer_request_unique').on(
      t.consumerUserId,
      t.clientRequestId,
    ),
    check('withdrawal_requests_amount_check', sql`${t.amountMinor} > 0`),
    check(
      'withdrawal_requests_status_check',
      sql`${t.status} in ('REQUESTED','APPROVED','PAID','REJECTED','CANCELLED')`,
    ),
    check('withdrawal_requests_version_check', sql`${t.version} > 0`),
    index('withdrawal_requests_consumer_created_idx').on(t.consumerUserId, t.createdAt),
    index('withdrawal_requests_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const commissionEvents = pgTable(
  'commission_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventKey: text('event_key').notNull(),
    type: text('type').notNull(),
    beneficiaryConsumerUserId: uuid('beneficiary_consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    attributionId: uuid('attribution_id').references(() => referralAttributions.id, {
      onDelete: 'restrict',
    }),
    ruleId: uuid('rule_id').references(() => commissionRules.id, { onDelete: 'restrict' }),
    refundId: uuid('refund_id').references(() => refunds.id, { onDelete: 'restrict' }),
    withdrawalRequestId: uuid('withdrawal_request_id').references(() => withdrawalRequests.id, {
      onDelete: 'restrict',
    }),
    parentEventId: uuid('parent_event_id').references((): AnyPgColumn => commissionEvents.id, {
      onDelete: 'restrict',
    }),
    amountMinor: integer('amount_minor').notNull(),
    frozenUntil: timestamp('frozen_until', { withTimezone: true }),
    metadata: jsonb('metadata')
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('commission_events_key_unique').on(t.eventKey),
    check(
      'commission_events_type_check',
      sql`${t.type} in ('FROZEN','SETTLED','REVERSED','WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_APPROVED','WITHDRAWAL_PAID')`,
    ),
    check('commission_events_amount_check', sql`${t.amountMinor} > 0`),
    check(
      'commission_events_shape_check',
      sql`(${t.type} = 'FROZEN' and ${t.attributionId} is not null and ${t.ruleId} is not null and ${t.frozenUntil} is not null and ${t.parentEventId} is null and ${t.refundId} is null and ${t.withdrawalRequestId} is null)
        or (${t.type} = 'SETTLED' and ${t.parentEventId} is not null and ${t.withdrawalRequestId} is null)
        or (${t.type} = 'REVERSED' and ${t.parentEventId} is not null and ${t.refundId} is not null and ${t.withdrawalRequestId} is null)
        or (${t.type} in ('WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_APPROVED','WITHDRAWAL_PAID') and ${t.withdrawalRequestId} is not null and ${t.attributionId} is null and ${t.refundId} is null)`,
    ),
    index('commission_events_beneficiary_created_idx').on(t.beneficiaryConsumerUserId, t.createdAt),
    index('commission_events_attribution_idx').on(t.attributionId),
  ],
);

export const commissionLedger = pgTable(
  'commission_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => commissionEvents.id, { onDelete: 'restrict' }),
    beneficiaryConsumerUserId: uuid('beneficiary_consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'restrict' }),
    frozenDeltaMinor: integer('frozen_delta_minor').notNull().default(0),
    availableDeltaMinor: integer('available_delta_minor').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('commission_ledger_event_unique').on(t.eventId),
    check(
      'commission_ledger_nonzero_check',
      sql`${t.frozenDeltaMinor} <> 0 or ${t.availableDeltaMinor} <> 0`,
    ),
    index('commission_ledger_beneficiary_created_idx').on(t.beneficiaryConsumerUserId, t.createdAt),
  ],
);
