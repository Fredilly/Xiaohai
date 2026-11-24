CREATE TABLE "food_physical_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"returned_batch_id" uuid NOT NULL,
	"aggregate_transaction_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text NOT NULL,
	"source_ref" text NOT NULL,
	"actor_staff_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_physical_returns_quantity_check" CHECK ("food_physical_returns"."quantity" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "food_transfer_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_item_id" uuid NOT NULL,
	"source_batch_id" uuid NOT NULL,
	"destination_batch_id" uuid,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_transfer_allocations_quantity_check" CHECK ("food_transfer_allocations"."quantity" between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_original_status_check";--> statement-breakpoint
ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_type_check";--> statement-breakpoint
ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_direction_check";--> statement-breakpoint
ALTER TABLE "food_physical_returns" ADD CONSTRAINT "food_physical_returns_reservation_id_food_batch_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."food_batch_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_physical_returns" ADD CONSTRAINT "food_physical_returns_returned_batch_id_food_batches_id_fk" FOREIGN KEY ("returned_batch_id") REFERENCES "public"."food_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_physical_returns" ADD CONSTRAINT "food_physical_returns_aggregate_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("aggregate_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_physical_returns" ADD CONSTRAINT "food_physical_returns_actor_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("actor_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_transfer_allocations" ADD CONSTRAINT "food_transfer_allocations_transfer_item_id_stock_transfer_items_id_fk" FOREIGN KEY ("transfer_item_id") REFERENCES "public"."stock_transfer_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_transfer_allocations" ADD CONSTRAINT "food_transfer_allocations_source_batch_id_food_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."food_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_transfer_allocations" ADD CONSTRAINT "food_transfer_allocations_destination_batch_id_food_batches_id_fk" FOREIGN KEY ("destination_batch_id") REFERENCES "public"."food_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_physical_returns_key_unique" ON "food_physical_returns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "food_physical_returns_batch_unique" ON "food_physical_returns" USING btree ("returned_batch_id");--> statement-breakpoint
CREATE INDEX "food_physical_returns_reservation_idx" ON "food_physical_returns" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_transfer_allocations_item_batch_unique" ON "food_transfer_allocations" USING btree ("transfer_item_id","source_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_transfer_allocations_destination_unique" ON "food_transfer_allocations" USING btree ("destination_batch_id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_original_status_check" CHECK ("refunds"."original_order_status" in ('PAID','CANCELLED','PICKUP_READY','DELIVERING','COMPLETED'));--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_type_check" CHECK ("food_batch_transactions"."transaction_type" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT','DAMAGE','STOCKTAKE_LOSS','DISPOSAL','SALE','PHYSICAL_RETURN','TRANSFER_OUT','TRANSFER_IN'));--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_direction_check" CHECK ((("food_batch_transactions"."transaction_type" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT','PHYSICAL_RETURN','TRANSFER_IN') and "food_batch_transactions"."quantity_delta" > 0) or ("food_batch_transactions"."transaction_type" in ('DAMAGE','STOCKTAKE_LOSS','DISPOSAL','SALE','TRANSFER_OUT') and "food_batch_transactions"."quantity_delta" < 0)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bind_food_batch_event"() RETURNS trigger
LANGUAGE plpgsql AS $bind$
DECLARE a public.inventory_transactions%ROWTYPE; expected text;
BEGIN
 SELECT * INTO a FROM public.inventory_transactions WHERE id=NEW.aggregate_transaction_id FOR UPDATE;
 IF NOT FOUND OR a.store_id<>NEW.store_id OR a.sku_id<>NEW.sku_id THEN RETURN NEW; END IF;
 expected:=CASE NEW.transaction_type WHEN 'NEW_LOT_RECEIPT' THEN 'PURCHASE_RECEIPT' WHEN 'EXISTING_LOT_RECEIPT' THEN 'PURCHASE_RECEIPT'
 WHEN 'DAMAGE' THEN 'ADJUSTMENT_OUT' WHEN 'DISPOSAL' THEN 'ADJUSTMENT_OUT' WHEN 'STOCKTAKE_LOSS' THEN 'STOCKTAKE_LOSS' WHEN 'SALE' THEN 'SALE'
 WHEN 'PHYSICAL_RETURN' THEN 'ADJUSTMENT_IN' WHEN 'TRANSFER_OUT' THEN 'TRANSFER_OUT' WHEN 'TRANSFER_IN' THEN 'TRANSFER_IN' ELSE NULL END;
 IF a.reference_type<>'FOOD_BATCH_OPERATION' OR a.metadata->>'source' IS DISTINCT FROM 'FOOD_BATCH_OPERATION' OR a.transaction_type IS DISTINCT FROM expected
 OR a.reference_type<>NEW.reference_type OR a.reference_id<>NEW.reference_id OR a.created_by_staff_account_id<>NEW.created_by_staff_account_id OR a.reason IS DISTINCT FROM NEW.reason
 THEN RAISE EXCEPTION 'FOOD_BATCH_GROUP_IDENTITY_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$bind$;
--> statement-breakpoint
CREATE FUNCTION guard_food_physical_return() RETURNS trigger LANGUAGE plpgsql AS $returns$
DECLARE r public.food_batch_reservations%ROWTYPE; original public.food_batches%ROWTYPE; received public.food_batches%ROWTYPE; a public.inventory_transactions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FOOD_RETURN_APPEND_ONLY' USING ERRCODE='55000'; END IF;
 SELECT * INTO STRICT r FROM public.food_batch_reservations WHERE id=NEW.reservation_id FOR UPDATE;
 SELECT * INTO STRICT original FROM public.food_batches WHERE id=r.batch_id;
 SELECT * INTO STRICT received FROM public.food_batches WHERE id=NEW.returned_batch_id;
 SELECT * INTO STRICT a FROM public.inventory_transactions WHERE id=NEW.aggregate_transaction_id;
 IF NOT EXISTS(SELECT 1 FROM food_batch_transactions e JOIN inventory_transactions sale_total ON sale_total.id=e.aggregate_transaction_id WHERE e.batch_id=r.batch_id AND e.transaction_type='SALE' AND e.quantity_delta=-r.quantity AND sale_total.metadata->>'orderItemId'=r.order_item_id::text) OR r.status<>'SOLD' OR NEW.quantity+COALESCE((SELECT sum(quantity) FROM public.food_physical_returns WHERE reservation_id=r.id),0)>r.quantity
 OR received.id=original.id OR received.store_id<>r.store_id OR received.sku_id<>r.sku_id OR received.state<>'HELD'
 OR received.expires_on<>original.expires_on OR received.manufactured_on IS DISTINCT FROM original.manufactured_on OR received.food_kind IS DISTINCT FROM original.food_kind
 OR a.store_id<>r.store_id OR a.sku_id<>r.sku_id OR a.transaction_type<>'ADJUSTMENT_IN' OR a.quantity_delta<>NEW.quantity
 THEN RAISE EXCEPTION 'FOOD_RETURN_IDENTITY_OR_QUANTITY_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$returns$;
--> statement-breakpoint
CREATE TRIGGER food_physical_return_guard BEFORE INSERT OR UPDATE OR DELETE ON food_physical_returns FOR EACH ROW EXECUTE FUNCTION guard_food_physical_return();
--> statement-breakpoint
CREATE FUNCTION guard_food_transfer_line() RETURNS trigger LANGUAGE plpgsql AS $transfer$
DECLARE item public.stock_transfer_items%ROWTYPE; doc public.stock_transfers%ROWTYPE; origin public.food_batches%ROWTYPE; dest public.food_batches%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FOOD_TRANSFER_TRACE_IMMUTABLE' USING ERRCODE='55000'; END IF;
 SELECT * INTO STRICT item FROM public.stock_transfer_items WHERE id=NEW.transfer_item_id;
 SELECT * INTO STRICT doc FROM public.stock_transfers WHERE id=item.stock_transfer_id;
 SELECT * INTO STRICT origin FROM public.food_batches WHERE id=NEW.source_batch_id;
 IF origin.store_id<>doc.source_store_id OR origin.sku_id<>item.sku_id OR origin.food_kind IS NULL THEN RAISE EXCEPTION 'FOOD_TRANSFER_IDENTITY_MISMATCH' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF doc.status<>'SUBMITTED' OR NEW.destination_batch_id IS NOT NULL THEN RAISE EXCEPTION 'FOOD_TRANSFER_INVALID_STATE' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW.transfer_item_id<>OLD.transfer_item_id OR NEW.source_batch_id<>OLD.source_batch_id OR NEW.quantity<>OLD.quantity OR NEW.created_at<>OLD.created_at OR OLD.destination_batch_id IS NOT NULL OR NEW.destination_batch_id IS NULL OR doc.status<>'IN_TRANSIT'
  THEN RAISE EXCEPTION 'FOOD_TRANSFER_TRACE_IMMUTABLE' USING ERRCODE='55000'; END IF;
  SELECT * INTO STRICT dest FROM public.food_batches WHERE id=NEW.destination_batch_id;
  IF dest.store_id<>doc.destination_store_id OR dest.sku_id<>item.sku_id OR dest.state<>'HELD' OR dest.food_kind IS DISTINCT FROM origin.food_kind OR dest.expires_on<>origin.expires_on OR dest.manufactured_on IS DISTINCT FROM origin.manufactured_on
  THEN RAISE EXCEPTION 'FOOD_TRANSFER_IDENTITY_MISMATCH' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;$transfer$;
--> statement-breakpoint
CREATE TRIGGER food_transfer_line_guard BEFORE INSERT OR UPDATE OR DELETE ON food_transfer_allocations FOR EACH ROW EXECUTE FUNCTION guard_food_transfer_line();
--> statement-breakpoint
CREATE FUNCTION check_food_transfer_group() RETURNS trigger LANGUAGE plpgsql AS $group$
DECLARE target uuid; expected integer; actual bigint; doc public.stock_transfers%ROWTYPE; incomplete bigint;
BEGIN
 target:=NEW.transfer_item_id;
 SELECT quantity INTO STRICT expected FROM public.stock_transfer_items WHERE id=target;
 SELECT t.* INTO STRICT doc FROM public.stock_transfers t JOIN public.stock_transfer_items i ON i.stock_transfer_id=t.id WHERE i.id=target;
 SELECT sum(quantity),count(*) FILTER(WHERE destination_batch_id IS NULL) INTO actual,incomplete FROM public.food_transfer_allocations WHERE transfer_item_id=target;
 IF actual IS DISTINCT FROM expected::bigint OR (doc.status='RECEIVED' AND incomplete<>0) OR (doc.status='IN_TRANSIT' AND incomplete<>(SELECT count(*) FROM food_transfer_allocations WHERE transfer_item_id=target))
 THEN RAISE EXCEPTION 'FOOD_TRANSFER_GROUP_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM food_transfer_allocations l WHERE l.transfer_item_id=target AND (
  NOT EXISTS(SELECT 1 FROM food_batch_transactions e JOIN inventory_transactions a ON a.id=e.aggregate_transaction_id WHERE e.batch_id=l.source_batch_id AND e.transaction_type='TRANSFER_OUT' AND e.quantity_delta=-l.quantity AND a.metadata->>'transferId'=doc.id::text)
  OR (l.destination_batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM food_batch_transactions e JOIN inventory_transactions a ON a.id=e.aggregate_transaction_id WHERE e.batch_id=l.destination_batch_id AND e.transaction_type='TRANSFER_IN' AND e.quantity_delta=l.quantity AND a.metadata->>'transferId'=doc.id::text))
 )) THEN RAISE EXCEPTION 'FOOD_TRANSFER_LEDGER_MISSING' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;$group$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER food_transfer_group_guard AFTER INSERT OR UPDATE ON food_transfer_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_food_transfer_group();
