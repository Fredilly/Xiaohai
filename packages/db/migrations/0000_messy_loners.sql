CREATE TABLE "consumer_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wechat_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"openid" text NOT NULL,
	"unionid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wechat_identities" ADD CONSTRAINT "wechat_identities_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wechat_identities_app_id_openid_unique" ON "wechat_identities" USING btree ("app_id","openid");--> statement-breakpoint
CREATE INDEX "wechat_identities_consumer_user_id_idx" ON "wechat_identities" USING btree ("consumer_user_id");