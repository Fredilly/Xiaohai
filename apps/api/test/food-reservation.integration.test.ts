import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumerUsers,
  foodBatches,
  foodBatchReservationEvents,
  foodBatchReservations,
  orderItems,
  orders,
  pickupCodes,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { FoodReservationService } from '../src/inventory/food-reservation-service.js';
import { createOwnedIntegrationDatabase } from './owned-integration-database.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const enabled = assertMeipingApplyDisposableDatabase(process.env);
const owned = enabled ? createOwnedIntegrationDatabase(process.env) : null;
const db = owned?.database.db;
const service = db ? new FoodReservationService(db, true) : null;
const suite = owned ? describe : describe.skip;

async function fixture({ first = 2, second = 3 } = {}) {
  const marker = randomUUID();
  const [staff] = await db!
    .insert(staffAccounts)
    .values({
      loginIdentifier: marker,
      passwordHash: 'synthetic-only',
    })
    .returning();
  const [consumer] = await db!.insert(consumerUsers).values({}).returning();
  const [region] = await db!
    .insert(regions)
    .values({
      code: marker,
      name: 'Synthetic FEFO region',
      countryCode: 'CN',
      countryName: 'China',
    })
    .returning();
  const [store] = await db!
    .insert(stores)
    .values({
      code: marker,
      name: 'Synthetic FEFO store',
      regionId: region!.id,
      countryCode: 'CN',
      countryName: 'China',
      city: 'Chengdu',
      timezone: 'Asia/Shanghai',
      addressLine: 'Synthetic only',
      latitude: 30,
      longitude: 104,
    })
    .returning();
  const [product] = await db!
    .insert(products)
    .values({ name: 'Food', status: 'ACTIVE' })
    .returning();
  const [sku] = await db!
    .insert(skus)
    .values({
      productId: product!.id,
      code: marker,
      name: 'Synthetic SKU',
      priceMinor: 100,
      availableForSale: true,
    })
    .returning();
  await db!
    .insert(storeInventory)
    .values({ storeId: store!.id, skuId: sku!.id, onHand: first + second });
  const lots = await db!
    .insert(foodBatches)
    .values([
      {
        storeId: store!.id,
        skuId: sku!.id,
        lotCode: 'early',
        foodKind: 'PACKAGED_FOOD' as const,
        expiresOn: '2098-01-01',
        onHand: first,
        state: 'AVAILABLE',
        createdByStaffAccountId: staff!.id,
      },
      {
        storeId: store!.id,
        skuId: sku!.id,
        lotCode: 'late',
        foodKind: 'PACKAGED_FOOD' as const,
        expiresOn: '2099-01-01',
        onHand: second,
        state: 'AVAILABLE',
        createdByStaffAccountId: staff!.id,
      },
    ])
    .returning();

  async function createOrderItem(quantity: number) {
    const [order] = await db!
      .insert(orders)
      .values({
        consumerUserId: consumer!.id,
        orderNumber: randomUUID(),
        status: 'UNPAID',
        subtotalMinor: 100 * quantity,
        totalMinor: 100 * quantity,
        clientRequestId: randomUUID(),
        fulfillmentFingerprint: randomUUID(),
      })
      .returning();
    const [item] = await db!
      .insert(orderItems)
      .values({
        orderId: order!.id,
        skuId: sku!.id,
        quantity,
        productNameSnapshot: 'Food',
        skuNameSnapshot: 'Synthetic SKU',
        skuCodeSnapshot: marker,
        unitPriceMinor: 100,
        lineTotalMinor: 100 * quantity,
      })
      .returning();
    await db!.insert(pickupCodes).values({ orderId: order!.id, storeId: store!.id });
    return { order: order!, item: item! };
  }

  async function balances() {
    const allocations = await db!
      .select()
      .from(foodBatchReservations)
      .where(eq(foodBatchReservations.skuId, sku!.id));
    return {
      inventory: (
        await db!
          .select()
          .from(storeInventory)
          .where(and(eq(storeInventory.storeId, store!.id), eq(storeInventory.skuId, sku!.id)))
      )[0]!,
      batches: await db!.select().from(foodBatches).where(eq(foodBatches.skuId, sku!.id)),
      allocations,
      events: allocations.length
        ? await db!
            .select()
            .from(foodBatchReservationEvents)
            .where(
              inArray(
                foodBatchReservationEvents.reservationId,
                allocations.map((row) => row.id),
              ),
            )
        : [],
    };
  }
  return { store: store!, sku: sku!, lots, createOrderItem, balances };
}

