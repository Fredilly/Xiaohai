CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"delivery_zone_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_key" text NOT NULL,
	"provider_order_id" text,
	"fee_minor" integer NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_status_check" CHECK ("deliveries"."status" in ('PENDING','DISPATCHED','DELIVERED','CANCELLED')),
	CONSTRAINT "deliveries_fee_nonnegative_check" CHECK ("deliveries"."fee_minor" >= 0),
	CONSTRAINT "deliveries_version_check" CHECK ("deliveries"."version" >= 0),
	CONSTRAINT "deliveries_lifecycle_check" CHECK (
        ("deliveries"."status" = 'PENDING' and "deliveries"."dispatched_at" is null and "deliveries"."delivered_at" is null and "deliveries"."cancelled_at" is null) or
        ("deliveries"."status" = 'DISPATCHED' and "deliveries"."dispatched_at" is not null and "deliveries"."delivered_at" is null and "deliveries"."cancelled_at" is null) or
        ("deliveries"."status" = 'DELIVERED' and "deliveries"."dispatched_at" is not null and "deliveries"."delivered_at" is not null and "deliveries"."cancelled_at" is null) or
        ("deliveries"."status" = 'CANCELLED' and "deliveries"."delivered_at" is null and "deliveries"."cancelled_at" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_staff_account_id" uuid,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_events_type_check" CHECK ("delivery_events"."event_type" in ('CREATED','DISPATCHED','DELIVERED','CANCELLED')),
	CONSTRAINT "delivery_events_actor_type_check" CHECK ("delivery_events"."actor_type" in ('STAFF','SYSTEM')),
	CONSTRAINT "delivery_events_actor_shape_check" CHECK (("delivery_events"."actor_type" = 'STAFF' and "delivery_events"."actor_staff_account_id" is not null) or ("delivery_events"."actor_type" = 'SYSTEM' and "delivery_events"."actor_staff_account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"city" text NOT NULL,
	"district" text,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"provider_key" text DEFAULT 'MANUAL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_fee_nonnegative_check" CHECK ("delivery_zones"."fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pickup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"rental_order_id" uuid,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_codes_resource_shape_check" CHECK (("pickup_codes"."order_id" is not null and "pickup_codes"."rental_order_id" is null) or ("pickup_codes"."order_id" is null and "pickup_codes"."rental_order_id" is not null)),
	CONSTRAINT "pickup_codes_status_check" CHECK ("pickup_codes"."status" in ('ISSUED','VERIFIED','CANCELLED')),
	CONSTRAINT "pickup_codes_version_check" CHECK ("pickup_codes"."version" >= 0),
	CONSTRAINT "pickup_codes_lifecycle_check" CHECK (
        ("pickup_codes"."status" = 'ISSUED' and "pickup_codes"."verified_at" is null and "pickup_codes"."cancelled_at" is null) or
        ("pickup_codes"."status" = 'VERIFIED' and "pickup_codes"."verified_at" is not null and "pickup_codes"."cancelled_at" is null) or
        ("pickup_codes"."status" = 'CANCELLED' and "pickup_codes"."verified_at" is null and "pickup_codes"."cancelled_at" is not null)
      )
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "address_snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_fingerprint" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delivery_zone_id_delivery_zones_id_fk" FOREIGN KEY ("delivery_zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_actor_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("actor_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_rental_order_id_rental_orders_id_fk" FOREIGN KEY ("rental_order_id") REFERENCES "public"."rental_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_unique" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_store_status_idx" ON "deliveries" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_provider_order_idx" ON "deliveries" USING btree ("provider_key","provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_events_idempotency_unique" ON "delivery_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "delivery_events_delivery_created_idx" ON "delivery_events" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_zones_store_name_unique" ON "delivery_zones" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "delivery_zones_store_active_idx" ON "delivery_zones" USING btree ("store_id","active");--> statement-breakpoint
CREATE INDEX "delivery_zones_location_idx" ON "delivery_zones" USING btree ("region","city","district");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_codes_order_unique" ON "pickup_codes" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_codes_rental_order_unique" ON "pickup_codes" USING btree ("rental_order_id");--> statement-breakpoint
CREATE INDEX "pickup_codes_store_status_idx" ON "pickup_codes" USING btree ("store_id","status","created_at");