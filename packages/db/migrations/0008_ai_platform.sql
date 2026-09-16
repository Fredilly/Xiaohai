CREATE TABLE "ai_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_type" text DEFAULT 'PLATFORM_SANDBOX' NOT NULL,
  "title" text NOT NULL,
  "created_by_staff_account_id" uuid NOT NULL REFERENCES "staff_accounts"("id") ON DELETE restrict,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_projects_type_check" CHECK ("project_type" in ('PLATFORM_SANDBOX'))
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "ai_projects"("id") ON DELETE cascade,
  "job_type" text DEFAULT 'PLATFORM_TEXT' NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "input" jsonb NOT NULL,
  "result" jsonb,
  "moderation" jsonb,
  "usage" jsonb,
  "cost_metadata" jsonb,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "timeout_ms" integer DEFAULT 30000 NOT NULL,
  "run_after" timestamptz DEFAULT now() NOT NULL,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "last_error_code" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_jobs_type_check" CHECK ("job_type" in ('PLATFORM_TEXT')),
  CONSTRAINT "ai_jobs_provider_check" CHECK ("provider" in ('MOCK','DEEPSEEK')),
  CONSTRAINT "ai_jobs_status_check" CHECK ("status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT "ai_jobs_attempts_check" CHECK ("max_attempts" between 1 and 10),
  CONSTRAINT "ai_jobs_timeout_check" CHECK ("timeout_ms" between 1000 and 300000)
);
CREATE INDEX "ai_jobs_claim_idx" ON "ai_jobs" ("status","run_after","created_at");
CREATE INDEX "ai_jobs_project_created_idx" ON "ai_jobs" ("project_id","created_at");
--> statement-breakpoint
CREATE TABLE "ai_job_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "ai_jobs"("id") ON DELETE cascade,
  "attempt_number" integer NOT NULL,
  "provider_request_id" text,
  "status" text DEFAULT 'RUNNING' NOT NULL,
  "usage" jsonb,
  "cost_metadata" jsonb,
  "moderation" jsonb,
  "error_code" text,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz,
  CONSTRAINT "ai_job_attempts_number_check" CHECK ("attempt_number" > 0),
  CONSTRAINT "ai_job_attempts_status_check" CHECK ("status" in ('RUNNING','SUCCEEDED','FAILED','TIMED_OUT','CANCELLED'))
);
CREATE UNIQUE INDEX "ai_job_attempts_job_number_unique" ON "ai_job_attempts" ("job_id","attempt_number");
--> statement-breakpoint
INSERT INTO "permissions" ("key","display_name","description") VALUES
  ('ai.manage','Manage AI platform','Enqueue and monitor M8 AI platform jobs globally')
ON CONFLICT ("key") DO NOTHING;
