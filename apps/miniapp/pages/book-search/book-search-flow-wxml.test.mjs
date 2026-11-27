import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./book-search.wxml', import.meta.url), 'utf8');

describe('Book-search fulfillment entry', () => {
  it('directs available sale listings to the real product/cart/checkout flow', () => {
    expect(template).toContain('bindtap="openProduct"');
    expect(template).toContain('wx:if="{{item.sellAvailable}}"');
    expect(template).toContain('购买商品并加入购物车后，可在结算页选择门店和自提/配送方式');
    expect(template).not.toContain('showDeferredFlow');
  });

  it('exposes an actual cancel action while location is pending', () => {
    expect(template).toContain('wx:if="{{locationPending}}"');
    expect(template).toContain('bindtap="disableNearby">取消定位');
  });
});
