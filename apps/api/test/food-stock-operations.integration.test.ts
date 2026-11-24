import { foodStockReadResponseSchema } from '@xiaohai/contracts/food';
import { CommerceService } from '../src/commerce/commerce-service.js';
import { InventoryOperationsService } from '../src/inventory/inventory-operations-service.js';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  staffAccounts,
  regions,
  stores,
  products,
  skus,
  storeInventory,
  foodBatches,
  foodBatchTransactions,
  inventoryTransactions,
} from '@xiaohai/db';
import { FoodStockOperationsService } from '../src/inventory/food-stock-operations-service.js';
import type { FoodLotIntakeRequest } from '@xiaohai/contracts/food';
import { createOwnedIntegrationDatabase } from './owned-integration-database.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const enabled = assertMeipingApplyDisposableDatabase(process.env);
const owned = enabled ? createOwnedIntegrationDatabase(process.env) : null;
const database = owned?.database ?? null;
const suite = owned ? describe : describe.skip;
const service = database ? new FoodStockOperationsService(database.db) : null;

async function fixture() {
  const db = database!.db;
  const marker = randomUUID();
  const [actor] = await db
    .insert(staffAccounts)
    .values({ loginIdentifier: marker, passwordHash: 'synthetic-fixture' })
    .returning();
  const [region] = await db
    .insert(regions)
    .values({
      code: marker,
      name: 'Disposable food region',
      countryCode: 'CN',
      countryName: 'China',
    })
    .returning();
  const [store] = await db
    .insert(stores)
    .values({
      code: marker,
      name: 'Disposable store',
      regionId: region!.id,
      countryCode: 'CN',
      countryName: 'China',
      city: 'Chengdu',
      timezone: 'Asia/Shanghai',
      addressLine: 'Test only',
      latitude: 30,
      longitude: 104,
    })
    .returning();
  const [product] = await db
    .insert(products)
    .values({ name: 'Synthetic packaged food', status: 'DRAFT' })
    .returning();
  const [sku] = await db
    .insert(skus)
    .values({
      productId: product!.id,
      code: marker,
      name: 'Test SKU',
      priceMinor: 100,
      availableForSale: false,
    })
    .returning();
  await db.insert(storeInventory).values({ storeId: store!.id, skuId: sku!.id, onHand: 0 });
  const context = {
    staffAccountId: actor!.id,
    loginIdentifier: marker,
    permissions: ['inventory.read', 'inventory.receive', 'inventory.adjust', 'catalog.edit'],
    dataScopes: [{ type: 'STORE' as const, id: store!.id }],
  };
  const input: FoodLotIntakeRequest = {
    storeId: store!.id,
    skuId: sku!.id,
    expectedInventoryVersion: 0,
    kind: 'PACKAGED_FOOD',
    lotCode: 'LOT-1',
    manufacturedOn: null,
    expiresOn: '2099-12-31',
    quantity: 10,
    idempotencyKey: randomUUID(),
    reason: 'Synthetic receipt',
    sourceRef: 'synthetic:receipt:1',
  };
  const read = async () => ({
    balances: await db
      .select()
      .from(storeInventory)
      .where(and(eq(storeInventory.storeId, store!.id), eq(storeInventory.skuId, sku!.id))),
    batches: await db.select().from(foodBatches).where(eq(foodBatches.skuId, sku!.id)),
    aggregates: await db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.skuId, sku!.id)),
    events: await db
      .select()
      .from(foodBatchTransactions)
      .where(eq(foodBatchTransactions.skuId, sku!.id)),
  });
  return { db, actor: actor!, store: store!, sku: sku!, context, input, read };
}

