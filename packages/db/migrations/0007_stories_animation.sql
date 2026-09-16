CREATE TABLE "animation_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"episode_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"access_mode" text DEFAULT 'FREE' NOT NULL,
	"preview_seconds" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animation_episode_number_check" CHECK ("animation_episodes"."episode_number" > 0),
	CONSTRAINT "animation_episode_access_check" CHECK ("animation_episodes"."access_mode" in ('FREE','PREVIEW','PAID')),
	CONSTRAINT "animation_episode_preview_check" CHECK (("animation_episodes"."access_mode" <> 'PREVIEW') or ("animation_episodes"."preview_seconds" is not null and "animation_episodes"."preview_seconds" > 0)),
	CONSTRAINT "animation_episode_status_check" CHECK ("animation_episodes"."status" in ('DRAFT','PUBLISHED','UNPUBLISHED'))
);
--> statement-breakpoint
CREATE TABLE "animation_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"cover_url" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animation_series_status_check" CHECK ("animation_series"."status" in ('DRAFT','PUBLISHED','UNPUBLISHED'))
);
--> statement-breakpoint
CREATE TABLE "content_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"source_type" text DEFAULT 'ONE_TIME' NOT NULL,
	"source_reference" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "content_entitlement_source_check" CHECK ("content_entitlements"."source_type" in ('ONE_TIME','ADMIN','MIGRATION'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'EXTERNAL' NOT NULL,
	"object_key" text NOT NULL,
	"playback_url" text,
	"mime_type" text NOT NULL,
	"byte_size" integer,
	"duration_seconds" integer,
	"status" text DEFAULT 'READY' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_status_check" CHECK ("media_assets"."status" in ('PENDING','READY','DISABLED')),
	CONSTRAINT "media_assets_size_check" CHECK ("media_assets"."byte_size" is null or "media_assets"."byte_size" >= 0),
	CONSTRAINT "media_assets_duration_check" CHECK ("media_assets"."duration_seconds" is null or "media_assets"."duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "playback_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_progress_position_check" CHECK ("playback_progress"."position_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "animation_episodes" ADD CONSTRAINT "animation_episodes_series_id_animation_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."animation_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animation_episodes" ADD CONSTRAINT "animation_episodes_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entitlements" ADD CONSTRAINT "content_entitlements_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entitlements" ADD CONSTRAINT "content_entitlements_series_id_animation_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."animation_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_episode_id_animation_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."animation_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "animation_episode_number_unique" ON "animation_episodes" USING btree ("series_id","episode_number");--> statement-breakpoint
CREATE INDEX "animation_episodes_series_status_idx" ON "animation_episodes" USING btree ("series_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "animation_series_slug_unique" ON "animation_series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "animation_series_public_idx" ON "animation_series" USING btree ("status","category","title");--> statement-breakpoint
CREATE UNIQUE INDEX "content_entitlement_owner_series_unique" ON "content_entitlements" USING btree ("consumer_user_id","series_id");--> statement-breakpoint
CREATE INDEX "content_entitlement_owner_idx" ON "content_entitlements" USING btree ("consumer_user_id","granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_provider_object_unique" ON "media_assets" USING btree ("provider","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "playback_progress_owner_episode_unique" ON "playback_progress" USING btree ("consumer_user_id","episode_id");--> statement-breakpoint
CREATE INDEX "playback_progress_continue_idx" ON "playback_progress" USING btree ("consumer_user_id","completed","updated_at");