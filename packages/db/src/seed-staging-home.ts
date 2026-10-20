import { eq } from 'drizzle-orm';
import { books, bookEditions, products, skus } from './commerce-schema.js';
import { cmsPages, cmsSections } from './cms-schema.js';
import type { createDatabase } from './client.js';

type Database = ReturnType<typeof createDatabase>['db'];

const STAGING_SEED_MARKER = 'staging-home-seed-v1';

/**
 * Idempotent staging seed for homepage content:
 * - Books with editions/products/SKUs for the shop section
 * - CMS sections: HERO banner, FEATURE_GRID, BANNER carousel, CONTENT_LIST for stories
 *
 * Safe to re-run: skips if marker section already exists.
 * Never runs in production.
 */
export async function seedStagingHome(db: Database) {
  if (process.env.APP_ENV !== 'staging') {
    throw new Error('Staging seed requires APP_ENV=staging.');
  }

  // Ensure HOME page exists (migration 0004 inserts it, but be safe)
  const [page] = await db.select().from(cmsPages).where(eq(cmsPages.key, 'HOME')).limit(1);
  if (!page) {
    return { seeded: false as const, reason: 'HOME_PAGE_MISSING' as const };
  }

  // Check if staging seed was already applied via marker section
  const existing = await db.select().from(cmsSections).where(eq(cmsSections.pageId, page.id));

  const hasMarker = existing.some(
    (s) =>
      s.sectionType === 'HERO' &&
      s.config &&
      typeof s.config === 'object' &&
      '_seedMarker' in (s.config as Record<string, unknown>) &&
      (s.config as Record<string, unknown>)._seedMarker === STAGING_SEED_MARKER,
  );

  if (hasMarker) {
    return { seeded: false as const, reason: 'ALREADY_SEEDED' as const };
  }

  // If there are existing non-marker sections, leave them alone
  if (existing.length > 0) {
    return { seeded: false as const, reason: 'CMS_ALREADY_CONFIGURED' as const };
  }

  // Seed books for the shop section
  const seededBooks = await seedStagingBooks(db);

  // Seed CMS sections
  const sections = buildStagingSections(seededBooks);
  const inserted = await db
    .insert(cmsSections)
    .values(sections.map((section) => ({ ...section, pageId: page.id })))
    .returning({ id: cmsSections.id });

  return {
    seeded: true as const,
    sectionCount: inserted.length,
    bookCount: seededBooks.length,
    reason: null,
  };
}

async function seedStagingBooks(db: Database) {
  const bookData = [
    {
      title: '小海童话·星空冒险',
      author: '小海创作团队',
      description: '一个关于勇气和友谊的星际冒险故事，适合3-8岁儿童。',
      isbn: '978-7-0000-0001-0',
      publisher: '小海出版社',
      productName: '《小海童话·星空冒险》精装版',
      skuCode: 'XH-STORY-001-HC',
      priceMinor: 4990,
    },
    {
      title: '小海童话·海底世界',
      author: '小海创作团队',
      description: '探索神秘的海底王国，认识奇妙的海洋生物。',
      isbn: '978-7-0000-0002-0',
      publisher: '小海出版社',
      productName: '《小海童话·海底世界》精装版',
      skuCode: 'XH-STORY-002-HC',
      priceMinor: 4590,
    },
    {
      title: '小海童话·森林音乐会',
      author: '小海创作团队',
      description: '小动物们举办了一场奇妙的森林音乐会，每个音符都有魔法。',
      isbn: '978-7-0000-0003-0',
      publisher: '小海出版社',
      productName: '《小海童话·森林音乐会》精装版',
      skuCode: 'XH-STORY-003-HC',
      priceMinor: 4290,
    },
  ];

  const results: Array<{ bookId: string; title: string }> = [];

  for (const item of bookData) {
    // Upsert book by title
    let [book] = await db.select().from(books).where(eq(books.title, item.title)).limit(1);
    if (!book) {
      [book] = await db
        .insert(books)
        .values({ title: item.title, author: item.author, description: item.description })
        .returning();
    }
    if (!book) continue;

    // Upsert edition by ISBN
    let [edition] = await db
      .select()
      .from(bookEditions)
      .where(eq(bookEditions.isbn, item.isbn))
      .limit(1);
    if (!edition) {
      [edition] = await db
        .insert(bookEditions)
        .values({ bookId: book.id, isbn: item.isbn, publisher: item.publisher })
        .returning();
    }
    if (!edition) continue;

    // Upsert product
    let [product] = await db
      .select()
      .from(products)
      .where(eq(products.name, item.productName))
      .limit(1);
    if (!product) {
      [product] = await db
        .insert(products)
        .values({
          bookEditionId: edition.id,
          name: item.productName,
          description: item.description,
          status: 'ACTIVE',
        })
        .returning();
    }
    if (!product) continue;

    // Upsert SKU
    const [existingSku] = await db.select().from(skus).where(eq(skus.code, item.skuCode)).limit(1);
    if (!existingSku) {
      await db.insert(skus).values({
        productId: product.id,
        code: item.skuCode,
        name: item.productName,
        priceMinor: item.priceMinor,
        status: 'ACTIVE',
        availableForSale: true,
      });
    }

    results.push({ bookId: book.id, title: book.title });
  }

  return results;
}

function buildStagingSections(seededBooks: Array<{ bookId: string; title: string }>) {
  return [
    {
      sectionType: 'HERO' as const,
      title: '用小海 AI 创造属于你的故事',
      subtitle: '从一个想法开始，AI 帮你编织完整的故事、绘本和动画。',
      displayOrder: 0,
      enabled: true,
      publicationState: 'PUBLISHED' as const,
      config: {
        eyebrow: '小海童话 · Staging',
        _seedMarker: STAGING_SEED_MARKER,
      },
      mediaUrl: null,
      action: { type: 'PREVIEW', target: 'story-create' },
    },
    {
      sectionType: 'BANNER' as const,
      title: '本周推荐',
      subtitle: '精选故事与活动',
      displayOrder: 1,
      enabled: true,
      publicationState: 'PUBLISHED' as const,
      config: {
        items: [
          {
            key: 'banner-new-story',
            title: '🌟 新故事上线：星空冒险',
            subtitle: '和小海一起探索宇宙的奥秘',
            imageUrl: null,
            linkTarget: 'story-create',
          },
          {
            key: 'banner-picture-book',
            title: '🎨 AI 绘本工坊',
            subtitle: '把你的故事变成精美绘本',
            imageUrl: null,
            linkTarget: 'picture-books',
          },
          {
            key: 'banner-animation',
            title: '🎬 故事动画',
            subtitle: '让角色动起来',
            imageUrl: null,
            linkTarget: 'animations',
          },
        ],
      },
      mediaUrl: null,
      action: null,
    },
    {
      sectionType: 'FEATURE_GRID' as const,
      title: '开始探索',
      subtitle: '找到你喜欢的故事方式',
      displayOrder: 2,
      enabled: true,
      publicationState: 'PUBLISHED' as const,
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
    {
      sectionType: 'CONTENT_LIST' as const,
      title: '热门图书',
      subtitle: '小海精选童书',
      displayOrder: 3,
      enabled: true,
      publicationState: 'PUBLISHED' as const,
      config: {
        contentType: 'books',
        items: seededBooks.map((b) => ({
          bookId: b.bookId,
          title: b.title,
        })),
      },
      mediaUrl: null,
      action: { type: 'LINK', target: '/shop' },
    },
  ];
}
