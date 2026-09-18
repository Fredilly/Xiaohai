import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookEditions,
  books,
  cartItems,
  carts,
  consumerUsers,
  createDatabase,
  deliveries,
  deliveryEvents,
  franchisees,
  inventoryTransactions,
  orderItems,
  orders,
  pickupCodes,
  products,
  regions,
  skus,
  storeInventory,
  stores,
  userAddresses,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { ManualDeliveryProvider } from '../src/fulfillment/delivery-provider.js';
import { FulfillmentService } from '../src/fulfillment/fulfillment-service.js';

const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;

suite('M16 fulfillment store inventory reservation integration', () => {
  const commerce = new CommerceService(database!.db);
  const fulfillment = new FulfillmentService(
    database!.db,
    commerce,
    'm16-reservation-test-secret-with-at-least-32-bytes',
    new ManualDeliveryProvider(),
  );

  async function clean() {
    await database!.db.delete(deliveryEvents);
    await database!.db.delete(deliveries);
    await database!.db.delete(pickupCodes);
    await database!.db.delete(inventoryTransactions);
    await database!.db.delete(orderItems);
    await database!.db.delete(orders);
    await database!.db.delete(cartItems);
    await database!.db.delete(carts);
    await database!.db.delete(userAddresses);
    await database!.db.delete(storeInventory);
    await database!.db.delete(skus);
    await database!.db.delete(products);
    await database!.db.delete(bookEditions);
    await database!.db.delete(books);
    await database!.db.delete(stores);
    await database!.db.delete(franchisees);
    await database!.db.delete(regions);
    await database!.db.delete(consumerUsers);
  }

  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await database!.pool.end();
  });

  async function seed(onHand: number) {
    const [region] = await database!.db
      .insert(regions)
      .values({
        code: `M16-RES-${crypto.randomUUID()}`,
        name: '成都库存测试区',
        countryCode: 'CN',
        countryName: '中国',
      })
      .returning();
    const [franchisee] = await database!.db
      .insert(franchisees)
      .values({
        code: `M16-RES-F-${crypto.randomUUID()}`,
        regionId: region!.id,
        name: '库存测试加盟商',
      })
      .returning();
    const [store] = await database!.db
      .insert(stores)
      .values({
        code: `M16-RES-S-${crypto.randomUUID()}`,
        regionId: region!.id,
        franchiseeId: franchisee!.id,
        name: 'M16 库存测试门店',
        countryCode: 'CN',
        countryName: '中国',
        city: '成都',
        timezone: 'Asia/Shanghai',
        addressLine: '库存测试路 1 号',
        latitude: 30.6,
        longitude: 104.1,
      })
      .returning();
    const [book] = await database!.db
      .insert(books)
      .values({ title: 'M16 库存测试书', author: '测试作者' })
      .returning();
    const [edition] = await database!.db
      .insert(bookEditions)
      .values({ bookId: book!.id, isbn: crypto.randomUUID() })
      .returning();
    const [product] = await database!.db
      .insert(products)
      .values({ bookEditionId: edition!.id, name: 'M16 库存测试书', status: 'ACTIVE' })
      .returning();
    const [sku] = await database!.db
      .insert(skus)
      .values({
        productId: product!.id,
        code: `M16-RES-SKU-${crypto.randomUUID()}`,
        name: '标准版',
        priceMinor: 3200,
      })
      .returning();
    await database!.db.insert(storeInventory).values({
      storeId: store!.id,
      skuId: sku!.id,
      onHand,
    });
    const [consumerA, consumerB] = await database!.db
      .insert(consumerUsers)
      .values([{}, {}])
      .returning();
    return { store: store!, sku: sku!, consumerA: consumerA!, consumerB: consumerB! };
  }

  async function balance(storeId: string, skuId: string) {
    const [row] = await database!.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, skuId)))
      .limit(1);
    return row!;
  }

  it('rejects zero stock at the selected store without consuming the cart', async () => {
    const d = await seed(0);
    await commerce.addCartItem(d.consumerA.id, d.sku.id, 1);

    await expect(
      fulfillment.createOrder(d.consumerA.id, {
        method: 'PICKUP',
        storeId: d.store.id,
        clientRequestId: `zero-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    expect((await balance(d.store.id, d.sku.id)).reserved).toBe(0);
    expect((await commerce.getCart(d.consumerA.id)).items).toHaveLength(1);
    expect(
      await database!.db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.consumerUserId, d.consumerA.id)),
    ).toHaveLength(0);
  });

  it('serializes concurrent orders and releases the winner reservation on cancellation', async () => {
    const d = await seed(1);
    await Promise.all([
      commerce.addCartItem(d.consumerA.id, d.sku.id, 1),
      commerce.addCartItem(d.consumerB.id, d.sku.id, 1),
    ]);

    const attempts = await Promise.allSettled([
      fulfillment.createOrder(d.consumerA.id, {
        method: 'PICKUP',
        storeId: d.store.id,
        clientRequestId: `concurrent-a-${crypto.randomUUID()}`,
      }),
      fulfillment.createOrder(d.consumerB.id, {
        method: 'PICKUP',
        storeId: d.store.id,
        clientRequestId: `concurrent-b-${crypto.randomUUID()}`,
      }),
    ]);

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const successIndex = attempts.findIndex((result) => result.status === 'fulfilled');
    const success = attempts[successIndex];
    const failure = attempts.find((result) => result.status === 'rejected');
    if (!success || success.status !== 'fulfilled' || !failure || failure.status !== 'rejected')
      throw new Error('Expected exactly one fulfilled and one rejected order');
    expect(failure.reason).toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    const reserved = await balance(d.store.id, d.sku.id);
    expect(reserved.onHand).toBe(1);
    expect(reserved.reserved).toBe(1);

    const winner = successIndex === 0 ? d.consumerA : d.consumerB;
    const loser = successIndex === 0 ? d.consumerB : d.consumerA;
    const cancelled = await commerce.cancelOrder(winner.id, success.value);
    expect(cancelled.status).toBe('CANCELLED');

    const released = await balance(d.store.id, d.sku.id);
    expect(released.onHand).toBe(1);
    expect(released.reserved).toBe(0);

    const retriedOrderId = await fulfillment.createOrder(loser.id, {
      method: 'PICKUP',
      storeId: d.store.id,
      clientRequestId: `retry-${crypto.randomUUID()}`,
    });
    expect(retriedOrderId).toBeTruthy();
    expect((await balance(d.store.id, d.sku.id)).reserved).toBe(1);
  });
});
