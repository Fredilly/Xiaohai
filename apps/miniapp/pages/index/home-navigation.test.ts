import { describe, expect, it } from 'vitest';
import { resolveHomeTargetUrl } from './home-navigation';

describe('M4 Home navigation', () => {
  it('routes the Story AI hero and legacy AI card to the existing story-create flow', () => {
    expect(resolveHomeTargetUrl('story-create')).toBe('/pages/story-create/story-create');
    expect(resolveHomeTargetUrl('ai')).toBe('/pages/story-create/story-create');
  });

  it('surfaces the existing Picture Book and Animation experiences', () => {
    expect(resolveHomeTargetUrl('picture-books')).toBe('/pages/picture-books/picture-books');
    expect(resolveHomeTargetUrl('animations')).toBe('/pages/animations/animations');
  });

  it('keeps existing shop and generic feature navigation working', () => {
    expect(resolveHomeTargetUrl('shop')).toBe('/pages/shop/shop');
    expect(resolveHomeTargetUrl('future feature')).toBe(
      '/pages/feature/feature?key=future%20feature',
    );
  });
});
