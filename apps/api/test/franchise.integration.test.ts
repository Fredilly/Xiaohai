import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  franchiseApplicationListResponseSchema,
  franchiseApplicationSubmissionResponseSchema,
  franchiseApplicationViewSchema,
} from '@xiaohai/contracts/franchise';
import {
  createDatabase,
  franchiseApplications,
  franchiseFollowups,
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
import { ConsumerSessionService } from '../src/auth/session.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerFranchiseRoutes } from '../src/franchise/franchise-routes.js';
import { FranchiseService, franchisePermissions } from '../src/franchise/franchise-service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;
const staffSessionSecret = 'm17-franchise-staff-integration-secret-at-least-32-characters';
const consumerSessionSecret = 'm17-franchise-consumer-integration-secret-at-least-32-characters';

testSuite('M17 franchise PostgreSQL integration', () => {
  const staffSessions = new StaffSessionService(staffSessionSecret, 300);
  const consumerSessions = new ConsumerSessionService(consumerSessionSecret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    staffSessions,
  );
  const service = new FranchiseService(database!.db);

  beforeEach(async () => {
    await database!.db.delete(franchiseFollowups);
    await database!.db.delete(franchiseApplications);
  });

  afterAll(async () => {
    await database!.db.delete(franchiseFollowups);
    await database!.db.delete(franchiseApplications);
    await database?.pool.end();
  });

  function makeApp() {
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    registerFranchiseRoutes(app, {
      franchise: service,
      consumerSessions,
      staffAuthorization: authorization,
    });
    return app;
  }

  async function ensurePermission(key: string) {
    const [existing] = await database!.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .limit(1);
    if (existing) return existing.id;
    const [created] = await database!.db
      .insert(permissions)
      .values({ key, displayName: key })
      .returning({ id: permissions.id });
    return created!.id;
  }

  async function createStaff(
    permissionKeys: string[],
    scope: { type: 'GLOBAL' | 'REGION'; id: string | null } = { type: 'GLOBAL', id: null },
  ) {
    const [staff] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: `m17-${crypto.randomUUID()}@example.com`,
        passwordHash: 'test-only',
      })
      .returning({ id: staffAccounts.id });
    const [role] = await database!.db
      .insert(roles)
      .values({ key: `m17-${crypto.randomUUID()}`, displayName: 'M17 test role' })
      .returning({ id: roles.id });
    await database!.db.insert(staffRoles).values({ staffAccountId: staff!.id, roleId: role!.id });
    for (const key of permissionKeys) {
      await database!.db.insert(rolePermissions).values({
        roleId: role!.id,
        permissionId: await ensurePermission(key),
      });
    }
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staff!.id,
      scopeType: scope.type,
      scopeId: scope.id,
    });
    return { id: staff!.id, token: staffSessions.issue(staff!.id).token };
  }

  async function submit(app: ReturnType<typeof makeApp>, name = '测试申请人') {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/franchise/applications',
      payload: {
        name,
        phone: '13800138000',
        email: 'franchise@example.com',
        country: '中国',
        region: '四川',
        city: '成都',
        district: '武侯区',
        background: '有零售运营经验',
        message: '希望了解胖竹书店加盟合作。',
      },
    });
    expect(response.statusCode).toBe(201);
    return franchiseApplicationSubmissionResponseSchema.parse(response.json());
  }

  it('accepts anonymous applications while strict validation rejects server-controlled fields', async () => {
    const app = makeApp();
    const created = await submit(app);
    expect(created.status).toBe('SUBMITTED');
    expect(created.applicationNumber).toMatch(/^FA-/);

    const [row] = await database!.db
      .select()
      .from(franchiseApplications)
      .where(eq(franchiseApplications.id, created.id));
    expect(row).toMatchObject({
      id: created.id,
      submittedByConsumerUserId: null,
      name: '测试申请人',
      phone: '13800138000',
      status: 'SUBMITTED',
      version: 1,
    });

    const injected = await app.inject({
      method: 'POST',
      url: '/api/v1/franchise/applications',
      payload: {
        name: '恶意字段测试',
        phone: '13800138001',
        country: '中国',
        region: '四川',
        city: '成都',
        status: 'APPROVED',
        assignedStaffAccountId: crypto.randomUUID(),
      },
    });
    expect(injected.statusCode).toBe(400);
    await app.close();
  });

  it('requires both franchise permission and GLOBAL data scope for HQ operations', async () => {
    const app = makeApp();
    await submit(app);

    const noAuth = await app.inject({ method: 'GET', url: '/api/v1/staff/franchise/applications' });
    expect(noAuth.statusCode).toBe(401);

    const wrongPermission = await createStaff(['franchise.unrelated']);
    const forbiddenPermission = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/franchise/applications',
      headers: { authorization: `Bearer ${wrongPermission.token}` },
    });
    expect(forbiddenPermission.statusCode).toBe(403);

    const regionOnly = await createStaff([franchisePermissions.read], {
      type: 'REGION',
      id: crypto.randomUUID(),
    });
    const forbiddenScope = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/franchise/applications',
      headers: { authorization: `Bearer ${regionOnly.token}` },
    });
    expect(forbiddenScope.statusCode).toBe(403);

    const global = await createStaff([franchisePermissions.read]);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/franchise/applications?region=四川&city=成都&query=测试',
      headers: { authorization: `Bearer ${global.token}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(franchiseApplicationListResponseSchema.parse(allowed.json()).items).toHaveLength(1);
    await app.close();
  });

  it('supports assignment, append-only follow-up, approval and ordered lifecycle transitions', async () => {
    const app = makeApp();
    const created = await submit(app);
    const operator = await createStaff([
      franchisePermissions.read,
      franchisePermissions.assign,
      franchisePermissions.followup,
      franchisePermissions.review,
      franchisePermissions.manage,
    ]);
    const assignee = await createStaff([franchisePermissions.read]);
    const headers = { authorization: `Bearer ${operator.token}` };

    let response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/assign`,
      headers,
      payload: { staffAccountId: assignee.id, version: 1 },
    });
    expect(response.statusCode).toBe(200);
    let view = franchiseApplicationViewSchema.parse(response.json());
    expect(view).toMatchObject({
      status: 'ASSIGNED',
      assignedStaffAccountId: assignee.id,
      version: 2,
    });

    response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/followups`,
      headers,
      payload: { channel: 'PHONE', note: '第一次电话沟通', version: 2 },
    });
    expect(response.statusCode).toBe(200);
    view = franchiseApplicationViewSchema.parse(response.json());
    expect(view.status).toBe('FOLLOWING_UP');
    expect(view.version).toBe(3);
    expect(view.followups).toHaveLength(1);

    response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/followups`,
      headers,
      payload: { channel: 'WECHAT', note: '补充发送资料', version: 3 },
    });
    view = franchiseApplicationViewSchema.parse(response.json());
    expect(view.followups.map((item) => item.note)).toEqual(['第一次电话沟通', '补充发送资料']);
    expect(view.version).toBe(4);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/review`,
      headers,
      payload: { decision: 'APPROVED', version: 3 },
    });
    expect(stale.statusCode).toBe(409);

    response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/review`,
      headers,
      payload: { decision: 'APPROVED', note: '审核通过', version: 4 },
    });
    view = franchiseApplicationViewSchema.parse(response.json());
    expect(view).toMatchObject({
      status: 'APPROVED',
      reviewedByStaffAccountId: operator.id,
      reviewNote: '审核通过',
      version: 5,
    });
    expect(view.approvedAt).not.toBeNull();

    for (const status of ['SIGNED', 'PREPARING', 'OPENED'] as const) {
      response = await app.inject({
        method: 'POST',
        url: `/api/v1/staff/franchise/applications/${created.id}/status`,
        headers,
        payload: { status, version: view.version },
      });
      expect(response.statusCode).toBe(200);
      view = franchiseApplicationViewSchema.parse(response.json());
      expect(view.status).toBe(status);
    }

    const rows = await database!.db
      .select()
      .from(franchiseFollowups)
      .where(eq(franchiseFollowups.franchiseApplicationId, created.id));
    expect(rows).toHaveLength(2);
    await app.close();
  });

  it('rejects illegal lifecycle jumps and supports terminal rejection', async () => {
    const app = makeApp();
    const created = await submit(app, '状态机测试');
    const operator = await createStaff([
      franchisePermissions.assign,
      franchisePermissions.review,
      franchisePermissions.manage,
    ]);
    const headers = { authorization: `Bearer ${operator.token}` };

    const illegal = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/status`,
      headers,
      payload: { status: 'OPENED', version: 1 },
    });
    expect(illegal.statusCode).toBe(409);

    let response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/assign`,
      headers,
      payload: { staffAccountId: operator.id, version: 1 },
    });
    let view = franchiseApplicationViewSchema.parse(response.json());

    response = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/review`,
      headers,
      payload: { decision: 'REJECTED', note: '当前条件暂不匹配', version: view.version },
    });
    view = franchiseApplicationViewSchema.parse(response.json());
    expect(view.status).toBe('REJECTED');
    expect(view.rejectedAt).not.toBeNull();

    const afterReject = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/franchise/applications/${created.id}/status`,
      headers,
      payload: { status: 'SIGNED', version: view.version },
    });
    expect(afterReject.statusCode).toBe(409);
    await app.close();
  });
});
