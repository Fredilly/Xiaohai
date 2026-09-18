import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { AddressInput, AdminProductInput, CartResponse } from '@xiaohai/contracts/commerce';
import {
  bookEditions,
  books,
  cartItems,
  carts,
  deliveries,
  deliveryEvents,
  orderItems,
  orders,
  pickupCodes,
  products,
  skus,
  storeInventory,
  userAddresses,
} from '@xiaohai/db';
import type { createDatabase } from '@xiaohai/db';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export interface ReferralAttributionWriter {
  attributeOrder(tx: Tx, orderId: string, consumerUserId: string, code?: string): Promise<void>;
}
export class CommerceError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'NOT_PURCHASABLE' | 'INVALID_ORDER_STATE',
    message: string,
  ) {
    super(message);
  }
}

export class CommerceService {
  constructor(
    private readonly db: Db,
    private readonly referrals?: ReferralAttributionWriter,
  ) {}

  async attributeReferral(tx: Tx, orderId: string, consumerUserId: string, referralCode?: string) {
    await this.referrals?.attributeOrder(tx, orderId, consumerUserId, referralCode);
  }

  async listCatalog(q?: string) {
    const rows = await this.db
      .select({ product: products, sku: skus, book: books, edition: bookEditions })
      .from(products)
      .innerJoin(skus, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(
        and(
          eq(products.status, 'ACTIVE'),
          eq(skus.status, 'ACTIVE'),
          q
            ? or(
                ilike(products.name, `%${q}%`),
                ilike(books.title, `%${q}%`),
                ilike(books.author, `%${q}%`),
                ilike(bookEditions.isbn, `%${q}%`),
              )
            : undefined,
        ),
      );
    return { products: groupCatalog(rows) };
  }

  async getProduct(id: string) {
    const result = await this.listCatalog();
    const product = result.products.find((item) => item.id === id);
    if (!product) throw new CommerceError('NOT_FOUND', 'Product not found');
    return product;
  }

  private async getCartId(consumerUserId: string) {
    const [existing] = await this.db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.consumerUserId, consumerUserId));
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(carts)
      .values({ consumerUserId })
      .onConflictDoNothing()
      .returning({ id: carts.id });
    if (created) return created.id;
    const [resolved] = await this.db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.consumerUserId, consumerUserId));
    return resolved!.id;
  }

  async getCart(consumerUserId: string): Promise<CartResponse> {
    const cartId = await this.getCartId(consumerUserId);
    const rows = await this.db
      .select({ item: cartItems, sku: skus, product: products })
      .from(cartItems)
      .innerJoin(skus, eq(cartItems.skuId, skus.id))
      .innerJoin(products, eq(skus.productId, products.id))
      .where(eq(cartItems.cartId, cartId));
    const items = rows.map(({ item, sku, product }) => ({
      id: item.id,
      skuId: sku.id,
      productName: product.name,
      skuName: sku.name,
      unitPriceMinor: sku.priceMinor,
      quantity: item.quantity,
      lineTotalMinor: sku.priceMinor * item.quantity,
      availableForSale:
        product.status === 'ACTIVE' && sku.status === 'ACTIVE' && sku.availableForSale,
    }));
    return { items, subtotalMinor: items.reduce((sum, item) => sum + item.lineTotalMinor, 0) };
  }

  async addCartItem(consumerUserId: string, skuId: string, quantity: number) {
    const cartId = await this.getCartId(consumerUserId);
    await this.requirePurchasableSku(skuId);
    const [existing] = await this.db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.skuId, skuId)));
    const next = (existing?.quantity ?? 0) + quantity;
    if (next > 99) throw new CommerceError('CONFLICT', 'Cart quantity exceeds limit');
    if (existing)
      await this.db
        .update(cartItems)
        .set({ quantity: next, updatedAt: new Date() })
        .where(eq(cartItems.id, existing.id));
    else await this.db.insert(cartItems).values({ cartId, skuId, quantity });
    return this.getCart(consumerUserId);
  }

  async updateCartItem(consumerUserId: string, itemId: string, quantity: number) {
    const cartId = await this.getCartId(consumerUserId);
    const [item] = await this.db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));
    if (!item) throw new CommerceError('NOT_FOUND', 'Cart item not found');
    await this.requirePurchasableSku(item.skuId);
    await this.db
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, itemId));
    return this.getCart(consumerUserId);
  }

  async deleteCartItem(consumerUserId: string, itemId: string) {
    const cartId = await this.getCartId(consumerUserId);
    const deleted = await this.db
      .delete(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .returning({ id: cartItems.id });
    if (!deleted.length) throw new CommerceError('NOT_FOUND', 'Cart item not found');
  }

  async listAddresses(consumerUserId: string) {
    return {
      addresses: await this.db
        .select({
          id: userAddresses.id,
          recipientName: userAddresses.recipientName,
          phone: userAddresses.phone,
          region: userAddresses.region,
          city: userAddresses.city,
          district: userAddresses.district,
          addressLine: userAddresses.addressLine,
          postalCode: userAddresses.postalCode,
          isDefault: userAddresses.isDefault,
        })
        .from(userAddresses)
        .where(eq(userAddresses.consumerUserId, consumerUserId)),
    };
  }
  async createAddress(consumerUserId: string, input: AddressInput) {
    return this.db.transaction(async (tx) => {
      if (input.isDefault)
        await tx
          .update(userAddresses)
          .set({ isDefault: false })
          .where(eq(userAddresses.consumerUserId, consumerUserId));
      const [row] = await tx
        .insert(userAddresses)
        .values({ consumerUserId, ...input })
        .returning();
      return row!;
    });
  }
  async updateAddress(consumerUserId: string, id: string, input: AddressInput) {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: userAddresses.id })
        .from(userAddresses)
        .where(and(eq(userAddresses.id, id), eq(userAddresses.consumerUserId, consumerUserId)));
      if (!owned) throw new CommerceError('NOT_FOUND', 'Address not found');
      if (input.isDefault)
        await tx
          .update(userAddresses)
          .set({ isDefault: false })
          .where(eq(userAddresses.consumerUserId, consumerUserId));
      const [row] = await tx
        .update(userAddresses)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(userAddresses.id, id))
        .returning();
      return row!;
    });
  }
  async deleteAddress(consumerUserId: string, id: string) {
    const rows = await this.db
      .delete(userAddresses)
      .where(and(eq(userAddresses.id, id), eq(userAddresses.consumerUserId, consumerUserId)))
      .returning({ id: userAddresses.id });
    if (!rows.length) throw new CommerceError('NOT_FOUND', 'Address not found');
  }

  async checkoutPreview(consumerUserId: string, addressId: string) {
    const cart = await this.getCart(consumerUserId);
    if (!cart.items.length) throw new CommerceError('CONFLICT', 'Cart is empty');
    if (cart.items.some((item) => !item.availableForSale))
      throw new CommerceError('NOT_PURCHASABLE', 'Cart contains unavailable SKU');
    const address = await this.requireAddress(consumerUserId, addressId);
    return {
      cart,
      address,
      subtotalMinor: cart.subtotalMinor,
      totalMinor: cart.subtotalMinor,
      paymentAvailable: false as const,
      paymentMessage: '创建订单后可在详情页申请微信支付，需服务端商户配置。',
    };
  }

  async createOrder(
    consumerUserId: string,
    addressId: string,
    clientRequestId: string,
    referralCode?: string,
  ) {
    const [existing] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(eq(orders.consumerUserId, consumerUserId), eq(orders.clientRequestId, clientRequestId)),
      );
    if (existing) return this.getOrder(consumerUserId, existing.id);
    const preview = await this.checkoutPreview(consumerUserId, addressId);
    const cartId = await this.getCartId(consumerUserId);
    return this.db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          consumerUserId,
          orderNumber: `XH${Date.now()}${randomUUID().slice(0, 8)}`,
          status: 'UNPAID',
          subtotalMinor: preview.subtotalMinor,
          totalMinor: preview.totalMinor,
          addressSnapshot: snapshotAddress(preview.address),
          clientRequestId,
        })
        .returning();
      const insertedItems = await tx
        .insert(orderItems)
        .values(
          preview.cart.items.map((item) => ({
            orderId: order!.id,
            skuId: item.skuId,
            productNameSnapshot: item.productName,
            skuNameSnapshot: item.skuName,
            skuCodeSnapshot: '',
            unitPriceMinor: item.unitPriceMinor,
            quantity: item.quantity,
            lineTotalMinor: item.lineTotalMinor,
          })),
        )
        .returning();
      await this.attributeReferral(tx, order!.id, consumerUserId, referralCode);
      await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
      const address = order!.addressSnapshot as ReturnType<typeof snapshotAddress>;
      return {
        id: order!.id,
        orderNumber: order!.orderNumber,
        status: order!.status,
        subtotalMinor: order!.subtotalMinor,
        totalMinor: order!.totalMinor,
        address,
        items: insertedItems.map((item) => ({
          id: item.id,
          productName: item.productNameSnapshot,
          skuName: item.skuNameSnapshot,
          skuCode: item.skuCodeSnapshot,
          unitPriceMinor: item.unitPriceMinor,
          quantity: item.quantity,
          lineTotalMinor: item.lineTotalMinor,
        })),
        createdAt: order!.createdAt.toISOString(),
      };
    });
  }

  async listOrders(consumerUserId: string) {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.consumerUserId, consumerUserId))
      .orderBy(desc(orders.createdAt));
    return { orders: await Promise.all(rows.map((row) => this.getOrder(consumerUserId, row.id))) };
  }
  async getOrder(consumerUserId: string, id: string) {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.consumerUserId, consumerUserId)));
    if (!order) throw new CommerceError('NOT_FOUND', 'Order not found');
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, id));
    const address = order.addressSnapshot as ReturnType<typeof snapshotAddress> | null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      subtotalMinor: order.subtotalMinor,
      totalMinor: order.totalMinor,
      address,
      items: items.map((item) => ({
        id: item.id,
        productName: item.productNameSnapshot,
        skuName: item.skuNameSnapshot,
        skuCode: item.skuCodeSnapshot,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
      })),
      createdAt: order.createdAt.toISOString(),
    };
  }
  async cancelOrder(consumerUserId: string, id: string) {
    await this.db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, id), eq(orders.consumerUserId, consumerUserId)))
        .for('update');
      if (!order) throw new CommerceError('NOT_FOUND', 'Order not found');
      if (order.status !== 'UNPAID')
        throw new CommerceError('INVALID_ORDER_STATE', 'Only unpaid orders can be cancelled');

      const [pickupReservation] = await tx
        .select({ storeId: pickupCodes.storeId })
        .from(pickupCodes)
        .where(eq(pickupCodes.orderId, id))
        .limit(1);
      const [deliveryReservation] = await tx
        .select({ storeId: deliveries.storeId })
        .from(deliveries)
        .where(eq(deliveries.orderId, id))
        .limit(1);
      const reservationStoreId = pickupReservation?.storeId ?? deliveryReservation?.storeId ?? null;
      if (order.fulfillmentFingerprint && !reservationStoreId)
        throw new CommerceError('CONFLICT', 'Fulfillment reservation store is missing');

      if (reservationStoreId) {
        const items = await tx
          .select({ skuId: orderItems.skuId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, id))
          .orderBy(asc(orderItems.skuId));
        for (const item of items) {
          await tx.execute(
            sql`select 1 from store_inventory where store_id=${reservationStoreId} and sku_id=${item.skuId} for update`,
          );
          const [balance] = await tx
            .select()
            .from(storeInventory)
            .where(
              and(
                eq(storeInventory.storeId, reservationStoreId),
                eq(storeInventory.skuId, item.skuId),
              ),
            )
            .limit(1);
          if (!balance || balance.reserved < item.quantity)
            throw new CommerceError('CONFLICT', 'Fulfillment reservation is missing');
          await tx
            .update(storeInventory)
            .set({
              reserved: balance.reserved - item.quantity,
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(storeInventory.storeId, reservationStoreId),
                eq(storeInventory.skuId, item.skuId),
                eq(storeInventory.version, balance.version),
              ),
            );
        }
      }

      const now = new Date();
      await tx
        .update(pickupCodes)
        .set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now })
        .where(and(eq(pickupCodes.orderId, id), eq(pickupCodes.status, 'ISSUED')));
      const [delivery] = await tx
        .update(deliveries)
        .set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now })
        .where(and(eq(deliveries.orderId, id), eq(deliveries.status, 'PENDING')))
        .returning({ id: deliveries.id });
      if (delivery)
        await tx.insert(deliveryEvents).values({
          deliveryId: delivery.id,
          eventType: 'CANCELLED',
          actorType: 'SYSTEM',
          idempotencyKey: `delivery-cancelled:${id}`,
        });
      await tx
        .update(orders)
        .set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now })
        .where(and(eq(orders.id, id), eq(orders.status, 'UNPAID')));
    });
    return this.getOrder(consumerUserId, id);
  }

  async listAdminProducts(q?: string, status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE') {
    const rows = await this.db
      .select({ product: products, sku: skus, book: books, edition: bookEditions })
      .from(products)
      .innerJoin(skus, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(
        and(
          status ? eq(products.status, status) : undefined,
          q ? ilike(products.name, `%${q}%`) : undefined,
        ),
      );
    return {
      products: rows.map(({ product, sku, book, edition }) => ({
        id: product.id,
        skuId: sku.id,
        name: product.name,
        description: product.description,
        coverUrl: product.coverUrl,
        status: product.status as 'DRAFT' | 'ACTIVE' | 'INACTIVE',
        book: book
          ? {
              title: book.title,
              author: book.author,
              isbn: edition?.isbn ?? null,
              publisher: edition?.publisher ?? null,
            }
          : null,
        sku: {
          code: sku.code,
          name: sku.name,
          priceMinor: sku.priceMinor,
          status: sku.status as 'ACTIVE' | 'INACTIVE',
          availableForSale: sku.availableForSale,
        },
      })),
    };
  }
  async createAdminProduct(input: AdminProductInput) {
    return this.db.transaction(async (tx) => {
      let editionId: string | null = null;
      if (input.book) {
        const [book] = await tx
          .insert(books)
          .values({
            title: input.book.title,
            author: input.book.author,
            description: input.description ?? null,
          })
          .returning({ id: books.id });
        const [edition] = await tx
          .insert(bookEditions)
          .values({
            bookId: book!.id,
            isbn: input.book.isbn ?? null,
            publisher: input.book.publisher ?? null,
          })
          .returning({ id: bookEditions.id });
        editionId = edition!.id;
      }
      const [product] = await tx
        .insert(products)
        .values({
          bookEditionId: editionId,
          name: input.name,
          description: input.description ?? null,
          coverUrl: input.coverUrl ?? null,
          status: input.status,
        })
        .returning({ id: products.id });
      await tx.insert(skus).values({ productId: product!.id, ...input.sku });
      return (await this.listAdminProducts()).products.find((item) => item.id === product!.id)!;
    });
  }
  async updateAdminProduct(id: string, input: AdminProductInput) {
    const current = (await this.listAdminProducts()).products.find((item) => item.id === id);
    if (!current) throw new CommerceError('NOT_FOUND', 'Product not found');
    await this.db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({
          name: input.name,
          description: input.description ?? null,
          coverUrl: input.coverUrl ?? null,
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id));
      await tx
        .update(skus)
        .set({ ...input.sku, updatedAt: new Date() })
        .where(eq(skus.id, current.skuId));
    });
    return (await this.listAdminProducts()).products.find((item) => item.id === id)!;
  }

  private async requirePurchasableSku(id: string) {
    const [row] = await this.db
      .select({ sku: skus, product: products })
      .from(skus)
      .innerJoin(products, eq(skus.productId, products.id))
      .where(eq(skus.id, id));
    if (!row) throw new CommerceError('NOT_FOUND', 'SKU not found');
    if (row.product.status !== 'ACTIVE' || row.sku.status !== 'ACTIVE' || !row.sku.availableForSale)
      throw new CommerceError('NOT_PURCHASABLE', 'SKU is not purchasable');
    return row;
  }
  private async requireAddress(consumerUserId: string, id: string) {
    const [row] = await this.db
      .select({
        id: userAddresses.id,
        recipientName: userAddresses.recipientName,
        phone: userAddresses.phone,
        region: userAddresses.region,
        city: userAddresses.city,
        district: userAddresses.district,
        addressLine: userAddresses.addressLine,
        postalCode: userAddresses.postalCode,
        isDefault: userAddresses.isDefault,
      })
      .from(userAddresses)
      .where(and(eq(userAddresses.id, id), eq(userAddresses.consumerUserId, consumerUserId)));
    if (!row) throw new CommerceError('NOT_FOUND', 'Address not found');
    return row;
  }
}

