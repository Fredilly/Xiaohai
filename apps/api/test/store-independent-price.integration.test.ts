import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  consumerUsers,
  orders,
  orderItems,
  products,
  skus,
  staffAccounts,
  regions,
  stores,
  storeInventory,
  storeCatalogMetadata,
} from '@xiaohai/db';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { CatalogEditService } from '../src/commerce/catalog-edit-service.js';
import { StoreCatalogReadService } from '../src/commerce/store-catalog-read-service.js';
import { FulfillmentService } from '../src/fulfillment/fulfillment-service.js';
import { ManualDeliveryProvider } from '../src/fulfillment/delivery-provider.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';
import { createOwnedIntegrationDatabase } from './owned-integration-database.js';

const enabled = assertMeipingApplyDisposableDatabase(process.env);
const owned = enabled ? createOwnedIntegrationDatabase(process.env) : null;
const suite = owned ? describe : describe.skip;

suite('confirmed #208 store-independent prices through real checkout', () => {
  beforeAll(async () => {
    await owned!.start();
  }, 60_000);
  afterAll(async () => {
    await owned?.stop();
  });

  async function seed() {
    const db = owned!.database.db;
    const marker = randomUUID();
    const [actor] = await db
      .insert(staffAccounts)
      .values({ loginIdentifier: marker, passwordHash: 'synthetic' })
      .returning();
    const [region] = await db
      .insert(regions)
      .values({ code: marker, name: 'Test region', countryCode: 'CN', countryName: 'China' })
      .returning();
    const locations = await db
      .insert(stores)
      .values(
        ['A', 'B'].map((name) => ({
          code: marker + name,
          name,
          regionId: region!.id,
          countryCode: 'CN',
          countryName: 'China',
          city: 'Chengdu',
          timezone: 'Asia/Shanghai',
          addressLine: 'Test only',
          latitude: 30,
          longitude: 104,
        })),
      )
      .returning();
    const [product] = await db
      .insert(products)
      .values({ name: 'Shared item', status: 'ACTIVE' })
      .returning();
    const [sku] = await db
      .insert(skus)
      .values({
        productId: product!.id,
        code: marker,
        name: 'Standard',
        priceMinor: 1000,
        availableForSale: true,
      })
      .returning();
    await db
      .insert(storeInventory)
      .values(locations.map((store) => ({ storeId: store.id, skuId: sku!.id, onHand: 20 })));
    const reader = new StoreCatalogReadService(db);
    const editor = new CatalogEditService(db, 'independent-price-test-preview-signing-secret');
    const commerce = new CommerceService(db);
    const fulfillment = new FulfillmentService(
      db,
      commerce,
      'independent-price-test-pickup-signing-secret',
      new ManualDeliveryProvider(),
    );
    const input = {
      expectedProductVersion: 0,
      expectedSkuVersion: 0,
      expectedLocalVersion: 0,
      priceMinor: 1250,
    };
    return {
      db,
      actor: actor!,
      sku: sku!,
      locations,
      reader,
      editor,
      commerce,
      fulfillment,
      input,
    };
  }

  it('changes only one store price and leaves shared SKU reference price/version unchanged', async () => {
    const f = await seed();
    const [a, b] = f.locations;
    const preview = await f.editor.preview(a!.id, f.sku.id, f.input, f.actor.id, 'STORE_ONLY');
    expect(preview.impact).toMatchObject({ sharedFields: [], affectedStoreIds: [a!.id] });
    expect(preview.previewToken).toBeNull();
    await f.editor.update(a!.id, f.sku.id, f.actor.id, randomUUID(), f.input, 'STORE_ONLY');
    expect(await f.reader.get(a!.id, f.sku.id)).toMatchObject({
      priceMinor: 1250,
      localVersion: 1,
      skuVersion: 0,
    });
    expect(await f.reader.get(b!.id, f.sku.id)).toMatchObject({
      priceMinor: 1000,
      localVersion: 0,
    });
    const [sku] = await f.db.select().from(skus).where(eq(skus.id, f.sku.id));
    expect(sku).toMatchObject({ priceMinor: 1000, version: 0 });
    await f.db.update(skus).set({ priceMinor: 3000 }).where(eq(skus.id, f.sku.id));
    expect((await f.reader.get(b!.id, f.sku.id))!.priceMinor).toBe(1000);
    await expect(
      f.editor.update(
        a!.id,
        f.sku.id,
        f.actor.id,
        randomUUID(),
        { ...f.input, priceMinor: 1400 },
        'STORE_ONLY',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('quotes selected-store prices and snapshots them in the reserved order', async () => {
    const f = await seed();
    const [a, b] = f.locations;
    await f.editor.update(a!.id, f.sku.id, f.actor.id, randomUUID(), f.input, 'STORE_ONLY');
    const [user] = await f.db.insert(consumerUsers).values({}).returning();
    await f.commerce.addCartItem(user!.id, f.sku.id, 2);
    expect(
      (await f.fulfillment.quote(user!.id, { method: 'PICKUP', storeId: a!.id })).totalMinor,
    ).toBe(2500);
    expect(
      (await f.fulfillment.quote(user!.id, { method: 'PICKUP', storeId: b!.id })).totalMinor,
    ).toBe(2000);
    const request = {
      method: 'PICKUP' as const,
      storeId: a!.id,
      clientRequestId: randomUUID(),
      expectedTotalMinor: 2500,
    };
    const id = await f.fulfillment.createOrder(user!.id, request);
    expect(await f.fulfillment.createOrder(user!.id, request)).toBe(id);
    const [order] = await f.db.select().from(orders).where(eq(orders.id, id));
    const [item] = await f.db.select().from(orderItems).where(eq(orderItems.orderId, id));
    expect(order!.totalMinor).toBe(2500);
    expect(item!.unitPriceMinor).toBe(1250);
    const [balance] = await f.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, a!.id), eq(storeInventory.skuId, f.sku.id)));
    expect(balance!.reserved).toBe(2);
    await f.editor.update(
      a!.id,
      f.sku.id,
      f.actor.id,
      randomUUID(),
      { ...f.input, expectedLocalVersion: 1, priceMinor: 1500 },
      'STORE_ONLY',
    );
    expect((await f.commerce.getOrder(user!.id, id)).totalMinor).toBe(2500);
  });

  it('rejects a stale quoted total without consuming the cart or reserving stock', async () => {
    const f = await seed();
    const storeId = f.locations[0]!.id;
    const [user] = await f.db.insert(consumerUsers).values({}).returning();
    await f.commerce.addCartItem(user!.id, f.sku.id, 1);
    await f.editor.update(storeId, f.sku.id, f.actor.id, randomUUID(), f.input, 'STORE_ONLY');
    await expect(
      f.fulfillment.createOrder(user!.id, {
        method: 'PICKUP',
        storeId,
        clientRequestId: randomUUID(),
        expectedTotalMinor: 1000,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.commerce.getCart(user!.id)).items).toHaveLength(1);
    const [balance] = await f.db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, storeId), eq(storeInventory.skuId, f.sku.id)));
    expect(balance!.reserved).toBe(0);
  });

  it('fails closed if selected-store price metadata is missing', async () => {
    const f = await seed();
    const storeId = f.locations[0]!.id;
    const [user] = await f.db.insert(consumerUsers).values({}).returning();
    await f.commerce.addCartItem(user!.id, f.sku.id, 1);
    await f.db
      .delete(storeCatalogMetadata)
      .where(
        and(eq(storeCatalogMetadata.storeId, storeId), eq(storeCatalogMetadata.skuId, f.sku.id)),
      );
    await expect(
      f.fulfillment.quote(user!.id, { method: 'PICKUP', storeId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('a concurrent price edit cannot silently replace the confirmed checkout total', async () => {
    const f = await seed();
    const storeId = f.locations[0]!.id;
    const [user] = await f.db.insert(consumerUsers).values({}).returning();
    await f.commerce.addCartItem(user!.id, f.sku.id, 1);
    const results = await Promise.allSettled([
      f.fulfillment.createOrder(user!.id, {
        method: 'PICKUP',
        storeId,
        clientRequestId: randomUUID(),
        expectedTotalMinor: 1000,
      }),
      f.editor.update(storeId, f.sku.id, f.actor.id, randomUUID(), f.input, 'STORE_ONLY'),
    ]);
    expect(results[1].status).toBe('fulfilled');
    const checkout = results[0];
    if (checkout.status === 'fulfilled') {
      expect((await f.commerce.getOrder(user!.id, checkout.value)).totalMinor).toBe(1000);
    } else expect(checkout.reason).toMatchObject({ code: 'CONFLICT' });
    expect((await f.reader.get(storeId, f.sku.id))!.priceMinor).toBe(1250);
  });
  it('legacy checkout cannot bypass the required store-specific price path', async () => {
    const f = await seed();
    const [user] = await f.db.insert(consumerUsers).values({}).returning();
    await f.commerce.addCartItem(user!.id, f.sku.id, 1);
    await expect(f.commerce.checkoutPreview(user!.id, randomUUID())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
  it('does not publish a legacy signed cover URL in the shared public catalog', async () => {
    const f = await seed();
    await f.db
      .update(products)
      .set({ coverUrl: 'https://cdn.example.com/image.png?signature=synthetic' })
      .where(eq(products.id, f.sku.productId));
    const publicProduct = await f.commerce.getProduct(f.sku.productId);
    expect(publicProduct.coverUrl).toBeNull();
  });
});
