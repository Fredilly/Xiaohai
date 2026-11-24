ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_type_check";--> statement-breakpoint
ALTER TABLE "food_batch_transactions" DROP CONSTRAINT "food_batch_transactions_direction_check";--> statement-breakpoint
ALTER TABLE "food_batches" ADD COLUMN "food_kind" text;--> statement-breakpoint
CREATE INDEX "food_batches_sku_idx" ON "food_batches" USING btree ("sku_id");--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_type_check" CHECK ("food_batch_transactions"."transaction_type" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT','DAMAGE','STOCKTAKE_LOSS'));--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_direction_check" CHECK ((("food_batch_transactions"."transaction_type" in ('NEW_LOT_RECEIPT','EXISTING_LOT_RECEIPT') and "food_batch_transactions"."quantity_delta" > 0) or ("food_batch_transactions"."transaction_type" in ('DAMAGE','STOCKTAKE_LOSS') and "food_batch_transactions"."quantity_delta" < 0)));--> statement-breakpoint
ALTER TABLE "food_batches" ADD CONSTRAINT "food_batches_kind_check" CHECK ("food_batches"."food_kind" is null or "food_batches"."food_kind" in ('PACKAGED_FOOD','SEALED_BEVERAGE'));
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