function snapshotAddress(address: {
  recipientName: string;
  phone: string;
  region: string;
  city: string;
  district: string;
  addressLine: string;
  postalCode: string | null;
}) {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    region: address.region,
    city: address.city,
    district: address.district,
    addressLine: address.addressLine,
    postalCode: address.postalCode,
  };
}
function groupCatalog(
  rows: Array<{
    product: typeof products.$inferSelect;
    sku: typeof skus.$inferSelect;
    book: typeof books.$inferSelect | null;
    edition: typeof bookEditions.$inferSelect | null;
  }>,
) {
  const map = new Map<
    string,
    {
      id: string;
      name: string;
      description: string | null;
      coverUrl: string | null;
      title: string | null;
      author: string | null;
      isbn: string | null;
      publisher: string | null;
      skus: Array<{
        id: string;
        code: string;
        name: string;
        priceMinor: number;
        availableForSale: boolean;
      }>;
    }
  >();
  for (const { product, sku, book, edition } of rows) {
    const item = map.get(product.id) ?? {
      id: product.id,
      name: product.name,
      description: product.description,
      coverUrl: product.coverUrl,
      title: book?.title ?? null,
      author: book?.author ?? null,
      isbn: edition?.isbn ?? null,
      publisher: edition?.publisher ?? null,
      skus: [],
    };
    item.skus.push({
      id: sku.id,
      code: sku.code,
      name: sku.name,
      priceMinor: sku.priceMinor,
      availableForSale: sku.availableForSale,
    });
    map.set(product.id, item);
  }
  return [...map.values()];
}
