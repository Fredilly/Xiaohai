CREATE TABLE "franchise_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_number" text NOT NULL,
	"submitted_by_consumer_user_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"country" text NOT NULL,
	"region" text NOT NULL,
	"city" text NOT NULL,
	"district" text,
	"background" text,
	"message" text,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"assigned_staff_account_id" uuid,
	"reviewed_by_staff_account_id" uuid,
	"review_note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "franchise_applications_status_check" CHECK ("franchise_applications"."status" in ('SUBMITTED', 'ASSIGNED', 'FOLLOWING_UP', 'APPROVED', 'REJECTED', 'SIGNED', 'PREPARING', 'OPENED', 'CLOSED')),
	CONSTRAINT "franchise_applications_version_positive" CHECK ("franchise_applications"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "franchise_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_application_id" uuid NOT NULL,
	"staff_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"note" text NOT NULL,
	"next_followup_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "franchise_followups_channel_check" CHECK ("franchise_followups"."channel" in ('PHONE', 'WECHAT', 'EMAIL', 'MEETING', 'OTHER'))
);
--> statement-breakpoint
ALTER TABLE "franchise_applications" ADD CONSTRAINT "franchise_applications_submitted_by_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("submitted_by_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_applications" ADD CONSTRAINT "franchise_applications_assigned_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("assigned_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_applications" ADD CONSTRAINT "franchise_applications_reviewed_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("reviewed_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_followups" ADD CONSTRAINT "franchise_followups_franchise_application_id_franchise_applications_id_fk" FOREIGN KEY ("franchise_application_id") REFERENCES "public"."franchise_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_followups" ADD CONSTRAINT "franchise_followups_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_applications_number_unique" ON "franchise_applications" USING btree ("application_number");--> statement-breakpoint
CREATE INDEX "franchise_applications_status_created_idx" ON "franchise_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "franchise_applications_assignee_status_idx" ON "franchise_applications" USING btree ("assigned_staff_account_id","status");--> statement-breakpoint
CREATE INDEX "franchise_applications_location_idx" ON "franchise_applications" USING btree ("country","region","city");--> statement-breakpoint
CREATE INDEX "franchise_followups_application_created_idx" ON "franchise_followups" USING btree ("franchise_application_id","created_at");--> statement-breakpoint
CREATE INDEX "franchise_followups_staff_created_idx" ON "franchise_followups" USING btree ("staff_account_id","created_at");