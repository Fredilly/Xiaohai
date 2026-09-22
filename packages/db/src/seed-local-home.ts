import { eq } from 'drizzle-orm';
import { cmsPages, cmsSections } from './cms-schema.js';
import type { createDatabase } from './client.js';

type Database = ReturnType<typeof createDatabase>['db'];
type CmsSectionRow = typeof cmsSections.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPreviousLocalHomeSeed(sections: CmsSectionRow[]) {
  if (sections.length !== 2) return false;

  const hero = sections.find((section) => section.sectionType === 'HERO');
  const grid = sections.find((section) => section.sectionType === 'FEATURE_GRID');
  if (!hero || !grid || !isRecord(hero.config) || !isRecord(grid.config)) return false;

  const items = Array.isArray(grid.config.items) ? grid.config.items.filter(isRecord) : [];
  return (
    hero.title === '欢迎来到小海童话' &&
    hero.subtitle === '这是本地开发默认首页内容，可随时通过 CMS 配置替换。' &&
    hero.displayOrder === 0 &&
    hero.enabled &&
    hero.publicationState === 'PUBLISHED' &&
    hero.config.eyebrow === 'DEV / LOCAL' &&
    hero.mediaUrl === null &&
    hero.action === null &&
    grid.title === '开始探索' &&
    grid.subtitle === '开发环境默认入口' &&
    grid.displayOrder === 1 &&
    grid.enabled &&
    grid.publicationState === 'PUBLISHED' &&
    grid.mediaUrl === null &&
    grid.action === null &&
    items.length === 2 &&
    items[0]?.key === 'shop' &&
    items[0]?.badge === 'DEV' &&
    items[1]?.key === 'ai' &&
    items[1]?.badge === 'DEV'
  );
}

export const DEFAULT_LOCAL_HOME_SECTIONS = [
  {
    sectionType: 'HERO',
    title: '把一个想法变成故事',
    subtitle: '用小海 AI 创作故事，并继续生成绘本和动画。',
    displayOrder: 0,
    enabled: true,
    publicationState: 'PUBLISHED',
    config: { eyebrow: '小海 AI · 故事创作' },
    mediaUrl: null,
    action: { type: 'PREVIEW', target: 'story-create' },
  },
  {
    sectionType: 'FEATURE_GRID',
    title: '开始探索',
    subtitle: '找到你喜欢的故事方式',
    displayOrder: 1,
    enabled: true,
    publicationState: 'PUBLISHED',
    config: {
      items: [
        {
          key: 'story-create',
          title: 'AI 故事',
          subtitle: '从一个想法开始创作',
        },
        {
          key: 'picture-books',
          title: 'AI 绘本',
          subtitle: '查看并继续故事绘本',
        },
        {
          key: 'animations',
          title: 'AI 动画',
          subtitle: '查看故事动画作品',
        },
        {
          key: 'shop',
          title: '小海商城',
          subtitle: '浏览图书与商品',
          badge: '商城',
        },
      ],
    },
    mediaUrl: null,
    action: null,
  },
] as const;

export async function seedLocalHomeCms(db: Database) {
  const [page] = await db.select().from(cmsPages).where(eq(cmsPages.key, 'HOME')).limit(1);
  if (!page) return { seeded: false as const, count: 0, reason: 'HOME_PAGE_MISSING' as const };

  const existing = await db.select().from(cmsSections).where(eq(cmsSections.pageId, page.id));
  if (existing.length > 0 && !isPreviousLocalHomeSeed(existing))
    return { seeded: false as const, count: 0, reason: 'CMS_ALREADY_CONFIGURED' as const };

  if (existing.length > 0) {
    await db.delete(cmsSections).where(eq(cmsSections.pageId, page.id));
  }

  const rows = DEFAULT_LOCAL_HOME_SECTIONS.map((section) => ({
    pageId: page.id,
    sectionType: section.sectionType,
    title: section.title,
    subtitle: section.subtitle,
    displayOrder: section.displayOrder,
    enabled: section.enabled,
    publicationState: section.publicationState,
    config: section.config,
    mediaUrl: section.mediaUrl,
    action: section.action,
  }));

  const inserted = await db.insert(cmsSections).values(rows).returning({ id: cmsSections.id });
  return { seeded: true as const, count: inserted.length, reason: null };
}
