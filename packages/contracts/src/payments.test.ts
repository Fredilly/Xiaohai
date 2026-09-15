import { describe, expect, it } from 'vitest';
import { createPaymentRequestSchema, refundRequestSchema } from './payments.js';
describe('payment authority contracts', () => {
  const id = '9cf27b2f-5255-48da-999f-d638ec529ede';
  it('accepts only a server-owned order reference, never price or identity', () => {
    expect(createPaymentRequestSchema.safeParse({ orderId: id }).success).toBe(true);
    for (const extra of [
      { amountMinor: 1 },
      { openid: 'other' },
      { consumerId: id },
      { store_id: id },
    ]) {
      expect(createPaymentRequestSchema.safeParse({ orderId: id, ...extra }).success).toBe(false);
    }
  });
  it('full refunds do not accept client amount or status', () => {
    expect(refundRequestSchema.safeParse({ paymentId: id }).success).toBe(true);
    expect(refundRequestSchema.safeParse({ paymentId: id, amountMinor: 1 }).success).toBe(false);
    expect(refundRequestSchema.safeParse({ paymentId: id, status: 'SUCCEEDED' }).success).toBe(
      false,
    );
  });
});
