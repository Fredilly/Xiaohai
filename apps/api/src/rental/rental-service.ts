import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CreateRentalRequest, RentalListQuery } from '@xiaohai/contracts/rental';
import {
  inventoryReservations,
  inventoryTransactions,
  products,
  pickupCodes,
  rentalEvents,
  rentalItems,
  rentalOrders,
  skus,
  storeInventory,
  stores,
  type createDatabase,
} from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';
import { pickupCodeFor, pickupCodeMatches } from '../fulfillment/pickup-code.js';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const rentalPermissions = {
  read: 'rental.read',
  checkout: 'rental.checkout',
  return: 'rental.return',
  manage: 'rental.manage',
} as const;
export type RentalErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_STATE'
  | 'INSUFFICIENT_STOCK'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PICKUP_CODE_INVALID';
export class RentalError extends Error {
  constructor(readonly code: RentalErrorCode) {
    super(code);
  }
}

export class RentalService {
  constructor(
    private readonly db: Database,
    private readonly loanDays: number,
    private readonly pickupSecret: string,
  ) {}

  async reserve(consumerUserId: string, input: CreateRentalRequest) {
    const items = [...input.items].sort((a, b) => a.skuId.localeCompare(b.skuId));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ storeId: input.storeId, items }))
      .digest('hex');
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${consumerUserId}:${input.idempotencyKey}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(rentalOrders)
        .where(
          and(
            eq(rentalOrders.consumerUserId, consumerUserId),
            eq(rentalOrders.clientRequestId, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new RentalError('IDEMPOTENCY_CONFLICT');
        return existing.id;
      }
      const [store] = await tx
        .select({ id: stores.id, status: stores.operationalStatus })
        .from(stores)
        .where(eq(stores.id, input.storeId))
        .limit(1);
      if (!store || store.status !== 'ACTIVE') throw new RentalError('NOT_FOUND');
      const catalog = await tx
        .select({ skuId: skus.id })
        .from(skus)
        .innerJoin(products, eq(skus.productId, products.id))
        .where(
          and(
            inArray(
              skus.id,
              items.map((i) => i.skuId),
            ),
            eq(skus.status, 'ACTIVE'),
            eq(products.status, 'ACTIVE'),
          ),
        );
      if (catalog.length !== items.length) throw new RentalError('NOT_FOUND');
      const orderId = randomUUID();
      for (const item of items) {
        await lockInventory(tx, input.storeId, item.skuId);
        const balance = await loadInventory(tx, input.storeId, item.skuId);
        if (!balance || balance.onHand - balance.reserved - balance.rentalReserved < item.quantity)
          throw new RentalError('INSUFFICIENT_STOCK');
        await tx
          .update(storeInventory)
          .set({
            rentalReserved: balance.rentalReserved + item.quantity,
            version: balance.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storeInventory.storeId, input.storeId),
              eq(storeInventory.skuId, item.skuId),
              eq(storeInventory.version, balance.version),
            ),
          );
      }
      await tx.insert(rentalOrders).values({
        id: orderId,
        rentalNumber: `RN-${Date.now()}-${orderId.slice(0, 8)}`,
        consumerUserId,
        storeId: input.storeId,
        clientRequestId: input.idempotencyKey,
        requestFingerprint: fingerprint,
      });
      await tx
        .insert(rentalItems)
        .values(items.map((item) => ({ rentalOrderId: orderId, ...item })));
      await tx
        .insert(inventoryReservations)
        .values(items.map((item) => ({ rentalOrderId: orderId, storeId: input.storeId, ...item })));
      await tx.insert(pickupCodes).values({ rentalOrderId: orderId, storeId: input.storeId });
      await tx.insert(rentalEvents).values({
        rentalOrderId: orderId,
        eventType: 'RESERVED',
        actorType: 'CONSUMER',
        actorConsumerUserId: consumerUserId,
        idempotencyKey: `${orderId}:reserve:${input.idempotencyKey}`,
      });
      return orderId;
    });
    return this.getForConsumer(consumerUserId, id);
  }

  async listForConsumer(consumerUserId: string, query: RentalListQuery) {
    await this.promoteOverdue(consumerUserId);
    const rows = await this.db
      .select({ id: rentalOrders.id })
      .from(rentalOrders)
      .where(
        and(
          eq(rentalOrders.consumerUserId, consumerUserId),
          query.status ? eq(rentalOrders.status, query.status) : undefined,
        ),
      )
      .orderBy(desc(rentalOrders.createdAt))
      .limit(query.limit);
    return {
      items: await Promise.all(rows.map((row) => this.getForConsumer(consumerUserId, row.id))),
    };
  }

  async getForConsumer(consumerUserId: string, id: string) {
    await this.promoteOverdue(consumerUserId, id);
    const view = await this.loadView(id);
    if (!view || view.consumerUserId !== consumerUserId) throw new RentalError('NOT_FOUND');
    return view;
  }

  async cancelConsumer(consumerUserId: string, id: string, idempotencyKey: string) {
    await this.cancel(id, idempotencyKey, { type: 'CONSUMER', id: consumerUserId });
    return this.getForConsumer(consumerUserId, id);
  }

  async listForStaff(context: StaffAuthorizationContext, query: RentalListQuery) {
    await this.promoteOverdue();
    if (query.storeId) await this.requireStoreAccess(context, query.storeId);
    const rows = await this.db
      .select({ id: rentalOrders.id, storeId: rentalOrders.storeId })
      .from(rentalOrders)
      .where(
        and(
          query.status ? eq(rentalOrders.status, query.status) : undefined,
          query.storeId ? eq(rentalOrders.storeId, query.storeId) : undefined,
        ),
      )
      .orderBy(desc(rentalOrders.createdAt));
    const storeRows = await this.db
      .select({ id: stores.id, regionId: stores.regionId, franchiseeId: stores.franchiseeId })
      .from(stores)
      .where(
        rows.length
          ? inArray(
              stores.id,
              rows.map((r) => r.storeId),
            )
          : sql`false`,
      );
    const map = new Map(storeRows.map((s) => [s.id, s]));
    const ids = rows
      .filter((row) => {
        const s = map.get(row.storeId);
        return s && canAccess(context, s.id, s.regionId, s.franchiseeId);
      })
      .slice(0, query.limit)
      .map((r) => r.id);
    return { items: await Promise.all(ids.map((id) => this.loadView(id))) };
  }

  async getForStaff(context: StaffAuthorizationContext, id: string) {
    await this.promoteOverdue(undefined, id);
    const view = await this.loadView(id);
    if (!view) throw new RentalError('NOT_FOUND');
    await this.requireStoreAccess(context, view.storeId);
    return view;
  }

  async borrow(
    context: StaffAuthorizationContext,
    id: string,
    idempotencyKey: string,
    pickupCode: string,
  ) {
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (!order) throw new RentalError('NOT_FOUND');
      await this.requireStoreAccess(context, order.storeId);
      if (
        order.status === 'BORROWED' &&
        (await hasEvent(tx, id, 'BORROWED', `${id}:borrow:${idempotencyKey}`))
      )
        return;
      if (order.status !== 'RESERVED') throw new RentalError('INVALID_STATE');
      await tx.execute(sql`select 1 from pickup_codes where rental_order_id=${id} for update`);
      const [pickup] = await tx
        .select()
        .from(pickupCodes)
        .where(eq(pickupCodes.rentalOrderId, id))
        .limit(1);
      if (!pickup || pickup.status !== 'ISSUED') throw new RentalError('INVALID_STATE');
      if (!pickupCodeMatches(this.pickupSecret, 'RENTAL', id, pickupCode))
        throw new RentalError('PICKUP_CODE_INVALID');
      const items = await tx
        .select()
        .from(rentalItems)
        .where(eq(rentalItems.rentalOrderId, id))
        .orderBy(asc(rentalItems.skuId));
      const activeReservations = await tx
        .select()
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.rentalOrderId, id),
            eq(inventoryReservations.status, 'ACTIVE'),
          ),
        );
      if (
        activeReservations.length !== items.length ||
        items.some(
          (item) =>
            activeReservations.find((reservation) => reservation.skuId === item.skuId)?.quantity !==
            item.quantity,
        )
      )
        throw new RentalError('CONFLICT');
      for (const item of items) {
        await lockInventory(tx, order.storeId, item.skuId);
        const balance = await loadInventory(tx, order.storeId, item.skuId);
        if (!balance || balance.onHand < item.quantity || balance.rentalReserved < item.quantity)
          throw new RentalError('CONFLICT');
        const next = balance.onHand - item.quantity;
        await tx
          .update(storeInventory)
          .set({
            onHand: next,
            rentalReserved: balance.rentalReserved - item.quantity,
            version: balance.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storeInventory.storeId, order.storeId),
              eq(storeInventory.skuId, item.skuId),
              eq(storeInventory.version, balance.version),
            ),
          );
        await tx.insert(inventoryTransactions).values({
          storeId: order.storeId,
          skuId: item.skuId,
          transactionType: 'RENTAL_OUT',
          quantityDelta: -item.quantity,
          balanceAfter: next,
          referenceType: 'RENTAL_ORDER',
          referenceId: id,
          idempotencyKey: `rental-out:${idempotencyKey}:${item.skuId}`,
          createdByStaffAccountId: context.staffAccountId,
        });
      }
      const now = new Date();
      const dueAt = new Date(now.getTime() + this.loanDays * 86_400_000);
      await tx
        .update(inventoryReservations)
        .set({ status: 'COMPLETED', endedAt: now })
        .where(
          and(
            eq(inventoryReservations.rentalOrderId, id),
            eq(inventoryReservations.status, 'ACTIVE'),
          ),
        );
      await tx
        .update(pickupCodes)
        .set({
          status: 'VERIFIED',
          verifiedAt: now,
          version: pickup.version + 1,
          updatedAt: now,
        })
        .where(and(eq(pickupCodes.id, pickup.id), eq(pickupCodes.version, pickup.version)));
      await tx
        .update(rentalOrders)
        .set({
          status: 'BORROWED',
          borrowedAt: now,
          dueAt,
          version: order.version + 1,
          updatedAt: now,
        })
        .where(and(eq(rentalOrders.id, id), eq(rentalOrders.version, order.version)));
      await tx.insert(rentalEvents).values({
        rentalOrderId: id,
        eventType: 'BORROWED',
        actorType: 'STAFF',
        actorStaffAccountId: context.staffAccountId,
        idempotencyKey: `${id}:borrow:${idempotencyKey}`,
        metadata: { dueAt: dueAt.toISOString() },
      });
    });
    return this.getForStaff(context, id);
  }

  async returnRental(context: StaffAuthorizationContext, id: string, idempotencyKey: string) {
    await this.promoteOverdue(undefined, id);
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (!order) throw new RentalError('NOT_FOUND');
      await this.requireStoreAccess(context, order.storeId);
      if (
        order.status === 'RETURNED' &&
        (await hasEvent(tx, id, 'RETURNED', `${id}:return:${idempotencyKey}`))
      )
        return;
      if (!['BORROWED', 'OVERDUE'].includes(order.status)) throw new RentalError('INVALID_STATE');
      const items = await tx
        .select()
        .from(rentalItems)
        .where(eq(rentalItems.rentalOrderId, id))
        .orderBy(asc(rentalItems.skuId));
      for (const item of items) {
        await lockInventory(tx, order.storeId, item.skuId);
        const balance = await loadInventory(tx, order.storeId, item.skuId);
        if (!balance) throw new RentalError('CONFLICT');
        const next = balance.onHand + item.quantity;
        await tx
          .update(storeInventory)
          .set({ onHand: next, version: balance.version + 1, updatedAt: new Date() })
          .where(
            and(
              eq(storeInventory.storeId, order.storeId),
              eq(storeInventory.skuId, item.skuId),
              eq(storeInventory.version, balance.version),
            ),
          );
        await tx.insert(inventoryTransactions).values({
          storeId: order.storeId,
          skuId: item.skuId,
          transactionType: 'RENTAL_RETURN',
          quantityDelta: item.quantity,
          balanceAfter: next,
          referenceType: 'RENTAL_ORDER',
          referenceId: id,
          idempotencyKey: `rental-return:${idempotencyKey}:${item.skuId}`,
          createdByStaffAccountId: context.staffAccountId,
        });
      }
      const now = new Date();
      await tx
        .update(rentalOrders)
        .set({
          status: 'RETURNED',
          returnedAt: now,
          version: order.version + 1,
          updatedAt: now,
        })
        .where(and(eq(rentalOrders.id, id), eq(rentalOrders.version, order.version)));
      await tx.insert(rentalEvents).values({
        rentalOrderId: id,
        eventType: 'RETURNED',
        actorType: 'STAFF',
        actorStaffAccountId: context.staffAccountId,
        idempotencyKey: `${id}:return:${idempotencyKey}`,
      });
    });
    return this.getForStaff(context, id);
  }

  async cancelStaff(context: StaffAuthorizationContext, id: string, idempotencyKey: string) {
    const view = await this.getForStaff(context, id);
    await this.cancel(id, idempotencyKey, { type: 'STAFF', id: context.staffAccountId });
    return this.getForStaff(context, view.id);
  }

  private async cancel(
    id: string,
    idempotencyKey: string,
    actor: { type: 'CONSUMER' | 'STAFF'; id: string },
  ) {
    await this.db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (!order || (actor.type === 'CONSUMER' && order.consumerUserId !== actor.id))
        throw new RentalError('NOT_FOUND');
      if (
        order.status === 'CANCELLED' &&
        (await hasEvent(tx, id, 'CANCELLED', `${id}:cancel:${idempotencyKey}`))
      )
        return;
      if (order.status !== 'RESERVED') throw new RentalError('INVALID_STATE');
      const reservations = await tx
        .select()
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.rentalOrderId, id),
            eq(inventoryReservations.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(inventoryReservations.skuId));
      const itemCount = await tx
        .select({ id: rentalItems.id })
        .from(rentalItems)
        .where(eq(rentalItems.rentalOrderId, id));
      if (reservations.length !== itemCount.length) throw new RentalError('CONFLICT');
      for (const reservation of reservations) {
        await lockInventory(tx, order.storeId, reservation.skuId);
        const balance = await loadInventory(tx, order.storeId, reservation.skuId);
        if (!balance || balance.rentalReserved < reservation.quantity)
          throw new RentalError('CONFLICT');
        await tx
          .update(storeInventory)
          .set({
            rentalReserved: balance.rentalReserved - reservation.quantity,
            version: balance.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storeInventory.storeId, order.storeId),
              eq(storeInventory.skuId, reservation.skuId),
              eq(storeInventory.version, balance.version),
            ),
          );
      }
      const now = new Date();
      await tx
        .update(inventoryReservations)
        .set({ status: 'RELEASED', endedAt: now })
        .where(
          and(
            eq(inventoryReservations.rentalOrderId, id),
            eq(inventoryReservations.status, 'ACTIVE'),
          ),
        );
      await tx
        .update(pickupCodes)
        .set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now })
        .where(
          and(eq(pickupCodes.rentalOrderId, id), eq(pickupCodes.status, 'ISSUED')),
        );
      await tx
        .update(rentalOrders)
        .set({ status: 'CANCELLED', cancelledAt: now, version: order.version + 1, updatedAt: now })
        .where(and(eq(rentalOrders.id, id), eq(rentalOrders.version, order.version)));
      await tx.insert(rentalEvents).values({
        rentalOrderId: id,
        eventType: 'CANCELLED',
        actorType: actor.type,
        actorConsumerUserId: actor.type === 'CONSUMER' ? actor.id : null,
        actorStaffAccountId: actor.type === 'STAFF' ? actor.id : null,
        idempotencyKey: `${id}:cancel:${idempotencyKey}`,
      });
    });
  }

  private async promoteOverdue(consumerUserId?: string, id?: string) {
    await this.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: rentalOrders.id })
        .from(rentalOrders)
        .where(
          and(
            eq(rentalOrders.status, 'BORROWED'),
            sql`${rentalOrders.dueAt} < now()`,
            consumerUserId ? eq(rentalOrders.consumerUserId, consumerUserId) : undefined,
            id ? eq(rentalOrders.id, id) : undefined,
          ),
        );
      for (const row of due) {
        const updated = await tx
          .update(rentalOrders)
          .set({
            status: 'OVERDUE',
            version: sql`${rentalOrders.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(rentalOrders.id, row.id), eq(rentalOrders.status, 'BORROWED')))
          .returning({ id: rentalOrders.id });
        if (updated.length)
          await tx
            .insert(rentalEvents)
            .values({
              rentalOrderId: row.id,
              eventType: 'OVERDUE',
              actorType: 'SYSTEM',
              idempotencyKey: `overdue:${row.id}`,
            })
            .onConflictDoNothing();
      }
    });
  }

  private async requireStoreAccess(context: StaffAuthorizationContext, storeId: string) {
    const [store] = await this.db
      .select({ id: stores.id, regionId: stores.regionId, franchiseeId: stores.franchiseeId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) throw new RentalError('NOT_FOUND');
    if (!canAccess(context, store.id, store.regionId, store.franchiseeId))
      throw new RentalError('FORBIDDEN');
    return store;
  }

  private async loadView(id: string) {
    const [order] = await this.db
      .select({ order: rentalOrders, storeName: stores.name })
      .from(rentalOrders)
      .innerJoin(stores, eq(rentalOrders.storeId, stores.id))
      .where(eq(rentalOrders.id, id))
      .limit(1);
    if (!order) return null;
    const itemRows = await this.db
      .select({
        id: rentalItems.id,
        skuId: rentalItems.skuId,
        skuCode: skus.code,
        skuName: skus.name,
        quantity: rentalItems.quantity,
      })
      .from(rentalItems)
      .innerJoin(skus, eq(rentalItems.skuId, skus.id))
      .where(eq(rentalItems.rentalOrderId, id))
      .orderBy(asc(skus.code));
    const [pickup] = await this.db
      .select()
      .from(pickupCodes)
      .where(eq(pickupCodes.rentalOrderId, id))
      .limit(1);
    const events = await this.db
      .select({
        id: rentalEvents.id,
        eventType: rentalEvents.eventType,
        actorType: rentalEvents.actorType,
        createdAt: rentalEvents.createdAt,
        metadata: rentalEvents.metadata,
      })
      .from(rentalEvents)
      .where(eq(rentalEvents.rentalOrderId, id))
      .orderBy(asc(rentalEvents.createdAt));
    return {
      ...order.order,
      storeName: order.storeName,
      isOverdue: order.order.status === 'OVERDUE',
      pickupCode:
        pickup?.status === 'ISSUED' && order.order.status === 'RESERVED'
          ? pickupCodeFor(this.pickupSecret, 'RENTAL', id)
          : null,
      items: itemRows,
      events,
    };
  }
}

function canAccess(
  context: StaffAuthorizationContext,
  storeId: string,
  regionId?: string,
  franchiseeId?: string | null,
) {
  return context.dataScopes.some(
    (scope) =>
      scope.type === 'GLOBAL' ||
      (scope.type === 'STORE' && scope.id === storeId) ||
      (scope.type === 'REGION' && scope.id === regionId) ||
      (scope.type === 'FRANCHISEE' && scope.id === franchiseeId),
  );
}
async function lockInventory(tx: Transaction, storeId: string, skuId: string) {
  await tx.execute(
    sql`select 1 from store_inventory where store_id=${storeId} and sku_id=${skuId} for update`,
  );
}
async function loadInventory(tx: Transaction, storeId: string, skuId: string) {
  const [row] = await tx
    .select()
    .from(storeInventory)
    .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
    .limit(1);
  return row;
}
async function lockOrder(tx: Transaction, id: string) {
  await tx.execute(sql`select 1 from rental_orders where id=${id} for update`);
  const [row] = await tx.select().from(rentalOrders).where(eq(rentalOrders.id, id)).limit(1);
  return row;
}
async function hasEvent(tx: Transaction, orderId: string, type: string, key: string) {
  const [row] = await tx
    .select({ id: rentalEvents.id, key: rentalEvents.idempotencyKey })
    .from(rentalEvents)
    .where(and(eq(rentalEvents.rentalOrderId, orderId), eq(rentalEvents.eventType, type)))
    .limit(1);
  if (!row) return false;
  if (row.key !== key) throw new RentalError('IDEMPOTENCY_CONFLICT');
  return true;
}