--> statement-breakpoint
CREATE FUNCTION food_lot_origin_usable(target uuid, ignore_root boolean DEFAULT false) RETURNS boolean LANGUAGE sql VOLATILE AS $origin$
 WITH RECURSIVE edges(child,parent) AS (
  SELECT destination_batch_id,source_batch_id FROM food_transfer_allocations WHERE destination_batch_id IS NOT NULL
  UNION ALL SELECT p.returned_batch_id,r.batch_id FROM food_physical_returns p JOIN food_batch_reservations r ON r.id=p.reservation_id
 ), ancestry(id,depth,path,cycle) AS (
  SELECT target,0,ARRAY[target],false
  UNION ALL SELECT e.parent,a.depth+1,a.path||e.parent,e.parent=ANY(a.path) FROM ancestry a JOIN edges e ON e.child=a.id WHERE NOT a.cycle AND a.depth<=32
 ) SELECT coalesce(count(*)>0 AND bool_and(NOT a.cycle AND a.depth<=32 AND b.food_kind IS NOT NULL AND b.expires_on>=(clock_timestamp() AT TIME ZONE s.timezone)::date AND ((ignore_root AND a.depth=0) OR b.state='AVAILABLE')) AND count(DISTINCT b.food_kind)=1,false)
 FROM ancestry a LEFT JOIN food_batches b ON b.id=a.id LEFT JOIN stores s ON s.id=b.store_id;
$origin$;
