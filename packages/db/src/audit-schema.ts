import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staffAccounts } from './schema.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorStaffAccountId: uuid('actor_staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'restrict' }),
    actionKey: text('action_key').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestId: text('request_id').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_created_at_idx').on(table.createdAt),
    index('audit_logs_actor_created_idx').on(table.actorStaffAccountId, table.createdAt),
    index('audit_logs_action_created_idx').on(table.actionKey, table.createdAt),
    index('audit_logs_resource_created_idx').on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
  ],
);
