import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookEditions,
  books,
  cartItems,
  carts,
  consumerUsers,
  createDatabase,
  deliveries,
  deliveryEvents,
  deliveryZones,
  franchisees,
  inventoryTransactions,
  orderItems,
  orders,
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
  storeInventory,
  stores,
  userAddresses,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { ManualDeliveryProvider } from '../src/fulfillment/delivery-provider.js';
import { registerFulfillmentRoutes } from '../src/fulfillment/fulfillment-routes.js';
import {
  FulfillmentService,
  fulfillmentPermissions,
} from '../src/fulfillment/fulfillment-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
const consumerSessions = new ConsumerSessionService(
  'm16-consumer-test-secret-with-at-least-32-bytes',
  300,
);
const staffSessions = new StaffSessionService('m16-staff-test-secret-with-at-least-32-bytes', 300);
const pickupSecret = 'm16-pickup-code-secret-with-at-least-32-bytes';

suite('M16 pickup and delivery PostgreSQL integration', () => {
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    staffSessions,
  );
  const commerce = new CommerceService(database!.db);
  const fulfillment = new FulfillmentService(
    database!.db,
    commerce,
    pickupSecret,
    new ManualDeliveryProvider(),
  );
  const app = buildApp({ staffAuthorization: authorization, logger: false });
  registerFulfillmentRoutes(app, {
    fulfillment,
    consumerSessions,
    staffAuthorization: authorization,
  });

  async function clean() {
    await database!.db.delete(deliveryEvents);
    await database!.db.delete(deliveries);
    await database!.db.delete(pickupCodes);
    await database!.db.delete(deliveryZones);
    await database!.db.delete(inventoryTransactions);
    await database!.db.delete(orderItems);
    await database!.db.delete(orders);
    await database!.db.delete(cartItems);
    await database!.db.delete(carts);
    await database!.db.delete(userAddresses);
    await database!.db.delete(storeInventory);
    await database!.db.delete(skus);
    await database!.db.delete(products);
    await database!.db.delete(bookEditions);
    await database!.db.delete(books);
    await database!.db.delete(stores);
    await database!.db.delete(franchisees);
    await database!.db.delete(regions);
    await database!.db.delete(staffDataScopes);
    await database!.db.delete(staffRoles);
    await database!.db.delete(rolePermissions);
    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);
    await database!.db.delete(consumerUsers);
  }

  beforeEach(clean);
  afterAll(async () => {
    await app.close();
    await clean();
    await database!.pool.end();
  });

  async function seed() {
    const [regionA, regionB] = await database!.db
      .insert(regions)
      .values([
        {
          code: `M16-A-${crypto.randomUUID()}`,
          name: '成都 A',
          countryCode: 'CN',
          countryName: '中国',
        },
        {
          code: `M16-B-${crypto.randomUUID()}`,
          name: '成都 B',
          countryCode: 'CN',
          countryName: '中国',
        },
      ])
      .returning();
    const [franchiseA, franchiseB] = await database!.db
      .insert(franchisees)
      .values([
        {
          code: `M16-FA-${crypto.randomUUID()}`,
          regionId: regionA!.id,
          name: 'FA',
        },
        {
          code: `M16-FB-${crypto.randomUUID()}`,
          regionId: regionB!.id,
          name: 'FB',
        },
      ])
      .returning();
    const storeValue = (code: string, regionId: string, franchiseeId: string) => ({
      code: `${code}-${crypto.randomUUID()}`,
      regionId,
      franchiseeId,
      name: code,
      countryCode: 'CN',
      countryName: '中国',
      city: '成都',
      timezone: 'Asia/Shanghai',
      addressLine: code,
      latitude: 30.6,
      longitude: 104.1,
    });
    const [storeA, storeB] = await database!.db
      .insert(stores)
      .values([
        storeValue('M16 Store A', regionA!.id, franchiseA!.id),
        storeValue('M16 Store B', regionB!.id, franchiseB!.id),
      ])
      .returning();
    const [book] = await database!.db
      .insert(books)
      .values({ title: 'M16 测试书', author: '测试作者' })
      .returning();
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: crypto.randomUUID() })
      .returning();
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: 'M16 测试书', status: 'ACTIVE' })
      .returning();
    const [sku] = await database!.db
      .insert(skus)
      .values({
        productId: product!.id,
        code: `M16-${crypto.randomUUID()}`,
        name: '标准版',
        priceMinor: 3200,
      })
      .returning();
    await database!.db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: sku!.id, onHand: 5 },
      { storeId: storeB!.id, skuId: sku!.id, onHand: 5 },
    ]);
    const [consumerA, consumerB] = await database!.db
      .insert(consumerUsers)
      .values([{}, {}])
      .returning();
    const addressA = await commerce.createAddress(consumerA!.id, {
      recipientName: '小海',
      phone: '13800000000',
      region: '四川省',
      city: '成都市',
      district: '武侯区',
      addressLine: '测试路 1 号',
      postalCode: null,
      isDefault: true,
    });
    const addressB = await commerce.createAddress(consumerA!.id, {
      recipientName: '小海',
      phone: '13800000000',
      region: '四川省',
      city: '成都市',
      district: '锦江区',
      addressLine: '测试路 2 号',
      postalCode: null,
      isDefault: false,
    });
    return {
      regionA: regionA!,
      franchiseA: franchiseA!,
      storeA: storeA!,
      storeB: storeB!,
      sku: sku!,
      consumerA: consumerA!,
      consumerB: consumerB!,
      addressA,
      addressB,
    };
  }

  const consumerHeaders = (consumerId: string) => ({
    authorization: `Bearer ${consumerSessions.issue(consumerId).token}`,
  });

  async function staff(
    keys: string[],
    scope: { type: 'GLOBAL' | 'REGION' | 'FRANCHISEE' | 'STORE'; id: string | null },
  ) {
    const [account] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: crypto.randomUUID(),
        passwordHash: 'test-only',
        enabled: true,
      })
      .returning();
    const [role] = await database!.db
      .insert(roles)
      .values({ key: crypto.randomUUID(), displayName: 'M16 role' })
      .returning();
    for (const key of keys) {
      let [permission] = await database!.db
        .select()
        .from(permissions)
        .where(eq(permissions.key, key))
        .limit(1);
      if (!permission)
        [permission] = await database!.db
          .insert(permissions)
          .values({ key, displayName: key })
          .returning();
      await database!.db
        .insert(rolePermissions)
        .values({ roleId: role!.id, permissionId: permission!.id });
    }
    await database!.db
      .insert(staffRoles)
      .values({ staffAccountId: account!.id, roleId: role!.id });
    await database!.db.insert(staffDataScopes).values({
      staffAccountId: account!.id,
      scopeType: scope.type,
      scopeId: scope.id,
    });
    return {
      id: account!.id,
      headers: { authorization: `Bearer ${staffSessions.issue(account!.id).token}` },
    };
  }

  async function addOne(consumerId: string, skuId: string) {
    await commerce.addCartItem(consumerId, skuId, 1);
  }

  async function createFulfillmentOrder(
    consumerId: string,
    payload: {
      method: 'PICKUP' | 'DELIVERY';
      storeId: string;
      addressId?: string;
      clientRequestId?: string;
    },
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/fulfillment/orders',
      headers: consumerHeaders(consumerId),
      payload: {
        ...payload,
        clientRequestId: payload.clientRequestId ?? `req-${crypto.randomUUID()}`,
      },
    });
  }

  it('isolates consumer fulfillment and rejects idempotency-key reuse with a changed request', async () => {
    const d = await seed();
    await addOne(d.consumerA.id, d.sku.id);
    const requestId = `req-${crypto.randomUUID()}`;
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/fulfillment/quote',
      payload: { method: 'PICKUP', storeId: d.storeA.id },
    });
    expect(unauthorized.statusCode).toBe(401);

    const first = await createFulfillmentOrder(d.consumerA.id, {
      method: 'PICKUP',
      storeId: d.storeA.id,
      clientRequestId: requestId,
    });
    expect(first.statusCode).toBe(201);
    const orderId = first.json<{ orderId: string }>().orderId;

    const same = await createFulfillmentOrder(d.consumerA.id, {
      method: 'PICKUP',
      storeId: d.storeA.id,
      clientRequestId: requestId,
    });
    expect(same.statusCode).toBe(201);
    expect(same.json<{ orderId: string }>().orderId).toBe(orderId);

    const changed = await createFulfillmentOrder(d.consumerA.id, {
      method: 'PICKUP',
      storeId: d.storeB.id,
      clientRequestId: requestId,
    });
    expect(changed.statusCode).toBe(409);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/fulfillment/orders/${orderId}`,
          headers: consumerHeaders(d.consumerB.id),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('requires the correct pickup code, enforces Store Data Scope and deducts sale stock once', async () => {
    const d = await seed();
    await addOne(d.consumerA.id, d.sku.id);
    const created = await createFulfillmentOrder(d.consumerA.id, {
      method: 'PICKUP',
      storeId: d.storeA.id,
    });
    const orderId = created.json<{ orderId: string }>().orderId;
    await database!.db.update(orders).set({ status: 'PAID' }).where(eq(orders.id, orderId));

    const wrongStore = await staff(
      [fulfillmentPermissions.pickup],
      { type: 'STORE', id: d.storeB.id },
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/fulfillment/orders/${orderId}/pickup/ready`,
          headers: wrongStore.headers,
          payload: { idempotencyKey: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(403);

    const operator = await staff(
      [fulfillmentPermissions.pickup],
      { type: 'STORE', id: d.storeA.id },
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/fulfillment/orders/${orderId}/pickup/ready`,
          headers: operator.headers,
          payload: { idempotencyKey: crypto.randomUUID() },
        })
      ).statusCode,
    ).toBe(200);

    const consumerView = await app.inject({
      method: 'GET',
      url: `/api/v1/fulfillment/orders/${orderId}`,
      headers: consumerHeaders(d.consumerA.id),
    });
    const code = consumerView.json<{ pickup: { code: string } }>().pickup.code;
    expect(code).toMatch(/^\d{6}$/);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/fulfillment/orders/${orderId}/pickup/verify`,
          headers: operator.headers,
          payload: { idempotencyKey: crypto.randomUUID(), pickupCode: '000000' },
        })
      ).statusCode,
    ).toBe(code === '000000' ? 200 : 400);

    if (code !== '000000') {
      const key = crypto.randomUUID();
      const [a, b] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/staff/fulfillment/orders/${orderId}/pickup/verify`,
          headers: operator.headers,
          payload: { idempotencyKey: key, pickupCode: code },
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/staff/fulfillment/orders/${orderId}/pickup/verify`,
          headers: operator.headers,
          payload: { idempotencyKey: key, pickupCode: code },
        }),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    }

    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, d.storeA.id), eq(storeInventory.skuId, d.sku.id)));
    expect(balance!.onHand).toBe(4);
    const ledger = await database!.db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.referenceId, orderId));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ transactionType: 'SALE', quantityDelta: -1, balanceAfter: 4 });
    const [order] = await database!.db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('COMPLETED');
  });

  it('quotes configured delivery fees, rejects uncovered addresses and completes manual delivery', async () => {
    const d = await seed();
    await database!.db.insert(deliveryZones).values({
      storeId: d.storeA.id,
      name: '武侯同城',
      region: '四川省',
      city: '成都市',
      district: '武侯区',
      feeMinor: 600,
      providerKey: 'MANUAL',
    });

    await addOne(d.consumerA.id, d.sku.id);
    const quote = await app.inject({
      method: 'POST',
      url: '/api/v1/fulfillment/quote',
      headers: consumerHeaders(d.consumerA.id),
      payload: { method: 'DELIVERY', storeId: d.storeA.id, addressId: d.addressA.id },
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json<{ deliveryFeeMinor: number; totalMinor: number }>()).toMatchObject({
      deliveryFeeMinor: 600,
      totalMinor: 3800,
    });

    const uncovered = await app.inject({
      method: 'POST',
      url: '/api/v1/fulfillment/quote',
      headers: consumerHeaders(d.consumerA.id),
      payload: { method: 'DELIVERY', storeId: d.storeA.id, addressId: d.addressB.id },
    });
    expect(uncovered.statusCode).toBe(409);

    const created = await createFulfillmentOrder(d.consumerA.id, {
      method: 'DELIVERY',
      storeId: d.storeA.id,
      addressId: d.addressA.id,
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json<{ orderId: string }>().orderId;
    const [createdOrder] = await database!.db.select().from(orders).where(eq(orders.id, orderId));
    expect(createdOrder!.totalMinor).toBe(3800);
    await database!.db.update(orders).set({ status: 'PAID' }).where(eq(orders.id, orderId));

    const operator = await staff(
      [fulfillmentPermissions.delivery],
      { type: 'REGION', id: d.regionA.id },
    );
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/fulfillment/orders/${orderId}/delivery/dispatch`,
        headers: operator.headers,
        payload: { idempotencyKey: key },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/fulfillment/orders/${orderId}/delivery/dispatch`,
        headers: operator.headers,
        payload: { idempotencyKey: key },
      }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);

    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, d.storeA.id), eq(storeInventory.skuId, d.sku.id)));
    expect(balance!.onHand).toBe(4);
    expect(
      await database!.db
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.referenceId, orderId)),
    ).toHaveLength(1);

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/fulfillment/orders/${orderId}/delivery/complete`,
      headers: operator.headers,
      payload: { idempotencyKey: crypto.randomUUID() },
    });
    expect(completed.statusCode).toBe(200);
    const view = completed.json<{ delivery: { status: string } }>();
    expect(view.delivery.status).toBe('DELIVERED');
    const [order] = await database!.db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('COMPLETED');
  });

  it('enforces RBAC and expands REGION, FRANCHISEE and GLOBAL Data Scope in SQL', async () => {
    const d = await seed();
    await addOne(d.consumerA.id, d.sku.id);
    const created = await createFulfillmentOrder(d.consumerA.id, {
      method: 'PICKUP',
      storeId: d.storeA.id,
    });
    expect(created.statusCode).toBe(201);

    const noPermission = await staff([], { type: 'STORE', id: d.storeA.id });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/staff/fulfillment',
          headers: noPermission.headers,
        })
      ).statusCode,
    ).toBe(403);

    for (const scope of [
      { type: 'STORE' as const, id: d.storeA.id },
      { type: 'REGION' as const, id: d.regionA.id },
      { type: 'FRANCHISEE' as const, id: d.franchiseA.id },
      { type: 'GLOBAL' as const, id: null },
    ]) {
      const viewer = await staff([fulfillmentPermissions.read], scope);
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/staff/fulfillment?limit=1',
        headers: viewer.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ items: unknown[] }>().items).toHaveLength(1);
    }

    const otherStore = await staff(
      [fulfillmentPermissions.read],
      { type: 'STORE', id: d.storeB.id },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/fulfillment',
      headers: otherStore.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});
