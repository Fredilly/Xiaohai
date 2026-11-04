-- Safe forward repair for existing stacked PR156 -> PR157 environments.
-- 0037 has an older Drizzle journal timestamp than 0036. Databases already
-- migrated through 0036 may therefore skip 0037. Never renumber or rewrite
-- already-recorded migration timestamps: that could re-run 0037 on UAT DBs.
-- This 0038 migration is idempotent for both upgrade and fresh-install paths.
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "book_editions" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $repair$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'books_version_nonnegative_check' AND conrelid = 'books'::regclass
  ) THEN
    ALTER TABLE "books" ADD CONSTRAINT "books_version_nonnegative_check" CHECK ("version" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'book_editions_version_nonnegative_check'
      AND conrelid = 'book_editions'::regclass
  ) THEN
    ALTER TABLE "book_editions" ADD CONSTRAINT "book_editions_version_nonnegative_check" CHECK ("version" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_version_nonnegative_check' AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_version_nonnegative_check" CHECK ("version" >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'skus_version_nonnegative_check' AND conrelid = 'skus'::regclass
  ) THEN
    ALTER TABLE "skus" ADD CONSTRAINT "skus_version_nonnegative_check" CHECK ("version" >= 0);
  END IF;
END
$repair$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_catalog_metadata" (
  "store_id" uuid NOT NULL REFERENCES "public"."stores"("id") ON DELETE restrict,
  "sku_id" uuid NOT NULL REFERENCES "public"."skus"("id") ON DELETE restrict,
  "shelf_location" text,
  "store_note" text,
  "display_info" text,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "store_catalog_metadata_pk" PRIMARY KEY ("store_id", "sku_id"),
  CONSTRAINT "store_catalog_metadata_version_nonnegative_check" CHECK ("version" >= 0),
  CONSTRAINT "store_catalog_metadata_text_length_check" CHECK (
    ("shelf_location" IS NULL OR length("shelf_location") <= 160) AND
    ("store_note" IS NULL OR length("store_note") <= 2000) AND
    ("display_info" IS NULL OR length("display_info") <= 2000)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_catalog_metadata_sku_idx"
  ON "store_catalog_metadata" ("sku_id");
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name", "description")
VALUES (
  'catalog.edit',
  'Edit authorized store catalog',
  'Edit shared catalog fields and store-local metadata within authorized store scope'
)
ON CONFLICT ("key") DO NOTHING;
