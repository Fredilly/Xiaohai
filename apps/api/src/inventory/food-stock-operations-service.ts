import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  foodLotIntakeRequestSchema,
  foodLotDispositionRequestSchema,
  type FoodLotIntakeRequest,
  type FoodLotDispositionRequest,
} from '@xiaohai/contracts/food';
import { evaluatePackagedFoodStock } from '@xiaohai/domain';
import {
  auditLogs,
  foodBatches,
  foodBatchTransactions,
  inventoryTransactions,
  products,
  orderItems,
  rentalItems,
  skus,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';
import { InventoryOperationsService } from './inventory-operations-service.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export class FoodStockError extends Error {
  constructor(
    readonly code:
      | 'INVALID_FOOD_INPUT'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'STALE_VERSION'
      | 'UNRECONCILED_FOOD_STOCK'
      | 'FOOD_BATCH_BLOCKED',
  ) {
    super(code);
  }
}
const fingerprint = (input: object) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

export class FoodStockOperationsService {
  constructor(private readonly db: Db) {}

  private async authorize(actor: StaffAuthorizationContext, storeId: string, permission: string) {
    if (!actor.permissions.includes('inventory.read') || !actor.permissions.includes(permission))
      throw new FoodStockError('FORBIDDEN');
    await new InventoryOperationsService(this.db).requireStoreAccess(actor, storeId);
  }

  private async today(query: Db | Tx, storeId: string) {
    const result = await query.execute<{ today: string }>(
      sql`select to_char(CURRENT_TIMESTAMP AT TIME ZONE timezone, 'YYYY-MM-DD') as today from stores where id=${storeId}::uuid`,
    );
    if (!result.rows[0]) throw new FoodStockError('NOT_FOUND');
    return result.rows[0].today;
  }

