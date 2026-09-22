import { eq, inArray, sql } from 'drizzle-orm';
import {
  createDatabase,
  permissions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  storeStaff,
  stores,
} from '@xiaohai/db';
import { normalizeStaffLoginIdentifier } from '../auth/staff-auth-service.js';
import { ScryptPasswordHasher } from '../auth/password.js';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type PermissionDefinition = {
  key: string;
  displayName: string;
};

const permissionDefinitions: PermissionDefinition[] = [
  { key: 'ai.manage', displayName: 'Manage AI jobs' },
  { key: 'audit.read', displayName: 'Read audit logs' },
  { key: 'catalog.manage', displayName: 'Manage catalog' },
  { key: 'cms.home.manage', displayName: 'Manage home CMS' },
  { key: 'commission.read', displayName: 'Read commission operations' },
  { key: 'commission.rules.manage', displayName: 'Manage commission rules' },
  { key: 'commission.settle', displayName: 'Settle commissions' },
  { key: 'commission.withdrawals.review', displayName: 'Review commission withdrawals' },
  { key: 'content.manage', displayName: 'Manage content' },
  { key: 'delivery.dispatch', displayName: 'Dispatch deliveries' },
  { key: 'delivery.manage', displayName: 'Manage delivery zones' },
  { key: 'finance.export', displayName: 'Export finance' },
  { key: 'finance.read', displayName: 'Read finance' },
  { key: 'finance.reconcile', displayName: 'Reconcile finance' },
  { key: 'franchise.assign', displayName: 'Assign franchise applications' },
  { key: 'franchise.followup', displayName: 'Record franchise follow-ups' },
  { key: 'franchise.manage', displayName: 'Manage franchise applications' },
  { key: 'franchise.read', displayName: 'Read franchise applications' },
  { key: 'franchise.review', displayName: 'Review franchise applications' },
  { key: 'fulfillment.pickup', displayName: 'Process pickup fulfillment' },
  { key: 'fulfillment.read', displayName: 'Read fulfillment' },
  { key: 'inventory.adjust', displayName: '库存调整' },
  { key: 'inventory.issue', displayName: '库存出库' },
  { key: 'inventory.read', displayName: '查看库存' },
  { key: 'inventory.receive', displayName: '采购入库' },
  { key: 'inventory.stocktake', displayName: '库存盘点' },
  { key: 'inventory.transfer', displayName: '库存调拨' },
  { key: 'orders.read', displayName: 'Read orders' },
  { key: 'payments.read', displayName: 'Read payments' },
  { key: 'payments.reconcile', displayName: 'Reconcile payments' },
  { key: 'payments.refund', displayName: 'Refund payments' },
  { key: 'procurement.manage', displayName: '采购管理' },
  { key: 'rental.checkout', displayName: '租借借出' },
  { key: 'rental.manage', displayName: '租借管理' },
  { key: 'rental.read', displayName: '查看租借' },
  { key: 'rental.return', displayName: '租借归还' },
  { key: 'staff.manage', displayName: 'Manage staff authorization' },
  { key: 'staff.read', displayName: 'Read staff authorization' },
  { key: 'stores.manage', displayName: 'Manage stores' },
  { key: 'stores.read', displayName: 'Read stores' },
  { key: 'users.read', displayName: 'Read users' },
];

const storePermissionKeys = [
  'stores.read',
  'stores.manage',
  'inventory.read',
  'inventory.issue',
  'inventory.adjust',
  'inventory.receive',
  'inventory.stocktake',
  'inventory.transfer',
  'procurement.manage',
  'rental.read',
  'rental.checkout',
  'rental.return',
  'rental.manage',
  'fulfillment.read',
  'fulfillment.pickup',
  'delivery.dispatch',
  'delivery.manage',
] as const;

const HQ_LOGIN = 'hq.admin';
const STORE_LOGIN = 'store.manager';
const HQ_ROLE_KEY = 'LOCAL_HQ_ADMIN';
const STORE_ROLE_KEY = 'LOCAL_STORE_MANAGER';
const DEFAULT_STORE_NAME = '胖竹书店南门店';

export interface LocalStaffSeedResult {
  hqLoginIdentifier: string;
  storeLoginIdentifier: string;
  storeId: string;
  storeName: string;
  hqPermissionCount: number;
  storePermissionCount: number;
}

