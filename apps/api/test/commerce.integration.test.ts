import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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
  referralAttributions,
  referralLinks,
  skus,
  storeInventory,
  userAddresses,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { CommissionService } from '../src/commission/commission-service.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';
const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;
suite('M5 Commerce PostgreSQL integration', () => {
  const commission = new CommissionService(database!.db);
  const commerce = new CommerceService(database!.db, commission);
  beforeEach(async () => {
    await database!.db.delete(referralAttributions);
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
    await database!.db.delete(referralLinks);
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
  it('preserves every concurrent first-time add to the same SKU', async () => {
    const user = await consumer();
    const skuId = await sku();

    await Promise.all(Array.from({ length: 12 }, () => commerce.addCartItem(user, skuId, 1)));

    const cart = await commerce.getCart(user);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.quantity).toBe(12);
    expect(cart.subtotalMinor).toBe(30000);

    const [storedCart] = await database!.db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.consumerUserId, user));
    expect(
      await database!.db.select().from(cartItems).where(eq(cartItems.cartId, storedCart!.id)),
    ).toHaveLength(1);
  });

  it('rejects concurrent additions that would exceed 99 without losing updates', async () => {
    const user = await consumer();
    const skuId = await sku();
    await commerce.addCartItem(user, skuId, 98);

    const results = await Promise.allSettled([
      commerce.addCartItem(user, skuId, 1),
      commerce.addCartItem(user, skuId, 1),
    ]);

    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((item) => item.status === 'rejected');
    expect(failure).toMatchObject({
      status: 'rejected',
      reason: { code: 'CONFLICT' },
    });
    expect((await commerce.getCart(user)).items[0]?.quantity).toBe(99);

    await expect(commerce.addCartItem(user, skuId, 1)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await commerce.getCart(user)).items[0]?.quantity).toBe(99);
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
  it('creates only one legacy order for concurrent distinct keys on the same cart', async () => {
    const user = await consumer();
    const skuId = await sku(2500);
    const addr = await address(user);
    await commerce.addCartItem(user, skuId, 2);

    const results = await Promise.allSettled([
      commerce.createOrder(user, addr.id, 'parallel-legacy-key-a'),
      commerce.createOrder(user, addr.id, 'parallel-legacy-key-b'),
    ]);
    const completed = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.find((result) => result.status === 'rejected');
    expect(completed).toHaveLength(1);
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'CONFLICT' },
    });

    const saved = await database!.db.select().from(orders).where(eq(orders.consumerUserId, user));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      status: 'UNPAID',
      totalMinor: 5000,
    });
    const items = await database!.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, saved[0]!.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      quantity: 2,
      unitPriceMinor: 2500,
      lineTotalMinor: 5000,
    });
    expect((await commerce.getCart(user)).items).toHaveLength(0);
  });

  it('replays concurrent identical legacy checkout keys without a second order', async () => {
    const user = await consumer();
    const skuId = await sku();
    const addr = await address(user);
    await commerce.addCartItem(user, skuId, 1);

    const [first, second] = await Promise.all([
      commerce.createOrder(user, addr.id, 'parallel-legacy-same-key'),
      commerce.createOrder(user, addr.id, 'parallel-legacy-same-key'),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.totalMinor).toBe(2500);
    expect(second.totalMinor).toBe(2500);

    const saved = await database!.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.consumerUserId, user));
    expect(saved).toHaveLength(1);
    expect(
      await database!.db.select().from(orderItems).where(eq(orderItems.orderId, first.id)),
    ).toHaveLength(1);
    expect((await commerce.getCart(user)).items).toHaveLength(0);
  });

  it('does not block checkout for invalid, disabled, or self referral codes', async () => {
    const buyer = await consumer(),
      other = await consumer(),
      skuId = await sku(),
      addr = await address(buyer);

    await commerce.addCartItem(buyer, skuId, 1);
    const invalidOrder = await commerce.createOrder(
      buyer,
      addr.id,
      'request-referral-invalid',
      'INVALID01',
    );
    expect(invalidOrder.status).toBe('UNPAID');

    const disabledLink = await commission.createReferralLink(other, 'disabled');
    await database!.db
      .update(referralLinks)
      .set({ status: 'DISABLED' })
      .where(eq(referralLinks.id, disabledLink.id));

    await commerce.addCartItem(buyer, skuId, 1);
    const disabledOrder = await commerce.createOrder(
      buyer,
      addr.id,
      'request-referral-disabled',
      disabledLink.code,
    );
    expect(disabledOrder.status).toBe('UNPAID');

    const selfLink = await commission.createReferralLink(buyer, 'self');
    await commerce.addCartItem(buyer, skuId, 1);
    const selfOrder = await commerce.createOrder(
      buyer,
      addr.id,
      'request-referral-self',
      selfLink.code,
    );
    expect(selfOrder.status).toBe('UNPAID');

    expect(await database!.db.select().from(referralAttributions)).toHaveLength(0);
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
