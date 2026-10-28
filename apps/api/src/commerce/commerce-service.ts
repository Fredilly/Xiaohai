import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type {
  AddressInput,
  AdminProductInput,
  AdminProductUpdateInput,
  CartResponse,
} from '@xiaohai/contracts/commerce';
import { isValidIsbn, normalizeIsbn } from '@xiaohai/contracts/commerce';
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
  auditLogs,
} from '@xiaohai/db';
import type { createDatabase } from '@xiaohai/db';
import {
  legacyCatalogImpact,
  signLegacyPreview,
  verifyLegacyPreview,
} from './hq-catalog-impact.js';

type Db = ReturnType<typeof createDatabase>['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
function isBookEditionUniqueViolation(error: unknown) {
  const candidate =
    error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: unknown }).cause
      : error;
  if (!candidate || typeof candidate !== 'object' || !('code' in candidate)) return false;
  if ((candidate as { code?: unknown }).code !== '23505') return false;
  if ((candidate as { constraint?: unknown }).constraint === 'book_editions_isbn_unique') {
    return true;
  }
  const detail = (candidate as { detail?: unknown }).detail;
  return typeof detail === 'string' && detail.includes('book_editions_isbn_unique');
}
export interface ReferralAttributionWriter {
  attributeOrder(tx: Tx, orderId: string, consumerUserId: string, code?: string): Promise<void>;
}
export class CommerceError extends Error {
  constructor(
    readonly code:
      'NOT_FOUND' | 'CONFLICT' | 'NOT_PURCHASABLE' | 'INVALID_ORDER_STATE' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
  }
}

