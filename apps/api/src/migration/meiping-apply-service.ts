import { and, eq, sql } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  meipingCorrectionReviews,
  meipingImportBatches,
  meipingImportResults,
  meipingReviewCorrections,
  meipingReviewDecisions,
  meipingReviewSessions,
  products,
  skus,
  storeInventory,
  inventoryTransactions,
  type createDatabase,
} from '@xiaohai/db';
import type { MeipingPreflightReport } from './meiping-preflight.js';

type Database = ReturnType<typeof createDatabase>['db'];
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type MeipingApplyAuditContext = {
  actorStaffAccountId: string;
  requestId: string;
};

export class MeipingApplyError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'DECISION_REQUIRED'
      | 'CORRECTION_NOT_ACCEPTED'
      | 'APPROVAL_REQUIRED'
      | 'APPROVAL_SEPARATION_REQUIRED'
      | 'EXECUTION_DISABLED'
      | 'EXISTING_INVENTORY'
      | 'INVALID_SOURCE',
  ) {
    super(code);
  }
}

type ApplyPlanRow = {
  sourceRowNumber: number;
  title: string;
  author: string | null;
  publisher: string | null;
  isbn: string | null;
  barcode: string | null;
  priceMinor: number | null;
  countedQuantity: number;
  action: 'CREATE_DRAFT';
  acceptedCorrectionVersion: number | null;
  acceptedFields: Record<string, string | number>;
};

type ApplyPlan = {
  sourceChecksum: string;
  storeId: string;
  totalRows: number;
  includedRows: number;
  excludedRows: number;
  conflicts: Array<{ sourceRowNumber: number; code: string }>;
  rows: ApplyPlanRow[];
};

export class MeipingApplyService {
  constructor(
    private readonly db: Database,
    private readonly executionEnabled = false,
  ) {}

