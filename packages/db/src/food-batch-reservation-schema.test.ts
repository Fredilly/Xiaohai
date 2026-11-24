import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { foodBatchReservationEvents, foodBatchReservations } from './food-batch-schema.js';

const migration = readFileSync(
  new URL('../migrations/0046_food_fefo_reservations.sql', import.meta.url),
  'utf8',
);

describe('0046 food FEFO reservation foundation', () => {
  it('stores scoped order/lot allocations and append-only evidence separately from stock movements', () => {
    const rows = getTableConfig(foodBatchReservations);
    expect(rows.foreignKeys).toHaveLength(2);
    expect(rows.indexes.map((entry) => entry.config.name)).toContain(
      'food_batch_reservations_order_batch_unique',
    );
    expect(rows.checks.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        'food_batch_reservations_quantity_check',
        'food_batch_reservations_status_check',
      ]),
    );
    const events = getTableConfig(foodBatchReservationEvents);
    expect(events.foreignKeys).toHaveLength(1);
    expect(events.indexes.map((entry) => entry.config.name)).toContain(
      'food_batch_reservation_events_key_unique',
    );
  });

  it('rejects event mutation, partial histories and reservation identity rewriting', () => {
    expect(migration).toContain('FOOD_RESERVATION_EVENT_APPEND_ONLY');
    expect(migration).toContain('FOOD_RESERVATION_IMMUTABLE');
    expect(migration).toContain('FOOD_RESERVATION_EVENT_MISMATCH');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('food_batch_reservations_scope_fk');
    expect(migration).not.toContain('INSERT INTO');
    expect(migration).not.toContain('UPDATE "store_inventory"');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DROP TABLE');
  });
});
