import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  createDatabase,
  products,
  regions,
  skus,
  staffAccounts,
  storeCatalogMetadata,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { CatalogEditError, CatalogEditService } from '../src/commerce/catalog-edit-service.js';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';

const databaseUrl = process.env.DATABASE_URL;
const disposableDatabase =
  databaseUrl && /^xiaohai_(test|pr157_uat)$/.test(new URL(databaseUrl).pathname.slice(1))
    ? createDatabase(process.env)
    : null;
const suite = disposableDatabase ? describe : describe.skip;

suite('direct catalog editing on disposable PostgreSQL', () => {
  const db = disposableDatabase!.db;
  const editor = new CatalogEditService(db);
  const reader = new StoreCatalogReadService(db);

  afterAll(async () => {
    await disposableDatabase!.pool.end();
  });

  it('updates shared fields in two stores, keeps local fields scoped, and records audit without stock writes', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [region] = await db
      .insert(regions)
      .values({ code: 'DCE-R-' + suffix, name: 'Direct Catalog Test Region', countryCode: 'CN', countryName: 'China' })
      .returning();
    const [storeA, storeB] = await db
      .insert(stores)
      .values(
        ['A', 'B'].map((letter) => ({
          code: 'DCE-S-' + letter + '-' + suffix,
          name: 'Direct Catalog Store ' + letter,
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
      .returning();
    const [book] = await db
      .insert(books)
      .values({ title: 'Original Direct Edit Book', author: 'Original Author' })
      .returning();
    const [edition] = await db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: null, publisher: 'Test Publisher' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: 'Original Direct Edit Product', status: 'ACTIVE' })
      .returning();
    const [sku] = await db
      .insert(skus)
      .values({ productId: product!.id, code: 'DCE-SKU-' + suffix, name: 'Edition', priceMinor: 1000 })
      .returning();
    await db.insert(storeInventory).values([
      { storeId: storeA!.id, skuId: sku!.id, onHand: 6 },
      { storeId: storeB!.id, skuId: sku!.id, onHand: 4 },
    ]);
    const [actor] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: 'dce-' + randomUUID() + '@example.com', passwordHash: 'test-only' })
      .returning();

    try {
      const input = {
        expectedProductVersion: 0,
        expectedBookVersion: 0,
        expectedEditionVersion: 0,
        expectedSkuVersion: 0,
        expectedLocalVersion: 0,
        bookTitle: 'Edited Direct Edit Book',
        priceMinor: 1200,
        shelfLocation: 'Shelf A-01',
      };

      const preview = await editor.preview(storeA!.id, sku!.id, input);
      expect(preview.sharedFields).toEqual(['bookTitle', 'priceMinor']);
      expect(preview.affectedStoreCount).toBe(2);

      const updated = await editor.update(storeA!.id, sku!.id, actor!.id, randomUUID(), input);
      expect(updated.item.bookTitle).toBe('Edited Direct Edit Book');
      expect(updated.item.priceMinor).toBe(1200);
      expect(updated.item.shelfLocation).toBe('Shelf A-01');
      expect(updated.item.bookVersion).toBe(1);
      expect(updated.item.skuVersion).toBe(1);
      expect(updated.item.localVersion).toBe(1);
      expect(updated.impact.affectedStoreCount).toBe(2);

      const otherStore = await reader.get(storeB!.id, sku!.id);
      expect(otherStore?.bookTitle).toBe('Edited Direct Edit Book');
      expect(otherStore?.priceMinor).toBe(1200);
      expect(otherStore?.shelfLocation).toBeNull();

      await expect(editor.update(storeA!.id, sku!.id, actor!.id, randomUUID(), input)).rejects.toMatchObject({
        code: 'CONFLICT',
      } satisfies Partial<CatalogEditError>);

      const balances = await db
        .select({ storeId: storeInventory.storeId, onHand: storeInventory.onHand })
        .from(storeInventory)
        .where(eq(storeInventory.skuId, sku!.id));
      expect(balances).toHaveLength(2);
      expect(balances.find((row) => row.storeId === storeA!.id)?.onHand).toBe(6);
      expect(balances.find((row) => row.storeId === storeB!.id)?.onHand).toBe(4);

      const audit = await db.select().from(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actionKey).toBe('catalog.direct_edit');
      expect(audit[0]?.metadata).toMatchObject({
        affectedStoreCount: 2,
        changedFields: ['bookTitle', 'priceMinor', 'shelfLocation'],
      });
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db
        .delete(storeCatalogMetadata)
        .where(and(eq(storeCatalogMetadata.storeId, storeA!.id), eq(storeCatalogMetadata.skuId, sku!.id)));
      await db.delete(storeInventory).where(eq(storeInventory.skuId, sku!.id));
      await db.delete(skus).where(eq(skus.id, sku!.id));
      await db.delete(products).where(eq(products.id, product!.id));
      await db.delete(bookEditions).where(eq(bookEditions.id, edition!.id));
      await db.delete(books).where(eq(books.id, book!.id));
      await db.delete(stores).where(eq(stores.id, storeA!.id));
      await db.delete(stores).where(eq(stores.id, storeB!.id));
      await db.delete(regions).where(eq(regions.id, region!.id));
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
