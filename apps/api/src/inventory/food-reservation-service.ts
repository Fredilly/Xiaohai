import { lockFoodSku } from './food-lock.js';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  deliveries,
  foodBatches,
  foodBatchTransactions,
  inventoryTransactions,
  foodBatchReservationEvents,
  foodBatchReservations,
  orderItems,
  orders,
  pickupCodes,
  products,
  skus,
  storeInventory,
  stores,
  type createDatabase,
} from '@xiaohai/db';
import { evaluatePackagedFoodStock, planFoodFefoAllocation } from '@xiaohai/domain';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export class FoodReservationError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'INVALID_STATE'
      | 'WRITES_DISABLED'
      | 'UNRECONCILED_FOOD_STOCK'
      | 'INSUFFICIENT_STOCK',
  ) {
    super(code);
  }
}

/** FEFO allocations participate in the caller's formal order transaction.
 * Both deployment gates default off. Release remains available to cancel or
 * refund an existing unfulfilled order, without returning physical stock.
 */
export class FoodReservationService {
  constructor(
    private readonly db: Database,
    private readonly writesEnabled = false,
  ) {}

  async reserve(orderItemId: string, storeId: string) {
    if (!this.writesEnabled) throw new FoodReservationError('WRITES_DISABLED');
    return this.db.transaction((tx) => this.reserveInTransaction(tx, orderItemId, storeId));
  }

  async reserveInTransaction(tx: Transaction, orderItemId: string, storeId: string) {
    if (!this.writesEnabled) throw new FoodReservationError('WRITES_DISABLED');
    const item = await lockOrderItem(tx, orderItemId, storeId);
    if (item.orderStatus !== 'UNPAID') throw new FoodReservationError('INVALID_STATE');
    const { balance, batches } = await lockFoodStock(tx, storeId, item.skuId);
    const existing = await tx
      .select()
      .from(foodBatchReservations)
      .where(eq(foodBatchReservations.orderItemId, orderItemId))
      .orderBy(asc(foodBatchReservations.batchId));
    await assertAllocationBalances(tx, batches, balance.reserved, balance.rentalReserved);
    if (existing.length) {
      if (
        existing.some(
          (row) => row.storeId !== storeId || row.skuId !== item.skuId || row.status !== 'RESERVED',
        ) ||
        existing.reduce((sum, row) => sum + row.quantity, 0) !== item.quantity
      )
        throw new FoodReservationError('CONFLICT');
      return {
        allocations: [...existing]
          .sort((a, b) => {
            const first = batches.find((r) => r.id === a.batchId)!;
            const second = batches.find((r) => r.id === b.batchId)!;
            return (
              first.expiresOn.localeCompare(second.expiresOn) || a.batchId.localeCompare(b.batchId)
            );
          })
          .map(({ batchId, quantity }) => ({ batchId, quantity })),
        replayed: true,
      };
    }

    const [catalog] = await tx
      .select({
        productStatus: products.status,
        skuStatus: skus.status,
        forSale: skus.availableForSale,
      })
      .from(skus)
      .innerJoin(products, eq(skus.productId, products.id))
      .where(eq(skus.id, item.skuId));
    if (
      !catalog ||
      batches.some((row) => !row.foodKind) ||
      new Set(batches.map((row) => row.foodKind)).size !== 1
    )
      throw new FoodReservationError('INVALID_STATE');
    const [store] = await tx
      .select({ timezone: stores.timezone })
      .from(stores)
      .where(eq(stores.id, storeId));
    if (!store) throw new FoodReservationError('NOT_FOUND');
    const date = await tx.execute<{ today: string }>(
      sql`select to_char(clock_timestamp() AT TIME ZONE ${store.timezone}, 'YYYY-MM-DD') as today`,
    );
    const eligibility = await tx
      .select({ id: foodBatches.id, ok: sql<boolean>`food_lot_origin_usable(${foodBatches.id})` })
      .from(foodBatches)
      .where(
        inArray(
          foodBatches.id,
          batches.map((r) => r.id),
        ),
      );
    const safeBatchIds = new Set(eligibility.filter((r) => r.ok).map((r) => r.id));
    const projection = evaluatePackagedFoodStock({
      businessDate: date.rows[0]!.today,
      aggregate: {
        storeId,
        skuId: item.skuId,
        onHand: balance.onHand,
        reserved: balance.reserved,
        rentalReserved: balance.rentalReserved,
        productStatus: catalog.productStatus as 'DRAFT' | 'ACTIVE' | 'INACTIVE',
        skuStatus: catalog.skuStatus as 'ACTIVE' | 'INACTIVE',
        availableForSale: catalog.forSale,
      },
      batches: batches.map((row) => ({
        ...row,
        state: (safeBatchIds.has(row.id) ? row.state : 'HELD') as 'AVAILABLE' | 'HELD' | 'RECALLED',
      })),
    });
    if (projection.status !== 'READY') throw new FoodReservationError('INVALID_STATE');
    let allocation: ReturnType<typeof planFoodFefoAllocation>;
    try {
      allocation = planFoodFefoAllocation(projection, item.quantity);
    } catch {
      throw new FoodReservationError('INSUFFICIENT_STOCK');
    }
    for (const line of allocation) {
      const batch = batches.find((row) => row.id === line.batchId)!;
      await tx
        .update(foodBatches)
        .set({
          reserved: batch.reserved + line.quantity,
          version: batch.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(foodBatches.id, batch.id));
      const [reservation] = await tx
        .insert(foodBatchReservations)
        .values({
          orderItemId,
          storeId,
          skuId: item.skuId,
          batchId: batch.id,
          quantity: line.quantity,
        })
        .returning({ id: foodBatchReservations.id });
      await tx.insert(foodBatchReservationEvents).values({
        reservationId: reservation!.id,
        eventType: 'RESERVE',
        quantity: line.quantity,
        idempotencyKey: `food-reserve:${orderItemId}:${batch.id}`,
      });
    }
    await tx
      .update(storeInventory)
      .set({
        reserved: balance.reserved + item.quantity,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, item.skuId)));
    return { allocations: allocation, replayed: false };
  }

