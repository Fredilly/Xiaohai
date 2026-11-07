import { describe, expect, it } from 'vitest';
import type { Product } from '../services/commerce';
import { miniappRemoteAssets } from '../src/config/assets';
import { presentCatalogProduct } from './catalog-presentation';

function fixture(overrides: Partial<Product> = {}): Product {
  return {
    id: 'catalog-fixture',
    name: '门店商品',
    description: '真实商户商品描述',
    coverUrl: null,
    title: null,
    author: null,
    isbn: null,
    publisher: null,
    skus: [
      {
        id: 'sku-fixture',
        code: 'SKU-001',
        name: '盒装',
        priceMinor: 1880,
        availableForSale: true,
      },
    ],
    ...overrides,
  };
}

describe('mixed goods and book catalog presentation (#208)', () => {
  it('uses the real uploaded image for a non-book with retail-safe metadata', () => {
    const input = fixture({
      name: '手工曲奇',
      coverUrl: ' https://assets.example.com/retail/cookie.jpg ',
    });
    const view = presentCatalogProduct(input);
    expect(view.isBook).toBe(false);
    expect(view.displayCoverUrl).toBe('https://assets.example.com/retail/cookie.jpg');
    expect(view.displaySubtitle).toBe('盒装');
    expect(view.displayPriceText).toBe('¥18.80');
    expect(view.name).toBe('手工曲奇');
    expect(input.coverUrl).toContain(' ');
  });

  it('never substitutes book artwork for an unrelated non-book product name', () => {
    const view = presentCatalogProduct(fixture({ name: 'PEW PEW TIGER 主题饼干' }));
    expect(view.isBook).toBe(false);
    expect(view.displayCoverUrl).toBe('');
  });

  it('preserves real book cover behavior for actual book editions', () => {
    const view = presentCatalogProduct(
      fixture({
        name: '绘本商品',
        title: 'PEW PEW TIGER',
        author: 'Original Author',
        isbn: '9780000000002',
        skus: [
          {
            id: 'book-sku',
            code: 'BOOK-001',
            name: '精装',
            priceMinor: 3000,
            availableForSale: true,
          },
        ],
      }),
    );
    expect(view.isBook).toBe(true);
    expect(view.displayCoverUrl).toBe(miniappRemoteAssets.shop.pewPewTigerCover);
    expect(view.displaySubtitle).toBe('Original Author');
    expect(view.displayPriceText).toBe('¥30.00');
  });

  it('shows the lowest SKU price and variant count without changing server prices', () => {
    const view = presentCatalogProduct(
      fixture({
        skus: [
          { id: 'a', code: 'A', name: '大盒', priceMinor: 2890, availableForSale: true },
          { id: 'b', code: 'B', name: '小盒', priceMinor: 1250, availableForSale: false },
        ],
      }),
    );
    expect(view.displaySubtitle).toBe('2 种规格');
    expect(view.displayPriceText).toBe('¥28.90');
    expect(view.skus[0]?.priceMinor).toBe(2890);
    // Listing a price is not a guarantee that any SKU has physical store stock.
  });

  it('constructs a unique gallery with the actual product cover first', () => {
    const view = presentCatalogProduct(
      fixture({
        coverUrl: 'https://cdn.example.com/products/main.jpg',
        mediaUrls: [
          'https://cdn.example.com/products/main.jpg',
          'https://cdn.example.com/products/detail1.jpg',
          'https://cdn.example.com/products/detail2.jpg',
        ],
      }),
    );
    expect(view.galleryUrls).toEqual([
      'https://cdn.example.com/products/main.jpg',
      'https://cdn.example.com/products/detail1.jpg',
      'https://cdn.example.com/products/detail2.jpg',
    ]);
  });

  it('preserves gallery images when a product has no main cover', () => {
    const view = presentCatalogProduct(
      fixture({ mediaUrls: ['https://cdn.example.com/products/detail1.jpg'] }),
    );
    expect(view.displayCoverUrl).toBe('');
    expect(view.galleryUrls).toEqual(['https://cdn.example.com/products/detail1.jpg']);
  });

  it('does not advertise a price as purchasable when every SKU is disabled', () => {
    const view = presentCatalogProduct(
      fixture({
        skus: [{ id: 'off', code: 'OFF', name: '盒装', priceMinor: 1200, availableForSale: false }],
      }),
    );
    expect(view.displayPriceText).toBe('暂不可购买');
  });

  it('renders a safe empty-price state for malformed or incomplete catalog snapshots', () => {
    const view = presentCatalogProduct(fixture({ skus: [], coverUrl: null }));
    expect(view.displayPriceText).toBe('暂无报价');
    expect(view.displaySubtitle).toBe('商品详情');
    expect(view.displayCoverUrl).toBe('');
  });
});
