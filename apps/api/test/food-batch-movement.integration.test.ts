import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
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
import type { FoodBatchMovementRequest } from '@xiaohai/contracts/food';
import { FoodBatchMovementService } from '../src/inventory/food-batch-movement-service.js';
import { createOwnedIntegrationDatabase } from './owned-integration-database.js';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

const enabled = assertMeipingApplyDisposableDatabase(process.env);
const owned = enabled ? createOwnedIntegrationDatabase(process.env) : null;
const database = owned?.database ?? null;
const suite = owned ? describe : describe.skip;
const service = database ? new FoodBatchMovementService(database.db) : null;

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
  await db.insert(storeInventory).values({ storeId: store!.id, skuId: sku!.id, onHand: 10 });
  const lots = await db
    .insert(foodBatches)
    .values(
      ['A', 'B'].map((lotCode) => ({
        storeId: store!.id,
        skuId: sku!.id,
        lotCode,
        expiresOn: '2099-12-31',
        onHand: 5,
        state: 'AVAILABLE',
        foodKind: 'PACKAGED_FOOD' as const,
        createdByStaffAccountId: actor!.id,
      })),
    )
    .returning();
  const context = {
    staffAccountId: actor!.id,
    loginIdentifier: marker,
    permissions: ['inventory.read', 'inventory.receive', 'inventory.adjust'],
    dataScopes: [{ type: 'STORE' as const, id: store!.id }],
  };
  const input: FoodBatchMovementRequest = {
    storeId: store!.id,
    skuId: sku!.id,
    expectedInventoryVersion: 0,
    kind: 'EXISTING_LOT_RECEIPT',
    idempotencyKey: randomUUID(),
    reason: 'Synthetic receipt',
    lines: lots.map((lot, i) => ({ batchId: lot.id, expectedVersion: 0, quantity: i + 2 })),
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
  return { db, actor: actor!, store: store!, sku: sku!, lots, context, input, read };
}

