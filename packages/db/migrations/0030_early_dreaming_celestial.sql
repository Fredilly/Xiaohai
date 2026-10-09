CREATE TABLE "ai_budget_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_key" text NOT NULL,
	"scope_type" text NOT NULL,
	"consumer_user_id" uuid,
	"window_key" text NOT NULL,
	"limit_minor" integer NOT NULL,
	"reserved_minor" integer DEFAULT 0 NOT NULL,
	"actual_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_budget_windows_scope_check" CHECK ("ai_budget_windows"."scope_type" in ('GLOBAL','CONSUMER')),
	CONSTRAINT "ai_budget_windows_limit_check" CHECK ("ai_budget_windows"."limit_minor" > 0),
	CONSTRAINT "ai_budget_windows_reserved_check" CHECK ("ai_budget_windows"."reserved_minor" >= 0 and "ai_budget_windows"."actual_minor" >= 0 and "ai_budget_windows"."reserved_minor" + "ai_budget_windows"."actual_minor" <= "ai_budget_windows"."limit_minor"),
	CONSTRAINT "ai_budget_windows_consumer_check" CHECK (("ai_budget_windows"."scope_type" = 'GLOBAL' and "ai_budget_windows"."consumer_user_id" is null) or ("ai_budget_windows"."scope_type" = 'CONSUMER' and "ai_budget_windows"."consumer_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai_cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"consumer_user_id" uuid,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"outcome" text NOT NULL,
	"usage" text,
	"failure_code" text,
	"provider_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_cost_ledger_amount_check" CHECK ("ai_cost_ledger"."amount_minor" >= 0),
	CONSTRAINT "ai_cost_ledger_outcome_check" CHECK ("ai_cost_ledger"."outcome" in ('SUCCEEDED','FAILED','TIMED_OUT','CANCELLED','AT_RISK'))
);
--> statement-breakpoint
CREATE TABLE "ai_cost_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"budget_key" text NOT NULL,
	"consumer_user_id" uuid,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"reserved_minor" integer NOT NULL,
	"actual_minor" integer,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"uncertainty" text DEFAULT 'NONE' NOT NULL,
	"provider_request_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ai_cost_reservations_status_check" CHECK ("ai_cost_reservations"."status" in ('RESERVED','SETTLED','RELEASED','REJECTED')),
	CONSTRAINT "ai_cost_reservations_uncertainty_check" CHECK ("ai_cost_reservations"."uncertainty" in ('NONE','AT_RISK')),
	CONSTRAINT "ai_cost_reservations_amount_check" CHECK ("ai_cost_reservations"."reserved_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_budget_windows" ADD CONSTRAINT "ai_budget_windows_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_cost_ledger" ADD CONSTRAINT "ai_cost_ledger_reservation_id_ai_cost_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."ai_cost_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_cost_ledger" ADD CONSTRAINT "ai_cost_ledger_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_cost_reservations" ADD CONSTRAINT "ai_cost_reservations_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_budget_windows_key_scope_window_unique" ON "ai_budget_windows" USING btree ("budget_key","scope_type","consumer_user_id","window_key");--> statement-breakpoint
CREATE INDEX "ai_budget_windows_scope_idx" ON "ai_budget_windows" USING btree ("scope_type","consumer_user_id","window_key");--> statement-breakpoint
CREATE INDEX "ai_cost_ledger_consumer_date_idx" ON "ai_cost_ledger" USING btree ("consumer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_cost_ledger_provider_model_date_idx" ON "ai_cost_ledger" USING btree ("provider","model","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cost_reservations_idempotency_unique" ON "ai_cost_reservations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_cost_reservations_resource_idx" ON "ai_cost_reservations" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ai_cost_reservations_consumer_idx" ON "ai_cost_reservations" USING btree ("consumer_user_id","created_at");