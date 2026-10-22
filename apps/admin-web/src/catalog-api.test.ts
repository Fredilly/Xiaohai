import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminProduct, listAdminProducts } from './catalog-api';

describe('M5 Admin catalog adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves unauthorized and forbidden errors', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
      await expect(listAdminProducts('token')).rejects.toMatchObject({ status });
    }
  });

  it('accepts the non-book product response returned by the HQ create API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => ({
          id: '00000000-0000-4000-8000-000000000001',
          skuId: '00000000-0000-4000-8000-000000000002',
          bookId: null,
          editionId: null,
          productVersion: 1,
          bookVersion: null,
          editionVersion: null,
          skuVersion: 1,
          name: '非图书测试商品',
          description: null,
          coverUrl: null,
          status: 'ACTIVE',
          book: null,
          sku: {
            code: 'NONBOOK-TEST',
            name: '标准',
            priceMinor: 800,
            status: 'ACTIVE',
            availableForSale: true,
          },
        }),
      }),
    );
    await expect(
      createAdminProduct('token', {
        name: '非图书测试商品',
        description: null,
        coverUrl: null,
        status: 'ACTIVE',
        book: null,
        sku: {
          code: 'NONBOOK-TEST',
          name: '标准',
          priceMinor: 800,
          status: 'ACTIVE',
          availableForSale: true,
        },
      }),
    ).resolves.toMatchObject({ book: null, bookId: null, editionId: null });
  });
});
