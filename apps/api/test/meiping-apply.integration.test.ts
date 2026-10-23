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
  skus,
  staffAccounts,
  storeInventory,
  stores,
  regions,
} from '@xiaohai/db';
import type { MeipingPreflightReport } from '../src/migration/meiping-preflight.js';
import { MeipingApplyError, MeipingApplyService } from '../src/migration/meiping-apply-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('Meiping guarded apply PostgreSQL integration', () => {
  const createdIds = {
    region: '',
    store: '',
    actor: '',
    approver: '',
    session: '',
    batch: '',
    existingBook: '',
    existingEdition: '',
    existingProduct: '',
    existingSku: '',
  };

  afterAll(async () => {
    if (!database) return;
    const imported = createdIds.batch
      ? await database.db
          .select({
            skuId: meipingImportResults.skuId,
            productId: meipingImportResults.productId,
            editionId: meipingImportResults.bookEditionId,
            bookId: meipingImportResults.bookId,
          })
          .from(meipingImportResults)
          .where(eq(meipingImportResults.batchId, createdIds.batch))
      : [];
    if (createdIds.store) {
      await database.db.delete(storeInventory).where(eq(storeInventory.storeId, createdIds.store));
      await database.db
        .delete(inventoryTransactions)
        .where(eq(inventoryTransactions.storeId, createdIds.store));
    }
    if (createdIds.batch) {
      await database.db
        .delete(inventoryTransactions)
        .where(eq(inventoryTransactions.referenceId, createdIds.batch));
      await database.db
        .delete(meipingImportResults)
        .where(eq(meipingImportResults.batchId, createdIds.batch));
      await database.db
        .delete(meipingImportBatches)
        .where(eq(meipingImportBatches.id, createdIds.batch));
    }
    const importedSkuIds = imported
      .map((item) => item.skuId)
      .filter((id): id is string => Boolean(id));
    const importedProductIds = imported
      .map((item) => item.productId)
      .filter((id): id is string => Boolean(id));
    const importedEditionIds = imported
      .map((item) => item.editionId)
      .filter((id): id is string => Boolean(id));
    const importedBookIds = imported
      .map((item) => item.bookId)
      .filter((id): id is string => Boolean(id));
    if (importedSkuIds.length)
      await database.db.delete(skus).where(inArray(skus.id, importedSkuIds));
    if (importedProductIds.length)
      await database.db.delete(products).where(inArray(products.id, importedProductIds));
    if (importedEditionIds.length)
      await database.db.delete(bookEditions).where(inArray(bookEditions.id, importedEditionIds));
    if (importedBookIds.length)
      await database.db.delete(books).where(inArray(books.id, importedBookIds));
    if (createdIds.session) {
      await database.db
        .delete(meipingCorrectionReviews)
        .where(eq(meipingCorrectionReviews.sessionId, createdIds.session));
      await database.db
        .delete(meipingReviewCorrections)
        .where(eq(meipingReviewCorrections.sessionId, createdIds.session));
      await database.db
        .delete(meipingReviewDecisions)
        .where(eq(meipingReviewDecisions.sessionId, createdIds.session));
      await database.db
        .delete(meipingReviewSessions)
        .where(eq(meipingReviewSessions.id, createdIds.session));
    }
    if (createdIds.existingSku)
      await database.db
        .delete(storeInventory)
        .where(eq(storeInventory.skuId, createdIds.existingSku));
    if (createdIds.existingProduct)
      await database.db.delete(skus).where(eq(skus.productId, createdIds.existingProduct));
    if (createdIds.existingProduct)
      await database.db.delete(products).where(eq(products.id, createdIds.existingProduct));
    if (createdIds.existingEdition)
      await database.db.delete(bookEditions).where(eq(bookEditions.id, createdIds.existingEdition));
    if (createdIds.existingBook)
      await database.db.delete(books).where(eq(books.id, createdIds.existingBook));
    if (createdIds.store) await database.db.delete(stores).where(eq(stores.id, createdIds.store));
    if (createdIds.region)
      await database.db.delete(regions).where(eq(regions.id, createdIds.region));
    if (createdIds.actor)
      await database.db
        .delete(auditLogs)
        .where(inArray(auditLogs.actorStaffAccountId, [createdIds.actor, createdIds.approver]));
    if (createdIds.actor)
      await database.db
        .delete(staffAccounts)
        .where(inArray(staffAccounts.id, [createdIds.actor, createdIds.approver]));
    await database.pool.end();
  });

  it('requires every decision, separates approval, applies counted stock once, and is retry-safe', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [actor] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: `apply-${suffix}`, passwordHash: 'test-only' })
      .returning({ id: staffAccounts.id });
    const [approver] = await database!.db
      .insert(staffAccounts)
      .values({ loginIdentifier: `approve-${suffix}`, passwordHash: 'test-only' })
      .returning({ id: staffAccounts.id });
    createdIds.actor = actor!.id;
    createdIds.approver = approver!.id;
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: `APPLY-R-${suffix}`,
        name: 'Disposable apply region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    createdIds.region = region!.id;
    const [store] = await database!.db
      .insert(stores)
      .values({
        regionId: region!.id,
        code: `APPLY-S-${suffix}`,
        name: 'Disposable apply store',
        countryCode: 'CN',
        countryName: 'China',
        city: 'Chengdu',
        timezone: 'Asia/Shanghai',
        addressLine: 'Disposable test only',
        latitude: 30.5,
        longitude: 104,
      })
      .returning({ id: stores.id });
    createdIds.store = store!.id;
    const [existingBook] = await database!.db
      .insert(books)
      .values({ title: 'Existing title', author: 'Existing author' })
      .returning({ id: books.id });
    createdIds.existingBook = existingBook!.id;
    const [existingEdition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: existingBook!.id, isbn: '9783161484100', publisher: 'Existing publisher' })
      .returning({ id: bookEditions.id });
    createdIds.existingEdition = existingEdition!.id;
    const [existingProduct] = await database!.db
      .insert(products)
      .values({ bookEditionId: existingEdition!.id, name: 'Existing product', status: 'DRAFT' })
      .returning({ id: products.id });
    createdIds.existingProduct = existingProduct!.id;
    const [existingSku] = await database!.db
      .insert(skus)
      .values({
        productId: existingProduct!.id,
        code: `EXIST-${suffix}`,
        name: '标准',
        priceMinor: 2200,
        availableForSale: false,
      })
      .returning({ id: skus.id });
    createdIds.existingSku = existingSku!.id;
    const checksum = 'b'.repeat(64);
    const report: MeipingPreflightReport = {
      sourceType: 'MEIPING_XLS',
      sourceChecksum: checksum,
      sourceStoreId: store!.id,
      sourceStoreCode: `APPLY-S-${suffix}`,
      inventoryApproval: 'PENDING_ADMIN_REVIEW',
      totalRows: 2,
      matchedRows: 0,
      createCandidateRows: 2,
      exceptionRows: 0,
      metadataWarningRows: 0,
      blockingRows: 0,
      saleBlockedRows: 0,
      assumedInventoryRows: 2,
      plannedInventoryTotal: 2,
      exceptionReportCsv: '',
      rows: [
        {
          sourceRowNumber: 2,
          rawColumns: { title: 'New' },
          sourceCategory: '图书',
          sourceCategoryType: 'BOOK',
          sourceIdentifiers: {
            bookCode: 'NEW-2',
            internalCode: null,
            barcode: null,
            isbn: '9780306406157',
          },
          normalized: {
            title: 'New title',
            author: 'New author',
            publisher: null,
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
        {
          sourceRowNumber: 3,
          rawColumns: { title: 'Existing' },
          sourceCategory: '图书',
          sourceCategoryType: 'BOOK',
          sourceIdentifiers: {
            bookCode: 'EXIST-3',
            internalCode: null,
            barcode: null,
            isbn: '9783161484100',
          },
          normalized: {
            title: 'Existing title',
            author: 'Existing author',
            publisher: 'Existing publisher',
            priceMinor: 2200,
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
    const review = new (
      await import('../src/migration/meiping-review-service.js')
    ).MeipingReviewService(database!.db);
    const session = await review.createSession(report, {
      actorStaffAccountId: actor!.id,
      requestId: randomUUID(),
    });
    createdIds.session = session.id;
    const apply = new MeipingApplyService(database!.db, true);
    const incomplete = await apply.preview(session.id, store!.id, {
      actorStaffAccountId: actor!.id,
      requestId: randomUUID(),
    });
    createdIds.batch = incomplete.batchId;
    expect(incomplete.plan.conflicts).toEqual([
      { sourceRowNumber: 2, code: 'DECISION_REQUIRED' },
      { sourceRowNumber: 3, code: 'DECISION_REQUIRED' },
    ]);
    await review.saveCorrection(
      session.id,
      store!.id,
      2,
      {
        expectedVersion: 0,
        expectedChecksum: checksum,
        proposedFields: { author: 'Corrected author', priceMinor: 4100 },
        reason: '核对纸质书封面资料',
      },
      { actorStaffAccountId: actor!.id, requestId: randomUUID() },
    );
    await review.reviewCorrection(
      session.id,
      store!.id,
      2,
      {
        expectedChecksum: checksum,
        expectedCorrectionVersion: 1,
        verdict: 'ACCEPTED',
        reason: '独立复核通过',
      },
      { actorStaffAccountId: approver!.id, requestId: randomUUID() },
    );
    for (const sourceRowNumber of [2, 3]) {
      await review.saveDecision(
        session.id,
        store!.id,
        sourceRowNumber,
        {
          action: 'CREATE_DRAFT',
          sourceRowNumber,
          countedQuantity: sourceRowNumber === 2 ? 2 : 0,
          expectedVersion: 0,
          expectedChecksum: checksum,
        },
        { actorStaffAccountId: actor!.id, requestId: randomUUID() },
      );
    }
    const preview = await apply.preview(session.id, store!.id, {
      actorStaffAccountId: actor!.id,
      requestId: randomUUID(),
    });
    expect(preview.plan).toMatchObject({ totalRows: 2, includedRows: 2, excludedRows: 0 });
    await expect(
      apply.approve(preview.batchId, { actorStaffAccountId: actor!.id, requestId: randomUUID() }),
    ).rejects.toThrow(MeipingApplyError);
    await apply.approve(preview.batchId, {
      actorStaffAccountId: approver!.id,
      requestId: randomUUID(),
    });
    await expect(
      new MeipingApplyService(database!.db, false).execute(preview.batchId, {
        actorStaffAccountId: approver!.id,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(MeipingApplyError);
    await review.saveDecision(
      session.id,
      store!.id,
      2,
      {
        action: 'CREATE_DRAFT',
        sourceRowNumber: 2,
        countedQuantity: 3,
        expectedVersion: 1,
        expectedChecksum: checksum,
      },
      { actorStaffAccountId: actor!.id, requestId: randomUUID() },
    );
    await expect(
      apply.execute(preview.batchId, {
        actorStaffAccountId: approver!.id,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(MeipingApplyError);
    const refreshedPreview = await apply.preview(session.id, store!.id, {
      actorStaffAccountId: actor!.id,
      requestId: randomUUID(),
    });
    await apply.approve(refreshedPreview.batchId, {
      actorStaffAccountId: approver!.id,
      requestId: randomUUID(),
    });
    const executed = await apply.execute(preview.batchId, {
      actorStaffAccountId: approver!.id,
      requestId: randomUUID(),
    });
    expect(executed).toMatchObject({
      status: 'SUCCEEDED',
      result: { writtenRows: 2, countedQuantity: 3 },
    });
    const retry = await apply.execute(preview.batchId, {
      actorStaffAccountId: approver!.id,
      requestId: randomUUID(),
    });
    expect(retry).toMatchObject({ status: 'SUCCEEDED' });
    const stocks = await database!.db
      .select()
      .from(storeInventory)
      .where(eq(storeInventory.storeId, store!.id));
    expect(stocks.reduce((sum, item) => sum + item.onHand, 0)).toBe(3);
    const transactions = await database!.db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.referenceId, preview.batchId));
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.transactionType).toBe('INITIAL_MIGRATION');
    const results = await database!.db
      .select()
      .from(meipingImportResults)
      .where(eq(meipingImportResults.batchId, preview.batchId));
    expect(results).toHaveLength(2);
    const importedSkus = await database!.db
      .select({ priceMinor: skus.priceMinor })
      .from(skus)
      .where(
        inArray(
          skus.id,
          results.map((result) => result.skuId).filter((id): id is string => Boolean(id)),
        ),
      );
    expect(importedSkus.map((sku) => sku.priceMinor)).toContain(4100);
  });
});
