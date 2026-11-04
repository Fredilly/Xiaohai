-- Direct store catalog editing keeps shared master data separate from store-local metadata.
-- All writes remain versioned, scoped and audited by the API service.
ALTER TABLE "books" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "book_editions" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "products" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "skus" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;

ALTER TABLE "books" ADD CONSTRAINT "books_version_nonnegative_check" CHECK ("version" >= 0);
ALTER TABLE "book_editions" ADD CONSTRAINT "book_editions_version_nonnegative_check" CHECK ("version" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_version_nonnegative_check" CHECK ("version" >= 0);
ALTER TABLE "skus" ADD CONSTRAINT "skus_version_nonnegative_check" CHECK ("version" >= 0);

CREATE TABLE "store_catalog_metadata" (
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
CREATE INDEX "store_catalog_metadata_sku_idx" ON "store_catalog_metadata" ("sku_id");
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name", "description")
VALUES ('catalog.edit', 'Edit authorized store catalog', 'Edit shared catalog fields and store-local metadata within authorized store scope')
ON CONFLICT ("key") DO NOTHING;
