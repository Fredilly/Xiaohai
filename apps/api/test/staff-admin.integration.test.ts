import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  staffAdminAccountSchema,
  staffAdminListResponseSchema,
  staffAdminOkSchema,
} from '@xiaohai/contracts/staff-admin';
import {
  auditLogs,
  createDatabase,
  permissions,
  regions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  stores,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { ScryptPasswordHasher } from '../src/auth/password.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerStaffAdminRoutes } from '../src/hq/staff-admin-routes.js';
import { StaffAdminService } from '../src/hq/staff-admin-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
const sessionSecret = 'm20-staff-admin-integration-secret-at-least-32-characters';
const errorResponseSchema = z.object({ error: z.object({ code: z.string() }) });

suite('M20 Staff administration PostgreSQL integration', () => {
  const sessions = new StaffSessionService(sessionSecret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );
  const passwordHasher = new ScryptPasswordHasher();
  const staffAdmin = new StaffAdminService(database!.db, passwordHasher);

  beforeAll(async () => {
    if (!database) return;
    await database.db.delete(auditLogs);
  });

  afterAll(async () => {
    if (!database) return;
    await database.db.delete(auditLogs);
    await database.pool.end();
  });

  function makeApp() {
    const app = buildApp({ logger: false });
    registerStaffAdminRoutes(app, { staffAdmin, staffAuthorization: authorization });
    return app;
  }

  async function ensurePermission(key: string) {
    const [row] = await database!.db
      .insert(permissions)
      .values({ key, displayName: key })
      .onConflictDoUpdate({ target: permissions.key, set: { displayName: key } })
      .returning({ id: permissions.id });
    return row!.id;
  }

  async function createRole(permissionKeys: string[]) {
    const suffix = randomUUID().slice(0, 8);
    const [role] = await database!.db
      .insert(roles)
      .values({ key: `m20-staff-${suffix}`, displayName: `M20 Staff ${suffix}` })
      .returning({ id: roles.id });
    const permissionIds = await Promise.all(permissionKeys.map(ensurePermission));
    if (permissionIds.length > 0) {
      await database!.db
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId: role!.id, permissionId })));
    }
    return role!;
  }

  async function createStaff(
    permissionKeys: string[],
    scope: { type: 'GLOBAL'; id: null } | { type: 'STORE'; id: string } = {
      type: 'GLOBAL',
      id: null,
    },
  ) {
    const suffix = randomUUID().slice(0, 8);
    const [staff] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: `m20-staff-${suffix}@example.com`,
        passwordHash: 'test-only-not-a-login-hash',
      })
      .returning({ id: staffAccounts.id });
    const role = await createRole(permissionKeys);
    await database!.db.insert(staffRoles).values({ staffAccountId: staff!.id, roleId: role.id });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staff!.id,
      scopeType: scope.type,
      scopeId: scope.id,
    });
    return { id: staff!.id, roleId: role.id, token: sessions.issue(staff!.id).token };
  }

  async function createStore() {
    const suffix = randomUUID().slice(0, 8);
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: `M20-STAFF-R-${suffix}`,
        name: `M20 Staff Region ${suffix}`,
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    const [store] = await database!.db
      .insert(stores)
      .values({
        code: `M20-STAFF-S-${suffix}`,
        regionId: region!.id,
        name: `M20 Staff Store ${suffix}`,
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'M20 Staff Test Road',
        latitude: 30.57,
        longitude: 104.06,
      })
      .returning({ id: stores.id });
    return store!.id;
  }

  function bearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function errorCode(response: { json(): unknown }) {
    return errorResponseSchema.parse(response.json()).error.code;
  }

  it('requires explicit Staff permissions and GLOBAL Data Scope', async () => {
    const app = makeApp();
    const noPermission = await createStaff([]);
    const storeScoped = await createStaff(['staff.read'], {
      type: 'STORE',
      id: randomUUID(),
    });
    const reader = await createStaff(['staff.read']);
    const noManage = await createStaff(['staff.read']);

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/staff/admin/accounts' })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/admin/accounts',
          headers: bearer(noPermission.token),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/admin/accounts',
          headers: bearer(storeScoped.token),
        })
      ).statusCode,
    ).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/admin/accounts?limit=20',
      headers: bearer(reader.token),
    });
    expect(list.statusCode).toBe(200);
    expect(staffAdminListResponseSchema.parse(list.json()).items.length).toBeGreaterThan(0);

    const deniedWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(noManage.token),
      payload: {
        loginIdentifier: `denied-${randomUUID().slice(0, 8)}@example.com`,
        password: 'a-secure-passphrase',
        enabled: true,
      },
    });
    expect(deniedWrite.statusCode).toBe(403);

    await app.close();
  });

  it('creates Staff and resets password without exposing password material', async () => {
    const app = makeApp();
    const actor = await createStaff(['staff.read', 'staff.manage']);
    const loginIdentifier = `created-${randomUUID().slice(0, 8)}@example.com`;
    const initialPassword = 'initial-secure-passphrase';
    const resetPassword = 'reset-secure-passphrase';

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(actor.token),
      payload: { loginIdentifier, password: initialPassword, enabled: true },
    });
    expect(createdResponse.statusCode).toBe(201);
    const rawCreated: unknown = createdResponse.json();
    expect(rawCreated).not.toHaveProperty('passwordHash');
    expect(rawCreated).not.toHaveProperty('password');
    const created = staffAdminAccountSchema.parse(rawCreated);
    expect(created).toMatchObject({ loginIdentifier, enabled: true, roles: [], dataScopes: [] });

    const [stored] = await database!.db
      .select({ passwordHash: staffAccounts.passwordHash })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, created.id))
      .limit(1);
    expect(stored).toBeDefined();
    expect(stored!.passwordHash).not.toBe(initialPassword);
    expect(await passwordHasher.verify(initialPassword, stored!.passwordHash)).toBe(true);

    const preResetToken = sessions.issue(created.id).token;
    await expect(authorization.authenticate(`Bearer ${preResetToken}`)).resolves.toMatchObject({
      staffAccountId: created.id,
    });

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/admin/accounts/${created.id}/reset-password`,
      headers: bearer(actor.token),
      payload: { password: resetPassword },
    });
    expect(reset.statusCode).toBe(200);
    expect(staffAdminOkSchema.parse(reset.json())).toEqual({ ok: true });

    const [afterReset] = await database!.db
      .select({ passwordHash: staffAccounts.passwordHash })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, created.id))
      .limit(1);
    expect(afterReset).toBeDefined();
    expect(await passwordHasher.verify(initialPassword, afterReset!.passwordHash)).toBe(false);
    expect(await passwordHasher.verify(resetPassword, afterReset!.passwordHash)).toBe(true);

    await expect(authorization.authenticate(`Bearer ${preResetToken}`)).rejects.toMatchObject({
      code: 'STAFF_AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });

    await app.close();
  });

  it('applies Role and Data Scope revocation on the next request', async () => {
    const app = makeApp();
    const actor = await createStaff(['staff.read', 'staff.manage']);
    const target = await createStaff(['staff.read']);

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(target.token),
    });
    expect(before.statusCode).toBe(200);

    const emptyRole = await createRole([]);
    const removedRole = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${target.id}/roles`,
      headers: bearer(actor.token),
      payload: { roleIds: [emptyRole.id] },
    });
    expect(removedRole.statusCode).toBe(200);
    expect(staffAdminAccountSchema.parse(removedRole.json()).roles[0]?.id).toBe(emptyRole.id);

    const afterRoleRevocation = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(target.token),
    });
    expect(afterRoleRevocation.statusCode).toBe(403);

    const restoredRole = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${target.id}/roles`,
      headers: bearer(actor.token),
      payload: { roleIds: [target.roleId] },
    });
    expect(restoredRole.statusCode).toBe(200);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/admin/accounts',
          headers: bearer(target.token),
        })
      ).statusCode,
    ).toBe(200);

    const storeId = await createStore();
    const scoped = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${target.id}/data-scopes`,
      headers: bearer(actor.token),
      payload: { dataScopes: [{ type: 'STORE', id: storeId }] },
    });
    expect(scoped.statusCode).toBe(200);
    expect(staffAdminAccountSchema.parse(scoped.json()).dataScopes).toEqual([
      { type: 'STORE', id: storeId },
    ]);

    const afterScopeRevocation = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(target.token),
    });
    expect(afterScopeRevocation.statusCode).toBe(403);

    await app.close();
  });

  it('prevents self-lockout, rejects invalid references, and disables access immediately', async () => {
    const app = makeApp();
    const actor = await createStaff(['staff.read', 'staff.manage']);
    const target = await createStaff(['staff.read']);

    const selfDisable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/admin/accounts/${actor.id}/enabled`,
      headers: bearer(actor.token),
      payload: { enabled: false },
    });
    expect(selfDisable.statusCode).toBe(409);
    expect(errorCode(selfDisable)).toBe('SELF_LOCKOUT');

    const selfRoles = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${actor.id}/roles`,
      headers: bearer(actor.token),
      payload: { roleIds: [] },
    });
    expect(selfRoles.statusCode).toBe(409);
    expect(errorCode(selfRoles)).toBe('SELF_LOCKOUT');

    const selfScopes = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${actor.id}/data-scopes`,
      headers: bearer(actor.token),
      payload: { dataScopes: [] },
    });
    expect(selfScopes.statusCode).toBe(409);
    expect(errorCode(selfScopes)).toBe('SELF_LOCKOUT');

    const invalidRole = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${target.id}/roles`,
      headers: bearer(actor.token),
      payload: { roleIds: [randomUUID()] },
    });
    expect(invalidRole.statusCode).toBe(400);
    expect(errorCode(invalidRole)).toBe('INVALID_REFERENCE');

    const invalidScope = await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/admin/accounts/${target.id}/data-scopes`,
      headers: bearer(actor.token),
      payload: { dataScopes: [{ type: 'STORE', id: randomUUID() }] },
    });
    expect(invalidScope.statusCode).toBe(400);
    expect(errorCode(invalidScope)).toBe('INVALID_REFERENCE');

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/admin/accounts/${target.id}/enabled`,
      headers: bearer(actor.token),
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(staffAdminAccountSchema.parse(disabled.json()).enabled).toBe(false);

    const afterDisable = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(target.token),
    });
    expect(afterDisable.statusCode).toBe(401);

    await app.close();
  });
});
