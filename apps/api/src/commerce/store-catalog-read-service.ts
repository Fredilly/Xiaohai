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
import { storeCatalogItemSchema, storeCatalogResponseSchema } from '@xiaohai/contracts/commerce';

type Db = ReturnType<typeof createDatabase>['db'];

/** Read only. The store_inventory join is the data-scope constraint (not a display filter). */
export class StoreCatalogReadService {
  constructor(private readonly db: Db) {}

  async get(storeId: string, skuId: string) {
    // Never scan a fixed-size page: the requested SKU may be after the first
    // 1,000 rows. An exact store + SKU lookup must have no page boundary.
    const items = await this.selectItems(storeId, { skuId, offset: 0, limit: 1 });
    return items[0] ? storeCatalogItemSchema.parse(items[0]) : null;
  }

  async list(storeId: string, input: { q?: string; offset: number; limit: number }) {
    const items = await this.selectItems(storeId, { ...input, limit: input.limit + 1 });
    return storeCatalogResponseSchema.parse({
      storeId,
      offset: input.offset,
      limit: input.limit,
      hasMore: items.length > input.limit,
      items: items.slice(0, input.limit),
    });
  }

  private async selectItems(
    storeId: string,
    input: { q?: string; skuId?: string; offset: number; limit: number },
  ) {
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
          input.skuId ? eq(skus.id, input.skuId) : undefined,
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
      .limit(input.limit)
      .offset(input.offset);

    return rows.map((row) => ({
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
    }));
  }
}
