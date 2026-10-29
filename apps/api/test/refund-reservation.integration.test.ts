import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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

  async function clean() {
    await db.delete(auditLogs);
    await db.delete(financeLedgerEntries);
    await db.delete(paymentCallbacks);
    await db.delete(paymentLedger);
    await db.delete(refunds);
    await db.delete(payments);
    await db.delete(deliveryEvents);
    await db.delete(deliveries);
    await db.delete(pickupCodes);
    await db.delete(deliveryZones);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(cartItems);
    await db.delete(carts);
    await db.delete(userAddresses);
    await db.delete(storeInventory);
    await db.delete(skus);
    await db.delete(products);
    await db.delete(bookEditions);
    await db.delete(books);
    await db.delete(stores);
    await db.delete(franchisees);
    await db.delete(regions);
    await db.delete(wechatIdentities);
    await db.delete(consumerUsers);
    await db.delete(staffAccounts);
  }

  beforeEach(async () => {
    await clean();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await clean();
    await database!.pool.end();
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
    return { orderId, storeId: store!.id, skuId: sku!.id, payment: payment!, transaction, staffId: staff!.id };
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

      const [refund] = await db.select().from(refunds);
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
      await Promise.all([paymentService.callback('refunded', {}), paymentService.callback('refunded', {})]);
      event = { ...event, id: randomUUID() };
      await paymentService.callback('refunded-replay', {});

      const [balance] = await db
        .select()
        .from(storeInventory)
        .where(and(eq(storeInventory.storeId, f.storeId), eq(storeInventory.skuId, f.skuId)));
      expect(balance).toMatchObject({ onHand: 3, reserved: 0, version: 2 });
      const [order] = await db.select().from(orders).where(eq(orders.id, f.orderId));
      expect(order!.status).toBe('REFUNDED');
      expect(await db.select().from(paymentLedger)).toHaveLength(2);
      expect(await db.select().from(financeLedgerEntries)).toHaveLength(2);

      if (method === 'PICKUP') {
        const [pickup] = await db.select().from(pickupCodes).where(eq(pickupCodes.orderId, f.orderId));
        expect(pickup).toMatchObject({ status: 'CANCELLED', version: 1 });
        expect(pickup?.cancelledAt).toBeTruthy();
      } else {
        const [delivery] = await db.select().from(deliveries).where(eq(deliveries.orderId, f.orderId));
        expect(delivery).toMatchObject({ status: 'CANCELLED', version: 1 });
        expect(delivery?.cancelledAt).toBeTruthy();
        const events = await db.select().from(deliveryEvents);
        expect(events.map((row) => row.eventType)).toEqual(['CREATED', 'CANCELLED']);
      }
    });
  }

  it('does not release a pickup reservation when the refund is CLOSED', async () => {
    const f = await seed('PICKUP');
    setupRefund(f);
    await paymentService.requestRefund(f.payment.id, f.staffId);
    const [refund] = await db.select().from(refunds);
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
    const [pickup] = await db.select().from(pickupCodes).where(eq(pickupCodes.orderId, f.orderId));
    expect(pickup?.status).toBe('ISSUED');
    const [order] = await db.select().from(orders).where(eq(orders.id, f.orderId));
    expect(order?.status).toBe('PAID');
    expect(await db.select().from(paymentLedger)).toHaveLength(1);
  });
});
