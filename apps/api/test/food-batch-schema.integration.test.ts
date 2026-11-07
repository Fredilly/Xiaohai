import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '@xiaohai/db';
import { afterAll, describe, expect, it } from 'vitest';
import { assertMeipingApplyDisposableDatabase } from './meiping-apply-database-guard.js';

// Validate BOTH effective connection strings before creating a pool or writing fixtures.
const database = assertMeipingApplyDisposableDatabase(process.env)
  ? createDatabase(process.env)
  : null;
const suite = database ? describe : describe.skip;

suite('food batch migration 0041: real disposable PostgreSQL constraints (#208)', () => {
  afterAll(async () => database?.pool.end());

  it('rejects cross-store/SKU aggregate references and invalid ledger mutations', async () => {
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log('FOOD_BATCH_FORMAT_OUTPUT_START');
      console.log(
        execFileSync('pnpm', ['exec', 'prettier', 'test/food-batch-schema.integration.test.ts'], {
          encoding: 'utf8',
        }),
      );
      console.log('FOOD_BATCH_FORMAT_OUTPUT_END');
    }
    const client = await database!.pool.connect();
    const ids = {
      actor: randomUUID(),
      region: randomUUID(),
      storeA: randomUUID(),
      storeB: randomUUID(),
      product: randomUUID(),
      skuX: randomUUID(),
      skuY: randomUUID(),
      lotA: randomUUID(),
      lotB: randomUUID(),
      aggA: randomUUID(),
      aggA2: randomUUID(),
      aggOtherStore: randomUUID(),
      aggOtherSku: randomUUID(),
    };
    const marker = randomUUID();
    const eventSql = `
      INSERT INTO food_batch_transactions (
        id, store_id, sku_id, batch_id, transaction_type,
        quantity_delta, on_hand_before, on_hand_after,
        reserved_before, reserved_after, blocked_before, blocked_after,
        aggregate_transaction_id, reference_type, reference_id,
        idempotency_key, reason, created_by_staff_account_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        0, 0, 0, 0, $9, 'FOOD_BATCH_TEST', $10, $11, 'disposable-only', $12
      )
    `;
    const event = (overrides: {
      storeId?: string;
      skuId?: string;
      batchId?: string;
      aggregateId?: string;
      key?: string;
      before?: number;
      after?: number;
      delta?: number;
    } = {}) => [
      randomUUID(),
      overrides.storeId ?? ids.storeA,
      overrides.skuId ?? ids.skuX,
      overrides.batchId ?? ids.lotA,
      'EXISTING_LOT_RECEIPT',
      overrides.delta ?? 2,
      overrides.before ?? 3,
      overrides.after ?? 5,
      overrides.aggregateId ?? ids.aggA,
      randomUUID(),
      overrides.key ?? `food-batch-${randomUUID()}`,
      ids.actor,
    ];

    // PostgreSQL aborts a transaction on constraint failure: a savepoint isolates
    // each negative fixture without disabling DB checks or deleting shared tables.
    async function rejectsSql(sql: string, params: unknown[], sqlstate: string) {
      await client.query('SAVEPOINT rejected_food_fixture');
      try {
        await expect(client.query(sql, params)).rejects.toMatchObject({ code: sqlstate });
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT rejected_food_fixture');
        await client.query('RELEASE SAVEPOINT rejected_food_fixture');
      }
    }

    try {
      await client.query('BEGIN');

      // CI's critical job runs db:migrate on xiaohai_test immediately before
      // this suite. Fail if 0041 or its real PostgreSQL FK/trigger is absent.
      const [schema] = (
        await client.query<{ batches: string | null; events: string | null }>(
          `SELECT to_regclass('public.food_batches')::text AS batches,
                  to_regclass('public.food_batch_transactions')::text AS events`,
        )
      ).rows;
      expect(schema).toEqual({
        batches: 'food_batches',
        events: 'food_batch_transactions',
      });
      const [checks] = (
        await client.query<{ scoped_fk: number; append_only: number }>(`
          SELECT
            (SELECT count(*)::integer FROM pg_constraint
              WHERE conname = 'food_batch_transactions_aggregate_scope_fk') AS scoped_fk,
            (SELECT count(*)::integer FROM pg_trigger
              WHERE tgname = 'food_batch_transactions_append_only' AND NOT tgisinternal) AS append_only
        `)
      ).rows;
      expect(checks).toEqual({ scoped_fk: 1, append_only: 1 });

      await client.query(
        'INSERT INTO staff_accounts (id, login_identifier, password_hash) VALUES ($1, $2, $3)',
        [ids.actor, `food-test-${marker}`, 'disposable-only'],
      );
      await client.query(
        `INSERT INTO regions (id, code, name, country_code, country_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [ids.region, `FOOD-${marker}`, 'Disposable region', 'CN', 'China'],
      );
      for (const [id, suffix] of [
        [ids.storeA, 'A'],
        [ids.storeB, 'B'],
      ]) {
        await client.query(
          `INSERT INTO stores
            (id, region_id, code, name, country_code, country_name, city, timezone,
             address_line, latitude, longitude)
           VALUES ($1, $2, $3, $4, 'CN', 'China', 'Chengdu', 'Asia/Shanghai', 'fixture', 30, 104)`,
          [id, ids.region, `FOOD-${suffix}-${marker}`, `Disposable store ${suffix}`],
        );
      }
      await client.query('INSERT INTO products (id, name) VALUES ($1, $2)', [
        ids.product,
        'Disposable food schema product',
      ]);
      for (const [id, suffix] of [
        [ids.skuX, 'X'],
        [ids.skuY, 'Y'],
      ]) {
        await client.query(
          'INSERT INTO skus (id, product_id, code, name, price_minor) VALUES ($1, $2, $3, $4, 100)',
          [id, ids.product, `FOOD-${suffix}-${marker}`, `Disposable SKU ${suffix}`],
        );
      }
      for (const [storeId, skuId] of [
        [ids.storeA, ids.skuX],
        [ids.storeA, ids.skuY],
        [ids.storeB, ids.skuX],
      ]) {
        await client.query(
          'INSERT INTO store_inventory (store_id, sku_id, on_hand) VALUES ($1, $2, 10)',
          [storeId, skuId],
        );
      }

      for (const [id, storeId, skuId] of [
        [ids.aggA, ids.storeA, ids.skuX],
        [ids.aggA2, ids.storeA, ids.skuX],
        [ids.aggOtherStore, ids.storeB, ids.skuX],
        [ids.aggOtherSku, ids.storeA, ids.skuY],
      ]) {
        await client.query(
          `INSERT INTO inventory_transactions
            (id, store_id, sku_id, transaction_type, quantity_delta, balance_after,
             reference_type, reference_id, idempotency_key, created_by_staff_account_id)
           VALUES ($1, $2, $3, 'PURCHASE_RECEIPT', 2, 12, 'FOOD_BATCH_TEST', $4, $5, $6)`,
          [id, storeId, skuId, randomUUID(), `agg-${randomUUID()}`, ids.actor],
        );
      }

      await client.query(
        `INSERT INTO food_batches
          (id, store_id, sku_id, lot_code, manufactured_on, expires_on,
           on_hand, created_by_staff_account_id)
         VALUES ($1, $2, $3, 'lot-a', '2026-10-01', '2026-12-01', 5, $4)`,
        [ids.lotA, ids.storeA, ids.skuX, ids.actor],
      );
      await client.query(
        `INSERT INTO food_batches
          (id, store_id, sku_id, lot_code, expires_on,
           on_hand, created_by_staff_account_id)
         VALUES ($1, $2, $3, 'lot-b', '2026-12-01', 5, $4)`,
        [ids.lotB, ids.storeB, ids.skuX, ids.actor],
      );

      const good = event({ key: `food-good-${marker}` });
      await client.query(eventSql, good);

      // Both mismatches used to pass the old id-only foreign key.
      await rejectsSql(eventSql, event({ aggregateId: ids.aggOtherStore }), '23503');
      await rejectsSql(eventSql, event({ aggregateId: ids.aggOtherSku }), '23503');
      await rejectsSql(eventSql, event({ batchId: ids.lotB, aggregateId: ids.aggA2 }), '23503');

      await rejectsSql(
        eventSql,
        event({ aggregateId: ids.aggA2, key: `food-good-${marker}` }),
        '23505',
      );
      await rejectsSql(
        eventSql,
        event({ aggregateId: ids.aggA2, before: -1, after: 1 }),
        '23514',
      );
      await rejectsSql(
        eventSql,
        event({ aggregateId: ids.aggA2, delta: -2, after: 1 }),
        '23514',
      );
      await rejectsSql(
        `INSERT INTO food_batches
           (store_id, sku_id, lot_code, manufactured_on, expires_on,
            created_by_staff_account_id)
         VALUES ($1, $2, 'invalid-date', '2026-12-02', '2026-12-01', $3)`,
        [ids.storeA, ids.skuX, ids.actor],
        '23514',
      );
      await rejectsSql(
        `INSERT INTO food_batches
           (store_id, sku_id, lot_code, expires_on, on_hand,
            created_by_staff_account_id)
         VALUES ($1, $2, 'lot-a', '2026-12-01', 5, $3)`,
        [ids.storeA, ids.skuX, ids.actor],
        '23505',
      );

      await rejectsSql(
        'UPDATE food_batch_transactions SET reason = $2 WHERE id = $1',
        [good[0], 'tampered'],
        '55000',
      );
      await rejectsSql(
        'DELETE FROM food_batch_transactions WHERE id = $1',
        [good[0]],
        '55000',
      );
      const count = await client.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM food_batch_transactions WHERE id = $1',
        [good[0]],
      );
      expect(count.rows[0]?.n).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
