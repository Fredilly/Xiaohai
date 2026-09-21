import { describe, expect, it } from 'vitest';
import {
  createFinanceReconciliationRunRequestSchema,
  financeExportRequestSchema,
  financeLedgerEntrySchema,
  financeLedgerListQuerySchema,
} from './finance.js';

const paymentLedgerId = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';

describe('M21 finance contracts', () => {
  it('parses bounded ledger filters and rejects reversed ranges', () => {
    expect(
      financeLedgerListQuerySchema.parse({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-21T00:00:00.000Z',
        sourceKind: 'PAYMENT_LEDGER',
        limit: '25',
      }),
    ).toMatchObject({ sourceKind: 'PAYMENT_LEDGER', limit: 25 });

    expect(
      financeLedgerListQuerySchema.safeParse({
        from: '2026-09-21T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('enforces source shape and a non-zero finance movement', () => {
    const base = {
      id: entryId,
      eventKey: 'payment:source-event',
      sourceKind: 'PAYMENT_LEDGER' as const,
      paymentLedgerId,
      commissionEventId: null,
      eventType: 'PAYMENT' as const,
      currency: 'CNY' as const,
      cashDeltaMinor: 1000,
      commissionFrozenDeltaMinor: 0,
      commissionAvailableDeltaMinor: 0,
      occurredAt: '2026-09-21T00:00:00.000Z',
      createdAt: '2026-09-21T00:00:00.000Z',
    };

    expect(financeLedgerEntrySchema.parse(base).cashDeltaMinor).toBe(1000);
    expect(
      financeLedgerEntrySchema.safeParse({
        ...base,
        paymentLedgerId: null,
        commissionEventId: paymentLedgerId,
      }).success,
    ).toBe(false);
    expect(
      financeLedgerEntrySchema.safeParse({
        ...base,
        cashDeltaMinor: 0,
      }).success,
    ).toBe(false);
  });

  it('keeps reconciliation and export requests strict and time-bounded', () => {
    const range = {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-21T00:00:00.000Z',
    };

    expect(createFinanceReconciliationRunRequestSchema.parse(range)).toEqual(range);
    expect(financeExportRequestSchema.parse(range)).toEqual(range);
    expect(
      financeExportRequestSchema.safeParse({ ...range, consumerUserId: paymentLedgerId }).success,
    ).toBe(false);
  });
});
