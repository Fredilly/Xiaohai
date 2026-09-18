CREATE TABLE "commission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"type" text NOT NULL,
	"beneficiary_consumer_user_id" uuid NOT NULL,
	"attribution_id" uuid,
	"rule_id" uuid,
	"refund_id" uuid,
	"withdrawal_request_id" uuid,
	"parent_event_id" uuid,
	"amount_minor" integer NOT NULL,
	"frozen_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_events_type_check" CHECK ("commission_events"."type" in ('FROZEN','SETTLED','REVERSED','WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_APPROVED','WITHDRAWAL_PAID')),
	CONSTRAINT "commission_events_amount_check" CHECK ("commission_events"."amount_minor" > 0),
	CONSTRAINT "commission_events_shape_check" CHECK (("commission_events"."type" = 'FROZEN' and "commission_events"."attribution_id" is not null and "commission_events"."rule_id" is not null and "commission_events"."frozen_until" is not null and "commission_events"."parent_event_id" is null and "commission_events"."refund_id" is null and "commission_events"."withdrawal_request_id" is null)
        or ("commission_events"."type" = 'SETTLED' and "commission_events"."parent_event_id" is not null and "commission_events"."withdrawal_request_id" is null)
        or ("commission_events"."type" = 'REVERSED' and "commission_events"."parent_event_id" is not null and "commission_events"."refund_id" is not null and "commission_events"."withdrawal_request_id" is null)
        or ("commission_events"."type" in ('WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_APPROVED','WITHDRAWAL_PAID') and "commission_events"."withdrawal_request_id" is not null and "commission_events"."attribution_id" is null and "commission_events"."refund_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commission_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"beneficiary_consumer_user_id" uuid NOT NULL,
	"frozen_delta_minor" integer DEFAULT 0 NOT NULL,
	"available_delta_minor" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_ledger_nonzero_check" CHECK ("commission_ledger"."frozen_delta_minor" <> 0 or "commission_ledger"."available_delta_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"basis" text DEFAULT 'ORDER_TOTAL' NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"freeze_days" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by_staff_account_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_status_check" CHECK ("commission_rules"."status" in ('DRAFT','ACTIVE','INACTIVE')),
	CONSTRAINT "commission_rules_basis_check" CHECK ("commission_rules"."basis" = 'ORDER_TOTAL'),
	CONSTRAINT "commission_rules_rate_check" CHECK ("commission_rules"."rate_basis_points" between 0 and 10000),
	CONSTRAINT "commission_rules_freeze_days_check" CHECK ("commission_rules"."freeze_days" between 0 and 365),
	CONSTRAINT "commission_rules_window_check" CHECK ("commission_rules"."effective_to" is null or "commission_rules"."effective_to" > "commission_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "referral_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"referral_link_id" uuid NOT NULL,
	"referred_consumer_user_id" uuid NOT NULL,
	"beneficiary_consumer_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_attributions_no_self_check" CHECK ("referral_attributions"."referred_consumer_user_id" <> "referral_attributions"."beneficiary_consumer_user_id")
);
--> statement-breakpoint
CREATE TABLE "referral_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_consumer_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_links_status_check" CHECK ("referral_links"."status" in ('ACTIVE','DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"client_request_id" text NOT NULL,
	"reviewed_by_staff_account_id" uuid,
	"review_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "withdrawal_requests_amount_check" CHECK ("withdrawal_requests"."amount_minor" > 0),
	CONSTRAINT "withdrawal_requests_status_check" CHECK ("withdrawal_requests"."status" in ('REQUESTED','APPROVED','PAID','REJECTED','CANCELLED')),
	CONSTRAINT "withdrawal_requests_version_check" CHECK ("withdrawal_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_beneficiary_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("beneficiary_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_attribution_id_referral_attributions_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."referral_attributions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_withdrawal_request_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_events" ADD CONSTRAINT "commission_events_parent_event_id_commission_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."commission_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_event_id_commission_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."commission_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_beneficiary_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("beneficiary_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_referral_link_id_referral_links_id_fk" FOREIGN KEY ("referral_link_id") REFERENCES "public"."referral_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_referred_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("referred_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_beneficiary_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("beneficiary_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_owner_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("owner_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reviewed_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("reviewed_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_events_key_unique" ON "commission_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "commission_events_beneficiary_created_idx" ON "commission_events" USING btree ("beneficiary_consumer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "commission_events_attribution_idx" ON "commission_events" USING btree ("attribution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_ledger_event_unique" ON "commission_ledger" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "commission_ledger_beneficiary_created_idx" ON "commission_ledger" USING btree ("beneficiary_consumer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "commission_rules_active_window_idx" ON "commission_rules" USING btree ("status","effective_from","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_attributions_order_unique" ON "referral_attributions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "referral_attributions_beneficiary_idx" ON "referral_attributions" USING btree ("beneficiary_consumer_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_links_code_unique" ON "referral_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "referral_links_owner_created_idx" ON "referral_links" USING btree ("owner_consumer_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_requests_consumer_request_unique" ON "withdrawal_requests" USING btree ("consumer_user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_consumer_created_idx" ON "withdrawal_requests" USING btree ("consumer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_created_idx" ON "withdrawal_requests" USING btree ("status","created_at");