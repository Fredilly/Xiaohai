CREATE TABLE "character_reference_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_profile_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"media_asset_id" uuid,
	"provider_request_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_reference_images_revision_check" CHECK ("character_reference_images"."revision_number" > 0),
	CONSTRAINT "character_reference_images_status_check" CHECK ("character_reference_images"."status" in ('QUEUED','RUNNING','READY','FAILED')),
	CONSTRAINT "character_reference_images_provider_check" CHECK ("character_reference_images"."provider" in ('MOCK','BAILIAN')),
	CONSTRAINT "character_reference_images_ready_asset_check" CHECK ("character_reference_images"."status" <> 'READY' or "character_reference_images"."media_asset_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "character_reference_images" ADD CONSTRAINT "character_reference_images_character_profile_id_character_profiles_id_fk" FOREIGN KEY ("character_profile_id") REFERENCES "public"."character_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_reference_images" ADD CONSTRAINT "character_reference_images_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_reference_images_revision_unique" ON "character_reference_images" USING btree ("character_profile_id","revision_number");--> statement-breakpoint
CREATE INDEX "character_reference_images_character_status_idx" ON "character_reference_images" USING btree ("character_profile_id","status");--> statement-breakpoint
