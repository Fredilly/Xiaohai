import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

export const staffAccounts = pgTable(
  'staff_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    loginIdentifier: text('login_identifier').notNull(),
    passwordHash: text('password_hash').notNull(),
    sessionVersion: integer('session_version').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('staff_accounts_login_identifier_unique').on(table.loginIdentifier)],
);
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('roles_key_unique').on(table.key)],
);
export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('permissions_key_unique').on(table.key)],
);
export const staffRoles = pgTable(
  'staff_roles',
  {
    staffAccountId: uuid('staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.staffAccountId, table.roleId], name: 'staff_roles_pk' }),
    index('staff_roles_role_id_idx').on(table.roleId),
  ],
);
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId], name: 'role_permissions_pk' }),
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
);
export const staffDataScopes = pgTable(
  'staff_data_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffAccountId: uuid('staff_account_id')
      .notNull()
      .references(() => staffAccounts.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull(),
    scopeId: uuid('scope_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'staff_data_scopes_scope_shape_check',
      sql`(${table.scopeType} = 'GLOBAL' and ${table.scopeId} is null) or (${table.scopeType} in ('REGION', 'FRANCHISEE', 'STORE') and ${table.scopeId} is not null)`,
    ),
    uniqueIndex('staff_data_scopes_staff_type_id_unique').on(
      table.staffAccountId,
      table.scopeType,
      table.scopeId,
    ),
    uniqueIndex('staff_data_scopes_staff_global_unique')
      .on(table.staffAccountId)
      .where(sql`${table.scopeType} = 'GLOBAL'`),
    index('staff_data_scopes_staff_account_id_idx').on(table.staffAccountId),
    index('staff_data_scopes_target_idx').on(table.scopeType, table.scopeId),
  ],
);

export const migrationBatches = pgTable(
  'migration_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type').notNull(),
    sourceReference: text('source_reference').notNull(),
    rawReference: text('raw_reference'),
    checksum: text('checksum').notNull(),
    status: text('status').notNull().default('STAGED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('migration_batches_source_checksum_unique').on(table.sourceType, table.checksum),
    check(
      'migration_batches_status_check',
      sql`${table.status} in ('STAGED', 'DRY_RUN', 'REVIEW', 'IMPORT_PLANNED', 'IMPORTED', 'RECONCILED', 'FAILED')`,
    ),
  ],
);

export const migrationBookStaging = pgTable(
  'migration_book_staging',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => migrationBatches.id, { onDelete: 'cascade' }),
    sourceRowNumber: integer('source_row_number').notNull(),
    rawValues: jsonb('raw_values').$type<Record<string, unknown>>().notNull(),
    normalizedValues: jsonb('normalized_values').$type<Record<string, unknown>>(),
    validationState: text('validation_state').notNull().default('PENDING'),
    importState: text('import_state').notNull().default('NOT_PLANNED'),
    issues: jsonb('issues')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    fingerprint: text('fingerprint'),
    normalizedPriceMinor: integer('normalized_price_minor'),
    normalizedInventory: integer('normalized_inventory'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('migration_book_staging_batch_row_unique').on(table.batchId, table.sourceRowNumber),
    index('migration_book_staging_batch_idx').on(table.batchId),
    check('migration_book_staging_source_row_positive', sql`${table.sourceRowNumber} > 0`),
    check(
      'migration_book_staging_price_nonnegative',
      sql`${table.normalizedPriceMinor} is null or ${table.normalizedPriceMinor} >= 0`,
    ),
    check(
      'migration_book_staging_inventory_nonnegative',
      sql`${table.normalizedInventory} is null or ${table.normalizedInventory} >= 0`,
    ),
    check(
      'migration_book_staging_validation_state_check',
      sql`${table.validationState} in ('PENDING', 'VALID', 'WARNING', 'ERROR', 'DUPLICATE', 'CONFLICT')`,
    ),
    check(
      'migration_book_staging_import_state_check',
      sql`${table.importState} in ('NOT_PLANNED', 'PLANNED', 'IMPORTED', 'SKIPPED', 'FAILED')`,
    ),
  ],
);
