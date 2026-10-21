import { afterEach, describe, expect, it, vi } from 'vitest';
import { listStoreCatalog } from './store-catalog-api';
const storeId = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.unstubAllGlobals());
describe('Store Web scoped catalog API client', () => {
  it('uses Staff Bearer and selected store with bounded pagination', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      storeId, offset: 30, limit: 30, hasMore: false, items: [],
    }) });
    vi.stubGlobal('fetch', fn);
    const result = await listStoreCatalog('fake-staff-token', storeId, { q: '  童话 ', offset: 30 });
    const [url, request] = fn.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/staff/stores/${storeId}/catalog?`);
    expect(url).toContain('q=%E7%AB%A5%E8%AF%9D');
    expect(url).toContain('offset=30');
    expect(request.headers.Authorization).toBe('Bearer fake-staff-token');
    expect(result.items).toEqual([]);
  });
  it('makes 403 visible instead of silently showing global catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(listStoreCatalog('t', storeId)).rejects.toThrow('没有此门店');
  });
});
