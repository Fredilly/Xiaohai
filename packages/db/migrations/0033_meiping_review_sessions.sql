CREATE TABLE "meiping_review_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "public"."stores"("id") ON DELETE restrict,
  "source_checksum" text NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "report" jsonb NOT NULL,
  "created_by_staff_account_id" uuid NOT NULL REFERENCES "public"."staff_accounts"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meiping_review_sessions_status_check" CHECK ("status" = 'DRAFT'),
  CONSTRAINT "meiping_review_sessions_checksum_check" CHECK (length("source_checksum") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meiping_review_sessions_store_checksum_unique"
  ON "meiping_review_sessions" ("store_id","source_checksum");
--> statement-breakpoint
CREATE INDEX "meiping_review_sessions_store_created_idx"
  ON "meiping_review_sessions" ("store_id","created_at");
--> statement-breakpoint
CREATE TABLE "meiping_review_decisions" (
  "session_id" uuid NOT NULL REFERENCES "public"."meiping_review_sessions"("id") ON DELETE restrict,
  "source_row_number" integer NOT NULL,
  "action" text NOT NULL,
  "counted_quantity" integer,
  "reason" text,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_staff_account_id" uuid NOT NULL REFERENCES "public"."staff_accounts"("id") ON DELETE restrict,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meiping_review_decisions_pk" PRIMARY KEY ("session_id","source_row_number"),
  CONSTRAINT "meiping_review_decisions_source_row_positive" CHECK ("source_row_number" > 0),
  CONSTRAINT "meiping_review_decisions_version_positive" CHECK ("version" > 0),
  CONSTRAINT "meiping_review_decisions_action_check"
    CHECK (("action" = 'CREATE_DRAFT' AND "counted_quantity" >= 0 AND "reason" IS NULL)
      OR ("action" = 'EXCLUDE' AND "counted_quantity" IS NULL AND length(trim("reason")) > 0))
);
