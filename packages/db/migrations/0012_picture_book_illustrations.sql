ALTER TABLE "work_page_illustrations" ADD COLUMN "provider" text DEFAULT 'MOCK' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD COLUMN "model" text DEFAULT 'mock-image-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ALTER COLUMN "model" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD COLUMN "consistency" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ALTER COLUMN "consistency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD CONSTRAINT "work_page_illustrations_provider_check" CHECK ("work_page_illustrations"."provider" in ('MOCK'));
