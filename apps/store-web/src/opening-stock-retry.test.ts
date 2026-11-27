import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertOpeningStockResponse,
  clearOpeningStock,
  pendingOpeningStock,
  reserveOpeningStock,
} from './opening-stock-retry';

const staff = '66666666-6666-4666-8666-666666666666';
const otherStaff = '77777777-7777-4777-8777-777777777777';
const store = '11111111-1111-4111-8111-111111111111';
const otherStore = '33333333-3333-4333-8333-333333333333';
const sku = '22222222-2222-4222-8222-222222222222';
const key = '44444444-4444-4444-8444-444444444444';
const input = {
  storeId: store,
  skuId: sku,
  initialQuantity: 3,
  reason: 'Synthetic stock opening',
  idempotencyKey: key,
};
const skuCode = 'SYNTHETIC-SKU-001';

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

describe('first store stock count can recover without duplicate writes (#208)', () => {
  it('retains an exact positive-count request across remounts and isolates staff/store', () => {
    const first = reserveOpeningStock(staff, store, skuCode, input);
    expect(pendingOpeningStock(staff, store)).toEqual(first);
    expect(
      reserveOpeningStock(staff, store, skuCode, { ...input, idempotencyKey: crypto.randomUUID() }),
    ).toEqual(first);
    expect(pendingOpeningStock(otherStaff, store)).toBeNull();
    expect(pendingOpeningStock(staff, otherStore)).toBeNull();
    expect(JSON.stringify([...entries.values()])).not.toContain('Bearer');
  });

  it('blocks changed SKU, code, quantity, reason and store before new POST', () => {
    reserveOpeningStock(staff, store, skuCode, input);
    expect(() =>
      reserveOpeningStock(staff, store, skuCode, { ...input, initialQuantity: 4 }),
    ).toThrow('尚未确认');
    expect(() =>
      reserveOpeningStock(staff, store, skuCode, { ...input, skuId: otherStore }),
    ).toThrow('尚未确认');
    expect(() =>
      reserveOpeningStock(staff, store, skuCode, { ...input, reason: 'Changed' }),
    ).toThrow('尚未确认');
    expect(() => reserveOpeningStock(staff, store, 'OTHER-CODE', input)).toThrow('尚未确认');
    expect(() => reserveOpeningStock(staff, otherStore, skuCode, input)).toThrow('门店不符');
    expect(() => clearOpeningStock(staff, store, otherStore)).toThrow('请求键冲突');
  });

  it('retains a zero count for read-only reconciliation and never treats a new key as original', () => {
    const zero = { ...input, initialQuantity: 0 };
    reserveOpeningStock(staff, store, skuCode, zero);
    expect(pendingOpeningStock(staff, store)?.input.initialQuantity).toBe(0);
    expect(() => reserveOpeningStock(staff, store, skuCode, input)).toThrow('尚未确认');
    expect(
      assertOpeningStockResponse(zero, { storeId: store, skuId: sku, onHand: 0, version: 0 }),
    ).toMatchObject({ onHand: 0 });
    clearOpeningStock(staff, store, key);
    expect(pendingOpeningStock(staff, store)).toBeNull();
  });

  it('rejects malformed or another-SKU success responses before clearing', () => {
    reserveOpeningStock(staff, store, skuCode, input);
    expect(() =>
      assertOpeningStockResponse(input, {
        storeId: store,
        skuId: otherStore,
        onHand: 3,
        version: 1,
      }),
    ).toThrow('OPENING_STOCK_RESPONSE_MISMATCH');
    expect(() =>
      assertOpeningStockResponse(input, { storeId: store, skuId: sku, onHand: 4, version: 1 }),
    ).toThrow('OPENING_STOCK_RESPONSE_MISMATCH');
    expect(() => assertOpeningStockResponse(input, { storeId: store, skuId: sku })).toThrow();
    expect(pendingOpeningStock(staff, store)?.input.idempotencyKey).toBe(key);
  });

  it('fails closed for invalid, oversized or altered browser storage', () => {
    reserveOpeningStock(staff, store, skuCode, input);
    const k = [...entries.keys()][0]!;
    entries.set(k, '{broken');
    expect(() => pendingOpeningStock(staff, store)).toThrow('记录无效');
    entries.set(k, JSON.stringify({ skuCode, input: { ...input, storeId: otherStore } }));
    expect(() => pendingOpeningStock(staff, store)).toThrow('记录无效');
    entries.set(k, JSON.stringify({ skuCode, input: { ...input, token: 'secret' } }));
    expect(() => pendingOpeningStock(staff, store)).toThrow('记录无效');
    entries.set(k, 'x'.repeat(9000));
    expect(() => pendingOpeningStock(staff, store)).toThrow('记录无效');
  });

  it('stops before POST when browser storage silently loses the write', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(() => reserveOpeningStock(staff, store, skuCode, input)).toThrow('阻止写入');
  });
});
