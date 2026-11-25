import { afterEach, describe, expect, it, vi } from 'vitest';
import { findOpeningStockCandidates, loadInventory, registerOpeningStock } from './inventory-api';

afterEach(() => vi.unstubAllGlobals());
const storeId = '11111111-1111-4111-8111-111111111111';
const skuId = '22222222-2222-4222-8222-222222222222';

describe('store opening stock HTTP adapter', () => {
  it('searches the chosen store for unlinked SKUs and validates candidate statuses', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              skuId,
              skuCode: 'P-001',
              skuName: '货架书',
              productName: '童话',
              productStatus: 'DRAFT',
              skuStatus: 'ACTIVE',
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', request);
    const result = await findOpeningStockCandidates('staff-token', storeId, '童话');
    const [url, options] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/api\//);
    expect(url).not.toContain('127.0.0.1');
    expect(url).toContain(`/opening-candidates?storeId=${storeId}`);
    expect(url).toContain('q=%E7%AB%A5%E8%AF%9D');
    expect(options.headers).toMatchObject({ authorization: 'Bearer staff-token' });
    expect(result.items[0]).toMatchObject({ productStatus: 'DRAFT', skuCode: 'P-001' });
  });

  it('submits only selected store, SKU, opening count and idempotency metadata', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storeId, skuId, onHand: 3, version: 1 }),
    });
    vi.stubGlobal('fetch', request);
    const input = {
      storeId,
      skuId,
      initialQuantity: 3,
      reason: '初次实盘',
      idempotencyKey: crypto.randomUUID(),
    };
    expect(await registerOpeningStock('staff-token', input)).toMatchObject({
      onHand: 3,
      version: 1,
    });
    const [url, options] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/staff/inventory/opening-stock');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual(input);
    expect(options.headers).toMatchObject({ authorization: 'Bearer staff-token' });
  });

  it('supports scoped search among already registered balances', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    vi.stubGlobal('fetch', request);
    await loadInventory('staff-token', storeId, 'P-001');
    expect((request.mock.calls[0] as [string])[0]).toContain(`storeId=${storeId}&q=P-001`);
  });
});