suite('atomic multi-lot food movements: real migrations, disposable PostgreSQL only', () => {
  beforeAll(async () => {
    await owned!.start();
  }, 60_000);
  afterAll(async () => {
    await owned?.stop();
  });

  it.each(['EXISTING_LOT_RECEIPT', 'DAMAGE', 'STOCKTAKE_LOSS'] as const)(
    'splits one %s movement across two lots',
    async (kind) => {
      const f = await fixture();
      const result = await service!.apply(f.context, { ...f.input, kind });
      const data = await f.read();
      const delta = kind === 'EXISTING_LOT_RECEIPT' ? 5 : -5;
      expect(result).toMatchObject({ balanceAfter: 10 + delta, version: 1, replayed: false });
      expect(data.aggregates).toHaveLength(1);
      expect(data.events).toHaveLength(2);
      expect(data.events.reduce((sum, row) => sum + row.quantityDelta, 0)).toBe(delta);
      expect(new Set(data.events.map((row) => row.aggregateTransactionId))).toEqual(
        new Set([result.aggregateTransactionId]),
      );
      expect(data.batches.reduce((sum, row) => sum + row.onHand, 0)).toBe(data.balances[0]!.onHand);
      expect(data.batches.every((row) => row.version === 1)).toBe(true);
      const [product] = await f.db.select().from(products).where(eq(products.id, f.sku.productId));
      expect(product!.status).toBe('DRAFT');
    },
  );

  it('serializes concurrent identical retries; changed payload/actor cannot reuse the key', async () => {
    const f = await fixture();
    const results = await Promise.all([1, 2, 3].map(() => service!.apply(f.context, f.input)));
    expect(results.filter((row) => !row.replayed)).toHaveLength(1);
    expect(new Set(results.map((row) => row.aggregateTransactionId)).size).toBe(1);
    // Order of supplied lots is not a distinct operation.
    expect(
      await service!.apply(f.context, { ...f.input, lines: [...f.input.lines].reverse() }),
    ).toMatchObject({ replayed: true });
    await expect(
      service!.apply(f.context, { ...f.input, reason: 'Different request' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service!.apply({ ...f.context, staffAccountId: randomUUID() }, f.input),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await f.read()).events).toHaveLength(2);
  });

  it('concurrent distinct requests with the same inventory version cannot both deduct', async () => {
    const f = await fixture();
    const input = {
      ...f.input,
      kind: 'DAMAGE' as const,
      lines: f.input.lines.map((line) => ({ ...line, quantity: 4 })),
    };
    const results = await Promise.allSettled([
      service!.apply(f.context, input),
      service!.apply(f.context, { ...input, idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((row) => row.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_VERSION' },
    });
    const data = await f.read();
    expect(data.balances[0]!.onHand).toBe(2);
    expect(data.events).toHaveLength(2);
  });

  it.each(['HELD', 'RECALLED', 'EXPIRED', 'BLOCKED', 'STALE_LOT', 'MISMATCH'])(
    'rejects %s stock without any partial movement',
    async (mode) => {
      const f = await fixture();
      const lot = f.lots[1]!;
      const patch =
        mode === 'EXPIRED'
          ? { expiresOn: '2000-01-01' }
          : mode === 'BLOCKED'
            ? { blocked: 5 }
            : mode === 'STALE_LOT'
              ? { version: 1 }
              : mode === 'MISMATCH'
                ? { onHand: 4 }
                : { state: mode };
      await f.db.update(foodBatches).set(patch).where(eq(foodBatches.id, lot.id));
      const before = await f.read();
      await expect(service!.apply(f.context, { ...f.input, kind: 'DAMAGE' })).rejects.toMatchObject(
        {
          code:
            mode === 'BLOCKED'
              ? 'INSUFFICIENT_STOCK'
              : mode === 'STALE_LOT'
                ? 'STALE_VERSION'
                : mode === 'MISMATCH'
                  ? 'UNRECONCILED_FOOD_STOCK'
                  : 'FOOD_BATCH_BLOCKED',
        },
      );
      expect(await f.read()).toEqual(before);
    },
  );

  it('requires server-side permission/scope and rejects foreign or duplicate lot IDs', async () => {
    const f = await fixture();
    const foreign = await fixture();
    await expect(
      service!.apply({ ...f.context, permissions: ['inventory.read'] }, f.input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service!.apply(f.context, { ...f.input, storeId: foreign.store.id, skuId: foreign.sku.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service!.apply(f.context, { ...f.input, lines: [f.input.lines[0]!, f.input.lines[0]!] }),
    ).rejects.toMatchObject({ code: 'INVALID_FOOD_MOVEMENT' });
    await expect(
      service!.apply(f.context, {
        ...f.input,
        lines: [{ ...f.input.lines[0]!, batchId: foreign.lots[0]!.id }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await f.read()).aggregates).toHaveLength(0);
  });

  it.each([false, true])(
    'COMMIT rejects an incomplete group (no children=%s) and rolls back balances',
    async (noChildren) => {
      const f = await fixture();
      const client = await database!.pool.connect();
      const group = randomUUID();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE store_inventory SET on_hand=15 WHERE store_id=$1 AND sku_id=$2',
          [f.store.id, f.sku.id],
        );
        await client.query(
          `INSERT INTO inventory_transactions
        (id,store_id,sku_id,transaction_type,quantity_delta,balance_after,reference_type,reference_id,idempotency_key,reason,metadata,created_by_staff_account_id)
        VALUES ($1,$2,$3,'PURCHASE_RECEIPT',5,15,'FOOD_BATCH_OPERATION',$1,$1::uuid::text,'Synthetic receipt','{"source":"FOOD_BATCH_OPERATION"}',$4)`,
          [group, f.store.id, f.sku.id, f.actor.id],
        );
        if (!noChildren) {
          for (const lot of f.lots) {
            await client.query('UPDATE food_batches SET on_hand=7 WHERE id=$1', [lot.id]);
            await client.query(
              `INSERT INTO food_batch_transactions
            (store_id,sku_id,batch_id,transaction_type,quantity_delta,on_hand_before,on_hand_after,reserved_before,reserved_after,blocked_before,blocked_after,aggregate_transaction_id,reference_type,reference_id,idempotency_key,reason,created_by_staff_account_id)
            VALUES ($1,$2,$3,'EXISTING_LOT_RECEIPT',2,5,7,0,0,0,0,$4,'FOOD_BATCH_OPERATION',$4,$5,'Synthetic receipt',$6)`,
              [f.store.id, f.sku.id, lot.id, group, randomUUID(), f.actor.id],
            );
          }
        }
        await expect(client.query('COMMIT')).rejects.toMatchObject({
          code: '23514',
          message: 'FOOD_BATCH_GROUP_DELTA_MISMATCH',
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      const after = await f.read();
      expect(after.balances[0]!.onHand).toBe(10);
      expect(after.batches.map((row) => row.onHand)).toEqual([5, 5]);
      expect(after.events).toHaveLength(0);
      expect(after.aggregates).toHaveLength(0);
    },
  );

  it('food aggregate history cannot be rewritten after a valid group commits', async () => {
    const f = await fixture();
    const result = await service!.apply(f.context, f.input);
    await expect(
      f.db.execute(
        sql`update inventory_transactions set quantity_delta=99 where id=${result.aggregateTransactionId}::uuid`,
      ),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      f.db.execute(
        sql`delete from inventory_transactions where id=${result.aggregateTransactionId}::uuid`,
      ),
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    expect((await f.read()).aggregates[0]!.quantityDelta).toBe(5);
  });

  it('rolls back the first lot and aggregate when the second event insert fails', async () => {
    const f = await fixture();
    const failingLot = [...f.lots].sort((a, b) => a.id.localeCompare(b.id))[1]!;
    const suffix = randomUUID().replaceAll('-', '');
    const name = `i208_injected_${suffix}`;
    const before = await f.read();
    // Only this guarded disposable DB; unique test-owned trigger, removed below.
    await f.db.execute(
      sql.raw(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'I208_INJECTED_SECOND_EVENT_FAILURE' USING ERRCODE='23514'; END; $$;
      CREATE TRIGGER ${name} BEFORE INSERT ON food_batch_transactions FOR EACH ROW
      WHEN (NEW.batch_id='${failingLot.id}'::uuid) EXECUTE FUNCTION public.${name}();`),
    );
    try {
      await expect(service!.apply(f.context, f.input)).rejects.toMatchObject({
        cause: { code: '23514', message: 'I208_INJECTED_SECOND_EVENT_FAILURE' },
      });
      expect(await f.read()).toEqual(before);
    } finally {
      await f.db.execute(
        sql.raw(`DROP TRIGGER ${name} ON food_batch_transactions; DROP FUNCTION public.${name}();`),
      );
    }
  });

  it.each([
    'created_by_staff_account_id',
    'reference_id',
    'reference_type',
    'reason',
    'transaction_type',
  ])('rejects a lot event with mismatched %s before accepting a group', async (field) => {
    const f = await fixture();
    await service!.apply(f.context, f.input);
    const original = (await f.read()).events[0]!;
    const value =
      field === 'created_by_staff_account_id' || field === 'reference_id'
        ? randomUUID()
        : field === 'transaction_type'
          ? 'DAMAGE'
          : 'wrong-group';
    await expect(
      database!.pool.query(
        `INSERT INTO food_batch_transactions
        SELECT (jsonb_populate_record(NULL::food_batch_transactions, to_jsonb(e) || $2::jsonb)).*
        FROM food_batch_transactions e WHERE e.id=$1`,
        [
          original.id,
          JSON.stringify({ id: randomUUID(), idempotency_key: randomUUID(), [field]: value }),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514', message: 'FOOD_BATCH_GROUP_IDENTITY_MISMATCH' });
    expect((await f.read()).events).toHaveLength(2);
  });
});
