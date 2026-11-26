import { describe, expect, it } from 'vitest';
import { clearFailedHeroMedia, homeDisplaySections } from './home-display';
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

    const failedUrl = miniappRemoteAssets.home.parentChildReading;
    const updated = clearFailedHeroMedia(sections, 0, 'bos-test', failedUrl);
    expect(updated[0]).toEqual({ ...sections[0], mediaUrl: '' });
    expect(sections[0]?.mediaUrl).toBe(failedUrl);
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

    const staleUrl = miniappRemoteAssets.home.parentChildReading;
    expect(clearFailedHeroMedia(sections, 0, 'bos-test', staleUrl)).toBe(sections);
    expect(clearFailedHeroMedia(sections, 1, 'current-banner', staleUrl)).toBe(sections);

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
    expect(clearFailedHeroMedia(newerHero, 0, 'newer-hero', staleUrl)).toBe(newerHero);
  });

  it('ignores stale image errors after a HERO is replaced by one with the same URL', () => {
    const sharedUrl = miniappRemoteAssets.home.parentChildReading;
    const sections: HomeSection[] = [
      {
        id: 'replacement-hero',
        sectionType: 'HERO',
        title: '新活动',
        displayOrder: 1,
        config: { eyebrow: '最近上新' },
        mediaUrl: sharedUrl,
      },
      {
        id: 'unchanged-hero',
        sectionType: 'HERO',
        title: '亲子阅读',
        displayOrder: 2,
        config: {},
        mediaUrl: sharedUrl,
      },
    ];

    expect(clearFailedHeroMedia(sections, 0, 'old-hero', sharedUrl)).toBe(sections);
    expect(clearFailedHeroMedia(sections, 1, 'replacement-hero', sharedUrl)).toBe(sections);
    expect(clearFailedHeroMedia(sections, 0, '', sharedUrl)).toBe(sections);
    expect(clearFailedHeroMedia(sections, 0, 'replacement-hero', '')).toBe(sections);

    const result = clearFailedHeroMedia(sections, 0, 'replacement-hero', sharedUrl);
    expect(result[0]).toEqual({ ...sections[0], mediaUrl: '' });
    expect(result[1]).toBe(sections[1]);
    expect(sections[0]?.mediaUrl).toBe(sharedUrl);
  });

  it('uses a matching BOS editorial cover and preserves explicit CMS media', () => {
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
    expect(display[2]?.mediaUrl).toBeNull();
    expect(display[2]).toBe(sections[2]);
    expect(sections[0]?.mediaUrl).toBeNull();
  });

  it('does not replace unrelated CMS heroes with a parent-child reading photo', () => {
    const sections: HomeSection[] = [
      {
        id: 'ai-hero',
        sectionType: 'HERO',
        title: '把一个想法变成故事',
        subtitle: '小海 AI · 故事创作',
        displayOrder: 1,
        config: { eyebrow: '原创创作' },
        mediaUrl: '',
      },
      {
        id: 'custom-hero',
        sectionType: 'HERO',
        title: '玩具与文创',
        displayOrder: 2,
        config: {},
      },
      {
        id: 'subtitle-matching',
        sectionType: 'HERO',
        title: '精选推荐',
        subtitle: '亲子绘本',
        displayOrder: 3,
        config: {},
      },
      {
        id: 'editor-provided',
        sectionType: 'HERO',
        title: '亲子阅读',
        displayOrder: 4,
        config: {},
        mediaUrl: 'https://cdn.example.com/curated-hero.jpg',
      },
    ];
    const displayed = homeDisplaySections(sections);

    expect(displayed[0]).toBe(sections[0]);
    expect(displayed[1]).toBe(sections[1]);
    expect(displayed[2]).toEqual({
      ...sections[2],
      mediaUrl: miniappRemoteAssets.home.parentChildReading,
    });
    expect(displayed[3]).toBe(sections[3]);
    expect(displayed[0]?.config).toEqual({ eyebrow: '原创创作' });
    expect(sections[2]?.mediaUrl).toBeUndefined();
  });
});
