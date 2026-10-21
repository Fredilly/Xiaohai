import { and, desc, eq, ne } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  catalogCorrectionRequests,
  products,
  skus,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import {
  catalogCorrectionRecordSchema,
  catalogCorrectionsResponseSchema,
  type CreateCatalogCorrection,
  type ReviewCatalogCorrection,
} from '@xiaohai/contracts/commerce';

type Db = ReturnType<typeof createDatabase>['db'];
export type CatalogCorrectionErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'STAFF_FORBIDDEN';
export class CatalogCorrectionError extends Error {
  constructor(readonly code: CatalogCorrectionErrorCode) {
    super(code);
  }
}

/**
 * Daily correction recommendations, not an alternate HQ catalog writer.
 * Every mutation changes only proposals and audit rows.
 */
export class CatalogCorrectionService {
  constructor(private readonly db: Db) {}

  async list(storeId: string) {
    const rows = await this.db
      .select()
      .from(catalogCorrectionRequests)
      .where(eq(catalogCorrectionRequests.storeId, storeId))
      .orderBy(desc(catalogCorrectionRequests.createdAt), desc(catalogCorrectionRequests.id))
      .limit(50);
    return catalogCorrectionsResponseSchema.parse({ requests: rows.map(toContract) });
  }

  async submit(
    storeId: string,
    actorId: string,
    requestId: string,
    input: CreateCatalogCorrection,
  ) {
    const source = await this.loadSource(storeId, input.skuId);
    if (!source) throw new CatalogCorrectionError('NOT_FOUND');
    if (source.inventoryVersion !== input.expectedInventoryVersion) {
      throw new CatalogCorrectionError('CONFLICT');
    }
    const current = getSourceField(source, input.field);
    if (current === undefined) throw new CatalogCorrectionError('CONFLICT');
    if (current === input.proposedValue) throw new CatalogCorrectionError('CONFLICT');

    try {
      const created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(catalogCorrectionRequests)
          .values({
            storeId,
            skuId: input.skuId,
            sourceProductId: source.productId,
            field: input.field,
            originalValue: current,
            proposedValue: input.proposedValue,
            expectedInventoryVersion: input.expectedInventoryVersion,
            reason: input.reason,
            requestedByStaffAccountId: actorId,
          })
          .returning();
        if (!row) throw new CatalogCorrectionError('CONFLICT');
        await tx.insert(auditLogs).values({
          actorStaffAccountId: actorId,
          actionKey: 'catalog.correction.submit',
          resourceType: 'catalog_correction_request',
          resourceId: row.id,
          requestId,
          metadata: { storeId, skuId: input.skuId, field: input.field },
        });
        return row;
      });
      return toContract(created);
    } catch (error) {
      if (hasPgCode(error, '23505')) throw new CatalogCorrectionError('CONFLICT');
      throw error;
    }
  }

  async review(
    storeId: string,
    correctionId: string,
    reviewerId: string,
    requestId: string,
    input: ReviewCatalogCorrection,
  ) {
    return await this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(catalogCorrectionRequests)
        .where(
          and(
            eq(catalogCorrectionRequests.id, correctionId),
            eq(catalogCorrectionRequests.storeId, storeId),
          ),
        )
        .limit(1);
      if (!request) throw new CatalogCorrectionError('NOT_FOUND');
      if (request.status !== 'PENDING') throw new CatalogCorrectionError('CONFLICT');
      if (request.requestedByStaffAccountId === reviewerId) {
        throw new CatalogCorrectionError('STAFF_FORBIDDEN');
      }
      if (input.verdict === 'ACCEPTED') {
        const source = await this.loadSource(storeId, request.skuId);
        if (!source || source.productId !== request.sourceProductId) {
          throw new CatalogCorrectionError('CONFLICT');
        }
        const value = getSourceField(source, request.field);
        if (value === undefined || value !== request.originalValue) {
          throw new CatalogCorrectionError('CONFLICT');
        }
        if (request.field === 'isbn') {
          const conflicts = await tx
            .select({ id: bookEditions.id })
            .from(bookEditions)
            .where(
              and(
                eq(bookEditions.isbn, request.proposedValue),
                source.bookEditionId ? ne(bookEditions.id, source.bookEditionId) : undefined,
              ),
            )
            .limit(1);
          if (conflicts.length) throw new CatalogCorrectionError('CONFLICT');
        }
      }
      const [decided] = await tx
        .update(catalogCorrectionRequests)
        .set({
          status: input.verdict,
          reviewReason: input.reason,
          reviewedByStaffAccountId: reviewerId,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(catalogCorrectionRequests.id, request.id),
            eq(catalogCorrectionRequests.storeId, storeId),
            eq(catalogCorrectionRequests.status, 'PENDING'),
          ),
        )
        .returning();
      if (!decided) throw new CatalogCorrectionError('CONFLICT');
      await tx.insert(auditLogs).values({
        actorStaffAccountId: reviewerId,
        actionKey: 'catalog.correction.review',
        resourceType: 'catalog_correction_request',
        resourceId: request.id,
        requestId,
        metadata: { storeId, skuId: request.skuId, field: request.field, verdict: input.verdict },
      });
      return toContract(decided);
    });
  }

  async loadSource(storeId: string, skuId: string) {
    const [row] = await this.db
      .select({
        productId: products.id,
        productName: products.name,
        bookTitle: books.title,
        author: books.author,
        publisher: bookEditions.publisher,
        isbn: bookEditions.isbn,
        bookEditionId: bookEditions.id,
        priceMinor: skus.priceMinor,
        inventoryVersion: storeInventory.version,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
      .limit(1);
    return row ?? null;
  }
}

type Source = NonNullable<Awaited<ReturnType<CatalogCorrectionService['loadSource']>>>;

function getSourceField(source: Source, field: string): string | null | undefined {
  switch (field) {
    case 'productName':
      return source.productName;
    case 'bookTitle':
      return source.bookEditionId ? (source.bookTitle ?? undefined) : undefined;
    case 'author':
      return source.bookEditionId ? (source.author ?? undefined) : undefined;
    case 'publisher':
      return source.bookEditionId ? source.publisher : undefined;
    case 'isbn':
      return source.bookEditionId ? source.isbn : undefined;
    case 'priceMinor':
      return String(source.priceMinor);
    default:
      return undefined;
  }
}

function toContract(row: typeof catalogCorrectionRequests.$inferSelect) {
  return catalogCorrectionRecordSchema.parse({
    id: row.id,
    storeId: row.storeId,
    skuId: row.skuId,
    field: row.field,
    originalValue: row.originalValue,
    proposedValue: row.proposedValue,
    reason: row.reason,
    status: row.status,
    requestedByStaffAccountId: row.requestedByStaffAccountId,
    reviewedByStaffAccountId: row.reviewedByStaffAccountId,
    reviewReason: row.reviewReason,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  });
}

function hasPgCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; cause?: unknown };
  return record.code === code || (record.cause !== error && hasPgCode(record.cause, code));
}
