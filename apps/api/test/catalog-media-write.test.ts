import { describe, expect, it } from 'vitest';
import { CommerceService } from '../src/commerce/commerce-service.js';

const base = {
  name: '测试食品',
  status: 'DRAFT' as const,
  book: null,
  sku: {
    code: 'SKU-TEST',
    name: '标准',
    priceMinor: 1800,
    status: 'ACTIVE' as const,
    availableForSale: false,
  },
};

describe('HQ product image write safety (#208)', () => {
  it('refuses private, unstable, duplicate and excessive images before touching the database', async () => {
    // A forbidden URL must be rejected even without a DB connector, so it
    // cannot create a product, change a gallery or reach the audit boundary.
    const service = new CommerceService({} as never);
    const invalidLists = [
      ['http://cdn.example.com/not-secure.jpg'],
      ['https://cdn.example.com/private.jpg?token=secret'],
      ['https://cdn.example.com/first.jpg', 'https://cdn.example.com/first.jpg'],
      ['https://127.0.0.1/local.jpg'],
      Array.from({ length: 13 }, (_, index) => `https://cdn.example.com/${index}.jpg`),
    ];
    for (const mediaUrls of invalidLists) {
      await expect(
        service.createAdminProduct({ ...base, mediaUrls }, 'staff-id', 'request-id'),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(
        service.previewAdminProductUpdate(
          'product-id',
          { ...base, mediaUrls, expectedProductVersion: 0, expectedSkuVersion: 0 },
          'staff-id',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
});
