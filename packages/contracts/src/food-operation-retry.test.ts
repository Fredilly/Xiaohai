import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFoodOperationResponse,
  clearFoodOperation,
  pendingFoodOperation,
  reserveFoodOperation,
} from './food-operation-retry.js';

const staff = '66666666-6666-4666-8666-666666666666';
const otherStaff = '77777777-7777-4777-8777-777777777777';
const store = '11111111-1111-4111-8111-111111111111';
const otherStore = '33333333-3333-4333-8333-333333333333';
const sku = '22222222-2222-4222-8222-222222222222';
const batchId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '55555555-5555-4555-8555-555555555555';

const intake = {
  storeId: store,
  skuId: sku,
  expectedInventoryVersion: 2,
  kind: 'PACKAGED_FOOD' as const,
  lotCode: 'LOT-001',
  manufacturedOn: null,
  expiresOn: '2099-12-31',
  quantity: 5,
  reason: 'Synthetic receipt',
  sourceRef: 'test:receipt:1',
  idempotencyKey,
};

const disposition = {
  storeId: store,
  skuId: sku,
  batchId,
  expectedInventoryVersion: 2,
  expectedVersion: 1,
  state: 'HELD' as const,
  reason: 'Synthetic hold',
  sourceRef: 'test:hold:001',
  idempotencyKey,
};

const movement = {
  storeId: store,
  skuId: sku,
  expectedInventoryVersion: 2,
  kind: 'DAMAGE' as const,
  lines: [{ batchId, expectedVersion: 1, quantity: 2 }],
  reason: 'Synthetic damaged',
  idempotencyKey,
};

let entries: Map<string, string>;
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('pending food stock operations survive tab remounts (#208)', () => {
  it.each([
    ['/intake', intake],
    ['/disposition', disposition],
    ['/movements', movement],
  ] as const)('keeps the exact %s payload and original key', (path, input) => {
    const first = reserveFoodOperation(staff, store, path, input);
    expect(pendingFoodOperation(staff, store)).toEqual(first);
    expect(reserveFoodOperation(staff, store, path, input)).toEqual(first);
    expect(JSON.stringify([...entries.values()])).not.toContain('staff-token');
    clearFoodOperation(staff, store, idempotencyKey);
    expect(pendingFoodOperation(staff, store)).toBeNull();
  });

  it('blocks changed quantity, SKU, version and operation when a POST result is unknown', () => {
    reserveFoodOperation(staff, store, '/intake', intake);
    expect(() => reserveFoodOperation(staff, store, '/intake', { ...intake, quantity: 9 })).toThrow(
      '未确认',
    );
    expect(() =>
      reserveFoodOperation(staff, store, '/intake', { ...intake, skuId: batchId }),
    ).toThrow('未确认');
    expect(() =>
      reserveFoodOperation(staff, store, '/intake', { ...intake, expectedInventoryVersion: 3 }),
    ).toThrow('未确认');
    expect(() => reserveFoodOperation(staff, store, '/disposition', disposition)).toThrow('未确认');
    expect(pendingFoodOperation(staff, store)?.input).toEqual(intake);
  });

  it('isolates account/store contexts and refuses cross-store writes', () => {
    reserveFoodOperation(staff, store, '/movements', movement);
    expect(pendingFoodOperation(otherStaff, store)).toBeNull();
    expect(pendingFoodOperation(staff, otherStore)).toBeNull();
    expect(() => reserveFoodOperation(staff, otherStore, '/movements', movement)).toThrow(
      '门店不符',
    );
    expect(() => clearFoodOperation(staff, store, batchId)).toThrow('请求键冲突');
  });

  it('fails closed for malformed or injected session records', () => {
    reserveFoodOperation(staff, store, '/intake', intake);
    const storageKey = [...entries.keys()][0]!;
    entries.set(storageKey, '{broken');
    expect(() => pendingFoodOperation(staff, store)).toThrow('记录无效');
    expect(() => reserveFoodOperation(staff, store, '/intake', intake)).toThrow('记录无效');
    entries.set(
      storageKey,
      JSON.stringify({ path: '/intake', input: { ...intake, token: 'leak' } }),
    );
    expect(() => pendingFoodOperation(staff, store)).toThrow('记录无效');
    entries.set(
      storageKey,
      JSON.stringify({ path: '/intake', input: { ...intake, storeId: otherStore } }),
    );
    expect(() => pendingFoodOperation(staff, store)).toThrow('记录无效');
  });

  it('does not send when storage rejects or silently fails a write', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(() => reserveFoodOperation(staff, store, '/intake', intake)).toThrow('已停止提交');
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('STORAGE_DENIED');
      },
      removeItem: () => undefined,
    });
    expect(() => reserveFoodOperation(staff, store, '/intake', intake)).toThrow('STORAGE_DENIED');
  });

  it('requires a matching, valid response before declaring a stock mutation confirmed', () => {
    const receipt = reserveFoodOperation(staff, store, '/intake', intake);
    const valid = {
      batchId,
      onHandAfter: 5,
      inventoryVersion: 3,
      replayed: false,
    };
    expect(() => assertFoodOperationResponse(receipt, valid)).not.toThrow();
    expect(() => assertFoodOperationResponse(receipt, { replayed: true })).toThrow();
    expect(() => assertFoodOperationResponse(receipt, { ...valid, inventoryVersion: 4 })).toThrow(
      'FOOD_RESULT_MISMATCH',
    );
    clearFoodOperation(staff, store, idempotencyKey);

    const state = reserveFoodOperation(staff, store, '/disposition', disposition);
    const stateResult = {
      batchId,
      state: 'HELD',
      version: 2,
      inventoryVersion: 3,
      replayed: true,
    };
    expect(() => assertFoodOperationResponse(state, stateResult)).not.toThrow();
    expect(() =>
      assertFoodOperationResponse(state, { ...stateResult, state: 'AVAILABLE' }),
    ).toThrow('FOOD_RESULT_MISMATCH');
    clearFoodOperation(staff, store, idempotencyKey);

    const changed = reserveFoodOperation(staff, store, '/movements', movement);
    const moveResult = {
      aggregateTransactionId: batchId,
      balanceAfter: 0,
      version: 3,
      replayed: false,
    };
    expect(() => assertFoodOperationResponse(changed, moveResult)).not.toThrow();
    expect(() => assertFoodOperationResponse(changed, { ...moveResult, version: 4 })).toThrow(
      'FOOD_RESULT_MISMATCH',
    );
  });
});
