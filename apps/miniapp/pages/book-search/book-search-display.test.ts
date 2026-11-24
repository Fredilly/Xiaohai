import { describe, expect, it } from 'vitest';
import { miniappRemoteAssets } from '../../src/config/assets';
import { clearFailedBookSearchCover, resolveBookSearchCover } from './book-search-display';

describe('book-search cover display', () => {
  const failedUrl = 'https://cdn.example.com/missing-cover.jpg';
  const sharedUrl = 'https://cdn.example.com/shared-cover.jpg';
  const makeItem = (
    key: string,
    displayCoverUrl: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    key,
    displayCoverUrl,
    book: { title: `Book ${key}`, author: `Author ${key}` },
    sku: { code: `SKU-${key}` },
    stock: { available: 3 },
    store: { id: `store-${key}`, name: `Store ${key}` },
    distanceText: '1.2 km',
    priceText: '¥12.99',
    ...overrides,
  });

  it('prefers a non-empty API cover', () => {
    expect(
      resolveBookSearchCover({
        book: { title: 'PEW PEW TIGER' },
        product: { coverUrl: 'https://cdn.example.com/api-cover.jpg' },
      }),
    ).toBe('https://cdn.example.com/api-cover.jpg');
  });

  it('uses a registered BOS cover only for a matching title', () => {
    expect(
      resolveBookSearchCover({
        book: { title: 'Dinosaurs Need a Big Hand' },
        product: { coverUrl: null },
      }),
    ).toBe(miniappRemoteAssets.shop.dinosaursNeedBigHandCover);
  });

  it('keeps the no-cover state for an unknown title', () => {
    expect(
      resolveBookSearchCover({
        book: { title: 'A book without a registered cover' },
        product: { coverUrl: null },
      }),
    ).toBe('');
  });

  it('clears a failed cover without changing the row data or order', () => {
    const items = [makeItem('sku-1:store-1', failedUrl), makeItem('sku-2:store-2', sharedUrl)];
    const updated = clearFailedBookSearchCover(items, 0, 'sku-1:store-1', failedUrl);

    expect(updated).not.toBe(items);
    expect(updated[0]).toEqual({ ...items[0], displayCoverUrl: '' });
    expect(updated[0]?.book).toEqual(items[0]?.book);
    expect(updated[0]?.sku).toEqual(items[0]?.sku);
    expect(updated[0]?.stock).toEqual(items[0]?.stock);
    expect(updated[0]?.store).toEqual(items[0]?.store);
    expect(updated[0]?.distanceText).toBe(items[0]?.distanceText);
    expect(updated[0]?.priceText).toBe(items[0]?.priceText);
    expect(updated[1]).toBe(items[1]);
    expect(items[0]?.displayCoverUrl).toBe(failedUrl);
  });

  it('ignores invalid indexes', () => {
    const items = [makeItem('sku-1:store-1', failedUrl)];
    expect(clearFailedBookSearchCover(items, -1, 'sku-1:store-1', failedUrl)).toBe(items);
    expect(clearFailedBookSearchCover(items, Number.NaN, 'sku-1:store-1', failedUrl)).toBe(items);
    expect(clearFailedBookSearchCover(items, 1, 'sku-1:store-1', failedUrl)).toBe(items);
  });

  it('does not create another state change for the same repeated error', () => {
    const items = [makeItem('sku-1:store-1', failedUrl)];
    const updated = clearFailedBookSearchCover(items, 0, 'sku-1:store-1', failedUrl);
    expect(clearFailedBookSearchCover(updated, 0, 'sku-1:store-1', failedUrl)).toBe(updated);
  });

  it('ignores a late error after the results reorder', () => {
    const first = makeItem('sku-1:store-1', failedUrl);
    const second = makeItem('sku-2:store-2', sharedUrl);
    const reordered = [second, first];
    expect(clearFailedBookSearchCover(reordered, 0, first.key, failedUrl)).toBe(reordered);
    expect(reordered[0]?.displayCoverUrl).toBe(sharedUrl);
  });

  it('ignores an old event after the same row receives a new URL', () => {
    const items = [makeItem('sku-1:store-1', 'https://cdn.example.com/new-cover.jpg')];
    expect(clearFailedBookSearchCover(items, 0, 'sku-1:store-1', failedUrl)).toBe(items);
  });

  it('clears only the matching row when two rows share a URL', () => {
    const items = [makeItem('sku-1:store-1', sharedUrl), makeItem('sku-2:store-2', sharedUrl)];
    const updated = clearFailedBookSearchCover(items, 1, 'sku-2:store-2', sharedUrl);
    expect(updated[0]).toBe(items[0]);
    expect(updated[0]?.displayCoverUrl).toBe(sharedUrl);
    expect(updated[1]?.displayCoverUrl).toBe('');
  });
});
