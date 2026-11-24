-- #208 additive schema only. No backfill, no staff write endpoint, no checkout activation.
-- Apply only to disposable CI DB until separate owner-approved staging migration.
CREATE TABLE "food_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "sku_id" uuid NOT NULL,
  "lot_code" text NOT NULL,
  "manufactured_on" date,
  "expires_on" date NOT NULL,
  "on_hand" integer DEFAULT 0 NOT NULL,
  "reserved" integer DEFAULT 0 NOT NULL,
  "blocked" integer DEFAULT 0 NOT NULL,
  "state" text DEFAULT 'HELD' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_by_staff_account_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "food_batches_quantities_check" CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "blocked" >= 0 AND "reserved" + "blocked" <= "on_hand"),
  CONSTRAINT "food_batches_status_check" CHECK ("state" IN ('AVAILABLE','HELD','RECALLED')),
  CONSTRAINT "food_batches_version_check" CHECK ("version" >= 0),
  CONSTRAINT "food_batches_lot_code_check" CHECK (length(btrim("lot_code")) BETWEEN 1 AND 100),
  CONSTRAINT "food_batches_dates_check" CHECK ("manufactured_on" IS NULL OR "expires_on" >= "manufactured_on")
);
--> statement-breakpoint
ALTER TABLE "food_batches" ADD CONSTRAINT "food_batches_inventory_fk"
  FOREIGN KEY ("store_id","sku_id") REFERENCES "public"."store_inventory"("store_id","sku_id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "food_batches" ADD CONSTRAINT "food_batches_created_by_staff_account_id_staff_accounts_id_fk"
  FOREIGN KEY ("created_by_staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "food_batches_store_sku_id_unique" ON "food_batches" ("store_id","sku_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "food_batches_lot_expiry_unique" ON "food_batches" ("store_id","sku_id","lot_code","expires_on");
--> statement-breakpoint
CREATE INDEX "food_batches_store_sku_expiry_idx" ON "food_batches" ("store_id","sku_id","expires_on");
--> statement-breakpoint
-- Existing aggregate history is never rewritten. The extra unique target is needed
-- for the same-Store/SKU aggregate-event foreign key below.
CREATE UNIQUE INDEX "inventory_transactions_store_sku_id_unique"
  ON "inventory_transactions" ("store_id","sku_id","id");
--> statement-breakpoint
CREATE TABLE "food_batch_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "sku_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "transaction_type" text NOT NULL,
  "quantity_delta" integer NOT NULL,
  "on_hand_before" integer NOT NULL,
  "on_hand_after" integer NOT NULL,
  "reserved_before" integer NOT NULL,
  "reserved_after" integer NOT NULL,
  "blocked_before" integer NOT NULL,
  "blocked_after" integer NOT NULL,
  "aggregate_transaction_id" uuid NOT NULL,
  "reference_type" text NOT NULL,
  "reference_id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "reason" text NOT NULL,
  "created_by_staff_account_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "food_batch_transactions_type_check" CHECK ("transaction_type" IN ('EXISTING_LOT_RECEIPT','DAMAGE','STOCKTAKE_LOSS')),
  CONSTRAINT "food_batch_transactions_quantity_check" CHECK ("on_hand_before" >= 0 AND "on_hand_after" >= 0 AND "on_hand_after" = "on_hand_before" + "quantity_delta"),
  CONSTRAINT "food_batch_transactions_direction_check" CHECK (
    ("transaction_type" = 'EXISTING_LOT_RECEIPT' AND "quantity_delta" > 0) OR
    ("transaction_type" IN ('DAMAGE','STOCKTAKE_LOSS') AND "quantity_delta" < 0)
  ),
  CONSTRAINT "food_batch_transactions_allocation_check" CHECK (
    "reserved_before" >= 0 AND "reserved_after" >= 0 AND
    "blocked_before" >= 0 AND "blocked_after" >= 0 AND
    "reserved_before" = "reserved_after" AND
    "blocked_before" = "blocked_after" AND
    "reserved_after" + "blocked_after" <= "on_hand_after"
  ),
  CONSTRAINT "food_batch_transactions_evidence_check" CHECK (
    length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND
    length(btrim("reference_type")) BETWEEN 1 AND 100 AND
    length(btrim("reason")) BETWEEN 1 AND 500
  )
);
--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_batch_scope_fk"
  FOREIGN KEY ("store_id","sku_id","batch_id")
  REFERENCES "public"."food_batches"("store_id","sku_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_aggregate_scope_fk"
  FOREIGN KEY ("store_id","sku_id","aggregate_transaction_id")
  REFERENCES "public"."inventory_transactions"("store_id","sku_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "food_batch_transactions" ADD CONSTRAINT "food_batch_transactions_created_by_staff_account_id_staff_accounts_id_fk"
  FOREIGN KEY ("created_by_staff_account_id")
  REFERENCES "public"."staff_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "food_batch_transactions_idempotency_unique" ON "food_batch_transactions" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "food_batch_transactions_aggregate_batch_unique" ON "food_batch_transactions" ("aggregate_transaction_id","batch_id");
--> statement-breakpoint
CREATE INDEX "food_batch_transactions_store_sku_created_idx" ON "food_batch_transactions" ("store_id","sku_id","created_at");
--> statement-breakpoint
CREATE FUNCTION "reject_food_batch_transaction_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $food_immutable$
BEGIN
  RAISE EXCEPTION 'FOOD_BATCH_LEDGER_APPEND_ONLY' USING ERRCODE = '55000';
END;
$food_immutable$;
--> statement-breakpoint
CREATE TRIGGER "food_batch_transactions_append_only"
BEFORE UPDATE OR DELETE ON "food_batch_transactions"
FOR EACH ROW EXECUTE FUNCTION "reject_food_batch_transaction_mutation"();
--> statement-breakpoint
-- Every operation has ONE aggregate and one event per affected lot. This lock
-- serializes contenders for a group; no partial group can commit independently.
CREATE FUNCTION "bind_food_batch_event"() RETURNS trigger
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
--> statement-breakpoint
CREATE TRIGGER "food_batch_event_identity"
BEFORE INSERT ON "food_batch_transactions"
FOR EACH ROW EXECUTE FUNCTION "bind_food_batch_event"();
--> statement-breakpoint
CREATE FUNCTION "assert_food_batch_group"(aggregate_id uuid) RETURNS void
LANGUAGE plpgsql AS $food_sum$
DECLARE
  aggregate_row public.inventory_transactions%ROWTYPE;
  actual_delta bigint;
  event_count bigint;
  kinds bigint;
BEGIN
  SELECT * INTO STRICT aggregate_row FROM public.inventory_transactions
    WHERE id = aggregate_id FOR UPDATE;
  SELECT count(*), coalesce(sum(quantity_delta::bigint), 0), count(DISTINCT transaction_type)
    INTO event_count, actual_delta, kinds FROM public.food_batch_transactions
    WHERE aggregate_transaction_id = aggregate_id;
  IF event_count = 0 OR kinds <> 1 OR actual_delta <> aggregate_row.quantity_delta::bigint THEN
    RAISE EXCEPTION 'FOOD_BATCH_GROUP_DELTA_MISMATCH' USING ERRCODE = '23514';
  END IF;
END;
$food_sum$;
--> statement-breakpoint
CREATE FUNCTION "check_food_batch_group"() RETURNS trigger
LANGUAGE plpgsql AS $food_group$
BEGIN
  IF TG_TABLE_NAME = 'food_batch_transactions' THEN
    PERFORM public.assert_food_batch_group(NEW.aggregate_transaction_id);
  ELSIF NEW.reference_type = 'FOOD_BATCH_OPERATION'
    OR NEW.metadata->>'source' = 'FOOD_BATCH_OPERATION' THEN
    PERFORM public.assert_food_batch_group(NEW.id);
  END IF;
  RETURN NULL;
END;
$food_group$;
--> statement-breakpoint
-- Check at transaction end, after ALL lot events have been inserted. Both
-- directions matter: an aggregate marked as food cannot commit with no events.
CREATE CONSTRAINT TRIGGER "food_batch_group_total"
AFTER INSERT ON "food_batch_transactions" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_food_batch_group"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "food_aggregate_group_total"
AFTER INSERT ON "inventory_transactions" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_food_batch_group"();
--> statement-breakpoint
CREATE FUNCTION "reject_food_aggregate_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $food_parent_immutable$
BEGIN
  IF OLD.reference_type = 'FOOD_BATCH_OPERATION'
    OR OLD.metadata->>'source' = 'FOOD_BATCH_OPERATION'
    OR EXISTS (SELECT 1 FROM public.food_batch_transactions WHERE aggregate_transaction_id = OLD.id)
    OR (TG_OP = 'UPDATE' AND (NEW.reference_type = 'FOOD_BATCH_OPERATION'
      OR NEW.metadata->>'source' = 'FOOD_BATCH_OPERATION')) THEN
    RAISE EXCEPTION 'FOOD_BATCH_AGGREGATE_APPEND_ONLY' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$food_parent_immutable$;
--> statement-breakpoint
CREATE TRIGGER "food_aggregate_append_only"
BEFORE UPDATE OR DELETE ON "inventory_transactions"
FOR EACH ROW EXECUTE FUNCTION "reject_food_aggregate_mutation"();
