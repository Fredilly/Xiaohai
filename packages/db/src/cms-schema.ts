import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const cmsPages = pgTable(
  'cms_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    publicationState: text('publication_state').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cms_pages_key_unique').on(table.key),
    check('cms_pages_publication_state_check', sql`${table.publicationState} in ('DRAFT', 'PUBLISHED')`),
    check('cms_pages_version_positive', sql`${table.version} > 0`),
  ],
);

export const cmsSections = pgTable(
  'cms_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => cmsPages.id, { onDelete: 'cascade' }),
    sectionType: text('section_type').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    displayOrder: integer('display_order').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    mediaUrl: text('media_url'),
    action: jsonb('action').$type<Record<string, unknown> | null>(),
    publicationState: text('publication_state').notNull().default('DRAFT'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cms_sections_page_display_order_unique').on(table.pageId, table.displayOrder),
    index('cms_sections_public_home_idx').on(
      table.pageId,
      table.publicationState,
      table.enabled,
      table.displayOrder,
    ),
    check(
      'cms_sections_type_check',
      sql`${table.sectionType} in ('HERO', 'FEATURE_GRID', 'CONTENT_LIST', 'BANNER')`,
    ),
    check(
      'cms_sections_publication_state_check',
      sql`${table.publicationState} in ('DRAFT', 'PUBLISHED')`,
    ),
    check('cms_sections_display_order_nonnegative', sql`${table.displayOrder} >= 0`),
    check('cms_sections_version_positive', sql`${table.version} > 0`),
  ],
);
