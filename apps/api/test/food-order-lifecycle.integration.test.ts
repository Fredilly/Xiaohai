import { lockFoodSku } from '../src/inventory/food-lock.js';
import { FoodLogisticsService } from '../src/inventory/food-logistics-service.js';
import { FoodStockOperationsService } from '../src/inventory/food-stock-operations-service.js';
import { InventoryOperationsService } from '../src/inventory/inventory-operations-service.js';
import { PaymentService } from '../src/payments/payment-service.js';
import type { WeChatPayProvider } from '../src/payments/wechat-pay.js';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  consumerUsers,
  foodBatches,
  inventoryTransactions,
  foodPhysicalReturns,
  foodTransferAllocations,
  payments,
  deliveries,
  deliveryZones,
  userAddresses,
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
import { CommerceService } from '../src/commerce/commerce-service.js';
import { FulfillmentService } from '../src/fulfillment/fulfillment-service.js';
import { ManualDeliveryProvider } from '../src/fulfillment/delivery-provider.js';
import { pickupCodeFor } from '../src/fulfillment/pickup-code.js';
import { createOwnedIntegrationDatabase } from './owned-integration-database.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const enabled = assertMeipingApplyDisposableDatabase(process.env);
const owned = enabled ? createOwnedIntegrationDatabase(process.env) : null;
const db = owned?.database.db;
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
  return {
    store: store!,
    sku: sku!,
    staff: staff!,
    consumer: consumer!,
    product: product!,
    lots,
    createOrderItem,
    balances,
  };
}

