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
  databaseUrl && /^\/xiaohai_(test|pr160_uat|pr161_uat)$/.test(new URL(databaseUrl).pathname)
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
    let nonBookId: string | null = null;
    let regionId: string | null = null;
    const storeIds: string[] = [];
    const pagedProductIds: string[] = [];
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

      const revisedIsbn = '978' + suffix.replace(/\D/g, '').slice(0, 10).padEnd(10, '0');
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
      await expect(
        commerce.updateAdminProduct(
          created.id,
          {
            ...input,
            name: 'Updated HQ catalog fixture',
            book: { ...revisedBook, title: 'Stale title must be refused' },
            expectedProductVersion: 1,
            expectedSkuId: created.skuId,
            expectedBookVersion: 0,
            expectedEditionVersion: 0,
            expectedSkuVersion: 1,
          },
          actor!.id,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const audit = await db
        .select({ actionKey: auditLogs.actionKey, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(audit.map((row) => row.actionKey).sort()).toEqual([
        'catalog.hq_create',
        'catalog.hq_direct_edit',
      ]);
      const editAudit = audit.find((row) => row.actionKey === 'catalog.hq_direct_edit');
      expect(editAudit?.metadata).toMatchObject({
        productId: created.id,
        skuId: created.skuId,
        bookId: created.bookId,
        editionId: created.editionId,
      });

      const nonBookInput = {
        name: 'HQ Non-book Integration ' + suffix,
        description: 'Isolated non-book fixture',
        status: 'ACTIVE' as const,
        book: null,
        sku: {
          code: 'HQ-NONBOOK-SKU-' + suffix,
          name: 'Non-book Standard',
          priceMinor: 900,
          status: 'ACTIVE' as const,
          availableForSale: true,
        },
      };
      const nonBook = await commerce.createAdminProduct(nonBookInput, actor!.id, randomUUID());
      nonBookId = nonBook.id;
      expect(nonBook.book).toBeNull();
      const updatedNonBook = await commerce.updateAdminProduct(
        nonBook.id,
        {
          ...nonBookInput,
          name: 'Updated non-book fixture',
          sku: { ...nonBookInput.sku, priceMinor: 1000 },
          expectedProductVersion: 0,
          expectedSkuId: nonBook.skuId,
          expectedBookVersion: undefined,
          expectedEditionVersion: undefined,
          expectedSkuVersion: 0,
        },
        actor!.id,
        randomUUID(),
      );
      expect(updatedNonBook.name).toBe('Updated non-book fixture');
      expect(updatedNonBook.sku.priceMinor).toBe(1000);
      expect(updatedNonBook.book).toBeNull();
      const auditCountBeforeInvalidBook = (
        await db
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(eq(auditLogs.actorStaffAccountId, actor!.id))
      ).length;
      await expect(
        commerce.updateAdminProduct(
          nonBook.id,
          {
            ...nonBookInput,
            book: {
              title: 'Must not attach',
              author: 'Invalid fixture',
              isbn: null,
              publisher: null,
            },
            expectedProductVersion: 1,
            expectedSkuId: nonBook.skuId,
            expectedSkuVersion: 1,
          },
          actor!.id,
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        message: 'Cannot attach book fields to a product without an existing book edition',
      });
      const [afterInvalidBook] = await db
        .select({ name: products.name, version: products.version })
        .from(products)
        .where(eq(products.id, nonBook.id));
      expect(afterInvalidBook).toMatchObject({ name: 'Updated non-book fixture', version: 1 });
      const auditCountAfterInvalidBook = (
        await db
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(eq(auditLogs.actorStaffAccountId, actor!.id))
      ).length;
      expect(auditCountAfterInvalidBook).toBe(auditCountBeforeInvalidBook);
      await expect(
        commerce.updateAdminProduct(
          nonBook.id,
          {
            ...nonBookInput,
            name: 'Stale non-book overwrite',
            expectedProductVersion: 0,
            expectedSkuId: nonBook.skuId,
            expectedBookVersion: undefined,
            expectedEditionVersion: undefined,
            expectedSkuVersion: 0,
          },
          actor!.id,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const [persistedNonBook] = await db
        .select({ name: products.name, version: products.version })
        .from(products)
        .where(eq(products.id, nonBook.id));
      expect(persistedNonBook).toMatchObject({
        name: 'Updated non-book fixture',
        version: 1,
      });

      const allAudits = await db
        .select({ actionKey: auditLogs.actionKey, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(allAudits.map((row) => row.actionKey).sort()).toEqual([
        'catalog.hq_create',
        'catalog.hq_create',
        'catalog.hq_direct_edit',
        'catalog.hq_direct_edit',
      ]);
      const nonBookEditAudit = allAudits.find(
        (row) =>
          row.actionKey === 'catalog.hq_direct_edit' &&
          (row.metadata as { productId?: string }).productId === nonBook.id,
      );
      expect(nonBookEditAudit?.metadata).toMatchObject({
        productId: nonBook.id,
        skuId: nonBook.skuId,
        bookId: null,
        editionId: null,
      });

      const pageProducts = await db
        .insert(products)
        .values(
          Array.from({ length: 31 }, (_, index) => ({
            name: `HQ Page Fixture ${String(index + 1).padStart(2, '0')} ${suffix}`,
            status: 'ACTIVE' as const,
          })),
        )
        .returning({ id: products.id });
      pagedProductIds.push(...pageProducts.map((item) => item.id));
      await db.insert(skus).values(
        pageProducts.map((product, index) => ({
          productId: product.id,
          code: `HQ-PAGE-SKU-${suffix}-${String(index + 1).padStart(2, '0')}`,
          name: 'Standard',
          priceMinor: 100 + index,
        })),
      );
      const firstPage = await commerce.listAdminProducts(undefined, undefined, 0, 30);
      const secondPage = await commerce.listAdminProducts(undefined, undefined, 30, 30);
      expect(firstPage.products).toHaveLength(30);
      expect(firstPage.hasMore).toBe(true);
      expect(secondPage.products.some((item) => item.name.includes('HQ Page Fixture 31'))).toBe(
        true,
      );
      const searched = await commerce.listAdminProducts(
        'HQ Page Fixture 31 ' + suffix,
        undefined,
        0,
        30,
      );
      expect(searched.products).toHaveLength(1);
      const target = searched.products[0]!;
      const editedTarget = await commerce.updateAdminProduct(
        target.id,
        {
          name: target.name + ' edited',
          description: target.description,
          coverUrl: target.coverUrl,
          status: target.status,
          book: undefined,
          sku: target.sku,
          expectedProductVersion: target.productVersion,
          expectedSkuId: target.skuId,
          expectedSkuVersion: target.skuVersion,
        },
        actor!.id,
        randomUUID(),
      );
      expect(editedTarget.name).toContain('edited');
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      for (const productId of [createdId, nonBookId].filter((id): id is string => Boolean(id))) {
        const ownedSkus = await db
          .select({ id: skus.id })
          .from(skus)
          .where(eq(skus.productId, productId));
        for (const sku of ownedSkus) {
          await db.delete(storeInventory).where(eq(storeInventory.skuId, sku.id));
        }
        for (const id of storeIds) await db.delete(stores).where(eq(stores.id, id));
        if (regionId) await db.delete(regions).where(eq(regions.id, regionId));
        const [product] = await db
          .select({ bookEditionId: products.bookEditionId })
          .from(products)
          .where(eq(products.id, productId));
        await db.delete(skus).where(eq(skus.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
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
      for (const productId of pagedProductIds) {
        await db.delete(skus).where(eq(skus.productId, productId));
        await db.delete(products).where(eq(products.id, productId));
      }
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
