import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminProduct,
  getAdminProduct,
  getHqProductGallery,
  listAdminProducts,
  listHqStoreCatalog,
  lookupBook,
  updateHqProductGallery,
} from './catalog-api';

describe('M5 Admin catalog adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an otherwise valid catalog response for a different store', async () => {
    const requested = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          storeId: '33333333-3333-4333-8333-333333333333',
          offset: 0,
          limit: 30,
          hasMore: false,
          items: [],
        }),
      }),
    );
    await expect(listHqStoreCatalog('staff-token', requested)).rejects.toThrow('门店上下文不一致');
  });

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
      createAdminProduct(
        'token',
        {
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
        },
        'hq-nonbook-test-request-0001',
      ),
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

  it('loads and saves the shared HQ product gallery with exact identity and version', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    const imageId = '22222222-2222-4222-8222-222222222222';
    const gallery = {
      productId,
      productVersion: 4,
      productStatus: 'DRAFT',
      coverUrl: 'https://public.cd.bcebos.com/image.jpg',
      images: [
        {
          id: imageId,
          url: 'https://public.cd.bcebos.com/image.jpg',
          displayOrder: 0,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(gallery) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getHqProductGallery('hq-session', productId)).resolves.toMatchObject(gallery);
    const input = { expectedProductVersion: 4, imageIds: [imageId], coverImageId: imageId };
    await expect(updateHqProductGallery('hq-session', productId, input)).resolves.toMatchObject(
      gallery,
    );
    const [readPath, readInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [writePath, writeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(readPath).toContain(`/staff/catalog/products/${productId}/images`);
    expect(readInit.headers).toMatchObject({ Authorization: 'Bearer hq-session' });
    expect(writePath).toBe(readPath);
    expect(writeInit.method).toBe('PATCH');
    expect(writeInit.body).toBe(JSON.stringify(input));
    expect(writeInit.headers).toMatchObject({ Authorization: 'Bearer hq-session' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...gallery, productId: imageId }),
    });
    await expect(getHqProductGallery('hq-session', productId)).rejects.toThrow('身份不一致');
    await expect(updateHqProductGallery('hq-session', productId, input)).rejects.toThrow(
      '所属商品不一致',
    );
  });

  it('rejects invalid HQ gallery writes locally and preserves restricted API status', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      updateHqProductGallery('hq-session', productId, {
        expectedProductVersion: 0,
        imageIds: [productId, productId],
        coverImageId: productId,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getHqProductGallery('hq-session', productId)).rejects.toMatchObject({
      status: 403,
    });
  });
});
