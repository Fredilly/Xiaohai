import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import type { StaffAdminListQuery } from '@xiaohai/contracts/staff-admin';
import {
  permissions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  type createDatabase,
} from '@xiaohai/db';
import {
  staffDataScopeTypes,
  type StaffDataScopeType,
} from '../auth/staff-authorization.js';

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
  constructor(readonly code: 'NOT_FOUND') {
    super(code);
  }
}

export class StaffAdminService {
  constructor(private readonly db: Database) {}

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
      .where(inArray(rolePermissions.roleId, roleRows.map((role) => role.id)));

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
          .map(({ roleId: _roleId, ...permission }) => permission)
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

    const scopesByStaff = new Map<
      string,
      Array<{ type: StaffDataScopeType; id: string | null }>
    >();
    for (const scope of scopeRows) {
      if (!staffDataScopeTypes.includes(scope.type as StaffDataScopeType)) continue;
      const bucket = scopesByStaff.get(scope.staffAccountId) ?? [];
      bucket.push({ type: scope.type as StaffDataScopeType, id: scope.id });
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
