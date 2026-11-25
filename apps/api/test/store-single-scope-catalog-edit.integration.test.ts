import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  createDatabase,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { CatalogEditService } from '../src/commerce/catalog-edit-service.js';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

// This suite creates/removes isolated rows. Never connect to a real/shared DB.
const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;

suite('single-store shared-catalog editing (disposable PostgreSQL only)', () => {
  // Vitest still evaluates the callback of describe.skip while collecting tests.
  if (!database) {
    it('requires an isolated PostgreSQL database', () => {});
    return;
  }
  const db = database.db;
  const editor = new CatalogEditService(db, 'isolated-store-only-catalog-preview-signature-secret');
  const reader = new StoreCatalogReadService(db);
  afterAll(async () => {
    await database.pool.end();
  });

  it('permits an isolated store item but rejects a newly shared item before any write', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'store-only-' + suffix + '@example.com',
        passwordHash: 'isolated-test-only',
      })
      .returning({ id: staffAccounts.id });
    const [region] = await db
      .insert(regions)
      .values({
        code: 'STORE-ONLY-R-' + suffix,
        name: 'Isolated Region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    const linkedStores = await db
      .insert(stores)
      .values(
        ['A', 'B'].map((key) => ({
          code: 'STORE-ONLY-' + key + '-' + suffix,
          name: 'Isolated Store ' + key,
          regionId: region!.id,
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Test only',
          latitude: 30,
          longitude: 104,
        })),
      )
      .returning({ id: stores.id });
    const first = linkedStores[0]!.id;
    const second = linkedStores[1]!.id;
    const [product] = await db
      .insert(products)
      .values({ name: 'Original store-only item', status: 'DRAFT' })
      .returning({ id: products.id });
    const [sku] = await db
      .insert(skus)
      .values({
        productId: product!.id,
        code: 'STORE-ONLY-SKU-' + suffix,
        name: 'Standard',
        priceMinor: 1000,
        availableForSale: false,
      })
      .returning({ id: skus.id });
    await db.insert(storeInventory).values({ storeId: first, skuId: sku!.id, onHand: 0 });

    try {
      const initial = {
        expectedProductVersion: 0,
        expectedSkuVersion: 0,
        expectedLocalVersion: 0,
        productName: 'Renamed store-only item',
        description: '门店独立商品介绍',
        productStatus: 'ACTIVE' as const,
        skuCode: 'STORE-ONLY-EDITED-' + suffix,
        skuName: 'Edited standard',
        availableForSale: true,
        priceMinor: 1500,
      };
      await expect(
        editor.preview(
          first,
          sku!.id,
          {
            expectedProductVersion: 0,
            expectedSkuVersion: 0,
            expectedLocalVersion: 0,
            availableForSale: true,
          },
          actor!.id,
          'STORE_ONLY',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });

      // Activating one SKU must not silently publish sibling SKUs of the
      // same product, even when no second store has linked them yet.
      const [sibling] = await db
        .insert(skus)
        .values({
          productId: product!.id,
          code: 'STORE-ONLY-SIBLING-' + suffix,
          name: 'Sibling',
          priceMinor: 900,
          availableForSale: true,
        })
        .returning({ id: skus.id });
      try {
        await expect(
          editor.preview(first, sku!.id, initial, actor!.id, 'STORE_ONLY'),
        ).rejects.toMatchObject({ code: 'SHARED_FORBIDDEN' });
      } finally {
        await db.delete(skus).where(eq(skus.id, sibling!.id));
      }
      const preview = await editor.preview(first, sku!.id, initial, actor!.id, 'STORE_ONLY');
      expect(preview.impact).toMatchObject({
        sharedFields: [
          'productName',
          'description',
          'productStatus',
          'skuCode',
          'skuName',
          'availableForSale',
        ],
        affectedStoreCount: 1,
        affectedStoreIds: [first],
      });
      expect(preview.previewToken).toMatch(/^\d{10}\./);

      // Signed acknowledgement remains required even for a single-store item.
      await expect(
        editor.update(first, sku!.id, actor!.id, randomUUID(), initial, 'STORE_ONLY'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const updated = await editor.update(
        first,
        sku!.id,
        actor!.id,
        randomUUID(),
        initial,
        'STORE_ONLY',
        preview.previewToken!,
      );
      expect(updated.item.productName).toBe('Renamed store-only item');
      expect(updated.item.description).toBe('门店独立商品介绍');
      expect(updated.item.productStatus).toBe('ACTIVE');
      expect(updated.item.skuCode).toBe('STORE-ONLY-EDITED-' + suffix);
      expect(updated.item.skuName).toBe('Edited standard');
      expect(updated.item.availableForSale).toBe(true);
      expect(updated.item.available).toBe(0);
      expect(updated.item.priceMinor).toBe(1500);
      expect(updated.item.productVersion).toBe(1);
      expect(updated.item.skuVersion).toBe(1);

      const proposed = {
        expectedProductVersion: 1,
        expectedSkuVersion: 1,
        expectedLocalVersion: 1,
        productStatus: 'INACTIVE' as const,
        skuName: 'Must never overwrite the second store',
        availableForSale: false,
      };
      const stalePreview = await editor.preview(first, sku!.id, proposed, actor!.id, 'STORE_ONLY');
      expect(stalePreview.impact.affectedStoreCount).toBe(1);
      await db.insert(storeInventory).values({ storeId: second, skuId: sku!.id, onHand: 0 });

      // A second store attaches to the SKU AFTER preview. The transactional
      // lock/recheck must reject the old token without modifying either store.
      await expect(
        editor.update(
          first,
          sku!.id,
          actor!.id,
          randomUUID(),
          proposed,
          'STORE_ONLY',
          stalePreview.previewToken!,
        ),
      ).rejects.toMatchObject({ code: 'SHARED_FORBIDDEN' });
      await expect(
        editor.preview(first, sku!.id, proposed, actor!.id, 'STORE_ONLY'),
      ).rejects.toMatchObject({ code: 'SHARED_FORBIDDEN' });

      const firstAfter = await reader.get(first, sku!.id);
      const secondAfter = await reader.get(second, sku!.id);
      expect(firstAfter?.productName).toBe('Renamed store-only item');
      expect(secondAfter?.productName).toBe('Renamed store-only item');
      expect(secondAfter?.description).toBe('门店独立商品介绍');
      expect(firstAfter?.productStatus).toBe('ACTIVE');
      expect(secondAfter?.productStatus).toBe('ACTIVE');
      expect(firstAfter?.availableForSale).toBe(true);
      expect(secondAfter?.availableForSale).toBe(true);
      expect(firstAfter?.skuName).toBe('Edited standard');
      expect(secondAfter?.skuName).toBe('Edited standard');
      expect(firstAfter?.priceMinor).toBe(1500);
      expect(secondAfter?.priceMinor).toBe(1000);
      expect(firstAfter?.onHand).toBe(0);
      expect(secondAfter?.onHand).toBe(0);
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(logs).toHaveLength(1);
      expect(logs[0]?.metadata).toMatchObject({
        affectedStoreCount: 1,
        changedFields: [
          'productName',
          'description',
          'productStatus',
          'skuCode',
          'skuName',
          'availableForSale',
          'priceMinor',
        ],
      });
    } finally {
      // Fixture-only deletes, guarded by the same local DB allowlist.
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db.delete(storeInventory).where(eq(storeInventory.skuId, sku!.id));
      await db.delete(skus).where(eq(skus.id, sku!.id));
      await db.delete(products).where(eq(products.id, product!.id));
      for (const store of linkedStores) {
        await db.delete(stores).where(eq(stores.id, store.id));
      }
      await db.delete(regions).where(eq(regions.id, region!.id));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
