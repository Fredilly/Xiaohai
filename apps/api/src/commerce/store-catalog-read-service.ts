import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { bookEditions, books, products, skus, storeInventory, type createDatabase } from '@xiaohai/db';
import { storeCatalogResponseSchema } from '@xiaohai/contracts/commerce';

type Db = ReturnType<typeof createDatabase>['db'];

/** Read only. The store_inventory join is the data-scope constraint (not a display filter). */
export class StoreCatalogReadService {
  constructor(private readonly db: Db) {}

  async list(storeId: string, input: { q?: string; offset: number; limit: number }) {
    const rows = await this.db
      .select({
        storeId: storeInventory.storeId,
        productId: products.id,
        productName: products.name,
        productStatus: products.status,
        coverUrl: products.coverUrl,
        bookTitle: books.title,
        author: books.author,
        isbn: bookEditions.isbn,
        publisher: bookEditions.publisher,
        skuId: skus.id,
        skuCode: skus.code,
        skuName: skus.name,
        skuStatus: skus.status,
        priceMinor: skus.priceMinor,
        availableForSale: skus.availableForSale,
        onHand: storeInventory.onHand,
        reserved: storeInventory.reserved,
        rentalReserved: storeInventory.rentalReserved,
        inventoryVersion: storeInventory.version,
      })
      .from(storeInventory)
      .innerJoin(skus, eq(storeInventory.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(
        and(
          eq(storeInventory.storeId, storeId),
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
        available: Math.max(0, row.onHand - row.reserved - row.rentalReserved),
      })),
    });
  }
}
