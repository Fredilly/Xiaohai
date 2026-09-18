import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type {
  CreateGoodsReceiptRequest,
  CreatePurchaseOrderRequest,
  CreateStocktakeRequest,
  CreateStockTransferRequest,
  InventoryAdjustmentRequest,
  InventoryListQuery,
  InventoryMutationRequest,
  StocktakeCountRequest,
} from '@xiaohai/contracts/inventory';
import {
  goodsReceiptItems,
  goodsReceipts,
  inventoryTransactions,
  purchaseOrderItems,
  purchaseOrders,
  skus,
  stocktakeItems,
  stocktakes,
  stockTransferItems,
  stockTransfers,
  storeInventory,
  stores,
  suppliers,
  type createDatabase,
} from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const inventoryPermissions = {
  read: 'inventory.read',
  issue: 'inventory.issue',
  adjust: 'inventory.adjust',
  receive: 'inventory.receive',
  stocktake: 'inventory.stocktake',
  transfer: 'inventory.transfer',
  procurement: 'procurement.manage',
} as const;

export type InventoryOperationsErrorCode =
  'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'STALE_VERSION' | 'INSUFFICIENT_STOCK' | 'INVALID_STATE';
export class InventoryOperationsError extends Error {
  constructor(readonly code: InventoryOperationsErrorCode) {
    super(code);
  }
}

export class InventoryOperationsService {
  constructor(private readonly db: Database) {}

