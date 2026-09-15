CREATE TABLE "media_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text DEFAULT 'EXTERNAL' NOT NULL,
  "object_key" text NOT NULL,
  "playback_url" text,
  "mime_type" text NOT NULL,
  "byte_size" integer,
  "duration_seconds" integer,
  "status" text DEFAULT 'READY' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "media_assets_status_check" CHECK (status in ('PENDING','READY','DISABLED')),
  CONSTRAINT "media_assets_size_check" CHECK (byte_size is null or byte_size >= 0),
  CONSTRAINT "media_assets_duration_check" CHECK (duration_seconds is null or duration_seconds >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_provider_object_unique" ON "media_assets" ("provider","object_key");
--> statement-breakpoint
CREATE TABLE "animation_series" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "category" text NOT NULL,
  "cover_url" text,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "animation_series_status_check" CHECK (status in ('DRAFT','PUBLISHED','UNPUBLISHED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "animation_series_slug_unique" ON "animation_series" ("slug");
CREATE INDEX "animation_series_public_idx" ON "animation_series" ("status","category","title");
--> statement-breakpoint
CREATE TABLE "animation_episodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "series_id" uuid NOT NULL REFERENCES "animation_series"("id") ON DELETE CASCADE,
  "media_asset_id" uuid REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  "episode_number" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "access_mode" text DEFAULT 'FREE' NOT NULL,
  "preview_seconds" integer,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "animation_episode_number_check" CHECK (episode_number > 0),
  CONSTRAINT "animation_episode_access_check" CHECK (access_mode in ('FREE','PREVIEW','PAID')),
  CONSTRAINT "animation_episode_preview_check" CHECK (access_mode <> 'PREVIEW' or (preview_seconds is not null and preview_seconds > 0)),
  CONSTRAINT "animation_episode_status_check" CHECK (status in ('DRAFT','PUBLISHED','UNPUBLISHED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "animation_episode_number_unique" ON "animation_episodes" ("series_id","episode_number");
CREATE INDEX "animation_episodes_series_status_idx" ON "animation_episodes" ("series_id","status");
--> statement-breakpoint
CREATE TABLE "content_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "consumer_user_id" uuid NOT NULL REFERENCES "consumer_users"("id") ON DELETE CASCADE,
  "series_id" uuid NOT NULL REFERENCES "animation_series"("id") ON DELETE CASCADE,
  "source_type" text DEFAULT 'ONE_TIME' NOT NULL,
  "source_reference" text,
  "granted_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT "content_entitlement_source_check" CHECK (source_type in ('ONE_TIME','ADMIN','MIGRATION'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_entitlement_owner_series_unique" ON "content_entitlements" ("consumer_user_id","series_id");
CREATE INDEX "content_entitlement_owner_idx" ON "content_entitlements" ("consumer_user_id","granted_at");
--> statement-breakpoint
CREATE TABLE "playback_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "consumer_user_id" uuid NOT NULL REFERENCES "consumer_users"("id") ON DELETE CASCADE,
  "episode_id" uuid NOT NULL REFERENCES "animation_episodes"("id") ON DELETE CASCADE,
  "position_seconds" integer DEFAULT 0 NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "playback_progress_position_check" CHECK (position_seconds >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "playback_progress_owner_episode_unique" ON "playback_progress" ("consumer_user_id","episode_id");
CREATE INDEX "playback_progress_continue_idx" ON "playback_progress" ("consumer_user_id","completed","updated_at");
