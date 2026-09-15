CREATE TABLE "migration_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" text NOT NULL,
  "source_reference" text NOT NULL,
  "raw_reference" text,
  "checksum" text NOT NULL,
  "status" text DEFAULT 'STAGED' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "migration_batches_status_check" CHECK ("migration_batches"."status" in ('STAGED', 'DRY_RUN', 'REVIEW', 'IMPORT_PLANNED', 'IMPORTED', 'RECONCILED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_batches_source_checksum_unique" ON "migration_batches" USING btree ("source_type", "checksum");
--> statement-breakpoint
CREATE TABLE "migration_book_staging" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "source_row_number" integer NOT NULL,
  "raw_values" jsonb NOT NULL,
  "normalized_values" jsonb,
  "validation_state" text DEFAULT 'PENDING' NOT NULL,
  "import_state" text DEFAULT 'NOT_PLANNED' NOT NULL,
  "issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "fingerprint" text,
  "normalized_price_minor" integer,
  "normalized_inventory" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "migration_book_staging_source_row_positive" CHECK ("migration_book_staging"."source_row_number" > 0),
  CONSTRAINT "migration_book_staging_price_nonnegative" CHECK ("migration_book_staging"."normalized_price_minor" is null or "migration_book_staging"."normalized_price_minor" >= 0),
  CONSTRAINT "migration_book_staging_inventory_nonnegative" CHECK ("migration_book_staging"."normalized_inventory" is null or "migration_book_staging"."normalized_inventory" >= 0),
  CONSTRAINT "migration_book_staging_validation_state_check" CHECK ("migration_book_staging"."validation_state" in ('PENDING', 'VALID', 'WARNING', 'ERROR', 'DUPLICATE', 'CONFLICT')),
  CONSTRAINT "migration_book_staging_import_state_check" CHECK ("migration_book_staging"."import_state" in ('NOT_PLANNED', 'PLANNED', 'IMPORTED', 'SKIPPED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "migration_book_staging" ADD CONSTRAINT "migration_book_staging_batch_id_migration_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."migration_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "migration_book_staging_batch_row_unique" ON "migration_book_staging" USING btree ("batch_id", "source_row_number");
--> statement-breakpoint
CREATE INDEX "migration_book_staging_batch_idx" ON "migration_book_staging" USING btree ("batch_id");
