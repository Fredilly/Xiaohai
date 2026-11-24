-- #208 additive FEFO reservation evidence. No data backfill, no checkout activation.
CREATE TABLE "food_batch_reservation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_batch_reservation_events_quantity_check" CHECK ("food_batch_reservation_events"."quantity" between 1 and 1000000),
	CONSTRAINT "food_batch_reservation_events_type_check" CHECK ("food_batch_reservation_events"."event_type" in ('RESERVE','RELEASE','SALE')),
	CONSTRAINT "food_batch_reservation_events_key_check" CHECK (length(btrim("food_batch_reservation_events"."idempotency_key")) between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "food_batch_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_batch_reservations_quantity_check" CHECK ("food_batch_reservations"."quantity" between 1 and 1000000),
	CONSTRAINT "food_batch_reservations_status_check" CHECK ("food_batch_reservations"."status" in ('RESERVED','RELEASED','SOLD'))
);
--> statement-breakpoint
ALTER TABLE "food_batch_reservation_events" ADD CONSTRAINT "food_batch_reservation_events_reservation_id_food_batch_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."food_batch_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_batch_reservations" ADD CONSTRAINT "food_batch_reservations_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_batch_reservations" ADD CONSTRAINT "food_batch_reservations_scope_fk" FOREIGN KEY ("store_id","sku_id","batch_id") REFERENCES "public"."food_batches"("store_id","sku_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "food_batch_reservation_events_key_unique" ON "food_batch_reservation_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "food_batch_reservation_events_reservation_idx" ON "food_batch_reservation_events" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "food_batch_reservations_order_batch_unique" ON "food_batch_reservations" USING btree ("order_item_id","batch_id");--> statement-breakpoint
CREATE INDEX "food_batch_reservations_batch_status_idx" ON "food_batch_reservations" USING btree ("batch_id","status");
--> statement-breakpoint
-- Reservation events are an append-only allocation ledger. A zero-delta
-- reservation must never be faked as an inventory_transactions stock movement.
CREATE FUNCTION "reject_food_reservation_event_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $food_reservation_event_immutable$
BEGIN
  RAISE EXCEPTION 'FOOD_RESERVATION_EVENT_APPEND_ONLY' USING ERRCODE = '55000';
END;
$food_reservation_event_immutable$;
--> statement-breakpoint
CREATE TRIGGER "food_reservation_event_append_only"
BEFORE UPDATE OR DELETE ON "food_batch_reservation_events"
FOR EACH ROW EXECUTE FUNCTION "reject_food_reservation_event_mutation"();
--> statement-breakpoint
CREATE FUNCTION "guard_food_reservation_identity"() RETURNS trigger
LANGUAGE plpgsql AS $food_reservation_identity$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FOOD_RESERVATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.order_item_id <> OLD.order_item_id OR
     NEW.store_id <> OLD.store_id OR NEW.sku_id <> OLD.sku_id OR
     NEW.batch_id <> OLD.batch_id OR NEW.quantity <> OLD.quantity OR
     NEW.created_at <> OLD.created_at OR OLD.status <> 'RESERVED' OR
     NEW.status NOT IN ('RELEASED','SOLD') THEN
    RAISE EXCEPTION 'FOOD_RESERVATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$food_reservation_identity$;
--> statement-breakpoint
CREATE TRIGGER "food_reservation_identity_guard"
BEFORE UPDATE OR DELETE ON "food_batch_reservations"
FOR EACH ROW EXECUTE FUNCTION "guard_food_reservation_identity"();
--> statement-breakpoint
CREATE FUNCTION "assert_food_reservation_event_sequence"(target_id uuid) RETURNS void
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
END;
$food_reservation_sequence$;
--> statement-breakpoint
CREATE FUNCTION "check_food_reservation_sequence"() RETURNS trigger
LANGUAGE plpgsql AS $food_reservation_check$
BEGIN
  IF TG_TABLE_NAME = 'food_batch_reservation_events' THEN
    PERFORM public.assert_food_reservation_event_sequence(NEW.reservation_id);
  ELSE
    PERFORM public.assert_food_reservation_event_sequence(NEW.id);
  END IF;
  RETURN NULL;
END;
$food_reservation_check$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "food_reservation_sequence_guard"
AFTER INSERT OR UPDATE ON "food_batch_reservations" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_food_reservation_sequence"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "food_reservation_event_sequence_guard"
AFTER INSERT ON "food_batch_reservation_events" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_food_reservation_sequence"();