  /** Release an UNPAID/CANCELLED order item's exact original lots, including recalled lots. */
  async release(orderItemId: string, storeId: string) {
    if (!this.writesEnabled) throw new FoodReservationError('WRITES_DISABLED');
    return this.db.transaction((tx) => this.releaseInTransaction(tx, orderItemId, storeId));
  }

  async releaseInTransaction(
    tx: Transaction,
    orderItemId: string,
    storeId: string,
    reason: 'CANCEL' | 'REFUND' = 'CANCEL',
  ) {
    if (!this.writesEnabled) throw new FoodReservationError('WRITES_DISABLED');
    const item = await lockOrderItem(tx, orderItemId, storeId);
    if (
      !(reason === 'REFUND' ? ['REFUNDING', 'REFUNDED'] : ['UNPAID', 'CANCELLED']).includes(
        item.orderStatus,
      )
    )
      throw new FoodReservationError('INVALID_STATE');
    const { balance, batches } = await lockFoodStock(tx, storeId, item.skuId);
    const rows = await tx
      .select()
      .from(foodBatchReservations)
      .where(eq(foodBatchReservations.orderItemId, orderItemId))
      .orderBy(asc(foodBatchReservations.batchId));
    await assertAllocationBalances(tx, batches, balance.reserved, balance.rentalReserved);
    if (!rows.length || rows.some((row) => row.storeId !== storeId || row.skuId !== item.skuId))
      throw new FoodReservationError('NOT_FOUND');
    if (rows.every((row) => row.status === 'RELEASED')) return { released: 0, replayed: true };
    if (
      rows.some((row) => row.status !== 'RESERVED') ||
      rows.reduce((sum, row) => sum + row.quantity, 0) !== item.quantity
    )
      throw new FoodReservationError('CONFLICT');
    for (const row of rows) {
      const batch = batches.find((entry) => entry.id === row.batchId);
      if (!batch || batch.reserved < row.quantity)
        throw new FoodReservationError('UNRECONCILED_FOOD_STOCK');
      await tx
        .update(foodBatches)
        .set({
          reserved: batch.reserved - row.quantity,
          version: batch.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(foodBatches.id, batch.id));
      await tx
        .update(foodBatchReservations)
        .set({ status: 'RELEASED', updatedAt: new Date() })
        .where(
          and(eq(foodBatchReservations.id, row.id), eq(foodBatchReservations.status, 'RESERVED')),
        );
      await tx.insert(foodBatchReservationEvents).values({
        reservationId: row.id,
        eventType: 'RELEASE',
        quantity: row.quantity,
        idempotencyKey: `food-release:${orderItemId}:${row.batchId}`,
      });
    }
    if (balance.reserved < item.quantity) throw new FoodReservationError('UNRECONCILED_FOOD_STOCK');
    await tx
      .update(storeInventory)
      .set({
        reserved: balance.reserved - item.quantity,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, item.skuId)));
    return { released: item.quantity, replayed: false };
  }
  /** Consume only the exact lots already allocated to this paid order item. */
  async sellInTransaction(
    tx: Transaction,
    orderItemId: string,
    storeId: string,
    staffAccountId: string,
  ) {
    if (!this.writesEnabled) throw new FoodReservationError('WRITES_DISABLED');
    const item = await lockOrderItem(tx, orderItemId, storeId);
    if (!['PAID', 'PICKUP_READY'].includes(item.orderStatus))
      throw new FoodReservationError('INVALID_STATE');
    const { balance, batches } = await lockFoodStock(tx, storeId, item.skuId);
    const rows = await tx
      .select()
      .from(foodBatchReservations)
      .where(eq(foodBatchReservations.orderItemId, orderItemId))
      .orderBy(asc(foodBatchReservations.batchId));
    await assertAllocationBalances(tx, batches, balance.reserved, balance.rentalReserved);
    if (
      !rows.length ||
      rows.some((r) => r.storeId !== storeId || r.skuId !== item.skuId) ||
      rows.reduce((n, r) => n + r.quantity, 0) !== item.quantity
    )
      throw new FoodReservationError('CONFLICT');
    if (rows.every((r) => r.status === 'SOLD')) return;
    if (rows.some((r) => r.status !== 'RESERVED')) throw new FoodReservationError('CONFLICT');
    const date = await tx.execute<{ today: string }>(
      sql`select to_char(clock_timestamp() AT TIME ZONE timezone,'YYYY-MM-DD') as today from stores where id=${storeId}::uuid`,
    );
    const aggregateId = randomUUID();
    const reason = 'Food order fulfillment';
    const next = balance.onHand - item.quantity;
    await tx.insert(inventoryTransactions).values({
      id: aggregateId,
      storeId,
      skuId: item.skuId,
      transactionType: 'SALE',
      quantityDelta: -item.quantity,
      balanceAfter: next,
      referenceType: 'FOOD_BATCH_OPERATION',
      referenceId: aggregateId,
      idempotencyKey: `food-sale:${orderItemId}`,
      reason,
      createdByStaffAccountId: staffAccountId,
      metadata: { source: 'FOOD_BATCH_OPERATION', orderId: item.orderId, orderItemId },
    });
    for (const row of rows) {
      const batch = batches.find((b) => b.id === row.batchId);
      if (
        !batch ||
        !batch.foodKind ||
        batch.state !== 'AVAILABLE' ||
        batch.expiresOn < date.rows[0]!.today ||
        batch.reserved < row.quantity ||
        batch.onHand - row.quantity < batch.reserved - row.quantity + batch.blocked
      )
        throw new FoodReservationError('INVALID_STATE');
      if (
        !(
          await tx.execute<{ ok: boolean }>(
            sql`select food_lot_origin_usable(${batch.id}::uuid) as ok`,
          )
        ).rows[0]?.ok
      )
        throw new FoodReservationError('INVALID_STATE');
      await tx
        .update(foodBatches)
        .set({
          onHand: batch.onHand - row.quantity,
          reserved: batch.reserved - row.quantity,
          version: batch.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(foodBatches.id, batch.id));
      await tx
        .update(foodBatchReservations)
        .set({ status: 'SOLD', updatedAt: new Date() })
        .where(eq(foodBatchReservations.id, row.id));
      await tx.insert(foodBatchReservationEvents).values({
        reservationId: row.id,
        eventType: 'SALE',
        quantity: row.quantity,
        idempotencyKey: `food-sale:${row.id}`,
      });
      await tx.insert(foodBatchTransactions).values({
        storeId,
        skuId: item.skuId,
        batchId: batch.id,
        transactionType: 'SALE',
        quantityDelta: -row.quantity,
        onHandBefore: batch.onHand,
        onHandAfter: batch.onHand - row.quantity,
        reservedBefore: batch.reserved,
        reservedAfter: batch.reserved - row.quantity,
        blockedBefore: batch.blocked,
        blockedAfter: batch.blocked,
        aggregateTransactionId: aggregateId,
        referenceType: 'FOOD_BATCH_OPERATION',
        referenceId: aggregateId,
        idempotencyKey: `food-sale-event:${row.id}`,
        reason,
        createdByStaffAccountId: staffAccountId,
      });
    }
    await tx
      .update(storeInventory)
      .set({
        onHand: next,
        reserved: balance.reserved - item.quantity,
        version: balance.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, item.skuId)));
  }
}