suite('food intake and quarantine: real migrations only', () => {
  beforeAll(async () => {
    await owned!.start();
  }, 60_000);
  afterAll(async () => {
    await owned?.stop();
  });
  it('commits a held lot with matching immutable aggregate and lot event', async () => {
    const f = await fixture();
    const result = await service!.receive(f.context, f.input, 'synthetic');
    const data = await f.read();
    expect(result).toMatchObject({ onHandAfter: 10, inventoryVersion: 1, replayed: false });
    expect(data.batches).toHaveLength(1);
    expect(data.batches[0]).toMatchObject({ state: 'HELD', foodKind: 'PACKAGED_FOOD', onHand: 10 });
    expect(data.aggregates).toHaveLength(1);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]!.quantityDelta).toBe(data.aggregates[0]!.quantityDelta);
    expect(
      foodStockReadResponseSchema.parse(await service!.read(f.context, f.store.id, f.sku.id)),
    ).toMatchObject({
      checkoutEnabled: false,
    });
  });
  it('serializes identical concurrent receipts and rejects changed payload', async () => {
    const f = await fixture();
    const results = await Promise.all(
      [1, 2, 3].map(() => service!.receive(f.context, f.input, 'synthetic')),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.batchId)).size).toBe(1);
    await expect(
      service!.receive(f.context, { ...f.input, quantity: 11 }, 'synthetic'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read()).aggregates).toHaveLength(1);
  });
  it('releases, freezes and recalls without changing quantities, with replay and stale guards', async () => {
    const f = await fixture();
    const receipt = await service!.receive(f.context, f.input, 'synthetic');
    let version = 0;
    for (const state of ['AVAILABLE', 'HELD', 'RECALLED'] as const) {
      const input = {
        storeId: f.store.id,
        skuId: f.sku.id,
        batchId: receipt.batchId,
        expectedVersion: version,
        expectedInventoryVersion: version + 1,
        state,
        idempotencyKey: randomUUID(),
        reason: 'Synthetic inspection',
        sourceRef: 'synthetic:inspection:1',
      };
      const responses = await Promise.all(
        [1, 2].map(() => service!.disposition(f.context, input, 'synthetic')),
      );
      expect(responses.filter((r) => !r.replayed)).toHaveLength(1);
      await expect(
        service!.disposition(f.context, { ...input, idempotencyKey: randomUUID() }, 'synthetic'),
      ).rejects.toMatchObject({ code: 'STALE_VERSION' });
      version++;
    }
    const data = await f.read();
    expect(data.balances[0]).toMatchObject({ onHand: 10, version: 4 });
    expect(data.batches[0]).toMatchObject({ onHand: 10, state: 'RECALLED', version: 3 });
    expect(data.aggregates).toHaveLength(1);
  });
  it.each(['expired', 'active', 'missing-permission', 'foreign-store', 'url-evidence'] as const)(
    'rejects %s with no writes',
    async (mode) => {
      const f = await fixture();
      const input = { ...f.input };
      const actor = { ...f.context };
      if (mode === 'expired') input.expiresOn = '2000-01-01';
      if (mode === 'active')
        await f.db
          .update(products)
          .set({ status: 'ACTIVE' })
          .where(eq(products.id, f.sku.productId));
      if (mode === 'missing-permission')
        actor.permissions = ['inventory.read', 'inventory.receive'];
      if (mode === 'foreign-store') actor.dataScopes = [{ type: 'STORE', id: randomUUID() }];
      if (mode === 'url-evidence')
        input.sourceRef = 'https://example.test/private?signature=secret';
      await expect(service!.receive(actor, input, 'synthetic')).rejects.toBeDefined();
      const data = await f.read();
      expect(data.batches).toHaveLength(0);
      expect(data.events).toHaveLength(0);
      expect(data.aggregates).toHaveLength(0);
      expect(data.balances[0]!.onHand).toBe(0);
    },
  );
  it('blocks generic stock edits and cart entry even if a known food SKU is activated', async () => {
    const f = await fixture();
    await service!.receive(f.context, f.input, 'synthetic');
    await expect(
      new InventoryOperationsService(f.db).adjust(f.context, {
        storeId: f.store.id,
        skuId: f.sku.id,
        expectedVersion: 1,
        quantityDelta: -1,
        idempotencyKey: randomUUID(),
        reason: 'Synthetic forbidden bypass',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.db.update(products).set({ status: 'ACTIVE' }).where(eq(products.id, f.sku.productId));
    await f.db.update(skus).set({ availableForSale: true }).where(eq(skus.id, f.sku.id));
    const commerce = new CommerceService(f.db);
    await expect(commerce.addCartItem(randomUUID(), f.sku.id, 1)).rejects.toBeDefined();
    const product = await commerce.getProduct(f.sku.productId);
    expect(product.skus.every((row) => !row.availableForSale)).toBe(true);
    expect((await f.read()).balances[0]!.onHand).toBe(10);
  });
  it('duplicate lot failure rolls back the aggregate and balance', async () => {
    const f = await fixture();
    await service!.receive(f.context, f.input, 'synthetic');
    await expect(
      service!.receive(
        f.context,
        { ...f.input, expectedInventoryVersion: 1, idempotencyKey: randomUUID() },
        'synthetic',
      ),
    ).rejects.toBeDefined();
    const data = await f.read();
    expect(data.balances[0]!.onHand).toBe(10);
    expect(data.aggregates).toHaveLength(1);
  });
});
