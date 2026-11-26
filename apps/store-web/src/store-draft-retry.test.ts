import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminProductCreateInput } from '@xiaohai/contracts/commerce';
import {
  clearStoreDraftRequest,
  pendingStoreDraft,
  reserveStoreDraftRequest,
} from './store-draft-retry';

const staff = '11111111-1111-4111-8111-111111111111';
const otherStaff = '22222222-2222-4222-8222-222222222222';
const store = '33333333-3333-4333-8333-333333333333';
const otherStore = '44444444-4444-4444-8444-444444444444';
const memory = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => memory.set(key, value));
const removeItem = vi.fn((key: string) => memory.delete(key));

const draft: AdminProductCreateInput = {
  name: '南门绘本',
  description: null,
  coverUrl: null,
  status: 'DRAFT',
  book: {
    title: '南门绘本',
    author: '合成作者',
    publisher: '合成出版社',
    isbn: '9783161484100',
  },
  sku: {
    name: '标准',
    priceMinor: 3650,
    status: 'ACTIVE',
    availableForSale: false,
  },
};

beforeEach(() => {
  memory.clear();
  vi.clearAllMocks();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem,
    removeItem,
  });
});

describe('store catalog draft POST replay across remounts (#208)', () => {
  it('persists the exact draft and request key across form remount and isolates staff/store', () => {
    const first = reserveStoreDraftRequest(staff, store, draft);
    const resumed = pendingStoreDraft(staff, store);
    expect(resumed).toEqual(first);
    expect(reserveStoreDraftRequest(staff, store, draft)).toEqual(first);
    expect(setItem).toHaveBeenCalledOnce();
    expect(pendingStoreDraft(otherStaff, store)).toBeNull();
    expect(pendingStoreDraft(staff, otherStore)).toBeNull();
    expect(JSON.stringify([...memory.values()])).not.toContain('staff-session-token');
  });

  it('blocks changed price, ISBN or product while a network result is unknown', () => {
    const first = reserveStoreDraftRequest(staff, store, draft);
    const changedPrice = { ...draft, sku: { ...draft.sku, priceMinor: 3651 } };
    const changedBook = {
      ...draft,
      book: { ...draft.book!, isbn: '9780306406157' },
    };
    expect(() => reserveStoreDraftRequest(staff, store, changedPrice)).toThrow('恢复原表单');
    expect(() => reserveStoreDraftRequest(staff, store, changedBook)).toThrow('恢复原表单');
    expect(pendingStoreDraft(staff, store)).toEqual(first);
    expect(setItem).toHaveBeenCalledOnce();
  });

  it('clears only a confirmed matching request, so the next draft gets a new key', () => {
    const first = reserveStoreDraftRequest(staff, store, draft);
    expect(() => clearStoreDraftRequest(staff, store, otherStaff)).toThrow('发生冲突');
    expect(pendingStoreDraft(staff, store)).toEqual(first);
    clearStoreDraftRequest(staff, store, first.requestKey);
    expect(pendingStoreDraft(staff, store)).toBeNull();
    const next = reserveStoreDraftRequest(staff, store, draft);
    expect(next.requestKey).not.toBe(first.requestKey);
    expect(removeItem).toHaveBeenCalledOnce();
  });

  it('fails closed before POST when storage denies the write', () => {
    setItem.mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    expect(() => reserveStoreDraftRequest(staff, store, draft)).toThrow('storage unavailable');
    expect(memory.size).toBe(0);
  });

  it('never overwrites a corrupt or contradictory pending record', () => {
    const first = reserveStoreDraftRequest(staff, store, draft);
    const key = [...memory.keys()][0]!;
    memory.set(key, 'not-json');
    expect(() => reserveStoreDraftRequest(staff, store, draft)).toThrow('记录无效');
    memory.set(key, JSON.stringify({ ...first, requestKey: 'not-uuid' }));
    expect(() => pendingStoreDraft(staff, store)).toThrow('记录无效');
    memory.set(key, JSON.stringify({ ...first, input: { ...draft, status: 'ACTIVE' } }));
    expect(() => pendingStoreDraft(staff, store)).toThrow('记录无效');
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('rejects malformed staff/store identity without reading another scope', () => {
    expect(() => pendingStoreDraft('not-a-staff-id', store)).toThrow('上下文无效');
    expect(() => reserveStoreDraftRequest(staff, 'wrong', draft)).toThrow('上下文无效');
    expect(memory.size).toBe(0);
  });
});
