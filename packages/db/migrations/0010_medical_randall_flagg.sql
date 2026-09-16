CREATE TABLE "character_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"picture_book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'MAIN' NOT NULL,
	"description" text NOT NULL,
	"visual_prompt" text NOT NULL,
	"consistency_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reference_media_asset_id" uuid,
	"source_ai_job_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_profiles_role_check" CHECK ("character_profiles"."role" in ('MAIN','SUPPORTING')),
	CONSTRAINT "character_profiles_sort_check" CHECK ("character_profiles"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "picture_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"ai_project_id" uuid NOT NULL,
	"story_work_id" uuid NOT NULL,
	"source_story_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"layout_preset" text DEFAULT 'AUTO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picture_books_status_check" CHECK ("picture_books"."status" in ('DRAFT','PLANNED','ILLUSTRATING','READY')),
	CONSTRAINT "picture_books_layout_preset_check" CHECK (char_length(btrim("picture_books"."layout_preset")) between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "work_page_illustrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"source_ai_job_id" uuid,
	"media_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_page_illustrations_revision_check" CHECK ("work_page_illustrations"."revision_number" > 0),
	CONSTRAINT "work_page_illustrations_status_check" CHECK ("work_page_illustrations"."status" in ('QUEUED','RUNNING','READY','FAILED')),
	CONSTRAINT "work_page_illustrations_ready_asset_check" CHECK ("work_page_illustrations"."status" <> 'READY' or "work_page_illustrations"."media_asset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "work_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"picture_book_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"page_kind" text DEFAULT 'CONTENT' NOT NULL,
	"story_text" text,
	"scene_description" text,
	"illustration_prompt" text,
	"layout_preset" text DEFAULT 'AUTO' NOT NULL,
	"source_ai_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_pages_number_kind_check" CHECK (("work_pages"."page_kind" = 'COVER' and "work_pages"."page_number" = 0)
        or ("work_pages"."page_kind" = 'CONTENT' and "work_pages"."page_number" > 0)),
	CONSTRAINT "work_pages_kind_check" CHECK ("work_pages"."page_kind" in ('COVER','CONTENT')),
	CONSTRAINT "work_pages_content_text_check" CHECK ("work_pages"."page_kind" = 'COVER'
        or ("work_pages"."story_text" is not null and char_length(btrim("work_pages"."story_text")) > 0)),
	CONSTRAINT "work_pages_layout_preset_check" CHECK (char_length(btrim("work_pages"."layout_preset")) between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "ai_projects" DROP CONSTRAINT "ai_projects_type_check";--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_picture_book_id_picture_books_id_fk" FOREIGN KEY ("picture_book_id") REFERENCES "public"."picture_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_reference_media_asset_id_media_assets_id_fk" FOREIGN KEY ("reference_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_source_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_books" ADD CONSTRAINT "picture_books_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_books" ADD CONSTRAINT "picture_books_ai_project_id_ai_projects_id_fk" FOREIGN KEY ("ai_project_id") REFERENCES "public"."ai_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_books" ADD CONSTRAINT "picture_books_story_work_id_works_id_fk" FOREIGN KEY ("story_work_id") REFERENCES "public"."works"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_books" ADD CONSTRAINT "picture_books_source_story_version_id_work_versions_id_fk" FOREIGN KEY ("source_story_version_id") REFERENCES "public"."work_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD CONSTRAINT "work_page_illustrations_page_id_work_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."work_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD CONSTRAINT "work_page_illustrations_source_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD CONSTRAINT "work_page_illustrations_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_pages" ADD CONSTRAINT "work_pages_picture_book_id_picture_books_id_fk" FOREIGN KEY ("picture_book_id") REFERENCES "public"."picture_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_pages" ADD CONSTRAINT "work_pages_source_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_profiles_book_name_unique" ON "character_profiles" USING btree ("picture_book_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "character_profiles_book_sort_unique" ON "character_profiles" USING btree ("picture_book_id","sort_order");--> statement-breakpoint
CREATE INDEX "character_profiles_book_idx" ON "character_profiles" USING btree ("picture_book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "picture_books_ai_project_unique" ON "picture_books" USING btree ("ai_project_id");--> statement-breakpoint
CREATE INDEX "picture_books_consumer_updated_idx" ON "picture_books" USING btree ("consumer_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "picture_books_story_source_idx" ON "picture_books" USING btree ("story_work_id","source_story_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_page_illustrations_page_revision_unique" ON "work_page_illustrations" USING btree ("page_id","revision_number");--> statement-breakpoint
CREATE INDEX "work_page_illustrations_page_status_idx" ON "work_page_illustrations" USING btree ("page_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "work_pages_book_number_unique" ON "work_pages" USING btree ("picture_book_id","page_number");--> statement-breakpoint
CREATE INDEX "work_pages_book_idx" ON "work_pages" USING btree ("picture_book_id","page_number");--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_type_check" CHECK ("ai_projects"."project_type" in ('PLATFORM_SANDBOX','STORY','PICTURE_BOOK'));