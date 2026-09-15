import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  orders,
  payments,
  paymentCallbacks,
  paymentLedger,
  refunds,
  reconciliationRuns,
  reconciliationItems,
  wechatIdentities,
  type createDatabase,
} from '@xiaohai/db';
import {
  PaymentError,
  type PayNotification,
  type PayTransaction,
  type RefundResult,
  type WeChatPayProvider,
} from './wechat-pay.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Payment = typeof payments.$inferSelect;
type Refund = typeof refunds.$inferSelect;
const businessNumber = () => randomUUID().replaceAll('-', '');

export class PaymentService {
  constructor(
    private readonly db: Db,
    readonly provider: WeChatPayProvider,
  ) {}

  async create(consumerId: string, orderId: string) {
    this.provider.assertConfigured();
    const payment = await this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.consumerUserId, consumerId)))
        .for('update');
      if (!order) throw new PaymentError('NOT_FOUND', 404);
      if (order.status !== 'UNPAID' || order.totalMinor <= 0)
        throw new PaymentError('INVALID_ORDER_STATE');
      const [existing] = await tx.select().from(payments).where(eq(payments.orderId, orderId));
      if (existing) {
        this.checkConfiguration(existing);
        if (existing.status !== 'PENDING') throw new PaymentError('INVALID_PAYMENT_STATE');
        return existing;
      }
      const [created] = await tx
        .insert(payments)
        .values({
          orderId,
          appId: this.provider.appId,
          merchantId: this.provider.merchantId,
          outTradeNo: businessNumber(),
          amountMinor: order.totalMinor,
        })
        .returning();
      return created!;
    });
    const [identity] = await this.db
      .select({ openid: wechatIdentities.openid })
      .from(wechatIdentities)
      .where(
        and(
          eq(wechatIdentities.consumerUserId, consumerId),
          eq(wechatIdentities.appId, payment.appId),
        ),
      );
    if (!identity) throw new PaymentError('WECHAT_IDENTITY_REQUIRED', 409);
    // Persist the merchant number before I/O. Unknown outcomes retry the SAME number.
    const parameters = await this.provider.create({
      outTradeNo: payment.outTradeNo,
      amountMinor: payment.amountMinor,
      openid: identity.openid,
    });
    return { paymentId: payment.id, parameters };
  }

  async list() {
    return (await this.db.select().from(payments).orderBy(desc(payments.createdAt)).limit(100)).map(
      paymentView,
    );
  }

  async callback(raw: string, headers: Record<string, string | string[] | undefined>) {
    this.provider.assertConfigured();
    const event = this.provider.notification(raw, headers);
    const hash = createHash('sha256').update(raw).digest('hex');
    const outTradeNo = event.transaction?.out_trade_no ?? event.refund?.out_trade_no;
    const payment = await this.byTradeNo(outTradeNo ?? '');
    return this.db.transaction(async (tx) => {
      const { payment: locked, order } = await this.lock(tx, payment);
      const [inserted] = await tx
        .insert(paymentCallbacks)
        .values({ id: event.id, bodyHash: hash, eventType: event.eventType, paymentId: payment.id })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const [prior] = await tx
          .select()
          .from(paymentCallbacks)
          .where(eq(paymentCallbacks.id, event.id));
        if (prior?.bodyHash !== hash || prior.paymentId !== payment.id)
          throw new PaymentError('CALLBACK_CONFLICT');
        return { reviewRequired: locked.reviewRequired };
      }
      await this.applyEvent(tx, locked, order, event);
      return { reviewRequired: order.status === 'CANCELLED' || locked.reviewRequired };
    });
  }

  async requestRefund(paymentId: string, staffId: string) {
    this.provider.assertConfigured();
    const payment = await this.byId(paymentId);
    const refund = await this.db.transaction(async (tx) => {
      const { payment: locked, order } = await this.lock(tx, payment);
      const [existing] = await tx.select().from(refunds).where(eq(refunds.paymentId, paymentId));
      if (existing) return existing;
      if (locked.status !== 'SUCCEEDED' || !['PAID', 'CANCELLED'].includes(order.status))
        throw new PaymentError('INVALID_REFUND_STATE');
      const [created] = await tx
        .insert(refunds)
        .values({
          paymentId,
          outRefundNo: businessNumber(),
          amountMinor: locked.amountMinor,
          requestedBy: staffId,
          originalOrderStatus: order.status,
        })
        .returning();
      if (order.status === 'PAID')
        await tx
          .update(orders)
          .set({ status: 'REFUNDING', updatedAt: new Date() })
          .where(eq(orders.id, order.id));
      return created!;
    });
    if (refund.status !== 'PENDING') return refundView(refund);
    // A timeout is not a rejection. Preserve PENDING for retry/query with the same refund number.
    const result = await this.provider.refund({
      outTradeNo: payment.outTradeNo,
      outRefundNo: refund.outRefundNo,
      amountMinor: refund.amountMinor,
    });
    await this.db.transaction(async (tx) => {
      const locked = await this.lock(tx, payment);
      await this.applyRefund(tx, locked.payment, locked.order, result);
    });
    const [updated] = await this.db.select().from(refunds).where(eq(refunds.id, refund.id));
    return refundView(updated!);
  }

  async reconcile(paymentId: string, staffId: string) {
    this.provider.assertConfigured();
    const payment = await this.byId(paymentId);
    const [run] = await this.db
      .insert(reconciliationRuns)
      .values({ requestedBy: staffId })
      .returning();
    let outcome = 'FAILED';
    try {
      const transaction = await this.provider.query(payment.outTradeNo);
      await this.db.transaction(async (tx) => {
        const locked = await this.lock(tx, payment);
        await this.applyTransaction(tx, locked.payment, locked.order, transaction);
      });
      const [refund] = await this.db.select().from(refunds).where(eq(refunds.paymentId, paymentId));
      if (refund) {
        const result = await this.provider.queryRefund(refund.outRefundNo);
        await this.db.transaction(async (tx) => {
          const locked = await this.lock(tx, payment);
          await this.applyRefund(tx, locked.payment, locked.order, result);
        });
      }
      const updated = await this.byId(paymentId);
      const [updatedRefund] = await this.db
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, paymentId));
      outcome =
        updated.reviewRequired ||
        updatedRefund?.status === 'ABNORMAL' ||
        (transaction.trade_state === 'REFUND' && !updatedRefund)
          ? 'REVIEW_REQUIRED'
          : updated.status === 'PENDING' ||
              (updatedRefund && ['PENDING', 'PROCESSING'].includes(updatedRefund.status))
            ? 'PENDING'
            : 'MATCHED';
    } catch {
      // Persist a redacted failure. Never silently acknowledge a mismatch as paid.
      outcome = 'FAILED';
    }
    await this.db.insert(reconciliationItems).values({ runId: run!.id, paymentId, outcome });
    return { runId: run!.id, outcome };
  }

  private checkConfiguration(payment: Payment) {
    if (payment.appId !== this.provider.appId || payment.merchantId !== this.provider.merchantId)
      throw new PaymentError('PAYMENT_CONFIGURATION_MISMATCH', 503);
  }
  private async byId(id: string) {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, id));
    if (!payment) throw new PaymentError('NOT_FOUND', 404);
    this.checkConfiguration(payment);
    return payment;
  }
  private async byTradeNo(number: string) {
    const [payment] = await this.db.select().from(payments).where(eq(payments.outTradeNo, number));
    if (!payment) throw new PaymentError('NOT_FOUND', 404);
    this.checkConfiguration(payment);
    return payment;
  }
  private async lock(tx: Tx, payment: Payment) {
    // Global lock order: order -> payment -> refund. M5 cancellation's guarded UPDATE serializes here.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .for('update');
    const [locked] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, payment.id))
      .for('update');
    if (!order || !locked || order.totalMinor !== locked.amountMinor)
      throw new PaymentError('PAYMENT_AMOUNT_MISMATCH');
    return { order, payment: locked };
  }
  private async applyEvent(
    tx: Tx,
    payment: Payment,
    order: typeof orders.$inferSelect,
    event: PayNotification,
  ) {
    if (event.transaction) await this.applyTransaction(tx, payment, order, event.transaction);
    else if (event.refund) await this.applyRefund(tx, payment, order, event.refund);
    else throw new PaymentError('PAYMENT_NOTIFICATION_INVALID', 400);
  }
  private async applyTransaction(
    tx: Tx,
    payment: Payment,
    order: typeof orders.$inferSelect,
    result: PayTransaction,
  ) {
    if (
      result.appid !== payment.appId ||
      result.mchid !== payment.merchantId ||
      result.out_trade_no !== payment.outTradeNo ||
      result.amount.total !== payment.amountMinor ||
      result.amount.currency !== 'CNY'
    )
      throw new PaymentError('PAYMENT_DETAILS_MISMATCH');
    if (result.trade_state === 'SUCCESS' || result.trade_state === 'REFUND') {
      if (
        !result.transaction_id ||
        payment.status === 'CLOSED' ||
        (payment.providerTransactionId && payment.providerTransactionId !== result.transaction_id)
      )
        throw new PaymentError('PAYMENT_TRANSACTION_CONFLICT');
      if (payment.status === 'SUCCEEDED') return;
      const reviewRequired = order.status !== 'UNPAID';
      await tx
        .update(payments)
        .set({
          status: 'SUCCEEDED',
          providerTransactionId: result.transaction_id,
          reviewRequired,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      if (order.status === 'UNPAID')
        await tx
          .update(orders)
          .set({ status: 'PAID', updatedAt: new Date() })
          .where(eq(orders.id, order.id));
      // Late payment on CANCELLED stays CANCELLED and is flagged for controlled full refund.
      await tx.insert(paymentLedger).values({
        paymentId: payment.id,
        eventKey: `payment:${payment.id}`,
        kind: 'PAYMENT',
        amountMinor: payment.amountMinor,
      });
    } else if (['CLOSED', 'REVOKED'].includes(result.trade_state)) {
      if (payment.status === 'SUCCEEDED') throw new PaymentError('PAYMENT_TRANSACTION_CONFLICT');
      await tx
        .update(payments)
        .set({ status: 'CLOSED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    } else if (payment.status !== 'PENDING') throw new PaymentError('PAYMENT_TRANSACTION_CONFLICT');
  }
  private async applyRefund(
    tx: Tx,
    payment: Payment,
    order: typeof orders.$inferSelect,
    result: RefundResult,
  ) {
    const [refund] = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, payment.id))
      .for('update');
    if (
      !refund ||
      result.out_refund_no !== refund.outRefundNo ||
      result.out_trade_no !== payment.outTradeNo ||
      result.transaction_id !== payment.providerTransactionId ||
      (result.mchid && result.mchid !== payment.merchantId) ||
      result.amount.total !== payment.amountMinor ||
      result.amount.refund !== refund.amountMinor ||
      (result.amount.currency && result.amount.currency !== 'CNY') ||
      (refund.providerRefundId && refund.providerRefundId !== result.refund_id)
    )
      throw new PaymentError('REFUND_DETAILS_MISMATCH');
    const next = result.status === 'SUCCESS' ? 'SUCCEEDED' : result.status;
    if (refund.status === next) return;
    if (['SUCCEEDED', 'CLOSED'].includes(refund.status)) {
      if (next === 'PROCESSING') return; // Older synchronous response after a terminal callback.
      throw new PaymentError('INVALID_REFUND_STATE');
    }
    if (refund.status === 'ABNORMAL' && next === 'PROCESSING') return;
    await tx
      .update(refunds)
      .set({ status: next, providerRefundId: result.refund_id, updatedAt: new Date() })
      .where(eq(refunds.id, refund.id));
    if (next === 'SUCCEEDED') {
      await tx.insert(paymentLedger).values({
        paymentId: payment.id,
        eventKey: `refund:${refund.id}`,
        kind: 'REFUND',
        amountMinor: refund.amountMinor,
      });
      if (order.status === 'REFUNDING')
        await tx
          .update(orders)
          .set({ status: 'REFUNDED', updatedAt: new Date() })
          .where(eq(orders.id, order.id));
      await tx
        .update(payments)
        .set({ reviewRequired: false, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    } else if (next === 'CLOSED' && order.status === 'REFUNDING') {
      await tx
        .update(orders)
        .set({ status: refund.originalOrderStatus, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
    }
  }
}
const refundView = (r: Refund) => ({
  id: r.id,
  paymentId: r.paymentId,
  status: r.status,
  amountMinor: r.amountMinor,
});
const paymentView = (p: Payment) => ({
  id: p.id,
  orderId: p.orderId,
  status: p.status,
  amountMinor: p.amountMinor,
  reviewRequired: p.reviewRequired,
});
