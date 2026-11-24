import { lockFoodSku } from './food-lock.js';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  foodPhysicalReturnRequestSchema,
  type FoodPhysicalReturnRequest,
} from '@xiaohai/contracts/food';
export { foodPhysicalReturnRequestSchema } from '@xiaohai/contracts/food';
import {
  foodBatches,
  foodBatchReservations,
  foodPhysicalReturns,
  foodTransferAllocations,
  foodBatchTransactions,
  inventoryTransactions,
  orderItems,
  pickupCodes,
  deliveries,
  orders,
  storeInventory,
  type stockTransferItems,
  type stockTransfers,
  type createDatabase,
} from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';
import { InventoryOperationsService } from './inventory-operations-service.js';
import { FoodStockError } from './food-stock-operations-service.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export class FoodLogisticsService {
  constructor(
    private readonly db: Db,
    private readonly writesEnabled = false,
  ) {}
  async receiveReturn(actor: StaffAuthorizationContext, raw: FoodPhysicalReturnRequest) {
    if (!this.writesEnabled) throw new FoodStockError('FOOD_BATCH_BLOCKED');
    const parsed = foodPhysicalReturnRequestSchema.safeParse(raw);
    if (!parsed.success) throw new FoodStockError('INVALID_FOOD_INPUT');
    const input = parsed.data;
    if (
      !actor.permissions.includes('inventory.read') ||
      !actor.permissions.includes('inventory.receive')
    )
      throw new FoodStockError('FORBIDDEN');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'food-return:' + input.idempotencyKey},0))`,
      );
      const [source] = await tx
        .select({ reservation: foodBatchReservations, item: orderItems })
        .from(foodBatchReservations)
        .innerJoin(orderItems, eq(foodBatchReservations.orderItemId, orderItems.id))
        .where(eq(foodBatchReservations.id, input.reservationId));
      if (!source) throw new FoodStockError('NOT_FOUND');
      await new InventoryOperationsService(this.db).requireStoreAccess(
        actor,
        source.reservation.storeId,
        tx,
      );
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, source.item.orderId))
        .for('update');
      if (
        !order ||
        !['COMPLETED', 'DELIVERING', 'REFUNDING', 'REFUNDED'].includes(order.status) ||
        source.reservation.status !== 'SOLD'
      )
        throw new FoodStockError('CONFLICT');
      const [prior] = await tx
        .select()
        .from(foodPhysicalReturns)
        .where(eq(foodPhysicalReturns.idempotencyKey, input.idempotencyKey));
      if (prior) {
        if (prior.fingerprint !== fingerprint || prior.actorStaffAccountId !== actor.staffAccountId)
          throw new FoodStockError('CONFLICT');
        return { returnedBatchId: prior.returnedBatchId, replayed: true };
      }
      const stock = await lockStock(tx, source.reservation.storeId, source.reservation.skuId);
      const batch = stock.batches.find((r) => r.id === source.reservation.batchId);
      if (!batch || !batch.foodKind) throw new FoodStockError('CONFLICT');
      const previous = await tx
        .select({ quantity: foodPhysicalReturns.quantity })
        .from(foodPhysicalReturns)
        .where(eq(foodPhysicalReturns.reservationId, input.reservationId));
      if (
        previous.reduce((n, r) => n + r.quantity, 0) + input.quantity >
        source.reservation.quantity
      )
        throw new FoodStockError('CONFLICT');
      const [returned] = await tx
        .insert(foodBatches)
        .values({
          storeId: batch.storeId,
          skuId: batch.skuId,
          lotCode: `return:${input.idempotencyKey}`,
          foodKind: batch.foodKind,
          manufacturedOn: batch.manufacturedOn,
          expiresOn: batch.expiresOn,
          onHand: input.quantity,
          state: 'HELD',
          createdByStaffAccountId: actor.staffAccountId,
        })
        .returning();
      const aggregateId = await movement(
        tx,
        stock,
        [{ batch: returned!, quantity: input.quantity }],
        1,
        'PHYSICAL_RETURN',
        'ADJUSTMENT_IN',
        actor.staffAccountId,
        input.idempotencyKey,
        input.reason,
        { reservationId: input.reservationId, orderId: order.id, sourceRef: input.sourceRef },
      );
      await tx.insert(foodPhysicalReturns).values({
        ...input,
        returnedBatchId: returned!.id,
        aggregateTransactionId: aggregateId,
        fingerprint,
        actorStaffAccountId: actor.staffAccountId,
      });
      return { returnedBatchId: returned!.id, replayed: false };
    });
  }
  async orderAllocations(actor: StaffAuthorizationContext, orderId: string) {
    if (!actor.permissions.includes('inventory.read')) throw new FoodStockError('FORBIDDEN');
    const [order] = await this.db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId));
    const [pickup] = await this.db
      .select({ storeId: pickupCodes.storeId })
      .from(pickupCodes)
      .where(eq(pickupCodes.orderId, orderId));
    const [delivery] = await this.db
      .select({ storeId: deliveries.storeId })
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId));
    const storeId = pickup?.storeId ?? delivery?.storeId;
    if (!order || !storeId || (pickup && delivery)) throw new FoodStockError('NOT_FOUND');
    await new InventoryOperationsService(this.db).requireStoreAccess(actor, storeId);
    const allocations = await this.db
      .select({
        id: foodBatchReservations.id,
        skuId: foodBatchReservations.skuId,
        batchId: foodBatchReservations.batchId,
        lotCode: foodBatches.lotCode,
        quantity: foodBatchReservations.quantity,
        status: foodBatchReservations.status,
        returnedQuantity: sql<number>`coalesce((select sum(quantity)::integer from food_physical_returns where reservation_id=${foodBatchReservations.id}),0)`,
      })
      .from(foodBatchReservations)
      .innerJoin(orderItems, eq(foodBatchReservations.orderItemId, orderItems.id))
      .innerJoin(foodBatches, eq(foodBatchReservations.batchId, foodBatches.id))
      .where(and(eq(orderItems.orderId, orderId), eq(foodBatchReservations.storeId, storeId)))
      .orderBy(asc(foodBatchReservations.id));
    return { orderId, storeId, status: order.status, allocations };
  }
  async trace(actor: StaffAuthorizationContext, batchId: string) {
    if (!actor.permissions.includes('inventory.read')) throw new FoodStockError('FORBIDDEN');
    const [batch] = await this.db.select().from(foodBatches).where(eq(foodBatches.id, batchId));
    if (!batch) throw new FoodStockError('NOT_FOUND');
    await new InventoryOperationsService(this.db).requireStoreAccess(actor, batch.storeId);
    const transfers = await this.db
      .select({
        sourceBatchId: foodTransferAllocations.sourceBatchId,
        transferItemId: foodTransferAllocations.transferItemId,
        quantity: foodTransferAllocations.quantity,
      })
      .from(foodTransferAllocations)
      .where(eq(foodTransferAllocations.destinationBatchId, batchId));
    const returns = await this.db
      .select({
        reservationId: foodPhysicalReturns.reservationId,
        quantity: foodPhysicalReturns.quantity,
      })
      .from(foodPhysicalReturns)
      .where(eq(foodPhysicalReturns.returnedBatchId, batchId));
    // Opaque ancestry links only; no cross-store balances, actors, addresses or order data.
    return { batchId, storeId: batch.storeId, lotCode: batch.lotCode, transfers, returns };
  }
}
async function lockStock(tx: Tx, storeId: string, skuId: string) {
  await lockFoodSku(tx, skuId);
  const [balance] = await tx
    .select()
    .from(storeInventory)
    .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
    .for('update');
  if (!balance) throw new FoodStockError('NOT_FOUND');
  const batches = await tx
    .select()
    .from(foodBatches)
    .where(and(eq(foodBatches.storeId, storeId), eq(foodBatches.skuId, skuId)))
    .orderBy(asc(foodBatches.id))
    .limit(501)
    .for('update');
  if (
    batches.length > 500 ||
    balance.rentalReserved !== 0 ||
    batches.reduce((n, r) => n + r.onHand, 0) !== balance.onHand ||
    batches.reduce((n, r) => n + r.reserved, 0) !== balance.reserved
  )
    throw new FoodStockError('UNRECONCILED_FOOD_STOCK');
  return { balance, batches };
}
type Stock = Awaited<ReturnType<typeof lockStock>>;
type Batch = typeof foodBatches.$inferSelect;
async function movement(
  tx: Tx,
  stock: Stock,
  lines: { batch: Batch; quantity: number }[],
  direction: 1 | -1,
  kind: 'PHYSICAL_RETURN' | 'TRANSFER_OUT' | 'TRANSFER_IN',
  type: 'ADJUSTMENT_IN' | 'TRANSFER_OUT' | 'TRANSFER_IN',
  actor: string,
  key: string,
  reason: string,
  metadata: Record<string, unknown>,
) {
  const amount = lines.reduce((n, r) => n + r.quantity, 0) * direction;
  const next = stock.balance.onHand + amount;
  if (next < stock.balance.reserved || next > 1000000000) throw new FoodStockError('CONFLICT');
  const aggregateId = randomUUID();
  const { storeId, skuId } = stock.balance;
  await tx.insert(inventoryTransactions).values({
    id: aggregateId,
    storeId,
    skuId,
    transactionType: type,
    quantityDelta: amount,
    balanceAfter: next,
    referenceType: 'FOOD_BATCH_OPERATION',
    referenceId: aggregateId,
    idempotencyKey: key,
    reason,
    createdByStaffAccountId: actor,
    metadata: { ...metadata, source: 'FOOD_BATCH_OPERATION' },
  });
  for (const { batch, quantity } of lines) {
    const before = direction === 1 ? 0 : batch.onHand;
    const after = before + quantity * direction;
    if (after < batch.reserved + batch.blocked) throw new FoodStockError('CONFLICT');
    if (direction === -1)
      await tx
        .update(foodBatches)
        .set({ onHand: after, version: batch.version + 1, updatedAt: new Date() })
        .where(eq(foodBatches.id, batch.id));
    await tx.insert(foodBatchTransactions).values({
      storeId,
      skuId,
      batchId: batch.id,
      transactionType: kind,
      quantityDelta: quantity * direction,
      onHandBefore: before,
      onHandAfter: after,
      reservedBefore: batch.reserved,
      reservedAfter: batch.reserved,
      blockedBefore: batch.blocked,
      blockedAfter: batch.blocked,
      aggregateTransactionId: aggregateId,
      referenceType: 'FOOD_BATCH_OPERATION',
      referenceId: aggregateId,
      idempotencyKey: `${aggregateId}:${batch.id}`,
      reason,
      createdByStaffAccountId: actor,
    });
  }
  await tx
    .update(storeInventory)
    .set({ onHand: next, version: stock.balance.version + 1, updatedAt: new Date() })
    .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)));
  return aggregateId;
}
export async function dispatchFoodTransferItem(
  tx: Tx,
  doc: typeof stockTransfers.$inferSelect,
  item: typeof stockTransferItems.$inferSelect,
  actor: string,
) {
  const stock = await lockStock(tx, doc.sourceStoreId, item.skuId);
  if (
    stock.batches.some((r) => !r.foodKind) ||
    new Set(stock.batches.map((r) => r.foodKind)).size !== 1
  )
    throw new FoodStockError('FOOD_BATCH_BLOCKED');
  let remaining = item.quantity;
  const lines: { batch: Batch; quantity: number }[] = [];
  for (const batch of [...stock.batches].sort(
    (a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.id.localeCompare(b.id),
  )) {
    if (remaining === 0) break;
    if (!batch.foodKind) throw new FoodStockError('FOOD_BATCH_BLOCKED');
    const usable = await tx.execute<{ ok: boolean }>(
      sql`select food_lot_origin_usable(${batch.id}::uuid) as ok`,
    );
    if (!usable.rows[0]?.ok) continue;
    const quantity = Math.min(remaining, batch.onHand - batch.reserved - batch.blocked);
    if (quantity > 0) {
      lines.push({ batch, quantity });
      remaining -= quantity;
    }
  }
  if (remaining > 0) throw new FoodStockError('FOOD_BATCH_BLOCKED');
  await movement(
    tx,
    stock,
    lines,
    -1,
    'TRANSFER_OUT',
    'TRANSFER_OUT',
    actor,
    `food-transfer-out:${item.id}`,
    'Food transfer dispatch',
    { transferId: doc.id },
  );
  await tx.insert(foodTransferAllocations).values(
    lines.map((line) => ({
      transferItemId: item.id,
      sourceBatchId: line.batch.id,
      quantity: line.quantity,
    })),
  );
}
export async function receiveFoodTransferItem(
  tx: Tx,
  doc: typeof stockTransfers.$inferSelect,
  item: typeof stockTransferItems.$inferSelect,
  actor: string,
) {
  const stock = await lockStock(tx, doc.destinationStoreId, item.skuId);
  const sources = await tx
    .select({ line: foodTransferAllocations, batch: foodBatches })
    .from(foodTransferAllocations)
    .innerJoin(foodBatches, eq(foodTransferAllocations.sourceBatchId, foodBatches.id))
    .where(eq(foodTransferAllocations.transferItemId, item.id))
    .orderBy(asc(foodTransferAllocations.id));
  if (
    !sources.length ||
    sources.reduce((n, r) => n + r.line.quantity, 0) !== item.quantity ||
    sources.some(
      (r) =>
        r.line.destinationBatchId ||
        r.batch.storeId !== doc.sourceStoreId ||
        r.batch.skuId !== item.skuId ||
        !r.batch.foodKind,
    ) ||
    new Set([...sources.map((r) => r.batch.foodKind), ...stock.batches.map((r) => r.foodKind)])
      .size !== 1
  )
    throw new FoodStockError('CONFLICT');
  const lines: { batch: Batch; quantity: number }[] = [];
  for (const { line, batch } of sources) {
    const [received] = await tx
      .insert(foodBatches)
      .values({
        storeId: doc.destinationStoreId,
        skuId: item.skuId,
        lotCode: `transfer:${line.id}`,
        foodKind: batch.foodKind,
        manufacturedOn: batch.manufacturedOn,
        expiresOn: batch.expiresOn,
        onHand: line.quantity,
        state: 'HELD',
        createdByStaffAccountId: actor,
      })
      .returning();
    lines.push({ batch: received!, quantity: line.quantity });
    await tx
      .update(foodTransferAllocations)
      .set({ destinationBatchId: received!.id })
      .where(eq(foodTransferAllocations.id, line.id));
  }
  await movement(
    tx,
    stock,
    lines,
    1,
    'TRANSFER_IN',
    'TRANSFER_IN',
    actor,
    `food-transfer-in:${item.id}`,
    'Food transfer receive',
    { transferId: doc.id },
  );
}
