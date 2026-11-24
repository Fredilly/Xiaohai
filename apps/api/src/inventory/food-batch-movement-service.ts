import { lockFoodSku } from './food-lock.js';
import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  foodBatchMovementRequestSchema,
  type FoodBatchMovementRequest,
} from '@xiaohai/contracts/food';
import {
  foodBatches,
  foodBatchTransactions,
  inventoryTransactions,
  storeInventory,
  stores,
  type createDatabase,
} from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';
import { InventoryOperationsService } from './inventory-operations-service.js';

type Database = ReturnType<typeof createDatabase>['db'];
export class FoodBatchMovementError extends Error {
  constructor(
    readonly code:
      | 'INVALID_FOOD_MOVEMENT'
      | 'FORBIDDEN'
      | 'CONFLICT'
      | 'NOT_FOUND'
      | 'STALE_VERSION'
      | 'UNRECONCILED_FOOD_STOCK'
      | 'FOOD_BATCH_BLOCKED'
      | 'INSUFFICIENT_STOCK',
  ) {
    super(code);
  }
}

/** Transactional writer behind default-disabled Staff food routes; no checkout activation.
 * Intake must separately establish real packaged-food provenance before creating lots.
 */
export class FoodBatchMovementService {
  constructor(private readonly db: Database) {}

