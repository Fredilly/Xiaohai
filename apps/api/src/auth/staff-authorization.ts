import { eq } from 'drizzle-orm';
import {
  permissions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  type createDatabase,
} from '@xiaohai/db';
import { ConsumerAuthError } from './errors.js';
import type { StaffSessionService } from './staff-session.js';

type Database = ReturnType<typeof createDatabase>['db'];

export const staffDataScopeTypes = ['GLOBAL', 'REGION', 'FRANCHISEE', 'STORE'] as const;
export type StaffDataScopeType = (typeof staffDataScopeTypes)[number];

export interface StaffDataScope {
  type: StaffDataScopeType;
  id: string | null;
}

export interface StaffAuthorizationContext {
  staffAccountId: string;
  loginIdentifier: string;
  permissions: string[];
  dataScopes: StaffDataScope[];
}

export interface StaffAuthorizationRecord extends StaffAuthorizationContext {
  sessionVersion: number;
}

export interface StaffAuthorizationRepository {
  loadContext(staffAccountId: string): Promise<StaffAuthorizationRecord | null>;
}

export class DrizzleStaffAuthorizationRepository implements StaffAuthorizationRepository {
  constructor(private readonly db: Database) {}

  async loadContext(staffAccountId: string): Promise<StaffAuthorizationRecord | null> {
    const [staff] = await this.db
      .select({
        id: staffAccounts.id,
        loginIdentifier: staffAccounts.loginIdentifier,
        sessionVersion: staffAccounts.sessionVersion,
        enabled: staffAccounts.enabled,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, staffAccountId))
      .limit(1);

    if (!staff?.enabled) return null;

    const permissionRows = await this.db
      .select({ key: permissions.key })
      .from(staffRoles)
      .innerJoin(roles, eq(staffRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(staffRoles.staffAccountId, staffAccountId));

    const scopeRows = await this.db
      .select({ type: staffDataScopes.scopeType, id: staffDataScopes.scopeId })
      .from(staffDataScopes)
      .where(eq(staffDataScopes.staffAccountId, staffAccountId));

    const permissionKeys = [...new Set(permissionRows.map((row) => row.key))].sort();
    const dataScopes = scopeRows
      .filter((row): row is { type: StaffDataScopeType; id: string | null } =>
        staffDataScopeTypes.includes(row.type as StaffDataScopeType),
      )
      .map((row) => ({ type: row.type, id: row.id }));

    return {
      staffAccountId: staff.id,
      loginIdentifier: staff.loginIdentifier,
      sessionVersion: staff.sessionVersion,
      permissions: permissionKeys,
      dataScopes,
    };
  }
}

export class StaffAuthorizationService {
  constructor(
    private readonly repository: StaffAuthorizationRepository,
    private readonly sessions: StaffSessionService,
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<StaffAuthorizationContext> {
    const token = readBearerToken(authorizationHeader);
    const claims = token ? this.sessions.verify(token) : null;
    if (!claims) throw new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401);

    const record = await this.repository.loadContext(claims.staffAccountId);
    if (!record || record.sessionVersion !== claims.sessionVersion) {
      throw new ConsumerAuthError('STAFF_AUTHENTICATION_REQUIRED', 401);
    }

    return {
      staffAccountId: record.staffAccountId,
      loginIdentifier: record.loginIdentifier,
      permissions: record.permissions,
      dataScopes: record.dataScopes,
    };
  }

  hasPermission(context: StaffAuthorizationContext, permissionKey: string): boolean {
    return context.permissions.includes(permissionKey);
  }

  requirePermission(context: StaffAuthorizationContext, permissionKey: string): void {
    if (!this.hasPermission(context, permissionKey)) {
      throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
    }
  }

  canAccessScope(
    context: StaffAuthorizationContext,
    targetType: StaffDataScopeType,
    targetId: string | null,
  ): boolean {
    if (context.dataScopes.some((scope) => scope.type === 'GLOBAL')) return true;
    if (targetType === 'GLOBAL') return false;
    if (!targetId) return false;

    return context.dataScopes.some(
      (scope) => scope.type === targetType && scope.id !== null && scope.id === targetId,
    );
  }

  requireDataScope(
    context: StaffAuthorizationContext,
    targetType: StaffDataScopeType,
    targetId: string | null,
  ): void {
    if (!this.canAccessScope(context, targetType, targetId)) {
      throw new ConsumerAuthError('STAFF_FORBIDDEN', 403);
    }
  }
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
