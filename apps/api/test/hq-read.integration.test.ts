import { randomUUID } from 'node:crypto';
import { inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hqOrderDetailSchema,
  hqOrderListResponseSchema,
  hqUserDetailSchema,
  hqUserListResponseSchema,
} from '@xiaohai/contracts/hq';
import {
  bookEditions,
  books,
  consumerUsers,
  createDatabase,
  orderItems,
  orders,
  payments,
  permissions,
  pickupCodes,
  products,
  regions,
  rolePermissions,
  roles,
  skus,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  stores,
  wechatIdentities,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerHqReadRoutes } from '../src/hq/hq-read-routes.js';
import { HqReadService } from '../src/hq/hq-read-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
const sessionSecret = 'm20-hq-read-integration-secret-at-least-32-characters';

suite('M20 HQ orders and users PostgreSQL integration', () => {
  const sessions = new StaffSessionService(sessionSecret, 300);
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );
  const hqRead = new HqReadService(database!.db);

  async function cleanupHqReadFixtures() {
    if (!database) return;

    const db = database.db;

    const m20Orders = await db
      .select({
        id: orders.id,
        consumerUserId: orders.consumerUserId,
      })
      .from(orders)
      .where(like(orders.orderNumber, 'M20-%'));

    const orderIds = m20Orders.map((row) => row.id);

    if (orderIds.length > 0) {
      await db.delete(payments).where(inArray(payments.orderId, orderIds));
      await db.delete(pickupCodes).where(inArray(pickupCodes.orderId, orderIds));
      await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
      await db.delete(orders).where(inArray(orders.id, orderIds));
    }

    const m20Stores = await db
      .select({ id: stores.id })
      .from(stores)
      .where(like(stores.code, 'M20-S-%'));

    const storeIds = m20Stores.map((row) => row.id);

    if (storeIds.length > 0) {
      await db.delete(pickupCodes).where(inArray(pickupCodes.storeId, storeIds));
      await db.delete(stores).where(inArray(stores.id, storeIds));
    }

    await db.delete(skus).where(like(skus.code, 'M20-SKU-%'));
    await db.delete(products).where(like(products.name, 'M20 Product %'));
    await db.delete(bookEditions).where(like(bookEditions.isbn, 'm20-isbn-%'));
    await db.delete(books).where(like(books.title, 'M20 Book %'));

    const m20Identities = await db
      .select({ consumerUserId: wechatIdentities.consumerUserId })
      .from(wechatIdentities)
      .where(like(wechatIdentities.appId, 'm20-app-%'));

    const consumerUserIds = m20Identities.map((row) => row.consumerUserId);

    if (consumerUserIds.length > 0) {
      await db.delete(consumerUsers).where(inArray(consumerUsers.id, consumerUserIds));
    }

    await db.delete(staffAccounts).where(like(staffAccounts.loginIdentifier, 'm20-%@example.com'));

    await db.delete(roles).where(like(roles.key, 'm20-%'));
    await db.delete(regions).where(like(regions.code, 'M20-R-%'));
  }

  beforeAll(cleanupHqReadFixtures);

  afterAll(async () => {
    await cleanupHqReadFixtures();
    await database?.pool.end();
  });

  function makeApp() {
    const app = buildApp({ logger: false });
    registerHqReadRoutes(app, { hqRead, staffAuthorization: authorization });
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

  async function createStaff(permissionKeys: string[], scopeType: 'GLOBAL' | 'STORE' = 'GLOBAL') {
    const suffix = randomUUID().slice(0, 8);
    const [staff] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: `m20-${suffix}@example.com`,
        passwordHash: 'test-only-not-a-login-hash',
      })
      .returning({ id: staffAccounts.id });
    const [role] = await database!.db
      .insert(roles)
      .values({ key: `m20-${suffix}`, displayName: `M20 ${suffix}` })
      .returning({ id: roles.id });
    const permissionIds = await Promise.all(permissionKeys.map(ensurePermission));
    if (permissionIds.length)
      await database!.db
        .insert(rolePermissions)
        .values(permissionIds.map((permissionId) => ({ roleId: role!.id, permissionId })));
    await database!.db.insert(staffRoles).values({ staffAccountId: staff!.id, roleId: role!.id });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: staff!.id,
      scopeType,
      scopeId: scopeType === 'GLOBAL' ? null : randomUUID(),
    });
    return { id: staff!.id, token: sessions.issue(staff!.id).token };
  }

  async function createOrderFixture() {
    const suffix = randomUUID().slice(0, 8);
    const [user] = await database!.db.insert(consumerUsers).values({}).returning({
      id: consumerUsers.id,
    });
    await database!.db.insert(wechatIdentities).values({
      consumerUserId: user!.id,
      appId: `m20-app-${suffix}`,
      openid: `openid-secret-${suffix}`,
      unionid: `unionid-secret-${suffix}`,
    });

    const [book] = await database!.db
      .insert(books)
      .values({ title: `M20 Book ${suffix}`, author: 'M20 Author' })
      .returning({ id: books.id });
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: `m20-isbn-${suffix}` })
      .returning({ id: bookEditions.id });
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: `M20 Product ${suffix}`, status: 'ACTIVE' })
      .returning({ id: products.id });
    const [sku] = await database!.db
      .insert(skus)
      .values({
        productId: product!.id,
        code: `M20-SKU-${suffix}`,
        name: 'Standard',
        priceMinor: 3200,
      })
      .returning({ id: skus.id });

    const [order] = await database!.db
      .insert(orders)
      .values({
        consumerUserId: user!.id,
        orderNumber: `M20-${suffix}`,
        status: 'PAID',
        subtotalMinor: 3200,
        totalMinor: 3200,
        clientRequestId: `m20-request-${suffix}`,
        addressSnapshot: {
          recipientName: 'Support User',
          phone: '13800000000',
          region: 'Sichuan',
          city: 'Chengdu',
          district: 'Tianfu',
          addressLine: 'Snapshot Road 1',
          postalCode: null,
        },
      })
      .returning({ id: orders.id, orderNumber: orders.orderNumber });
    await database!.db.insert(orderItems).values({
      orderId: order!.id,
      skuId: sku!.id,
      productNameSnapshot: `Snapshot Product ${suffix}`,
      skuNameSnapshot: 'Snapshot Standard',
      skuCodeSnapshot: `SNAP-${suffix}`,
      unitPriceMinor: 3200,
      quantity: 1,
      lineTotalMinor: 3200,
    });
    await database!.db.insert(payments).values({
      orderId: order!.id,
      merchantId: `merchant-secret-${suffix}`,
      appId: `payment-app-secret-${suffix}`,
      outTradeNo: `trade-${suffix}`,
      amountMinor: 3200,
      status: 'SUCCEEDED',
      providerTransactionId: `provider-secret-${suffix}`,
    });

    const [region] = await database!.db
      .insert(regions)
      .values({
        code: `M20-R-${suffix}`,
        name: `M20 Region ${suffix}`,
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    const [store] = await database!.db
      .insert(stores)
      .values({
        code: `M20-S-${suffix}`,
        regionId: region!.id,
        name: `M20 Store ${suffix}`,
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Store Road 1',
        latitude: 30.57,
        longitude: 104.06,
      })
      .returning({ id: stores.id });
    await database!.db.insert(pickupCodes).values({ orderId: order!.id, storeId: store!.id });

    return {
      userId: user!.id,
      orderId: order!.id,
      orderNumber: order!.orderNumber,
      storeId: store!.id,
      secrets: {
        openid: `openid-secret-${suffix}`,
        unionid: `unionid-secret-${suffix}`,
        merchantId: `merchant-secret-${suffix}`,
        paymentAppId: `payment-app-secret-${suffix}`,
        providerTransactionId: `provider-secret-${suffix}`,
      },
    };
  }

  it('requires explicit permission and GLOBAL Data Scope', async () => {
    const app = makeApp();
    const noPermission = await createStaff([]);
    const storeScoped = await createStaff(['orders.read'], 'STORE');
    const global = await createStaff(['orders.read']);

    expect((await app.inject({ method: 'GET', url: '/api/v1/staff/orders' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/orders',
          headers: { authorization: `Bearer ${noPermission.token}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/orders',
          headers: { authorization: `Bearer ${storeScoped.token}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/orders',
          headers: { authorization: `Bearer ${global.token}` },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('returns server-owned order snapshots and only safe payment/fulfillment summaries', async () => {
    const fixture = await createOrderFixture();
    const staff = await createStaff(['orders.read']);
    const app = makeApp();

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/orders?q=${encodeURIComponent(fixture.orderNumber)}&status=PAID`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(list.statusCode).toBe(200);
    const orderListBody = hqOrderListResponseSchema.parse(list.json());
    expect(orderListBody.items).toHaveLength(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/orders/${fixture.orderId}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(detail.statusCode).toBe(200);
    const orderDetailBody = hqOrderDetailSchema.parse(detail.json());
    expect(orderDetailBody).toMatchObject({
      id: fixture.orderId,
      status: 'PAID',
      totalMinor: 3200,
      address: { recipientName: 'Support User', addressLine: 'Snapshot Road 1' },
      payment: { status: 'SUCCEEDED', amountMinor: 3200, currency: 'CNY' },
      fulfillment: { method: 'PICKUP', storeId: fixture.storeId, status: 'ISSUED' },
    });
    const firstItem = orderDetailBody.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.productName).toContain('Snapshot Product');
    expect(firstItem).toMatchObject({
      unitPriceMinor: 3200,
      quantity: 1,
    });
    const serialized = detail.body;
    expect(serialized).not.toContain(fixture.secrets.merchantId);
    expect(serialized).not.toContain(fixture.secrets.paymentAppId);
    expect(serialized).not.toContain(fixture.secrets.providerTransactionId);
    await app.close();
  });

  it('returns minimal consumer support data without raw WeChat identifiers', async () => {
    const fixture = await createOrderFixture();
    const staff = await createStaff(['users.read']);
    const app = makeApp();

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/users?id=${fixture.userId}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(list.statusCode).toBe(200);
    const userListBody = hqUserListResponseSchema.parse(list.json());
    expect(userListBody.items).toHaveLength(1);
    expect(userListBody.items[0]).toMatchObject({ id: fixture.userId, identityCount: 1 });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/users/${fixture.userId}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(detail.statusCode).toBe(200);
    const userDetailBody = hqUserDetailSchema.parse(detail.json());
    expect(userDetailBody).toMatchObject({
      id: fixture.userId,
      identityCount: 1,
      orderCount: 1,
      lifetimeOrderMinor: 3200,
    });
    expect(detail.body).not.toContain(fixture.secrets.openid);
    expect(detail.body).not.toContain(fixture.secrets.unionid);
    await app.close();
  });

  it('keeps filters bounded and returns 404 for missing support resources', async () => {
    const fixture = await createOrderFixture();
    const staff = await createStaff(['orders.read', 'users.read']);
    const app = makeApp();

    const future = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/orders?createdFrom=${future}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = hqOrderListResponseSchema.parse(filtered.json());
    expect(filteredBody.items).toHaveLength(0);

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/users?limit=201',
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(invalidLimit.statusCode).toBe(400);

    const missingOrder = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/orders/${randomUUID()}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(missingOrder.statusCode).toBe(404);

    const missingUser = await app.inject({
      method: 'GET',
      url: `/api/v1/staff/users/${randomUUID()}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(missingUser.statusCode).toBe(404);
    expect(fixture.orderId).toBeTruthy();
    await app.close();
  });
});
