import { describe, expect, it } from 'vitest';
import { clearFailedShopCover } from './shop-display';

describe('shop cover error fallback', () => {
  const failedUrl = 'https://xiaohai-prod-assets.cd.bcebos.com/books/covers/missing.jpg';

  const products = [
    {
      id: 'book-one',
      title: 'PEW PEW TIGER',
      author: 'Original Author',
      displayCoverUrl: failedUrl,
      skus: [{ priceMinor: 1299 }],
    },
    {
      id: 'book-two',
      title: 'DoDo’s Hairy Day',
      author: 'Other Author',
      displayCoverUrl: 'https://cdn.example.com/other-cover.jpg',
      skus: [{ priceMinor: 2999 }],
    },
  ];

  it('clears only the failed cover while retaining full book data and other rows', () => {
    const updated = clearFailedShopCover(products, 0, 'book-one', failedUrl);
    expect(updated).not.toBe(products);
    expect(updated[0]).toEqual({ ...products[0], displayCoverUrl: '' });
    expect(updated[0]?.title).toBe('PEW PEW TIGER');
    expect(updated[0]?.author).toBe('Original Author');
    expect(updated[0]?.skus[0]?.priceMinor).toBe(1299);
    expect(updated[1]).toBe(products[1]);
    expect(products[0]?.displayCoverUrl).toBe(failedUrl);
  });

  it('ignores stale errors after search results reorder or replace a cover', () => {
    expect(clearFailedShopCover(products, 0, 'book-two', failedUrl)).toBe(products);
    expect(clearFailedShopCover(products, 0, 'book-one', 'https://cdn.example.com/old.jpg')).toBe(
      products,
    );
    expect(clearFailedShopCover(products, 1, 'book-one', failedUrl)).toBe(products);
  });

  it('ignores missing identity, blank URL, and invalid indexes', () => {
    expect(clearFailedShopCover(products, -1, 'book-one', failedUrl)).toBe(products);
    expect(clearFailedShopCover(products, Number.NaN, 'book-one', failedUrl)).toBe(products);
    expect(clearFailedShopCover(products, 5, 'book-one', failedUrl)).toBe(products);
    expect(clearFailedShopCover(products, 0, '', failedUrl)).toBe(products);
    expect(clearFailedShopCover(products, 0, 'book-one', '')).toBe(products);
  });
});
