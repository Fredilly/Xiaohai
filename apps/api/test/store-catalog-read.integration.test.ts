import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import {
  bookEditions,
  books,
  createDatabase,
  products,
  regions,
  skus,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';

// Only create disposable fixtures in the dedicated test databases. This test
// must never seed or mutate a local development/staging/production database.
const databaseUrl = process.env.DATABASE_URL;
const database =
  databaseUrl && /^xiaohai_(test|pr155_test)$/.test(new URL(databaseUrl).pathname.slice(1))
    ? createDatabase(process.env)
    : null;
const suite = database ? describe : describe.skip;

suite('Store catalog SQL read-model PostgreSQL isolation', () => {
  const catalog = new StoreCatalogReadService(database!.db);
  const regionIds: string[] = [];
  const storeIds: string[] = [];
  const bookIds: string[] = [];
  const editionIds: string[] = [];
  const productIds: string[] = [];
  const skuIds: string[] = [];

  afterAll(async () => {
    if (!database) return;
    try {
      if (storeIds.length && skuIds.length) {
        await database.db.delete(storeInventory).where(inArray(storeInventory.storeId, storeIds));
      }
      if (skuIds.length) await database.db.delete(skus).where(inArray(skus.id, skuIds));
      if (productIds.length) {
        await database.db.delete(products).where(inArray(products.id, productIds));
      }
      if (editionIds.length) {
        await database.db.delete(bookEditions).where(inArray(bookEditions.id, editionIds));
      }
      if (bookIds.length) await database.db.delete(books).where(inArray(books.id, bookIds));
      if (storeIds.length) await database.db.delete(stores).where(inArray(stores.id, storeIds));
      if (regionIds.length) await database.db.delete(regions).where(inArray(regions.id, regionIds));
    } finally {
      await database.pool.end();
    }
  });

  it('isolates store-linked SKUs, inactive stock, search and pagination', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: 'CAT-' + suffix,
        name: 'Disposable catalog scope region',
        countryCode: 'CN',
        countryName: 'China',
      })
      .returning({ id: regions.id });
    regionIds.push(region!.id);
    const createdStores = await database!.db
      .insert(stores)
      .values(
        ['A', 'B'].map((code) => ({
          regionId: region!.id,
          code: 'CAT-' + code + '-' + suffix,
          name: 'Catalog test store ' + code,
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Disposable test only',
          latitude: 30.5,
          longitude: 104.0,
        })),
      )
      .returning({ id: stores.id });
    storeIds.push(...createdStores.map((item) => item.id));
    const [storeA, storeB] = createdStores;
    if (!storeA || !storeB) throw new Error('Failed to create isolated stores');

    const createdBooks = await database!.db
      .insert(books)
      .values(
        ['Alpha Author', 'Beta Author', 'Gamma Author', 'Delta Author'].map((author, index) => ({
          title: ['Alpha Story', 'Beta Story', 'Gamma Story', 'Delta Story'][index]!,
          author,
        })),
      )
      .returning({ id: books.id });
    bookIds.push(...createdBooks.map((item) => item.id));
    const createdEditions = await database!.db
      .insert(bookEditions)
      .values(
        createdBooks.map((book, index) => ({
          bookId: book.id,
          isbn: 'CAT-ISBN-' + index + '-' + suffix,
          publisher: 'Test Publisher ' + index,
        })),
      )
      .returning({ id: bookEditions.id });
    editionIds.push(...createdEditions.map((item) => item.id));
    const createdProducts = await database!.db
      .insert(products)
      .values(
        createdEditions.map((edition, index) => ({
          bookEditionId: edition.id,
          name: ['Alpha linked', 'Beta inactive', 'Gamma foreign', 'Delta unlinked'][index]!,
          status: index === 1 ? 'INACTIVE' : 'ACTIVE',
        })),
      )
      .returning({ id: products.id });
    productIds.push(...createdProducts.map((item) => item.id));
    const createdSkus = await database!.db
      .insert(skus)
      .values(
        createdProducts.map((product, index) => ({
          productId: product.id,
          code: 'CAT-SKU-' + index + '-' + suffix,
          name: 'Book edition ' + index,
          priceMinor: 1900 + index * 100,
          status: index === 1 ? 'INACTIVE' : 'ACTIVE',
          availableForSale: index !== 1,
        })),
      )
      .returning({ id: skus.id });
    skuIds.push(...createdSkus.map((item) => item.id));
    await database!.db.insert(storeInventory).values([
      {
        storeId: storeA.id,
        skuId: createdSkus[0]!.id,
        onHand: 5,
        reserved: 1,
        rentalReserved: 1,
        version: 3,
      },
      { storeId: storeA.id, skuId: createdSkus[1]!.id, onHand: 0, version: 2 },
      { storeId: storeB.id, skuId: createdSkus[2]!.id, onHand: 9, version: 4 },
    ]);

    const scopedA = await catalog.list(storeA.id, { offset: 0, limit: 30 });
    expect(scopedA).toMatchObject({
      storeId: storeA.id,
      offset: 0,
      limit: 30,
      hasMore: false,
    });
    expect(scopedA.items).toHaveLength(2);
    expect(scopedA.items.map((item) => item.skuId)).toEqual([
      createdSkus[0]!.id,
      createdSkus[1]!.id,
    ]);
    expect(scopedA.items[0]).toMatchObject({
      bookTitle: 'Alpha Story',
      author: 'Alpha Author',
      isbn: 'CAT-ISBN-0-' + suffix,
      onHand: 5,
      reserved: 1,
      rentalReserved: 1,
      available: 3,
      inventoryVersion: 3,
      priceMinor: 1900,
    });
    expect(scopedA.items[1]).toMatchObject({
      productStatus: 'INACTIVE',
      skuStatus: 'INACTIVE',
      onHand: 0,
      available: 0,
      inventoryVersion: 2,
      availableForSale: false,
    });
    expect(scopedA.items.every((item) => item.storeId === storeA.id)).toBe(true);

    const scopedB = await catalog.list(storeB.id, { offset: 0, limit: 30 });
    expect(scopedB.items.map((item) => item.skuId)).toEqual([createdSkus[2]!.id]);
    expect(scopedB.items[0]).toMatchObject({ storeId: storeB.id, onHand: 9, available: 9 });

    // Exact-SKU lookup is independent of sorted pagination, and remains scoped.
    expect(await catalog.get(storeA.id, createdSkus[1]!.id)).toMatchObject({
      skuId: createdSkus[1]!.id,
      storeId: storeA.id,
      onHand: 0,
    });
    expect(await catalog.get(storeA.id, createdSkus[2]!.id)).toBeNull();
    expect(await catalog.get(storeB.id, createdSkus[0]!.id)).toBeNull();

    const first = await catalog.list(storeA.id, { offset: 0, limit: 1 });
    expect(first.hasMore).toBe(true);
    expect(first.items.map((item) => item.skuId)).toEqual([createdSkus[0]!.id]);
    const next = await catalog.list(storeA.id, { offset: 1, limit: 1 });
    expect(next.hasMore).toBe(false);
    expect(next.items.map((item) => item.skuId)).toEqual([createdSkus[1]!.id]);

    const byIsbn = await catalog.list(storeA.id, {
      q: 'CAT-ISBN-1-' + suffix,
      offset: 0,
      limit: 30,
    });
    expect(byIsbn.items.map((item) => item.skuId)).toEqual([createdSkus[1]!.id]);
    const byAuthor = await catalog.list(storeA.id, { q: 'alpha author', offset: 0, limit: 30 });
    expect(byAuthor.items.map((item) => item.skuId)).toEqual([createdSkus[0]!.id]);
    const noForeign = await catalog.list(storeA.id, {
      q: 'Gamma foreign',
      offset: 0,
      limit: 30,
    });
    expect(noForeign.items).toEqual([]);
    const unlinked = await catalog.list(storeA.id, {
      q: 'Delta unlinked',
      offset: 0,
      limit: 30,
    });
    expect(unlinked.items).toEqual([]);

    const [stockAfterA, stockAfterB] = await Promise.all([
      database!.db
        .select()
        .from(storeInventory)
        .where(inArray(storeInventory.storeId, [storeA.id])),
      database!.db
        .select()
        .from(storeInventory)
        .where(inArray(storeInventory.storeId, [storeB.id])),
    ]);
    expect(stockAfterA).toHaveLength(2);
    expect(stockAfterB).toHaveLength(1);
    expect(stockAfterA.find((item) => item.skuId === createdSkus[0]!.id)).toMatchObject({
      onHand: 5,
      reserved: 1,
      rentalReserved: 1,
      version: 3,
    });
    expect(stockAfterB[0]).toMatchObject({ onHand: 9, version: 4 });
  });
});
