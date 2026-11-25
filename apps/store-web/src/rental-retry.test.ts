import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRentalActionKey,
  getOrCreateRentalActionKey,
  pendingRentalActionKey,
} from './rental-retry';

const staff = '11111111-1111-4111-8111-111111111111';
const otherStaff = '22222222-2222-4222-8222-222222222222';
const store = '33333333-3333-4333-8333-333333333333';
const otherStore = '44444444-4444-4444-8444-444444444444';
const rental = '55555555-5555-4555-8555-555555555555';
const values = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => values.set(key, value));
const removeItem = vi.fn((key: string) => values.delete(key));

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem,
    removeItem,
  });
});

describe('store rental action retries', () => {
  it('persists one request key for reload and isolates staff, stores and action types', () => {
    const first = getOrCreateRentalActionKey(staff, store, rental, 'borrow');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOrCreateRentalActionKey(staff, store, rental, 'borrow')).toBe(first);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(pendingRentalActionKey(otherStaff, store, rental, 'borrow')).toBeNull();
    expect(pendingRentalActionKey(staff, otherStore, rental, 'borrow')).toBeNull();
    expect(pendingRentalActionKey(staff, store, rental, 'return')).toBeNull();
  });

  it('only clears a matching confirmed key, never a different pending action', () => {
    const key = getOrCreateRentalActionKey(staff, store, rental, 'return');
    expect(() => clearRentalActionKey(staff, store, rental, 'return', otherStaff)).toThrow(
      'RENTAL_ACTION_KEY_CONFLICT',
    );
    expect(pendingRentalActionKey(staff, store, rental, 'return')).toBe(key);
    clearRentalActionKey(staff, store, rental, 'return', key);
    expect(pendingRentalActionKey(staff, store, rental, 'return')).toBeNull();
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a corrupt key or storage failure', () => {
    const key = getOrCreateRentalActionKey(staff, store, rental, 'borrow');
    const storageName = [...values.keys()][0];
    if (!storageName) throw new Error('Expected a stored action key');
    values.set(storageName, 'invalid');
    expect(() => getOrCreateRentalActionKey(staff, store, rental, 'borrow')).toThrow(
      'RENTAL_ACTION_KEY_INVALID',
    );
    expect(() => clearRentalActionKey(staff, store, rental, 'borrow', key)).toThrow(
      'RENTAL_ACTION_KEY_INVALID',
    );
    values.clear();
    setItem.mockImplementationOnce(() => {
      throw new Error('storage blocked');
    });
    expect(() => getOrCreateRentalActionKey(staff, store, rental, 'borrow')).toThrow(
      'storage blocked',
    );
  });

  it('rejects malformed identity before storage reads or writes', () => {
    expect(() => getOrCreateRentalActionKey('wrong', store, rental, 'borrow')).toThrow(
      'INVALID_RENTAL_CONTEXT',
    );
    expect(values.size).toBe(0);
  });
});
