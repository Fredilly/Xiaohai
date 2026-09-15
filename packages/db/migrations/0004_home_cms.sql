CREATE TABLE "cms_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "title" text NOT NULL,
  "publication_state" text DEFAULT 'DRAFT' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_pages_publication_state_check" CHECK ("cms_pages"."publication_state" in ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "cms_pages_version_positive" CHECK ("cms_pages"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_pages_key_unique" ON "cms_pages" USING btree ("key");
--> statement-breakpoint
CREATE TABLE "cms_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" uuid NOT NULL,
  "section_type" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text,
  "display_order" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" jsonb NOT NULL,
  "media_url" text,
  "action" jsonb,
  "publication_state" text DEFAULT 'DRAFT' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cms_sections_type_check" CHECK ("cms_sections"."section_type" in ('HERO', 'FEATURE_GRID', 'CONTENT_LIST', 'BANNER')),
  CONSTRAINT "cms_sections_publication_state_check" CHECK ("cms_sections"."publication_state" in ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "cms_sections_display_order_nonnegative" CHECK ("cms_sections"."display_order" >= 0),
  CONSTRAINT "cms_sections_version_positive" CHECK ("cms_sections"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "cms_sections" ADD CONSTRAINT "cms_sections_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "cms_sections_page_display_order_unique" ON "cms_sections" USING btree ("page_id", "display_order");
--> statement-breakpoint
CREATE INDEX "cms_sections_public_home_idx" ON "cms_sections" USING btree ("page_id", "publication_state", "enabled", "display_order");
--> statement-breakpoint
INSERT INTO "cms_pages" ("key", "title", "publication_state") VALUES ('HOME', '首页', 'PUBLISHED') ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name", "description") VALUES ('cms.home.manage', '首页 CMS 管理', '查看和管理全局首页 CMS 内容') ON CONFLICT ("key") DO NOTHING;
