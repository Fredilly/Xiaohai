import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogListResponseSchema } from '@xiaohai/contracts/audit';
import {
  auditLogs,
  createDatabase,
  permissions,
  rolePermissions,
  roles,
  staffAccounts,
  staffDataScopes,
  staffRoles,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { ScryptPasswordHasher } from '../src/auth/password.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerAuditRoutes } from '../src/hq/audit-routes.js';
import { AuditService } from '../src/hq/audit-service.js';
import { registerStaffAdminRoutes } from '../src/hq/staff-admin-routes.js';
import { StaffAdminService } from '../src/hq/staff-admin-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
const sessionSecret = 'm20-audit-integration-secret-at-least-32-characters';
const errorResponseSchema = z.object({ error: z.object({ code: z.string() }) });

suite('M20 operational audit PostgreSQL integration', () => {
  const sessions = new StaffSessionService(sessionSecret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );
  const passwordHasher = new ScryptPasswordHasher();
  const staffAdmin = new StaffAdminService(database!.db, passwordHasher);
  const audit = new AuditService(database!.db);

  afterAll(async () => database?.pool.end());

  function makeApp() {
    const app = buildApp({ logger: false });
    registerStaffAdminRoutes(app, { staffAdmin, staffAuthorization: authorization });
    registerAuditRoutes(app, { audit, staffAuthorization: authorization });
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
      .values({ key: `m20-audit-${suffix}`, displayName: `M20 Audit ${suffix}` })
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
        loginIdentifier: `m20-audit-${suffix}@example.com`,
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
    return { id: staff!.id, token: sessions.issue(staff!.id).token };
  }

  function bearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function errorCode(response: { json(): unknown }) {
    return errorResponseSchema.parse(response.json()).error.code;
  }

  it('requires audit.read and GLOBAL Data Scope', async () => {
    const app = makeApp();
    const noPermission = await createStaff([]);
    const storeScoped = await createStaff(['audit.read'], { type: 'STORE', id: randomUUID() });
    const reader = await createStaff(['audit.read']);

    expect((await app.inject({ method: 'GET', url: '/api/v1/staff/audit-logs' })).statusCode).toBe(
      401,
    );

    const forbiddenPermission = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/audit-logs',
      headers: bearer(noPermission.token),
    });
    expect(forbiddenPermission.statusCode).toBe(403);
    expect(errorCode(forbiddenPermission)).toBe('STAFF_FORBIDDEN');

    const forbiddenScope = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/audit-logs',
      headers: bearer(storeScoped.token),
    });
    expect(forbiddenScope.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/audit-logs?limit=10',
      headers: bearer(reader.token),
    });
    expect(allowed.statusCode).toBe(200);
    expect(auditLogListResponseSchema.parse(allowed.json()).items).toBeInstanceOf(Array);
  });

  it('appends redacted audit rows for Staff administration writes', async () => {
    const app = makeApp();
    const actor = await createStaff(['staff.manage', 'audit.read']);
    const password = 'M20-audit-password-secret-123';

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(actor.token),
      payload: {
        loginIdentifier: `audit-target-${randomUUID().slice(0, 8)}@example.com`,
        password,
        enabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = z.object({ id: z.uuid() }).passthrough().parse(created.json());

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/admin/accounts/${createdBody.id}/enabled`,
      headers: bearer(actor.token),
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/admin/accounts/${createdBody.id}/reset-password`,
      headers: bearer(actor.token),
      payload: { password: 'M20-audit-password-reset-456' },
    });
    expect(reset.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/audit-logs?resourceType=STAFF_ACCOUNT&resourceId=${createdBody.id}&limit=20`,
      headers: bearer(actor.token),
    });
    expect(response.statusCode).toBe(200);
    const body = auditLogListResponseSchema.parse(response.json());
    expect(body.items.map((item) => item.actionKey)).toEqual(
      expect.arrayContaining([
        'staff.account.create',
        'staff.account.set_enabled',
        'staff.account.reset_password',
      ]),
    );
    expect(body.items.every((item) => item.actorStaffAccountId === actor.id)).toBe(true);
    expect(JSON.stringify(body.items)).not.toContain(password);
    expect(JSON.stringify(body.items)).not.toContain('M20-audit-password-reset-456');
  });

  it('keeps existing audit rows unchanged as later events append', async () => {
    const app = makeApp();
    const actor = await createStaff(['staff.manage', 'audit.read']);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/admin/accounts',
      headers: bearer(actor.token),
      payload: {
        loginIdentifier: `audit-append-${randomUUID().slice(0, 8)}@example.com`,
        password: 'M20-audit-append-password-123',
        enabled: true,
      },
    });
    const createdBody = z.object({ id: z.uuid() }).passthrough().parse(created.json());

    const [original] = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, createdBody.id));
    expect(original).toBeDefined();

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/staff/admin/accounts/${createdBody.id}/enabled`,
      headers: bearer(actor.token),
      payload: { enabled: false },
    });

    const [sameRow] = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, original!.id));
    expect(sameRow).toEqual(original);

    const allRows = await database!.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, createdBody.id));
    expect(allRows).toHaveLength(2);
  });

  it('rejects unbounded or malformed audit filters', async () => {
    const app = makeApp();
    const reader = await createStaff(['audit.read']);

    const tooLarge = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/audit-logs?limit=201',
      headers: bearer(reader.token),
    });
    expect(tooLarge.statusCode).toBe(400);

    const reversedWindow = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/audit-logs?createdFrom=2026-09-19T12%3A00%3A00.000Z&createdTo=2026-09-19T11%3A00%3A00.000Z',
      headers: bearer(reader.token),
    });
    expect(reversedWindow.statusCode).toBe(400);
  });
});
