import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import type {
  StaffAdminCreateAccount,
  StaffAdminListQuery,
  StaffAdminReplaceDataScopes,
  StaffAdminReplaceRoles,
} from '@xiaohai/contracts/staff-admin';
import {
  franchisees,
  permissions,
  regions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  stores,
  type createDatabase,
} from '@xiaohai/db';
import { staffDataScopeTypes, type StaffDataScopeType } from '../auth/staff-authorization.js';
import type { PasswordHasher } from '../auth/password.js';

type Database = ReturnType<typeof createDatabase>['db'];

type StaffRow = {
  id: string;
  loginIdentifier: string;
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export class StaffAdminError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REFERENCE' | 'SELF_LOCKOUT') {
    super(code);
  }
}

export class StaffAdminService {
  constructor(
    private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async listStaff(input: StaffAdminListQuery) {
    const rows = await this.db
      .select({
        id: staffAccounts.id,
        loginIdentifier: staffAccounts.loginIdentifier,
        enabled: staffAccounts.enabled,
        lastLoginAt: staffAccounts.lastLoginAt,
        createdAt: staffAccounts.createdAt,
        updatedAt: staffAccounts.updatedAt,
      })
      .from(staffAccounts)
      .where(
        and(
          input.q ? ilike(staffAccounts.loginIdentifier, `%${input.q}%`) : undefined,
          input.enabled === undefined ? undefined : eq(staffAccounts.enabled, input.enabled),
        ),
      )
      .orderBy(desc(staffAccounts.createdAt))
      .limit(input.limit);

    return { items: await this.enrichStaff(rows) };
  }

  async getStaff(id: string) {
    const [row] = await this.db
      .select({
        id: staffAccounts.id,
        loginIdentifier: staffAccounts.loginIdentifier,
        enabled: staffAccounts.enabled,
        lastLoginAt: staffAccounts.lastLoginAt,
        createdAt: staffAccounts.createdAt,
        updatedAt: staffAccounts.updatedAt,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, id))
      .limit(1);
    if (!row) throw new StaffAdminError('NOT_FOUND');
    return (await this.enrichStaff([row]))[0]!;
  }

  async createStaff(input: StaffAdminCreateAccount) {
    const now = new Date();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const [created] = await this.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: input.loginIdentifier,
        passwordHash,
        enabled: input.enabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: staffAccounts.loginIdentifier })
      .returning({ id: staffAccounts.id });
    if (!created) throw new StaffAdminError('CONFLICT');
    return this.getStaff(created.id);
  }

  async setEnabled(id: string, enabled: boolean, actorStaffAccountId: string) {
    if (id === actorStaffAccountId && !enabled) throw new StaffAdminError('SELF_LOCKOUT');
    const [updated] = await this.db
      .update(staffAccounts)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(staffAccounts.id, id))
      .returning({ id: staffAccounts.id });
    if (!updated) throw new StaffAdminError('NOT_FOUND');
    return this.getStaff(id);
  }

  async resetPassword(id: string, password: string) {
    const passwordHash = await this.passwordHasher.hash(password);
    const [updated] = await this.db
      .update(staffAccounts)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(staffAccounts.id, id))
      .returning({ id: staffAccounts.id });
    if (!updated) throw new StaffAdminError('NOT_FOUND');
    return { ok: true as const };
  }

  async replaceRoles(id: string, input: StaffAdminReplaceRoles, actorStaffAccountId: string) {
    if (id === actorStaffAccountId) throw new StaffAdminError('SELF_LOCKOUT');
    await this.ensureStaffExists(id);
    await this.ensureRolesExist(input.roleIds);

    await this.db.transaction(async (tx) => {
      await tx.delete(staffRoles).where(eq(staffRoles.staffAccountId, id));
      if (input.roleIds.length > 0) {
        await tx.insert(staffRoles).values(
          input.roleIds.map((roleId) => ({
            staffAccountId: id,
            roleId,
          })),
        );
      }
      await tx.update(staffAccounts).set({ updatedAt: new Date() }).where(eq(staffAccounts.id, id));
    });

    return this.getStaff(id);
  }

  async replaceDataScopes(
    id: string,
    input: StaffAdminReplaceDataScopes,
    actorStaffAccountId: string,
  ) {
    if (id === actorStaffAccountId) throw new StaffAdminError('SELF_LOCKOUT');
    await this.ensureStaffExists(id);
    await this.ensureScopeTargetsExist(input.dataScopes);

    await this.db.transaction(async (tx) => {
      await tx.delete(staffDataScopes).where(eq(staffDataScopes.staffAccountId, id));
      if (input.dataScopes.length > 0) {
        await tx.insert(staffDataScopes).values(
          input.dataScopes.map((scope) => ({
            staffAccountId: id,
            scopeType: scope.type,
            scopeId: scope.id,
          })),
        );
      }
      await tx.update(staffAccounts).set({ updatedAt: new Date() }).where(eq(staffAccounts.id, id));
    });

    return this.getStaff(id);
  }

  async listRoles() {
    const roleRows = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        displayName: roles.displayName,
        description: roles.description,
      })
      .from(roles)
      .orderBy(roles.key);

    if (roleRows.length === 0) return { items: [] };

    const permissionRows = await this.db
      .select({
        roleId: rolePermissions.roleId,
        id: permissions.id,
        key: permissions.key,
        displayName: permissions.displayName,
        description: permissions.description,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        inArray(
          rolePermissions.roleId,
          roleRows.map((role) => role.id),
        ),
      );

    const permissionsByRole = new Map<string, typeof permissionRows>();
    for (const permission of permissionRows) {
      const bucket = permissionsByRole.get(permission.roleId) ?? [];
      bucket.push(permission);
      permissionsByRole.set(permission.roleId, bucket);
    }

    return {
      items: roleRows.map((role) => ({
        ...role,
        permissions: (permissionsByRole.get(role.id) ?? [])
          .map((permission) => ({
            id: permission.id,
            key: permission.key,
            displayName: permission.displayName,
            description: permission.description,
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      })),
    };
  }

  async listPermissions() {
    return {
      items: await this.db
        .select({
          id: permissions.id,
          key: permissions.key,
          displayName: permissions.displayName,
          description: permissions.description,
        })
        .from(permissions)
        .orderBy(permissions.key),
    };
  }

  private async ensureStaffExists(id: string) {
    const [row] = await this.db
      .select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, id))
      .limit(1);
    if (!row) throw new StaffAdminError('NOT_FOUND');
  }

  private async ensureRolesExist(roleIds: string[]) {
    if (roleIds.length === 0) return;
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.id, roleIds));
    if (rows.length !== roleIds.length) throw new StaffAdminError('INVALID_REFERENCE');
  }

  private async ensureScopeTargetsExist(scopes: StaffAdminReplaceDataScopes['dataScopes']) {
    const regionIds = scopes
      .filter((scope) => scope.type === 'REGION')
      .map((scope) => scope.id)
      .filter((id): id is string => id !== null);
    const franchiseeIds = scopes
      .filter((scope) => scope.type === 'FRANCHISEE')
      .map((scope) => scope.id)
      .filter((id): id is string => id !== null);
    const storeIds = scopes
      .filter((scope) => scope.type === 'STORE')
      .map((scope) => scope.id)
      .filter((id): id is string => id !== null);

    const [regionRows, franchiseeRows, storeRows] = await Promise.all([
      regionIds.length
        ? this.db.select({ id: regions.id }).from(regions).where(inArray(regions.id, regionIds))
        : Promise.resolve([]),
      franchiseeIds.length
        ? this.db
            .select({ id: franchisees.id })
            .from(franchisees)
            .where(inArray(franchisees.id, franchiseeIds))
        : Promise.resolve([]),
      storeIds.length
        ? this.db.select({ id: stores.id }).from(stores).where(inArray(stores.id, storeIds))
        : Promise.resolve([]),
    ]);

    if (
      regionRows.length !== regionIds.length ||
      franchiseeRows.length !== franchiseeIds.length ||
      storeRows.length !== storeIds.length
    ) {
      throw new StaffAdminError('INVALID_REFERENCE');
    }
  }

  private async enrichStaff(rows: StaffRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);

    const [roleRows, scopeRows] = await Promise.all([
      this.db
        .select({
          staffAccountId: staffRoles.staffAccountId,
          id: roles.id,
          key: roles.key,
          displayName: roles.displayName,
        })
        .from(staffRoles)
        .innerJoin(roles, eq(staffRoles.roleId, roles.id))
        .where(inArray(staffRoles.staffAccountId, ids)),
      this.db
        .select({
          staffAccountId: staffDataScopes.staffAccountId,
          type: staffDataScopes.scopeType,
          id: staffDataScopes.scopeId,
        })
        .from(staffDataScopes)
        .where(inArray(staffDataScopes.staffAccountId, ids)),
    ]);

    const rolesByStaff = new Map<string, Array<{ id: string; key: string; displayName: string }>>();
    for (const role of roleRows) {
      const bucket = rolesByStaff.get(role.staffAccountId) ?? [];
      bucket.push({ id: role.id, key: role.key, displayName: role.displayName });
      rolesByStaff.set(role.staffAccountId, bucket);
    }

    const scopesByStaff = new Map<string, Array<{ type: StaffDataScopeType; id: string | null }>>();
    for (const scope of scopeRows) {
      const type = scope.type as StaffDataScopeType;
      if (!staffDataScopeTypes.includes(type)) continue;
      const bucket = scopesByStaff.get(scope.staffAccountId) ?? [];
      bucket.push({ type, id: scope.id });
      scopesByStaff.set(scope.staffAccountId, bucket);
    }

    return rows.map((row) => ({
      id: row.id,
      loginIdentifier: row.loginIdentifier,
      enabled: row.enabled,
      roles: (rolesByStaff.get(row.id) ?? []).sort((a, b) => a.key.localeCompare(b.key)),
      dataScopes: (scopesByStaff.get(row.id) ?? []).sort((a, b) =>
        `${a.type}:${a.id ?? ''}`.localeCompare(`${b.type}:${b.id ?? ''}`),
      ),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
