import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertInventoryMutationResponse,
  clearInventoryMutation,
  pendingInventoryMutation,
  reserveInventoryMutation,
} from './inventory-mutation-retry';

const staff = '66666666-6666-4666-8666-666666666666';
const otherStaff = '77777777-7777-4777-8777-777777777777';
const store = '11111111-1111-4111-8111-111111111111';
const otherStore = '33333333-3333-4333-8333-333333333333';
const sku = '22222222-2222-4222-8222-222222222222';
const key = '44444444-4444-4444-8444-444444444444';
const input = {
  storeId: store,
  skuId: sku,
  quantity: 2,
  expectedVersion: 1,
  idempotencyKey: key,
  reason: 'Synthetic issue',
};
const response = {
  id: '55555555-5555-4555-8555-555555555555',
  storeId: store,
  skuId: sku,
  idempotencyKey: key,
  transactionType: 'ISSUE',
  quantityDelta: -2,
  balanceAfter: 3,
  referenceType: 'STOCK_ISSUE',
  referenceId: '88888888-8888-4888-8888-888888888888',
  reason: 'Synthetic issue',
  createdByStaffAccountId: staff,
  createdAt: '2026-11-26T00:00:00.000Z',
};

let entries: Map<string, string>;
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => entries.set(k, v),
    removeItem: (k: string) => entries.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('store stock changes recover their exact server-idempotent request (#208)', () => {
  it('persists exact ISSUE body across remounts and isolates store/staff', () => {
    const first = reserveInventoryMutation(staff, store, 'ISSUE', input);
    expect(pendingInventoryMutation(staff, store)).toEqual(first);
    expect(
      reserveInventoryMutation(staff, store, 'ISSUE', {
        ...input,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toEqual(first);
    expect(pendingInventoryMutation(otherStaff, store)).toBeNull();
    expect(pendingInventoryMutation(staff, otherStore)).toBeNull();
    expect(JSON.stringify([...entries.values()])).not.toContain('Bearer');
  });

  it('rejects a changed count, SKU, version, reason, operation or store', () => {
    reserveInventoryMutation(staff, store, 'ISSUE', input);
    expect(() =>
      reserveInventoryMutation(staff, store, 'ISSUE', { ...input, quantity: 3 }),
    ).toThrow('只允许');
    expect(() =>
      reserveInventoryMutation(staff, store, 'ISSUE', { ...input, skuId: otherStore }),
    ).toThrow('只允许');
    expect(() =>
      reserveInventoryMutation(staff, store, 'ISSUE', { ...input, expectedVersion: 2 }),
    ).toThrow('只允许');
    expect(() =>
      reserveInventoryMutation(staff, store, 'ISSUE', { ...input, reason: 'Changed' }),
    ).toThrow('只允许');
    expect(() =>
      reserveInventoryMutation(staff, store, 'ADJUST', {
        storeId: store,
        skuId: sku,
        quantityDelta: -2,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Synthetic issue',
      }),
    ).toThrow('只允许');
    expect(() => reserveInventoryMutation(staff, otherStore, 'ISSUE', input)).toThrow('门店不符');
    expect(() => clearInventoryMutation(staff, store, otherStore)).toThrow('请求键冲突');
  });

  it('preserves positive and negative adjustments with different transaction types', () => {
    const positive = reserveInventoryMutation(staff, store, 'ADJUST', {
      storeId: store,
      skuId: sku,
      quantityDelta: 4,
      expectedVersion: 1,
      idempotencyKey: key,
      reason: 'Synthetic increase',
    });
    expect(
      assertInventoryMutationResponse(positive, staff, {
        ...response,
        transactionType: 'ADJUSTMENT_IN',
        referenceType: 'INVENTORY_ADJUSTMENT',
        quantityDelta: 4,
        balanceAfter: 9,
        reason: 'Synthetic increase',
      }).quantityDelta,
    ).toBe(4);
    clearInventoryMutation(staff, store, key);
    const negative = reserveInventoryMutation(staff, store, 'ADJUST', {
      ...positive.input,
      quantityDelta: -3,
    });
    expect(
      assertInventoryMutationResponse(negative, staff, {
        ...response,
        transactionType: 'ADJUSTMENT_OUT',
        referenceType: 'INVENTORY_ADJUSTMENT',
        quantityDelta: -3,
        balanceAfter: 2,
        reason: 'Synthetic increase',
      }).quantityDelta,
    ).toBe(-3);
  });

  it('requires an exact authoritative inventory ledger before clearing', () => {
    reserveInventoryMutation(staff, store, 'ISSUE', input);
    expect(assertInventoryMutationResponse({ operation: 'ISSUE', input }, staff, response).id).toBe(
      response.id,
    );
    expect(() =>
      assertInventoryMutationResponse({ operation: 'ISSUE', input }, staff, {
        ...response,
        skuId: otherStore,
      }),
    ).toThrow('MISMATCH');
    expect(() =>
      assertInventoryMutationResponse({ operation: 'ISSUE', input }, staff, {
        ...response,
        idempotencyKey: otherStore,
      }),
    ).toThrow('MISMATCH');
    expect(() =>
      assertInventoryMutationResponse({ operation: 'ISSUE', input }, staff, {
        ...response,
        createdByStaffAccountId: otherStaff,
      }),
    ).toThrow('MISMATCH');
    expect(() =>
      assertInventoryMutationResponse({ operation: 'ISSUE', input }, staff, {
        ...response,
        quantityDelta: -3,
      }),
    ).toThrow('MISMATCH');
    expect(pendingInventoryMutation(staff, store)?.input.idempotencyKey).toBe(key);
  });

  it('rejects corrupted, oversized, foreign-scope or unrecognized saved requests', () => {
    reserveInventoryMutation(staff, store, 'ISSUE', input);
    const k = [...entries.keys()][0]!;
    entries.set(k, '{broken');
    expect(() => pendingInventoryMutation(staff, store)).toThrow('记录无效');
    entries.set(
      k,
      JSON.stringify({ operation: 'ISSUE', input: { ...input, storeId: otherStore } }),
    );
    expect(() => pendingInventoryMutation(staff, store)).toThrow('记录无效');
    entries.set(k, JSON.stringify({ operation: 'ISSUE', input: { ...input, token: 'private' } }));
    expect(() => pendingInventoryMutation(staff, store)).toThrow('记录无效');
    entries.set(k, 'x'.repeat(9000));
    expect(() => pendingInventoryMutation(staff, store)).toThrow('记录无效');
  });

  it('fails before POST when sessionStorage silently drops the saved key', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(() => reserveInventoryMutation(staff, store, 'ISSUE', input)).toThrow('阻止写入');
  });
});
