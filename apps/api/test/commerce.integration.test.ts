import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bookEditions,
  books,
  cartItems,
  carts,
  consumerUsers,
  createDatabase,
  orderItems,
  orders,
  products,
  skus,
  userAddresses,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
const database = process.env.DATABASE_URL ? createDatabase(process.env) : null;
const suite = database ? describe : describe.skip;
suite('M5 Commerce PostgreSQL integration', () => {
  const commerce = new CommerceService(database!.db);
  beforeEach(async () => {
    await database!.db.delete(orderItems);
    await database!.db.delete(orders);
    await database!.db.delete(cartItems);
    await database!.db.delete(carts);
    await database!.db.delete(userAddresses);
    await database!.db.delete(skus);
    await database!.db.delete(products);
    await database!.db.delete(bookEditions);
    await database!.db.delete(books);
    await database!.db.delete(consumerUsers);
  });
  afterAll(async () => database?.pool.end());
  async function consumer() {
    const [u] = await database!.db
      .insert(consumerUsers)
      .values({})
      .returning({ id: consumerUsers.id });
    return u!.id;
  }
  async function sku(price = 2500, available = true) {
    const [b] = await database!.db
      .insert(books)
      .values({ title: 'Test Book', author: 'Author' })
      .returning({ id: books.id });
    const [e] = await database!.db
      .insert(bookEditions)
      .values({ bookId: b!.id, isbn: `isbn-${Math.random()}` })
      .returning({ id: bookEditions.id });
    const [p] = await database!.db
      .insert(products)
      .values({ bookEditionId: e!.id, name: 'Server Product', status: 'ACTIVE' })
      .returning({ id: products.id });
    const [s] = await database!.db
      .insert(skus)
      .values({
        productId: p!.id,
        code: `sku-${Math.random()}`,
        name: 'Standard',
        priceMinor: price,
        availableForSale: available,
      })
      .returning({ id: skus.id });
    return s!.id;
  }
  async function address(user: string) {
    return commerce.createAddress(user, {
      recipientName: 'A',
      phone: '12345678',
      region: 'R',
      city: 'C',
      district: 'D',
      addressLine: 'Line',
      postalCode: null,
      isDefault: true,
    });
  }
  it('isolates carts and rejects unavailable SKU', async () => {
    const a = await consumer(),
      b = await consumer(),
      sellable = await sku(),
      disabled = await sku(1000, false);
    await commerce.addCartItem(a, sellable, 2);
    expect((await commerce.getCart(a)).items).toHaveLength(1);
    expect((await commerce.getCart(b)).items).toHaveLength(0);
    await expect(commerce.addCartItem(a, disabled, 1)).rejects.toMatchObject({
      code: 'NOT_PURCHASABLE',
    });
  });
  it('calculates checkout/order totals from current server SKU price and snapshots the order', async () => {
    const user = await consumer(),
      skuId = await sku(2599),
      addr = await address(user);
    await commerce.addCartItem(user, skuId, 2);
    const preview = await commerce.checkoutPreview(user, addr.id);
    expect(preview.totalMinor).toBe(5198);
    const order = await commerce.createOrder(user, addr.id, 'request-0001');
    expect(order.status).toBe('UNPAID');
    expect(order.totalMinor).toBe(5198);
    const same = await commerce.createOrder(user, addr.id, 'request-0001');
    expect(same.id).toBe(order.id);
  });
  it('isolates address/order ownership and only cancels UNPAID', async () => {
    const a = await consumer(),
      b = await consumer(),
      skuId = await sku(),
      addr = await address(a);
    await commerce.addCartItem(a, skuId, 1);
    const order = await commerce.createOrder(a, addr.id, 'request-0002');
    await expect(commerce.getOrder(b, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      commerce.updateAddress(b, addr.id, {
        recipientName: 'X',
        phone: '12345678',
        region: 'R',
        city: 'C',
        district: 'D',
        addressLine: 'X',
        isDefault: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await commerce.cancelOrder(a, order.id)).status).toBe('CANCELLED');
    await expect(commerce.cancelOrder(a, order.id)).rejects.toMatchObject({
      code: 'INVALID_ORDER_STATE',
    });
  });
});
