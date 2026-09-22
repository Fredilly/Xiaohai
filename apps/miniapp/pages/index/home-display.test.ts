import { describe, expect, it } from 'vitest';
import { homeDisplaySections } from './home-display';
import type { HomeSection } from '../../services/home';

describe('home display content', () => {
  it('hides old development badges without changing CMS editorial badges or source data', () => {
    const sections: HomeSection[] = [
      {
        id: 'grid',
        sectionType: 'FEATURE_GRID',
        title: '探索',
        displayOrder: 1,
        config: {
          items: [
            { key: 'story-create', title: '故事', badge: 'M9' },
            { key: 'shop', title: '商城', badge: '新品' },
          ],
        },
      },
    ];
    const display = homeDisplaySections(sections);
    expect(display[0]?.config.items).toEqual([
      { key: 'story-create', title: '故事' },
      { key: 'shop', title: '商城', badge: '新品' },
    ]);
    expect((sections[0]?.config.items as { badge: string }[])[0]?.badge).toBe('M9');
  });
});
