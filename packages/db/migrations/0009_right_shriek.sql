CREATE TABLE "work_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content_kind" text NOT NULL,
	"operation" text NOT NULL,
	"source_version_id" uuid,
	"source_ai_job_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_versions_number_check" CHECK ("work_versions"."version_number" > 0),
	CONSTRAINT "work_versions_kind_check" CHECK ("work_versions"."content_kind" in ('OUTLINE','BODY')),
	CONSTRAINT "work_versions_operation_check" CHECK ("work_versions"."operation" in ('OUTLINE','BODY','REWRITE','CONTINUE','POLISH')),
	CONSTRAINT "work_versions_operation_kind_check" CHECK (("work_versions"."operation" = 'OUTLINE' and "work_versions"."content_kind" = 'OUTLINE')
        or ("work_versions"."operation" in ('BODY','REWRITE','CONTINUE','POLISH') and "work_versions"."content_kind" = 'BODY')),
	CONSTRAINT "work_versions_source_check" CHECK (("work_versions"."operation" = 'OUTLINE' and "work_versions"."source_version_id" is null)
        or ("work_versions"."operation" in ('BODY','REWRITE','CONTINUE','POLISH') and "work_versions"."source_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"ai_project_id" uuid NOT NULL,
	"work_type" text DEFAULT 'STORY' NOT NULL,
	"title" text NOT NULL,
	"idea" text NOT NULL,
	"age_range" text NOT NULL,
	"theme" text NOT NULL,
	"style" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "works_type_check" CHECK ("works"."work_type" in ('STORY'))
);
--> statement-breakpoint
ALTER TABLE "ai_jobs" DROP CONSTRAINT "ai_jobs_type_check";--> statement-breakpoint
ALTER TABLE "ai_projects" DROP CONSTRAINT "ai_projects_type_check";--> statement-breakpoint
ALTER TABLE "ai_projects" ALTER COLUMN "created_by_staff_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_projects" ADD COLUMN "created_by_consumer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_source_version_id_work_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."work_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_source_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_ai_project_id_ai_projects_id_fk" FOREIGN KEY ("ai_project_id") REFERENCES "public"."ai_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_versions_work_number_unique" ON "work_versions" USING btree ("work_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "work_versions_ai_job_unique" ON "work_versions" USING btree ("source_ai_job_id");--> statement-breakpoint
CREATE INDEX "work_versions_work_created_idx" ON "work_versions" USING btree ("work_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "works_ai_project_unique" ON "works" USING btree ("ai_project_id");--> statement-breakpoint
CREATE INDEX "works_consumer_updated_idx" ON "works" USING btree ("consumer_user_id","updated_at");--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_created_by_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("created_by_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_projects_staff_creator_idx" ON "ai_projects" USING btree ("created_by_staff_account_id");--> statement-breakpoint
CREATE INDEX "ai_projects_consumer_creator_idx" ON "ai_projects" USING btree ("created_by_consumer_user_id");--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_type_check" CHECK ("ai_jobs"."job_type" in ('PLATFORM_TEXT','STORY_OUTLINE','STORY_BODY','STORY_REWRITE','STORY_CONTINUE','STORY_POLISH'));--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_owner_check" CHECK (("ai_projects"."created_by_staff_account_id" is not null and "ai_projects"."created_by_consumer_user_id" is null)
        or ("ai_projects"."created_by_staff_account_id" is null and "ai_projects"."created_by_consumer_user_id" is not null));--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_type_check" CHECK ("ai_projects"."project_type" in ('PLATFORM_SANDBOX','STORY'));