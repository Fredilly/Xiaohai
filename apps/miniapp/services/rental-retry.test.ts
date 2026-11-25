import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCancellationKey,
  clearRentalKey,
  pendingCancellationKey,
  pendingRentalKey,
  persistCancellationKey,
  persistRentalKey,
} from './rental-retry';

const consumer = '11111111-1111-4111-8111-111111111111';
const otherConsumer = '22222222-2222-4222-8222-222222222222';
const store = '33333333-3333-4333-8333-333333333333';
const sku = '44444444-4444-4444-8444-444444444444';
const request = '55555555-5555-4555-8555-555555555555';
const values = new Map<string, unknown>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
  });
});

describe('rental reservation retries', () => {
  it('preserves the same key across page instances and isolates consumers', () => {
    persistRentalKey(consumer, store, sku, request);
    expect(pendingRentalKey(consumer, store, sku)).toBe(request);
    expect(pendingRentalKey(otherConsumer, store, sku)).toBeNull();
    persistRentalKey(consumer, store, sku, request);
    expect(() => persistRentalKey(consumer, store, sku, otherConsumer)).toThrow(
      'RENTAL_REQUEST_KEY_CONFLICT',
    );
  });

  it('only clears an exact confirmed key and refuses corrupt local state', () => {
    persistRentalKey(consumer, store, sku, request);
    expect(() => clearRentalKey(consumer, store, sku, otherConsumer)).toThrow(
      'RENTAL_REQUEST_KEY_CONFLICT',
    );
    expect(pendingRentalKey(consumer, store, sku)).toBe(request);
    clearRentalKey(consumer, store, sku, request);
    expect(pendingRentalKey(consumer, store, sku)).toBeNull();
    values.set(`xiaohai.rental.pending.${consumer}.${store}.${sku}`, 'not-a-uuid');
    expect(() => pendingRentalKey(consumer, store, sku)).toThrow('RENTAL_REQUEST_KEY_INVALID');
    expect(() => persistRentalKey(consumer, store, sku, request)).toThrow(
      'RENTAL_REQUEST_KEY_INVALID',
    );
  });

  it('rejects malformed identities and request IDs before a local write', () => {
    expect(() => persistRentalKey('other', store, sku, request)).toThrow('INVALID_RENTAL_CONTEXT');
    expect(() => persistRentalKey(consumer, store, sku, 'other')).toThrow(
      'RENTAL_REQUEST_KEY_INVALID',
    );
    expect(values.size).toBe(0);
  });

  it('separately persists cancellation replay keys for each rental', () => {
    persistCancellationKey(consumer, request, sku);
    expect(pendingCancellationKey(consumer, request)).toBe(sku);
    expect(pendingCancellationKey(otherConsumer, request)).toBeNull();
    expect(pendingRentalKey(consumer, store, sku)).toBeNull();
    clearCancellationKey(consumer, request, sku);
    expect(pendingCancellationKey(consumer, request)).toBeNull();
  });
});
