import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
  const commerce = new CommerceService(
    db,
    undefined,
    'disposable-hq-catalog-impact-secret-123456789',
  );

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
    let siblingEditionId: string | null = null;
    let siblingProductId: string | null = null;
    let siblingSkuId: string | null = null;
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
      const editedBookInput = {
        ...input,
        name: 'Updated HQ catalog fixture',
        book: revisedBook,
        expectedProductVersion: 0,
        expectedSkuId: created.skuId,
        expectedBookVersion: 0,
        expectedEditionVersion: 0,
        expectedSkuVersion: 0,
      };
      await expect(
        commerce.updateAdminProduct(created.id, editedBookInput, actor!.id, randomUUID()),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        commerce.updateAdminProduct(created.id, editedBookInput, actor!.id, randomUUID(), 'fake'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const signedPreview = await commerce.previewAdminProductUpdate(
        created.id,
        editedBookInput,
        actor!.id,
      );
      expect(signedPreview.impact.affectedStoreCount).toBe(2);
      // A newly linked store after preview must invalidate the signed scope,
      // even if every submitted version number is otherwise still current.
      const [storeC] = await db
        .insert(stores)
        .values({
          code: 'HQ-CAT-S-C-' + suffix,
          name: 'HQ Catalog C',
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
      storeIds.push(storeC!.id);
      // Link through a *different* edition, product and SKU of the same book.
      // A book-title correction must include this sibling branch in its impact.
      const [siblingEdition] = await db
        .insert(bookEditions)
        .values({ bookId: created.bookId!, publisher: 'Untouched sibling publisher' })
        .returning({ id: bookEditions.id });
      siblingEditionId = siblingEdition!.id;
      const [siblingProduct] = await db
        .insert(products)
        .values({ bookEditionId: siblingEditionId, name: 'Sibling edition', status: 'ACTIVE' })
        .returning({ id: products.id });
      siblingProductId = siblingProduct!.id;
      const [siblingSku] = await db
        .insert(skus)
        .values({
          productId: siblingProductId,
          code: 'HQ-SIBLING-' + suffix,
          name: 'Other SKU',
          priceMinor: 2700,
        })
        .returning({ id: skus.id });
      siblingSkuId = siblingSku!.id;
      await db.insert(storeInventory).values({
        storeId: storeC!.id,
        skuId: siblingSkuId,
        onHand: 1,
      });
      await expect(
        commerce.updateAdminProduct(
          created.id,
          editedBookInput,
          actor!.id,
          randomUUID(),
          signedPreview.previewToken,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const currentPreview = await commerce.previewAdminProductUpdate(
        created.id,
        editedBookInput,
        actor!.id,
      );
      expect(currentPreview.impact.affectedStoreCount).toBe(3);
      const updated = await commerce.updateAdminProduct(
        created.id,
        editedBookInput,
        actor!.id,
        randomUUID(),
        currentPreview.previewToken,
      );
      expect(updated.productVersion).toBe(1);
      expect(updated.skuVersion).toBe(1);
      expect(updated.bookVersion).toBe(1);
      expect(updated.editionVersion).toBe(1);
      expect(updated.book).toEqual(revisedBook);

      const reader = new StoreCatalogReadService(db);
      for (const storeId of storeIds) {
        const sibling = storeId === storeC!.id;
        const item = await reader.get(storeId, sibling ? siblingSkuId : created.skuId);
        expect(item).toMatchObject({
          bookTitle: revisedBook.title,
          author: revisedBook.author,
          publisher: sibling ? 'Untouched sibling publisher' : revisedBook.publisher,
          isbn: sibling ? null : revisedBook.isbn,
          bookVersion: 1,
          editionVersion: sibling ? 0 : 1,
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
        affectedStoreCount: 3,
      });
      const auditedStoreIds = (editAudit?.metadata as { affectedStoreIds?: string[] } | undefined)
        ?.affectedStoreIds;
      expect(auditedStoreIds?.slice().sort()).toEqual([...storeIds].sort());

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
      const nonBookEdit = {
        ...nonBookInput,
        name: 'Updated non-book fixture',
        sku: { ...nonBookInput.sku, priceMinor: 1000 },
        expectedProductVersion: 0,
        expectedSkuId: nonBook.skuId,
        expectedBookVersion: undefined,
        expectedEditionVersion: undefined,
        expectedSkuVersion: 0,
      };
      const nonBookPreview = await commerce.previewAdminProductUpdate(
        nonBook.id,
        nonBookEdit,
        actor!.id,
      );
      expect(nonBookPreview.impact.affectedStoreCount).toBe(0);
      const updatedNonBook = await commerce.updateAdminProduct(
        nonBook.id,
        nonBookEdit,
        actor!.id,
        randomUUID(),
        nonBookPreview.previewToken,
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
      const [extraSku] = await db
        .insert(skus)
        .values({
          productId: created.id,
          code: 'HQ-SECOND-' + suffix,
          name: 'Different SKU on same product',
          priceMinor: 3500,
          status: 'ACTIVE',
          availableForSale: true,
        })
        .returning({ id: skus.id });
      expect(
        (await commerce.getAdminProductsById(created.id)).map((item) => item.skuId).sort(),
      ).toEqual([created.skuId, extraSku!.id].sort());

      const paged = await db
        .insert(products)
        .values(
          Array.from({ length: 101 }, (_, index) => ({
            name: `HQ Page Fixture ${String(index + 1).padStart(3, '0')} ${suffix}`,
            status: 'ACTIVE' as const,
          })),
        )
        .returning({ id: products.id });
      pagedProductIds.push(...paged.map((item) => item.id));
      await db.insert(skus).values(
        paged.map((item, index) => ({
          productId: item.id,
          code: `HQ-PAGE-SKU-${suffix}-${index + 1}`,
          name: 'Standard',
          priceMinor: 100 + index,
        })),
      );
      const firstPage = await commerce.listAdminProducts(undefined, undefined, 0, 30);
      const secondPage = await commerce.listAdminProducts(undefined, undefined, 100, 30);
      expect(firstPage.products).toHaveLength(30);
      expect(firstPage.hasMore).toBe(true);
      expect(secondPage.products.length).toBeGreaterThan(0);
      const search = await commerce.listAdminProducts(
        'HQ Page Fixture 101 ' + suffix,
        undefined,
        0,
        30,
      );
      expect(search.products).toHaveLength(1);
      const target = search.products[0]!;
      const change = {
        name: target.name + ' edited',
        description: target.description,
        coverUrl: target.coverUrl,
        status: target.status,
        book: undefined,
        sku: target.sku,
        expectedProductVersion: target.productVersion,
        expectedSkuId: target.skuId,
        expectedSkuVersion: target.skuVersion,
      };
      const preview = await commerce.previewAdminProductUpdate(target.id, change, actor!.id);
      const edited = await commerce.updateAdminProduct(
        target.id,
        change,
        actor!.id,
        randomUUID(),
        preview.previewToken,
      );
      expect(edited.name).toContain('edited');
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      if (siblingSkuId) {
        await db.delete(storeInventory).where(eq(storeInventory.skuId, siblingSkuId));
        await db.delete(skus).where(eq(skus.id, siblingSkuId));
      }
      if (siblingProductId) await db.delete(products).where(eq(products.id, siblingProductId));
      if (siblingEditionId) {
        await db.delete(bookEditions).where(eq(bookEditions.id, siblingEditionId));
      }
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

  it('rejects duplicate ISBNs deterministically, including concurrent creates', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'hq-isbn-' + suffix + '@example.com',
        passwordHash: 'isolated-test-only',
      })
      .returning({ id: staffAccounts.id });
    const productIds: string[] = [];
    try {
      const isbn = '9780140328721';
      const input = {
        name: 'Duplicate ISBN fixture ' + suffix,
        status: 'DRAFT' as const,
        book: { title: 'Duplicate ISBN book', author: 'Fixture', isbn, publisher: null },
        sku: { name: '标准', priceMinor: 100, status: 'ACTIVE' as const, availableForSale: false },
      };
      const first = await commerce.createAdminProduct(input, actor!.id, randomUUID());
      productIds.push(first.id);
      await expect(
        commerce.createAdminProduct(input, actor!.id, randomUUID()),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: '该图书已存在，请查看或编辑已有图书' });

      const concurrentInput = {
        ...input,
        book: {
          ...input.book,
          isbn: '9780439023481',
        },
      };
      const concurrent = await Promise.allSettled([
        commerce.createAdminProduct(
          { ...concurrentInput, name: input.name + ' A' },
          actor!.id,
          randomUUID(),
        ),
        commerce.createAdminProduct(
          { ...concurrentInput, name: input.name + ' B' },
          actor!.id,
          randomUUID(),
        ),
      ]);
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const successful = concurrent.find((result) => result.status === 'fulfilled');
      if (successful?.status === 'fulfilled') productIds.push(successful.value.id);
      const rejected = concurrent.find((result) => result.status === 'rejected');
      const rejection: unknown = rejected?.status === 'rejected' ? rejected.reason : undefined;
      const rejectedCode =
        rejection && typeof rejection === 'object' && 'code' in rejection
          ? (rejection as { code?: unknown }).code
          : undefined;
      expect(rejectedCode).toBe('CONFLICT');
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      for (const productId of productIds) {
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
          if (edition?.bookId) await db.delete(books).where(eq(books.id, edition.bookId));
        }
      }
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
  it('uses targeted readback and idempotently replays after a committed read failure', async () => {
    const suffix = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({
        loginIdentifier: 'hq-replay-' + suffix + '@example.com',
        passwordHash: 'isolated-test-only',
      })
      .returning({ id: staffAccounts.id });
    const base = {
      name: 'Idempotent HQ fixture ' + suffix,
      status: 'ACTIVE' as const,
      book: null,
      sku: {
        code: 'HQ-IDEMPOTENT-' + suffix,
        name: 'Test SKU',
        priceMinor: 1200,
        status: 'ACTIVE' as const,
        availableForSale: true,
      },
    };
    const key = 'create-' + suffix;
    try {
      const other = await commerce.createAdminProduct(
        {
          ...base,
          name: 'Other HQ fixture ' + suffix,
          sku: { ...base.sku, code: 'OTHER-' + suffix },
        },
        actor!.id,
        randomUUID(),
        'other-' + suffix,
      );
      const listSpy = vi.spyOn(commerce, 'listAdminProducts');
      const readSpy = vi
        .spyOn(commerce, 'getAdminProductById')
        .mockRejectedValueOnce(new Error('simulated post-commit readback failure'));

      // Insert and audit commit before the response fails. The second HTTP
      // request has a new request ID but reuses the original idempotency key.
      await expect(commerce.createAdminProduct(base, actor!.id, randomUUID(), key)).rejects.toThrow(
        'simulated post-commit readback failure',
      );
      readSpy.mockRestore();

      const recovered = await commerce.createAdminProduct(base, actor!.id, randomUUID(), key);
      expect(recovered.name).toBe(base.name);
      expect(recovered.id).not.toBe(other.id);
      expect(recovered.sku.code).toBe(base.sku.code);
      expect(recovered.productVersion).toBe(0);
      expect(listSpy).not.toHaveBeenCalled();

      const [sameOne, sameTwo] = await Promise.all([
        commerce.createAdminProduct(base, actor!.id, randomUUID(), key),
        commerce.createAdminProduct(base, actor!.id, randomUUID(), key),
      ]);
      expect(sameOne.id).toBe(recovered.id);
      expect(sameTwo.id).toBe(recovered.id);

      await expect(
        commerce.createAdminProduct(
          { ...base, name: 'Changed request must be rejected' },
          actor!.id,
          randomUUID(),
          key,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const rows = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, base.name));
      expect(rows.map((item) => item.id)).toEqual([recovered.id]);

      const creationAudits = await db
        .select({ resourceId: auditLogs.resourceId })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      expect(creationAudits).toHaveLength(2);
      expect(creationAudits.map((item) => item.resourceId).sort()).toEqual(
        [other.id, recovered.id].sort(),
      );
    } finally {
      vi.restoreAllMocks();
      const creationAudits = await db
        .select({ resourceId: auditLogs.resourceId })
        .from(auditLogs)
        .where(eq(auditLogs.actorStaffAccountId, actor!.id));
      await db.delete(auditLogs).where(eq(auditLogs.actorStaffAccountId, actor!.id));
      for (const { resourceId } of creationAudits) {
        if (resourceId) {
          await db.delete(skus).where(eq(skus.productId, resourceId));
          await db.delete(products).where(eq(products.id, resourceId));
        }
      }
      await db.delete(staffAccounts).where(eq(staffAccounts.id, actor!.id));
    }
  });
});