async function lockOrderItem(tx: Transaction, orderItemId: string, storeId: string) {
  const [item] = await tx
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      skuId: orderItems.skuId,
      quantity: orderItems.quantity,
      orderStatus: orders.status,
      fingerprint: orders.fulfillmentFingerprint,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.id, orderItemId))
    .for('update');
  if (!item) throw new FoodReservationError('NOT_FOUND');
  if (!item.fingerprint) throw new FoodReservationError('INVALID_STATE');
  const [pickup] = await tx
    .select({ storeId: pickupCodes.storeId })
    .from(pickupCodes)
    .where(eq(pickupCodes.orderId, item.orderId));
  const [delivery] = await tx
    .select({ storeId: deliveries.storeId })
    .from(deliveries)
    .where(eq(deliveries.orderId, item.orderId));
  if ((pickup && delivery) || (pickup?.storeId ?? delivery?.storeId) !== storeId)
    throw new FoodReservationError('CONFLICT');
  return item;
}

async function lockFoodStock(tx: Transaction, storeId: string, skuId: string) {
  await lockFoodSku(tx, skuId);
  const [balance] = await tx
    .select()
    .from(storeInventory)
    .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
    .for('update');
  if (!balance) throw new FoodReservationError('NOT_FOUND');
  const batches = await tx
    .select()
    .from(foodBatches)
    .where(and(eq(foodBatches.storeId, storeId), eq(foodBatches.skuId, skuId)))
    .orderBy(asc(foodBatches.id))
    .limit(501)
    .for('update');
  if (
    !batches.length ||
    batches.length > 500 ||
    batches.reduce((sum, row) => sum + row.onHand, 0) !== balance.onHand ||
    batches.reduce((sum, row) => sum + row.reserved, 0) !== balance.reserved ||
    balance.rentalReserved !== 0
  )
    throw new FoodReservationError('UNRECONCILED_FOOD_STOCK');
  return { balance, batches };
}

