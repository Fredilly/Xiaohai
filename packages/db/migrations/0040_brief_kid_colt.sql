CREATE TABLE "meiping_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_session_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"source_checksum" text NOT NULL,
	"status" text DEFAULT 'PREVIEW' NOT NULL,
	"plan" jsonb NOT NULL,
	"result" jsonb,
	"idempotency_key" text NOT NULL,
	"created_by_staff_account_id" uuid NOT NULL,
	"approved_by_staff_account_id" uuid,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meiping_import_batches_status_check" CHECK ("status" IN ('PREVIEW','APPROVED','EXECUTING','SUCCEEDED','FAILED')),
	CONSTRAINT "meiping_import_batches_checksum_check" CHECK (length("source_checksum") = 64)
);
--> statement-breakpoint
CREATE TABLE "meiping_import_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_row_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"book_id" uuid,
	"book_edition_id" uuid,
	"product_id" uuid,
	"sku_id" uuid,
	"counted_quantity" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meiping_import_results_row_positive" CHECK ("source_row_number" > 0),
	CONSTRAINT "meiping_import_results_outcome_check" CHECK ("outcome" IN ('CREATED','REUSED','EXCLUDED','CONFLICT','FAILED')),
	CONSTRAINT "meiping_import_results_quantity_check" CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "meiping_import_batches" ADD CONSTRAINT "meiping_import_batches_review_session_id_meiping_review_sessions_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."meiping_review_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_batches" ADD CONSTRAINT "meiping_import_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_batches" ADD CONSTRAINT "meiping_import_batches_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_batches" ADD CONSTRAINT "meiping_import_batches_approved_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("approved_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_results" ADD CONSTRAINT "meiping_import_results_batch_id_meiping_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."meiping_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_results" ADD CONSTRAINT "meiping_import_results_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_results" ADD CONSTRAINT "meiping_import_results_book_edition_id_book_editions_id_fk" FOREIGN KEY ("book_edition_id") REFERENCES "public"."book_editions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_results" ADD CONSTRAINT "meiping_import_results_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meiping_import_results" ADD CONSTRAINT "meiping_import_results_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meiping_import_batches_session_unique" ON "meiping_import_batches" USING btree ("review_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meiping_import_batches_idempotency_unique" ON "meiping_import_batches" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "meiping_import_batches_store_status_idx" ON "meiping_import_batches" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meiping_import_results_batch_row_unique" ON "meiping_import_results" USING btree ("batch_id","source_row_number");--> statement-breakpoint
CREATE INDEX "meiping_import_results_batch_outcome_idx" ON "meiping_import_results" USING btree ("batch_id","outcome");
--> statement-breakpoint
ALTER TABLE "inventory_transactions" DROP CONSTRAINT IF EXISTS "inventory_transactions_type_check";
--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_type_check" CHECK ("transaction_type" IN ('INITIAL_MIGRATION','PURCHASE_RECEIPT','SALE','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT','STOCKTAKE_GAIN','STOCKTAKE_LOSS','TRANSFER_OUT','TRANSFER_IN','RETURN_TO_SUPPLIER','RENTAL_OUT','RENTAL_RETURN'));
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name", "description") VALUES
  ('meiping.import.preview', 'Preview Meiping import', 'Create a dry-run plan from a persisted Meiping review session'),
  ('meiping.import.approve', 'Approve Meiping import', 'Grant independent final approval for a Meiping import batch'),
  ('meiping.import.execute', 'Execute Meiping import', 'Execute an approved Meiping import batch in an enabled environment')
ON CONFLICT ("key") DO NOTHING;
