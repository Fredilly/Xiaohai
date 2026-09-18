import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookEditions,
  books,
  consumerUsers,
  createDatabase,
  franchisees,
  inventoryReservations,
  inventoryTransactions,
  permissions,
  pickupCodes,
  products,
  regions,
  rentalEvents,
  rentalItems,
  rentalOrders,
  rolePermissions,
  roles,
  skus,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerRentalRoutes } from '../src/rental/rental-routes.js';
import { RentalService, rentalPermissions } from '../src/rental/rental-service.js';
import {
  InventoryOperationsService,
  inventoryPermissions,
} from '../src/inventory/inventory-operations-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
const consumerSessions = new ConsumerSessionService(
  'm15-consumer-test-secret-with-at-least-32-bytes',
  300,
);
const staffSessions = new StaffSessionService('m15-staff-test-secret-with-at-least-32-bytes', 300);
const pickupSecret = 'm16-pickup-test-secret-with-at-least-32-bytes';

suite('M15 rental PostgreSQL integration', () => {
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    staffSessions,
  );
  const service = new RentalService(database!.db, 14, pickupSecret);
  const app = buildApp({ staffAuthorization: authorization, logger: false });
  registerRentalRoutes(app, {
    rental: service,
    consumerSessions,
    staffAuthorization: authorization,
  });

  async function clean() {
    await database!.db.delete(rentalEvents);
    await database!.db.delete(pickupCodes);
    await database!.db.delete(inventoryReservations);
    await database!.db.delete(rentalItems);
    await database!.db.delete(rentalOrders);
    await database!.db.delete(inventoryTransactions);
    await database!.db.delete(storeInventory);
    await database!.db.delete(skus);
    await database!.db.delete(products);
    await database!.db.delete(bookEditions);
    await database!.db.delete(books);
    await database!.db.delete(stores);
    await database!.db.delete(franchisees);
    await database!.db.delete(regions);
    await database!.db.delete(consumerUsers);
    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);
  }
  beforeEach(clean);
  afterAll(async () => {
    await app.close();
    await clean();
    await database!.pool.end();
  });

  async function seed(onHand = 1) {
    const [regionA, regionB] = await database!.db
      .insert(regions)
      .values([
        { code: `M15-A-${crypto.randomUUID()}`, name: 'A', countryCode: 'CN', countryName: '中国' },
        { code: `M15-B-${crypto.randomUUID()}`, name: 'B', countryCode: 'CN', countryName: '中国' },
      ])
      .returning();
    const [franchiseA, franchiseB] = await database!.db
      .insert(franchisees)
      .values([
        { code: `M15-FA-${crypto.randomUUID()}`, regionId: regionA!.id, name: 'FA' },
        { code: `M15-FB-${crypto.randomUUID()}`, regionId: regionB!.id, name: 'FB' },
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
      latitude: 30,
      longitude: 104,
    });
    const [storeA, storeB] = await database!.db
      .insert(stores)
      .values([
        storeValue('SA', regionA!.id, franchiseA!.id),
        storeValue('SB', regionB!.id, franchiseB!.id),
      ])
      .returning();
    const [book] = await database!.db
      .insert(books)
      .values({ title: '租借测试', author: '测试' })
      .returning();
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: crypto.randomUUID() })
      .returning();
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: '租借测试', status: 'ACTIVE' })
      .returning();
    const [skuA, skuB] = await database!.db
      .insert(skus)
      .values([
        { productId: product!.id, code: crypto.randomUUID(), name: 'A', priceMinor: 0 },
        { productId: product!.id, code: crypto.randomUUID(), name: 'B', priceMinor: 0 },
      ])
      .returning();
    await database!.db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: skuA!.id, onHand },
      { storeId: storeA!.id, skuId: skuB!.id, onHand: 0 },
      { storeId: storeB!.id, skuId: skuA!.id, onHand: 2 },
    ]);
    const [consumerA, consumerB] = await database!.db
      .insert(consumerUsers)
      .values([{}, {}])
      .returning();
    return {
      regionA: regionA!,
      franchiseA: franchiseA!,
      storeA: storeA!,
      storeB: storeB!,
      skuA: skuA!,
      skuB: skuB!,
      consumerA: consumerA!,
      consumerB: consumerB!,
    };
  }
  const cAuth = (id: string) => ({ authorization: `Bearer ${consumerSessions.issue(id).token}` });
  async function staff(
    keys: string[],
    scope: { type: 'GLOBAL' | 'REGION' | 'FRANCHISEE' | 'STORE'; id: string | null },
    enabled = true,
  ) {
    const [account] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: crypto.randomUUID(), passwordHash: 'x', enabled })
      .returning();
    const [role] = await database!.db
      .insert(roles)
      .values({ key: crypto.randomUUID(), displayName: 'M15' })
      .returning();
    for (const key of keys) {
      let [p] = await database!.db
        .select()
        .from(permissions)
        .where(eq(permissions.key, key))
        .limit(1);
      if (!p)
        [p] = await database!.db.insert(permissions).values({ key, displayName: key }).returning();
      await database!.db.insert(rolePermissions).values({ roleId: role!.id, permissionId: p!.id });
    }
    await database!.db.insert(staffRoles).values({ staffAccountId: account!.id, roleId: role!.id });
    await database!.db
      .insert(staffDataScopes)
      .values({ staffAccountId: account!.id, scopeType: scope.type, scopeId: scope.id });
    return {
      id: account!.id,
      headers: { authorization: `Bearer ${staffSessions.issue(account!.id).token}` },
    };
  }
  const reserve = (
    consumerId: string,
    storeId: string,
    items: Array<{ skuId: string; quantity: number }>,
    key = crypto.randomUUID(),
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/rentals',
      headers: cAuth(consumerId),
      payload: { storeId, items, idempotencyKey: key },
    });

  it('requires Consumer Session, isolates ownership, reserves and cancels exactly once', async () => {
    const d = await seed();
    expect((await app.inject({ method: 'GET', url: '/api/v1/rentals' })).statusCode).toBe(401);
    const created = await reserve(d.consumerA.id, d.storeA.id, [{ skuId: d.skuA.id, quantity: 1 }]);
    expect(created.statusCode).toBe(201);
    const rental = created.json<{ id: string; pickupCode: string }>();
    expect(rental.pickupCode).toMatch(/^\\d{6}$/);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/rentals/${rental.id}`,
          headers: cAuth(d.consumerB.id),
        })
      ).statusCode,
    ).toBe(404);
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/rentals/${rental.id}/cancel`,
        headers: cAuth(d.consumerA.id),
        payload: { idempotencyKey: key },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/rentals/${rental.id}/cancel`,
        headers: cAuth(d.consumerA.id),
        payload: { idempotencyKey: key },
      }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, d.storeA.id), eq(storeInventory.skuId, d.skuA.id)));
    expect(balance).toMatchObject({ rentalReserved: 0, onHand: 1, version: 2 });
  });

  it('serializes the last-copy reservation and rolls back a multi-SKU shortage', async () => {
    const d = await seed();
    const [a, b] = await Promise.all([
      reserve(d.consumerA.id, d.storeA.id, [{ skuId: d.skuA.id, quantity: 1 }]),
      reserve(d.consumerB.id, d.storeA.id, [{ skuId: d.skuA.id, quantity: 1 }]),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const failed = await reserve(d.consumerB.id, d.storeA.id, [
      { skuId: d.skuA.id, quantity: 1 },
      { skuId: d.skuB.id, quantity: 1 },
    ]);
    expect(failed.statusCode).toBe(409);
    expect(await database!.db.select().from(rentalOrders)).toHaveLength(1);
    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, d.storeA.id), eq(storeInventory.skuId, d.skuB.id)));
    expect(balance!.rentalReserved).toBe(0);
  });

  it('serializes reservation against M14 physical issue and rejects the stale version', async () => {
    const d = await seed();
    const inventory = new InventoryOperationsService(database!.db);
    const context = {
      staffAccountId: crypto.randomUUID(),
      loginIdentifier: 'test',
      permissions: [inventoryPermissions.issue],
      dataScopes: [{ type: 'GLOBAL' as const, id: null }],
    };
    await database!.db.insert(staffAccounts).values({
      id: context.staffAccountId,
      loginIdentifier: crypto.randomUUID(),
      passwordHash: 'x',
    });
    const results = await Promise.allSettled([
      service.reserve(d.consumerA.id, {
        storeId: d.storeA.id,
        items: [{ skuId: d.skuA.id, quantity: 1 }],
        idempotencyKey: crypto.randomUUID(),
      }),
      inventory.issue(context, {
        storeId: d.storeA.id,
        skuId: d.skuA.id,
        quantity: 1,
        expectedVersion: 0,
        idempotencyKey: crypto.randomUUID(),
        reason: '并发租借测试',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, d.storeA.id), eq(storeInventory.skuId, d.skuA.id)));
    expect(balance!.onHand - balance!.reserved - balance!.rentalReserved).toBe(0);
    expect(balance!.version).toBe(1);
  });

  it('enforces staff auth, permissions and Data Scope', async () => {
    const d = await seed(2);
    const rental = (
      await reserve(d.consumerA.id, d.storeA.id, [{ skuId: d.skuA.id, quantity: 1 }])
    ).json<{ id: string; pickupCode: string }>();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/rentals/${rental.id}/borrow`,
          payload: { idempotencyKey: crypto.randomUUID(), pickupCode: rental.pickupCode },
        })
      ).statusCode,
    ).toBe(401);
    const denied = await staff([], { type: 'STORE', id: d.storeA.id });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/staff/rentals/${rental.id}`,
          headers: denied.headers,
        })
      ).statusCode,
    ).toBe(403);
    const disabled = await staff(
      [rentalPermissions.read],
      { type: 'STORE', id: d.storeA.id },
      false,
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/staff/rentals/${rental.id}`,
          headers: disabled.headers,
        })
      ).statusCode,
    ).toBe(401);
    for (const scope of [
      { type: 'REGION' as const, id: d.regionA.id },
      { type: 'FRANCHISEE' as const, id: d.franchiseA.id },
      { type: 'GLOBAL' as const, id: null },
    ]) {
      const allowed = await staff([rentalPermissions.read], scope);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/staff/rentals/${rental.id}`,
            headers: allowed.headers,
          })
        ).statusCode,
      ).toBe(200);
    }
    const crossing = await staff([rentalPermissions.checkout], { type: 'STORE', id: d.storeB.id });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/rentals/${rental.id}/borrow`,
          headers: crossing.headers,
          payload: { idempotencyKey: crypto.randomUUID(), pickupCode: rental.pickupCode },
        })
      ).statusCode,
    ).toBe(403);
    const region = await staff([rentalPermissions.checkout], { type: 'REGION', id: d.regionA.id });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/rentals/${rental.id}/borrow`,
          headers: region.headers,
          payload: { idempotencyKey: crypto.randomUUID(), pickupCode: rental.pickupCode },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('borrows and returns exactly once with physical ledger and overdue history', async () => {
    const d = await seed(2);
    const rental = (
      await reserve(d.consumerA.id, d.storeA.id, [{ skuId: d.skuA.id, quantity: 1 }])
    ).json<{ id: string; pickupCode: string }>();
    const user = await staff([rentalPermissions.checkout, rentalPermissions.return], {
      type: 'GLOBAL',
      id: null,
    });
    const borrowKey = crypto.randomUUID();
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/rentals/${rental.id}/borrow`,
        headers: user.headers,
        payload: { idempotencyKey: borrowKey, pickupCode: rental.pickupCode },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/rentals/${rental.id}/borrow`,
        headers: user.headers,
        payload: { idempotencyKey: borrowKey, pickupCode: rental.pickupCode },
      }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    await database!.db
      .update(rentalOrders)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(rentalOrders.id, rental.id));
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/rentals/${rental.id}`,
      headers: cAuth(d.consumerA.id),
    });
    expect(detail.json<{ status: string }>().status).toBe('OVERDUE');
    const returnKey = crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/rentals/${rental.id}/return`,
        headers: user.headers,
        payload: { idempotencyKey: returnKey },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/rentals/${rental.id}/return`,
        headers: user.headers,
        payload: { idempotencyKey: returnKey },
      }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const ledger = await database!.db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.referenceId, rental.id));
    expect(ledger.map((x) => x.transactionType).sort()).toEqual(['RENTAL_OUT', 'RENTAL_RETURN']);
    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, d.storeA.id), eq(storeInventory.skuId, d.skuA.id)));
    expect(balance).toMatchObject({ onHand: 2, rentalReserved: 0 });
    expect(
      (
        await database!.db
          .select()
          .from(rentalEvents)
          .where(eq(rentalEvents.rentalOrderId, rental.id))
      ).map((x) => x.eventType),
    ).toEqual(expect.arrayContaining(['RESERVED', 'BORROWED', 'OVERDUE', 'RETURNED']));
  });
});
