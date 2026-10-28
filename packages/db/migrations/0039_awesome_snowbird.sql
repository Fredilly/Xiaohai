CREATE TABLE "meiping_review_correction_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_row_number" integer NOT NULL,
	"proposed_fields" jsonb NOT NULL,
	"reason" text NOT NULL,
	"version" integer NOT NULL,
	"updated_by_staff_account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meiping_review_decision_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_row_number" integer NOT NULL,
	"action" text NOT NULL,
	"counted_quantity" integer,
	"reason" text,
	"version" integer NOT NULL,
	"updated_by_staff_account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meiping_review_correction_history_version_unique" ON "meiping_review_correction_history" USING btree ("session_id","source_row_number","version");--> statement-breakpoint
CREATE INDEX "meiping_review_correction_history_row_idx" ON "meiping_review_correction_history" USING btree ("session_id","source_row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "meiping_review_decision_history_version_unique" ON "meiping_review_decision_history" USING btree ("session_id","source_row_number","version");--> statement-breakpoint
CREATE INDEX "meiping_review_decision_history_row_idx" ON "meiping_review_decision_history" USING btree ("session_id","source_row_number");
--> statement-breakpoint
INSERT INTO "meiping_review_decision_history" (
  "session_id", "source_row_number", "action", "counted_quantity", "reason",
  "version", "updated_by_staff_account_id", "updated_at"
)
SELECT "session_id", "source_row_number", "action", "counted_quantity", "reason",
  "version", "updated_by_staff_account_id", "updated_at"
FROM "meiping_review_decisions"
ON CONFLICT ("session_id", "source_row_number", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "meiping_review_correction_history" (
  "session_id", "source_row_number", "proposed_fields", "reason",
  "version", "updated_by_staff_account_id", "updated_at"
)
SELECT "session_id", "source_row_number", "proposed_fields", "reason",
  "version", "updated_by_staff_account_id", "updated_at"
FROM "meiping_review_corrections"
ON CONFLICT ("session_id", "source_row_number", "version") DO NOTHING;
