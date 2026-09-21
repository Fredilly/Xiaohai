CREATE TABLE "finance_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"source_kind" text NOT NULL,
	"payment_ledger_id" uuid,
	"commission_event_id" uuid,
	"event_type" text NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"cash_delta_minor" integer DEFAULT 0 NOT NULL,
	"commission_frozen_delta_minor" integer DEFAULT 0 NOT NULL,
	"commission_available_delta_minor" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_ledger_source_shape_check" CHECK (("finance_ledger_entries"."source_kind" = 'PAYMENT_LEDGER' and "finance_ledger_entries"."payment_ledger_id" is not null and "finance_ledger_entries"."commission_event_id" is null)
        or ("finance_ledger_entries"."source_kind" = 'COMMISSION_EVENT' and "finance_ledger_entries"."payment_ledger_id" is null and "finance_ledger_entries"."commission_event_id" is not null)),
	CONSTRAINT "finance_ledger_event_type_check" CHECK ("finance_ledger_entries"."event_type" in ('PAYMENT','REFUND','COMMISSION_FROZEN','COMMISSION_SETTLED','COMMISSION_REVERSED','WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_PAID')),
	CONSTRAINT "finance_ledger_currency_check" CHECK ("finance_ledger_entries"."currency" = 'CNY'),
	CONSTRAINT "finance_ledger_nonzero_check" CHECK ("finance_ledger_entries"."cash_delta_minor" <> 0 or "finance_ledger_entries"."commission_frozen_delta_minor" <> 0 or "finance_ledger_entries"."commission_available_delta_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "finance_reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"finance_ledger_entry_id" uuid,
	"outcome" text NOT NULL,
	"expected_cash_delta_minor" integer NOT NULL,
	"actual_cash_delta_minor" integer,
	"expected_commission_frozen_delta_minor" integer NOT NULL,
	"actual_commission_frozen_delta_minor" integer,
	"expected_commission_available_delta_minor" integer NOT NULL,
	"actual_commission_available_delta_minor" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_reconciliation_item_source_kind_check" CHECK ("finance_reconciliation_items"."source_kind" in ('PAYMENT_LEDGER','COMMISSION_EVENT')),
	CONSTRAINT "finance_reconciliation_item_outcome_check" CHECK ("finance_reconciliation_items"."outcome" in ('MATCHED','MISSING','MISMATCH'))
);
--> statement-breakpoint
CREATE TABLE "finance_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_staff_account_id" uuid NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"mismatch_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "finance_reconciliation_range_check" CHECK ("finance_reconciliation_runs"."range_to" > "finance_reconciliation_runs"."range_from"),
	CONSTRAINT "finance_reconciliation_status_check" CHECK ("finance_reconciliation_runs"."status" in ('RUNNING','COMPLETED','FAILED')),
	CONSTRAINT "finance_reconciliation_counts_check" CHECK ("finance_reconciliation_runs"."matched_count" >= 0 and "finance_reconciliation_runs"."missing_count" >= 0 and "finance_reconciliation_runs"."mismatch_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_payment_ledger_id_payment_ledger_id_fk" FOREIGN KEY ("payment_ledger_id") REFERENCES "public"."payment_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_ledger_entries" ADD CONSTRAINT "finance_ledger_entries_commission_event_id_commission_events_id_fk" FOREIGN KEY ("commission_event_id") REFERENCES "public"."commission_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reconciliation_items" ADD CONSTRAINT "finance_reconciliation_items_run_id_finance_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."finance_reconciliation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reconciliation_items" ADD CONSTRAINT "finance_reconciliation_items_finance_ledger_entry_id_finance_ledger_entries_id_fk" FOREIGN KEY ("finance_ledger_entry_id") REFERENCES "public"."finance_ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reconciliation_runs" ADD CONSTRAINT "finance_reconciliation_runs_requested_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("requested_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ledger_event_key_unique" ON "finance_ledger_entries" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ledger_payment_source_unique" ON "finance_ledger_entries" USING btree ("payment_ledger_id") WHERE "finance_ledger_entries"."payment_ledger_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ledger_commission_source_unique" ON "finance_ledger_entries" USING btree ("commission_event_id") WHERE "finance_ledger_entries"."commission_event_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_ledger_occurred_at_idx" ON "finance_ledger_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "finance_ledger_type_occurred_idx" ON "finance_ledger_entries" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reconciliation_item_source_unique" ON "finance_reconciliation_items" USING btree ("run_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "finance_reconciliation_item_outcome_idx" ON "finance_reconciliation_items" USING btree ("run_id","outcome");--> statement-breakpoint
CREATE INDEX "finance_reconciliation_created_idx" ON "finance_reconciliation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "finance_reconciliation_actor_created_idx" ON "finance_reconciliation_runs" USING btree ("requested_by_staff_account_id","created_at");