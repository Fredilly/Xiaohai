import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type {
  DeliveryZoneInput,
  DeliveryZoneListQuery,
  FulfilledOrderRequest,
  FulfillmentQuoteRequest,
  FulfillmentStaffListQuery,
} from '@xiaohai/contracts/fulfillment';
import {
  cartItems,
  carts,
  deliveries,
  deliveryEvents,
  deliveryZones,
  inventoryTransactions,
  orderItems,
  orders,
  pickupCodes,
  products,
  skus,
  storeInventory,
  stores,
  userAddresses,
  type createDatabase,
} from '@xiaohai/db';
import type { StaffAuthorizationContext } from '../auth/staff-authorization.js';
import type { CommerceService } from '../commerce/commerce-service.js';
import type { DeliveryProvider } from './delivery-provider.js';
import { pickupCodeFor, pickupCodeMatches } from './pickup-code.js';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const fulfillmentPermissions = {
  read: 'fulfillment.read',
  pickup: 'fulfillment.pickup',
  delivery: 'delivery.dispatch',
  manage: 'delivery.manage',
} as const;

export type FulfillmentErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'DELIVERY_UNAVAILABLE'
  | 'PICKUP_CODE_INVALID'
  | 'INSUFFICIENT_STOCK'
  | 'IDEMPOTENCY_CONFLICT';

export class FulfillmentError extends Error {
  constructor(readonly code: FulfillmentErrorCode) {
    super(code);
  }
}

export class FulfillmentService {
  constructor(
    private readonly db: Database,
    private readonly commerce: CommerceService,
    private readonly pickupSecret: string,
    private readonly deliveryProvider: DeliveryProvider,
  ) {}

  async quote(consumerUserId: string, input: FulfillmentQuoteRequest) {
    const cart = await this.commerce.getCart(consumerUserId);
    if (!cart.items.length) throw new FulfillmentError('CONFLICT');
    if (cart.items.some((item) => !item.availableForSale))
      throw new FulfillmentError('CONFLICT');

    const store = await this.requireActiveStore(input.storeId);
    if (input.method === 'PICKUP') {
      return {
        method: input.method,
        store,
        subtotalMinor: cart.subtotalMinor,
        deliveryFeeMinor: 0,
        totalMinor: cart.subtotalMinor,
        deliveryZone: null,
      };
    }

    const address = await this.requireAddress(consumerUserId, input.addressId!);
    const zone = await this.resolveDeliveryZone(input.storeId, address);
    return {
      method: input.method,
      store,
      subtotalMinor: cart.subtotalMinor,
      deliveryFeeMinor: zone.feeMinor,
      totalMinor: cart.subtotalMinor + zone.feeMinor,
      deliveryZone: { id: zone.id, name: zone.name, providerKey: zone.providerKey },
    };
  }

