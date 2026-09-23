import { describe, expect, it } from 'vitest';
import { homeDisplaySections } from './home-display';
import type { HomeSection } from '../../services/home';
import { miniappRemoteAssets } from '../../src/config/assets';

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

  it('uses supplied editorial art only when a matching CMS hero has no media', () => {
    const sections: HomeSection[] = [
      {
        id: 'fallback',
        sectionType: 'HERO',
        title: '亲子阅读',
        displayOrder: 1,
        config: {},
        mediaUrl: null,
      },
      {
        id: 'cms',
        sectionType: 'HERO',
        title: '运营活动',
        displayOrder: 2,
        config: {},
        mediaUrl: 'https://cdn.example.com/cms-hero.jpg',
      },
      {
        id: 'unrelated',
        sectionType: 'HERO',
        title: '把一个想法变成故事',
        subtitle: '小海 AI · 故事创作',
        displayOrder: 3,
        config: {},
        mediaUrl: null,
      },
    ];

    const display = homeDisplaySections(sections);
    expect(display[0]?.mediaUrl).toBe(miniappRemoteAssets.home.parentChildReading);
    expect(display[1]?.mediaUrl).toBe('https://cdn.example.com/cms-hero.jpg');
    expect(display[2]?.mediaUrl).toBeNull();
    expect(sections[0]?.mediaUrl).toBeNull();
  });
});
