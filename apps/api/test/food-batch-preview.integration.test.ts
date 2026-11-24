import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, products, regions, skus, storeInventory, stores } from '@xiaohai/db';
import { FoodBatchPreviewService } from '../src/inventory/food-batch-preview-service.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

// Fixture inserts and deletes must never run against live merchant data.
// Check both DATABASE_URL and effective TEST_DATABASE_URL before pool creation.
const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;

suite('read-only food batch preview against disposable PostgreSQL', () => {
  const db = database!.db;
  const service = new FoodBatchPreviewService(db);
  afterAll(async () => {
    await database!.pool.end();
  });

  it('checks proposed lots against the real Store/SKU stock and refuses foreign lots', async () => {
    const suffix = randomUUID();
    const [region] = await db
      .insert(regions)
      .values({
        code: 'FOOD-PRV-R-' + suffix,
        name: 'Isolated food preview region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    const [store] = await db
      .insert(stores)
      .values({
        code: 'FOOD-PRV-S-' + suffix,
        name: 'Isolated food preview store',
        regionId: region!.id,
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Test only',
        latitude: 30,
        longitude: 104,
      })
      .returning({ id: stores.id });
    const [product] = await db
      .insert(products)
      .values({ name: 'Test packaged crackers', status: 'ACTIVE' })
      .returning({ id: products.id });
    const [sku] = await db
      .insert(skus)
      .values({
        productId: product!.id,
        code: 'FOOD-PRV-SKU-' + suffix,
        name: 'Small package',
        priceMinor: 1800,
        availableForSale: true,
      })
      .returning({ id: skus.id });
    await db.insert(storeInventory).values({
      storeId: store!.id,
      skuId: sku!.id,
      onHand: 6,
      reserved: 1,
      rentalReserved: 0,
    });

    const batches = [
      {
        id: randomUUID(),
        storeId: store!.id,
        skuId: sku!.id,
        lotCode: 'FOOD-LOT-FUTURE',
        manufacturedOn: '2026-10-01',
        expiresOn: '2026-12-01',
        onHand: 4,
        reserved: 1,
        blocked: 0,
        state: 'AVAILABLE' as const,
      },
      {
        id: randomUUID(),
        storeId: store!.id,
        skuId: sku!.id,
        lotCode: 'FOOD-LOT-EXPIRED',
        manufacturedOn: '2026-09-01',
        expiresOn: '2026-11-06',
        onHand: 2,
        reserved: 0,
        blocked: 0,
        state: 'AVAILABLE' as const,
      },
    ];

    try {
      const matching = await service.preview(store!.id, sku!.id, {
        businessDate: '2026-11-07',
        batches,
      });
      expect(matching).toMatchObject({
        mode: 'READ_ONLY_PROPOSAL',
        checkoutEnabled: false,
        storeId: store!.id,
        skuId: sku!.id,
        result: {
          status: 'READY',
          sellable: 3,
          expiredOnHand: 2,
        },
      });

      const mismatch = await service.preview(store!.id, sku!.id, {
        businessDate: '2026-11-07',
        batches: batches.slice(0, 1),
      });
      expect(mismatch.result).toMatchObject({ status: 'MISMATCH', sellable: 0 });

      await expect(
        service.preview(store!.id, sku!.id, {
          businessDate: '2026-11-07',
          batches: [{ ...batches[0]!, storeId: randomUUID() }],
        }),
      ).rejects.toThrow('CROSS_STORE_FOOD_BATCH');

      await expect(
        service.preview(store!.id, randomUUID(), {
          businessDate: '2026-11-07',
          batches,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await db.update(products).set({ status: 'DRAFT' }).where(eq(products.id, product!.id));
      const disabled = await service.preview(store!.id, sku!.id, {
        businessDate: '2026-11-07',
        batches,
      });
      expect(disabled.result).toMatchObject({ status: 'DISABLED', sellable: 0 });
    } finally {
      await db.delete(storeInventory).where(eq(storeInventory.skuId, sku!.id));
      await db.delete(skus).where(eq(skus.id, sku!.id));
      await db.delete(products).where(eq(products.id, product!.id));
      await db.delete(stores).where(eq(stores.id, store!.id));
      await db.delete(regions).where(eq(regions.id, region!.id));
    }
  });
});
