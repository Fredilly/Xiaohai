import { createHmac, timingSafeEqual } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  bookEditions,
  books,
  products,
  skus,
  storeInventory,
  type createDatabase,
} from '@xiaohai/db';
import type { AdminProductUpdateInput } from '@xiaohai/contracts/commerce';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Context = Db | Tx;

export type LegacyImpact = {
  bookId: string | null;
  editionId: string | null;
  affectedStoreIds: string[];
};

/**
 * The legacy HQ PUT must honor the same affected-book serialization boundary
 * as the cross-store editor. Lock parents before descendants, including sibling
 * editions/products/SKUs, so a concurrent FK inventory link cannot change the
 * impacted stores between the final recheck and COMMIT.
 */
export async function legacyCatalogImpact(
  db: Context,
  productId: string,
  skuId: string,
  lock = false,
): Promise<LegacyImpact | null> {
  const [source] = await db
    .select({ id: products.id, bookEditionId: products.bookEditionId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!source) return null;
  const [edition] = source.bookEditionId
    ? await db
        .select({ bookId: bookEditions.bookId })
        .from(bookEditions)
        .where(eq(bookEditions.id, source.bookEditionId))
        .limit(1)
    : [];
  if (source.bookEditionId && !edition) return null;
  const bookId = edition?.bookId ?? null;

  if (lock) {
    let productIds: string[];
    if (bookId) {
      const lockedBooks = await db
        .select({ id: books.id })
        .from(books)
        .where(eq(books.id, bookId))
        .for('update');
      if (!lockedBooks.length) return null;
      const editionRows = await db
        .select({ id: bookEditions.id })
        .from(bookEditions)
        .where(eq(bookEditions.bookId, bookId))
        .orderBy(asc(bookEditions.id))
        .for('update');
      const editionIds = editionRows.map((row) => row.id);
      if (!editionIds.includes(source.bookEditionId!)) return null;
      const productRows = await db
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.bookEditionId, editionIds))
        .orderBy(asc(products.id))
        .for('update');
      productIds = productRows.map((row) => row.id);
    } else {
      const productRows = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .for('update');
      productIds = productRows.map((row) => row.id);
    }
    if (!productIds.includes(productId)) return null;
    const skuRows = await db
      .select({ id: skus.id })
      .from(skus)
      .where(inArray(skus.productId, productIds))
      .orderBy(asc(skus.id))
      .for('update');
    if (!skuRows.some((row) => row.id === skuId)) return null;

    // A parent association may have changed before the lock was acquired.
    const [rechecked] = await db
      .select({ bookEditionId: products.bookEditionId })
      .from(products)
      .where(eq(products.id, productId));
    if (rechecked?.bookEditionId !== source.bookEditionId) return null;
  }

  const links = bookId
    ? await db
        .selectDistinct({ storeId: storeInventory.storeId })
        .from(storeInventory)
        .innerJoin(skus, eq(skus.id, storeInventory.skuId))
        .innerJoin(products, eq(products.id, skus.productId))
        .innerJoin(bookEditions, eq(bookEditions.id, products.bookEditionId))
        .where(eq(bookEditions.bookId, bookId))
    : await db
        .selectDistinct({ storeId: storeInventory.storeId })
        .from(storeInventory)
        .innerJoin(skus, eq(skus.id, storeInventory.skuId))
        .where(inArray(skus.productId, [productId]));
  return {
    bookId,
    editionId: source.bookEditionId,
    affectedStoreIds: links.map((row) => row.storeId).sort(),
  };
}

function digest(
  secret: string,
  expiresAt: number,
  actorId: string,
  productId: string,
  skuId: string,
  input: AdminProductUpdateInput,
  impact: LegacyImpact,
) {
  return createHmac('sha256', secret)
    .update(
      JSON.stringify([
        'hq-legacy-catalog-impact-v1',
        expiresAt,
        actorId,
        productId,
        skuId,
        input,
        impact.bookId,
        impact.editionId,
        impact.affectedStoreIds,
      ]),
    )
    .digest('hex');
}

export function signLegacyPreview(
  secret: string,
  actorId: string,
  productId: string,
  skuId: string,
  input: AdminProductUpdateInput,
  impact: LegacyImpact,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  return `${expiresAt}.${digest(secret, expiresAt, actorId, productId, skuId, input, impact)}`;
}

export function verifyLegacyPreview(
  secret: string,
  token: string | undefined,
  actorId: string,
  productId: string,
  skuId: string,
  input: AdminProductUpdateInput,
  impact: LegacyImpact,
): boolean {
  if (!token || !/^\d{10}\.[0-9a-f]{64}$/.test(token)) return false;
  const expiresAt = Number(token.slice(0, 10));
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt <= now || expiresAt > now + 300) return false;
  const received = Buffer.from(token.slice(11), 'hex');
  const expected = Buffer.from(
    digest(secret, expiresAt, actorId, productId, skuId, input, impact),
    'hex',
  );
  return received.length === expected.length && timingSafeEqual(received, expected);
}
