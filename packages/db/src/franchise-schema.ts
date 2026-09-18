import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { consumerUsers, staffAccounts } from './schema.js';

export const franchiseApplications = pgTable(
  'franchise_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationNumber: text('application_number').notNull(),
    submittedByConsumerUserId: uuid('submitted_by_consumer_user_id').references(
      () => consumerUsers.id,
      { onDelete: 'set null' },
    ),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    country: text('country').notNull(),
    region: text('region').notNull(),
    city: text('city').notNull(),
    district: text('district'),
    background: text('background'),
    message: text('message'),
    status: text('status').notNull().default('SUBMITTED'),
    assignedStaffAccountId: uuid('assigned_staff_account_id').references(() => staffAccounts.id, {
      onDelete: 'set null',
    }),
    reviewedByStaffAccountId: uuid('reviewed_by_staff_account_id').references(
      () => staffAccounts.id,
      { onDelete: 'set null' },
    ),
    reviewNote: text('review_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    preparingAt: timestamp('preparing_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('franchise_applications_number_unique').on(table.applicationNumber),
    index('franchise_applications_status_created_idx').on(table.status, table.createdAt),
    index('franchise_applications_assignee_status_idx').on(
      table.assignedStaffAccountId,
      table.status,
    ),
    index('franchise_applications_location_idx').on(table.country, table.region, table.city),
    check(
      'franchise_applications_status_check',
      sql`${table.status} in ('SUBMITTED', 'ASSIGNED', 'FOLLOWING_UP', 'APPROVED', 'REJECTED', 'SIGNED', 'PREPARING', 'OPENED', 'CLOSED')`,
    ),
    check('franchise_applications_version_positive', sql`${table.version} > 0`),
  ],
);

export const franchiseFollowups = pgTable(
  'franchise_followups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    franchiseApplicationId: uuid('franchise_application_id')
      .notNull()
      .references(() => franchiseApplications.id, { onDelete: 'cascade' }),
    staffAccountId: uuid('staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    channel: text('channel').notNull(),
    note: text('note').notNull(),
    nextFollowupAt: timestamp('next_followup_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('franchise_followups_application_created_idx').on(
      table.franchiseApplicationId,
      table.createdAt,
    ),
    index('franchise_followups_staff_created_idx').on(table.staffAccountId, table.createdAt),
    check(
      'franchise_followups_channel_check',
      sql`${table.channel} in ('PHONE', 'WECHAT', 'EMAIL', 'MEETING', 'OTHER')`,
    ),
  ],
);
