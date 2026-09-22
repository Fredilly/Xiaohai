import { describe, expect, it } from 'vitest';
import { resolveEditorialBookCover, resolveHomeEditorialFallback } from './real-visuals';

describe('real visual fallbacks', () => {
  it('always prefers the cover supplied by the API or CMS', () => {
    expect(resolveEditorialBookCover('PEW PEW TIGER', 'https://cdn.example.com/cover.jpg')).toBe(
      'https://cdn.example.com/cover.jpg',
    );
  });

  it('uses curated local covers only for matching real titles', () => {
    expect(resolveEditorialBookCover('Dinosaurs Need a Big Hand', null)).toBe(
      '/assets/books/book-dinosaurs-need-a-big-hand.jpg',
    );
    expect(resolveEditorialBookCover('PEW PEW TIGER and his magic puffs', null)).toBe(
      '/assets/books/book-pew-pew-tiger.jpg',
    );
    expect(resolveEditorialBookCover('DoDo’s HAIRY DAY', null)).toBe(
      '/assets/books/book-dodos-hairy-day.jpg',
    );
    expect(resolveEditorialBookCover('归云日记', null)).toBe('/assets/books/book-yuns-diary.jpg');
  });

  it('keeps the honest empty-cover state for unrelated titles', () => {
    expect(resolveEditorialBookCover('一本没有对应素材的书', null)).toBe('');
  });

  it('uses the supplied home artwork only for matching editorial copy', () => {
    expect(resolveHomeEditorialFallback('亲子阅读', null)).toBe(
      '/assets/brand/home-parent-reading.jpg',
    );
    expect(resolveHomeEditorialFallback('把一个想法变成故事', '小海 AI · 故事创作')).toBe('');
  });
});