  async requireStoreAccess(context: StaffAuthorizationContext, storeId: string) {
    const [store] = await this.db
      .select({ id: stores.id, regionId: stores.regionId, franchiseeId: stores.franchiseeId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) throw new InventoryOperationsError('NOT_FOUND');
    const allowed = context.dataScopes.some(
      (scope) =>
        scope.type === 'GLOBAL' ||
        (scope.type === 'STORE' && scope.id === store.id) ||
        (scope.type === 'REGION' && scope.id === store.regionId) ||
        (scope.type === 'FRANCHISEE' && scope.id === store.franchiseeId),
    );
    if (!allowed) throw new InventoryOperationsError('FORBIDDEN');
    return store;
  }

  async listInventory(context: StaffAuthorizationContext, input: InventoryListQuery) {
    if (input.storeId) await this.requireStoreAccess(context, input.storeId);

    const storeScopeIds = context.dataScopes.flatMap((scope) =>
      scope.type === 'STORE' && scope.id ? [scope.id] : [],
    );
    const regionScopeIds = context.dataScopes.flatMap((scope) =>
      scope.type === 'REGION' && scope.id ? [scope.id] : [],
    );
    const franchiseeScopeIds = context.dataScopes.flatMap((scope) =>
      scope.type === 'FRANCHISEE' && scope.id ? [scope.id] : [],
    );
    const scopeFilter = context.dataScopes.some((scope) => scope.type === 'GLOBAL')
      ? sql<boolean>`true`
      : or(
          storeScopeIds.length ? inArray(storeInventory.storeId, storeScopeIds) : undefined,
          regionScopeIds.length ? inArray(stores.regionId, regionScopeIds) : undefined,
          franchiseeScopeIds.length ? inArray(stores.franchiseeId, franchiseeScopeIds) : undefined,
        );
    if (!scopeFilter) return { items: [] };

    const rows = await this.db
      .select({
        storeId: storeInventory.storeId,
        skuId: storeInventory.skuId,
        skuCode: skus.code,
        skuName: skus.name,
        onHand: storeInventory.onHand,
        reserved: storeInventory.reserved,
        rentalReserved: storeInventory.rentalReserved,
        version: storeInventory.version,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(stores, eq(storeInventory.storeId, stores.id))
      .where(
        and(
          scopeFilter,
          input.storeId ? eq(storeInventory.storeId, input.storeId) : undefined,
          input.lowStockThreshold !== undefined
            ? lte(
                sql`${storeInventory.onHand} - ${storeInventory.reserved} - ${storeInventory.rentalReserved}`,
                input.lowStockThreshold,
              )
            : undefined,
        ),
      )
      .orderBy(asc(storeInventory.storeId), asc(skus.code))
      .limit(input.limit ?? 200);

    return {
      items: rows.map((row) => ({
        ...row,
        available: row.onHand - row.reserved - row.rentalReserved,
      })),
    };
  }

  async listTransactions(context: StaffAuthorizationContext, storeId: string) {
    await this.requireStoreAccess(context, storeId);
    const rows = await this.db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.storeId, storeId))
      .orderBy(sql`${inventoryTransactions.createdAt} desc`)
      .limit(500);
    return { transactions: rows };
  }

  async listAlerts(context: StaffAuthorizationContext, storeId: string, threshold: number) {
    await this.requireStoreAccess(context, storeId);
    const rows = await this.db
      .select({
        storeId: storeInventory.storeId,
        skuId: storeInventory.skuId,
        skuCode: skus.code,
        skuName: skus.name,
        onHand: storeInventory.onHand,
        reserved: storeInventory.reserved,
        rentalReserved: storeInventory.rentalReserved,
        version: storeInventory.version,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .where(
        and(
          eq(storeInventory.storeId, storeId),
          lte(
            sql`${storeInventory.onHand} - ${storeInventory.reserved} - ${storeInventory.rentalReserved}`,
            threshold,
          ),
        ),
      )
      .orderBy(asc(skus.code));
    return {
      alerts: rows.map((row) => ({
        ...row,
        available: row.onHand - row.reserved - row.rentalReserved,
        severity:
          row.onHand - row.reserved - row.rentalReserved === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
      })),
    };
  }

  async listSuppliers() {
    return { suppliers: await this.db.select().from(suppliers).orderBy(asc(suppliers.name)) };
  }
  async createSupplier(input: {
    code: string;
    name: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    try {
      const [row] = await this.db.insert(suppliers).values(input).returning();
      return row!;
    } catch {
      throw new InventoryOperationsError('CONFLICT');
    }
  }
  async updateSupplier(
    id: string,
    input: Partial<{
      code: string;
      name: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
      status: 'ACTIVE' | 'INACTIVE';
    }>,
  ) {
    const [row] = await this.db
      .update(suppliers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();
    if (!row) throw new InventoryOperationsError('NOT_FOUND');
    return row;
  }

  async createPurchaseOrder(context: StaffAuthorizationContext, input: CreatePurchaseOrderRequest) {
    await this.requireStoreAccess(context, input.storeId);
    return await this.db.transaction(async (tx) => {
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          orderNumber: numberFor('PO'),
          supplierId: input.supplierId,
          storeId: input.storeId,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
          notes: input.notes,
          createdByStaffAccountId: context.staffAccountId,
        })
        .returning();
      if (!order) throw new InventoryOperationsError('CONFLICT');
      const items = await tx
        .insert(purchaseOrderItems)
        .values(
          input.items.map((item) => ({
            purchaseOrderId: order.id,
            skuId: item.skuId,
            orderedQuantity: item.quantity,
            unitCostMinor: item.unitCostMinor,
          })),
        )
        .returning();
      return { ...order, items };
    });
  }

  async actOnPurchaseOrder(
    context: StaffAuthorizationContext,
    id: string,
    action: 'SUBMIT' | 'CANCEL',
  ) {
    return await this.db.transaction(async (tx) => {
      const order = await lockPurchaseOrder(tx, id);
      await this.assertStore(context, order.storeId);
      const allowed =
        action === 'SUBMIT'
          ? order.status === 'DRAFT'
          : ['DRAFT', 'SUBMITTED'].includes(order.status);
      if (!allowed) throw new InventoryOperationsError('INVALID_STATE');
      const status = action === 'SUBMIT' ? 'SUBMITTED' : 'CANCELLED';
      const [updated] = await tx
        .update(purchaseOrders)
        .set({
          status,
          submittedAt: action === 'SUBMIT' ? new Date() : order.submittedAt,
          cancelledAt: action === 'CANCEL' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id))
        .returning();
      return updated!;
    });
  }

  async createReceipt(context: StaffAuthorizationContext, input: CreateGoodsReceiptRequest) {
    return await this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.purchaseOrderId))
        .limit(1);
      if (!order) throw new InventoryOperationsError('NOT_FOUND');
      await this.assertStore(context, order.storeId);
      if (!['SUBMITTED', 'PARTIALLY_RECEIVED'].includes(order.status))
        throw new InventoryOperationsError('INVALID_STATE');
      const orderItems = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, order.id));
      for (const item of input.items) {
        const source = orderItems.find((row) => row.id === item.purchaseOrderItemId);
        if (!source || source.receivedQuantity + item.quantity > source.orderedQuantity)
          throw new InventoryOperationsError('CONFLICT');
      }
      const [receipt] = await tx
        .insert(goodsReceipts)
        .values({
          receiptNumber: numberFor('GR'),
          purchaseOrderId: order.id,
          storeId: order.storeId,
          notes: input.notes,
          createdByStaffAccountId: context.staffAccountId,
        })
        .returning();
      if (!receipt) throw new InventoryOperationsError('CONFLICT');
      const items = await tx
        .insert(goodsReceiptItems)
        .values(
          input.items.map((item) => {
            const source = orderItems.find((row) => row.id === item.purchaseOrderItemId)!;
            return {
              goodsReceiptId: receipt.id,
              purchaseOrderItemId: source.id,
              skuId: source.skuId,
              quantity: item.quantity,
            };
          }),
        )
        .returning();
      return { ...receipt, items };
    });
  }

  async postReceipt(context: StaffAuthorizationContext, id: string) {
    return await this.db.transaction(async (tx) => {
      const receipt = await lockReceipt(tx, id);
      await this.assertStore(context, receipt.storeId);
      if (receipt.status === 'POSTED') return receipt;
      if (receipt.status !== 'DRAFT') throw new InventoryOperationsError('INVALID_STATE');
      const items = await tx
        .select()
        .from(goodsReceiptItems)
        .where(eq(goodsReceiptItems.goodsReceiptId, id))
        .orderBy(asc(goodsReceiptItems.skuId));
      for (const item of items) {
        await ensureInventory(tx, receipt.storeId, item.skuId);
        await lockInventory(tx, receipt.storeId, item.skuId);
        const [balance] = await tx
          .update(storeInventory)
          .set({
            onHand: sql`${storeInventory.onHand} + ${item.quantity}`,
            version: sql`${storeInventory.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(storeInventory.storeId, receipt.storeId), eq(storeInventory.skuId, item.skuId)),
          )
          .returning();
        await tx.insert(inventoryTransactions).values({
          storeId: receipt.storeId,
          skuId: item.skuId,
          transactionType: 'PURCHASE_RECEIPT',
          quantityDelta: item.quantity,
          balanceAfter: balance!.onHand,
          referenceType: 'GOODS_RECEIPT',
          referenceId: receipt.id,
          idempotencyKey: `receipt:${receipt.id}:${item.id}`,
          createdByStaffAccountId: context.staffAccountId,
        });
        await tx
          .update(purchaseOrderItems)
          .set({ receivedQuantity: sql`${purchaseOrderItems.receivedQuantity} + ${item.quantity}` })
          .where(eq(purchaseOrderItems.id, item.purchaseOrderItemId));
      }
      const remaining = await tx
        .select({ count: sql<number>`count(*)` })
        .from(purchaseOrderItems)
        .where(
          and(
            eq(purchaseOrderItems.purchaseOrderId, receipt.purchaseOrderId),
            sql`${purchaseOrderItems.receivedQuantity} < ${purchaseOrderItems.orderedQuantity}`,
          ),
        );
      await tx
        .update(purchaseOrders)
        .set({
          status: Number(remaining[0]?.count ?? 0) === 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, receipt.purchaseOrderId));
      const [posted] = await tx
        .update(goodsReceipts)
        .set({
          status: 'POSTED',
          postedAt: new Date(),
          postedByStaffAccountId: context.staffAccountId,
          updatedAt: new Date(),
        })
        .where(eq(goodsReceipts.id, id))
        .returning();
      return posted!;
    });
  }

  async issue(context: StaffAuthorizationContext, input: InventoryMutationRequest) {
    return await this.mutate(context, input, -input.quantity, 'ISSUE');
  }
  async adjust(context: StaffAuthorizationContext, input: InventoryAdjustmentRequest) {
    return await this.mutate(
      context,
      input,
      input.quantityDelta,
      input.quantityDelta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
    );
  }

  private async mutate(
    context: StaffAuthorizationContext,
    input: InventoryMutationRequest | InventoryAdjustmentRequest,
    delta: number,
    type: 'ISSUE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT',
  ) {
    await this.requireStoreAccess(context, input.storeId);
    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) return existing;
      await lockInventory(tx, input.storeId, input.skuId);
      const [balance] = await tx
        .select()
        .from(storeInventory)
        .where(
          and(eq(storeInventory.storeId, input.storeId), eq(storeInventory.skuId, input.skuId)),
        )
        .limit(1);
      if (!balance) throw new InventoryOperationsError('NOT_FOUND');
      if (balance.version !== input.expectedVersion)
        throw new InventoryOperationsError('STALE_VERSION');
      const next = balance.onHand + delta;
      if (next < balance.reserved + balance.rentalReserved)
        throw new InventoryOperationsError('INSUFFICIENT_STOCK');
      const [updated] = await tx
        .update(storeInventory)
        .set({ onHand: next, version: balance.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(storeInventory.storeId, input.storeId),
            eq(storeInventory.skuId, input.skuId),
            eq(storeInventory.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new InventoryOperationsError('STALE_VERSION');
      const referenceId = crypto.randomUUID();
      const [entry] = await tx
        .insert(inventoryTransactions)
        .values({
          storeId: input.storeId,
          skuId: input.skuId,
          transactionType: type,
          quantityDelta: delta,
          balanceAfter: next,
          referenceType: type === 'ISSUE' ? 'STOCK_ISSUE' : 'INVENTORY_ADJUSTMENT',
          referenceId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          createdByStaffAccountId: context.staffAccountId,
        })
        .returning();
      return entry!;
    });
  }

  async createStocktake(context: StaffAuthorizationContext, input: CreateStocktakeRequest) {
    await this.requireStoreAccess(context, input.storeId);
    return await this.db.transaction(async (tx) => {
      const balances = await tx
        .select()
        .from(storeInventory)
        .where(
          and(
            eq(storeInventory.storeId, input.storeId),
            inArray(storeInventory.skuId, input.skuIds),
          ),
        );
      if (balances.length !== input.skuIds.length) throw new InventoryOperationsError('NOT_FOUND');
      const [stocktake] = await tx
        .insert(stocktakes)
        .values({
          stocktakeNumber: numberFor('ST'),
          storeId: input.storeId,
          notes: input.notes,
          createdByStaffAccountId: context.staffAccountId,
        })
        .returning();
      const items = await tx
        .insert(stocktakeItems)
        .values(
          balances.map((row) => ({
            stocktakeId: stocktake!.id,
            skuId: row.skuId,
            expectedQuantity: row.onHand,
            expectedVersion: row.version,
          })),
        )
        .returning();
      return { ...stocktake!, items };
    });
  }

  async countStocktake(
    context: StaffAuthorizationContext,
    id: string,
    input: StocktakeCountRequest,
  ) {
    return await this.db.transaction(async (tx) => {
      const doc = await lockStocktake(tx, id);
      await this.assertStore(context, doc.storeId);
      if (!['DRAFT', 'COUNTING'].includes(doc.status))
        throw new InventoryOperationsError('INVALID_STATE');
      const existing = await tx
        .select()
        .from(stocktakeItems)
        .where(eq(stocktakeItems.stocktakeId, id));
      if (input.items.length !== existing.length) throw new InventoryOperationsError('CONFLICT');
      for (const item of input.items) {
        const target = existing.find((row) => row.skuId === item.skuId);
        if (!target) throw new InventoryOperationsError('CONFLICT');
        await tx
          .update(stocktakeItems)
          .set({ countedQuantity: item.countedQuantity })
          .where(eq(stocktakeItems.id, target.id));
      }
      const [updated] = await tx
        .update(stocktakes)
        .set({ status: 'COUNTING', updatedAt: new Date() })
        .where(eq(stocktakes.id, id))
        .returning();
      return updated!;
    });
  }

  async actOnStocktake(
    context: StaffAuthorizationContext,
    id: string,
    action: 'START' | 'REVIEW' | 'POST' | 'CANCEL',
  ) {
    return await this.db.transaction(async (tx) => {
      const doc = await lockStocktake(tx, id);
      await this.assertStore(context, doc.storeId);
      if (action === 'START') {
        if (doc.status !== 'DRAFT') throw new InventoryOperationsError('INVALID_STATE');
        return (
          await tx
            .update(stocktakes)
            .set({ status: 'COUNTING', updatedAt: new Date() })
            .where(eq(stocktakes.id, id))
            .returning()
        )[0]!;
      }
      if (action === 'CANCEL') {
        if (!['DRAFT', 'COUNTING', 'REVIEWED'].includes(doc.status))
          throw new InventoryOperationsError('INVALID_STATE');
        return (
          await tx
            .update(stocktakes)
            .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
            .where(eq(stocktakes.id, id))
            .returning()
        )[0]!;
      }
      const items = await tx
        .select()
        .from(stocktakeItems)
        .where(eq(stocktakeItems.stocktakeId, id))
        .orderBy(asc(stocktakeItems.skuId));
      if (items.some((item) => item.countedQuantity === null))
        throw new InventoryOperationsError('CONFLICT');
      if (action === 'REVIEW') {
        if (doc.status !== 'COUNTING') throw new InventoryOperationsError('INVALID_STATE');
        return (
          await tx
            .update(stocktakes)
            .set({
              status: 'REVIEWED',
              reviewedAt: new Date(),
              reviewedByStaffAccountId: context.staffAccountId,
              updatedAt: new Date(),
            })
            .where(eq(stocktakes.id, id))
            .returning()
        )[0]!;
      }
      if (doc.status === 'POSTED') return doc;
      if (doc.status !== 'REVIEWED') throw new InventoryOperationsError('INVALID_STATE');
      for (const item of items) {
        await lockInventory(tx, doc.storeId, item.skuId);
        const [balance] = await tx
          .select()
          .from(storeInventory)
          .where(and(eq(storeInventory.storeId, doc.storeId), eq(storeInventory.skuId, item.skuId)))
          .limit(1);
        if (!balance || balance.version !== item.expectedVersion)
          throw new InventoryOperationsError('STALE_VERSION');
        const next = item.countedQuantity!;
        if (next < balance.reserved + balance.rentalReserved)
          throw new InventoryOperationsError('INSUFFICIENT_STOCK');
        const delta = next - balance.onHand;
        if (delta === 0) continue;
        await tx
          .update(storeInventory)
          .set({ onHand: next, version: balance.version + 1, updatedAt: new Date() })
          .where(
            and(eq(storeInventory.storeId, doc.storeId), eq(storeInventory.skuId, item.skuId)),
          );
        await tx.insert(inventoryTransactions).values({
          storeId: doc.storeId,
          skuId: item.skuId,
          transactionType: delta > 0 ? 'STOCKTAKE_GAIN' : 'STOCKTAKE_LOSS',
          quantityDelta: delta,
          balanceAfter: next,
          referenceType: 'STOCKTAKE',
          referenceId: doc.id,
          idempotencyKey: `stocktake:${doc.id}:${item.id}`,
          createdByStaffAccountId: context.staffAccountId,
        });
      }
      return (
        await tx
          .update(stocktakes)
          .set({
            status: 'POSTED',
            postedAt: new Date(),
            postedByStaffAccountId: context.staffAccountId,
            updatedAt: new Date(),
          })
          .where(eq(stocktakes.id, id))
          .returning()
      )[0]!;
    });
  }

  async createTransfer(context: StaffAuthorizationContext, input: CreateStockTransferRequest) {
    await this.requireStoreAccess(context, input.sourceStoreId);
    await this.requireStoreAccess(context, input.destinationStoreId);
    return await this.db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(stockTransfers)
        .values({
          transferNumber: numberFor('TR'),
          sourceStoreId: input.sourceStoreId,
          destinationStoreId: input.destinationStoreId,
          notes: input.notes,
          createdByStaffAccountId: context.staffAccountId,
        })
        .returning();
      const items = await tx
        .insert(stockTransferItems)
        .values(input.items.map((item) => ({ stockTransferId: doc!.id, ...item })))
        .returning();
      return { ...doc!, items };
    });
  }

  async actOnTransfer(
    context: StaffAuthorizationContext,
    id: string,
    action: 'SUBMIT' | 'DISPATCH' | 'RECEIVE' | 'CANCEL',
  ) {
    return await this.db.transaction(async (tx) => {
      const doc = await lockTransfer(tx, id);
      await this.assertStore(context, doc.sourceStoreId);
      await this.assertStore(context, doc.destinationStoreId);
      if (action === 'SUBMIT') {
        if (doc.status === 'SUBMITTED') return doc;
        if (doc.status !== 'DRAFT') throw new InventoryOperationsError('INVALID_STATE');
        return (
          await tx
            .update(stockTransfers)
            .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
            .where(eq(stockTransfers.id, id))
            .returning()
        )[0]!;
      }
      if (action === 'CANCEL') {
        if (!['DRAFT', 'SUBMITTED'].includes(doc.status))
          throw new InventoryOperationsError('INVALID_STATE');
        return (
          await tx
            .update(stockTransfers)
            .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
            .where(eq(stockTransfers.id, id))
            .returning()
        )[0]!;
      }
      const items = await tx
        .select()
        .from(stockTransferItems)
        .where(eq(stockTransferItems.stockTransferId, id))
        .orderBy(asc(stockTransferItems.skuId));
      if (action === 'DISPATCH') {
        if (doc.status === 'IN_TRANSIT') return doc;
        if (doc.status !== 'SUBMITTED') throw new InventoryOperationsError('INVALID_STATE');
        for (const item of items) {
          await lockInventory(tx, doc.sourceStoreId, item.skuId);
          const [balance] = await tx
            .select()
            .from(storeInventory)
            .where(
              and(
                eq(storeInventory.storeId, doc.sourceStoreId),
                eq(storeInventory.skuId, item.skuId),
              ),
            )
            .limit(1);
          if (
            !balance ||
            balance.onHand - item.quantity < balance.reserved + balance.rentalReserved
          )
            throw new InventoryOperationsError('INSUFFICIENT_STOCK');
          const next = balance.onHand - item.quantity;
          await tx
            .update(storeInventory)
            .set({ onHand: next, version: balance.version + 1, updatedAt: new Date() })
            .where(
              and(
                eq(storeInventory.storeId, doc.sourceStoreId),
                eq(storeInventory.skuId, item.skuId),
              ),
            );
          await tx.insert(inventoryTransactions).values({
            storeId: doc.sourceStoreId,
            skuId: item.skuId,
            transactionType: 'TRANSFER_OUT',
            quantityDelta: -item.quantity,
            balanceAfter: next,
            referenceType: 'STOCK_TRANSFER',
            referenceId: doc.id,
            idempotencyKey: `transfer-out:${doc.id}:${item.id}`,
            createdByStaffAccountId: context.staffAccountId,
          });
        }
        return (
          await tx
            .update(stockTransfers)
            .set({ status: 'IN_TRANSIT', dispatchedAt: new Date(), updatedAt: new Date() })
            .where(eq(stockTransfers.id, id))
            .returning()
        )[0]!;
      }
      if (doc.status === 'RECEIVED') return doc;
      if (doc.status !== 'IN_TRANSIT') throw new InventoryOperationsError('INVALID_STATE');
      for (const item of items) {
        await ensureInventory(tx, doc.destinationStoreId, item.skuId);
        await lockInventory(tx, doc.destinationStoreId, item.skuId);
        const [balance] = await tx
          .update(storeInventory)
          .set({
            onHand: sql`${storeInventory.onHand}+${item.quantity}`,
            version: sql`${storeInventory.version}+1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storeInventory.storeId, doc.destinationStoreId),
              eq(storeInventory.skuId, item.skuId),
            ),
          )
          .returning();
        await tx.insert(inventoryTransactions).values({
          storeId: doc.destinationStoreId,
          skuId: item.skuId,
          transactionType: 'TRANSFER_IN',
          quantityDelta: item.quantity,
          balanceAfter: balance!.onHand,
          referenceType: 'STOCK_TRANSFER',
          referenceId: doc.id,
          idempotencyKey: `transfer-in:${doc.id}:${item.id}`,
          createdByStaffAccountId: context.staffAccountId,
        });
      }
      return (
        await tx
          .update(stockTransfers)
          .set({ status: 'RECEIVED', receivedAt: new Date(), updatedAt: new Date() })
          .where(eq(stockTransfers.id, id))
          .returning()
      )[0]!;
    });
  }

  private async assertStore(context: StaffAuthorizationContext, storeId: string) {
    await this.requireStoreAccess(context, storeId);
  }
}

