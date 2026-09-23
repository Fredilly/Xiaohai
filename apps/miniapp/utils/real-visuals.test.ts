import { describe, expect, it } from 'vitest';
import { BOS_ASSET_ORIGIN, miniappRemoteAssets } from '../src/config/assets';
import { resolveEditorialBookCover, resolveHomeEditorialFallback } from './real-visuals';

describe('real visual fallbacks', () => {
  it('always prefers the cover supplied by the API or CMS', () => {
    expect(resolveEditorialBookCover('PEW PEW TIGER', 'https://cdn.example.com/cover.jpg')).toBe(
      'https://cdn.example.com/cover.jpg',
    );
  });

  it('uses curated BOS covers only for matching real titles', () => {
    expect(resolveEditorialBookCover('Dinosaurs Need a Big Hand', null)).toBe(
      miniappRemoteAssets.shop.dinosaursNeedBigHandCover,
    );
    expect(resolveEditorialBookCover('PEW PEW TIGER and his magic puffs', null)).toBe(
      miniappRemoteAssets.shop.pewPewTigerCover,
    );
    expect(resolveEditorialBookCover('DoDo’s HAIRY DAY', null)).toBe(
      miniappRemoteAssets.shop.dodosHairyDayCover,
    );
    expect(resolveEditorialBookCover('归云日记', null)).toBe(
      miniappRemoteAssets.shop.yunsDiaryCover,
    );
  });

  it('keeps the honest empty-cover state for unrelated titles', () => {
    expect(resolveEditorialBookCover('一本没有对应素材的书', null)).toBe('');
  });

  it('uses the supplied home artwork only for matching editorial copy', () => {
    expect(resolveHomeEditorialFallback('亲子阅读', null)).toBe(
      miniappRemoteAssets.home.parentChildReading,
    );
    expect(resolveHomeEditorialFallback('把一个想法变成故事', '小海 AI · 故事创作')).toBe('');
  });

  it('keeps every deployed runtime asset on the approved HTTPS origin', () => {
    const urls = [
      miniappRemoteAssets.home.parentChildReading,
      ...Object.values(miniappRemoteAssets.shop),
    ];
    expect(urls).toHaveLength(5);
    for (const url of urls) {
      expect(url.startsWith(`${BOS_ASSET_ORIGIN}/`)).toBe(true);
      expect(url).toMatch(/-v1\.jpg$/);
    }
  });
});
