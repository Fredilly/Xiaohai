import { and, asc, eq, sql } from 'drizzle-orm';
import {
  adminHomeResponseSchema,
  cmsSectionInputSchema,
  cmsSectionSchema,
  publicHomeResponseSchema,
  type CmsSectionInput,
  type ReorderCmsSectionsRequest,
  type UpdateCmsSectionRequest,
} from '@xiaohai/contracts';
import { cmsPages, cmsSections, type createDatabase } from '@xiaohai/db';

export const HOME_CMS_PERMISSION = 'cms.home.manage';

type Database = ReturnType<typeof createDatabase>['db'];

export class CmsNotFoundError extends Error {}
export class CmsConflictError extends Error {}

export class HomeCmsService {
  constructor(private readonly db: Database) {}

  async getPublicHome() {
    const page = await this.getHomePage();
    if (page.publicationState !== 'PUBLISHED') {
      return publicHomeResponseSchema.parse({ page: { key: 'HOME', title: page.title }, sections: [] });
    }
    const rows = await this.db
      .select()
      .from(cmsSections)
      .where(
        and(
          eq(cmsSections.pageId, page.id),
          eq(cmsSections.enabled, true),
          eq(cmsSections.publicationState, 'PUBLISHED'),
        ),
      )
      .orderBy(asc(cmsSections.displayOrder), asc(cmsSections.id));
    const sections = rows.flatMap((row) => {
      const parsed = cmsSectionSchema.safeParse(toSection(row));
      if (!parsed.success) return [];
      const { publicationState: _publicationState, enabled: _enabled, version: _version, updatedAt: _updatedAt, ...publicSection } = parsed.data;
      return [publicSection];
    });
    return publicHomeResponseSchema.parse({ page: { key: 'HOME', title: page.title }, sections });
  }

  async getAdminHome() {
    const page = await this.getHomePage();
    const rows = await this.db
      .select()
      .from(cmsSections)
      .where(eq(cmsSections.pageId, page.id))
      .orderBy(asc(cmsSections.displayOrder), asc(cmsSections.id));
    return adminHomeResponseSchema.parse({
      page: {
        key: 'HOME',
        title: page.title,
        publicationState: page.publicationState,
        version: page.version,
      },
      sections: rows.map(toSection),
    });
  }

  async createSection(input: CmsSectionInput) {
    const page = await this.getHomePage();
    const validated = cmsSectionInputSchema.parse(input);
    try {
      const [created] = await this.db
        .insert(cmsSections)
        .values({ pageId: page.id, ...toDatabaseInput(validated) })
        .returning();
      if (!created) throw new Error('CMS section insert returned no row');
      return cmsSectionSchema.parse(toSection(created));
    } catch (error) {
      if (isUniqueViolation(error)) throw new CmsConflictError('Display order already exists');
      throw error;
    }
  }

  async updateSection(id: string, input: UpdateCmsSectionRequest) {
    const page = await this.getHomePage();
    const [current] = await this.db
      .select()
      .from(cmsSections)
      .where(and(eq(cmsSections.id, id), eq(cmsSections.pageId, page.id)))
      .limit(1);
    if (!current) throw new CmsNotFoundError('CMS section not found');
    const merged = cmsSectionInputSchema.parse({
      sectionType: input.sectionType ?? current.sectionType,
      title: input.title ?? current.title,
      subtitle: input.subtitle === undefined ? current.subtitle : input.subtitle,
      displayOrder: input.displayOrder ?? current.displayOrder,
      enabled: input.enabled ?? current.enabled,
      config: input.config ?? current.config,
      mediaUrl: input.mediaUrl === undefined ? current.mediaUrl : input.mediaUrl,
      action: input.action === undefined ? current.action : input.action,
      publicationState: input.publicationState ?? current.publicationState,
    });
    try {
      const [updated] = await this.db
        .update(cmsSections)
        .set({ ...toDatabaseInput(merged), version: sql`${cmsSections.version} + 1`, updatedAt: new Date() })
        .where(and(eq(cmsSections.id, id), eq(cmsSections.pageId, page.id), eq(cmsSections.version, input.version)))
        .returning();
      if (!updated) throw new CmsConflictError('CMS section was modified by another editor');
      return cmsSectionSchema.parse(toSection(updated));
    } catch (error) {
      if (isUniqueViolation(error)) throw new CmsConflictError('Display order already exists');
      throw error;
    }
  }

  async reorderSections(input: ReorderCmsSectionsRequest) {
    const page = await this.getHomePage();
    await this.db.transaction(async (tx) => {
      for (const item of input.items) {
        const [current] = await tx
          .select({ version: cmsSections.version })
          .from(cmsSections)
          .where(and(eq(cmsSections.id, item.id), eq(cmsSections.pageId, page.id)))
          .limit(1);
        if (!current) throw new CmsNotFoundError('CMS section not found');
        if (current.version !== item.version)
          throw new CmsConflictError('CMS section was modified by another editor');
      }
      for (const [index, item] of input.items.entries()) {
        await tx
          .update(cmsSections)
          .set({ displayOrder: 100000 + index })
          .where(and(eq(cmsSections.id, item.id), eq(cmsSections.pageId, page.id)));
      }
      for (const item of input.items) {
        await tx
          .update(cmsSections)
          .set({ displayOrder: item.displayOrder, version: sql`${cmsSections.version} + 1`, updatedAt: new Date() })
          .where(and(eq(cmsSections.id, item.id), eq(cmsSections.pageId, page.id)));
      }
    });
    return this.getAdminHome();
  }

  async updatePagePublication(publicationState: 'DRAFT' | 'PUBLISHED', version: number) {
    const page = await this.getHomePage();
    const [updated] = await this.db
      .update(cmsPages)
      .set({ publicationState, version: sql`${cmsPages.version} + 1`, updatedAt: new Date() })
      .where(and(eq(cmsPages.id, page.id), eq(cmsPages.version, version)))
      .returning();
    if (!updated) throw new CmsConflictError('CMS page was modified by another editor');
    return this.getAdminHome();
  }

  private async getHomePage() {
    const [page] = await this.db.select().from(cmsPages).where(eq(cmsPages.key, 'HOME')).limit(1);
    if (!page) throw new CmsNotFoundError('HOME CMS page not found');
    return page;
  }
}

function toDatabaseInput(input: CmsSectionInput) {
  return {
    sectionType: input.sectionType,
    title: input.title,
    subtitle: input.subtitle ?? null,
    displayOrder: input.displayOrder,
    enabled: input.enabled,
    config: input.config,
    mediaUrl: input.mediaUrl ?? null,
    action: input.action ?? null,
    publicationState: input.publicationState,
  };
}

function toSection(row: typeof cmsSections.$inferSelect) {
  return {
    id: row.id,
    sectionType: row.sectionType,
    title: row.title,
    subtitle: row.subtitle,
    displayOrder: row.displayOrder,
    enabled: row.enabled,
    config: row.config,
    mediaUrl: row.mediaUrl,
    action: row.action,
    publicationState: row.publicationState,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
