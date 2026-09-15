CREATE TABLE "payment_callbacks" (
	"id" text PRIMARY KEY NOT NULL,
	"body_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ledger_kind_check" CHECK ("payment_ledger"."kind" in ('PAYMENT','REFUND')),
	CONSTRAINT "payment_ledger_amount_check" CHECK ("payment_ledger"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"merchant_id" text NOT NULL,
	"app_id" text NOT NULL,
	"out_trade_no" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_transaction_id" text,
	"review_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" > 0 and "payments"."currency" = 'CNY'),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('PENDING','SUCCEEDED','CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_outcome_check" CHECK ("reconciliation_items"."outcome" in ('MATCHED','PENDING','REVIEW_REQUIRED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"out_refund_no" text NOT NULL,
	"provider_refund_id" text,
	"amount_minor" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" uuid NOT NULL,
	"original_order_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" in ('PENDING','PROCESSING','SUCCEEDED','CLOSED','ABNORMAL')),
	CONSTRAINT "refunds_original_status_check" CHECK ("refunds"."original_order_status" in ('PAID','CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "payment_callbacks" ADD CONSTRAINT "payment_callbacks_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger" ADD CONSTRAINT "payment_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_requested_by_staff_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_staff_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_event_unique" ON "payment_ledger" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_unique" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_out_trade_unique" ON "payments" USING btree ("out_trade_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_transaction_unique" ON "payments" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_payment_unique" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_out_refund_unique" ON "refunds" USING btree ("out_refund_no");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_unique" ON "refunds" USING btree ("provider_refund_id");
--> statement-breakpoint
INSERT INTO "permissions" ("key","display_name","description") VALUES
('payments.read','Read payments','View M6 payment and reconciliation records'),
('payments.refund','Refund payments','Create controlled M6 full refunds'),
('payments.reconcile','Reconcile payments','Query provider and reconcile M6 payments')
ON CONFLICT ("key") DO NOTHING;
