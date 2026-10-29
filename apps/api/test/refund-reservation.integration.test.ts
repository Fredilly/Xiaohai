import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditLogs,
  bookEditions,
  books,
  cartItems,
  carts,
  consumerUsers,
  createDatabase,
  deliveries,
  deliveryEvents,
  deliveryZones,
  financeLedgerEntries,
  franchisees,
  orderItems,
  orders,
  paymentCallbacks,
  paymentLedger,
  payments,
  pickupCodes,
  products,
  refunds,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
  userAddresses,
  wechatIdentities,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { ManualDeliveryProvider } from '../src/fulfillment/delivery-provider.js';
import { FulfillmentService } from '../src/fulfillment/fulfillment-service.js';
import { PaymentService } from '../src/payments/payment-service.js';
import type {
  PayNotification,
  PayTransaction,
  WeChatPayProvider,
} from '../src/payments/wechat-pay.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;

suite('M6 paid refund and M16 reservation PostgreSQL integration', () => {
  const db = database!.db;
  let event: PayNotification;
  const provider = {
    appId: 'refund-reservation-test-app',
    merchantId: 'refund-reservation-test-merchant',
    assertConfigured() {},
    create: vi.fn<WeChatPayProvider['create']>().mockResolvedValue({
      timeStamp: '1',
      nonceStr: 'test',
      package: 'prepay_id=test',
      signType: 'RSA',
      paySign: 'test',
    }),
    query: vi.fn<WeChatPayProvider['query']>(),
    refund: vi.fn<WeChatPayProvider['refund']>(),
    queryRefund: vi.fn<WeChatPayProvider['queryRefund']>(),
    notification: () => event,
  } satisfies WeChatPayProvider;
  const commerce = new CommerceService(db);
  const fulfillment = new FulfillmentService(
    db,
    commerce,
    'refund-reservation-pickup-secret-with-at-least-32-bytes',
    new ManualDeliveryProvider(),
  );
  const paymentService = new PaymentService(db, provider);

  // Never truncate shared integration tables: other test files may own rows.
  const fixtures: {
    regionId: string;
    franchiseeId: string;
    storeId: string;
    bookId: string;
    editionId: string;
    productId: string;
    skuId: string;
    userId: string;
    staffId: string;
    orderId: string;
    paymentId: string;
  }[] = [];

  async function clean() {
    for (const f of fixtures) {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, f.staffId));
      const ledger = await db
        .select({ id: paymentLedger.id })
        .from(paymentLedger)
        .where(eq(paymentLedger.paymentId, f.paymentId));
      if (ledger.length)
        await db.delete(financeLedgerEntries).where(
          inArray(financeLedgerEntries.paymentLedgerId, ledger.map((row) => row.id)),
        );
      await db.delete(paymentCallbacks).where(eq(paymentCallbacks.paymentId, f.paymentId));
      await db.delete(paymentLedger).where(eq(paymentLedger.paymentId, f.paymentId));
      await db.delete(refunds).where(eq(refunds.paymentId, f.paymentId));
      await db.delete(payments).where(eq(payments.id, f.paymentId));

      const deliveryRows = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(eq(deliveries.orderId, f.orderId));
      if (deliveryRows.length)
        await db.delete(deliveryEvents).where(
          inArray(deliveryEvents.deliveryId, deliveryRows.map((row) => row.id)),
        );
      await db.delete(deliveries).where(eq(deliveries.orderId, f.orderId));
      await db.delete(pickupCodes).where(eq(pickupCodes.orderId, f.orderId));
      await db.delete(deliveryZones).where(eq(deliveryZones.storeId, f.storeId));
      await db.delete(orderItems).where(eq(orderItems.orderId, f.orderId));
      await db.delete(orders).where(eq(orders.id, f.orderId));

      const cartRows = await db
        .select({ id: carts.id })
        .from(carts)
        .where(eq(carts.consumerUserId, f.userId));
      if (cartRows.length)
        await db.delete(cartItems).where(
          inArray(cartItems.cartId, cartRows.map((row) => row.id)),
        );
      await db.delete(carts).where(eq(carts.consumerUserId, f.userId));
      await db.delete(userAddresses).where(eq(userAddresses.consumerUserId, f.userId));
      await db.delete(storeInventory).where(
        and(eq(storeInventory.storeId, f.storeId), eq(storeInventory.skuId, f.skuId)),
      );
      await db.delete(skus).where(eq(skus.id, f.skuId));
      await db.delete(products).where(eq(products.id, f.productId));
      await db.delete(bookEditions).where(eq(bookEditions.id, f.editionId));
      await db.delete(books).where(eq(books.id, f.bookId));
      await db.delete(stores).where(eq(stores.id, f.storeId));
      await db.delete(franchisees).where(eq(franchisees.id, f.franchiseeId));
      await db.delete(regions).where(eq(regions.id, f.regionId));
      await db.delete(wechatIdentities).where(eq(wechatIdentities.consumerUserId, f.userId));
      await db.delete(consumerUsers).where(eq(consumerUsers.id, f.userId));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, f.staffId));
    }
    fixtures.length = 0;
  }

  beforeEach(async () => {
    await clean();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    try {
      await clean();
    } finally {
      await database!.pool.end();
    }
  });

  async function seed(method: 'PICKUP' | 'DELIVERY') {
    const [region] = await db
      .insert(regions)
      .values({
        code: randomUUID(),
        name: 'Refund stock region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning();
    const [franchisee] = await db
      .insert(franchisees)
      .values({ code: randomUUID(), regionId: region!.id, name: 'Refund franchisee' })
      .returning();
    const [store] = await db
      .insert(stores)
      .values({
        code: randomUUID(),
        regionId: region!.id,
        franchiseeId: franchisee!.id,
        name: 'Refund test store',
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Refund test address',
        latitude: 30.6,
        longitude: 104.1,
      })
      .returning();
    const [book] = await db
      .insert(books)
      .values({ title: 'Refund stock book', author: 'Author' })
      .returning();
    const [edition] = await db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: randomUUID() })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: 'Refund stock book', status: 'ACTIVE' })
      .returning();
    const [sku] = await db
      .insert(skus)
      .values({ productId: product!.id, code: randomUUID(), name: 'Standard', priceMinor: 2500 })
      .returning();
    await db.insert(storeInventory).values({ storeId: store!.id, skuId: sku!.id, onHand: 3 });
    const [user] = await db.insert(consumerUsers).values({}).returning();
    await db
      .insert(wechatIdentities)
      .values({ consumerUserId: user!.id, appId: provider.appId, openid: randomUUID() });
    const [staff] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: randomUUID(), passwordHash: 'test-only-not-a-login-hash' })
      .returning();
    await commerce.addCartItem(user!.id, sku!.id, 1);
    let addressId: string | undefined;
    if (method === 'DELIVERY') {
      const address = await commerce.createAddress(user!.id, {
        recipientName: 'Test',
        phone: '13800000000',
        region: 'Sichuan',
        city: 'Chengdu',
        district: 'High-tech',
        addressLine: 'Test street',
        postalCode: null,
        isDefault: true,
      });
      addressId = address.id;
      await db.insert(deliveryZones).values({
        storeId: store!.id,
        name: 'Test delivery zone',
        region: 'Sichuan',
        city: 'Chengdu',
        district: 'High-tech',
        feeMinor: 0,
        providerKey: 'MANUAL',
      });
    }
    const orderId = await fulfillment.createOrder(user!.id, {
      method,
      storeId: store!.id,
      clientRequestId: randomUUID(),
      ...(addressId ? { addressId } : {}),
    });
    const paymentResult = await paymentService.create(user!.id, orderId);
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentResult.paymentId));
    const transaction: PayTransaction = {
      appid: provider.appId,
      mchid: provider.merchantId,
      out_trade_no: payment!.outTradeNo,
      transaction_id: randomUUID(),
      trade_state: 'SUCCESS',
      amount: { total: 2500, currency: 'CNY' },
    };
    event = { id: randomUUID(), eventType: 'TRANSACTION.SUCCESS', transaction };
    await paymentService.callback('paid', {});
    const [reserved] = await db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, store!.id), eq(storeInventory.skuId, sku!.id)));
    expect(reserved).toMatchObject({ onHand: 3, reserved: 1 });
    fixtures.push({
      regionId: region!.id,
      franchiseeId: franchisee!.id,
      storeId: store!.id,
      bookId: book!.id,
      editionId: edition!.id,
      productId: product!.id,
      skuId: sku!.id,
      userId: user!.id,
      staffId: staff!.id,
      orderId,
      paymentId: payment!.id,
    });
    return {
      orderId,
      storeId: store!.id,
      skuId: sku!.id,
      payment: payment!,
      transaction,
      staffId: staff!.id,
    };
  }

  function setupRefund(f: Awaited<ReturnType<typeof seed>>) {
    provider.refund.mockImplementation((input) =>
      Promise.resolve({
        out_trade_no: f.payment.outTradeNo,
        transaction_id: f.transaction.transaction_id!,
        out_refund_no: input.outRefundNo,
        refund_id: 'provider-refund',
        status: 'PROCESSING',
        amount: { total: 2500, refund: 2500, currency: 'CNY' },
      }),
    );
  }

  for (const method of ['PICKUP', 'DELIVERY'] as const) {
    it(`releases exactly one ${method} reservation on confirmed refund and callback replay`, async () => {
      const f = await seed(method);
      setupRefund(f);
      const intent = await paymentService.requestRefund(f.payment.id, f.staffId);
      expect(intent.status).toBe('PROCESSING');
      const [during] = await db
        .select()
        .from(storeInventory)
        .where(and(eq(storeInventory.storeId, f.storeId), eq(storeInventory.skuId, f.skuId)));
      expect(during).toMatchObject({ onHand: 3, reserved: 1 });

      const [refund] = await db
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, f.payment.id));
      event = {
        id: randomUUID(),
        eventType: 'REFUND.SUCCESS',
        refund: {
          mchid: provider.merchantId,
          out_trade_no: f.payment.outTradeNo,
          transaction_id: f.transaction.transaction_id!,
          out_refund_no: refund!.outRefundNo,
          refund_id: 'provider-refund',
          status: 'SUCCESS',
          amount: { total: 2500, refund: 2500 },
        },
      };
      await Promise.all([
        paymentService.callback('refunded', {}),
        paymentService.callback('refunded', {}),
      ]);
      event = { ...event, id: randomUUID() };
      await paymentService.callback('refunded-replay', {});

      const [balance] = await db
        .select()
        .from(storeInventory)
        .where(and(eq(storeInventory.storeId, f.storeId), eq(storeInventory.skuId, f.skuId)));
      expect(balance).toMatchObject({ onHand: 3, reserved: 0, version: 2 });
      const [order] = await db.select().from(orders).where(eq(orders.id, f.orderId));
      expect(order!.status).toBe('REFUNDED');
      const ledger = await db
        .select()
        .from(paymentLedger)
        .where(eq(paymentLedger.paymentId, f.payment.id));
      expect(ledger).toHaveLength(2);
      expect(
        await db
          .select()
          .from(financeLedgerEntries)
          .where(inArray(financeLedgerEntries.paymentLedgerId, ledger.map((row) => row.id))),
      ).toHaveLength(2);

      if (method === 'PICKUP') {
        const [pickup] = await db
          .select()
          .from(pickupCodes)
          .where(eq(pickupCodes.orderId, f.orderId));
        expect(pickup).toMatchObject({ status: 'CANCELLED', version: 1 });
        expect(pickup?.cancelledAt).toBeTruthy();
      } else {
        const [delivery] = await db
          .select()
          .from(deliveries)
          .where(eq(deliveries.orderId, f.orderId));
        expect(delivery).toMatchObject({ status: 'CANCELLED', version: 1 });
        expect(delivery?.cancelledAt).toBeTruthy();
        const events = await db
          .select()
          .from(deliveryEvents)
          .where(eq(deliveryEvents.deliveryId, delivery!.id));
        expect(events.map((row) => row.eventType)).toEqual(['CREATED', 'CANCELLED']);
      }
    });
  }

  it('does not release a pickup reservation when the refund is CLOSED', async () => {
    const f = await seed('PICKUP');
    setupRefund(f);
    await paymentService.requestRefund(f.payment.id, f.staffId);
    const [refund] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, f.payment.id));
    event = {
      id: randomUUID(),
      eventType: 'REFUND.CLOSED',
      refund: {
        mchid: provider.merchantId,
        out_trade_no: f.payment.outTradeNo,
        transaction_id: f.transaction.transaction_id!,
        out_refund_no: refund!.outRefundNo,
        refund_id: 'provider-refund',
        status: 'CLOSED',
        amount: { total: 2500, refund: 2500 },
      },
    };
    await paymentService.callback('refund-closed', {});
    const [balance] = await db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, f.storeId), eq(storeInventory.skuId, f.skuId)));
    expect(balance).toMatchObject({ onHand: 3, reserved: 1, version: 1 });
    const [pickup] = await db
      .select()
      .from(pickupCodes)
      .where(eq(pickupCodes.orderId, f.orderId));
    expect(pickup?.status).toBe('ISSUED');
    const [order] = await db.select().from(orders).where(eq(orders.id, f.orderId));
    expect(order?.status).toBe('PAID');
    expect(
      await db.select().from(paymentLedger).where(eq(paymentLedger.paymentId, f.payment.id)),
    ).toHaveLength(1);
  });
});
