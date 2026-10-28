import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  createDatabase,
  inventoryTransactions,
  meipingCorrectionReviews,
  meipingImportBatches,
  meipingImportResults,
  meipingReviewCorrections,
  meipingReviewDecisions,
  meipingReviewSessions,
  products,
  regions,
  skus,
  staffAccounts,
  storeInventory,
  stores,
} from '@xiaohai/db';
import type { MeipingPreflightReport } from '../src/migration/meiping-preflight.js';
import { MeipingApplyService } from '../src/migration/meiping-apply-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('Meiping guarded apply safety boundaries PostgreSQL integration', () => {
  const ids = {
    region: [] as string[],
    stores: [] as string[],
    staff: [] as string[],
    sessions: [] as string[],
    books: [] as string[],
    editions: [] as string[],
    products: [] as string[],
    skus: [] as string[],
  };

  afterAll(async () => {
    if (!database) return;
    if (ids.stores.length) {
      await database.db.delete(storeInventory).where(inArray(storeInventory.storeId, ids.stores));
      await database.db
        .delete(inventoryTransactions)
        .where(inArray(inventoryTransactions.storeId, ids.stores));
    }
    if (ids.sessions.length) {
      const batches = await database.db
        .select({ id: meipingImportBatches.id })
        .from(meipingImportBatches)
        .where(inArray(meipingImportBatches.reviewSessionId, ids.sessions));
      if (batches.length) {
        await database.db.delete(meipingImportResults).where(
          inArray(
            meipingImportResults.batchId,
            batches.map((item) => item.id),
          ),
        );
        await database.db.delete(meipingImportBatches).where(
          inArray(
            meipingImportBatches.id,
            batches.map((item) => item.id),
          ),
        );
      }
      await database.db
        .delete(meipingCorrectionReviews)
        .where(inArray(meipingCorrectionReviews.sessionId, ids.sessions));
      await database.db
        .delete(meipingReviewCorrections)
        .where(inArray(meipingReviewCorrections.sessionId, ids.sessions));
      await database.db
        .delete(meipingReviewDecisions)
        .where(inArray(meipingReviewDecisions.sessionId, ids.sessions));
      await database.db
        .delete(meipingReviewSessions)
        .where(inArray(meipingReviewSessions.id, ids.sessions));
    }
    if (ids.skus.length) await database.db.delete(skus).where(inArray(skus.id, ids.skus));
    if (ids.products.length)
      await database.db.delete(products).where(inArray(products.id, ids.products));
    if (ids.editions.length)
      await database.db.delete(bookEditions).where(inArray(bookEditions.id, ids.editions));
    if (ids.books.length) await database.db.delete(books).where(inArray(books.id, ids.books));
    if (ids.stores.length) await database.db.delete(stores).where(inArray(stores.id, ids.stores));
    if (ids.region.length) await database.db.delete(regions).where(inArray(regions.id, ids.region));
    if (ids.staff.length) {
      await database.db.delete(auditLogs).where(inArray(auditLogs.actorStaffAccountId, ids.staff));
      await database.db.delete(staffAccounts).where(inArray(staffAccounts.id, ids.staff));
    }
    await database.pool.end();
  });

  async function fixture() {
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: `safe-actor-${suffix}`, passwordHash: 'test-only' })
      .returning({ id: staffAccounts.id });
    const [approver] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: `safe-approver-${suffix}`, passwordHash: 'test-only' })
      .returning({ id: staffAccounts.id });
    ids.staff.push(actor!.id, approver!.id);
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: `SAFE-R-${suffix}`,
        name: 'Disposable security region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    ids.region.push(region!.id);
    const storesCreated = await database!.db
      .insert(stores)
      .values([
        {
          regionId: region!.id,
          code: `SAFE-A-${suffix}`,
          name: 'Disposable security store A',
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Disposable test only',
          latitude: 30.5,
          longitude: 104,
        },
        {
          regionId: region!.id,
          code: `SAFE-B-${suffix}`,
          name: 'Disposable security store B',
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Disposable test only',
          latitude: 30.51,
          longitude: 104.01,
        },
      ])
      .returning({ id: stores.id });
    ids.stores.push(...storesCreated.map((item) => item.id));
    return {
      actor: actor!.id,
      approver: approver!.id,
      storeA: storesCreated[0]!.id,
      storeB: storesCreated[1]!.id,
    };
  }

  function report(
    storeId: string,
    checksum: string,
    isbn: string,
    code?: string,
  ): MeipingPreflightReport {
    return {
      sourceType: 'MEIPING_XLS',
      sourceChecksum: checksum,
      sourceStoreId: storeId,
      sourceStoreCode: 'SAFE',
      inventoryApproval: 'PENDING_ADMIN_REVIEW',
      totalRows: 1,
      matchedRows: 0,
      createCandidateRows: 1,
      exceptionRows: 0,
      metadataWarningRows: 0,
      blockingRows: 0,
      saleBlockedRows: 0,
      assumedInventoryRows: 1,
      plannedInventoryTotal: 1,
      exceptionReportCsv: '',
      rows: [
        {
          sourceRowNumber: 2,
          rawColumns: { title: '安全测试' },
          sourceCategory: '图书',
          sourceCategoryType: 'BOOK',
          sourceIdentifiers: {
            bookCode: code ?? null,
            internalCode: null,
            barcode: null,
            isbn,
          },
          normalized: {
            title: '安全测试书',
            author: '测试作者',
            publisher: '测试出版社',
            priceMinor: 3980,
          },
          plannedInventory: 1,
          inventoryBasis: 'ASSUMED_PENDING_STOCKTAKE',
          matchStatus: 'UNMATCHED_REVIEW',
          disposition: 'CREATE_CANDIDATE',
          issues: [],
          metadataWarnings: [],
          blockingIssues: [],
          saleBlocked: [],
        },
      ],
    };
  }

  async function createSession(
    storeId: string,
    actor: string,
    checksum: string,
    isbn: string,
    code?: string,
  ) {
    const data = report(storeId, checksum, isbn, code);
    const [session] = await database!.db
      .insert(meipingReviewSessions)
      .values({
        storeId,
        sourceChecksum: checksum,
        status: 'DRAFT',
        report: data,
        createdByStaffAccountId: actor,
      })
      .returning({ id: meipingReviewSessions.id });
    ids.sessions.push(session!.id);
    await database!.db.insert(meipingReviewDecisions).values({
      sessionId: session!.id,
      sourceRowNumber: 2,
      action: 'CREATE_DRAFT',
      countedQuantity: 1,
      updatedByStaffAccountId: actor,
    });
    return session!.id;
  }

  it('rejects cross-store batch access before any apply operation', async () => {
    const fixtureData = await fixture();
    const sessionId = await createSession(
      fixtureData.storeA,
      fixtureData.actor,
      'c'.repeat(64),
      '9780306406157',
    );
    const apply = new MeipingApplyService(database!.db, true);
    const preview = await apply.preview(sessionId, fixtureData.storeA, {
      actorStaffAccountId: fixtureData.actor,
      requestId: randomUUID(),
    });
    await expect(
      apply.approve(preview.batchId, fixtureData.storeB, {
        actorStaffAccountId: fixtureData.approver,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'STORE_SCOPE_FORBIDDEN' });
    await expect(
      apply.execute(preview.batchId, fixtureData.storeB, {
        actorStaffAccountId: fixtureData.approver,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'STORE_SCOPE_FORBIDDEN' });
    await expect(apply.getBatch(preview.batchId, fixtureData.storeB)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
    });
  });

  it('reuses legacy hyphenated lowercase-x ISBN-10 without duplicating the catalog', async () => {
    const data = await fixture();
    // A legacy row can be displayed as-is after #165, but import must compare
    // its canonical ISBN before creating a new book, product, SKU or inventory.
    const [book] = await database!.db
      .insert(books)
      .values({ title: '既有 ISBN-10 图书', author: '既有作者' })
      .returning({ id: books.id });
    ids.books.push(book!.id);
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: '0-8044-2957-x', publisher: '测试出版社' })
      .returning({ id: bookEditions.id });
    ids.editions.push(edition!.id);
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: '既有 ISBN-10 商品', status: 'DRAFT' })
      .returning({ id: products.id });
    ids.products.push(product!.id);
    const code = `LEGACY-X-${randomUUID().slice(0, 8)}`;
    const [sku] = await database!.db
      .insert(skus)
      .values({
        productId: product!.id,
        code,
        name: '标准',
        priceMinor: 3980,
        availableForSale: false,
      })
      .returning({ id: skus.id });
    ids.skus.push(sku!.id);
    const sessionId = await createSession(
      data.storeA,
      data.actor,
      '9'.repeat(64),
      '080442957X',
      code,
    );
    const apply = new MeipingApplyService(database!.db, false);
    const preview = await apply.preview(sessionId, data.storeA, {
      actorStaffAccountId: data.actor,
      requestId: randomUUID(),
    });

    expect(preview.plan.conflicts).toEqual([]);
    expect(preview.plan.counts).toMatchObject({
      newBooks: 0,
      reusedBooks: 1,
      newProducts: 0,
      reusedProducts: 1,
      newSkus: 0,
      reusedSkus: 1,
    });
    expect(preview.plan.rows[0]?.resolution).toMatchObject({
      book: 'REUSE',
      product: 'REUSE',
      sku: 'REUSE',
      bookId: book!.id,
      bookEditionId: edition!.id,
      productId: product!.id,
      skuId: sku!.id,
    });
    // Preview is metadata-only. Explicitly enable only this synthetic
    // disposable-DB test execution to cover the separate applyRow lookup path.
    expect(preview.canExecute).toBe(false);
    await apply.approve(preview.batchId, data.storeA, {
      actorStaffAccountId: data.approver,
      requestId: randomUUID(),
    });
    const executed = await new MeipingApplyService(database!.db, true).execute(
      preview.batchId,
      data.storeA,
      { actorStaffAccountId: data.approver, requestId: randomUUID() },
    );
    expect(executed.status).toBe('SUCCEEDED');
    const imported = await database!.db
      .select()
      .from(meipingImportResults)
      .where(eq(meipingImportResults.batchId, preview.batchId));
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      outcome: 'REUSED',
      bookId: book!.id,
      bookEditionId: edition!.id,
      productId: product!.id,
      skuId: sku!.id,
    });
    const editionsForBook = await database!.db
      .select({ id: bookEditions.id })
      .from(bookEditions)
      .where(eq(bookEditions.bookId, book!.id));
    expect(editionsForBook).toHaveLength(1);
  });

  it('blocks shared overwrites, ambiguous SKUs, and historical inventory', async () => {
    const fixtureData = await fixture();
    const sharedIsbn = makeIsbn13(randomUUID().replaceAll('-', '').slice(0, 9));
    const [book] = await database!.db
      .insert(books)
      .values({ title: '既有主数据', author: '既有作者' })
      .returning({ id: books.id });
    ids.books.push(book!.id);
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: sharedIsbn, publisher: '既有出版社' })
      .returning({ id: bookEditions.id });
    ids.editions.push(edition!.id);
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: '既有商品', status: 'DRAFT' })
      .returning({ id: products.id });
    ids.products.push(product!.id);
    const skuValues = await database!.db
      .insert(skus)
      .values([
        {
          productId: product!.id,
          code: 'SAFE-SKU-A',
          name: '标准',
          priceMinor: 1000,
          availableForSale: false,
        },
        {
          productId: product!.id,
          code: 'SAFE-SKU-B',
          name: '特别版',
          priceMinor: 1200,
          availableForSale: false,
        },
      ])
      .returning({ id: skus.id });
    ids.skus.push(...skuValues.map((item) => item.id));

    const ambiguousSession = await createSession(
      fixtureData.storeA,
      fixtureData.actor,
      'd'.repeat(64),
      sharedIsbn,
    );
    const apply = new MeipingApplyService(database!.db, true);
    const ambiguousPreview = await apply.preview(ambiguousSession, fixtureData.storeA, {
      actorStaffAccountId: fixtureData.actor,
      requestId: randomUUID(),
    });
    expect(ambiguousPreview.plan.conflicts).toContainEqual({
      sourceRowNumber: 2,
      code: 'AMBIGUOUS_SKU_MATCH',
    });
    await expect(
      apply.approve(ambiguousPreview.batchId, fixtureData.storeA, {
        actorStaffAccountId: fixtureData.approver,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const historicalSession = await createSession(
      fixtureData.storeB,
      fixtureData.actor,
      'e'.repeat(64),
      sharedIsbn,
      'SAFE-SKU-A',
    );
    await database!.db.insert(storeInventory).values({
      storeId: fixtureData.storeB,
      skuId: skuValues[0]!.id,
      onHand: 0,
      version: 0,
    });
    await database!.db.insert(inventoryTransactions).values({
      storeId: fixtureData.storeB,
      skuId: skuValues[0]!.id,
      transactionType: 'ADJUSTMENT_IN',
      quantityDelta: 1,
      balanceAfter: 1,
      referenceType: 'TEST_FIXTURE',
      referenceId: randomUUID(),
      idempotencyKey: `safe-history-${randomUUID()}`,
      createdByStaffAccountId: fixtureData.actor,
    });
    const historicalPreview = await apply.preview(historicalSession, fixtureData.storeB, {
      actorStaffAccountId: fixtureData.actor,
      requestId: randomUUID(),
    });
    await expect(
      apply.approve(historicalPreview.batchId, fixtureData.storeB, {
        actorStaffAccountId: fixtureData.approver,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const invalidSession = await createSession(
      fixtureData.storeA,
      fixtureData.actor,
      'f'.repeat(64),
      '9780306406158',
    );
    const invalidPreview = await apply.preview(invalidSession, fixtureData.storeA, {
      actorStaffAccountId: fixtureData.actor,
      requestId: randomUUID(),
    });
    expect(invalidPreview.plan.conflicts).toContainEqual({
      sourceRowNumber: 2,
      code: 'INVALID_ISBN',
    });

    const sharedSession = await createSession(
      fixtureData.storeA,
      fixtureData.actor,
      'a'.repeat(64),
      sharedIsbn,
      'SAFE-SKU-A',
    );
    await database!.db.insert(meipingReviewCorrections).values({
      sessionId: sharedSession,
      sourceRowNumber: 2,
      proposedFields: { title: '不应覆盖的标题' },
      reason: '安全测试',
      version: 1,
      updatedByStaffAccountId: fixtureData.actor,
    });
    await database!.db.insert(meipingCorrectionReviews).values({
      sessionId: sharedSession,
      sourceRowNumber: 2,
      correctionVersion: 1,
      verdict: 'ACCEPTED',
      reason: '安全测试复核',
      reviewedByStaffAccountId: fixtureData.approver,
    });
    const sharedPreview = await apply.preview(sharedSession, fixtureData.storeA, {
      actorStaffAccountId: fixtureData.actor,
      requestId: randomUUID(),
    });
    expect(sharedPreview.plan.conflicts).toContainEqual({
      sourceRowNumber: 2,
      code: 'SHARED_CATALOG_CHANGE_REQUIRES_REVIEW',
    });
    await expect(
      apply.approve(sharedPreview.batchId, fixtureData.storeA, {
        actorStaffAccountId: fixtureData.approver,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [unchanged] = await database!.db.select().from(books).where(eq(books.id, book!.id));
    expect(unchanged?.title).toBe('既有主数据');
  });

  it('blocks accepted shared book edits when the existing edition has no product', async () => {
    const fixtureData = await fixture();
    const sharedIsbn = makeIsbn13(randomUUID().replaceAll('-', '').slice(0, 9));
    const [book] = await database!.db
      .insert(books)
      .values({ title: '已有但未上架的书', author: '原作者' })
      .returning({ id: books.id });
    ids.books.push(book!.id);
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: sharedIsbn, publisher: '原出版社' })
      .returning({ id: bookEditions.id });
    ids.editions.push(edition!.id);
    const sessionId = await createSession(
      fixtureData.storeA,
      fixtureData.actor,
      '7'.repeat(64),
      sharedIsbn,
    );
    await database!.db.insert(meipingReviewCorrections).values({
      sessionId,
      sourceRowNumber: 2,
      proposedFields: { title: '不应静默忽略的修改', publisher: '待审核出版社' },
      reason: '验证无商品关联时共享元数据仍需阻断',
      version: 1,
      updatedByStaffAccountId: fixtureData.actor,
    });
    await database!.db.insert(meipingCorrectionReviews).values({
      sessionId,
      sourceRowNumber: 2,
      correctionVersion: 1,
      verdict: 'ACCEPTED',
      reason: '仅接受纠错提议，不授权覆盖共享数据',
      reviewedByStaffAccountId: fixtureData.approver,
    });

    const apply = new MeipingApplyService(database!.db, true);
    const preview = await apply.preview(sessionId, fixtureData.storeA, {
      actorStaffAccountId: fixtureData.actor,
      requestId: randomUUID(),
    });
    expect(preview.plan.conflicts).toContainEqual({
      sourceRowNumber: 2,
      code: 'SHARED_CATALOG_CHANGE_REQUIRES_REVIEW',
    });
    await expect(
      apply.approve(preview.batchId, fixtureData.storeA, {
        actorStaffAccountId: fixtureData.approver,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const [unchangedBook] = await database!.db.select().from(books).where(eq(books.id, book!.id));
    const [unchangedEdition] = await database!.db
      .select()
      .from(bookEditions)
      .where(eq(bookEditions.id, edition!.id));
    const uncreatedProducts = await database!.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.bookEditionId, edition!.id));
    expect(unchangedBook).toMatchObject({ title: '已有但未上架的书', author: '原作者' });
    expect(unchangedEdition?.publisher).toBe('原出版社');
    expect(uncreatedProducts).toHaveLength(0);
  });
});

function makeIsbn13(seed: string): string {
  const base = `979${seed.replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`;
  const sum = base
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}
