import { describe, expect, it } from 'vitest';
import { resolveEditorialBookCover } from './real-visuals';

describe('real visual fallbacks', () => {
  it('always prefers the cover supplied by the API or CMS', () => {
    expect(resolveEditorialBookCover('PEW PEW TIGER', 'https://cdn.example.com/cover.jpg')).toBe(
      'https://cdn.example.com/cover.jpg',
    );
  });

  it('uses curated local covers only for matching real titles', () => {
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
});
