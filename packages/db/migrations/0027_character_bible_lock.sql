ALTER TABLE "character_profiles" ADD COLUMN "confirmed" boolean DEFAULT false NOT NULL;
ALTER TABLE "character_profiles" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_locked_check" CHECK ("character_profiles"."locked" = false or "character_profiles"."confirmed" = true);
