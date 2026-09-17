import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from '@xiaohai/contracts';
import { publicStoresResponseSchema, staffStoresResponseSchema } from '@xiaohai/contracts/stores';
import {
  createDatabase,
  franchisees,
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
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerStoreRoutes } from '../src/stores/store-routes.js';
import { StoreNetworkService } from '../src/stores/store-service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const testSuite = hasDatabase ? describe : describe.skip;
const sessionSecret = 'm12-store-network-integration-secret-at-least-32-characters';

testSuite('M12 store network PostgreSQL integration', () => {
  const sessions = new StaffSessionService(sessionSecret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );
  const service = new StoreNetworkService(database!.db);

  beforeEach(async () => {
    await database!.db.delete(stores);
    await database!.db.delete(franchisees);
    await database!.db.delete(regions);
    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);
  });

  afterAll(async () => database?.pool.end());

  function makeApp() {
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    registerStoreRoutes(app, { stores: service, staffAuthorization: authorization });
    return app;
  }

  async function seedNetwork() {
    const [chengduRegion, westRegion] = await database!.db
      .insert(regions)
      .values([
        {
          code: 'CN-SC-CD',
          name: '成都区域',
          countryCode: 'CN',
          countryName: '中国',
          displayOrder: 1,
        },
        {
          code: 'CN-CQ',
          name: '重庆区域',
          countryCode: 'CN',
          countryName: '中国',
          displayOrder: 2,
        },
      ])
      .returning();

    const [chengduFranchisee, westFranchisee] = await database!.db
      .insert(franchisees)
      .values([
        {
          code: 'F-CD-01',
          regionId: chengduRegion!.id,
          name: '成都加盟商',
        },
        {
          code: 'F-CQ-01',
          regionId: westRegion!.id,
          name: '重庆加盟商',
        },
      ])
      .returning();

    const [southGateStore, westStore, inactiveStore] = await database!.db
      .insert(stores)
      .values([
        {
          code: 'CD-NANMEN',
          regionId: chengduRegion!.id,
          franchiseeId: chengduFranchisee!.id,
          name: '胖竹书店南门店',
          countryCode: 'CN',
          countryName: '中国',
          city: '成都',
          timezone: 'Asia/Shanghai',
          addressLine: '成都市测试地址 1 号',
          latitude: 30.65,
          longitude: 104.06,
          phone: '028-00000000',
          openingHoursText: '09:30-18:30',
          services: ['阅读', '自习', '活动'],
        },
        {
          code: 'CQ-JIEFANGBEI',
          regionId: westRegion!.id,
          franchiseeId: westFranchisee!.id,
          name: '胖竹书店解放碑店',
          countryCode: 'CN',
          countryName: '中国',
          city: '重庆',
          timezone: 'Asia/Shanghai',
          addressLine: '重庆市测试地址 2 号',
          latitude: 29.56,
          longitude: 106.55,
          services: ['阅读'],
        },
        {
          code: 'CD-INACTIVE',
          regionId: chengduRegion!.id,
          franchiseeId: chengduFranchisee!.id,
          name: '暂停营业门店',
          countryCode: 'CN',
          countryName: '中国',
          city: '成都',
          timezone: 'Asia/Shanghai',
          addressLine: '成都市测试地址 3 号',
          latitude: 30.66,
          longitude: 104.07,
          operationalStatus: 'INACTIVE',
          services: [],
        },
      ])
      .returning();

    return {
      chengduRegion: chengduRegion!,
      westRegion: westRegion!,
      chengduFranchisee: chengduFranchisee!,
      westFranchisee: westFranchisee!,
      southGateStore: southGateStore!,
      westStore: westStore!,
      inactiveStore: inactiveStore!,
    };
  }

  async function createStaff(
    permissionKeys: string[],
    scope: { type: 'GLOBAL' | 'REGION' | 'FRANCHISEE' | 'STORE'; id: string | null },
  ) {
    const [staff] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: `m12-${crypto.randomUUID()}@example.com`,
        passwordHash: 'test-only',
      })
      .returning({ id: staffAccounts.id });
    const [role] = await database!.db
      .insert(roles)
      .values({ key: `m12-${crypto.randomUUID()}`, displayName: 'M12 test role' })
      .returning({ id: roles.id });
    const permissionRows = await database!.db
      .insert(permissions)
      .values(
        permissionKeys.map((key) => ({ key: `${key}-${crypto.randomUUID()}`, displayName: key })),
      )
      .returning({ id: permissions.id, key: permissions.key });

    for (let index = 0; index < permissionKeys.length; index += 1) {
      const actualKey = permissionKeys[index]!;
      const row = permissionRows[index]!;
      await database!.db
        .update(permissions)
        .set({ key: actualKey })
        .where(eq(permissions.id, row.id));
      await database!.db.insert(rolePermissions).values({ roleId: role!.id, permissionId: row.id });
    }

    await database!.db.insert(staffRoles).values({ staffAccountId: staff!.id, roleId: role!.id });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staff!.id,
      scopeType: scope.type,
      scopeId: scope.id,
    });

    return { staffId: staff!.id, token: sessions.issue(staff!.id).token };
  }

  it('returns only public active stores and supports name, region and service filters', async () => {
    const network = await seedNetwork();
    const app = makeApp();

    let response = await app.inject({ method: 'GET', url: '/api/v1/stores?q=南门' });
    expect(response.statusCode).toBe(200);
    const searchBody = publicStoresResponseSchema.parse(response.json());
    expect(searchBody.stores.map((store) => store.id)).toEqual([network.southGateStore.id]);

    response = await app.inject({
      method: 'GET',
      url: `/api/v1/stores?regionId=${network.chengduRegion.id}&service=${encodeURIComponent('自习')}`,
    });
    expect(response.statusCode).toBe(200);
    const filteredBody = publicStoresResponseSchema.parse(response.json());
    expect(filteredBody.stores).toHaveLength(1);
    expect(filteredBody.stores[0]).toMatchObject({
      id: network.southGateStore.id,
      city: '成都',
      region: { id: network.chengduRegion.id },
    });

    response = await app.inject({
      method: 'GET',
      url: `/api/v1/stores/${network.inactiveStore.id}`,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('sorts nearby stores by server-computed distance and enforces radius', async () => {
    const network = await seedNetwork();
    const app = makeApp();

    const nearby = await app.inject({
      method: 'GET',
      url: '/api/v1/stores?latitude=30.65&longitude=104.06&radiusKm=20',
    });
    expect(nearby.statusCode).toBe(200);
    const nearbyBody = publicStoresResponseSchema.parse(nearby.json());
    expect(nearbyBody.stores).toHaveLength(1);
    expect(nearbyBody.stores[0]?.id).toBe(network.southGateStore.id);
    expect(nearbyBody.stores[0]?.distanceKm).not.toBeNull();
    expect(nearbyBody.stores[0]?.distanceKm ?? Number.POSITIVE_INFINITY).toBeLessThan(0.01);

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/stores?latitude=30.65',
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('expands REGION and FRANCHISEE scopes only to proven descendant stores', async () => {
    const network = await seedNetwork();
    const app = makeApp();

    const regionStaff = await createStaff(['stores.read'], {
      type: 'REGION',
      id: network.chengduRegion.id,
    });
    let response = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/stores',
      headers: { authorization: `Bearer ${regionStaff.token}` },
    });
    expect(response.statusCode).toBe(200);
    const regionBody = staffStoresResponseSchema.parse(response.json());
    expect(regionBody.stores.map((store) => store.id)).toEqual(
      expect.arrayContaining([network.southGateStore.id, network.inactiveStore.id]),
    );
    expect(regionBody.stores.map((store) => store.id)).not.toContain(network.westStore.id);

    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);

    const franchiseeStaff = await createStaff(['stores.read'], {
      type: 'FRANCHISEE',
      id: network.westFranchisee.id,
    });
    response = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/stores',
      headers: { authorization: `Bearer ${franchiseeStaff.token}` },
    });
    expect(response.statusCode).toBe(200);
    const franchiseeBody = staffStoresResponseSchema.parse(response.json());
    expect(franchiseeBody.stores.map((store) => store.id)).toEqual([network.westStore.id]);
    await app.close();
  });

  it('does not let client-supplied region or franchisee ids cross Data Scope boundaries', async () => {
    const network = await seedNetwork();
    const staff = await createStaff(['stores.manage'], {
      type: 'REGION',
      id: network.chengduRegion.id,
    });
    const app = makeApp();

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores',
      headers: { authorization: `Bearer ${staff.token}` },
      payload: {
        code: 'CD-NEW',
        regionId: network.chengduRegion.id,
        franchiseeId: network.chengduFranchisee.id,
        name: '成都新门店',
        countryCode: 'CN',
        countryName: '中国',
        city: '成都',
        timezone: 'Asia/Shanghai',
        addressLine: '成都市测试地址 4 号',
        latitude: 30.67,
        longitude: 104.08,
        services: ['阅读'],
      },
    });
    expect(allowed.statusCode).toBe(201);

    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/stores',
      headers: { authorization: `Bearer ${staff.token}` },
      payload: {
        code: 'CQ-FORGED',
        regionId: network.westRegion.id,
        franchiseeId: network.westFranchisee.id,
        name: '越权门店',
        countryCode: 'CN',
        countryName: '中国',
        city: '重庆',
        timezone: 'Asia/Shanghai',
        addressLine: '重庆市测试地址 5 号',
        latitude: 29.57,
        longitude: 106.56,
        services: [],
      },
    });
    expect(forged.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(forged.json()).error.code).toBe('STAFF_FORBIDDEN');
    await app.close();
  });

  it('enforces store schema uniqueness, foreign keys and coordinate checks', async () => {
    const network = await seedNetwork();

    await expect(
      database!.db.insert(regions).values({
        code: network.chengduRegion.code,
        name: '重复区域',
        countryCode: 'CN',
        countryName: '中国',
      }),
    ).rejects.toBeDefined();

    await expect(
      database!.db.insert(stores).values({
        code: 'BAD-LAT',
        regionId: network.chengduRegion.id,
        name: '错误坐标门店',
        countryCode: 'CN',
        countryName: '中国',
        city: '成都',
        timezone: 'Asia/Shanghai',
        addressLine: '测试地址',
        latitude: 100,
        longitude: 104,
        services: [],
      }),
    ).rejects.toBeDefined();

    await expect(
      database!.db.insert(franchisees).values({
        code: 'F-UNKNOWN',
        regionId: '99999999-9999-4999-8999-999999999999',
        name: '未知区域加盟商',
      }),
    ).rejects.toBeDefined();
  });
});
