import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('./store-detail.wxml', import.meta.url), 'utf8');

describe('Store detail public book stock surface', () => {
  it('wires a store-scoped read action and labels the partial results accurately', () => {
    expect(template).toContain('本店有货图书');
    expect(template).toContain('最多显示 30 条');
    expect(template).toContain('bindconfirm="searchStoreBooks"');
    expect(template).toContain('bindtap="searchStoreBooks"');
    expect(template).toContain('bindtap="openInventoryProduct"');
    expect(template).toContain('wx:if="{{item.sellAvailable}}"');
    expect(template).toContain('库存暂时无法获取，请重试');
  });
});
