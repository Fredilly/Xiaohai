import { eq } from 'drizzle-orm';
import { cmsPages, cmsSections } from './cms-schema.js';
import type { createDatabase } from './client.js';

type Database = ReturnType<typeof createDatabase>['db'];

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
    subtitle: '已有功能入口',
    displayOrder: 1,
    enabled: true,
    publicationState: 'PUBLISHED',
    config: {
      items: [
        {
          key: 'story-create',
          title: 'AI 故事',
          subtitle: '从一个想法开始创作',
          badge: 'M9',
        },
        {
          key: 'picture-books',
          title: 'AI 绘本',
          subtitle: '查看并继续故事绘本',
          badge: 'M10',
        },
        {
          key: 'animations',
          title: 'AI 动画',
          subtitle: '查看故事动画作品',
          badge: 'M11',
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

  const [existing] = await db
    .select({ id: cmsSections.id })
    .from(cmsSections)
    .where(eq(cmsSections.pageId, page.id))
    .limit(1);
  if (existing)
    return { seeded: false as const, count: 0, reason: 'CMS_ALREADY_CONFIGURED' as const };

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
