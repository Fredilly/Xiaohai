import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publicInventorySearchResponseSchema } from '@xiaohai/contracts/inventory';
import {
  bookEditions,
  books,
  createDatabase,
  franchisees,
  products,
  regions,
  skus,
  storeInventory,
  stores,
} from '@xiaohai/db';
import { buildApp } from '../src/app.js';
import { registerInventoryRoutes } from '../src/inventory/inventory-routes.js';
import { InventorySearchService } from '../src/inventory/inventory-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M13 book + store inventory PostgreSQL integration', () => {
  const service = new InventorySearchService(database!.db);

  beforeEach(async () => {
    await database!.db.delete(storeInventory);
    await database!.db.delete(skus);
    await database!.db.delete(products);
    await database!.db.delete(bookEditions);
    await database!.db.delete(books);
    await database!.db.delete(stores);
    await database!.db.delete(franchisees);
    await database!.db.delete(regions);
  });

  afterAll(async () => database?.pool.end());

  function makeApp() {
    const app = buildApp({ logger: false });
    registerInventoryRoutes(app, { inventory: service });
    return app;
  }

  async function seedInventory() {
    const [activeRegion, inactiveRegion] = await database!.db
      .insert(regions)
      .values([
        {
          code: 'M13-CD',
          name: '成都区域',
          countryCode: 'CN',
          countryName: '中国',
          displayOrder: 1,
        },
        {
          code: 'M13-OFF',
          name: '停用区域',
          countryCode: 'CN',
          countryName: '中国',
          operationalStatus: 'INACTIVE',
          displayOrder: 2,
        },
      ])
      .returning();

    const [activeFranchisee, inactiveFranchisee] = await database!.db
      .insert(franchisees)
      .values([
        {
          code: 'M13-F-ACTIVE',
          regionId: activeRegion!.id,
          name: 'M13 正常加盟商',
        },
        {
          code: 'M13-F-OFF',
          regionId: activeRegion!.id,
          name: 'M13 停用加盟商',
          operationalStatus: 'INACTIVE',
        },
      ])
      .returning();

    const [nearStore, farStore, inactiveStore, inactiveFranchiseeStore, inactiveRegionStore] =
      await database!.db
        .insert(stores)
        .values([
          {
            code: 'M13-NEAR',
            regionId: activeRegion!.id,
            franchiseeId: activeFranchisee!.id,
            name: '胖竹书店 M13 成都店',
            countryCode: 'CN',
            countryName: '中国',
            city: '成都',
            timezone: 'Asia/Shanghai',
            addressLine: '成都市测试地址 13 号',
            latitude: 30.65,
            longitude: 104.06,
            services: ['阅读', '自习'],
          },
          {
            code: 'M13-FAR',
            regionId: activeRegion!.id,
            franchiseeId: activeFranchisee!.id,
            name: '胖竹书店 M13 远端店',
            countryCode: 'CN',
            countryName: '中国',
            city: '成都',
            timezone: 'Asia/Shanghai',
            addressLine: '成都市远端测试地址',
            latitude: 31.3,
            longitude: 104.8,
            services: ['阅读'],
          },
          {
            code: 'M13-STORE-OFF',
            regionId: activeRegion!.id,
            franchiseeId: activeFranchisee!.id,
            name: '暂停营业门店',
            countryCode: 'CN',
            countryName: '中国',
            city: '成都',
            timezone: 'Asia/Shanghai',
            addressLine: '停用门店地址',
            latitude: 30.66,
            longitude: 104.07,
            operationalStatus: 'INACTIVE',
            services: [],
          },
          {
            code: 'M13-FRANCHISEE-OFF',
            regionId: activeRegion!.id,
            franchiseeId: inactiveFranchisee!.id,
            name: '停用加盟商门店',
            countryCode: 'CN',
            countryName: '中国',
            city: '成都',
            timezone: 'Asia/Shanghai',
            addressLine: '停用加盟商门店地址',
            latitude: 30.67,
            longitude: 104.08,
            services: [],
          },
          {
            code: 'M13-REGION-OFF',
            regionId: inactiveRegion!.id,
            name: '停用区域门店',
            countryCode: 'CN',
            countryName: '中国',
            city: '成都',
            timezone: 'Asia/Shanghai',
            addressLine: '停用区域门店地址',
            latitude: 30.68,
            longitude: 104.09,
            services: [],
          },
        ])
        .returning();

    const [book] = await database!.db
      .insert(books)
      .values({ title: '小海找书测试', author: '海老师' })
      .returning();
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({
        bookId: book!.id,
        isbn: '9787300000013',
        publisher: '胖竹出版社',
      })
      .returning();
    const [product, inactiveProduct] = await database!.db
      .insert(products)
      .values([
        {
          bookEditionId: edition!.id,
          name: '小海找书标准版',
          status: 'ACTIVE',
        },
        {
          bookEditionId: edition!.id,
          name: '小海找书停用商品',
          status: 'INACTIVE',
        },
      ])
      .returning();
    const [saleSku, rentOnlySku, inactiveSku, inactiveProductSku] = await database!.db
      .insert(skus)
      .values([
        {
          productId: product!.id,
          code: 'M13-BAR-001',
          name: '标准版',
          priceMinor: 3990,
          availableForSale: true,
        },
        {
          productId: product!.id,
          code: 'M13-BAR-RENT',
          name: '馆藏版',
          priceMinor: 0,
          availableForSale: false,
        },
        {
          productId: product!.id,
          code: 'M13-BAR-SKU-OFF',
          name: '停用 SKU',
          priceMinor: 3990,
          status: 'INACTIVE',
        },
        {
          productId: inactiveProduct!.id,
          code: 'M13-BAR-PRODUCT-OFF',
          name: '停用商品 SKU',
          priceMinor: 3990,
        },
      ])
      .returning();

    await database!.db.insert(storeInventory).values([
      {
        storeId: nearStore!.id,
        skuId: saleSku!.id,
        onHand: 5,
        reserved: 1,
        rentalReserved: 1,
      },
      { storeId: farStore!.id, skuId: saleSku!.id, onHand: 2 },
      { storeId: nearStore!.id, skuId: rentOnlySku!.id, onHand: 4 },
      { storeId: inactiveStore!.id, skuId: saleSku!.id, onHand: 9 },
      { storeId: inactiveFranchiseeStore!.id, skuId: saleSku!.id, onHand: 9 },
      { storeId: inactiveRegionStore!.id, skuId: saleSku!.id, onHand: 9 },
      { storeId: nearStore!.id, skuId: inactiveSku!.id, onHand: 9 },
      { storeId: nearStore!.id, skuId: inactiveProductSku!.id, onHand: 9 },
    ]);

    return {
      activeRegion: activeRegion!,
      nearStore: nearStore!,
      saleSku: saleSku!,
    };
  }

  async function search(qs: string) {
    const app = makeApp();
    const response = await app.inject({ method: 'GET', url: `/api/v1/inventory/books${qs}` });
    await app.close();
    expect(response.statusCode).toBe(200);
    return publicInventorySearchResponseSchema.parse(response.json());
  }

  it('searches title, author, publisher, ISBN and SKU code while hiding inactive hierarchy/catalog rows', async () => {
    await seedInventory();

    for (const query of ['小海找书测试', '海老师', '胖竹出版社', '9787300000013', 'M13-BAR-001']) {
      const result = await search(`?q=${encodeURIComponent(query)}`);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every((item) => item.store.name.includes('暂停') === false)).toBe(true);
      expect(result.items.every((item) => item.store.name.includes('停用') === false)).toBe(true);
      expect(result.items.every((item) => item.sku.code.includes('OFF') === false)).toBe(true);
    }
  });

  it('derives available stock and filters sale versus rental discovery', async () => {
    const seeded = await seedInventory();

    const sale = await search('?availability=SALE');
    expect(sale.items).toHaveLength(2);
    expect(sale.items.every((item) => item.sellAvailable)).toBe(true);

    const rent = await search('?availability=RENT');
    expect(rent.items).toHaveLength(3);
    expect(rent.items.every((item) => item.rentAvailable)).toBe(true);

    const nearSale = sale.items.find(
      (item) => item.store.id === seeded.nearStore.id && item.sku.id === seeded.saleSku.id,
    );
    expect(nearSale?.stock).toMatchObject({
      onHand: 5,
      reserved: 1,
      rentalReserved: 1,
      available: 3,
    });
  });

  it('enforces nearby radius ordering and bounded limits', async () => {
    await seedInventory();

    const nearby = await search(
      '?q=M13-BAR-001&latitude=30.65&longitude=104.06&radiusKm=10&limit=10',
    );
    expect(nearby.items).toHaveLength(1);
    expect(nearby.items[0]!.store.code).toBe('M13-NEAR');
    expect(nearby.items[0]!.store.distanceKm).toBeTypeOf('number');

    const limited = await search('?limit=1');
    expect(limited.items).toHaveLength(1);

    const app = makeApp();
    const invalid = await app.inject({ method: 'GET', url: '/api/v1/inventory/books?limit=101' });
    await app.close();
    expect(invalid.statusCode).toBe(400);
  });

  it('enforces store inventory database invariants', async () => {
    const seeded = await seedInventory();

    await expect(
      database!.db
        .update(storeInventory)
        .set({ onHand: -1 })
        .where(
          and(
            eq(storeInventory.storeId, seeded.nearStore.id),
            eq(storeInventory.skuId, seeded.saleSku.id),
          ),
        ),
    ).rejects.toBeDefined();

    await expect(
      database!.db
        .update(storeInventory)
        .set({ onHand: 2, reserved: 2, rentalReserved: 1 })
        .where(
          and(
            eq(storeInventory.storeId, seeded.nearStore.id),
            eq(storeInventory.skuId, seeded.saleSku.id),
          ),
        ),
    ).rejects.toBeDefined();
  });
});
