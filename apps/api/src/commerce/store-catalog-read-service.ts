import { and, asc, eq, ilike, or } from 'drizzle-orm';
import {
  bookEditions,
  books,
  products,
  skus,
  storeCatalogMetadata,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import { storeCatalogResponseSchema } from '@xiaohai/contracts/commerce';

type Db = ReturnType<typeof createDatabase>['db'];

/** Read only. The store_inventory join is the data-scope constraint (not a display filter). */
export class StoreCatalogReadService {
  constructor(private readonly db: Db) {}

  async get(storeId: string, skuId: string) {
    // Never search just the first 1,000 catalogue rows after an edit has
    // committed: large stores must resolve the exact scoped SKU by ID.
    const page = await this.list(storeId, { offset: 0, limit: 1, skuId });
    return page.items[0] ?? null;
  }

  async list(storeId: string, input: { q?: string; skuId?: string; offset: number; limit: number }) {
    const rows = await this.db
      .select({
        storeId: storeInventory.storeId,
        productId: products.id,
        productName: products.name,
        productStatus: products.status,
        productVersion: products.version,
        coverUrl: products.coverUrl,
        bookTitle: books.title,
        bookVersion: books.version,
        author: books.author,
        isbn: bookEditions.isbn,
        editionVersion: bookEditions.version,
        publisher: bookEditions.publisher,
        skuId: skus.id,
        skuCode: skus.code,
        skuName: skus.name,
        skuStatus: skus.status,
        skuVersion: skus.version,
        priceMinor: skus.priceMinor,
        availableForSale: skus.availableForSale,
        onHand: storeInventory.onHand,
        reserved: storeInventory.reserved,
        rentalReserved: storeInventory.rentalReserved,
        inventoryVersion: storeInventory.version,
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
      .where(
        and(
          eq(storeInventory.storeId, storeId),
          input.skuId ? eq(storeInventory.skuId, input.skuId) : undefined,
          input.q
            ? or(
                ilike(products.name, `%${input.q}%`),
                ilike(books.title, `%${input.q}%`),
                ilike(books.author, `%${input.q}%`),
                ilike(bookEditions.publisher, `%${input.q}%`),
                ilike(bookEditions.isbn, `%${input.q}%`),
                ilike(skus.code, `%${input.q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(products.name), asc(skus.code), asc(skus.id))
      .limit(input.limit + 1)
      .offset(input.offset);

    return storeCatalogResponseSchema.parse({
      storeId,
      offset: input.offset,
      limit: input.limit,
      hasMore: rows.length > input.limit,
      items: rows.slice(0, input.limit).map((row) => ({
        ...row,
        productVersion: row.productVersion ?? 0,
        bookVersion: row.bookVersion ?? 0,
        editionVersion: row.editionVersion ?? 0,
        skuVersion: row.skuVersion,
        localVersion: row.localVersion ?? 0,
        shelfLocation: row.shelfLocation ?? null,
        storeNote: row.storeNote ?? null,
        displayInfo: row.displayInfo ?? null,
        available: Math.max(0, row.onHand - row.reserved - row.rentalReserved),
      })),
    });
  }
}
