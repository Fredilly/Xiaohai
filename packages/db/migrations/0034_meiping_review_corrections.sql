CREATE TABLE "meiping_review_corrections" (
  "session_id" uuid NOT NULL REFERENCES "public"."meiping_review_sessions"("id") ON DELETE restrict,
  "source_row_number" integer NOT NULL,
  "proposed_fields" jsonb NOT NULL,
  "reason" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_staff_account_id" uuid NOT NULL REFERENCES "public"."staff_accounts"("id") ON DELETE restrict,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meiping_review_corrections_pk" PRIMARY KEY ("session_id","source_row_number"),
  CONSTRAINT "meiping_review_corrections_row_positive" CHECK ("source_row_number" > 0),
  CONSTRAINT "meiping_review_corrections_version_positive" CHECK ("version" > 0),
  CONSTRAINT "meiping_review_corrections_reason_check" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "meiping_review_corrections_fields_check"
    CHECK (jsonb_typeof("proposed_fields") = 'object' AND "proposed_fields" <> '{}'::jsonb)
);
