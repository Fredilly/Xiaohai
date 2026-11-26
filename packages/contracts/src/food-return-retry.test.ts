import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFoodReturnResponse,
  clearFoodReturn,
  pendingFoodReturn,
  reserveFoodReturn,
} from './food-return-retry.js';

const staff = '66666666-6666-4666-8666-666666666666';
const otherStaff = '77777777-7777-4777-8777-777777777777';
const store = '11111111-1111-4111-8111-111111111111';
const otherStore = '33333333-3333-4333-8333-333333333333';
const order = '55555555-5555-4555-8555-555555555555';
const reservation = '22222222-2222-4222-8222-222222222222';
const key = '44444444-4444-4444-8444-444444444444';
const input = {
  reservationId: reservation,
  quantity: 2,
  reason: 'Synthetic physical receipt',
  sourceRef: 'test:return:001',
  idempotencyKey: key,
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

describe('physical return uncertain POST idempotency (#208)', () => {
  it('keeps original request and order through remounts and retry', () => {
    const first = reserveFoodReturn(staff, store, order, input);
    expect(pendingFoodReturn(staff, store)).toEqual(first);
    expect(
      reserveFoodReturn(staff, store, order, { ...input, idempotencyKey: crypto.randomUUID() }),
    ).toEqual(first);
    clearFoodReturn(staff, store, key);
    expect(pendingFoodReturn(staff, store)).toBeNull();
  });

  it('blocks different amount, reservation, source evidence or order after a lost response', () => {
    reserveFoodReturn(staff, store, order, input);
    expect(() => reserveFoodReturn(staff, store, order, { ...input, quantity: 3 })).toThrow(
      '未确认',
    );
    expect(() =>
      reserveFoodReturn(staff, store, order, { ...input, reservationId: otherStore }),
    ).toThrow('未确认');
    expect(() =>
      reserveFoodReturn(staff, store, order, { ...input, sourceRef: 'test:return:002' }),
    ).toThrow('未确认');
    expect(() => reserveFoodReturn(staff, store, reservation, input)).toThrow('未确认');
    expect(() => clearFoodReturn(staff, store, reservation)).toThrow('请求键发生冲突');
  });

  it('isolates pending records by staff and store without storing any token', () => {
    reserveFoodReturn(staff, store, order, input);
    expect(pendingFoodReturn(otherStaff, store)).toBeNull();
    expect(pendingFoodReturn(staff, otherStore)).toBeNull();
    expect(JSON.stringify([...entries.values()])).not.toContain('Bearer');
  });

  it('fails closed on corrupted, inflated or altered records', () => {
    reserveFoodReturn(staff, store, order, input);
    const k = [...entries.keys()][0]!;
    entries.set(k, 'not-json');
    expect(() => pendingFoodReturn(staff, store)).toThrow('记录无效');
    entries.set(k, JSON.stringify({ orderId: order, input: { ...input, token: 'secret' } }));
    expect(() => pendingFoodReturn(staff, store)).toThrow('记录无效');
    entries.set(k, JSON.stringify({ storeId: otherStore, orderId: order, input }));
    expect(() => pendingFoodReturn(staff, store)).toThrow('记录无效');
    entries.set(k, 'x'.repeat(9000));
    expect(() => pendingFoodReturn(staff, store)).toThrow('记录无效');
  });

  it('blocks POST when browser session storage cannot persist a request', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(() => reserveFoodReturn(staff, store, order, input)).toThrow('已停止提交');
  });

  it('refuses to clear the key on a malformed 2xx result', () => {
    reserveFoodReturn(staff, store, order, input);
    expect(() => assertFoodReturnResponse({ replayed: false })).toThrow();
    expect(() =>
      assertFoodReturnResponse({ returnedBatchId: reservation, replayed: false }),
    ).not.toThrow();
    expect(pendingFoodReturn(staff, store)?.input.idempotencyKey).toBe(key);
  });
});
