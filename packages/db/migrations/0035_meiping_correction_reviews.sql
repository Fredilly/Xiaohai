CREATE TABLE "meiping_correction_reviews" (
  "session_id" uuid NOT NULL REFERENCES "public"."meiping_review_sessions"("id") ON DELETE restrict,
  "source_row_number" integer NOT NULL,
  "correction_version" integer NOT NULL,
  "verdict" text NOT NULL,
  "reason" text NOT NULL,
  "reviewed_by_staff_account_id" uuid NOT NULL REFERENCES "public"."staff_accounts"("id") ON DELETE restrict,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meiping_correction_reviews_pk"
    PRIMARY KEY ("session_id","source_row_number","correction_version"),
  CONSTRAINT "meiping_correction_reviews_source_row_positive" CHECK ("source_row_number" > 0),
  CONSTRAINT "meiping_correction_reviews_correction_version_positive" CHECK ("correction_version" > 0),
  CONSTRAINT "meiping_correction_reviews_verdict_check" CHECK ("verdict" IN ('ACCEPTED','REJECTED')),
  CONSTRAINT "meiping_correction_reviews_reason_check" CHECK (length(trim("reason")) > 0)
);
--> statement-breakpoint
CREATE INDEX "meiping_correction_reviews_session_idx" ON "meiping_correction_reviews" ("session_id");
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name")
VALUES ('meiping.correction.review', 'Review human Meiping correction proposals (not import approval)')
ON CONFLICT ("key") DO NOTHING;
