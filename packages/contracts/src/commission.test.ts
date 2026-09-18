import { describe, expect, it } from 'vitest';
import {
  createCommissionRuleRequestSchema,
  createWithdrawalRequestSchema,
  reviewWithdrawalRequestSchema,
} from './commission.js';

describe('commission contracts', () => {
  it('keeps policy explicit and strict', () => {
    const input = {
      name: 'Campaign',
      rateBasisPoints: 600,
      freezeDays: 7,
      effectiveFrom: new Date().toISOString(),
    };
    expect(createCommissionRuleRequestSchema.safeParse(input).success).toBe(true);
    expect(createCommissionRuleRequestSchema.safeParse({ ...input, amountMinor: 1 }).success).toBe(
      false,
    );
  });
  it('prevents consumer-controlled withdrawal state', () => {
    expect(
      createWithdrawalRequestSchema.safeParse({
        amountMinor: 100,
        clientRequestId: 'request-123',
        status: 'PAID',
      }).success,
    ).toBe(false);
    expect(reviewWithdrawalRequestSchema.safeParse({ action: 'APPROVE', version: 1 }).success).toBe(
      true,
    );
  });
});
