import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingWithdrawal,
  persistPendingWithdrawal,
  readPendingWithdrawal,
  withdrawalAmountMinor,
} from './withdrawal-retry';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const stored = new Map<string, unknown>();

beforeEach(() => {
  stored.clear();
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => stored.get(key),
    setStorageSync: (key: string, value: unknown) => stored.set(key, value),
    removeStorageSync: (key: string) => stored.delete(key),
  });
});

describe('pending commission withdrawals survive ambiguous HTTP results', () => {
  it('parses yuan precisely and rejects hidden rounding or exponent amounts', () => {
    expect(withdrawalAmountMinor('10')).toBe(1000);
    expect(withdrawalAmountMinor('10.50')).toBe(1050);
    expect(withdrawalAmountMinor('0.01')).toBe(1);
    for (const invalid of ['0', '10.005', '1e2', '-1', '1.', '.5', '21474836.48']) {
      expect(withdrawalAmountMinor(invalid)).toBeNull();
    }
  });

  it('persists the same request key across reloads without leaking to other users', () => {
    const pending = { amountMinor: 1200, clientRequestId: 'unique-request-1' };
    persistPendingWithdrawal(first, pending);
    expect(readPendingWithdrawal(first)).toEqual(pending);
    expect(readPendingWithdrawal(second)).toBeNull();
    persistPendingWithdrawal(first, pending);
    expect(readPendingWithdrawal(first)).toEqual(pending);
  });

  it('will not replace an unconfirmed amount or key', () => {
    persistPendingWithdrawal(first, { amountMinor: 1200, clientRequestId: 'unique-request-1' });
    expect(() =>
      persistPendingWithdrawal(first, {
        amountMinor: 1200,
        clientRequestId: 'unique-request-2',
      }),
    ).toThrow('PENDING_WITHDRAWAL_CONFLICT');
    expect(() =>
      persistPendingWithdrawal(first, {
        amountMinor: 1300,
        clientRequestId: 'unique-request-1',
      }),
    ).toThrow('PENDING_WITHDRAWAL_CONFLICT');
  });

  it('removes only a confirmed exact key and fails closed on corruption', () => {
    persistPendingWithdrawal(first, { amountMinor: 1200, clientRequestId: 'unique-request-1' });
    expect(() => clearPendingWithdrawal(first, 'another-request')).toThrow(
      'PENDING_WITHDRAWAL_CONFLICT',
    );
    expect(readPendingWithdrawal(first)?.amountMinor).toBe(1200);
    clearPendingWithdrawal(first, 'unique-request-1');
    expect(readPendingWithdrawal(first)).toBeNull();
    stored.set(`xiaohai.commission.pending-withdrawal.${first}`, { amountMinor: -1 });
    expect(() => readPendingWithdrawal(first)).toThrow('PENDING_WITHDRAWAL_INVALID');
    expect(() =>
      persistPendingWithdrawal(first, { amountMinor: 1200, clientRequestId: 'new-key-123' }),
    ).toThrow('PENDING_WITHDRAWAL_INVALID');
  });
});
