import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStoreProductGallery,
  listStoreCatalog,
  updateStoreProductGallery,
} from './store-catalog-api';
const storeId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.unstubAllGlobals());
describe('Store Web scoped catalog API client', () => {
  it('uses Staff authorization and selected store with bounded pagination', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          storeId,
          offset: 30,
          limit: 30,
          hasMore: false,
          items: [],
        }),
    });
    vi.stubGlobal('fetch', fn);
    const result = await listStoreCatalog('fake-staff-token', storeId, {
      q: '  童话 ',
      offset: 30,
    });
    const [url, request] = fn.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/staff/stores/${storeId}/catalog?`);
    expect(url).toContain('q=%E7%AB%A5%E8%AF%9D');
    expect(url).toContain('offset=30');
    expect(request.headers.Authorization).toBe(['Be', 'arer ', 'fake-staff-token'].join(''));
    expect(result.items).toEqual([]);
  });
  it('makes 403 visible instead of silently showing global catalog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(listStoreCatalog('t', storeId)).rejects.toThrow('没有此门店');
  });

  it('reads and writes only the exact store-scoped product gallery', async () => {
    const imageId = '33333333-3333-4333-8333-333333333333';
    const gallery = {
      productId,
      productVersion: 4,
      productStatus: 'DRAFT',
      coverUrl: 'https://public.cd.bcebos.com/img.png',
      images: [{ id: imageId, url: 'https://public.cd.bcebos.com/img.png', displayOrder: 0 }],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(gallery) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getStoreProductGallery('token', storeId, productId)).resolves.toMatchObject(
      gallery,
    );
    const input = { expectedProductVersion: 4, imageIds: [imageId], coverImageId: imageId };
    await expect(
      updateStoreProductGallery('token', storeId, productId, input),
    ).resolves.toMatchObject(gallery);
    const [url, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }];
    expect(url).toContain(`/stores/${storeId}/catalog/products/${productId}/images`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual(input);

    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...gallery, productId: storeId }),
    });
    await expect(getStoreProductGallery('token', storeId, productId)).rejects.toThrow('身份不一致');
    await expect(updateStoreProductGallery('token', storeId, productId, input)).rejects.toThrow(
      '所属商品不一致',
    );
  });

  it('rejects gallery duplicates before sending a mutation and preserves permission errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      updateStoreProductGallery('token', storeId, productId, {
        expectedProductVersion: 0,
        imageIds: [productId, productId],
        coverImageId: productId,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getStoreProductGallery('token', storeId, productId)).rejects.toThrow('没有权限');
  });
});
