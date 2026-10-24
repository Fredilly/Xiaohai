import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminProduct, getAdminProduct, listAdminProducts, lookupBook } from './catalog-api';

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

  it('preserves an existing-book lookup marker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => ({
          source: 'LOCAL',
          existingProductId: '00000000-0000-4000-8000-000000000001',
          book: {
            title: 'Existing book',
            author: 'Author',
            isbn: '9787300000000',
            publisher: null,
            coverUrl: null,
          },
          suggestedPriceMinor: 3980,
        }),
      }),
    );
    await expect(lookupBook('token', '9787300000000')).resolves.toMatchObject({
      source: 'LOCAL',
      existingProductId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('loads an existing product by exact id instead of a paged search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => ({
          id: '00000000-0000-4000-8000-000000000001',
          skuId: '00000000-0000-4000-8000-000000000002',
          bookId: null,
          editionId: null,
          productVersion: 0,
          bookVersion: null,
          editionVersion: null,
          skuVersion: 0,
          name: 'Exact product',
          description: null,
          coverUrl: null,
          status: 'DRAFT',
          book: null,
          sku: {
            code: 'X',
            name: '标准',
            priceMinor: 1,
            status: 'ACTIVE',
            availableForSale: false,
          },
        }),
      }),
    );
    await expect(
      getAdminProduct('token', '00000000-0000-4000-8000-000000000001'),
    ).resolves.toMatchObject({
      name: 'Exact product',
    });
  });
});
