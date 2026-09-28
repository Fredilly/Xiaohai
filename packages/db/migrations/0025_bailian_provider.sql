ALTER TABLE "ai_jobs" DROP CONSTRAINT IF EXISTS "ai_jobs_provider_check";
--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_provider_check" CHECK ("provider" in ('MOCK','DEEPSEEK','BAILIAN'));
