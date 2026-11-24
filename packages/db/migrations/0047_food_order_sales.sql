ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_type_check";--> statement-breakpoint
ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_direction_check";--> statement-breakpoint
ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_allocation_check";--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_type_check" CHECK ("food_batch_transactions"."transaction_type" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT','DAMAGE','STOCKTAKE_LOSS','DISPOSAL','SALE'));--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_direction_check" CHECK ((("food_batch_transactions"."transaction_type" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT') and "food_batch_transactions"."quantity_delta" > 0) or ("food_batch_transactions"."transaction_type" in ('DAMAGE','STOCKTAKE_LOSS','DISPOSAL','SALE') and "food_batch_transactions"."quantity_delta" < 0)));--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_allocation_check" CHECK ("food_batch_transactions"."reserved_before" >= 0 and "food_batch_transactions"."reserved_after" >= 0 and "food_batch_transactions"."blocked_before" >= 0 and "food_batch_transactions"."blocked_after" >= 0 and (("food_batch_transactions"."transaction_type" = 'SALE' and "food_batch_transactions"."reserved_after" = "food_batch_transactions"."reserved_before" + "food_batch_transactions"."quantity_delta") or ("food_batch_transactions"."transaction_type" <> 'SALE' and "food_batch_transactions"."reserved_before" = "food_batch_transactions"."reserved_after")) and "food_batch_transactions"."blocked_before" = "food_batch_transactions"."blocked_after" and "food_batch_transactions"."reserved_after" + "food_batch_transactions"."blocked_after" <= "food_batch_transactions"."on_hand_after");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bind_food_batch_event"() RETURNS trigger
LANGUAGE plpgsql AS $food_bind$
DECLARE
  aggregate_row public.inventory_transactions%ROWTYPE;
  expected_type text;
BEGIN
  SELECT * INTO aggregate_row FROM public.inventory_transactions
    WHERE id = NEW.aggregate_transaction_id FOR UPDATE;
  -- Let the scoped FK report absent/foreign aggregate identities.
  IF NOT FOUND OR aggregate_row.store_id <> NEW.store_id OR aggregate_row.sku_id <> NEW.sku_id THEN
    RETURN NEW;
  END IF;
  expected_type := CASE NEW.transaction_type
    WHEN 'NEW_LOT_RECEIPT' THEN 'PURCHASE_RECEIPT'
    WHEN 'EXISTING_LOT_RECEIPT' THEN 'PURCHASE_RECEIPT'
    WHEN 'DAMAGE' THEN 'ADJUSTMENT_OUT'
    WHEN 'DISPOSAL' THEN 'ADJUSTMENT_OUT'
    WHEN 'SALE' THEN 'SALE'
    WHEN 'STOCKTAKE_LOSS' THEN 'STOCKTAKE_LOSS'
    ELSE NULL END;
  IF aggregate_row.reference_type <> 'FOOD_BATCH_OPERATION'
    OR aggregate_row.metadata->>'source' IS DISTINCT FROM 'FOOD_BATCH_OPERATION'
    OR aggregate_row.transaction_type IS DISTINCT FROM expected_type
    OR aggregate_row.reference_type <> NEW.reference_type
    OR aggregate_row.reference_id <> NEW.reference_id
    OR aggregate_row.created_by_staff_account_id <> NEW.created_by_staff_account_id
    OR aggregate_row.reason IS DISTINCT FROM NEW.reason THEN
    RAISE EXCEPTION 'FOOD_BATCH_GROUP_IDENTITY_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$food_bind$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_food_reservation_event_sequence"(target_id uuid) RETURNS void
LANGUAGE plpgsql AS $food_reservation_sequence$
DECLARE
  allocation public.food_batch_reservations%ROWTYPE;
  reserve_count bigint;
  release_count bigint;
  sale_count bigint;
  event_count bigint;
BEGIN
  SELECT * INTO STRICT allocation FROM public.food_batch_reservations WHERE id = target_id FOR UPDATE;
  SELECT count(*), count(*) FILTER (WHERE event_type='RESERVE'),
         count(*) FILTER (WHERE event_type='RELEASE'),
         count(*) FILTER (WHERE event_type='SALE')
  INTO event_count, reserve_count, release_count, sale_count
  FROM public.food_batch_reservation_events
  WHERE reservation_id = target_id AND quantity = allocation.quantity;
  IF reserve_count <> 1 OR event_count <> (SELECT count(*) FROM public.food_batch_reservation_events WHERE reservation_id=target_id)
    OR (allocation.status='RESERVED' AND (release_count <> 0 OR sale_count <> 0))
    OR (allocation.status='RELEASED' AND (release_count <> 1 OR sale_count <> 0))
    OR (allocation.status='SOLD' AND (release_count <> 0 OR sale_count <> 1)) THEN
    RAISE EXCEPTION 'FOOD_RESERVATION_EVENT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF (SELECT sum(quantity) FROM food_batch_reservations WHERE order_item_id=allocation.order_item_id) IS DISTINCT FROM (SELECT quantity::bigint FROM order_items WHERE id=allocation.order_item_id)
    OR (SELECT count(DISTINCT status) FROM food_batch_reservations WHERE order_item_id=allocation.order_item_id)<>1 THEN
    RAISE EXCEPTION 'FOOD_ORDER_ALLOCATION_GROUP_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF allocation.status='SOLD' AND NOT EXISTS (
    SELECT 1 FROM food_batch_transactions e JOIN inventory_transactions a ON a.id=e.aggregate_transaction_id
    WHERE e.batch_id=allocation.batch_id AND e.transaction_type='SALE' AND e.quantity_delta=-allocation.quantity
      AND a.metadata->>'orderItemId'=allocation.order_item_id::text
  ) THEN RAISE EXCEPTION 'FOOD_SALE_LEDGER_MISSING' USING ERRCODE='23514'; END IF;
END;
$food_reservation_sequence$;

--> statement-breakpoint
CREATE FUNCTION guard_food_order_allocation_identity() RETURNS trigger LANGUAGE plpgsql AS $identity$
DECLARE item public.order_items%ROWTYPE; p uuid; d uuid;
BEGIN
 SELECT * INTO STRICT item FROM order_items WHERE id=NEW.order_item_id;
 SELECT store_id INTO p FROM pickup_codes WHERE order_id=item.order_id;
 SELECT store_id INTO d FROM deliveries WHERE order_id=item.order_id;
 IF NEW.sku_id<>item.sku_id OR (p IS NOT NULL AND d IS NOT NULL) OR coalesce(p,d) IS DISTINCT FROM NEW.store_id
 THEN RAISE EXCEPTION 'FOOD_ORDER_ALLOCATION_IDENTITY_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$identity$;
--> statement-breakpoint
CREATE TRIGGER food_order_allocation_identity_guard BEFORE INSERT ON food_batch_reservations FOR EACH ROW EXECUTE FUNCTION guard_food_order_allocation_identity();
