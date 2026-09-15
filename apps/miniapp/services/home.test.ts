import { describe, expect, it } from 'vitest';
import { normalizeHomeResponse } from './home';

describe('Mini Program M4 home mapping', () => {
  it('orders known sections and safely ignores unknown section types', () => {
    const home = normalizeHomeResponse({
      page: { key: 'HOME', title: '首页' },
      sections: [
        { id: '2', sectionType: 'BANNER', title: 'second', displayOrder: 2, config: { body: 'x' } },
        { id: 'x', sectionType: 'FUTURE_TYPE', title: 'unknown', displayOrder: 0, config: {} },
        { id: '1', sectionType: 'HERO', title: 'first', displayOrder: 1, config: {} },
      ],
    });
    expect(home.sections.map((section) => section.title)).toEqual(['first', 'second']);
  });

  it('fails closed for malformed top-level responses', () => {
    expect(() => normalizeHomeResponse({ page: { key: 'OTHER' }, sections: [] })).toThrow();
  });
});
