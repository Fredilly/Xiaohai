import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import type { HqOrderListQuery, HqUserListQuery } from '@xiaohai/contracts/hq';
import {
  consumerUsers,
  deliveries,
  orderItems,
  orders,
  payments,
  pickupCodes,
  wechatIdentities,
  type createDatabase,
} from '@xiaohai/db';

type Database = ReturnType<typeof createDatabase>['db'];

export class HqReadError extends Error {
  constructor(readonly code: 'NOT_FOUND') {
    super(code);
  }
}

export class HqReadService {
  constructor(private readonly db: Database) {}

  async listOrders(input: HqOrderListQuery) {
    const rows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        consumerUserId: orders.consumerUserId,
        status: orders.status,
        subtotalMinor: orders.subtotalMinor,
        totalMinor: orders.totalMinor,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .where(
        and(
          input.status ? eq(orders.status, input.status) : undefined,
          input.consumerUserId ? eq(orders.consumerUserId, input.consumerUserId) : undefined,
          input.q ? ilike(orders.orderNumber, `%${input.q}%`) : undefined,
          input.createdFrom ? gte(orders.createdAt, new Date(input.createdFrom)) : undefined,
          input.createdTo ? lte(orders.createdAt, new Date(input.createdTo)) : undefined,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(input.limit);

    return {
      items: rows.map((row) => ({
        ...row,
        status: row.status as HqOrderListQuery['status'] extends infer _ ? typeof row.status : never,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async getOrder(id: string) {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) throw new HqReadError('NOT_FOUND');

    const [items, paymentRows, pickupRows, deliveryRows] = await Promise.all([
      this.db.select().from(orderItems).where(eq(orderItems.orderId, id)),
      this.db.select().from(payments).where(eq(payments.orderId, id)).limit(1),
      this.db.select().from(pickupCodes).where(eq(pickupCodes.orderId, id)).limit(1),
      this.db.select().from(deliveries).where(eq(deliveries.orderId, id)).limit(1),
    ]);

    const payment = paymentRows[0];
    const pickup = pickupRows[0];
    const delivery = deliveryRows[0];
    const address = order.addressSnapshot as {
      recipientName: string;
      phone: string;
      region: string;
      city: string;
      district: string;
      addressLine: string;
      postalCode: string | null;
    } | null;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      consumerUserId: order.consumerUserId,
      status: order.status,
      subtotalMinor: order.subtotalMinor,
      totalMinor: order.totalMinor,
      address,
      items: items.map((item) => ({
        id: item.id,
        productName: item.productNameSnapshot,
        skuName: item.skuNameSnapshot,
        skuCode: item.skuCodeSnapshot,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
      })),
      payment: payment
        ? {
            id: payment.id,
            status: payment.status,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            reviewRequired: payment.reviewRequired,
          }
        : null,
      fulfillment: pickup
        ? { method: 'PICKUP' as const, storeId: pickup.storeId, status: pickup.status }
        : delivery
          ? { method: 'DELIVERY' as const, storeId: delivery.storeId, status: delivery.status }
          : null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
    };
  }

  async listUsers(input: HqUserListQuery) {
    const rows = await this.db
      .select({
        id: consumerUsers.id,
        identityCount: sql<number>`(
          select count(*)::int from wechat_identities wi
          where wi.consumer_user_id = ${consumerUsers.id}
        )`,
        lastLoginAt: sql<Date | null>`(
          select max(wi.last_login_at) from wechat_identities wi
          where wi.consumer_user_id = ${consumerUsers.id}
        )`,
        createdAt: consumerUsers.createdAt,
        updatedAt: consumerUsers.updatedAt,
      })
      .from(consumerUsers)
      .where(
        and(
          input.id ? eq(consumerUsers.id, input.id) : undefined,
          input.createdFrom ? gte(consumerUsers.createdAt, new Date(input.createdFrom)) : undefined,
          input.createdTo ? lte(consumerUsers.createdAt, new Date(input.createdTo)) : undefined,
        ),
      )
      .orderBy(desc(consumerUsers.createdAt))
      .limit(input.limit);

    return {
      items: rows.map((row) => ({
        ...row,
        identityCount: Number(row.identityCount),
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async getUser(id: string) {
    const [user] = await this.db
      .select({
        id: consumerUsers.id,
        createdAt: consumerUsers.createdAt,
        updatedAt: consumerUsers.updatedAt,
      })
      .from(consumerUsers)
      .where(eq(consumerUsers.id, id))
      .limit(1);
    if (!user) throw new HqReadError('NOT_FOUND');

    const [identityStats] = await this.db
      .select({
        identityCount: sql<number>`count(*)::int`,
        lastLoginAt: sql<Date | null>`max(${wechatIdentities.lastLoginAt})`,
      })
      .from(wechatIdentities)
      .where(eq(wechatIdentities.consumerUserId, id));
    const [orderStats] = await this.db
      .select({
        orderCount: sql<number>`count(*)::int`,
        lifetimeOrderMinor: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::int`,
        lastOrderAt: sql<Date | null>`max(${orders.createdAt})`,
      })
      .from(orders)
      .where(eq(orders.consumerUserId, id));

    return {
      id: user.id,
      identityCount: Number(identityStats?.identityCount ?? 0),
      lastLoginAt: identityStats?.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      orderCount: Number(orderStats?.orderCount ?? 0),
      lifetimeOrderMinor: Number(orderStats?.lifetimeOrderMinor ?? 0),
      lastOrderAt: orderStats?.lastOrderAt?.toISOString() ?? null,
    };
  }
}