  async preview(sessionId: string, storeId: string, audit: MeipingApplyAuditContext) {
    const { session, report, decisions, corrections, reviews } = await this.loadReview(
      sessionId,
      storeId,
    );
    const plan = this.buildPlan(session, report, decisions, corrections, reviews);
    const idempotencyKey = `meiping:${session.id}:${session.sourceChecksum}`;
    const result = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(meipingImportBatches)
        .values({
          reviewSessionId: session.id,
          storeId,
          sourceChecksum: session.sourceChecksum,
          status: 'PREVIEW',
          plan,
          idempotencyKey,
          createdByStaffAccountId: audit.actorStaffAccountId,
        })
        .onConflictDoNothing({ target: meipingImportBatches.reviewSessionId })
        .returning({ id: meipingImportBatches.id });
      const batchId = created?.id ?? (await this.findBatchId(tx, session.id));
      if (!batchId) throw new MeipingApplyError('CONFLICT');
      if (!created) {
        const [existing] = await tx
          .select({ status: meipingImportBatches.status })
          .from(meipingImportBatches)
          .where(eq(meipingImportBatches.id, batchId))
          .limit(1);
        if (existing?.status === 'PREVIEW') {
          await tx
            .update(meipingImportBatches)
            .set({ plan, updatedAt: new Date() })
            .where(eq(meipingImportBatches.id, batchId));
        } else if (existing?.status === 'APPROVED') {
          const [approvedBatch] = await tx
            .select({ plan: meipingImportBatches.plan })
            .from(meipingImportBatches)
            .where(eq(meipingImportBatches.id, batchId))
            .limit(1);
          if (stableJson(approvedBatch?.plan) !== stableJson(plan)) {
            await tx
              .update(meipingImportBatches)
              .set({
                status: 'PREVIEW',
                plan,
                approvedByStaffAccountId: null,
                approvedAt: null,
                updatedAt: new Date(),
              })
              .where(eq(meipingImportBatches.id, batchId));
          }
        }
      }
      if (created) {
        await tx.insert(auditLogs).values({
          actorStaffAccountId: audit.actorStaffAccountId,
          actionKey: 'meiping.import.preview',
          resourceType: 'MEIPING_IMPORT_BATCH',
          resourceId: batchId,
          requestId: audit.requestId,
          metadata: {
            storeId,
            sourceChecksum: session.sourceChecksum,
            totalRows: plan.totalRows,
            includedRows: plan.includedRows,
            excludedRows: plan.excludedRows,
          },
        });
      }
      return { batchId, created: Boolean(created) };
    });
    return { ...result, status: 'PREVIEW' as const, plan, canExecute: this.executionEnabled };
  }

  async approve(batchId: string, audit: MeipingApplyAuditContext) {
    const result = await this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      if (!batch) throw new MeipingApplyError('NOT_FOUND');
      if (batch.createdByStaffAccountId === audit.actorStaffAccountId) {
        throw new MeipingApplyError('APPROVAL_SEPARATION_REQUIRED');
      }
      if (batch.status !== 'PREVIEW') throw new MeipingApplyError('CONFLICT');
      const savedPlan = batch.plan as unknown as ApplyPlan;
      if (savedPlan.conflicts.length > 0) throw new MeipingApplyError('CONFLICT');
      const [updated] = await tx
        .update(meipingImportBatches)
        .set({
          status: 'APPROVED',
          approvedByStaffAccountId: audit.actorStaffAccountId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(meipingImportBatches.id, batchId), eq(meipingImportBatches.status, 'PREVIEW')),
        )
        .returning({ id: meipingImportBatches.id, status: meipingImportBatches.status });
      if (!updated) throw new MeipingApplyError('CONFLICT');
      await tx.insert(auditLogs).values({
        actorStaffAccountId: audit.actorStaffAccountId,
        actionKey: 'meiping.import.approve',
        resourceType: 'MEIPING_IMPORT_BATCH',
        resourceId: batchId,
        requestId: audit.requestId,
        metadata: { approved: true },
      });
      return updated;
    });
    return { ...result, approved: true as const, executed: false as const };
  }

  async execute(batchId: string, audit: MeipingApplyAuditContext) {
    if (!this.executionEnabled) throw new MeipingApplyError('EXECUTION_DISABLED');
    try {
      return await this.db.transaction(async (tx) => {
        const batch = await this.lockBatch(tx, batchId);
        if (!batch) throw new MeipingApplyError('NOT_FOUND');
        if (batch.status === 'SUCCEEDED') {
          return { batchId, status: 'SUCCEEDED' as const, result: batch.result };
        }
        if (batch.status !== 'APPROVED') throw new MeipingApplyError('APPROVAL_REQUIRED');
        const { session, report, decisions, corrections, reviews } = await this.loadReview(
          batch.reviewSessionId,
          batch.storeId,
          tx,
        );
        if (session.sourceChecksum !== batch.sourceChecksum)
          throw new MeipingApplyError('INVALID_SOURCE');
        const plan = this.buildPlan(session, report, decisions, corrections, reviews);
        if (plan.conflicts.length > 0) throw new MeipingApplyError('CONFLICT');
        if (stableJson(batch.plan) !== stableJson(plan)) {
          throw new MeipingApplyError('CONFLICT');
        }
        await tx
          .update(meipingImportBatches)
          .set({ status: 'EXECUTING', updatedAt: new Date() })
          .where(eq(meipingImportBatches.id, batchId));
        const resultRows = [] as Array<Record<string, unknown>>;
        for (const row of plan.rows) {
          const resolved = await this.applyRow(tx, row, batch.storeId, batchId, audit);
          resultRows.push({ sourceRowNumber: row.sourceRowNumber, ...resolved });
        }
        for (const row of resultRows) {
          await tx.insert(meipingImportResults).values({
            batchId,
            sourceRowNumber: row.sourceRowNumber as number,
            outcome: row.outcome as 'CREATED' | 'REUSED',
            bookId: (row.bookId as string | null) ?? null,
            bookEditionId: (row.bookEditionId as string | null) ?? null,
            productId: row.productId as string,
            skuId: row.skuId as string,
            countedQuantity: row.countedQuantity as number,
          });
        }
        const result = {
          totalRows: plan.totalRows,
          includedRows: resultRows.length,
          excludedRows: plan.excludedRows,
          writtenRows: resultRows.length,
          countedQuantity: resultRows.reduce((sum, row) => sum + Number(row.countedQuantity), 0),
        };
        await tx
          .update(meipingImportBatches)
          .set({ status: 'SUCCEEDED', result, executedAt: new Date(), updatedAt: new Date() })
          .where(eq(meipingImportBatches.id, batchId));
        await tx.insert(auditLogs).values({
          actorStaffAccountId: audit.actorStaffAccountId,
          actionKey: 'meiping.import.execute',
          resourceType: 'MEIPING_IMPORT_BATCH',
          resourceId: batchId,
          requestId: audit.requestId,
          metadata: { writtenRows: result.writtenRows, countedQuantity: result.countedQuantity },
        });
        return { batchId, status: 'SUCCEEDED' as const, result };
      });
    } catch (error) {
      if (error instanceof MeipingApplyError) throw error;
      throw new MeipingApplyError('CONFLICT');
    }
  }

  async getBatch(batchId: string, storeId: string) {
    const [batch] = await this.db
      .select()
      .from(meipingImportBatches)
      .where(and(eq(meipingImportBatches.id, batchId), eq(meipingImportBatches.storeId, storeId)))
      .limit(1);
    if (!batch) throw new MeipingApplyError('NOT_FOUND');
    const rows = await this.db
      .select()
      .from(meipingImportResults)
      .where(eq(meipingImportResults.batchId, batchId));
    return { ...batch, rows, canExecute: this.executionEnabled };
  }

  private async loadReview(
    sessionId: string,
    storeId: string,
    database: Database | Transaction = this.db,
  ) {
    const [session] = await database
      .select()
      .from(meipingReviewSessions)
      .where(
        and(eq(meipingReviewSessions.id, sessionId), eq(meipingReviewSessions.storeId, storeId)),
      )
      .limit(1);
    if (!session) throw new MeipingApplyError('NOT_FOUND');
    const report = session.report as unknown as MeipingPreflightReport;
    if (report.sourceStoreId !== storeId || report.sourceChecksum !== session.sourceChecksum) {
      throw new MeipingApplyError('INVALID_SOURCE');
    }
    const decisions = await database
      .select()
      .from(meipingReviewDecisions)
      .where(eq(meipingReviewDecisions.sessionId, sessionId));
    const corrections = await database
      .select()
      .from(meipingReviewCorrections)
      .where(eq(meipingReviewCorrections.sessionId, sessionId));
    const reviews = await database
      .select()
      .from(meipingCorrectionReviews)
      .where(eq(meipingCorrectionReviews.sessionId, sessionId));
    return { session, report, decisions, corrections, reviews };
  }

  private buildPlan(
    session: typeof meipingReviewSessions.$inferSelect,
    report: MeipingPreflightReport,
    decisions: Array<typeof meipingReviewDecisions.$inferSelect>,
    corrections: Array<typeof meipingReviewCorrections.$inferSelect>,
    reviews: Array<typeof meipingCorrectionReviews.$inferSelect>,
  ): ApplyPlan {
    const decisionMap = new Map(decisions.map((item) => [item.sourceRowNumber, item]));
    const correctionMap = new Map(corrections.map((item) => [item.sourceRowNumber, item]));
    const reviewMap = new Map(
      reviews.map((item) => [`${item.sourceRowNumber}:${item.correctionVersion}`, item]),
    );
    const conflicts: ApplyPlan['conflicts'] = [];
    const rows: ApplyPlanRow[] = [];
    let excludedRows = 0;
    for (const row of report.rows) {
      const decision = decisionMap.get(row.sourceRowNumber);
      if (!decision) {
        conflicts.push({ sourceRowNumber: row.sourceRowNumber, code: 'DECISION_REQUIRED' });
        continue;
      }
      if (decision.action === 'EXCLUDE') {
        excludedRows += 1;
        continue;
      }
      if (
        decision.action !== 'CREATE_DRAFT' ||
        decision.countedQuantity === null ||
        decision.countedQuantity < 0
      ) {
        conflicts.push({ sourceRowNumber: row.sourceRowNumber, code: 'INVALID_COUNTED_QUANTITY' });
        continue;
      }
      if (
        row.sourceCategoryType !== 'BOOK' ||
        row.disposition !== 'CREATE_CANDIDATE' ||
        row.blockingIssues.length > 0
      ) {
        conflicts.push({
          sourceRowNumber: row.sourceRowNumber,
          code: 'ROW_REQUIRES_MANUAL_RESOLUTION',
        });
        continue;
      }
      const correction = correctionMap.get(row.sourceRowNumber);
      const accepted = correction
        ? reviewMap.get(`${row.sourceRowNumber}:${correction.version}`)
        : undefined;
      const acceptedFields =
        accepted?.verdict === 'ACCEPTED' ? correction?.proposedFields : undefined;
      const normalized = row.normalized;
      const title =
        typeof acceptedFields?.title === 'string' ? acceptedFields.title : normalized.title;
      const author =
        typeof acceptedFields?.author === 'string' ? acceptedFields.author : normalized.author;
      const publisher =
        typeof acceptedFields?.publisher === 'string'
          ? acceptedFields.publisher
          : normalized.publisher;
      const isbn =
        typeof acceptedFields?.barcode === 'string'
          ? acceptedFields.barcode
          : row.sourceIdentifiers.isbn;
      const barcode = row.sourceIdentifiers.barcode;
      const priceMinor =
        typeof acceptedFields?.priceMinor === 'number'
          ? acceptedFields.priceMinor
          : normalized.priceMinor;
      if (!title || !author || priceMinor === null || priceMinor < 0) {
        conflicts.push({
          sourceRowNumber: row.sourceRowNumber,
          code: 'CATALOG_REQUIRED_DATA_MISSING',
        });
        continue;
      }
      rows.push({
        sourceRowNumber: row.sourceRowNumber,
        title,
        author,
        publisher,
        isbn,
        barcode,
        priceMinor,
        countedQuantity: decision.countedQuantity,
        action: 'CREATE_DRAFT',
        acceptedCorrectionVersion:
          accepted?.verdict === 'ACCEPTED' ? (correction?.version ?? null) : null,
        acceptedFields: acceptedFields ?? {},
      });
    }
    return {
      sourceChecksum: session.sourceChecksum,
      storeId: session.storeId,
      totalRows: report.totalRows,
      includedRows: rows.length,
      excludedRows,
      conflicts,
      rows,
    };
  }

  private async applyRow(
    tx: Transaction,
    row: ApplyPlanRow,
    storeId: string,
    batchId: string,
    audit: MeipingApplyAuditContext,
  ) {
    let bookId: string | null = null;
    let editionId: string | null = null;
    let productId: string | null = null;
    let skuId: string | null = null;
    if (row.isbn) {
      const [edition] = await tx
        .select()
        .from(bookEditions)
        .where(eq(bookEditions.isbn, row.isbn))
        .limit(1);
      if (edition) {
        editionId = edition.id;
        bookId = edition.bookId;
      }
    }
    if (!bookId) {
      if (!row.author) throw new MeipingApplyError('INVALID_SOURCE');
      const [book] = await tx
        .insert(books)
        .values({ title: row.title, author: row.author })
        .returning({ id: books.id });
      if (!book) throw new MeipingApplyError('CONFLICT');
      bookId = book.id;
      const [edition] = await tx
        .insert(bookEditions)
        .values({ bookId, isbn: row.isbn, publisher: row.publisher })
        .returning({ id: bookEditions.id });
      if (!edition) throw new MeipingApplyError('CONFLICT');
      editionId = edition.id;
    }
    if (!editionId) throw new MeipingApplyError('INVALID_SOURCE');
    const ensuredEditionId = editionId;
    const [existingProduct] = await tx
      .select()
      .from(products)
      .where(eq(products.bookEditionId, ensuredEditionId))
      .limit(1);
    if (existingProduct) productId = existingProduct.id;
    if (!productId) {
      const [product] = await tx
        .insert(products)
        .values({ bookEditionId: ensuredEditionId, name: row.title, status: 'DRAFT' })
        .returning({ id: products.id });
      if (!product) throw new MeipingApplyError('CONFLICT');
      productId = product.id;
    }
    const [existingSku] = await tx
      .select()
      .from(skus)
      .where(eq(skus.productId, productId))
      .limit(1);
    if (existingSku) skuId = existingSku.id;
    if (!skuId) {
      const code = `MP-${batchId.slice(0, 8)}-${String(row.sourceRowNumber).padStart(6, '0')}`;
      const [sku] = await tx
        .insert(skus)
        .values({
          productId,
          code,
          name: '标准',
          priceMinor: row.priceMinor!,
          availableForSale: false,
        })
        .returning({ id: skus.id });
      if (!sku) throw new MeipingApplyError('CONFLICT');
      skuId = sku.id;
    }
    if (existingProduct && (row.acceptedFields.title || row.acceptedFields.author)) {
      await tx
        .update(books)
        .set({
          ...(typeof row.acceptedFields.title === 'string'
            ? { title: row.acceptedFields.title }
            : {}),
          ...(typeof row.acceptedFields.author === 'string'
            ? { author: row.acceptedFields.author }
            : {}),
          version: sql`${books.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(books.id, bookId));
    }
    if (existingProduct && typeof row.acceptedFields.publisher === 'string') {
      await tx
        .update(bookEditions)
        .set({
          publisher: row.acceptedFields.publisher,
          version: sql`${bookEditions.version} + 1`,
        })
        .where(eq(bookEditions.id, ensuredEditionId));
    }
    if (existingSku && typeof row.acceptedFields.priceMinor === 'number') {
      await tx
        .update(skus)
        .set({
          priceMinor: row.acceptedFields.priceMinor,
          version: sql`${skus.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(skus.id, skuId));
    }
    const [inventory] = await tx
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
      .for('update')
      .limit(1);
    if (inventory && inventory.onHand !== 0) throw new MeipingApplyError('EXISTING_INVENTORY');
    if (!inventory) {
      await tx.insert(storeInventory).values({
        storeId,
        skuId,
        onHand: row.countedQuantity,
        version: row.countedQuantity > 0 ? 1 : 0,
      });
    } else if (row.countedQuantity > 0) {
      await tx
        .update(storeInventory)
        .set({
          onHand: row.countedQuantity,
          version: sql`${storeInventory.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)));
    }
    if (row.countedQuantity > 0) {
      await tx.insert(inventoryTransactions).values({
        storeId,
        skuId,
        transactionType: 'INITIAL_MIGRATION',
        quantityDelta: row.countedQuantity,
        balanceAfter: row.countedQuantity,
        referenceType: 'MEIPING_IMPORT',
        referenceId: batchId,
        idempotencyKey: `meiping:${batchId}:${storeId}:${skuId}`,
        metadata: { sourceRowNumber: row.sourceRowNumber, sourceChecksum: 'redacted' },
        createdByStaffAccountId: audit.actorStaffAccountId,
      });
    }
    return {
      outcome: existingProduct ? 'REUSED' : 'CREATED',
      bookId,
      bookEditionId: editionId,
      productId,
      skuId,
      countedQuantity: row.countedQuantity,
    };
  }

  private async lockBatch(tx: Transaction, batchId: string) {
    const [batch] = await tx
      .select()
      .from(meipingImportBatches)
      .where(eq(meipingImportBatches.id, batchId))
      .for('update')
      .limit(1);
    return batch;
  }

  private async findBatchId(tx: Transaction, sessionId: string) {
    const [row] = await tx
      .select({ id: meipingImportBatches.id })
      .from(meipingImportBatches)
      .where(eq(meipingImportBatches.reviewSessionId, sessionId))
      .limit(1);
    return row?.id;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