suite('FEFO order-item reservations on exclusively-owned PostgreSQL', () => {
  beforeAll(async () => owned!.start(), 60_000);
  afterAll(async () => owned?.stop());

  it('keeps internal reservation writes default closed', async () => {
    const f = await fixture();
    const { item } = await f.createOrderItem(1);
    const closed = new FoodReservationService(db!);
    await expect(closed.reserve(item.id, f.store.id)).rejects.toMatchObject({
      code: 'WRITES_DISABLED',
    });
    await expect(closed.release(item.id, f.store.id)).rejects.toMatchObject({
      code: 'WRITES_DISABLED',
    });
    expect((await f.balances()).allocations).toHaveLength(0);
  });

  it('reserves oldest valid lot first, replays exactly, and releases both lots with append-only evidence', async () => {
    const f = await fixture();
    const { item } = await f.createOrderItem(4);
    const first = await service!.reserve(item.id, f.store.id);
    expect(first).toMatchObject({
      replayed: false,
      allocations: [
        { batchId: f.lots[0]!.id, quantity: 2 },
        { batchId: f.lots[1]!.id, quantity: 2 },
      ],
    });
    expect(await service!.reserve(item.id, f.store.id)).toMatchObject({ ...first, replayed: true });
    const before = await f.balances();
    expect(before.inventory).toMatchObject({ onHand: 5, reserved: 4 });
    expect(new Map(before.batches.map((lot) => [lot.id, lot.reserved]))).toEqual(
      new Map([
        [f.lots[0]!.id, 2],
        [f.lots[1]!.id, 2],
      ]),
    );
    expect(before.events).toHaveLength(2);
    // Recall after reservation is allowed; release never re-sells recalled stock.
    await db!
      .update(foodBatches)
      .set({ state: 'RECALLED' })
      .where(eq(foodBatches.id, f.lots[0]!.id));
    const releases = await Promise.all([
      service!.release(item.id, f.store.id),
      service!.release(item.id, f.store.id),
    ]);
    expect(releases).toEqual(
      expect.arrayContaining([
        { released: 4, replayed: false },
        { released: 0, replayed: true },
      ]),
    );
    const after = await f.balances();
    expect(after.inventory).toMatchObject({ onHand: 5, reserved: 0 });
    expect(after.batches.every((lot) => lot.reserved === 0)).toBe(true);
    expect(after.allocations.map((a) => a.status)).toEqual(['RELEASED', 'RELEASED']);
    expect(after.events).toHaveLength(4);
    await expect(
      db!
        .update(foodBatchReservationEvents)
        .set({ eventType: 'SALE' })
        .where(eq(foodBatchReservationEvents.id, after.events[0]!.id)),
    ).rejects.toMatchObject({
      cause: { code: '55000', message: 'FOOD_RESERVATION_EVENT_APPEND_ONLY' },
    });
  });

  it('serializes last-unit competition and rolls back losing reservations', async () => {
    const f = await fixture();
    const first = await f.createOrderItem(4);
    const second = await f.createOrderItem(4);
    const attempts = await Promise.allSettled([
      service!.reserve(first.item.id, f.store.id),
      service!.reserve(second.item.id, f.store.id),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const after = await f.balances();
    expect(after.inventory).toMatchObject({ onHand: 5, reserved: 4 });
    expect(after.allocations.reduce((sum, line) => sum + line.quantity, 0)).toBe(4);
    expect(after.events).toHaveLength(2);
  });

  it('fails closed for cross-store orders, expired/held lots and inconsistent reserved counts', async () => {
    const f = await fixture();
    const { item } = await f.createOrderItem(4);
    await expect(service!.reserve(item.id, randomUUID())).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await db!.update(foodBatches).set({ state: 'HELD' }).where(eq(foodBatches.id, f.lots[0]!.id));
    await expect(service!.reserve(item.id, f.store.id)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    await db!
      .update(foodBatches)
      .set({ state: 'AVAILABLE', expiresOn: '2000-01-01' })
      .where(eq(foodBatches.id, f.lots[0]!.id));
    await expect(service!.reserve(item.id, f.store.id)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    await db!
      .update(foodBatches)
      .set({ expiresOn: '2098-01-01', reserved: 1 })
      .where(eq(foodBatches.id, f.lots[0]!.id));
    await db!
      .update(storeInventory)
      .set({ reserved: 1 })
      .where(and(eq(storeInventory.storeId, f.store.id), eq(storeInventory.skuId, f.sku.id)));
    await expect(service!.reserve(item.id, f.store.id)).rejects.toMatchObject({
      code: 'UNRECONCILED_FOOD_STOCK',
    });
    expect((await f.balances()).allocations).toHaveLength(0);
  });

  it('rejects forged or partial event history at COMMIT', async () => {
    const f = await fixture();
    const { item } = await f.createOrderItem(1);
    await expect(
      db!.insert(foodBatchReservations).values({
        orderItemId: item.id,
        storeId: f.store.id,
        skuId: f.sku.id,
        batchId: f.lots[0]!.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', message: 'FOOD_RESERVATION_EVENT_MISMATCH' },
    });
    expect((await f.balances()).allocations).toHaveLength(0);
  });
  it('rejects a complete-looking partial allocation group and a sale with no physical ledger at COMMIT', async () => {
    const f = await fixture();
    const { item } = await f.createOrderItem(4);
    await expect(
      db!.transaction(async (tx) => {
        const [allocation] = await tx
          .insert(foodBatchReservations)
          .values({
            orderItemId: item.id,
            storeId: f.store.id,
            skuId: f.sku.id,
            batchId: f.lots[0]!.id,
            quantity: 1,
          })
          .returning();
        await tx.insert(foodBatchReservationEvents).values({
          reservationId: allocation!.id,
          eventType: 'RESERVE',
          quantity: 1,
          idempotencyKey: randomUUID(),
        });
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await service!.reserve(item.id, f.store.id);
    const before = await f.balances();
    await expect(
      db!.transaction(async (tx) => {
        for (const row of before.allocations) {
          await tx
            .update(foodBatchReservations)
            .set({ status: 'SOLD' })
            .where(eq(foodBatchReservations.id, row.id));
          await tx.insert(foodBatchReservationEvents).values({
            reservationId: row.id,
            eventType: 'SALE',
            quantity: row.quantity,
            idempotencyKey: randomUUID(),
          });
        }
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    expect((await f.balances()).allocations.every((r) => r.status === 'RESERVED')).toBe(true);
  });
});
