import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cmsSectionSchema } from '@xiaohai/contracts';
import {
  cmsPages,
  cmsSections,
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
import { HOME_CMS_PERMISSION, HomeCmsService } from '../src/cms/home-cms-service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;
const secret = 'm4-home-cms-integration-secret-at-least-32-characters';

testSuite('M4 Home/CMS PostgreSQL integration', () => {
  const sessions = new StaffSessionService(secret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );
  const cms = new HomeCmsService(database!.db);

  beforeEach(async () => {
    await database!.db.delete(cmsSections);
    await database!.db.delete(cmsPages);
    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);
    await database!.db
      .insert(cmsPages)
      .values({ key: 'HOME', title: '首页', publicationState: 'PUBLISHED' });
  });

  afterAll(async () => database?.pool.end());

  async function createStaff(options: { permission?: boolean; enabled?: boolean } = {}) {
    const [staff] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: `cms-${Math.random()}@example.com`,
        passwordHash: 'test-only-not-a-login-hash',
        enabled: options.enabled ?? true,
      })
      .returning({ id: staffAccounts.id });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staff!.id,
      scopeType: 'GLOBAL',
      scopeId: null,
    });
    if (options.permission) {
      const [permission] = await database!.db
        .insert(permissions)
        .values({ key: HOME_CMS_PERMISSION, displayName: 'CMS' })
        .returning({ id: permissions.id });
      const [role] = await database!.db
        .insert(roles)
        .values({ key: `cms-role-${Math.random()}`, displayName: 'CMS role' })
        .returning({ id: roles.id });
      await database!.db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permissionId: permission!.id });
      await database!.db.insert(staffRoles).values({ staffAccountId: staff!.id, roleId: role!.id });
    }
    return staff!.id;
  }

  it('enforces CMS DB constraints', async () => {
    const [page] = await database!.db.select().from(cmsPages).where(eq(cmsPages.key, 'HOME'));
    await expect(
      database!.db.insert(cmsSections).values({
        pageId: page!.id,
        sectionType: 'UNKNOWN',
        title: 'bad',
        displayOrder: 0,
        config: {},
      }),
    ).rejects.toBeTruthy();
    await expect(
      database!.db.insert(cmsSections).values({
        pageId: page!.id,
        sectionType: 'BANNER',
        title: 'bad order',
        displayOrder: -1,
        config: { body: 'x' },
      }),
    ).rejects.toBeTruthy();
  });

  it('returns only published and enabled sections in stable order', async () => {
    const base = { sectionType: 'BANNER', config: { body: 'x' } } as const;
    await cms.createSection({
      ...base,
      title: 'second',
      displayOrder: 2,
      enabled: true,
      publicationState: 'PUBLISHED',
    });
    await cms.createSection({
      ...base,
      title: 'first',
      displayOrder: 1,
      enabled: true,
      publicationState: 'PUBLISHED',
    });
    await cms.createSection({
      ...base,
      title: 'disabled',
      displayOrder: 3,
      enabled: false,
      publicationState: 'PUBLISHED',
    });
    await cms.createSection({
      ...base,
      title: 'draft',
      displayOrder: 4,
      enabled: true,
      publicationState: 'DRAFT',
    });
    const home = await cms.getPublicHome();
    expect(home.sections.map((section) => section.title)).toEqual(['first', 'second']);
  });

  it('rejects invalid config at the API boundary', async () => {
    const staffId = await createStaff({ permission: true });
    const app = buildApp({ staffAuthorization: authorization, homeCms: cms, logger: false });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/cms/home/sections',
      headers: { authorization: `Bearer ${sessions.issue(staffId).token}` },
      payload: {
        sectionType: 'FEATURE_GRID',
        title: 'bad',
        displayOrder: 0,
        enabled: true,
        publicationState: 'DRAFT',
        config: { items: [{ nope: true }] },
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('enforces Staff authentication, permission, disabled-account and Consumer-token boundaries', async () => {
    const noPermissionId = await createStaff();
    const disabledId = await createStaff({ enabled: false });
    const app = buildApp({ staffAuthorization: authorization, homeCms: cms, logger: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/staff/cms/home' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/cms/home',
          headers: { authorization: `Bearer ${sessions.issue(noPermissionId).token}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/cms/home',
          headers: { authorization: `Bearer ${sessions.issue(disabledId).token}` },
        })
      ).statusCode,
    ).toBe(401);
    const consumerToken = new ConsumerSessionService(secret, 300).issue(
      '33333333-3333-4333-8333-333333333333',
    ).token;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/cms/home',
          headers: { authorization: `Bearer ${consumerToken}` },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it('allows authorized writes and rejects stale versions instead of losing updates', async () => {
    const staffId = await createStaff({ permission: true });
    const token = sessions.issue(staffId).token;
    const app = buildApp({ staffAuthorization: authorization, homeCms: cms, logger: false });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/cms/home/sections',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sectionType: 'BANNER',
        title: '运营位',
        displayOrder: 0,
        enabled: true,
        publicationState: 'DRAFT',
        config: { body: 'hello' },
      },
    });
    expect(created.statusCode).toBe(201);
    const section = cmsSectionSchema.parse(created.json());
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/staff/cms/home/sections/${section.id}`,
          headers: { authorization: `Bearer ${token}` },
          payload: { version: section.version, enabled: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/staff/cms/home/sections/${section.id}`,
          headers: { authorization: `Bearer ${token}` },
          payload: { version: section.version, title: 'stale' },
        })
      ).statusCode,
    ).toBe(409);
    await app.close();
  });

  it('supports section enable/disable and section/page publish-unpublish semantics', async () => {
    const section = await cms.createSection({
      sectionType: 'BANNER',
      title: 'banner',
      displayOrder: 0,
      enabled: true,
      publicationState: 'PUBLISHED',
      config: { body: 'hello' },
    });
    expect((await cms.getPublicHome()).sections).toHaveLength(1);
    const disabled = await cms.updateSection(section.id, {
      version: section.version,
      enabled: false,
    });
    expect((await cms.getPublicHome()).sections).toHaveLength(0);
    const enabled = await cms.updateSection(section.id, {
      version: disabled.version,
      enabled: true,
      publicationState: 'DRAFT',
    });
    expect((await cms.getPublicHome()).sections).toHaveLength(0);
    await cms.updateSection(section.id, {
      version: enabled.version,
      publicationState: 'PUBLISHED',
    });
    const admin = await cms.getAdminHome();
    await cms.updatePagePublication('DRAFT', admin.page.version);
    expect((await cms.getPublicHome()).sections).toHaveLength(0);
  });
});