  async read(actor: StaffAuthorizationContext, storeId: string, skuId: string) {
    await this.authorize(actor, storeId, 'inventory.read');
    const [source] = await this.db
      .select({ balance: storeInventory, sku: skus, product: products })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)));
    if (!source) throw new FoodStockError('NOT_FOUND');
    const rows = await this.db
      .select()
      .from(foodBatches)
      .where(and(eq(foodBatches.storeId, storeId), eq(foodBatches.skuId, skuId)))
      .orderBy(asc(foodBatches.expiresOn), asc(foodBatches.id))
      .limit(501);
    if (rows.length > 500) throw new FoodStockError('UNRECONCILED_FOOD_STOCK');
    const businessDate = await this.today(this.db, storeId);
    const result = evaluatePackagedFoodStock({
      businessDate,
      aggregate: {
        storeId,
        skuId,
        onHand: source.balance.onHand,
        reserved: source.balance.reserved,
        rentalReserved: source.balance.rentalReserved,
        productStatus: source.product.status as 'DRAFT' | 'ACTIVE' | 'INACTIVE',
        skuStatus: source.sku.status as 'ACTIVE' | 'INACTIVE',
        availableForSale: source.sku.availableForSale,
      },
      batches: rows.map((row) => ({
        ...row,
        state: row.state as 'AVAILABLE' | 'HELD' | 'RECALLED',
      })),
    });
    const verified = rows.length > 0 && rows.every((row) => row.foodKind !== null);
    return {
      storeId,
      skuId,
      businessDate,
      inventoryVersion: source.balance.version,
      onHand: source.balance.onHand,
      rows: rows.map((row) => ({
        id: row.id,
        lotCode: row.lotCode,
        kind: row.foodKind,
        manufacturedOn: row.manufacturedOn,
        expiresOn: row.expiresOn,
        onHand: row.onHand,
        reserved: row.reserved,
        blocked: row.blocked,
        state: row.state,
        version: row.version,
      })),
      result: verified ? result : { ...result, status: 'DISABLED' as const, sellable: 0 },
      // Physical lot availability is not yet a reservation/checkout capability.
      checkoutEnabled: false as const,
    };
  }

  async receive(actor: StaffAuthorizationContext, raw: FoodLotIntakeRequest, requestId: string) {
    const parsed = foodLotIntakeRequestSchema.safeParse(raw);
    if (!parsed.success) throw new FoodStockError('INVALID_FOOD_INPUT');
    const input = parsed.data;
    await this.authorize(actor, input.storeId, 'inventory.receive');
    const hash = fingerprint(input);
    return await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey},0))`,
      );
      const [previous] = await tx
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (previous) {
        if (
          previous.metadata.operation !== 'FOOD_LOT_INTAKE' ||
          previous.metadata.fingerprint !== hash ||
          previous.createdByStaffAccountId !== actor.staffAccountId ||
          typeof previous.metadata.batchId !== 'string'
        )
          throw new FoodStockError('CONFLICT');
        return {
          batchId: previous.metadata.batchId,
          onHandAfter: previous.balanceAfter,
          inventoryVersion: input.expectedInventoryVersion + 1,
          replayed: true,
        };
      }
      const [balance] = await tx
        .select()
        .from(storeInventory)
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        )
        .for('update');
      if (!balance) throw new FoodStockError('NOT_FOUND');
      if (balance.version !== input.expectedInventoryVersion)
        throw new FoodStockError('STALE_VERSION');
      const [initial] = await tx.select().from(skus).where(eq(skus.id, input.skuId));
      if (!initial) throw new FoodStockError('NOT_FOUND');
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, initial.productId))
        .for('update');
      const [sku] = await tx.select().from(skus).where(eq(skus.id, input.skuId)).for('update');
      if (!product || !sku || sku.productId !== initial.productId || product.bookEditionId)
        throw new FoodStockError('FOOD_BATCH_BLOCKED');
      const kinds = await tx
        .selectDistinct({ kind: foodBatches.foodKind })
        .from(foodBatches)
        .where(eq(foodBatches.skuId, input.skuId));
      if (kinds.some((row) => row.kind !== input.kind))
        throw new FoodStockError('FOOD_BATCH_BLOCKED');
      if (!kinds.length) {
        if (!actor.permissions.includes('catalog.edit')) throw new FoodStockError('FORBIDDEN');
        const [sale] = await tx
          .select({ id: orderItems.id })
          .from(orderItems)
          .where(eq(orderItems.skuId, input.skuId))
          .limit(1);
        const [rental] = await tx
          .select({ id: rentalItems.id })
          .from(rentalItems)
          .where(eq(rentalItems.skuId, input.skuId))
          .limit(1);
        const [movement] = await tx
          .select({ id: inventoryTransactions.id })
          .from(inventoryTransactions)
          .where(eq(inventoryTransactions.skuId, input.skuId))
          .limit(1);
        if (sale || rental || movement) throw new FoodStockError('FOOD_BATCH_BLOCKED');

        const links = await tx
          .select({ storeId: storeInventory.storeId })
          .from(storeInventory)
          .where(eq(storeInventory.skuId, input.skuId));
        if (
          product.status !== 'DRAFT' ||
          sku.availableForSale ||
          links.length !== 1 ||
          links[0]!.storeId !== input.storeId
        )
          throw new FoodStockError('FOOD_BATCH_BLOCKED');
      }
      const existing = await tx
        .select()
        .from(foodBatches)
        .where(and(eq(foodBatches.storeId, input.storeId), eq(foodBatches.skuId, input.skuId)))
        .orderBy(asc(foodBatches.id))
        .for('update');
      if (
        existing.reduce((sum, row) => sum + row.onHand, 0) !== balance.onHand ||
        existing.reduce((sum, row) => sum + row.reserved, 0) !==
          balance.reserved + balance.rentalReserved
      )
        throw new FoodStockError('UNRECONCILED_FOOD_STOCK');
      const today = await this.today(tx, input.storeId);
      if (input.expiresOn < today || (input.manufacturedOn && input.manufacturedOn > today))
        throw new FoodStockError('FOOD_BATCH_BLOCKED');
      const next = balance.onHand + input.quantity;
      if (next > 1_000_000_000) throw new FoodStockError('INVALID_FOOD_INPUT');
      const batchId = randomUUID();
      const aggregateId = randomUUID();
      await tx.insert(foodBatches).values({
        id: batchId,
        storeId: input.storeId,
        skuId: input.skuId,
        foodKind: input.kind,
        lotCode: input.lotCode,
        manufacturedOn: input.manufacturedOn,
        expiresOn: input.expiresOn,
        onHand: input.quantity,
        state: 'HELD',
        createdByStaffAccountId: actor.staffAccountId,
      });
      await tx.insert(inventoryTransactions).values({
        id: aggregateId,
        storeId: input.storeId,
        skuId: input.skuId,
        transactionType: 'PURCHASE_RECEIPT',
        quantityDelta: input.quantity,
        balanceAfter: next,
        referenceType: 'FOOD_BATCH_OPERATION',
        referenceId: aggregateId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        createdByStaffAccountId: actor.staffAccountId,
        metadata: {
          source: 'FOOD_BATCH_OPERATION',
          operation: 'FOOD_LOT_INTAKE',
          fingerprint: hash,
          batchId,
          sourceRef: input.sourceRef,
        },
      });
      await tx.insert(foodBatchTransactions).values({
        storeId: input.storeId,
        skuId: input.skuId,
        batchId,
        transactionType: 'NEW_LOT_RECEIPT',
        quantityDelta: input.quantity,
        onHandBefore: 0,
        onHandAfter: input.quantity,
        reservedBefore: 0,
        reservedAfter: 0,
        blockedBefore: 0,
        blockedAfter: 0,
        aggregateTransactionId: aggregateId,
        referenceType: 'FOOD_BATCH_OPERATION',
        referenceId: aggregateId,
        idempotencyKey: `${input.idempotencyKey}:${batchId}`,
        reason: input.reason,
        createdByStaffAccountId: actor.staffAccountId,
      });
      await tx
        .update(storeInventory)
        .set({ onHand: next, version: balance.version + 1, updatedAt: new Date() })
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        );
      await tx.insert(auditLogs).values({
        actorStaffAccountId: actor.staffAccountId,
        actionKey: 'food.lot.receive',
        resourceType: 'food_batch',
        resourceId: batchId,
        requestId,
        metadata: {
          storeId: input.storeId,
          skuId: input.skuId,
          quantity: input.quantity,
          sourceRef: input.sourceRef,
          aggregateTransactionId: aggregateId,
        },
      });
      return { batchId, onHandAfter: next, inventoryVersion: balance.version + 1, replayed: false };
    });
  }

  async disposition(
    actor: StaffAuthorizationContext,
    raw: FoodLotDispositionRequest,
    requestId: string,
  ) {
    const parsed = foodLotDispositionRequestSchema.safeParse(raw);
    if (!parsed.success) throw new FoodStockError('INVALID_FOOD_INPUT');
    const input = parsed.data;
    await this.authorize(actor, input.storeId, 'inventory.adjust');
    const hash = fingerprint(input);
    return await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'food-state:' + input.idempotencyKey},0))`,
      );
      const [previous] = await tx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actionKey, 'food.lot.disposition'),
            sql`${auditLogs.metadata}->>'operationKey'=${input.idempotencyKey}`,
          ),
        )
        .limit(1);
      if (previous) {
        if (
          previous.actorStaffAccountId !== actor.staffAccountId ||
          previous.metadata.fingerprint !== hash
        )
          throw new FoodStockError('CONFLICT');
        return {
          batchId: input.batchId,
          state: input.state,
          version: input.expectedVersion + 1,
          inventoryVersion: input.expectedInventoryVersion + 1,
          replayed: true,
        };
      }
      const [balance] = await tx
        .select()
        .from(storeInventory)
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        )
        .for('update');
      if (!balance) throw new FoodStockError('NOT_FOUND');
      if (balance.version !== input.expectedInventoryVersion)
        throw new FoodStockError('STALE_VERSION');
      const batches = await tx
        .select()
        .from(foodBatches)
        .where(and(eq(foodBatches.storeId, input.storeId), eq(foodBatches.skuId, input.skuId)))
        .orderBy(asc(foodBatches.id))
        .for('update');
      const batch = batches.find((row) => row.id === input.batchId);
      if (!batch) throw new FoodStockError('NOT_FOUND');
      if (batch.version !== input.expectedVersion) throw new FoodStockError('STALE_VERSION');
      if (batch.state === input.state) throw new FoodStockError('CONFLICT');
      if (input.state === 'AVAILABLE') {
        if (!batch.foodKind || batch.expiresOn < (await this.today(tx, input.storeId)))
          throw new FoodStockError('FOOD_BATCH_BLOCKED');
        if (
          batches.reduce((sum, row) => sum + row.onHand, 0) !== balance.onHand ||
          batches.reduce((sum, row) => sum + row.reserved, 0) !==
            balance.reserved + balance.rentalReserved
        )
          throw new FoodStockError('UNRECONCILED_FOOD_STOCK');
      }
      await tx
        .update(foodBatches)
        .set({ state: input.state, version: batch.version + 1, updatedAt: new Date() })
        .where(eq(foodBatches.id, batch.id));
      await tx
        .update(storeInventory)
        .set({ version: balance.version + 1, updatedAt: new Date() })
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        );
      await tx.insert(auditLogs).values({
        actorStaffAccountId: actor.staffAccountId,
        actionKey: 'food.lot.disposition',
        resourceType: 'food_batch',
        resourceId: batch.id,
        requestId,
        metadata: {
          storeId: input.storeId,
          skuId: input.skuId,
          before: batch.state,
          after: input.state,
          sourceRef: input.sourceRef,
          reason: input.reason,
          operationKey: input.idempotencyKey,
          fingerprint: hash,
        },
      });
      return {
        batchId: batch.id,
        state: input.state,
        version: batch.version + 1,
        inventoryVersion: balance.version + 1,
        replayed: false,
      };
    });
  }
}
