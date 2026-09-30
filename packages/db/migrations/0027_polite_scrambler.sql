CREATE TABLE "work_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"content_kind" text NOT NULL,
	"content" text NOT NULL,
	"source_ai_job_id" uuid,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_drafts_kind_check" CHECK ("work_drafts"."content_kind" in ('OUTLINE','BODY')),
	CONSTRAINT "work_drafts_content_check" CHECK (length(btrim("work_drafts"."content")) > 0),
	CONSTRAINT "work_drafts_revision_check" CHECK ("work_drafts"."draft_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT "work_versions_source_check";--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "creation_mode" text DEFAULT 'OUTLINE_FIRST' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_drafts" ADD CONSTRAINT "work_drafts_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_drafts" ADD CONSTRAINT "work_drafts_source_ai_job_id_ai_jobs_id_fk" FOREIGN KEY ("source_ai_job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_drafts_work_kind_unique" ON "work_drafts" USING btree ("work_id","content_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "work_drafts_ai_job_unique" ON "work_drafts" USING btree ("source_ai_job_id");--> statement-breakpoint
CREATE INDEX "work_drafts_work_updated_idx" ON "work_drafts" USING btree ("work_id","updated_at");--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_source_check" CHECK (("work_versions"."operation" = 'OUTLINE' and "work_versions"."source_version_id" is null)
        or ("work_versions"."operation" = 'BODY')
        or ("work_versions"."operation" in ('REWRITE','CONTINUE','POLISH') and "work_versions"."source_version_id" is not null));--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_creation_mode_check" CHECK ("works"."creation_mode" in ('DIRECT_BODY','OUTLINE_FIRST'));