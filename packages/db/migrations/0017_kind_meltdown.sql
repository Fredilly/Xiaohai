CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"reservation_type" text DEFAULT 'RENTAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "inventory_reservations_type_check" CHECK ("inventory_reservations"."reservation_type" = 'RENTAL'),
	CONSTRAINT "inventory_reservations_status_check" CHECK ("inventory_reservations"."status" in ('ACTIVE','COMPLETED','RELEASED')),
	CONSTRAINT "inventory_reservations_quantity_check" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_end_check" CHECK (("inventory_reservations"."status" = 'ACTIVE' and "inventory_reservations"."ended_at" is null) or ("inventory_reservations"."status" in ('COMPLETED','RELEASED') and "inventory_reservations"."ended_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "rental_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_order_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_consumer_user_id" uuid,
	"actor_staff_account_id" uuid,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_events_type_check" CHECK ("rental_events"."event_type" in ('RESERVED','BORROWED','OVERDUE','RETURNED','CANCELLED')),
	CONSTRAINT "rental_events_actor_type_check" CHECK ("rental_events"."actor_type" in ('CONSUMER','STAFF','SYSTEM')),
	CONSTRAINT "rental_events_actor_shape_check" CHECK (
    ("rental_events"."actor_type" = 'CONSUMER' and "rental_events"."actor_consumer_user_id" is not null and "rental_events"."actor_staff_account_id" is null) or
    ("rental_events"."actor_type" = 'STAFF' and "rental_events"."actor_staff_account_id" is not null and "rental_events"."actor_consumer_user_id" is null) or
    ("rental_events"."actor_type" = 'SYSTEM' and "rental_events"."actor_staff_account_id" is null and "rental_events"."actor_consumer_user_id" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "rental_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "rental_items_quantity_check" CHECK ("rental_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "rental_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_number" text NOT NULL,
	"consumer_user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"client_request_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"borrowed_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_orders_status_check" CHECK ("rental_orders"."status" in ('RESERVED','BORROWED','OVERDUE','RETURNED','CANCELLED')),
	CONSTRAINT "rental_orders_version_check" CHECK ("rental_orders"."version" >= 0),
	CONSTRAINT "rental_orders_lifecycle_check" CHECK (
    ("rental_orders"."status" = 'RESERVED' and "rental_orders"."borrowed_at" is null and "rental_orders"."due_at" is null and "rental_orders"."returned_at" is null and "rental_orders"."cancelled_at" is null) or
    ("rental_orders"."status" in ('BORROWED','OVERDUE') and "rental_orders"."borrowed_at" is not null and "rental_orders"."due_at" is not null and "rental_orders"."returned_at" is null and "rental_orders"."cancelled_at" is null) or
    ("rental_orders"."status" = 'RETURNED' and "rental_orders"."borrowed_at" is not null and "rental_orders"."due_at" is not null and "rental_orders"."returned_at" is not null and "rental_orders"."cancelled_at" is null) or
    ("rental_orders"."status" = 'CANCELLED' and "rental_orders"."borrowed_at" is null and "rental_orders"."due_at" is null and "rental_orders"."returned_at" is null and "rental_orders"."cancelled_at" is not null)
  )
);
--> statement-breakpoint
ALTER TABLE "inventory_transactions" DROP CONSTRAINT "inventory_transactions_type_check";--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_rental_order_id_rental_orders_id_fk" FOREIGN KEY ("rental_order_id") REFERENCES "public"."rental_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_events" ADD CONSTRAINT "rental_events_rental_order_id_rental_orders_id_fk" FOREIGN KEY ("rental_order_id") REFERENCES "public"."rental_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_events" ADD CONSTRAINT "rental_events_actor_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("actor_consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_events" ADD CONSTRAINT "rental_events_actor_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("actor_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_rental_order_id_rental_orders_id_fk" FOREIGN KEY ("rental_order_id") REFERENCES "public"."rental_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_items" ADD CONSTRAINT "rental_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_orders" ADD CONSTRAINT "rental_orders_consumer_user_id_consumer_users_id_fk" FOREIGN KEY ("consumer_user_id") REFERENCES "public"."consumer_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_orders" ADD CONSTRAINT "rental_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservations_rental_sku_unique" ON "inventory_reservations" USING btree ("rental_order_id","sku_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_store_sku_status_idx" ON "inventory_reservations" USING btree ("store_id","sku_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_events_order_type_unique" ON "rental_events" USING btree ("rental_order_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_events_idempotency_unique" ON "rental_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "rental_events_order_created_idx" ON "rental_events" USING btree ("rental_order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_items_order_sku_unique" ON "rental_items" USING btree ("rental_order_id","sku_id");--> statement-breakpoint
CREATE INDEX "rental_items_sku_idx" ON "rental_items" USING btree ("sku_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_orders_number_unique" ON "rental_orders" USING btree ("rental_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_orders_consumer_request_unique" ON "rental_orders" USING btree ("consumer_user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "rental_orders_consumer_status_idx" ON "rental_orders" USING btree ("consumer_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "rental_orders_store_status_idx" ON "rental_orders" USING btree ("store_id","status","created_at");--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_type_check" CHECK ("inventory_transactions"."transaction_type" in ('PURCHASE_RECEIPT','SALE','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT','STOCKTAKE_GAIN','STOCKTAKE_LOSS','TRANSFER_OUT','TRANSFER_IN','RETURN_TO_SUPPLIER','RENTAL_OUT','RENTAL_RETURN'));
--> statement-breakpoint
INSERT INTO "permissions" ("key", "display_name", "description") VALUES
('rental.read','查看租借','查看授权门店的租借单'),
('rental.checkout','租借借出','确认授权门店预约的借出'),
('rental.return','租借归还','确认授权门店租借的归还'),
('rental.manage','租借管理','取消授权门店尚未借出的预约')
ON CONFLICT ("key") DO NOTHING;
