import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  permissions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;
const sessionSecret = 'staff-rbac-integration-secret-at-least-32-characters';
const storeA = '11111111-1111-4111-8111-111111111111';
const storeB = '22222222-2222-4222-8222-222222222222';

testSuite('staff RBAC and Data Scope PostgreSQL integration', () => {
  const sessions = new StaffSessionService(sessionSecret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );

  beforeEach(async () => {
    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);
  });

  afterAll(async () => database?.pool.end());

  async function createStaff() {
    const [staff] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: 'rbac@example.com', passwordHash: 'test-only-not-a-login-hash' })
      .returning({ id: staffAccounts.id });
    return staff!.id;
  }

  async function createPermission(key: string) {
    const [permission] = await database!.db
      .insert(permissions)
      .values({ key, displayName: key })
      .returning({ id: permissions.id });
    return permission!.id;
  }

  async function createRole(key: string) {
    const [role] = await database!.db
      .insert(roles)
      .values({ key, displayName: key })
      .returning({ id: roles.id });
    return role!.id;
  }

  it('merges permissions from multiple roles and exposes server-resolved context', async () => {
    const staffId = await createStaff();
    const readPermissionId = await createPermission('catalog.read');
    const writePermissionId = await createPermission('catalog.write');
    const readerRoleId = await createRole('reader');
    const writerRoleId = await createRole('writer');
    await database!.db.insert(rolePermissions).values([
      { roleId: readerRoleId, permissionId: readPermissionId },
      { roleId: writerRoleId, permissionId: writePermissionId },
    ]);
    await database!.db.insert(staffRoles).values([
      { staffAccountId: staffId, roleId: readerRoleId },
      { staffAccountId: staffId, roleId: writerRoleId },
    ]);
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staffId,
      scopeType: 'STORE',
      scopeId: storeA,
    });

    const app = buildApp({ staffAuthorization: authorization, logger: false });
    const token = sessions.issue(staffId).token;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      staff: { id: staffId, loginIdentifier: 'rbac@example.com' },
      permissions: ['catalog.read', 'catalog.write'],
      dataScopes: [{ type: 'STORE', id: storeA }],
    });
    await app.close();
  });

  it('distinguishes missing/invalid/Consumer authentication as 401', async () => {
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    const consumerToken = new ConsumerSessionService(sessionSecret, 300).issue(
      '33333333-3333-4333-8333-333333333333',
    ).token;

    for (const authorizationHeader of [undefined, 'Bearer invalid.token', `Bearer ${consumerToken}`]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/me',
        headers: authorizationHeader ? { authorization: authorizationHeader } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('STAFF_AUTHENTICATION_REQUIRED');
    }
    await app.close();
  });

  it('revokes authorization immediately when role or permission assignment is removed', async () => {
    const staffId = await createStaff();
    const permissionId = await createPermission('staff.profile.read');
    const roleId = await createRole('staff-reader');
    await database!.db.insert(rolePermissions).values({ roleId, permissionId });
    await database!.db.insert(staffRoles).values({ staffAccountId: staffId, roleId });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staffId,
      scopeType: 'GLOBAL',
      scopeId: null,
    });
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    const token = sessions.issue(staffId).token;
    const url = '/api/v1/staff/authorization/probe?permission=staff.profile.read&scopeType=GLOBAL';

    expect(
      (await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }))
        .statusCode,
    ).toBe(200);

    await database!.db
      .delete(rolePermissions)
      .where(eq(rolePermissions.permissionId, permissionId));
    let response = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('STAFF_FORBIDDEN');

    await database!.db.insert(rolePermissions).values({ roleId, permissionId });
    await database!.db.delete(staffRoles).where(eq(staffRoles.staffAccountId, staffId));
    response = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('returns 401 after the Staff account is disabled', async () => {
    const staffId = await createStaff();
    const token = sessions.issue(staffId).token;
    await database!.db
      .update(staffAccounts)
      .set({ enabled: false })
      .where(eq(staffAccounts.id, staffId));
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('enforces exact STORE scope, GLOBAL override, no-scope deny, and client store forgery cannot grant access', async () => {
    const staffId = await createStaff();
    const permissionId = await createPermission('scope.probe');
    const roleId = await createRole('scope-reader');
    await database!.db.insert(rolePermissions).values({ roleId, permissionId });
    await database!.db.insert(staffRoles).values({ staffAccountId: staffId, roleId });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staffId,
      scopeType: 'STORE',
      scopeId: storeA,
    });
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    const token = sessions.issue(staffId).token;
    const request = (scopeId: string) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/staff/authorization/probe?permission=scope.probe&scopeType=STORE&scopeId=${scopeId}`,
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await request(storeA)).statusCode).toBe(200);
    expect((await request(storeB)).statusCode).toBe(403);

    await database!.db.delete(staffDataScopes).where(eq(staffDataScopes.staffAccountId, staffId));
    expect((await request(storeA)).statusCode).toBe(403);

    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staffId,
      scopeType: 'GLOBAL',
      scopeId: null,
    });
    expect((await request(storeB)).statusCode).toBe(200);
    await app.close();
  });

  it('enforces uniqueness, foreign keys, and Data Scope shape constraints', async () => {
    const staffId = await createStaff();
    await database!.db.insert(roles).values({ key: 'unique-role', displayName: 'Unique role' });
    await expect(
      database!.db.insert(roles).values({ key: 'unique-role', displayName: 'Duplicate role' }),
    ).rejects.toBeDefined();
    await expect(
      database!.db.insert(staffDataScopes).values({
        staffAccountId: staffId,
        scopeType: 'STORE',
        scopeId: null,
      }),
    ).rejects.toBeDefined();
    await expect(
      database!.db.insert(staffRoles).values({
        staffAccountId: staffId,
        roleId: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toBeDefined();
  });
});