export class CommerceService {
  constructor(
    private readonly db: Db,
    private readonly referrals?: ReferralAttributionWriter,
    private readonly catalogPreviewSecret = '',
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

  async listAdminProducts(
    q?: string,
    status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE',
    offset = 0,
    limit = 30,
    productId?: string,
  ) {
    return this.readAdminProducts(q, status, productId, false, offset, limit);
  }

  /** A post-COMMIT read restricted to the single created product, never a catalog scan. */
  async getAdminProductById(id: string) {
    const result = await this.readAdminProducts(undefined, undefined, id, true);
    return result.products[0] ?? null;
  }

  /** Filter by product ID without losing sibling SKUs for HQ edit selection. */
  async getAdminProductsById(id: string) {
    const result = await this.readAdminProducts(undefined, undefined, id);
    return result.products;
  }

  private async readAdminProducts(
    q?: string,
    status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE',
    productId?: string,
    onlyOne = false,
    offset = 0,
    limit = 30,
  ) {
    const matching = and(
      productId ? eq(products.id, productId) : undefined,
      status ? eq(products.status, status) : undefined,
      q
        ? or(
            ilike(products.name, `%${q}%`),
            ilike(skus.code, `%${q}%`),
            ilike(skus.name, `%${q}%`),
            ilike(books.title, `%${q}%`),
            ilike(books.author, `%${q}%`),
            ilike(bookEditions.isbn, `%${q}%`),
          )
        : undefined,
    );
    // HQ pages count distinct PRODUCTS, not joined SKU rows. The ID page is
    // deterministic and every SKU under a selected product stays on that page.
    // Matching any SKU brings back all of its siblings for exact SKU editing.
    const productPage = productId
      ? null
      : await this.db
          .select({ id: products.id })
          .from(products)
          .innerJoin(skus, eq(skus.productId, products.id))
          .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
          .leftJoin(books, eq(bookEditions.bookId, books.id))
          .where(matching)
          .groupBy(products.id, products.name)
          .orderBy(asc(products.name), asc(products.id))
          .limit(limit + 1)
          .offset(offset);
    const ids = productPage?.slice(0, limit).map((entry) => entry.id);
    const query = this.db
      .select({ product: products, sku: skus, book: books, edition: bookEditions })
      .from(products)
      .innerJoin(skus, eq(skus.productId, products.id))
      .leftJoin(bookEditions, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(books, eq(bookEditions.bookId, books.id))
      .where(
        productId
          ? and(eq(products.id, productId), status ? eq(products.status, status) : undefined)
          : ids?.length
            ? inArray(products.id, ids)
            : sql`false`,
      )
      .orderBy(asc(products.name), asc(products.id), asc(skus.code), asc(skus.id));
    const page = productId && onlyOne ? await query.limit(1) : await query;
    return {
      offset,
      limit,
      hasMore: !productId && (productPage?.length ?? 0) > limit,
      products: page.map(({ product, sku, book, edition }) => ({
        id: product.id,
        skuId: sku.id,
        bookId: book?.id ?? null,
        editionId: edition?.id ?? null,
        productVersion: product.version,
        bookVersion: book?.version ?? null,
        editionVersion: edition?.version ?? null,
        skuVersion: sku.version,
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
  async lookupBook(code: string) {
    const isbn = normalizeIsbn(code);
    if (!isbn || !isValidIsbn(isbn)) {
      throw new CommerceError('INVALID_INPUT', 'Invalid ISBN or book barcode');
    }
    const [local] = await this.db
      .select({ book: books, edition: bookEditions, sku: skus, product: products })
      .from(bookEditions)
      .innerJoin(books, eq(books.id, bookEditions.bookId))
      .leftJoin(products, eq(products.bookEditionId, bookEditions.id))
      .leftJoin(skus, eq(skus.productId, products.id))
      .where(eq(bookEditions.isbn, isbn))
      .limit(1);
    if (local) {
      return {
        source: 'LOCAL' as const,
        existingProductId: local.product?.id ?? null,
        book: {
          title: local.book.title,
          author: local.book.author,
          isbn,
          publisher: local.edition.publisher,
          coverUrl: local.product?.coverUrl ?? null,
        },
        suggestedPriceMinor: local.sku?.priceMinor ?? null,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(
        `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(`ISBN:${isbn}`)}&format=json&jscmd=data`,
        { headers: { accept: 'application/json' }, signal: controller.signal },
      );
      if (!response.ok)
        return {
          source: 'NOT_FOUND' as const,
          existingProductId: null,
          book: null,
          suggestedPriceMinor: null,
        };
      const payload: unknown = await response.json();
      const record =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)[`ISBN:${isbn}`]
          : undefined;
      if (!record || typeof record !== 'object') {
        return {
          source: 'NOT_FOUND' as const,
          existingProductId: null,
          book: null,
          suggestedPriceMinor: null,
        };
      }
      const data = record as Record<string, unknown>;
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const authors = Array.isArray(data.authors) ? data.authors : [];
      const author = authors
        .map((item) =>
          item && typeof item === 'object' ? (item as Record<string, unknown>).name : null,
        )
        .find((name): name is string => typeof name === 'string' && name.trim().length > 0);
      const publishers = Array.isArray(data.publishers) ? data.publishers : [];
      const publisher = publishers
        .map((item) =>
          item && typeof item === 'object' ? (item as Record<string, unknown>).name : null,
        )
        .find((name): name is string => typeof name === 'string' && name.trim().length > 0);
      const cover =
        data.cover && typeof data.cover === 'object'
          ? (data.cover as Record<string, unknown>)
          : null;
      const coverUrl =
        typeof cover?.large === 'string'
          ? cover.large
          : typeof cover?.medium === 'string'
            ? cover.medium
            : null;
      if (!title || !author)
        return {
          source: 'NOT_FOUND' as const,
          existingProductId: null,
          book: null,
          suggestedPriceMinor: null,
        };
      return {
        source: 'OPEN_LIBRARY' as const,
        existingProductId: null,
        book: {
          title,
          author: author.trim(),
          isbn,
          publisher: publisher?.trim() ?? null,
          coverUrl,
        },
        suggestedPriceMinor: null,
      };
    } catch {
      return {
        source: 'NOT_FOUND' as const,
        existingProductId: null,
        book: null,
        suggestedPriceMinor: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async createAdminProduct(
    input: AdminProductInput,
    actorStaffAccountId: string,
    requestId: string,
    idempotencyKey = requestId,
  ) {
    // Return a persisted read after commit; never query through a second
    // pooled connection while the INSERT transaction is still open.
    // A browser retry must carry the same key even when Fastify assigns a new request ID.
    // Store only hashes in the immutable audit row; no new schema or secret is required.
    const keyHash = createHash('sha256')
      .update(`${actorStaffAccountId}:catalog.hq_create:${idempotencyKey}`)
      .digest('hex');
    const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let createdId: string;
    try {
      createdId = await this.db.transaction(async (tx) => {
        // Serializes concurrent requests for the same actor/key, including the
        // first transaction's INSERT + audit. An unrelated hash collision only
        // serializes two transactions; it cannot mix their audit identities.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${keyHash}))`);
        const [previous] = await tx
          .select({ resourceId: auditLogs.resourceId, metadata: auditLogs.metadata })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorStaffAccountId, actorStaffAccountId),
              eq(auditLogs.actionKey, 'catalog.hq_create'),
              sql`${auditLogs.metadata}->>'idempotencyKeyHash' = ${keyHash}`,
            ),
          )
          .limit(1);
        if (previous) {
          if (previous.metadata.payloadHash !== payloadHash || !previous.resourceId) {
            throw new CommerceError('CONFLICT', 'Idempotency key reused with different product');
          }
          return previous.resourceId;
        }
        // Replay checks must come FIRST, because the original successful create
        // legitimately occupies this ISBN and must not be mistaken for a duplicate.
        const isbn = normalizeIsbn(input.book?.isbn);
        if (input.book?.isbn && !isValidIsbn(isbn))
          throw new CommerceError('INVALID_INPUT', 'Invalid ISBN');
        if (isbn) {
          const [taken] = await tx
            .select({ id: bookEditions.id })
            .from(bookEditions)
            .where(eq(bookEditions.isbn, isbn))
            .limit(1);
          if (taken) throw new CommerceError('CONFLICT', '该图书已存在，请查看或编辑已有图书');
        }
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
              isbn: normalizeIsbn(input.book.isbn) ?? null,
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
        await tx.insert(skus).values({
          productId: product!.id,
          ...input.sku,
          code: input.sku.code ?? `XH-SKU-${randomUUID()}`,
        });
        await tx.insert(auditLogs).values({
          actorStaffAccountId,
          actionKey: 'catalog.hq_create',
          resourceType: 'PRODUCT',
          resourceId: product!.id,
          requestId,
          metadata: {
            changedFields: input.book ? ['product', 'book', 'edition', 'sku'] : ['product', 'sku'],
            skuCount: 1,
            idempotencyKeyHash: keyHash,
            payloadHash,
          },
        });
        return product!.id;
      });
    } catch (error) {
      // Concurrent inserts can pass the preflight together. The unique
      // database index remains the final ISBN conflict boundary.
      if (isBookEditionUniqueViolation(error))
        throw new CommerceError('CONFLICT', '该图书已存在，请查看或编辑已有图书');
      throw error;
    }
    const created = await this.getAdminProductById(createdId);
    // The transaction may already be committed if this read fails. Retrying with
    // the same idempotency key resumes the original result without new INSERTs.
    if (!created) throw new CommerceError('NOT_FOUND', 'Committed product not found');
    return created;
  }
  async previewAdminProductUpdate(
    id: string,
    input: AdminProductUpdateInput,
    actorStaffAccountId: string,
  ) {
    if (Buffer.byteLength(this.catalogPreviewSecret, 'utf8') < 32) {
      throw new CommerceError('CONFLICT', 'HQ catalog preview signing is not configured');
    }
    const matches = await this.getAdminProductsById(id);
    if (!matches.length) throw new CommerceError('NOT_FOUND', 'Product not found');
    if (!input.expectedSkuId && matches.length > 1) {
      throw new CommerceError('CONFLICT', 'Explicit SKU identity required');
    }
    const current = input.expectedSkuId
      ? matches.find((item) => item.skuId === input.expectedSkuId)
      : matches[0];
    if (!current) throw new CommerceError('CONFLICT', 'SKU reference changed');
    if (
      input.expectedProductVersion !== current.productVersion ||
      input.expectedSkuVersion !== current.skuVersion ||
      (current.book &&
        (input.expectedBookVersion !== current.bookVersion ||
          input.expectedEditionVersion !== current.editionVersion))
    )
      throw new CommerceError('CONFLICT', 'Stale catalog preview');
    const impact = await legacyCatalogImpact(this.db, current.id, current.skuId);
    if (!impact || impact.bookId !== current.bookId || impact.editionId !== current.editionId)
      throw new CommerceError('CONFLICT', 'Catalog relationships changed');
    return {
      impact: {
        affectedStoreCount: impact.affectedStoreIds.length,
        affectedStoreIds: impact.affectedStoreIds,
      },
      previewToken: signLegacyPreview(
        this.catalogPreviewSecret,
        actorStaffAccountId,
        current.id,
        current.skuId,
        input,
        impact,
      ),
    };
  }

  async updateAdminProduct(
    id: string,
    input: AdminProductUpdateInput,
    actorStaffAccountId: string,
    requestId: string,
    previewToken?: string,
  ) {
    const matches = await this.getAdminProductsById(id);
    if (matches.length === 0) throw new CommerceError('NOT_FOUND', 'Product not found');
    // A product may have multiple SKUs: never update an arbitrary first SKU.
    if (!input.expectedSkuId && matches.length > 1) {
      throw new CommerceError('CONFLICT', 'Explicit SKU identity required');
    }
    const current = input.expectedSkuId
      ? matches.find((item) => item.skuId === input.expectedSkuId)
      : matches[0];
    if (!current) throw new CommerceError('CONFLICT', 'SKU reference changed');
    if (input.expectedProductVersion === undefined || input.expectedSkuVersion === undefined) {
      throw new CommerceError('CONFLICT', 'Product and SKU versions are required');
    }
    const expectedProductVersion = input.expectedProductVersion;
    const expectedSkuVersion = input.expectedSkuVersion;

    if (current.book) {
      if (
        !input.book ||
        input.expectedBookVersion === undefined ||
        input.expectedEditionVersion === undefined ||
        current.bookVersion !== input.expectedBookVersion ||
        current.editionVersion !== input.expectedEditionVersion
      ) {
        throw new CommerceError('CONFLICT', 'Book or edition version conflict');
      }
    } else if (input.book) {
      throw new CommerceError(
        'INVALID_INPUT',
        'Cannot attach book fields to a product without an existing book edition',
      );
    }
    const normalizedBook = input.book
      ? { ...input.book, isbn: normalizeIsbn(input.book.isbn) }
      : input.book;
    if (
      current.book &&
      normalizedBook?.isbn !== undefined &&
      normalizedBook.isbn !== current.book.isbn &&
      !isValidIsbn(normalizedBook?.isbn)
    ) {
      throw new CommerceError('INVALID_INPUT', 'Invalid ISBN');
    }
    const bookChanged = Boolean(
      current.book &&
      normalizedBook &&
      (normalizedBook.title !== current.book.title ||
        normalizedBook.author !== current.book.author),
    );
    const editionChanged = Boolean(
      current.book &&
      normalizedBook &&
      ((normalizedBook.isbn !== undefined && normalizedBook.isbn !== current.book.isbn) ||
        (normalizedBook.publisher !== undefined &&
          normalizedBook.publisher !== current.book.publisher)),
    );

    await this.db.transaction(async (tx) => {
      // The legacy PUT is a separate shared-master write path. It must not
      // bypass the HQ preview policy enforced by the newer cross-store PATCH.
      const impact = await legacyCatalogImpact(tx, current.id, current.skuId, true);
      if (
        !impact ||
        impact.bookId !== current.bookId ||
        impact.editionId !== current.editionId ||
        !verifyLegacyPreview(
          this.catalogPreviewSecret,
          previewToken,
          actorStaffAccountId,
          current.id,
          current.skuId,
          input,
          impact,
        )
      )
        throw new CommerceError('CONFLICT', 'Stale or missing HQ catalog preview');
      const [updatedProduct] = await tx
        .update(products)
        .set({
          name: input.name,
          description: input.description ?? null,
          coverUrl: input.coverUrl ?? null,
          status: input.status,
          version: sql`${products.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, id), eq(products.version, expectedProductVersion)))
        .returning({ id: products.id });
      if (!updatedProduct) throw new CommerceError('CONFLICT', 'Product version conflict');
      if (bookChanged || editionChanged) {
        const [source] = await tx
          .select({ editionId: products.bookEditionId })
          .from(products)
          .where(eq(products.id, id))
          .limit(1);
        if (!source?.editionId) throw new CommerceError('CONFLICT', 'Book edition missing');
        const [edition] = await tx
          .select({ bookId: bookEditions.bookId })
          .from(bookEditions)
          .where(eq(bookEditions.id, source.editionId))
          .limit(1);
        if (!edition) throw new CommerceError('CONFLICT', 'Book missing');
        if (bookChanged) {
          const [updated] = await tx
            .update(books)
            .set({
              title: normalizedBook!.title,
              author: normalizedBook!.author,
              version: sql`${books.version} + 1`,
              updatedAt: new Date(),
            })
            .where(and(eq(books.id, edition.bookId), eq(books.version, input.expectedBookVersion!)))
            .returning({ id: books.id });
          if (!updated) throw new CommerceError('CONFLICT', 'Book version conflict');
        }
        if (editionChanged) {
          const [updated] = await tx
            .update(bookEditions)
            .set({
              ...(normalizedBook!.isbn !== undefined ? { isbn: normalizedBook!.isbn } : {}),
              ...(normalizedBook!.publisher !== undefined
                ? { publisher: normalizedBook!.publisher }
                : {}),
              version: sql`${bookEditions.version} + 1`,
            })
            .where(
              and(
                eq(bookEditions.id, source.editionId),
                eq(bookEditions.version, input.expectedEditionVersion!),
              ),
            )
            .returning({ id: bookEditions.id });
          if (!updated) throw new CommerceError('CONFLICT', 'Edition version conflict');
        }
      }
      const [updatedSku] = await tx
        .update(skus)
        .set({ ...input.sku, version: sql`${skus.version} + 1`, updatedAt: new Date() })
        .where(and(eq(skus.id, current.skuId), eq(skus.version, expectedSkuVersion)))
        .returning({ id: skus.id });
      if (!updatedSku) throw new CommerceError('CONFLICT', 'SKU version conflict');
      await tx.insert(auditLogs).values({
        actorStaffAccountId,
        actionKey: 'catalog.hq_direct_edit',
        resourceType: 'PRODUCT',
        resourceId: id,
        requestId,
        metadata: {
          productId: id,
          skuId: current.skuId,
          bookId: current.bookId,
          editionId: current.editionId,
          affectedStoreCount: impact.affectedStoreIds.length,
          affectedStoreIds: impact.affectedStoreIds,
          changedFields: [
            'product',
            'sku',
            ...(bookChanged ? ['book'] : []),
            ...(editionChanged ? ['edition'] : []),
          ],
          beforeVersions: {
            product: current.productVersion,
            sku: current.skuVersion,
            book: current.bookVersion,
            edition: current.editionVersion,
          },
          entityIds: {
            productId: id,
            skuId: current.skuId,
            bookId: current.bookId,
            editionId: current.editionId,
          },
          afterVersions: {
            product: current.productVersion + 1,
            sku: current.skuVersion + 1,
            book: current.bookVersion === null ? null : current.bookVersion + Number(bookChanged),
            edition:
              current.editionVersion === null
                ? null
                : current.editionVersion + Number(editionChanged),
          },
        },
      });
    });
    const updated = (await this.getAdminProductsById(id)).find(
      (item) => item.skuId === current.skuId,
    );
    if (!updated) throw new CommerceError('NOT_FOUND', 'Updated product not found');
    return updated;
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
