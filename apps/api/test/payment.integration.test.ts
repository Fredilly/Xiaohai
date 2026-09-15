import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  consumerUsers,
  orders,
  payments,
  paymentCallbacks,
  paymentLedger,
  refunds,
  reconciliationItems,
  reconciliationRuns,
  staffAccounts,
  wechatIdentities,
} from '@xiaohai/db';
import { PaymentService } from '../src/payments/payment-service.js';
import type {
  PayNotification,
  PayTransaction,
  WeChatPayProvider,
} from '../src/payments/wechat-pay.js';
import { CommerceService } from '../src/commerce/commerce-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
suite('M6 real PostgreSQL payment transactions', () => {
  const db = database?.db as NonNullable<typeof database>['db'];
  let event: PayNotification;
  const provider = {
    appId: 'payment-test-app',
    merchantId: 'payment-test-merchant',
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
  const service = new PaymentService(db, provider);
  const createdUsers: string[] = [],
    createdStaff: string[] = [];
  async function cleanup() {
    await db.delete(reconciliationItems);
    await db.delete(reconciliationRuns);
    await db.delete(paymentCallbacks);
    await db.delete(paymentLedger);
    await db.delete(refunds);
    await db.delete(payments);
    for (const id of createdUsers.splice(0)) {
      await db.delete(orders).where(eq(orders.consumerUserId, id));
      await db.delete(consumerUsers).where(eq(consumerUsers.id, id));
    }
    for (const id of createdStaff.splice(0))
      await db.delete(staffAccounts).where(eq(staffAccounts.id, id));
  }
  beforeEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await cleanup();
    await database?.pool.end();
  });
  async function fixture() {
    const [user] = await db.insert(consumerUsers).values({}).returning();
    createdUsers.push(user!.id);
    await db
      .insert(wechatIdentities)
      .values({ consumerUserId: user!.id, appId: provider.appId, openid: randomUUID() });
    const [order] = await db
      .insert(orders)
      .values({
        consumerUserId: user!.id,
        orderNumber: randomUUID(),
        subtotalMinor: 2500,
        totalMinor: 2500,
        addressSnapshot: {},
        clientRequestId: randomUUID(),
      })
      .returning();
    const [staff] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: randomUUID(), passwordHash: 'test-only-not-a-login-hash' })
      .returning();
    createdStaff.push(staff!.id);
    const result = await service.create(user!.id, order!.id);
    const [payment] = await db.select().from(payments).where(eq(payments.id, result.paymentId));
    const transaction: PayTransaction = {
      appid: provider.appId,
      mchid: provider.merchantId,
      out_trade_no: payment!.outTradeNo,
      transaction_id: randomUUID(),
      trade_state: 'SUCCESS',
      amount: { total: 2500, currency: 'CNY' },
    };
    event = { id: randomUUID(), eventType: 'TRANSACTION.SUCCESS', transaction };
    return { user: user!, order: order!, payment: payment!, transaction, staff: staff! };
  }
  it('uses immutable server order amount, enforces ownership and reuses the merchant number', async () => {
    const f = await fixture();
    expect(provider.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ amountMinor: 2500 }),
    );
    expect((await service.create(f.user.id, f.order.id)).paymentId).toBe(f.payment.id);
    expect(await db.select().from(payments)).toHaveLength(1);
    await expect(service.create(randomUUID(), f.order.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('concurrent callbacks produce one receipt, ledger entry and PAID transition', async () => {
    const f = await fixture();
    await Promise.all([service.callback('same-raw', {}), service.callback('same-raw', {})]);
    expect(await db.select().from(paymentCallbacks)).toHaveLength(1);
    expect(await db.select().from(paymentLedger)).toHaveLength(1);
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]?.status).toBe(
      'PAID',
    );
    await expect(service.callback('changed-raw', {})).rejects.toMatchObject({
      code: 'CALLBACK_CONFLICT',
    });
  });
  it('rejects wrong amount/merchant and rolls back callback receipt', async () => {
    const f = await fixture();
    event.transaction = { ...f.transaction, amount: { total: 1, currency: 'CNY' } };
    await expect(service.callback('bad', {})).rejects.toMatchObject({
      code: 'PAYMENT_DETAILS_MISMATCH',
    });
    event.transaction = { ...f.transaction, mchid: 'wrong' };
    await expect(service.callback('bad', {})).rejects.toMatchObject({
      code: 'PAYMENT_DETAILS_MISMATCH',
    });
    expect(await db.select().from(paymentCallbacks)).toHaveLength(0);
    expect(await db.select().from(paymentLedger)).toHaveLength(0);
  });
  it('provider transaction ID is unique across orders, second transition rolls back', async () => {
    const a = await fixture();
    await service.callback('first', {});
    const b = await fixture();
    event.transaction = { ...b.transaction, transaction_id: a.transaction.transaction_id };
    await expect(service.callback('second', {})).rejects.toThrow();
    expect((await db.select().from(orders).where(eq(orders.id, b.order.id)))[0]?.status).toBe(
      'UNPAID',
    );
    expect(await db.select().from(paymentLedger)).toHaveLength(1);
  });
  it('late success never revives a cancelled order and creates review evidence', async () => {
    const f = await fixture();
    await new CommerceService(db).cancelOrder(f.user.id, f.order.id);
    expect((await service.callback('late', {})).reviewRequired).toBe(true);
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]?.status).toBe(
      'CANCELLED',
    );
    expect((await db.select().from(payments))[0]?.reviewRequired).toBe(true);
  });
  it('full refund is retry-safe, callback confirmed and cannot regress after success', async () => {
    const f = await fixture();
    await service.callback('paid', {});
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
    const result = await service.requestRefund(f.payment.id, f.staff.id);
    expect(result.status).toBe('PROCESSING');
    expect((await service.requestRefund(f.payment.id, f.staff.id)).id).toBe(result.id);
    expect(provider.refund).toHaveBeenCalledTimes(1);
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
    await Promise.all([service.callback('refund', {}), service.callback('refund', {})]);
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]?.status).toBe(
      'REFUNDED',
    );
    expect(await db.select().from(paymentLedger)).toHaveLength(2);
  });
  it('refund timeout retains one PENDING intent and same number for retries', async () => {
    const f = await fixture();
    await service.callback('paid', {});
    provider.refund.mockRejectedValue(new Error('timeout'));
    await expect(service.requestRefund(f.payment.id, f.staff.id)).rejects.toThrow();
    await expect(service.requestRefund(f.payment.id, f.staff.id)).rejects.toThrow();
    expect(await db.select().from(refunds)).toHaveLength(1);
    expect(provider.refund.mock.calls[0]?.[0].outRefundNo).toBe(
      provider.refund.mock.calls[1]?.[0].outRefundNo,
    );
  });
  it('ABNORMAL requires review; CLOSED restores PAID and rejects a conflicting terminal result', async () => {
    const f = await fixture();
    await service.callback('paid', {});
    provider.refund.mockRejectedValue(new Error('timeout'));
    await expect(service.requestRefund(f.payment.id, f.staff.id)).rejects.toThrow();
    const [refund] = await db.select().from(refunds);
    const result = {
      mchid: provider.merchantId,
      out_trade_no: f.payment.outTradeNo,
      transaction_id: f.transaction.transaction_id!,
      out_refund_no: refund!.outRefundNo,
      refund_id: 'refund-state-test',
      status: 'ABNORMAL' as const,
      amount: { total: 2500, refund: 2500 },
    };
    event = { id: randomUUID(), eventType: 'REFUND.ABNORMAL', refund: result };
    await service.callback('abnormal', {});
    expect((await db.select().from(refunds))[0]?.status).toBe('ABNORMAL');
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]?.status).toBe(
      'REFUNDING',
    );
    event = {
      id: randomUUID(),
      eventType: 'REFUND.CLOSED',
      refund: { ...result, status: 'CLOSED' },
    };
    await service.callback('closed', {});
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]?.status).toBe(
      'PAID',
    );
    event = {
      id: randomUUID(),
      eventType: 'REFUND.SUCCESS',
      refund: { ...result, status: 'SUCCESS' },
    };
    await expect(service.callback('conflict', {})).rejects.toMatchObject({
      code: 'INVALID_REFUND_STATE',
    });
    expect(await db.select().from(paymentLedger)).toHaveLength(1);
  });
  it('provider-side refund without a local refund is a discrepancy, not MATCHED', async () => {
    const f = await fixture();
    provider.query.mockResolvedValue({ ...f.transaction, trade_state: 'REFUND' });

    expect((await service.reconcile(f.payment.id, f.staff.id)).outcome).toBe('REVIEW_REQUIRED');

    const [order] = await db.select().from(orders).where(eq(orders.id, f.order.id));
    const [payment] = await db.select().from(payments).where(eq(payments.id, f.payment.id));

    expect(order?.status).toBe('UNPAID');
    expect(payment?.reviewRequired).toBe(true);
  });
  it('reconciliation recovers missed success and records failures without changing money', async () => {
    const f = await fixture();
    provider.query.mockResolvedValue(f.transaction);
    expect((await service.reconcile(f.payment.id, f.staff.id)).outcome).toBe('MATCHED');
    expect((await db.select().from(orders).where(eq(orders.id, f.order.id)))[0]?.status).toBe(
      'PAID',
    );
    provider.query.mockRejectedValue(new Error('timeout'));
    expect((await service.reconcile(f.payment.id, f.staff.id)).outcome).toBe('FAILED');
    expect(await db.select().from(reconciliationItems)).toHaveLength(2);
    expect(await db.select().from(paymentLedger)).toHaveLength(1);
  });
});