  async createOrder(consumerUserId: string, input: FulfilledOrderRequest) {
    const [existing] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.consumerUserId, consumerUserId),
          eq(orders.clientRequestId, input.clientRequestId),
        ),
      )
      .limit(1);
    if (existing) {
      const view = await this.getForConsumer(consumerUserId, existing.id);
      if (view.method !== input.method || view.store.id !== input.storeId)
        throw new FulfillmentError('IDEMPOTENCY_CONFLICT');
      return existing.id;
    }

    const quote = await this.quote(consumerUserId, input);
    const cart = await this.commerce.getCart(consumerUserId);
    const skuRows = await this.db
      .select({ id: skus.id, code: skus.code })
      .from(skus)
      .where(
        inArray(
          skus.id,
          cart.items.map((item) => item.skuId),
        ),
      );
    const skuCodes = new Map(skuRows.map((row) => [row.id, row.code]));
    if (skuCodes.size !== cart.items.length) throw new FulfillmentError('CONFLICT');

    const address =
      input.method === 'DELIVERY'
        ? await this.requireAddress(consumerUserId, input.addressId!)
        : null;
    const zone =
      input.method === 'DELIVERY'
        ? await this.resolveDeliveryZone(input.storeId, address!)
        : null;

    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${consumerUserId}:${input.clientRequestId}`}))`,
      );
      const [again] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.consumerUserId, consumerUserId),
            eq(orders.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);
      if (again) return again.id;

      const [cartRow] = await tx
        .select({ id: carts.id })
        .from(carts)
        .where(eq(carts.consumerUserId, consumerUserId))
        .limit(1);
      if (!cartRow) throw new FulfillmentError('CONFLICT');

      const orderId = randomUUID();
      await tx.insert(orders).values({
        id: orderId,
        consumerUserId,
        orderNumber: `XH${Date.now()}${orderId.slice(0, 8)}`,
        status: 'UNPAID',
        subtotalMinor: quote.subtotalMinor,
        totalMinor: quote.totalMinor,
        addressSnapshot: address ? snapshotAddress(address) : null,
        clientRequestId: input.clientRequestId,
      });
      await tx.insert(orderItems).values(
        cart.items.map((item) => ({
          orderId,
          skuId: item.skuId,
          productNameSnapshot: item.productName,
          skuNameSnapshot: item.skuName,
          skuCodeSnapshot: skuCodes.get(item.skuId)!,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
      );

      if (input.method === 'PICKUP') {
        await tx.insert(pickupCodes).values({ orderId, storeId: input.storeId });
      } else {
        const [delivery] = await tx
          .insert(deliveries)
          .values({
            orderId,
            storeId: input.storeId,
            deliveryZoneId: zone!.id,
            providerKey: zone!.providerKey,
            feeMinor: zone!.feeMinor,
            addressSnapshot: snapshotAddress(address!),
          })
          .returning({ id: deliveries.id });
        await tx.insert(deliveryEvents).values({
          deliveryId: delivery!.id,
          eventType: 'CREATED',
          actorType: 'SYSTEM',
          idempotencyKey: `delivery-created:${orderId}`,
        });
      }

      await tx.delete(cartItems).where(eq(cartItems.cartId, cartRow.id));
      return orderId;
    });
  }

  async getForConsumer(consumerUserId: string, orderId: string) {
    const [order] = await this.db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.consumerUserId, consumerUserId)))
      .limit(1);
    if (!order) throw new FulfillmentError('NOT_FOUND');
    return this.loadView(order.id, order.status);
  }

  async listForStaff(context: StaffAuthorizationContext, query: FulfillmentStaffListQuery) {
    if (query.storeId) await this.requireStoreAccess(context, query.storeId);
    const scope = scopeCondition(context);
    const pickupRows =
      query.method === 'DELIVERY'
        ? []
        : await this.db
            .select({
              orderId: orders.id,
              orderNumber: orders.orderNumber,
              orderStatus: orders.status,
              consumerUserId: orders.consumerUserId,
              totalMinor: orders.totalMinor,
              createdAt: orders.createdAt,
              storeId: stores.id,
            })
            .from(pickupCodes)
            .innerJoin(orders, eq(pickupCodes.orderId, orders.id))
            .innerJoin(stores, eq(pickupCodes.storeId, stores.id))
            .where(and(scope, query.storeId ? eq(stores.id, query.storeId) : undefined))
            .orderBy(desc(orders.createdAt))
            .limit(query.limit);

    const deliveryRows =
      query.method === 'PICKUP'
        ? []
        : await this.db
            .select({
              orderId: orders.id,
              orderNumber: orders.orderNumber,
              orderStatus: orders.status,
              consumerUserId: orders.consumerUserId,
              totalMinor: orders.totalMinor,
              createdAt: orders.createdAt,
              storeId: stores.id,
            })
            .from(deliveries)
            .innerJoin(orders, eq(deliveries.orderId, orders.id))
            .innerJoin(stores, eq(deliveries.storeId, stores.id))
            .where(and(scope, query.storeId ? eq(stores.id, query.storeId) : undefined))
            .orderBy(desc(orders.createdAt))
            .limit(query.limit);

    const rows = [...pickupRows, ...deliveryRows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, query.limit);
    return {
      items: await Promise.all(
        rows.map(async (row) => ({
          ...(await this.loadView(row.orderId, row.orderStatus)),
          orderNumber: row.orderNumber,
          orderStatus: row.orderStatus,
          consumerUserId: row.consumerUserId,
          totalMinor: row.totalMinor,
          createdAt: row.createdAt,
        })),
      ),
    };
  }

  async listZones(context: StaffAuthorizationContext, query: DeliveryZoneListQuery) {
    if (query.storeId) await this.requireStoreAccess(context, query.storeId);
    return {
      items: await this.db
        .select()
        .from(deliveryZones)
        .innerJoin(stores, eq(deliveryZones.storeId, stores.id))
        .where(
          and(
            scopeCondition(context),
            query.storeId ? eq(deliveryZones.storeId, query.storeId) : undefined,
            query.active === undefined ? undefined : eq(deliveryZones.active, query.active),
          ),
        )
        .orderBy(asc(deliveryZones.name))
        .limit(query.limit)
        .then((rows) => rows.map((row) => row.delivery_zones)),
    };
  }

  async createZone(context: StaffAuthorizationContext, input: DeliveryZoneInput) {
    await this.requireStoreAccess(context, input.storeId);
    const [row] = await this.db.insert(deliveryZones).values(input).returning();
    return row!;
  }

  async markPickupReady(context: StaffAuthorizationContext, orderId: string) {
    await this.db.transaction(async (tx) => {
      const { order, pickup } = await lockPickup(tx, orderId);
      if (!order || !pickup) throw new FulfillmentError('NOT_FOUND');
      await this.requireStoreAccess(context, pickup.storeId);
      if (order.status === 'PICKUP_READY') return;
      if (order.status !== 'PAID' || pickup.status !== 'ISSUED')
        throw new FulfillmentError('INVALID_STATE');
      await tx
        .update(orders)
        .set({ status: 'PICKUP_READY', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'PAID')));
    });
    return this.loadView(orderId, 'PICKUP_READY');
  }

  async verifyPickup(
    context: StaffAuthorizationContext,
    orderId: string,
    pickupCode: string,
    idempotencyKey: string,
  ) {
    await this.db.transaction(async (tx) => {
      const { order, pickup } = await lockPickup(tx, orderId);
      if (!order || !pickup) throw new FulfillmentError('NOT_FOUND');
      await this.requireStoreAccess(context, pickup.storeId);
      if (pickup.status === 'VERIFIED' && order.status === 'COMPLETED') return;
      if (order.status !== 'PICKUP_READY' || pickup.status !== 'ISSUED')
        throw new FulfillmentError('INVALID_STATE');
      if (!pickupCodeMatches(this.pickupSecret, 'ORDER', orderId, pickupCode))
        throw new FulfillmentError('PICKUP_CODE_INVALID');
      await deductSaleInventory(tx, orderId, pickup.storeId, context.staffAccountId, idempotencyKey);
      const now = new Date();
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
        .update(orders)
        .set({ status: 'COMPLETED', updatedAt: now })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'PICKUP_READY')));
    });
    return this.loadView(orderId, 'COMPLETED');
  }

  async dispatchDelivery(
    context: StaffAuthorizationContext,
    orderId: string,
    idempotencyKey: string,
  ) {
    const initial = await this.loadDeliveryOrder(orderId);
    if (!initial) throw new FulfillmentError('NOT_FOUND');
    await this.requireStoreAccess(context, initial.delivery.storeId);
    if (initial.delivery.status === 'DISPATCHED' && initial.order.status === 'DELIVERING')
      return this.loadView(orderId, initial.order.status);
    if (initial.delivery.status !== 'PENDING' || initial.order.status !== 'PAID')
      throw new FulfillmentError('INVALID_STATE');

    const providerResult = await this.deliveryProvider.dispatch({
      idempotencyKey,
      deliveryId: initial.delivery.id,
      orderId,
      storeId: initial.delivery.storeId,
      address: initial.delivery.addressSnapshot,
    });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from orders where id=${orderId} for update`);
      await tx.execute(sql`select 1 from deliveries where order_id=${orderId} for update`);
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.orderId, orderId))
        .limit(1);
      if (!order || !delivery) throw new FulfillmentError('NOT_FOUND');
      if (delivery.status === 'DISPATCHED' && order.status === 'DELIVERING') return;
      if (delivery.status !== 'PENDING' || order.status !== 'PAID')
        throw new FulfillmentError('INVALID_STATE');

      await deductSaleInventory(
        tx,
        orderId,
        delivery.storeId,
        context.staffAccountId,
        idempotencyKey,
      );
      const now = new Date();
      await tx
        .update(deliveries)
        .set({
          status: 'DISPATCHED',
          providerOrderId: providerResult.providerOrderId,
          dispatchedAt: now,
          version: delivery.version + 1,
          updatedAt: now,
        })
        .where(and(eq(deliveries.id, delivery.id), eq(deliveries.version, delivery.version)));
      await tx
        .update(orders)
        .set({ status: 'DELIVERING', updatedAt: now })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'PAID')));
      await tx.insert(deliveryEvents).values({
        deliveryId: delivery.id,
        eventType: 'DISPATCHED',
        actorType: 'STAFF',
        actorStaffAccountId: context.staffAccountId,
        idempotencyKey: `${delivery.id}:dispatch:${idempotencyKey}`,
        metadata: { providerOrderId: providerResult.providerOrderId },
      });
    });
    return this.loadView(orderId, 'DELIVERING');
  }

  async completeDelivery(
    context: StaffAuthorizationContext,
    orderId: string,
    idempotencyKey: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from orders where id=${orderId} for update`);
      await tx.execute(sql`select 1 from deliveries where order_id=${orderId} for update`);
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.orderId, orderId))
        .limit(1);
      if (!order || !delivery) throw new FulfillmentError('NOT_FOUND');
      await this.requireStoreAccess(context, delivery.storeId);
      if (delivery.status === 'DELIVERED' && order.status === 'COMPLETED') return;
      if (delivery.status !== 'DISPATCHED' || order.status !== 'DELIVERING')
        throw new FulfillmentError('INVALID_STATE');
      const now = new Date();
      await tx
        .update(deliveries)
        .set({
          status: 'DELIVERED',
          deliveredAt: now,
          version: delivery.version + 1,
          updatedAt: now,
        })
        .where(and(eq(deliveries.id, delivery.id), eq(deliveries.version, delivery.version)));
      await tx
        .update(orders)
        .set({ status: 'COMPLETED', updatedAt: now })
        .where(and(eq(orders.id, orderId), eq(orders.status, 'DELIVERING')));
      await tx.insert(deliveryEvents).values({
        deliveryId: delivery.id,
        eventType: 'DELIVERED',
        actorType: 'STAFF',
        actorStaffAccountId: context.staffAccountId,
        idempotencyKey: `${delivery.id}:delivered:${idempotencyKey}`,
      });
    });
    return this.loadView(orderId, 'COMPLETED');
  }

  private async loadView(orderId: string, orderStatus: string) {
    const [pickup] = await this.db
      .select({ pickup: pickupCodes, storeName: stores.name })
      .from(pickupCodes)
      .innerJoin(stores, eq(pickupCodes.storeId, stores.id))
      .where(eq(pickupCodes.orderId, orderId))
      .limit(1);
    if (pickup) {
      return {
        orderId,
        method: 'PICKUP' as const,
        store: { id: pickup.pickup.storeId, name: pickup.storeName },
        deliveryFeeMinor: 0,
        pickup: {
          status: pickup.pickup.status,
          code:
            pickup.pickup.status === 'ISSUED' && orderStatus === 'PICKUP_READY'
              ? pickupCodeFor(this.pickupSecret, 'ORDER', orderId)
              : null,
          issuedAt: pickup.pickup.issuedAt,
          verifiedAt: pickup.pickup.verifiedAt,
        },
        delivery: null,
      };
    }

    const [delivery] = await this.db
      .select({
        delivery: deliveries,
        storeName: stores.name,
        zoneName: deliveryZones.name,
      })
      .from(deliveries)
      .innerJoin(stores, eq(deliveries.storeId, stores.id))
      .innerJoin(deliveryZones, eq(deliveries.deliveryZoneId, deliveryZones.id))
      .where(eq(deliveries.orderId, orderId))
      .limit(1);
    if (!delivery) throw new FulfillmentError('NOT_FOUND');
    return {
      orderId,
      method: 'DELIVERY' as const,
      store: { id: delivery.delivery.storeId, name: delivery.storeName },
      deliveryFeeMinor: delivery.delivery.feeMinor,
      pickup: null,
      delivery: {
        id: delivery.delivery.id,
        status: delivery.delivery.status,
        providerKey: delivery.delivery.providerKey,
        providerOrderId: delivery.delivery.providerOrderId,
        zoneName: delivery.zoneName,
        dispatchedAt: delivery.delivery.dispatchedAt,
        deliveredAt: delivery.delivery.deliveredAt,
      },
    };
  }

  private async requireActiveStore(storeId: string) {
    const [store] = await this.db
      .select({ id: stores.id, name: stores.name, status: stores.operationalStatus })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store || store.status !== 'ACTIVE') throw new FulfillmentError('NOT_FOUND');
    return { id: store.id, name: store.name };
  }

  private async requireAddress(consumerUserId: string, addressId: string) {
    const [address] = await this.db
      .select()
      .from(userAddresses)
      .where(
        and(
          eq(userAddresses.id, addressId),
          eq(userAddresses.consumerUserId, consumerUserId),
        ),
      )
      .limit(1);
    if (!address) throw new FulfillmentError('NOT_FOUND');
    return address;
  }

  private async resolveDeliveryZone(
    storeId: string,
    address: typeof userAddresses.$inferSelect,
  ) {
    const rows = await this.db
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.storeId, storeId),
          eq(deliveryZones.active, true),
          eq(deliveryZones.region, address.region),
          eq(deliveryZones.city, address.city),
          or(eq(deliveryZones.district, address.district), sql`${deliveryZones.district} is null`),
        ),
      );
    const zone = rows.find((row) => row.district === address.district) ?? rows.find((row) => !row.district);
    if (!zone) throw new FulfillmentError('DELIVERY_UNAVAILABLE');
    if (zone.providerKey !== this.deliveryProvider.key)
      throw new FulfillmentError('DELIVERY_UNAVAILABLE');
    return zone;
  }

  private async requireStoreAccess(context: StaffAuthorizationContext, storeId: string) {
    const [store] = await this.db
      .select({ id: stores.id, regionId: stores.regionId, franchiseeId: stores.franchiseeId })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) throw new FulfillmentError('NOT_FOUND');
    if (!canAccess(context, store.id, store.regionId, store.franchiseeId))
      throw new FulfillmentError('FORBIDDEN');
    return store;
  }

  private async loadDeliveryOrder(orderId: string) {
    const [row] = await this.db
      .select({ order: orders, delivery: deliveries })
      .from(deliveries)
      .innerJoin(orders, eq(deliveries.orderId, orders.id))
      .where(eq(deliveries.orderId, orderId))
      .limit(1);
    return row ?? null;
  }
}

