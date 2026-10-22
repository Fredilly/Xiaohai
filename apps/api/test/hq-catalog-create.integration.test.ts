import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  createDatabase,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';

const databaseUrl = process.env.DATABASE_URL;
const disposableDatabase =
  databaseUrl && new URL(databaseUrl).pathname === '/xiaohai_test'
    ? createDatabase(process.env)
    : null;
const suite = disposableDatabase ? describe : describe.skip;

suite('HQ catalog create and optimistic update on disposable PostgreSQL', () => {
  const db = disposableDatabase!.db;
  const commerce = new CommerceService(db);

  afterAll(async () => {
    await disposableDatabase!.pool.end();
  });

  it('returns the committed creation, audits the actor, and rejects a stale HQ update', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'hq-catalog-' + suffix + '@example.com',
        passwordHash: 'isolated-test-only',
      })
      .returning({ id: staffAccounts.id });
    let createdId: string | null = null;
    let regionId: string | null = null;
    const storeIds: string[] = [];
    try {
      const input = {
        name: 'HQ Catalog Integration ' + suffix,
        description: 'Isolated database fixture',
        status: 'ACTIVE' as const,
        book: {
          title: 'HQ Book ' + suffix,
          author: 'Fixture author',
          publisher: 'Fixture publisher',
          isbn: null,
        },
        sku: {
          code: 'HQ-SKU-' + suffix,
          name: 'Standard Edition',
          priceMinor: 2500,
          status: 'ACTIVE' as const,
          availableForSale: true,
        },
      };
      const createRequestId = randomUUID();
      const created = await commerce.createAdminProduct(input, actor!.id, createRequestId);
      createdId = created.id;
      expect(created.id).toBeTruthy();
      expect(created.productVersion).toBe(0);
      expect(created.skuVersion).toBe(0);
      expect(created.bookVersion).toBe(0);
      expect(created.editionVersion).toBe(0);
      expect(created.book?.title).toBe(input.book.title);
      expect(created.sku.priceMinor).toBe(2500);

      const persisted = (await commerce.listAdminProducts()).products.find(
        (product) => product.id === created.id,
      );
      expect(persisted).toEqual(created);

      const [creationAudit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.requestId, createRequestId));
      expect(creationAudit).toMatchObject({
        actorStaffAccountId: actor!.id,
        actionKey: 'catalog.hq_create',
        resourceType: 'PRODUCT',
        resourceId: created.id,
      });
      expect(creationAudit?.metadata).toMatchObject({
        changedFields: ['product', 'book', 'edition', 'sku'],
        skuCount: 1,
      });

      // One shared ISBN/book can appear in many stores. HQ editing it must
      // be visible through each store's canonical read model.
      const [region] = await db
        .insert(regions)
        .values({
          code: 'HQ-CAT-R-' + suffix,
          name: 'HQ Catalog Fixture',
          countryCode: 'CN',
          countryName: 'China',
        })
        .returning({ id: regions.id });
      regionId = region!.id;
      const linkedStores = await db
        .insert(stores)
        .values(
          ['A', 'B'].map((key) => ({
            code: 'HQ-CAT-S-' + key + '-' + suffix,
            name: 'HQ Catalog ' + key,
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
      storeIds.push(...linkedStores.map((store) => store.id));
      await db.insert(storeInventory).values(
        linkedStores.map((store) => ({
          storeId: store.id,
          skuId: created.skuId,
          onHand: 2,
        })),
      );

      const revisedIsbn = '978' + suffix.replace(/\\D/g, '').slice(0, 10).padEnd(10, '0');
      const revisedBook = {
        ...input.book,
        title: 'HQ revised title ' + suffix,
        author: 'Updated author',
        publisher: 'Updated publisher',
        isbn: revisedIsbn,
      };
      const updated = await commerce.updateAdminProduct(
        created.id,
        {
          ...input,
          name: 'Updated HQ catalog fixture',
          book: revisedBook,
          expectedProductVersion: 0,
          expectedSkuId: created.skuId,
          expectedBookVersion: 0,
          expectedEditionVersion: 0,
          expectedSkuVersion: 0,
        },
        actor!.id,
        randomUUID(),
      );
      expect(updated.productVersion).toBe(1);
      expect(updated.skuVersion).toBe(1);
      expect(updated.bookVersion).toBe(1);
      expect(updated.editionVersion).toBe(1);
      expect(updated.book).toEqual(revisedBook);

      const reader = new StoreCatalogReadService(db);
      for (const storeId of storeIds) {
        const item = await reader.get(storeId, created.skuId);
        expect(item).toMatchObject({
          bookTitle: revisedBook.title,
          author: revisedBook.author,
          publisher: revisedBook.publisher,
          isbn: revisedBook.isbn,
          bookVersion: 1,
          editionVersion: 1,
        });
      }

      await expect(
        commerce.updateAdminProduct(
          created.id,
          {
            ...input,
            name: 'Stale overwrite must not succeed',
            expectedProductVersion: 0,
            expectedSkuId: created.skuId,
            expectedBookVersion: 0,
            expectedEditionVersion: 0,
            expectedSkuVersion: 0,
          },
          actor!.id,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const [finalProduct] = await db
        .select({ name: products.name, version: products.version })
        .from(products)
        .where(eq(products.id, created.id));
      expect(finalProduct).toMatchObject({
        name: 'Updated HQ catalog fixture',
        version: 1,
      });
      const [bookVersion] = await db
        .select({ version: books.version })
        .from(books)
        .where(eq(books.title, revisedBook.title));
      expect(bookVersion?.version).toBe(1);

      const audit = await db
        .select({ actionKey: auditLogs.actionKey })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit.map((row) => row.actionKey).sort()).toEqual([
        'catalog.hq_create',
        'catalog.hq_direct_edit',
      ]);
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      if (createdId) {
        await db.delete(storeInventory).where(eq(storeInventory.skuId, (await db
          .select({ id: skus.id }).from(skus).where(eq(skus.productId, createdId)))[0]!.id));
        for (const id of storeIds) await db.delete(stores).where(eq(stores.id, id));
        if (regionId) await db.delete(regions).where(eq(regions.id, regionId));
        const [product] = await db
          .select({ bookEditionId: products.bookEditionId })
          .from(products)
          .where(eq(products.id, createdId));
        await db.delete(skus).where(eq(skus.productId, createdId));
        await db.delete(products).where(eq(products.id, createdId));
        if (product?.bookEditionId) {
          const [edition] = await db
            .select({ bookId: bookEditions.bookId })
            .from(bookEditions)
            .where(eq(bookEditions.id, product.bookEditionId));
          await db.delete(bookEditions).where(eq(bookEditions.id, product.bookEditionId));
          if (edition?.bookId) {
            await db.delete(books).where(eq(books.id, edition.bookId));
          }
        }
      }
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
