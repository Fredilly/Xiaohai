import { describe, expect, it } from 'vitest';
import { clearFailedHeroMedia, hasCmsHero, homeDisplaySections } from './home-display';
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

  it('keeps the whole HERO section when its image fails', () => {
    const sections: HomeSection[] = [
      {
        id: 'bos-test',
        sectionType: 'HERO',
        title: 'BOS 图片验收',
        displayOrder: 0,
        config: {},
        mediaUrl: miniappRemoteAssets.home.parentChildReading,
      },
    ];

    const updated = clearFailedHeroMedia(sections, 0, miniappRemoteAssets.home.parentChildReading);
    expect(updated[0]).toEqual({ ...sections[0], mediaUrl: '' });
    expect(sections[0]?.mediaUrl).toBe(miniappRemoteAssets.home.parentChildReading);
  });

  it('ignores stale image errors after CMS content is replaced', () => {
    const sections: HomeSection[] = [
      {
        id: 'current-banner',
        sectionType: 'BANNER',
        title: '运营自定义首页',
        displayOrder: 0,
        config: { body: 'real CMS content wins' },
        mediaUrl: null,
      },
    ];

    expect(clearFailedHeroMedia(sections, 0, miniappRemoteAssets.home.parentChildReading)).toBe(
      sections,
    );
    expect(clearFailedHeroMedia(sections, 1, miniappRemoteAssets.home.parentChildReading)).toBe(
      sections,
    );

    const newerHero: HomeSection[] = [
      {
        id: 'newer-hero',
        sectionType: 'HERO',
        title: '更新后的首页',
        displayOrder: 0,
        config: {},
        mediaUrl: 'https://cdn.example.com/newer-hero.jpg',
      },
    ];
    expect(clearFailedHeroMedia(newerHero, 0, miniappRemoteAssets.home.parentChildReading)).toBe(
      newerHero,
    );
  });

  it('uses the static illustration only when the CMS response has no HERO', () => {
    const feature: HomeSection = {
      id: 'features',
      sectionType: 'FEATURE_GRID',
      title: '阅读入口',
      displayOrder: 1,
      config: { items: [{ key: 'shop', title: '商城' }] },
    };
    const hero: HomeSection = {
      id: 'cms-hero',
      sectionType: 'HERO',
      title: '真实 CMS 主视觉',
      displayOrder: 0,
      config: {},
      mediaUrl: 'https://cdn.example.com/hero.png',
    };

    expect(hasCmsHero([])).toBe(false);
    expect(hasCmsHero([feature])).toBe(false);
    expect(hasCmsHero(homeDisplaySections([hero, feature]))).toBe(true);
    expect(hasCmsHero([feature, hero])).toBe(true);
  });

  it('uses BOS editorial art when a CMS hero has no media and preserves explicit CMS media', () => {
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
        id: 'default-local-seed',
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
    expect(display[2]?.mediaUrl).toBe(miniappRemoteAssets.home.parentChildReading);
    expect(sections[0]?.mediaUrl).toBeNull();
  });
});