export async function seedLocalStaff(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalStaffSeedResult> {
  assertLocalOnly(env);
  const hqPassword = requirePassword(env.LOCAL_HQ_STAFF_PASSWORD, 'LOCAL_HQ_STAFF_PASSWORD');
  const storePassword = requirePassword(
    env.LOCAL_STORE_STAFF_PASSWORD,
    'LOCAL_STORE_STAFF_PASSWORD',
  );
  const storeName = env.LOCAL_STORE_NAME?.trim() || DEFAULT_STORE_NAME;
  const { db, pool } = createDatabase(env);
  const hasher = new ScryptPasswordHasher();

  try {
    const [hqPasswordHash, storePasswordHash] = await Promise.all([
      hasher.hash(hqPassword),
      hasher.hash(storePassword),
    ]);

    return await db.transaction(async (tx) => {
      const matchingStores = await tx
        .select({ id: stores.id, name: stores.name })
        .from(stores)
        .where(eq(stores.name, storeName))
        .limit(2);
      if (matchingStores.length !== 1) {
        throw new Error(
          matchingStores.length === 0
            ? `Local store not found: ${storeName}`
            : `Local store name is ambiguous: ${storeName}`,
        );
      }
      const store = matchingStores[0]!;

      await tx.insert(permissions).values(permissionDefinitions).onConflictDoNothing();

      const permissionRows = await tx
        .select({ id: permissions.id, key: permissions.key })
        .from(permissions)
        .where(
          inArray(
            permissions.key,
            permissionDefinitions.map((item) => item.key),
          ),
        );
      const permissionByKey = new Map(permissionRows.map((row) => [row.key, row.id]));
      const missingPermissions = permissionDefinitions
        .map((item) => item.key)
        .filter((key) => !permissionByKey.has(key));
      if (missingPermissions.length) {
        throw new Error(`Failed to provision permissions: ${missingPermissions.join(', ')}`);
      }

      const hqRole = await upsertLocalRole(tx, HQ_ROLE_KEY, 'Local HQ Admin');
      const storeRole = await upsertLocalRole(tx, STORE_ROLE_KEY, 'Local Store Manager');
      const hqAccount = await upsertLocalAccount(tx, HQ_LOGIN, hqPasswordHash);
      const storeAccount = await upsertLocalAccount(tx, STORE_LOGIN, storePasswordHash);

      await tx
        .delete(rolePermissions)
        .where(inArray(rolePermissions.roleId, [hqRole.id, storeRole.id]));
      await tx.insert(rolePermissions).values([
        ...permissionDefinitions.map((item) => ({
          roleId: hqRole.id,
          permissionId: permissionByKey.get(item.key)!,
        })),
        ...storePermissionKeys.map((key) => ({
          roleId: storeRole.id,
          permissionId: permissionByKey.get(key)!,
        })),
      ]);

      await tx
        .delete(staffRoles)
        .where(inArray(staffRoles.staffAccountId, [hqAccount.id, storeAccount.id]));
      await tx.insert(staffRoles).values([
        { staffAccountId: hqAccount.id, roleId: hqRole.id },
        { staffAccountId: storeAccount.id, roleId: storeRole.id },
      ]);

      await tx
        .delete(staffDataScopes)
        .where(inArray(staffDataScopes.staffAccountId, [hqAccount.id, storeAccount.id]));
      await tx.insert(staffDataScopes).values([
        { staffAccountId: hqAccount.id, scopeType: 'GLOBAL', scopeId: null },
        { staffAccountId: storeAccount.id, scopeType: 'STORE', scopeId: store.id },
      ]);

      await tx.delete(storeStaff).where(eq(storeStaff.staffAccountId, storeAccount.id));
      await tx
        .insert(storeStaff)
        .values({ storeId: store.id, staffAccountId: storeAccount.id })
        .onConflictDoNothing();

      return {
        hqLoginIdentifier: normalizeStaffLoginIdentifier(HQ_LOGIN),
        storeLoginIdentifier: normalizeStaffLoginIdentifier(STORE_LOGIN),
        storeId: store.id,
        storeName: store.name,
        hqPermissionCount: permissionDefinitions.length,
        storePermissionCount: storePermissionKeys.length,
      };
    });
  } finally {
    await pool.end();
  }
}

function assertLocalOnly(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' || env.APP_ENV === 'prod' || env.APP_ENV === 'production') {
    throw new Error('Local Staff seed refuses to run in a production environment');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  let hostname: string;
  try {
    hostname = new URL(env.DATABASE_URL).hostname;
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(`Local Staff seed refuses non-local database host: ${hostname}`);
  }
}

function requirePassword(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  if (value.length < 8) throw new Error(`${name} must be at least 8 characters`);
  return value;
}

async function upsertLocalRole(tx: Transaction, key: string, displayName: string) {
  const now = new Date();
  const [row] = await tx
    .insert(roles)
    .values({
      key,
      displayName,
      description: 'Local development only; provisioned by seed:local-staff',
    })
    .onConflictDoUpdate({
      target: roles.key,
      set: {
        displayName,
        description: 'Local development only; provisioned by seed:local-staff',
        updatedAt: now,
      },
    })
    .returning({ id: roles.id });
  if (!row) throw new Error(`Failed to provision local role: ${key}`);
  return row;
}

async function upsertLocalAccount(tx: Transaction, loginIdentifier: string, passwordHash: string) {
  const normalized = normalizeStaffLoginIdentifier(loginIdentifier);
  const [existing] = await tx
    .select({ id: staffAccounts.id })
    .from(staffAccounts)
    .where(eq(staffAccounts.loginIdentifier, normalized))
    .limit(1);

  if (existing) {
    const [updated] = await tx
      .update(staffAccounts)
      .set({
        passwordHash,
        enabled: true,
        sessionVersion: sql`${staffAccounts.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(staffAccounts.id, existing.id))
      .returning({ id: staffAccounts.id });
    if (!updated) throw new Error(`Failed to update local Staff account: ${normalized}`);
    return updated;
  }

  const [created] = await tx
    .insert(staffAccounts)
    .values({ loginIdentifier: normalized, passwordHash, enabled: true })
    .returning({ id: staffAccounts.id });
  if (!created) throw new Error(`Failed to create local Staff account: ${normalized}`);
  return created;
}
