ALTER TABLE "store_catalog_metadata" ADD COLUMN "store_price_minor" integer;--> statement-breakpoint
ALTER TABLE "store_catalog_metadata" ADD CONSTRAINT "store_catalog_metadata_inventory_fk" FOREIGN KEY ("store_id","sku_id") REFERENCES "public"."store_inventory"("store_id","sku_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_catalog_metadata" ADD CONSTRAINT "store_catalog_metadata_price_check" CHECK ("store_catalog_metadata"."store_price_minor" is null or "store_catalog_metadata"."store_price_minor" >= 0);
--> statement-breakpoint
-- CODE ONLY: migration/backfill requires a separately authorized write window.
-- Preserve each existing store's current price instead of propagating later SKU edits.
INSERT INTO "store_catalog_metadata" ("store_id","sku_id","store_price_minor")
SELECT i."store_id",i."sku_id",s."price_minor"
FROM "store_inventory" i JOIN "skus" s ON s."id"=i."sku_id"
ON CONFLICT ("store_id","sku_id") DO UPDATE
SET "store_price_minor"=EXCLUDED."store_price_minor"
WHERE "store_catalog_metadata"."store_price_minor" IS NULL;
--> statement-breakpoint
CREATE FUNCTION "initialize_store_sku_price"() RETURNS trigger
LANGUAGE plpgsql AS $store_price$
BEGIN
  INSERT INTO public.store_catalog_metadata (store_id,sku_id,store_price_minor)
  SELECT NEW.store_id,NEW.sku_id,price_minor FROM public.skus WHERE id=NEW.sku_id
  ON CONFLICT (store_id,sku_id) DO UPDATE
    SET store_price_minor=EXCLUDED.store_price_minor,
        version=public.store_catalog_metadata.version+1,updated_at=now()
    WHERE public.store_catalog_metadata.store_price_minor IS NULL;
  RETURN NEW;
END;
$store_price$;
--> statement-breakpoint
CREATE TRIGGER "store_inventory_initialize_price"
AFTER INSERT ON "store_inventory"
FOR EACH ROW EXECUTE FUNCTION "initialize_store_sku_price"();
