import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookEditions,
  books,
  createDatabase,
  franchisees,
  goodsReceiptItems,
  goodsReceipts,
  inventoryTransactions,
  permissions,
  products,
  purchaseOrderItems,
  purchaseOrders,
  regions,
  rolePermissions,
  roles,
  skus,
  staffAccounts,
  staffDataScopes,
  staffRoles,
  stocktakeItems,
  stocktakes,
  stockTransferItems,
  stockTransfers,
  storeInventory,
  stores,
  suppliers,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import {
  DrizzleStaffAuthorizationRepository,
  StaffAuthorizationService,
} from '../src/auth/staff-authorization.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { registerInventoryOperationsRoutes } from '../src/inventory/inventory-operations-routes.js';
import {
  InventoryOperationsService,
  inventoryPermissions,
} from '../src/inventory/inventory-operations-service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const database = hasDatabase ? createDatabase(process.env) : null;
const suite = hasDatabase ? describe : describe.skip;
const sessions = new StaffSessionService(
  'm14-inventory-integration-secret-at-least-32-characters',
  300,
);

suite('M14 inventory operations PostgreSQL integration', () => {
  const authorization = new StaffAuthorizationService(
    new DrizzleStaffAuthorizationRepository(database!.db),
    sessions,
  );
  const service = new InventoryOperationsService(database!.db);
  const makeApp = () => {
    const app = buildApp({ staffAuthorization: authorization, logger: false });
    registerInventoryOperationsRoutes(app, {
      operations: service,
      staffAuthorization: authorization,
    });
    return app;
  };

  beforeEach(async () => {
    await database!.db.delete(inventoryTransactions);
    await database!.db.delete(goodsReceiptItems);
    await database!.db.delete(goodsReceipts);
    await database!.db.delete(purchaseOrderItems);
    await database!.db.delete(purchaseOrders);
    await database!.db.delete(stocktakeItems);
    await database!.db.delete(stocktakes);
    await database!.db.delete(stockTransferItems);
    await database!.db.delete(stockTransfers);
    await database!.db.delete(storeInventory);
    await database!.db.delete(suppliers);
    await database!.db.delete(skus);
    await database!.db.delete(products);
    await database!.db.delete(bookEditions);
    await database!.db.delete(books);
    await database!.db.delete(stores);
    await database!.db.delete(franchisees);
    await database!.db.delete(regions);
    await database!.db.delete(staffAccounts);
    await database!.db.delete(roles);
    await database!.db.delete(permissions);
  });
  afterAll(async () => database?.pool.end());

  async function seed() {
    const [regionA, regionB] = await database!.db
      .insert(regions)
      .values([
        { code: 'M14-A', name: '区域 A', countryCode: 'CN', countryName: '中国' },
        { code: 'M14-B', name: '区域 B', countryCode: 'CN', countryName: '中国' },
      ])
      .returning();
    const [franchiseA, franchiseB] = await database!.db
      .insert(franchisees)
      .values([
        { code: 'M14-FA', regionId: regionA!.id, name: '加盟商 A' },
        { code: 'M14-FB', regionId: regionB!.id, name: '加盟商 B' },
      ])
      .returning();
    const [storeA, storeB, storeC] = await database!.db
      .insert(stores)
      .values([
        {
          code: 'M14-SA',
          regionId: regionA!.id,
          franchiseeId: franchiseA!.id,
          name: '门店 A',
          countryCode: 'CN',
          countryName: '中国',
          city: '成都',
          timezone: 'Asia/Shanghai',
          addressLine: 'A',
          latitude: 30,
          longitude: 104,
        },
        {
          code: 'M14-SB',
          regionId: regionA!.id,
          franchiseeId: franchiseA!.id,
          name: '门店 B',
          countryCode: 'CN',
          countryName: '中国',
          city: '成都',
          timezone: 'Asia/Shanghai',
          addressLine: 'B',
          latitude: 30,
          longitude: 104,
        },
        {
          code: 'M14-SC',
          regionId: regionB!.id,
          franchiseeId: franchiseB!.id,
          name: '门店 C',
          countryCode: 'CN',
          countryName: '中国',
          city: '重庆',
          timezone: 'Asia/Shanghai',
          addressLine: 'C',
          latitude: 29,
          longitude: 106,
        },
      ])
      .returning();
    const [book] = await database!.db
      .insert(books)
      .values({ title: '库存测试', author: '测试' })
      .returning();
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: `m14-${crypto.randomUUID()}` })
      .returning();
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: '库存测试', status: 'ACTIVE' })
      .returning();
    const [skuA, skuB] = await database!.db
      .insert(skus)
      .values([
        {
          productId: product!.id,
          code: `M14-${crypto.randomUUID()}`,
          name: 'SKU A',
          priceMinor: 100,
        },
        {
          productId: product!.id,
          code: `M14-${crypto.randomUUID()}`,
          name: 'SKU B',
          priceMinor: 200,
        },
      ])
      .returning();
    await database!.db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: skuA!.id, onHand: 10 },
      { storeId: storeA!.id, skuId: skuB!.id, onHand: 1 },
      { storeId: storeB!.id, skuId: skuA!.id, onHand: 0 },
      { storeId: storeC!.id, skuId: skuA!.id, onHand: 10 },
    ]);
    return {
      regionA: regionA!,
      regionB: regionB!,
      franchiseA: franchiseA!,
      franchiseB: franchiseB!,
      storeA: storeA!,
      storeB: storeB!,
      storeC: storeC!,
      skuA: skuA!,
      skuB: skuB!,
    };
  }

  async function staff(
    permissionKeys: string[],
    scope: { type: 'GLOBAL' | 'REGION' | 'FRANCHISEE' | 'STORE'; id: string | null },
    enabled = true,
  ) {
    const [account] = await database!.db
      .insert(staffAccounts)
      .values({
        loginIdentifier: `m14-${crypto.randomUUID()}@example.com`,
        passwordHash: 'test',
        enabled,
      })
      .returning();
    const [role] = await database!.db
      .insert(roles)
      .values({ key: `m14-${crypto.randomUUID()}`, displayName: 'M14' })
      .returning();
    if (permissionKeys.length) {
      for (const key of permissionKeys) {
        let [permission] = await database!.db
          .select()
          .from(permissions)
          .where(eq(permissions.key, key))
          .limit(1);
        if (!permission) {
          [permission] = await database!.db
            .insert(permissions)
            .values({ key, displayName: key })
            .returning();
        }
        await database!.db
          .insert(rolePermissions)
          .values({ roleId: role!.id, permissionId: permission!.id });
      }
    }
    await database!.db.insert(staffRoles).values({ staffAccountId: account!.id, roleId: role!.id });
    await database!.db
      .insert(staffDataScopes)
      .values({ staffAccountId: account!.id, scopeType: scope.type, scopeId: scope.id });
    return { id: account!.id, token: sessions.issue(account!.id).token };
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('requires authentication and permission and rejects disabled staff', async () => {
    const data = await seed();
    const app = makeApp();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/staff/inventory?storeId=${data.storeA.id}`,
        })
      ).statusCode,
    ).toBe(401);
    const noPermission = await staff([], { type: 'STORE', id: data.storeA.id });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/staff/inventory?storeId=${data.storeA.id}`,
          headers: auth(noPermission.token),
        })
      ).statusCode,
    ).toBe(403);
    const disabled = await staff(
      [inventoryPermissions.read],
      { type: 'STORE', id: data.storeA.id },
      false,
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/staff/inventory?storeId=${data.storeA.id}`,
          headers: auth(disabled.token),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('enforces STORE, REGION, FRANCHISEE and GLOBAL hierarchy from server data', async () => {
    const d = await seed();
    const app = makeApp();
    for (const [scope, allowed, denied] of [
      [{ type: 'STORE', id: d.storeA.id }, d.storeA.id, d.storeB.id],
      [{ type: 'REGION', id: d.regionA.id }, d.storeB.id, d.storeC.id],
      [{ type: 'FRANCHISEE', id: d.franchiseA.id }, d.storeB.id, d.storeC.id],
      [{ type: 'GLOBAL', id: null }, d.storeC.id, null],
    ] as const) {
      const user = await staff([inventoryPermissions.read], scope);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/staff/inventory?storeId=${allowed}`,
            headers: auth(user.token),
          })
        ).statusCode,
      ).toBe(200);
      if (denied)
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/api/v1/staff/inventory?storeId=${denied}`,
              headers: auth(user.token),
            })
          ).statusCode,
        ).toBe(403);
    }
  });

  it('serializes concurrent issues, prevents overdraw and rejects stale versions', async () => {
    const d = await seed();
    const user = await staff([inventoryPermissions.issue], { type: 'STORE', id: d.storeA.id });
    const app = makeApp();
    const body = (key: string) => ({
      storeId: d.storeA.id,
      skuId: d.skuA.id,
      quantity: 7,
      expectedVersion: 0,
      idempotencyKey: key,
      reason: '并发出库',
    });
    const [one, two] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/staff/inventory/issues',
        headers: auth(user.token),
        payload: body(crypto.randomUUID()),
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/staff/inventory/issues',
        headers: auth(user.token),
        payload: body(crypto.randomUUID()),
      }),
    ]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([201, 409]);
    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(eq(storeInventory.skuId, d.skuA.id));
    expect(balance).toMatchObject({ onHand: 3, version: 1 });
    expect(await database!.db.select().from(inventoryTransactions)).toHaveLength(1);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/inventory/issues',
      headers: auth(user.token),
      payload: { ...body(crypto.randomUUID()), quantity: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('STALE_VERSION');
  });

  it('posts a receipt once and preserves purchase receipt audit entries', async () => {
    const d = await seed();
    const user = await staff([inventoryPermissions.procurement, inventoryPermissions.receive], {
      type: 'STORE',
      id: d.storeA.id,
    });
    const [supplier] = await database!.db
      .insert(suppliers)
      .values({ code: 'M14-SUP', name: '供应商' })
      .returning();
    const app = makeApp();
    const po = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/inventory/purchase-orders',
      headers: auth(user.token),
      payload: {
        supplierId: supplier!.id,
        storeId: d.storeA.id,
        items: [{ skuId: d.skuA.id, quantity: 5 }],
      },
    });
    expect(po.statusCode).toBe(201);
    const poBody = po.json<{ id: string; items: Array<{ id: string }> }>();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/inventory/purchase-orders/${poBody.id}/actions`,
          headers: auth(user.token),
          payload: { action: 'SUBMIT' },
        })
      ).statusCode,
    ).toBe(200);
    const receipt = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/inventory/goods-receipts',
      headers: auth(user.token),
      payload: {
        purchaseOrderId: poBody.id,
        items: [{ purchaseOrderItemId: poBody.items[0]!.id, quantity: 5 }],
      },
    });
    const receiptBody = receipt.json<{ id: string }>();
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/inventory/goods-receipts/${receiptBody.id}/post`,
        headers: auth(user.token),
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/inventory/goods-receipts/${receiptBody.id}/post`,
        headers: auth(user.token),
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const [balance] = await database!.db
      .select()
      .from(storeInventory)
      .where(eq(storeInventory.skuId, d.skuA.id));
    expect(balance!.onHand).toBe(15);
    expect(await database!.db.select().from(inventoryTransactions)).toHaveLength(1);
  });

  it('enforces stocktake transitions and rejects a stale inventory snapshot', async () => {
    const data = await seed();
    const user = await staff([inventoryPermissions.stocktake], {
      type: 'STORE',
      id: data.storeA.id,
    });
    const app = makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/inventory/stocktakes',
      headers: auth(user.token),
      payload: { storeId: data.storeA.id, skuIds: [data.skuA.id] },
    });
    const doc = created.json<{ id: string }>();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/inventory/stocktakes/${doc.id}/actions`,
          headers: auth(user.token),
          payload: { action: 'POST' },
        })
      ).statusCode,
    ).toBe(409);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/staff/inventory/stocktakes/${doc.id}/counts`,
      headers: auth(user.token),
      payload: { items: [{ skuId: data.skuA.id, countedQuantity: 10 }] },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/staff/inventory/stocktakes/${doc.id}/actions`,
      headers: auth(user.token),
      payload: { action: 'REVIEW' },
    });
    await database!.db
      .update(storeInventory)
      .set({ onHand: 11, version: 1 })
      .where(
        and(eq(storeInventory.storeId, data.storeA.id), eq(storeInventory.skuId, data.skuA.id)),
      );
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/inventory/stocktakes/${doc.id}/actions`,
      headers: auth(user.token),
      payload: { action: 'POST' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('STALE_VERSION');
  });

  it('rolls back all transfer deductions if one SKU has insufficient stock and preserves revision history on success', async () => {
    const d = await seed();
    const user = await staff([inventoryPermissions.transfer], { type: 'REGION', id: d.regionA.id });
    const app = makeApp();
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/inventory/transfers',
      headers: auth(user.token),
      payload: {
        sourceStoreId: d.storeA.id,
        destinationStoreId: d.storeB.id,
        items: [
          { skuId: d.skuA.id, quantity: 2 },
          { skuId: d.skuB.id, quantity: 2 },
        ],
      },
    });
    const transfer = create.json<{ id: string }>();
    await app.inject({
      method: 'POST',
      url: `/api/v1/staff/inventory/transfers/${transfer.id}/actions`,
      headers: auth(user.token),
      payload: { action: 'SUBMIT' },
    });
    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/staff/inventory/transfers/${transfer.id}/actions`,
      headers: auth(user.token),
      payload: { action: 'DISPATCH' },
    });
    expect(failed.statusCode).toBe(409);
    const balances = await database!.db
      .select()
      .from(storeInventory)
      .where(eq(storeInventory.storeId, d.storeA.id));
    expect(balances.find((row) => row.skuId === d.skuA.id)!.onHand).toBe(10);
    expect(await database!.db.select().from(inventoryTransactions)).toHaveLength(0);
    await database!.db
      .update(stockTransferItems)
      .set({ quantity: 1 })
      .where(eq(stockTransferItems.skuId, d.skuB.id));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/staff/inventory/transfers/${transfer.id}/actions`,
          headers: auth(user.token),
          payload: { action: 'DISPATCH' },
        })
      ).statusCode,
    ).toBe(200);
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/inventory/transfers/${transfer.id}/actions`,
        headers: auth(user.token),
        payload: { action: 'RECEIVE' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/staff/inventory/transfers/${transfer.id}/actions`,
        headers: auth(user.token),
        payload: { action: 'RECEIVE' },
      }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(await database!.db.select().from(inventoryTransactions)).toHaveLength(4);
  });
});
