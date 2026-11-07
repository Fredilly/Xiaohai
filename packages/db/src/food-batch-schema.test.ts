import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { foodBatches, foodBatchTransactions } from './food-batch-schema.js';

const migration = readFileSync(
  new URL('../migrations/0041_food_batch_ledger_foundation.sql', import.meta.url),
  'utf8',
);

describe('food batch additive migration structure (#208)', () => {
  it('keeps new batches held by default, within an existing Store/SKU', () => {
    const table = getTableConfig(foodBatches);
    expect(table.name).toBe('food_batches');
    expect(table.columns.find((column) => column.name === 'state')?.default).toBe('HELD');
    expect(table.foreignKeys.length).toBe(2);
    expect(table.indexes.length).toBe(3);
    expect(table.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'food_batches_quantities_check',
        'food_batches_status_check',
        'food_batches_dates_check',
        'food_batches_lot_code_check',
      ]),
    );
  });

  it('requires an existing aggregate event and a Staff actor for each lot event', () => {
    const table = getTableConfig(foodBatchTransactions);
    expect(table.name).toBe('food_batch_transactions');
    expect(table.foreignKeys.length).toBe(3);
    expect(table.indexes.length).toBe(3);
    const column = (name: string) => table.columns.find((entry) => entry.name === name);
    expect(column('aggregate_transaction_id')?.notNull).toBe(true);
    expect(column('created_by_staff_account_id')?.notNull).toBe(true);
  });

  it('enforces append-only ledger semantics in SQL without a data backfill', () => {
    expect(migration).toContain('CREATE TRIGGER "food_batch_transactions_append_only"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
    expect(migration).toContain('FOOD_BATCH_LEDGER_APPEND_ONLY');
    expect(migration).toContain('food_batch_transactions_idempotency_unique');
    expect(migration).toContain('food_batches_inventory_fk');
    expect(migration).not.toContain('INSERT INTO');
    expect(migration).not.toContain('UPDATE "store_inventory"');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DROP TABLE');
  });
});