  async apply(context: StaffAuthorizationContext, raw: FoodBatchMovementRequest) {
    const parsed = foodBatchMovementRequestSchema.safeParse(raw);
    if (!parsed.success) throw new FoodBatchMovementError('INVALID_FOOD_MOVEMENT');
    const input = parsed.data;
    const permission =
      input.kind === 'EXISTING_LOT_RECEIPT' ? 'inventory.receive' : 'inventory.adjust';
    if (
      !context.permissions.includes('inventory.read') ||
      !context.permissions.includes(permission)
    )
      throw new FoodBatchMovementError('FORBIDDEN');
    await new InventoryOperationsService(this.db).requireStoreAccess(context, input.storeId);
    const lines = [...input.lines].sort((a, b) => a.batchId.localeCompare(b.batchId));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...input, lines }))
      .digest('hex');
    return await this.db.transaction(async (tx) => {
      // Serializes even different Store/SKU attempts reusing the same request key.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`,
      );
      const [previous] = await tx
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (previous) {
        if (
          previous.metadata.source !== 'FOOD_BATCH_OPERATION' ||
          previous.metadata.fingerprint !== fingerprint ||
          previous.createdByStaffAccountId !== context.staffAccountId ||
          previous.storeId !== input.storeId ||
          previous.skuId !== input.skuId ||
          previous.referenceType !== 'FOOD_BATCH_OPERATION' ||
          previous.metadata.resultVersion !== input.expectedInventoryVersion + 1
        )
          throw new FoodBatchMovementError('CONFLICT');
        return {
          aggregateTransactionId: previous.id,
          balanceAfter: previous.balanceAfter,
          version: previous.metadata.resultVersion,
          replayed: true,
        };
      }
      await lockFoodSku(tx, input.skuId);
      const [balance] = await tx
        .select()
        .from(storeInventory)
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        )
        .for('update');
      if (!balance) throw new FoodBatchMovementError('NOT_FOUND');
      if (balance.version !== input.expectedInventoryVersion)
        throw new FoodBatchMovementError('STALE_VERSION');
      // Lock ALL lots, in a stable order, before checking aggregate reconciliation.
      const batches = await tx
        .select()
        .from(foodBatches)
        .where(and(eq(foodBatches.storeId, input.storeId), eq(foodBatches.skuId, input.skuId)))
        .orderBy(asc(foodBatches.id))
        .for('update');
      if (
        !batches.length ||
        batches.reduce((sum, row) => sum + row.onHand, 0) !== balance.onHand ||
        batches.reduce((sum, row) => sum + row.reserved, 0) !==
          balance.reserved + balance.rentalReserved
      )
        throw new FoodBatchMovementError('UNRECONCILED_FOOD_STOCK');
      const [store] = await tx
        .select({ timezone: stores.timezone })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      const date = await tx.execute<{ today: string }>(
        sql`select to_char(clock_timestamp() AT TIME ZONE ${store!.timezone}, 'YYYY-MM-DD') as today`,
      );
      const today = date.rows[0]!.today;
      let total = 0;
      const changed = lines.map((line) => {
        const batch = batches.find((row) => row.id === line.batchId);
        if (!batch) throw new FoodBatchMovementError('NOT_FOUND');
        if (batch.version !== line.expectedVersion)
          throw new FoodBatchMovementError('STALE_VERSION');
        if (!batch.foodKind) throw new FoodBatchMovementError('FOOD_BATCH_BLOCKED');
        if (input.kind === 'DISPOSAL') {
          // Explicitly discard quarantined/expired stock, without releasing it for sale.
          // Existing reservations and counted blocked units remain protected below.
          if (batch.state === 'AVAILABLE' && batch.expiresOn >= today)
            throw new FoodBatchMovementError('FOOD_BATCH_BLOCKED');
        } else if (batch.state !== 'AVAILABLE' || batch.expiresOn < today) {
          throw new FoodBatchMovementError('FOOD_BATCH_BLOCKED');
        }
        const delta = input.kind === 'EXISTING_LOT_RECEIPT' ? line.quantity : -line.quantity;
        const next = batch.onHand + delta;
        if (next < batch.reserved + batch.blocked || next > 1_000_000_000)
          throw new FoodBatchMovementError('INSUFFICIENT_STOCK');
        total += delta;
        return { batch, delta, next };
      });
      const nextTotal = balance.onHand + total;
      if (nextTotal < balance.reserved + balance.rentalReserved || nextTotal > 1_000_000_000)
        throw new FoodBatchMovementError('INSUFFICIENT_STOCK');
      const aggregateId = crypto.randomUUID();
      const type =
        input.kind === 'EXISTING_LOT_RECEIPT'
          ? 'PURCHASE_RECEIPT'
          : input.kind === 'DAMAGE' || input.kind === 'DISPOSAL'
            ? 'ADJUSTMENT_OUT'
            : 'STOCKTAKE_LOSS';
      await tx.insert(inventoryTransactions).values({
        id: aggregateId,
        storeId: input.storeId,
        skuId: input.skuId,
        transactionType: type,
        quantityDelta: total,
        balanceAfter: nextTotal,
        referenceType: 'FOOD_BATCH_OPERATION',
        referenceId: aggregateId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        createdByStaffAccountId: context.staffAccountId,
        metadata: {
          source: 'FOOD_BATCH_OPERATION',
          fingerprint,
          resultVersion: balance.version + 1,
        },
      });
      await tx
        .update(storeInventory)
        .set({ onHand: nextTotal, version: balance.version + 1, updatedAt: new Date() })
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        );
      for (const { batch, delta, next } of changed) {
        await tx
          .update(foodBatches)
          .set({ onHand: next, version: batch.version + 1, updatedAt: new Date() })
          .where(eq(foodBatches.id, batch.id));
        await tx.insert(foodBatchTransactions).values({
          storeId: input.storeId,
          skuId: input.skuId,
          batchId: batch.id,
          transactionType: input.kind,
          quantityDelta: delta,
          onHandBefore: batch.onHand,
          onHandAfter: next,
          reservedBefore: batch.reserved,
          reservedAfter: batch.reserved,
          blockedBefore: batch.blocked,
          blockedAfter: batch.blocked,
          aggregateTransactionId: aggregateId,
          referenceType: 'FOOD_BATCH_OPERATION',
          referenceId: aggregateId,
          idempotencyKey: `${input.idempotencyKey}:${batch.id}`,
          reason: input.reason,
          createdByStaffAccountId: context.staffAccountId,
        });
      }
      // Enforce the same invariant immediately too; COMMIT remains independently guarded.
      await tx.execute(sql`select public.assert_food_batch_group(${aggregateId}::uuid)`);
      return {
        aggregateTransactionId: aggregateId,
        balanceAfter: nextTotal,
        version: balance.version + 1,
        replayed: false,
      };
    });
  }
}
