ALTER TABLE "work_page_illustrations" DROP CONSTRAINT "work_page_illustrations_provider_check";--> statement-breakpoint
ALTER TABLE "work_page_illustrations" ADD CONSTRAINT "work_page_illustrations_provider_check" CHECK ("work_page_illustrations"."provider" in ('MOCK','BAILIAN'));
