import { and, eq, or, sql } from 'drizzle-orm';
import {
  auditLogs,
  bookEditions,
  books,
  products,
  skus,
  storeCatalogMetadata,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import {
  storeCatalogEditResponseSchema,
  type StoreCatalogEditRequest,
} from '@xiaohai/contracts/commerce';
import { StoreCatalogReadService } from './store-catalog-read-service.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type QueryContext = Db | Tx;

export type CatalogEditErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REFERENCE';

export class CatalogEditError extends Error {
  constructor(readonly code: CatalogEditErrorCode) {
    super(code);
  }
}

type Source = {
  storeId: string;
  skuId: string;
  productId: string;
  productName: string;
  productVersion: number;
  bookId: string | null;
  bookTitle: string | null;
  bookVersion: number | null;
  author: string | null;
  editionId: string | null;
  editionVersion: number | null;
  publisher: string | null;
  isbn: string | null;
  skuVersion: number;
  priceMinor: number;
  localVersion: number;
  shelfLocation: string | null;
  storeNote: string | null;
  displayInfo: string | null;
};

export class CatalogEditService {
  private readonly reader: StoreCatalogReadService;

  constructor(private readonly db: Db) {
    this.reader = new StoreCatalogReadService(db);
  }

  async preview(storeId: string, skuId: string, input: StoreCatalogEditRequest) {
    const source = await this.loadSource(this.db, storeId, skuId);
    if (!source) throw new CatalogEditError('NOT_FOUND');
    this.assertExpectedVersions(source, input);
    const changed = this.changedFields(source, input);
    if (!changed.length) return emptyImpact();
    const sharedFields = changed.filter((field) => !isLocalField(field));
    const affectedStoreIds = sharedFields.length
      ? await this.findAffectedStores(this.db, source, sharedFields)
      : [storeId];
    return { sharedFields, affectedStoreCount: affectedStoreIds.length, affectedStoreIds };
  }

  async update(
    storeId: string,
    skuId: string,
    actorStaffAccountId: string,
    requestId: string,
    input: StoreCatalogEditRequest,
  ) {
    try {
      const result = await this.db.transaction(async (tx) => {
        const source = await this.loadSource(tx, storeId, skuId);
        if (!source) throw new CatalogEditError('NOT_FOUND');
        this.assertExpectedVersions(source, input);

        const changed = this.changedFields(source, input);
        if (!changed.length) return { impact: emptyImpact(), changed };

        const sharedFields = changed.filter((field) => !isLocalField(field));
        const affectedStoreIds = sharedFields.length
          ? await this.findAffectedStores(tx, source, sharedFields)
          : [storeId];

        if (changed.includes('productName')) {
          await this.updateProduct(tx, source, input.productName!);
        }
        if (changed.includes('bookTitle') || changed.includes('author')) {
          await this.updateBook(tx, source, input);
        }
        if (changed.includes('publisher') || changed.includes('isbn')) {
          await this.updateEdition(tx, source, input);
        }
        if (changed.includes('priceMinor')) {
          await this.updateSku(tx, source, input.priceMinor!);
        }
        if (changed.some(isLocalField)) {
          await this.updateLocalMetadata(tx, source, input);
        }

        await tx.insert(auditLogs).values({
          actorStaffAccountId,
          actionKey: 'catalog.direct_edit',
          resourceType: 'SKU',
          resourceId: skuId,
          requestId,
          metadata: {
            storeId,
            skuId,
            changedFields: changed,
            sharedFields,
            affectedStoreCount: affectedStoreIds.length,
            affectedStoreIds,
            beforeVersions: {
              product: source.productVersion,
              book: source.bookVersion,
              edition: source.editionVersion,
              sku: source.skuVersion,
              local: source.localVersion,
            },
            expectedVersions: {
              product: input.expectedProductVersion,
              book: input.expectedBookVersion ?? null,
              edition: input.expectedEditionVersion ?? null,
              sku: input.expectedSkuVersion,
              local: input.expectedLocalVersion,
            },
            beforeValues: valuesFromSource(source, changed),
            afterValues: valuesFromInput(input, changed),
          },
        });
        return {
          impact: { sharedFields, affectedStoreCount: affectedStoreIds.length, affectedStoreIds },
          changed,
        };
      });

      const item = await this.reader.get(storeId, skuId);
      if (!item) throw new CatalogEditError('NOT_FOUND');
      return storeCatalogEditResponseSchema.parse({ item, impact: result.impact });
    } catch (error) {
      if (hasPgCode(error, '23505')) throw new CatalogEditError('CONFLICT');
      throw error;
    }
  }

  private async loadSource(
    tx: QueryContext,
    storeId: string,
    skuId: string,
  ): Promise<Source | null> {
    const [row] = await tx
      .select({
        storeId: storeInventory.storeId,
        skuId: skus.id,
        productId: products.id,
        productName: products.name,
        productVersion: products.version,
        bookId: books.id,
        bookTitle: books.title,
        bookVersion: books.version,
        author: books.author,
        editionId: bookEditions.id,
        editionVersion: bookEditions.version,
        publisher: bookEditions.publisher,
        isbn: bookEditions.isbn,
        skuVersion: skus.version,
        priceMinor: skus.priceMinor,
        localVersion: storeCatalogMetadata.version,
        shelfLocation: storeCatalogMetadata.shelfLocation,
        storeNote: storeCatalogMetadata.storeNote,
        displayInfo: storeCatalogMetadata.displayInfo,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .leftJoin(
        storeCatalogMetadata,
        and(
          eq(storeCatalogMetadata.storeId, storeInventory.storeId),
          eq(storeCatalogMetadata.skuId, storeInventory.skuId),
        ),
      )
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
      .for('update', { of: storeInventory })
      .limit(1);
    if (!row) return null;
    return { ...row, localVersion: row.localVersion ?? 0 };
  }

  private assertExpectedVersions(source: Source, input: StoreCatalogEditRequest) {
    if (input.expectedProductVersion !== source.productVersion)
      throw new CatalogEditError('CONFLICT');
    if (input.expectedSkuVersion !== source.skuVersion) throw new CatalogEditError('CONFLICT');
    if (input.expectedLocalVersion !== source.localVersion) throw new CatalogEditError('CONFLICT');
    if (hasAny(input, 'bookTitle', 'author') && input.expectedBookVersion !== source.bookVersion) {
      throw new CatalogEditError('CONFLICT');
    }
    if (
      hasAny(input, 'publisher', 'isbn') &&
      input.expectedEditionVersion !== source.editionVersion
    ) {
      throw new CatalogEditError('CONFLICT');
    }
    if (hasAny(input, 'bookTitle', 'author') && !source.bookId)
      throw new CatalogEditError('INVALID_REFERENCE');
    if (hasAny(input, 'publisher', 'isbn') && !source.editionId)
      throw new CatalogEditError('INVALID_REFERENCE');
  }

  private changedFields(source: Source, input: StoreCatalogEditRequest): string[] {
    const changed: string[] = [];
    if (input.productName !== undefined && input.productName !== source.productName)
      changed.push('productName');
    if (input.bookTitle !== undefined && input.bookTitle !== source.bookTitle)
      changed.push('bookTitle');
    if (input.author !== undefined && input.author !== source.author) changed.push('author');
    if (input.publisher !== undefined && input.publisher !== source.publisher)
      changed.push('publisher');
    if (input.isbn !== undefined && input.isbn !== source.isbn) changed.push('isbn');
    if (input.priceMinor !== undefined && input.priceMinor !== source.priceMinor)
      changed.push('priceMinor');
    if (input.shelfLocation !== undefined && input.shelfLocation !== source.shelfLocation)
      changed.push('shelfLocation');
    if (input.storeNote !== undefined && input.storeNote !== source.storeNote)
      changed.push('storeNote');
    if (input.displayInfo !== undefined && input.displayInfo !== source.displayInfo)
      changed.push('displayInfo');
    return changed;
  }

  private async updateProduct(tx: Tx, source: Source, name: string) {
    const [updated] = await tx
      .update(products)
      .set({ name, version: sql`${products.version} + 1`, updatedAt: new Date() })
      .where(and(eq(products.id, source.productId), eq(products.version, source.productVersion)))
      .returning({ id: products.id });
    if (!updated) throw new CatalogEditError('CONFLICT');
  }

  private async updateBook(tx: Tx, source: Source, input: StoreCatalogEditRequest) {
    const [updated] = await tx
      .update(books)
      .set({
        ...(input.bookTitle !== undefined ? { title: input.bookTitle } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        version: sql`${books.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(books.id, source.bookId!), eq(books.version, source.bookVersion!)))
      .returning({ id: books.id });
    if (!updated) throw new CatalogEditError('CONFLICT');
  }

  private async updateEdition(tx: Tx, source: Source, input: StoreCatalogEditRequest) {
    const [updated] = await tx
      .update(bookEditions)
      .set({
        ...(input.publisher !== undefined ? { publisher: input.publisher } : {}),
        ...(input.isbn !== undefined ? { isbn: input.isbn } : {}),
        version: sql`${bookEditions.version} + 1`,
      })
      .where(
        and(
          eq(bookEditions.id, source.editionId!),
          eq(bookEditions.version, source.editionVersion!),
        ),
      )
      .returning({ id: bookEditions.id });
    if (!updated) throw new CatalogEditError('CONFLICT');
  }

  private async updateSku(tx: Tx, source: Source, priceMinor: number) {
    const [updated] = await tx
      .update(skus)
      .set({ priceMinor, version: sql`${skus.version} + 1`, updatedAt: new Date() })
      .where(and(eq(skus.id, source.skuId), eq(skus.version, source.skuVersion)))
      .returning({ id: skus.id });
    if (!updated) throw new CatalogEditError('CONFLICT');
  }

  private async updateLocalMetadata(tx: Tx, source: Source, input: StoreCatalogEditRequest) {
    await tx
      .insert(storeCatalogMetadata)
      .values({ storeId: source.storeId, skuId: source.skuId })
      .onConflictDoNothing();
    const [updated] = await tx
      .update(storeCatalogMetadata)
      .set({
        ...(input.shelfLocation !== undefined ? { shelfLocation: input.shelfLocation } : {}),
        ...(input.storeNote !== undefined ? { storeNote: input.storeNote } : {}),
        ...(input.displayInfo !== undefined ? { displayInfo: input.displayInfo } : {}),
        version: sql`${storeCatalogMetadata.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(storeCatalogMetadata.storeId, source.storeId),
          eq(storeCatalogMetadata.skuId, source.skuId),
          eq(storeCatalogMetadata.version, source.localVersion),
        ),
      )
      .returning({ skuId: storeCatalogMetadata.skuId });
    if (!updated) throw new CatalogEditError('CONFLICT');
  }

  private async findAffectedStores(tx: QueryContext, source: Source, fields: string[]) {
    const productOrSku = or(eq(skus.id, source.skuId), eq(skus.productId, source.productId));
    const bookOrEdition = source.bookId
      ? or(eq(bookEditions.id, source.editionId!), eq(books.id, source.bookId))
      : eq(bookEditions.id, source.editionId ?? '00000000-0000-0000-0000-000000000000');
    const condition = fields.some((field) =>
      ['bookTitle', 'author', 'publisher', 'isbn'].includes(field),
    )
      ? or(productOrSku, bookOrEdition)
      : productOrSku;
    const rows = await tx
      .selectDistinct({ storeId: storeInventory.storeId })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(condition);
    return rows.map((row) => row.storeId);
  }
}

function isLocalField(field: string) {
  return ['shelfLocation', 'storeNote', 'displayInfo'].includes(field);
}

function hasAny(input: StoreCatalogEditRequest, ...fields: Array<keyof StoreCatalogEditRequest>) {
  return fields.some((field) => input[field] !== undefined);
}

function emptyImpact() {
  return { sharedFields: [], affectedStoreCount: 0, affectedStoreIds: [] as string[] };
}

function valuesFromSource(source: Source, fields: string[]) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      source[field as keyof Source] === undefined ? null : source[field as keyof Source],
    ]),
  );
}

function valuesFromInput(input: StoreCatalogEditRequest, fields: string[]) {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      input[field as keyof StoreCatalogEditRequest] === undefined
        ? null
        : input[field as keyof StoreCatalogEditRequest],
    ]),
  );
}

function hasPgCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; cause?: unknown };
  return record.code === code || (record.cause !== error && hasPgCode(record.cause, code));
}
