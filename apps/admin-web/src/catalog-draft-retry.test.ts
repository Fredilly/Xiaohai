import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminProductCreateInput } from '@xiaohai/contracts/commerce';
import { clearHqDraft, pendingHqDraft, reserveHqDraft } from './catalog-draft-retry';

const staff = '11111111-1111-4111-8111-111111111111';
const otherStaff = '22222222-2222-4222-8222-222222222222';
const memory = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => memory.set(key, value));
const removeItem = vi.fn((key: string) => memory.delete(key));
const draft: AdminProductCreateInput = {
  name: '总部合成绘本',
  status: 'DRAFT',
  book: { title: '总部合成绘本', author: '作者', isbn: '9783161484100', publisher: null },
  sku: { name: '标准', priceMinor: 1200, status: 'ACTIVE', availableForSale: false },
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

describe('HQ catalog draft recovery and scoped idempotency (#208)', () => {
  it('restores the same key and exact body in the same staff session after form remount', () => {
    const first = reserveHqDraft(staff, draft);
    expect(pendingHqDraft(staff)).toEqual(first);
    expect(reserveHqDraft(staff, draft)).toEqual(first);
    expect(pendingHqDraft(otherStaff)).toBeNull();
    expect(setItem).toHaveBeenCalledOnce();
  });

  it('blocks changed price, book and availability while a create result is uncertain', () => {
    const first = reserveHqDraft(staff, draft);
    expect(() => reserveHqDraft(staff, { ...draft, name: '另一本书' })).toThrow('恢复原内容');
    expect(() =>
      reserveHqDraft(staff, { ...draft, sku: { ...draft.sku, priceMinor: 1300 } }),
    ).toThrow('恢复原内容');
    expect(() =>
      reserveHqDraft(staff, { ...draft, sku: { ...draft.sku, availableForSale: true } }),
    ).toThrow('不能直接公开上架');
    expect(pendingHqDraft(staff)).toEqual(first);
  });

  it('clears only the confirmed key and allows a different draft after success', () => {
    const first = reserveHqDraft(staff, draft);
    expect(() => clearHqDraft(staff, otherStaff)).toThrow('发生冲突');
    expect(pendingHqDraft(staff)).toEqual(first);
    clearHqDraft(staff, first.requestKey);
    expect(pendingHqDraft(staff)).toBeNull();
    expect(reserveHqDraft(staff, { ...draft, name: '下一本书' }).requestKey).not.toBe(
      first.requestKey,
    );
  });

  it('rejects invalid storage and fails before POST when persistence is unavailable', () => {
    const first = reserveHqDraft(staff, draft);
    const key = [...memory.keys()][0]!;
    memory.set(key, 'corrupt-record');
    expect(() => reserveHqDraft(staff, draft)).toThrow('记录无效');
    memory.set(key, JSON.stringify({ ...first, requestKey: 'INVALID' }));
    expect(() => pendingHqDraft(staff)).toThrow('记录无效');
    memory.clear();
    setItem.mockImplementationOnce(() => {
      throw new Error('storage blocked');
    });
    expect(() => reserveHqDraft(staff, draft)).toThrow('storage blocked');
    expect(memory.size).toBe(0);
  });

  it('rejects an invalid staff identity and never touches another account record', () => {
    expect(() => pendingHqDraft('not-an-id')).toThrow('上下文无效');
    expect(memory.size).toBe(0);
  });
});
