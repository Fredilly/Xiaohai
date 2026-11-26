-- Adds truthful provenance for owner-supplied reference image revisions.
-- CODE ONLY: do not apply to shared/staging/production without DB owner approval.
ALTER TABLE "character_reference_images"
  DROP CONSTRAINT IF EXISTS "character_reference_images_provider_check";
--> statement-breakpoint
ALTER TABLE "character_reference_images"
  ADD CONSTRAINT "character_reference_images_provider_check"
  CHECK ("provider" IN ('MOCK', 'BAILIAN', 'IMPORTED'));
