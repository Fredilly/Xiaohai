import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
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
  isValidIsbn,
  normalizeIsbn,
  type StoreCatalogEditRequest,
} from '@xiaohai/contracts/commerce';
import { StoreCatalogReadService } from './store-catalog-read-service.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type QueryContext = Db | Tx;

export type CatalogEditErrorCode =
  'NOT_FOUND' | 'CONFLICT' | 'INVALID_REFERENCE' | 'SHARED_FORBIDDEN';

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

  constructor(
    private readonly db: Db,
    private readonly previewSecret: string,
  ) {
    if (Buffer.byteLength(previewSecret, 'utf8') < 32) {
      throw new Error('Catalog impact signing secret must contain at least 32 bytes');
    }
    this.reader = new StoreCatalogReadService(db);
  }

  async preview(
    storeId: string,
    skuId: string,
    input: StoreCatalogEditRequest,
    actorStaffAccountId: string,
    sharedAllowed = false,
  ) {
    const source = await this.loadSource(this.db, storeId, skuId);
    if (!source) throw new CatalogEditError('NOT_FOUND');
    const canonicalInput = this.canonicalizeIsbn(source, input);
    this.assertExpectedVersions(source, canonicalInput);
    const changed = this.changedFields(source, canonicalInput);
    const sharedFields = changed.filter((field) => !isLocalField(field));
    if (sharedFields.length && !sharedAllowed) throw new CatalogEditError('SHARED_FORBIDDEN');
    const affectedStoreIds = sharedFields.length
      ? await this.findAffectedStores(this.db, source, sharedFields)
      : [storeId];
    const impact = { sharedFields, affectedStoreCount: affectedStoreIds.length, affectedStoreIds };
    return {
      impact,
      previewToken: sharedFields.length
        ? this.signImpact(actorStaffAccountId, storeId, skuId, input, impact)
        : null,
    };
  }

  async update(
    storeId: string,
    skuId: string,
    actorStaffAccountId: string,
    requestId: string,
    input: StoreCatalogEditRequest,
    sharedAllowed = false,
    previewToken?: string,
  ) {
    try {
      const result = await this.db.transaction(async (tx) => {
        const initial = await this.loadSource(tx, storeId, skuId);
        if (!initial) throw new CatalogEditError('NOT_FOUND');
        const proposal = this.canonicalizeIsbn(initial, input);
        const proposedChanges = this.changedFields(initial, proposal);
        const proposedShared = proposedChanges.filter((field) => !isLocalField(field));
        if (proposedShared.length && !sharedAllowed) {
          throw new CatalogEditError('SHARED_FORBIDDEN');
        }

        // Lock the entire dependency graph, not just the selected SKU. A new
        // inventory association uses an FK KEY SHARE lock on its SKU, and a
        // newly linked SKU/product/edition uses KEY SHARE on its parent.
        // Parent-to-child FOR UPDATE locks therefore serialize all such
        // associations until the impact has been checked AND committed.
        if (proposedShared.length) await this.lockSharedImpactGraph(tx, initial, proposedShared);
        // Lock waits may expose a newer committed source. Re-read under the
        // same transaction and refuse relationship changes without guessing.
        const source = proposedShared.length ? await this.loadSource(tx, storeId, skuId) : initial;
        if (!source) throw new CatalogEditError('NOT_FOUND');
        if (
          source.productId !== initial.productId ||
          source.editionId !== initial.editionId ||
          source.bookId !== initial.bookId
        )
          throw new CatalogEditError('CONFLICT');
        const canonicalInput = this.canonicalizeIsbn(source, input);
        this.assertExpectedVersions(source, canonicalInput);

        const changed = this.changedFields(source, canonicalInput);
        if (!changed.length) return { impact: emptyImpact(), changed };
        const sharedFields = changed.filter((field) => !isLocalField(field));
        if (JSON.stringify(sharedFields) !== JSON.stringify(proposedShared)) {
          throw new CatalogEditError('CONFLICT');
        }
        if (sharedFields.length && !sharedAllowed) throw new CatalogEditError('SHARED_FORBIDDEN');

        const affectedStoreIds = sharedFields.length
          ? await this.findAffectedStores(tx, source, sharedFields)
          : [storeId];
        if (sharedFields.length) {
          const impact = {
            sharedFields,
            affectedStoreCount: affectedStoreIds.length,
            affectedStoreIds,
          };
          if (
            !previewToken ||
            !this.verifyImpact(previewToken, actorStaffAccountId, storeId, skuId, input, impact)
          ) {
            throw new CatalogEditError('CONFLICT');
          }
        }

        if (changed.includes('productName')) {
          await this.updateProduct(tx, source, canonicalInput.productName!);
        }
        if (changed.includes('bookTitle') || changed.includes('author')) {
          await this.updateBook(tx, source, canonicalInput);
        }
        if (changed.includes('publisher') || changed.includes('isbn')) {
          await this.updateEdition(tx, source, canonicalInput);
        }
        if (changed.includes('priceMinor')) {
          await this.updateSku(tx, source, canonicalInput.priceMinor!);
        }
        if (changed.some(isLocalField)) {
          await this.updateLocalMetadata(tx, source, canonicalInput);
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
              product: canonicalInput.expectedProductVersion,
              book: canonicalInput.expectedBookVersion ?? null,
              edition: canonicalInput.expectedEditionVersion ?? null,
              sku: canonicalInput.expectedSkuVersion,
              local: canonicalInput.expectedLocalVersion,
            },
            beforeValues: valuesFromSource(source, changed),
            afterValues: valuesFromInput(canonicalInput, changed),
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

  private async lockSharedImpactGraph(tx: Tx, source: Source, fields: string[]) {
    // Fixed hierarchy: book -> edition -> product -> SKU. Lock all siblings
    // which can be affected by the changed master fields, not merely the
    // SKU on this store's URL. PostgreSQL's FK KEY SHARE vs FOR UPDATE
    // conflict prevents a new descendant or inventory link from slipping in.
    const bookOrEditionFields = fields.some((field) =>
      ['bookTitle', 'author', 'publisher', 'isbn'].includes(field),
    );
    let productIds: string[];
    if (bookOrEditionFields) {
      let editionIds: string[];
      if (source.bookId) {
        const bookRows = await tx
          .select({ id: books.id })
          .from(books)
          .where(eq(books.id, source.bookId))
          .for('update');
        if (!bookRows.length) throw new CatalogEditError('CONFLICT');
        const editionRows = await tx
          .select({ id: bookEditions.id })
          .from(bookEditions)
          .where(eq(bookEditions.bookId, source.bookId))
          .orderBy(asc(bookEditions.id))
          .for('update');
        editionIds = editionRows.map((row) => row.id);
      } else if (source.editionId) {
        const editionRows = await tx
          .select({ id: bookEditions.id })
          .from(bookEditions)
          .where(eq(bookEditions.id, source.editionId))
          .for('update');
        editionIds = editionRows.map((row) => row.id);
      } else {
        throw new CatalogEditError('INVALID_REFERENCE');
      }
      if (!editionIds.includes(source.editionId ?? '')) throw new CatalogEditError('CONFLICT');
      const productRows = await tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.bookEditionId, editionIds))
        .orderBy(asc(products.id))
        .for('update');
      productIds = productRows.map((row) => row.id);
    } else {
      const productRows = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, source.productId))
        .for('update');
      productIds = productRows.map((row) => row.id);
    }
    if (!productIds.includes(source.productId)) throw new CatalogEditError('CONFLICT');
    const skuRows = await tx
      .select({ id: skus.id })
      .from(skus)
      .where(inArray(skus.productId, productIds))
      .orderBy(asc(skus.id))
      .for('update');
    if (!skuRows.some((row) => row.id === source.skuId)) throw new CatalogEditError('CONFLICT');
  }

  private signImpact(
    actorId: string,
    storeId: string,
    skuId: string,
    input: StoreCatalogEditRequest,
    impact: { sharedFields: string[]; affectedStoreIds: string[] },
    expiry = Math.floor(Date.now() / 1000) + 300,
  ): string {
    const fields = [
      'expectedProductVersion',
      'expectedBookVersion',
      'expectedEditionVersion',
      'expectedSkuVersion',
      'expectedLocalVersion',
      'productName',
      'bookTitle',
      'author',
      'publisher',
      'isbn',
      'priceMinor',
      'shelfLocation',
      'storeNote',
      'displayInfo',
    ] as const;
    const payload = JSON.stringify([
      'catalog-impact-v1',
      expiry,
      actorId,
      storeId,
      skuId,
      fields.map((field) => input[field] ?? null),
      [...impact.sharedFields].sort(),
      [...impact.affectedStoreIds].sort(),
    ]);
    const digest = createHmac('sha256', this.previewSecret).update(payload).digest('base64url');
    return `${expiry}.${digest}`;
  }

  private verifyImpact(
    token: string,
    actorId: string,
    storeId: string,
    skuId: string,
    input: StoreCatalogEditRequest,
    impact: { sharedFields: string[]; affectedStoreIds: string[] },
  ): boolean {
    if (!/^\d{10}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const expiry = Number(token.slice(0, 10));
    const now = Math.floor(Date.now() / 1000);
    if (expiry <= now || expiry > now + 300) return false;
    const expected = Buffer.from(this.signImpact(actorId, storeId, skuId, input, impact, expiry));
    const supplied = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
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

  private canonicalizeIsbn(source: Source, input: StoreCatalogEditRequest) {
    if (input.isbn === undefined) return input;
    const isbn = normalizeIsbn(input.isbn);
    if (isbn !== source.isbn && !isValidIsbn(isbn)) {
      throw new CatalogEditError('INVALID_REFERENCE');
    }
    return { ...input, isbn };
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
    const conditions = [];
    if (fields.includes('productName')) conditions.push(eq(skus.productId, source.productId));
    if (fields.includes('priceMinor')) conditions.push(eq(skus.id, source.skuId));
    // Book title and author live on books and affect every edition of that book.
    if (source.bookId && fields.some((field) => ['bookTitle', 'author'].includes(field))) {
      conditions.push(eq(bookEditions.bookId, source.bookId));
    }
    // Publisher and ISBN live on an edition and do not affect sibling editions.
    if (source.editionId && fields.some((field) => ['publisher', 'isbn'].includes(field))) {
      conditions.push(eq(products.bookEditionId, source.editionId));
    }
    if (conditions.length === 0) return [source.storeId];
    const rows = await tx
      .selectDistinct({ storeId: storeInventory.storeId })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(or(...conditions));
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
