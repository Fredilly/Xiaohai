import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const consumerUsers = pgTable('consumer_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const wechatIdentities = pgTable(
  'wechat_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consumerUserId: uuid('consumer_user_id')
      .notNull()
      .references(() => consumerUsers.id, { onDelete: 'cascade' }),
    appId: text('app_id').notNull(),
    openid: text('openid').notNull(),
    unionid: text('unionid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('wechat_identities_app_id_openid_unique').on(table.appId, table.openid),
    index('wechat_identities_consumer_user_id_idx').on(table.consumerUserId),
  ],
);