function numberFor(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
async function ensureInventory(tx: Transaction, storeId: string, skuId: string) {
  await tx.insert(storeInventory).values({ storeId, skuId }).onConflictDoNothing();
}
async function lockInventory(tx: Transaction, storeId: string, skuId: string) {
  await tx.execute(
    sql`select 1 from store_inventory where store_id=${storeId} and sku_id=${skuId} for update`,
  );
}
async function lockPurchaseOrder(tx: Transaction, id: string) {
  await tx.execute(sql`select 1 from purchase_orders where id=${id} for update`);
  const [row] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!row) throw new InventoryOperationsError('NOT_FOUND');
  return row;
}
async function lockReceipt(tx: Transaction, id: string) {
  await tx.execute(sql`select 1 from goods_receipts where id=${id} for update`);
  const [row] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1);
  if (!row) throw new InventoryOperationsError('NOT_FOUND');
  return row;
}
async function lockStocktake(tx: Transaction, id: string) {
  await tx.execute(sql`select 1 from stocktakes where id=${id} for update`);
  const [row] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1);
  if (!row) throw new InventoryOperationsError('NOT_FOUND');
  return row;
}
async function lockTransfer(tx: Transaction, id: string) {
  await tx.execute(sql`select 1 from stock_transfers where id=${id} for update`);
  const [row] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).limit(1);
  if (!row) throw new InventoryOperationsError('NOT_FOUND');
  return row;
}
