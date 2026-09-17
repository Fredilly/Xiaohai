CREATE TABLE "goods_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "goods_receipt_items_quantity_check" CHECK ("goods_receipt_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_by_staff_account_id" uuid NOT NULL,
	"posted_by_staff_account_id" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_status_check" CHECK ("goods_receipts"."status" in ('DRAFT','POSTED'))
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"transaction_type" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_staff_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transactions_type_check" CHECK ("inventory_transactions"."transaction_type" in ('PURCHASE_RECEIPT','SALE','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT','STOCKTAKE_GAIN','STOCKTAKE_LOSS','TRANSFER_OUT','TRANSFER_IN','RETURN_TO_SUPPLIER')),
	CONSTRAINT "inventory_transactions_delta_nonzero_check" CHECK ("inventory_transactions"."quantity_delta" <> 0),
	CONSTRAINT "inventory_transactions_balance_nonnegative_check" CHECK ("inventory_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" integer,
	CONSTRAINT "purchase_order_items_quantity_check" CHECK ("purchase_order_items"."ordered_quantity" > 0 and "purchase_order_items"."received_quantity" >= 0 and "purchase_order_items"."received_quantity" <= "purchase_order_items"."ordered_quantity"),
	CONSTRAINT "purchase_order_items_cost_check" CHECK ("purchase_order_items"."unit_cost_minor" is null or "purchase_order_items"."unit_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"expected_at" timestamp with time zone,
	"created_by_staff_account_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('DRAFT','SUBMITTED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_transfer_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "stock_transfer_items_quantity_check" CHECK ("stock_transfer_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_number" text NOT NULL,
	"source_store_id" uuid NOT NULL,
	"destination_store_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_by_staff_account_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_distinct_stores_check" CHECK ("stock_transfers"."source_store_id" <> "stock_transfers"."destination_store_id"),
	CONSTRAINT "stock_transfers_status_check" CHECK ("stock_transfers"."status" in ('DRAFT','SUBMITTED','IN_TRANSIT','RECEIVED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "stocktake_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"expected_quantity" integer NOT NULL,
	"expected_version" integer NOT NULL,
	"counted_quantity" integer,
	CONSTRAINT "stocktake_items_values_check" CHECK ("stocktake_items"."expected_quantity" >= 0 and "stocktake_items"."expected_version" >= 0 and ("stocktake_items"."counted_quantity" is null or "stocktake_items"."counted_quantity" >= 0))
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_number" text NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_by_staff_account_id" uuid NOT NULL,
	"reviewed_by_staff_account_id" uuid,
	"posted_by_staff_account_id" uuid,
	"reviewed_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stocktakes_status_check" CHECK ("stocktakes"."status" in ('DRAFT','COUNTING','REVIEWED','POSTED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_status_check" CHECK ("suppliers"."status" in ('ACTIVE','INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("posted_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_stock_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("stock_transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destination_store_id_stores_id_fk" FOREIGN KEY ("destination_store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_stocktake_id_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."stocktakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_created_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_reviewed_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("reviewed_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_posted_by_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("posted_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipt_items_receipt_po_item_unique" ON "goods_receipt_items" USING btree ("goods_receipt_id","purchase_order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_number_unique" ON "goods_receipts" USING btree ("receipt_number");--> statement-breakpoint
CREATE INDEX "goods_receipts_order_status_idx" ON "goods_receipts" USING btree ("purchase_order_id","status");--> statement-breakpoint
CREATE INDEX "goods_receipts_store_created_idx" ON "goods_receipts" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transactions_idempotency_unique" ON "inventory_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transactions_reference_unique" ON "inventory_transactions" USING btree ("reference_type","reference_id","store_id","sku_id","transaction_type");--> statement-breakpoint
CREATE INDEX "inventory_transactions_store_sku_created_idx" ON "inventory_transactions" USING btree ("store_id","sku_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_transactions_reference_idx" ON "inventory_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_items_order_sku_unique" ON "purchase_order_items" USING btree ("purchase_order_id","sku_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_sku_idx" ON "purchase_order_items" USING btree ("sku_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_unique" ON "purchase_orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_store_status_idx" ON "purchase_orders" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfer_items_transfer_sku_unique" ON "stock_transfer_items" USING btree ("stock_transfer_id","sku_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_number_unique" ON "stock_transfers" USING btree ("transfer_number");--> statement-breakpoint
CREATE INDEX "stock_transfers_source_status_idx" ON "stock_transfers" USING btree ("source_store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "stock_transfers_destination_status_idx" ON "stock_transfers" USING btree ("destination_store_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktake_items_stocktake_sku_unique" ON "stocktake_items" USING btree ("stocktake_id","sku_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocktakes_number_unique" ON "stocktakes" USING btree ("stocktake_number");--> statement-breakpoint
CREATE INDEX "stocktakes_store_status_idx" ON "stocktakes" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_unique" ON "suppliers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "suppliers_status_name_idx" ON "suppliers" USING btree ("status","name");
--> statement-breakpoint
INSERT INTO "permissions" ("key","display_name","description") VALUES
('inventory.read','查看库存','查看授权门店的库存、预警和库存流水'),
('inventory.issue','库存出库','对授权门店执行库存出库'),
('inventory.adjust','库存调整','对授权门店执行有审计记录的库存调整'),
('inventory.receive','采购入库','对授权门店创建并过账采购入库单'),
('inventory.stocktake','库存盘点','对授权门店执行盘点流程'),
('inventory.transfer','库存调拨','在授权门店之间执行库存调拨'),
('procurement.manage','采购管理','管理供应商、采购单和采购入库')
ON CONFLICT ("key") DO NOTHING;
