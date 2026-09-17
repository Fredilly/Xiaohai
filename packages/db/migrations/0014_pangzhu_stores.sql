CREATE TABLE "regions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "country_code" text NOT NULL,
  "country_name" text NOT NULL,
  "operational_status" text DEFAULT 'ACTIVE' NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "regions_operational_status_check" CHECK ("regions"."operational_status" in ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "franchisees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "region_id" uuid NOT NULL,
  "name" text NOT NULL,
  "operational_status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "franchisees_operational_status_check" CHECK ("franchisees"."operational_status" in ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "stores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "region_id" uuid NOT NULL,
  "franchisee_id" uuid,
  "name" text NOT NULL,
  "country_code" text NOT NULL,
  "country_name" text NOT NULL,
  "city" text NOT NULL,
  "timezone" text NOT NULL,
  "address_line" text NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "phone" text,
  "opening_hours_text" text,
  "services" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "operational_status" text DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stores_latitude_check" CHECK ("stores"."latitude" >= -90 and "stores"."latitude" <= 90),
  CONSTRAINT "stores_longitude_check" CHECK ("stores"."longitude" >= -180 and "stores"."longitude" <= 180),
  CONSTRAINT "stores_operational_status_check" CHECK ("stores"."operational_status" in ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "store_staff" (
  "store_id" uuid NOT NULL,
  "staff_account_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "store_staff_pk" PRIMARY KEY("store_id","staff_account_id")
);
--> statement-breakpoint
ALTER TABLE "franchisees" ADD CONSTRAINT "franchisees_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_franchisee_id_franchisees_id_fk" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisees"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_staff" ADD CONSTRAINT "store_staff_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_staff" ADD CONSTRAINT "store_staff_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "regions_code_unique" ON "regions" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "regions_country_status_idx" ON "regions" USING btree ("country_code","operational_status","display_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "franchisees_code_unique" ON "franchisees" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "franchisees_region_status_idx" ON "franchisees" USING btree ("region_id","operational_status");
--> statement-breakpoint
CREATE UNIQUE INDEX "stores_code_unique" ON "stores" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "stores_region_status_idx" ON "stores" USING btree ("region_id","operational_status");
--> statement-breakpoint
CREATE INDEX "stores_franchisee_status_idx" ON "stores" USING btree ("franchisee_id","operational_status");
--> statement-breakpoint
CREATE INDEX "stores_country_city_status_idx" ON "stores" USING btree ("country_code","city","operational_status");
--> statement-breakpoint
CREATE INDEX "stores_name_idx" ON "stores" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "store_staff_staff_account_id_idx" ON "store_staff" USING btree ("staff_account_id");