async function lockPickup(tx: Transaction, orderId: string) {
  await tx.execute(sql`select 1 from orders where id=${orderId} for update`);
  await tx.execute(sql`select 1 from pickup_codes where order_id=${orderId} for update`);
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const [pickup] = await tx
    .select()
    .from(pickupCodes)
    .where(eq(pickupCodes.orderId, orderId))
    .limit(1);
  return { order, pickup };
}

async function deductSaleInventory(
  tx: Transaction,
  orderId: string,
  storeId: string,
  staffAccountId: string,
  idempotencyKey: string,
) {
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.skuId));
  for (const item of items) {
    await tx.execute(
      sql`select 1 from store_inventory where store_id=${storeId} and sku_id=${item.skuId} for update`,
    );
    const [balance] = await tx
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, item.skuId)))
      .limit(1);
    if (
      !balance ||
      balance.onHand - balance.reserved - balance.rentalReserved < item.quantity
    )
      throw new FulfillmentError('INSUFFICIENT_STOCK');
    const next = balance.onHand - item.quantity;
    await tx
      .update(storeInventory)
      .set({ onHand: next, version: balance.version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(storeInventory.storeId, storeId),
          eq(storeInventory.skuId, item.skuId),
          eq(storeInventory.version, balance.version),
        ),
      );
    await tx.insert(inventoryTransactions).values({
      storeId,
      skuId: item.skuId,
      transactionType: 'SALE',
      quantityDelta: -item.quantity,
      balanceAfter: next,
      referenceType: 'ORDER',
      referenceId: orderId,
      idempotencyKey: `sale:${orderId}:${item.skuId}:${idempotencyKey}`,
      createdByStaffAccountId: staffAccountId,
    });
  }
}

function snapshotAddress(address: typeof userAddresses.$inferSelect) {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    region: address.region,
    city: address.city,
    district: address.district,
    addressLine: address.addressLine,
    postalCode: address.postalCode,
  };
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

function scopeCondition(context: StaffAuthorizationContext) {
  if (context.dataScopes.some((scope) => scope.type === 'GLOBAL')) return sql`true`;
  const storeIds = context.dataScopes
    .filter((scope) => scope.type === 'STORE' && scope.id)
    .map((scope) => scope.id!);
  const regionIds = context.dataScopes
    .filter((scope) => scope.type === 'REGION' && scope.id)
    .map((scope) => scope.id!);
  const franchiseeIds = context.dataScopes
    .filter((scope) => scope.type === 'FRANCHISEE' && scope.id)
    .map((scope) => scope.id!);
  return or(
    storeIds.length ? inArray(stores.id, storeIds) : undefined,
    regionIds.length ? inArray(stores.regionId, regionIds) : undefined,
    franchiseeIds.length ? inArray(stores.franchiseeId, franchiseeIds) : undefined,
    sql`false`,
  )!;
}
