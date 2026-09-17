CREATE TABLE "store_inventory" (
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"rental_reserved" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_inventory_pk" PRIMARY KEY("store_id","sku_id"),
	CONSTRAINT "store_inventory_nonnegative_check" CHECK ("store_inventory"."on_hand" >= 0 and "store_inventory"."reserved" >= 0 and "store_inventory"."rental_reserved" >= 0),
	CONSTRAINT "store_inventory_allocated_check" CHECK ("store_inventory"."reserved" + "store_inventory"."rental_reserved" <= "store_inventory"."on_hand"),
	CONSTRAINT "store_inventory_version_nonnegative_check" CHECK ("store_inventory"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "store_inventory" ADD CONSTRAINT "store_inventory_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_inventory" ADD CONSTRAINT "store_inventory_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_inventory_sku_id_idx" ON "store_inventory" USING btree ("sku_id");