async function assertAllocationBalances(
  tx: Transaction,
  batches: Array<typeof foodBatches.$inferSelect>,
  reserved: number,
  rentalReserved: number,
) {
  if (rentalReserved !== 0) throw new FoodReservationError('UNRECONCILED_FOOD_STOCK');
  const rows = await tx
    .select({ batchId: foodBatchReservations.batchId, quantity: foodBatchReservations.quantity })
    .from(foodBatchReservations)
    .where(
      and(
        inArray(
          foodBatchReservations.batchId,
          batches.map((row) => row.id),
        ),
        eq(foodBatchReservations.status, 'RESERVED'),
      ),
    );
  const amounts = new Map<string, number>();
  for (const row of rows) amounts.set(row.batchId, (amounts.get(row.batchId) ?? 0) + row.quantity);
  if (
    batches.some((row) => (amounts.get(row.id) ?? 0) !== row.reserved) ||
    rows.reduce((sum, row) => sum + row.quantity, 0) !== reserved
  )
    throw new FoodReservationError('UNRECONCILED_FOOD_STOCK');
}

/** Advisory display/quote projection; checkout repeats under inventory locks. */
export async function foodQuantityAvailable(
  query: Database | Transaction,
  storeId: string,
  skuId: string,
  quantity: number,
) {
  const result = await query.execute<{ ok: boolean }>(sql`
    select coalesce((select sum(b.on_hand)=i.on_hand and sum(b.reserved)=i.reserved
      and i.rental_reserved=0 and count(*)<=500 and bool_and(b.food_kind is not null)
      and count(distinct b.food_kind)=1
      and coalesce(sum(case when b.state='AVAILABLE' and food_lot_origin_usable(b.id) and b.expires_on >= (clock_timestamp() AT TIME ZONE s.timezone)::date
        then b.on_hand-b.reserved-b.blocked else 0 end),0)>=${quantity}
      from food_batches b where b.store_id=i.store_id and b.sku_id=i.sku_id),false) as ok
    from store_inventory i join stores s on s.id=i.store_id
    where i.store_id=${storeId}::uuid and i.sku_id=${skuId}::uuid`);
  return result.rows[0]?.ok === true;
}
export async function isFoodSku(query: Database | Transaction, skuId: string) {
  const [row] = await query
    .select({ id: foodBatches.id })
    .from(foodBatches)
    .where(eq(foodBatches.skuId, skuId))
    .limit(1);
  return !!row;
}