const secret = 'synthetic-pickup-secret-at-least-32-characters';
function services() {
  const commerce = new CommerceService(db!, undefined, '', true);
  return {
    commerce,
    fulfillment: new FulfillmentService(db!, commerce, secret, new ManualDeliveryProvider(), true),
  };
}
async function order(quantity = 4) {
  const f = await fixture();
  const services_ = services();
  await services_.commerce.addCartItem(f.consumer.id, f.sku.id, quantity);
  const request = { storeId: f.store.id, method: 'PICKUP' as const, clientRequestId: randomUUID() };
  const orderId = await services_.fulfillment.createOrder(f.consumer.id, request);
  const context = {
    staffAccountId: f.staff.id,
    loginIdentifier: 'synthetic',
    permissions: ['fulfillment.read', 'fulfillment.pickup', 'delivery.dispatch'],
    dataScopes: [{ type: 'STORE' as const, id: f.store.id }],
  };
  return { ...f, ...services_, request, orderId, context };
}
suite('formal food order transactions, synthetic PostgreSQL only', () => {
  beforeAll(async () => owned!.start(), 60_000);
  afterAll(async () => owned?.stop());
  it('creates the formal order, FEFO lots and cart consumption in one replay-safe transaction', async () => {
    const f = await order();
    const state = await f.balances();
    expect(state.inventory.reserved).toBe(4);
    expect(state.allocations).toHaveLength(2);
    expect((await f.commerce.getCart(f.consumer.id)).items).toHaveLength(0);
    expect(await f.fulfillment.createOrder(f.consumer.id, f.request)).toBe(f.orderId);
    expect((await f.balances()).inventory.reserved).toBe(4);
  });
  it('pickup consumes the original lots once with one total ledger and two batch events', async () => {
    const f = await order();
    await db!.update(orders).set({ status: 'PAID' }).where(eq(orders.id, f.orderId));
    await f.fulfillment.markPickupReady(f.context, f.orderId);
    await Promise.all(
      [1, 2].map(() =>
        f.fulfillment.verifyPickup(
          f.context,
          f.orderId,
          pickupCodeFor(secret, 'ORDER', f.orderId),
          randomUUID(),
        ),
      ),
    );
    const state = await f.balances();
    expect(state.inventory).toMatchObject({ onHand: 1, reserved: 0 });
    expect(state.allocations.every((r) => r.status === 'SOLD')).toBe(true);
    expect(
      await db!
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.skuId, f.sku.id)),
    ).toHaveLength(1);
  });
  it('cancellation releases exact quarantined lots and never increases physical quantity', async () => {
    const f = await order();
    await db!.update(foodBatches).set({ state: 'RECALLED' }).where(eq(foodBatches.skuId, f.sku.id));
    await f.commerce.cancelOrder(f.consumer.id, f.orderId);
    const state = await f.balances();
    expect(state.inventory).toMatchObject({ onHand: 5, reserved: 0 });
    expect(state.allocations.every((r) => r.status === 'RELEASED')).toBe(true);
    expect(state.batches.every((r) => r.state === 'RECALLED')).toBe(true);
  });
  it('late quarantine stops pickup and rolls back every ledger/state change', async () => {
    const f = await order();
    await db!.update(orders).set({ status: 'PAID' }).where(eq(orders.id, f.orderId));
    await f.fulfillment.markPickupReady(f.context, f.orderId);
    await db!.update(foodBatches).set({ state: 'HELD' }).where(eq(foodBatches.id, f.lots[1]!.id));
    await expect(
      f.fulfillment.verifyPickup(
        f.context,
        f.orderId,
        pickupCodeFor(secret, 'ORDER', f.orderId),
        randomUUID(),
      ),
    ).rejects.toBeDefined();
    const state = await f.balances();
    expect(state.inventory).toMatchObject({ onHand: 5, reserved: 4 });
    expect(state.allocations.every((r) => r.status === 'RESERVED')).toBe(true);
    expect(
      await db!
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.skuId, f.sku.id)),
    ).toHaveLength(0);
  });
  it('failed price confirmation rolls back reservations and leaves cart unchanged', async () => {
    const f = await fixture();
    const { commerce, fulfillment } = services();
    await commerce.addCartItem(f.consumer.id, f.sku.id, 4);
    await expect(
      fulfillment.createOrder(f.consumer.id, {
        storeId: f.store.id,
        method: 'PICKUP',
        clientRequestId: randomUUID(),
        expectedTotalMinor: 1,
      }),
    ).rejects.toBeDefined();
    expect((await f.balances()).inventory.reserved).toBe(0);
    expect((await commerce.getCart(f.consumer.id)).items).toHaveLength(1);
    expect(
      await db!.select().from(orders).where(eq(orders.consumerUserId, f.consumer.id)),
    ).toHaveLength(0);
  });
  it('delivery dispatch consumes food reservations once; completion does not deduct twice', async () => {
    const f = await fixture();
    const { commerce, fulfillment } = services();
    await commerce.addCartItem(f.consumer.id, f.sku.id, 4);
    await db!.insert(deliveryZones).values({
      storeId: f.store.id,
      name: 'Synthetic zone',
      region: 'Sichuan',
      city: 'Chengdu',
      feeMinor: 0,
    });
    const [address] = await db!
      .insert(userAddresses)
      .values({
        consumerUserId: f.consumer.id,
        district: 'Synthetic district',
        recipientName: 'Synthetic',
        phone: '13800000000',
        region: 'Sichuan',
        city: 'Chengdu',
        addressLine: 'Synthetic only',
      })
      .returning();
    const orderId = await fulfillment.createOrder(f.consumer.id, {
      storeId: f.store.id,
      method: 'DELIVERY',
      addressId: address!.id,
      clientRequestId: randomUUID(),
    });
    await db!.update(orders).set({ status: 'PAID' }).where(eq(orders.id, orderId));
    const context = {
      staffAccountId: f.staff.id,
      loginIdentifier: 'synthetic',
      permissions: ['delivery.dispatch', 'fulfillment.read'],
      dataScopes: [{ type: 'STORE' as const, id: f.store.id }],
    };
    await Promise.all(
      [1, 2].map(() => fulfillment.dispatchDelivery(context, orderId, randomUUID())),
    );
    expect((await f.balances()).inventory).toMatchObject({ onHand: 1, reserved: 0 });
    expect(
      (await db!.select().from(deliveries).where(eq(deliveries.orderId, orderId)))[0]!.status,
    ).toBe('DISPATCHED');
  });
  it('physical return is a separately acknowledged quarantined lot; over-return and cross-store writes fail', async () => {
    const f = await order();
    await db!.update(orders).set({ status: 'PAID' }).where(eq(orders.id, f.orderId));
    await f.fulfillment.markPickupReady(f.context, f.orderId);
    await f.fulfillment.verifyPickup(
      f.context,
      f.orderId,
      pickupCodeFor(secret, 'ORDER', f.orderId),
      randomUUID(),
    );
    const allocation = (await f.balances()).allocations[0]!;
    const service = new FoodLogisticsService(db!, true);
    const actor = { ...f.context, permissions: ['inventory.read', 'inventory.receive'] };
    const input = {
      reservationId: allocation.id,
      quantity: 1,
      idempotencyKey: randomUUID(),
      reason: 'Synthetic physical receipt',
      sourceRef: 'synthetic:return:1',
    };
    const replies = await Promise.all([1, 2].map(() => service.receiveReturn(actor, input)));
    expect(replies.filter((r) => !r.replayed)).toHaveLength(1);
    const [returned] = await db!
      .select()
      .from(foodBatches)
      .where(eq(foodBatches.id, replies[0]!.returnedBatchId));
    expect(returned).toMatchObject({
      state: 'HELD',
      onHand: 1,
      expiresOn: f.lots.find((r) => r.id === allocation.batchId)!.expiresOn,
    });
    await expect(
      service.receiveReturn(actor, {
        ...input,
        idempotencyKey: randomUUID(),
        quantity: allocation.quantity,
      }),
    ).rejects.toBeDefined();
    await expect(
      service.receiveReturn(
        { ...actor, dataScopes: [{ type: 'STORE', id: randomUUID() }] },
        { ...input, idempotencyKey: randomUUID() },
      ),
    ).rejects.toBeDefined();
    await expect(
      service.receiveReturn(actor, { ...input, idempotencyKey: randomUUID() }),
    ).rejects.toBeDefined();
    expect((await f.balances()).inventory.onHand).toBe(2);
    expect(
      await db!
        .select()
        .from(foodPhysicalReturns)
        .where(eq(foodPhysicalReturns.reservationId, allocation.id)),
    ).toHaveLength(1);
    expect((await db!.select().from(orders).where(eq(orders.id, f.orderId)))[0]!.status).toBe(
      'COMPLETED',
    );
  });
  it('transfer dispatch/receipt preserve lot provenance and quarantine; source recall prevents destination release', async () => {
    const f = await fixture();
    const [destination] = await db!
      .insert(stores)
      .values({
        code: randomUUID(),
        name: 'Synthetic destination',
        regionId: f.store.regionId,
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Synthetic',
        latitude: 30,
        longitude: 104,
      })
      .returning();
    const actor = {
      staffAccountId: f.staff.id,
      loginIdentifier: 'synthetic',
      permissions: ['inventory.read', 'inventory.transfer', 'inventory.adjust'],
      dataScopes: [{ type: 'GLOBAL' as const, id: null }],
    };
    const operations = new InventoryOperationsService(db!, true);
    const doc = await operations.createTransfer(actor, {
      sourceStoreId: f.store.id,
      destinationStoreId: destination!.id,
      items: [{ skuId: f.sku.id, quantity: 4 }],
      notes: null,
    });
    await operations.actOnTransfer(actor, doc.id, 'SUBMIT');
    await expect(
      new InventoryOperationsService(db!).actOnTransfer(actor, doc.id, 'DISPATCH'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await Promise.all([1, 2].map(() => operations.actOnTransfer(actor, doc.id, 'DISPATCH')));
    expect((await f.balances()).inventory.onHand).toBe(1);
    await expect(
      operations.actOnTransfer(
        { ...actor, dataScopes: [{ type: 'STORE', id: f.store.id }] },
        doc.id,
        'RECEIVE',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await Promise.all([1, 2].map(() => operations.actOnTransfer(actor, doc.id, 'RECEIVE')));
    const received = await db!
      .select()
      .from(foodBatches)
      .where(eq(foodBatches.storeId, destination!.id));
    expect(received).toHaveLength(2);
    expect(received.every((r) => r.state === 'HELD')).toBe(true);
    expect(received.reduce((n, r) => n + r.onHand, 0)).toBe(4);
    const links = await db!
      .select()
      .from(foodTransferAllocations)
      .where(eq(foodTransferAllocations.transferItemId, doc.items[0]!.id));
    expect(links).toHaveLength(2);
    expect(links.every((r) => r.destinationBatchId)).toBe(true);
    const target = received[0]!;
    const origin = links.find((r) => r.destinationBatchId === target.id)!.sourceBatchId;
    await db!.update(foodBatches).set({ state: 'RECALLED' }).where(eq(foodBatches.id, origin));
    await expect(
      new FoodStockOperationsService(db!).disposition(
        actor,
        {
          storeId: destination!.id,
          skuId: f.sku.id,
          batchId: target.id,
          expectedInventoryVersion: 1,
          expectedVersion: 0,
          state: 'AVAILABLE',
          idempotencyKey: randomUUID(),
          reason: 'Synthetic inspection',
          sourceRef: 'synthetic:inspection:1',
        },
        'synthetic',
      ),
    ).rejects.toBeDefined();
    expect(
      (await new FoodLogisticsService(db!).trace(actor, target.id)).transfers[0]!.sourceBatchId,
    ).toBe(origin);

    await db!.update(foodBatches).set({ state: 'AVAILABLE' }).where(eq(foodBatches.id, origin));
    await new FoodStockOperationsService(db!).disposition(
      actor,
      {
        storeId: destination!.id,
        skuId: f.sku.id,
        batchId: target.id,
        expectedInventoryVersion: 1,
        expectedVersion: 0,
        state: 'AVAILABLE',
        idempotencyKey: randomUUID(),
        reason: 'Synthetic reinspection',
        sourceRef: 'synthetic:inspection:2',
      },
      'synthetic',
    );
    await db!.update(foodBatches).set({ state: 'RECALLED' }).where(eq(foodBatches.id, origin));
    const read = await new FoodStockOperationsService(db!).read(actor, destination!.id, f.sku.id);
    expect(read.result.sellable).toBe(0);
    const { commerce, fulfillment } = services();
    await commerce.addCartItem(f.consumer.id, f.sku.id, 1);
    await expect(
      fulfillment.createOrder(f.consumer.id, {
        storeId: destination!.id,
        method: 'PICKUP',
        clientRequestId: randomUUID(),
      }),
    ).rejects.toBeDefined();
  });
  it.each(['unfulfilled', 'fulfilled'] as const)(
    'synthetic full refund of %s food never returns physical stock',
    async (mode) => {
      const f = await order();
      await db!.update(orders).set({ status: 'PAID' }).where(eq(orders.id, f.orderId));
      if (mode === 'fulfilled') {
        await f.fulfillment.markPickupReady(f.context, f.orderId);
        await f.fulfillment.verifyPickup(
          f.context,
          f.orderId,
          pickupCodeFor(secret, 'ORDER', f.orderId),
          randomUUID(),
        );
      }
      const trade = randomUUID(),
        transaction = randomUUID();
      const [payment] = await db!
        .insert(payments)
        .values({
          orderId: f.orderId,
          merchantId: 'synthetic',
          appId: 'synthetic',
          outTradeNo: trade,
          amountMinor: 400,
          status: 'SUCCEEDED',
          providerTransactionId: transaction,
        })
        .returning();
      const provider = {
        appId: 'synthetic',
        merchantId: 'synthetic',
        assertConfigured() {},
        refund: (input: { outRefundNo: string }) =>
          Promise.resolve({
            out_trade_no: trade,
            transaction_id: transaction,
            out_refund_no: input.outRefundNo,
            refund_id: randomUUID(),
            status: 'SUCCESS',
            amount: { total: 400, refund: 400, currency: 'CNY' },
          }),
      } as unknown as WeChatPayProvider;
      const service = new PaymentService(db!, provider);
      await service.requestRefund(payment!.id, f.staff.id);
      await service.requestRefund(payment!.id, f.staff.id);
      const state = await f.balances();
      expect(state.inventory).toMatchObject({ onHand: mode === 'fulfilled' ? 1 : 5, reserved: 0 });
      const reservationIds = state.allocations.map((r) => r.id);
      expect(
        await db!
          .select()
          .from(foodPhysicalReturns)
          .where(inArray(foodPhysicalReturns.reservationId, reservationIds)),
      ).toHaveLength(0);
      expect((await db!.select().from(orders).where(eq(orders.id, f.orderId)))[0]!.status).toBe(
        'REFUNDED',
      );
    },
  );
  it('ordinary merchandise opening stock works with every food switch disabled', async () => {
    const f = await fixture();
    const [sku] = await db!
      .insert(skus)
      .values({
        productId: f.product.id,
        code: randomUUID(),
        name: 'Synthetic ordinary goods',
        priceMinor: 50,
        availableForSale: true,
      })
      .returning();
    const actor = {
      staffAccountId: f.staff.id,
      loginIdentifier: 'synthetic',
      permissions: ['inventory.read', 'inventory.adjust'],
      dataScopes: [{ type: 'STORE' as const, id: f.store.id }],
    };
    const operations = new InventoryOperationsService(db!);
    const input = {
      storeId: f.store.id,
      skuId: sku!.id,
      initialQuantity: 7,
      reason: 'Synthetic South-store count',
      idempotencyKey: randomUUID(),
    };
    const first = await operations.registerOpeningStock(actor, input, 'synthetic');
    expect(first.onHand).toBe(7);
    expect((await operations.registerOpeningStock(actor, input, 'synthetic')).onHand).toBe(7);
    expect(
      await db!
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.skuId, sku!.id)),
    ).toHaveLength(1);
  });
  it('concurrent formal orders compete for the last units without consuming the losing cart', async () => {
    const f = await fixture();
    const { commerce, fulfillment } = services();
    const [other] = await db!.insert(consumerUsers).values({}).returning();
    const users = [f.consumer.id, other!.id];
    await Promise.all(users.map((id) => commerce.addCartItem(id, f.sku.id, 4)));
    const results = await Promise.allSettled(
      users.map((id) =>
        fulfillment.createOrder(id, {
          storeId: f.store.id,
          method: 'PICKUP',
          clientRequestId: randomUUID(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.balances()).inventory.reserved).toBe(4);
    const loser = users[results.findIndex((r) => r.status === 'rejected')]!;
    expect((await commerce.getCart(loser)).items).toHaveLength(1);
  });
  it('a later transfer line failure rolls back earlier food dispatch and trace rows', async () => {
    const f = await fixture();
    const [destination] = await db!
      .insert(stores)
      .values({
        code: randomUUID(),
        name: 'Synthetic destination',
        regionId: f.store.regionId,
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Synthetic',
        latitude: 30,
        longitude: 104,
      })
      .returning();
    const [extra] = await db!
      .insert(skus)
      .values({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        productId: f.product.id,
        code: randomUUID(),
        name: 'Synthetic insufficient ordinary goods',
        priceMinor: 50,
      })
      .returning();
    await db!.insert(storeInventory).values({ storeId: f.store.id, skuId: extra!.id, onHand: 0 });
    const actor = {
      staffAccountId: f.staff.id,
      loginIdentifier: 'synthetic',
      permissions: ['inventory.read', 'inventory.transfer'],
      dataScopes: [{ type: 'GLOBAL' as const, id: null }],
    };
    const service = new InventoryOperationsService(db!, true);
    const transfer = await service.createTransfer(actor, {
      sourceStoreId: f.store.id,
      destinationStoreId: destination!.id,
      items: [
        { skuId: f.sku.id, quantity: 4 },
        { skuId: extra!.id, quantity: 1 },
      ],
      notes: null,
    });
    await service.actOnTransfer(actor, transfer.id, 'SUBMIT');
    await expect(service.actOnTransfer(actor, transfer.id, 'DISPATCH')).rejects.toBeDefined();
    expect((await f.balances()).inventory.onHand).toBe(5);
    expect(
      await db!
        .select()
        .from(foodTransferAllocations)
        .where(
          eq(
            foodTransferAllocations.transferItemId,
            transfer.items.find((r) => r.skuId === f.sku.id)!.id,
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db!
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.skuId, f.sku.id)),
    ).toHaveLength(0);
  });
  it('a recall already holding the trace lock wins over a concurrent pickup', async () => {
    const f = await order();
    await db!.update(orders).set({ status: 'PAID' }).where(eq(orders.id, f.orderId));
    await f.fulfillment.markPickupReady(f.context, f.orderId);
    let unlock!: () => void, notify!: () => void;
    const held = new Promise<void>((r) => {
      notify = r;
    });
    const gate = new Promise<void>((r) => {
      unlock = r;
    });
    const recalling = db!.transaction(async (tx) => {
      await lockFoodSku(tx, f.sku.id);
      await tx
        .update(foodBatches)
        .set({ state: 'RECALLED' })
        .where(eq(foodBatches.id, f.lots[0]!.id));
      notify();
      await gate;
    });
    await held;
    const pickup = f.fulfillment
      .verifyPickup(f.context, f.orderId, pickupCodeFor(secret, 'ORDER', f.orderId), randomUUID())
      .then(
        () => ({ success: true }),
        () => ({ success: false }),
      );
    let waiting = false;
    try {
      for (let i = 0; i < 100; i++) {
        const result = await db!.execute<{ waiting: boolean }>(
          sql`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory' and not l.granted and a.datname=current_database()) as waiting`,
        );
        if (result.rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      unlock();
    }
    await recalling;
    expect(waiting).toBe(true);
    expect(await pickup).toEqual({ success: false });
    expect((await f.balances()).inventory).toMatchObject({ onHand: 5, reserved: 4 });
  });
  it('consumer ownership prevents cancellation of another customer food reservation', async () => {
    const f = await order();
    await expect(f.commerce.cancelOrder(randomUUID(), f.orderId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await f.balances()).inventory.reserved).toBe(4);
  });
  it('store payment/refund scope is bound to the order before any Provider call; GLOBAL API remains separate', async () => {
    const a = await order();
    const b = await order();
    await db!
      .update(orders)
      .set({ status: 'PAID' })
      .where(inArray(orders.id, [a.orderId, b.orderId]));
    const rows = await db!
      .insert(payments)
      .values(
        [a, b].map((f) => ({
          orderId: f.orderId,
          merchantId: 'synthetic',
          appId: 'synthetic',
          outTradeNo: randomUUID(),
          amountMinor: 400,
          status: 'SUCCEEDED',
          providerTransactionId: randomUUID(),
        })),
      )
      .returning();
    const paymentA = rows.find((r) => r.orderId === a.orderId)!,
      paymentB = rows.find((r) => r.orderId === b.orderId)!;
    const stableRefundId = randomUUID();
    const refund = vi.fn<WeChatPayProvider['refund']>().mockImplementation((input) =>
      Promise.resolve({
        out_trade_no: paymentA.outTradeNo,
        transaction_id: paymentA.providerTransactionId!,
        out_refund_no: input.outRefundNo,
        refund_id: stableRefundId,
        status: 'SUCCESS',
        amount: { total: 400, refund: 400, currency: 'CNY' },
      }),
    );
    const configured = vi.fn();
    const query = vi.fn<WeChatPayProvider['query']>();
    const provider = {
      appId: 'synthetic',
      merchantId: 'synthetic',
      assertConfigured: configured,
      refund,
      query,
    } as unknown as WeChatPayProvider;
    const service = new PaymentService(db!, provider);
    const actor = {
      ...a.context,
      permissions: ['payments.read', 'payments.refund', 'payments.reconcile'],
    };
    expect((await service.listStorePayments(actor, a.store.id)).map((r) => r.id)).toEqual([
      paymentA.id,
    ]);
    await expect(service.listStorePayments(actor, b.store.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      service.requestStoreRefund(actor, a.store.id, paymentB.id, 'synthetic'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.requestStoreRefund(actor, b.store.id, paymentB.id, 'synthetic'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.reconcileStorePayment(actor, a.store.id, paymentB.id, 'synthetic'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.requestStoreRefund(
        { ...actor, permissions: ['payments.read'] },
        a.store.id,
        paymentA.id,
        'synthetic',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(configured).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    await Promise.all(
      [1, 2].map(() => service.requestStoreRefund(actor, a.store.id, paymentA.id, 'synthetic')),
    );
    expect(refund.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(new Set(refund.mock.calls.map(([input]) => input.outRefundNo)).size).toBe(1);
    expect((await a.balances()).inventory).toMatchObject({ onHand: 5, reserved: 0 });
    expect((await b.balances()).inventory.reserved).toBe(4);
  });
});
