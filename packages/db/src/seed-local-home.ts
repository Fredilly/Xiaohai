import { eq } from 'drizzle-orm';
import { cmsPages, cmsSections } from './cms-schema.js';
import type { createDatabase } from './client.js';

type Database = ReturnType<typeof createDatabase>['db'];

export const DEFAULT_LOCAL_HOME_SECTIONS = [
  {
    sectionType: 'HERO',
    title: '欢迎来到小海童话',
    subtitle: '这是本地开发默认首页内容，可随时通过 CMS 配置替换。',
    displayOrder: 0,
    enabled: true,
    publicationState: 'PUBLISHED',
    config: { eyebrow: 'DEV / LOCAL' },
    mediaUrl: null,
    action: null,
  },
  {
    sectionType: 'FEATURE_GRID',
    title: '开始探索',
    subtitle: '开发环境默认入口',
    displayOrder: 1,
    enabled: true,
    publicationState: 'PUBLISHED',
    config: {
      items: [
        {
          key: 'shop',
          title: '小海商城',
          subtitle: '浏览图书与商品',
          badge: 'DEV',
        },
        {
          key: 'ai',
          title: '小海 AI',
          subtitle: '开始故事创作',
          badge: 'DEV',
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
