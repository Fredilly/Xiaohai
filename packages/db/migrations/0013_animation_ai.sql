CREATE TABLE "ai_animations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"ai_project_id" uuid NOT NULL,
	"story_work_id" uuid NOT NULL,
	"source_story_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"script_text" text,
	"script_source_ai_job_id" uuid,
	"storyboard_source_ai_job_id" uuid,
	"final_media_asset_id" uuid,
	"cost_limit_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_animations_status_check" CHECK ("ai_animations"."status" in ('DRAFT','SCRIPT_READY','STORYBOARD_READY','GENERATING','COMPOSING','READY','FAILED','CANCELLED')),
	CONSTRAINT "ai_animations_title_check" CHECK (char_length(btrim("ai_animations"."title")) between 1 and 120),
	CONSTRAINT "ai_animations_script_pair_check" CHECK (("ai_animations"."script_text" is null and "ai_animations"."script_source_ai_job_id" is null)
        or ("ai_animations"."script_text" is not null and "ai_animations"."script_source_ai_job_id" is not null)),
	CONSTRAINT "ai_animations_storyboard_after_script_check" CHECK ("ai_animations"."storyboard_source_ai_job_id" is null or "ai_animations"."script_source_ai_job_id" is not null),
	CONSTRAINT "ai_animations_ready_asset_check" CHECK ("ai_animations"."status" <> 'READY' or "ai_animations"."final_media_asset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "animation_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"animation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'MAIN' NOT NULL,
	"description" text NOT NULL,
	"visual_prompt" text NOT NULL,
	"consistency_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reference_media_asset_id" uuid,
	"source_ai_job_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animation_characters_role_check" CHECK ("animation_characters"."role" in ('MAIN','SUPPORTING')),
	CONSTRAINT "animation_characters_sort_check" CHECK ("animation_characters"."sort_order" >= 0),
	CONSTRAINT "animation_characters_name_check" CHECK (char_length(btrim("animation_characters"."name")) > 0),
	CONSTRAINT "animation_characters_visual_prompt_check" CHECK (char_length(btrim("animation_characters"."visual_prompt")) > 0)
);
--> statement-breakpoint
CREATE TABLE "animation_composition_inputs" (
	"animation_id" uuid NOT NULL,
	"composition_id" uuid NOT NULL,
	"scene_generation_id" uuid NOT NULL,
	"scene_order" integer NOT NULL,
	CONSTRAINT "animation_composition_inputs_pk" PRIMARY KEY("composition_id","scene_generation_id"),
	CONSTRAINT "animation_composition_inputs_order_check" CHECK ("animation_composition_inputs"."scene_order" > 0)
);
--> statement-breakpoint
CREATE TABLE "animation_compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"animation_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"media_asset_id" uuid,
	"error_code" text,
	"usage" jsonb,
	"cost_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animation_compositions_revision_check" CHECK ("animation_compositions"."revision_number" > 0),
	CONSTRAINT "animation_compositions_status_check" CHECK ("animation_compositions"."status" in ('QUEUED','RUNNING','READY','FAILED','CANCELLED')),
	CONSTRAINT "animation_compositions_progress_check" CHECK ("animation_compositions"."progress_percent" between 0 and 100),
	CONSTRAINT "animation_compositions_ready_asset_check" CHECK ("animation_compositions"."status" <> 'READY' or "animation_compositions"."media_asset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "animation_scene_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"animation_id" uuid NOT NULL,
	"scene_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"media_asset_id" uuid,
	"error_code" text,
	"usage" jsonb,
	"cost_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animation_scene_generations_revision_check" CHECK ("animation_scene_generations"."revision_number" > 0),
	CONSTRAINT "animation_scene_generations_provider_check" CHECK (char_length(btrim("animation_scene_generations"."provider")) > 0),
	CONSTRAINT "animation_scene_generations_model_check" CHECK (char_length(btrim("animation_scene_generations"."model")) > 0),
	CONSTRAINT "animation_scene_generations_status_check" CHECK ("animation_scene_generations"."status" in ('QUEUED','RUNNING','READY','FAILED','CANCELLED')),
	CONSTRAINT "animation_scene_generations_progress_check" CHECK ("animation_scene_generations"."progress_percent" between 0 and 100),
	CONSTRAINT "animation_scene_generations_ready_asset_check" CHECK ("animation_scene_generations"."status" <> 'READY' or "animation_scene_generations"."media_asset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "animation_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"animation_id" uuid NOT NULL,
	"scene_number" integer NOT NULL,
	"script_text" text NOT NULL,
	"narration" text,
	"dialogue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visual_description" text NOT NULL,
	"generation_prompt" text NOT NULL,
	"planned_duration_ms" integer NOT NULL,
	"source_planning_ai_job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animation_scenes_number_check" CHECK ("animation_scenes"."scene_number" > 0),
	CONSTRAINT "animation_scenes_duration_check" CHECK ("animation_scenes"."planned_duration_ms" > 0),
	CONSTRAINT "animation_scenes_script_check" CHECK (char_length(btrim("animation_scenes"."script_text")) > 0),
	CONSTRAINT "animation_scenes_visual_check" CHECK (char_length(btrim("animation_scenes"."visual_description")) > 0),
	CONSTRAINT "animation_scenes_prompt_check" CHECK (char_length(btrim("animation_scenes"."generation_prompt")) > 0),
	CONSTRAINT "animation_scenes_dialogue_check" CHECK (jsonb_typeof("animation_scenes"."dialogue") = 'array')
);
--> statement-breakpoint
ALTER TABLE "ai_jobs" DROP CONSTRAINT "ai_jobs_type_check";--> statement-breakpoint
ALTER TABLE "ai_projects" DROP CONSTRAINT "ai_projects_type_check";--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_final_media_asset_id_media_assets_id_fk" FOREIGN KEY ("final_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_project_owner_fk" FOREIGN KEY ("ai_project_id","consumer_user_id") REFERENCES "public"."ai_projects"("id","created_by_consumer_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_story_owner_fk" FOREIGN KEY ("story_work_id","consumer_user_id") REFERENCES "public"."works"("id","consumer_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_story_version_fk" FOREIGN KEY ("source_story_version_id","story_work_id") REFERENCES "public"."work_versions"("id","work_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_script_job_project_fk" FOREIGN KEY ("script_source_ai_job_id","ai_project_id") REFERENCES "public"."ai_jobs"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_animations" ADD CONSTRAINT "ai_animations_storyboard_job_project_fk" FOREIGN KEY ("storyboard_source_ai_job_id","ai_project_id") REFERENCES "public"."ai_jobs"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_characters" ADD CONSTRAINT "animation_characters_animation_id_ai_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."ai_animations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_characters" ADD CONSTRAINT "animation_characters_reference_media_asset_id_media_assets_id_fk" FOREIGN KEY ("reference_media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_characters" ADD CONSTRAINT "animation_characters_source_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_composition_inputs" ADD CONSTRAINT "animation_composition_inputs_animation_id_ai_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."ai_animations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_composition_inputs" ADD CONSTRAINT "animation_composition_inputs_composition_animation_fk" FOREIGN KEY ("composition_id","animation_id") REFERENCES "public"."animation_compositions"("id","animation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_composition_inputs" ADD CONSTRAINT "animation_composition_inputs_generation_animation_fk" FOREIGN KEY ("scene_generation_id","animation_id") REFERENCES "public"."animation_scene_generations"("id","animation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_compositions" ADD CONSTRAINT "animation_compositions_animation_id_ai_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."ai_animations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_compositions" ADD CONSTRAINT "animation_compositions_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_scene_generations" ADD CONSTRAINT "animation_scene_generations_animation_id_ai_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."ai_animations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_scene_generations" ADD CONSTRAINT "animation_scene_generations_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_scene_generations" ADD CONSTRAINT "animation_scene_generations_scene_animation_fk" FOREIGN KEY ("scene_id","animation_id") REFERENCES "public"."animation_scenes"("id","animation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_scenes" ADD CONSTRAINT "animation_scenes_animation_id_ai_animations_id_fk" FOREIGN KEY ("animation_id") REFERENCES "public"."ai_animations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_scenes" ADD CONSTRAINT "animation_scenes_source_planning_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_planning_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_animations_ai_project_unique" ON "ai_animations" USING btree ("ai_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_animations_script_job_unique" ON "ai_animations" USING btree ("script_source_ai_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_animations_storyboard_job_unique" ON "ai_animations" USING btree ("storyboard_source_ai_job_id");--> statement-breakpoint
CREATE INDEX "ai_animations_consumer_updated_idx" ON "ai_animations" USING btree ("consumer_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_animations_story_source_idx" ON "ai_animations" USING btree ("story_work_id","source_story_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_characters_animation_name_unique" ON "animation_characters" USING btree ("animation_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_characters_animation_sort_unique" ON "animation_characters" USING btree ("animation_id","sort_order");--> statement-breakpoint
CREATE INDEX "animation_characters_animation_idx" ON "animation_characters" USING btree ("animation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_composition_inputs_order_unique" ON "animation_composition_inputs" USING btree ("composition_id","scene_order");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_compositions_animation_revision_unique" ON "animation_compositions" USING btree ("animation_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_compositions_id_animation_unique" ON "animation_compositions" USING btree ("id","animation_id");--> statement-breakpoint
CREATE INDEX "animation_compositions_animation_status_idx" ON "animation_compositions" USING btree ("animation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_scene_generations_scene_revision_unique" ON "animation_scene_generations" USING btree ("scene_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_scene_generations_id_animation_unique" ON "animation_scene_generations" USING btree ("id","animation_id");--> statement-breakpoint
CREATE INDEX "animation_scene_generations_claim_idx" ON "animation_scene_generations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "animation_scene_generations_scene_status_idx" ON "animation_scene_generations" USING btree ("scene_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_scenes_animation_number_unique" ON "animation_scenes" USING btree ("animation_id","scene_number");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_scenes_id_animation_unique" ON "animation_scenes" USING btree ("id","animation_id");--> statement-breakpoint
CREATE INDEX "animation_scenes_animation_idx" ON "animation_scenes" USING btree ("animation_id","scene_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_id_project_unique" ON "ai_jobs" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_projects_id_consumer_unique" ON "ai_projects" USING btree ("id","created_by_consumer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_versions_id_work_unique" ON "work_versions" USING btree ("id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "works_id_consumer_unique" ON "works" USING btree ("id","consumer_user_id");--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_type_check" CHECK ("ai_jobs"."job_type" in ('PLATFORM_TEXT','STORY_OUTLINE','STORY_BODY','STORY_REWRITE','STORY_CONTINUE','STORY_POLISH','PICTURE_BOOK_CHARACTERS','PICTURE_BOOK_STORYBOARD','ANIMATION_SCRIPT','ANIMATION_STORYBOARD'));--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_type_check" CHECK ("ai_projects"."project_type" in ('PLATFORM_SANDBOX','STORY','PICTURE_BOOK','ANIMATION'));