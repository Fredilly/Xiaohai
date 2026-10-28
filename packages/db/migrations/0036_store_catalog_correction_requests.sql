-- Daily product metadata correction requests are separate from one-time Meiping history.
-- Accepted means recommendation accepted for HQ handling, NOT live catalog or stock mutation.
CREATE TABLE "catalog_correction_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "public"."stores"("id") ON DELETE restrict,
  "sku_id" uuid NOT NULL REFERENCES "public"."skus"("id") ON DELETE restrict,
  "source_product_id" uuid NOT NULL,
  "field" text NOT NULL,
  "original_value" text,
  "proposed_value" text NOT NULL,
  "expected_inventory_version" integer NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "requested_by_staff_account_id" uuid NOT NULL REFERENCES "public"."staff_accounts"("id") ON DELETE restrict,
  "reviewed_by_staff_account_id" uuid REFERENCES "public"."staff_accounts"("id") ON DELETE restrict,
  "review_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "reviewed_at" timestamptz,
  CONSTRAINT "catalog_correction_requests_field_check" CHECK ("field" IN ('productName', 'bookTitle', 'author', 'publisher', 'isbn', 'priceMinor')),
  CONSTRAINT "catalog_correction_requests_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  CONSTRAINT "catalog_correction_requests_version_check" CHECK ("expected_inventory_version" >= 0),
  CONSTRAINT "catalog_correction_requests_reason_check" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "catalog_correction_requests_value_check" CHECK (length(trim("proposed_value")) > 0),
  CONSTRAINT "catalog_correction_requests_review_shape_check" CHECK (
    ("status" = 'PENDING' AND "reviewed_by_staff_account_id" IS NULL AND "review_reason" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" IN ('ACCEPTED','REJECTED') AND "reviewed_by_staff_account_id" IS NOT NULL AND "review_reason" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "catalog_correction_requests_store_created_idx" ON "catalog_correction_requests" ("store_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_correction_requests_one_pending_idx" ON "catalog_correction_requests" ("store_id", "sku_id", "field") WHERE "status" = 'PENDING';
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name")
VALUES ('catalog.correction.review', 'Review daily catalog correction requests; does not apply master data')
ON CONFLICT ("key") DO NOTHING;
