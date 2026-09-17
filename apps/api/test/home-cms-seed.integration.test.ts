import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cmsPages, cmsSections, createDatabase, seedLocalHomeCms } from '@xiaohai/db';
import { HomeCmsService } from '../src/cms/home-cms-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M4 local Home CMS seed integration', () => {
  const cms = new HomeCmsService(database!.db);

  beforeEach(async () => {
    await database!.db.delete(cmsSections);
    await database!.db.delete(cmsPages);
    await database!.db
      .insert(cmsPages)
      .values({ key: 'HOME', title: '首页', publicationState: 'PUBLISHED' });
  });

  afterAll(async () => database?.pool.end());

  it('seeds a useful default Home when CMS is empty', async () => {
    const result = await seedLocalHomeCms(database!.db);
    expect(result).toEqual({ seeded: true, count: 2, reason: null });

    const home = await cms.getPublicHome();
    expect(home.sections.map((section) => section.sectionType)).toEqual(['HERO', 'FEATURE_GRID']);
    expect(home.sections[0]?.title).toBe('欢迎来到小海童话');
  });

  it('does not overwrite or append to existing CMS content', async () => {
    const [page] = await database!.db.select().from(cmsPages).where(eq(cmsPages.key, 'HOME'));
    await database!.db.insert(cmsSections).values({
      pageId: page!.id,
      sectionType: 'BANNER',
      title: '运营自定义首页',
      displayOrder: 0,
      enabled: true,
      publicationState: 'PUBLISHED',
      config: { body: 'real CMS content wins' },
    });

    const result = await seedLocalHomeCms(database!.db);
    expect(result).toEqual({ seeded: false, count: 0, reason: 'CMS_ALREADY_CONFIGURED' });

    const home = await cms.getPublicHome();
    expect(home.sections.map((section) => section.title)).toEqual(['运营自定义首页']);
  });
});
