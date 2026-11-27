import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@xiaohai/db';
import { InventoryOperationsService } from '../src/inventory/inventory-operations-service.js';

const input = {
  storeId: '11111111-1111-4111-8111-111111111111',
  skuId: '22222222-2222-4222-8222-222222222222',
  expectedVersion: 1,
  quantity: 2,
  reason: '实盘出库',
  idempotencyKey: crypto.randomUUID(),
};
const context = {
  staffAccountId: 'staff-a',
  loginIdentifier: 'synthetic-staff',
  permissions: [],
  dataScopes: [{ type: 'STORE' as const, id: input.storeId }],
};
const original = {
  ...input,
  quantityDelta: -2,
  transactionType: 'ISSUE',
  referenceType: 'STOCK_ISSUE',
  createdByStaffAccountId: context.staffAccountId,
  metadata: null,
};

function serviceWithReplay(existing: object) {
  const limit = vi.fn().mockResolvedValue([existing]);
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    execute: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const db = { transaction: async (run: (value: typeof tx) => unknown) => await run(tx) };
  const service = new InventoryOperationsService(
    db as unknown as ReturnType<typeof createDatabase>['db'],
  );
  vi.spyOn(service, 'requireStoreAccess').mockResolvedValue({
    id: input.storeId,
    regionId: 'synthetic-region',
    franchiseeId: null,
  });
  return { service, tx };
}

function serviceWithOpeningReplay(existing: object) {
  // Opening first checks that the SKU has no food batch, then reads the
  // immutable positive-opening transaction by the original request key.
  const limit = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([existing]);
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    execute: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const db = { transaction: async (run: (value: typeof tx) => unknown) => await run(tx) };
  const service = new InventoryOperationsService(
    db as unknown as ReturnType<typeof createDatabase>['db'],
  );
  vi.spyOn(service, 'requireStoreAccess').mockResolvedValue({
    id: input.storeId,
    regionId: 'synthetic-region',
    franchiseeId: null,
  });
  return { service, tx, limit };
}

describe('inventory idempotency replay binding (no database connection)', () => {
  it('replays an identical issue without locking or mutating a second balance', async () => {
    const { service, tx } = serviceWithReplay(original);
    expect(await service.issue(context, input)).toEqual(original);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it.each([
    { storeId: 'another-store' },
    { skuId: 'another-sku' },
    { quantityDelta: -3 },
    { transactionType: 'ADJUSTMENT_OUT' },
    { reason: 'another reason' },
    { createdByStaffAccountId: 'another-staff' },
    { referenceType: 'ORDER' },
    { metadata: { source: 'STORE_OPENING_COUNT' } },
    { metadata: { source: 'ANOTHER_INVENTORY_WORKFLOW' } },
  ])('rejects an unrelated ledger entry sharing the same key: %j', async (change) => {
    const { service, tx } = serviceWithReplay({ ...original, ...change });
    await expect(service.issue(context, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('replays an identical adjustment but never an issue with the same signed delta', async () => {
    const adjustment = { ...input, quantityDelta: -2 };
    const { service } = serviceWithReplay(original);
    await expect(service.adjust(context, adjustment)).rejects.toMatchObject({ code: 'CONFLICT' });
    const matching = {
      ...original,
      transactionType: 'ADJUSTMENT_OUT',
      referenceType: 'INVENTORY_ADJUSTMENT',
    };
    expect(await serviceWithReplay(matching).service.adjust(context, adjustment)).toEqual(matching);
  });

  it('binds new manual stock ledger replays to the original version precondition', async () => {
    const newer = {
      ...original,
      metadata: { source: 'STORE_MANUAL_STOCK', expectedVersion: input.expectedVersion },
    };
    expect(await serviceWithReplay(newer).service.issue(context, input)).toEqual(newer);
    await expect(
      serviceWithReplay(newer).service.issue(context, { ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      serviceWithReplay({
        ...newer,
        metadata: { source: 'STORE_MANUAL_STOCK', expectedVersion: '1' },
      }).service.issue(context, input),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const adjustment = { ...input, quantityDelta: -2 };
    const adjustedLedger = {
      ...newer,
      transactionType: 'ADJUSTMENT_OUT',
      referenceType: 'INVENTORY_ADJUSTMENT',
    };
    expect(await serviceWithReplay(adjustedLedger).service.adjust(context, adjustment)).toEqual(
      adjustedLedger,
    );
    await expect(
      serviceWithReplay(adjustedLedger).service.adjust(context, {
        ...adjustment,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('still checks current store authorization before returning an old result', async () => {
    const { service } = serviceWithReplay(original);
    vi.spyOn(service, 'requireStoreAccess').mockRejectedValue(new Error('FORBIDDEN'));
    await expect(service.issue(context, input)).rejects.toThrow('FORBIDDEN');
  });
});

describe('first stock opening replay belongs to the original staff and ledger', () => {
  const opening = {
    storeId: input.storeId,
    skuId: input.skuId,
    initialQuantity: 7,
    reason: 'Synthetic first physical count',
    idempotencyKey: input.idempotencyKey,
  };
  const record = {
    storeId: opening.storeId,
    skuId: opening.skuId,
    idempotencyKey: opening.idempotencyKey,
    transactionType: 'ADJUSTMENT_IN',
    quantityDelta: 7,
    balanceAfter: 7,
    referenceType: 'INVENTORY_ADJUSTMENT',
    reason: opening.reason,
    metadata: { source: 'STORE_OPENING_COUNT' },
    createdByStaffAccountId: context.staffAccountId,
  };

  it('replays the same staff count without a second inventory row, transaction or audit', async () => {
    const { service, tx, limit } = serviceWithOpeningReplay(record);
    expect(await service.registerOpeningStock(context, opening, 'synthetic')).toEqual({
      storeId: input.storeId,
      skuId: input.skuId,
      onHand: 7,
      version: 1,
    });
    expect(limit).toHaveBeenCalledTimes(2);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it.each([
    { storeId: 'another-store' },
    { skuId: 'another-sku' },
    { quantityDelta: 8 },
    { balanceAfter: 8 },
    { transactionType: 'ADJUSTMENT_OUT' },
    { referenceType: 'STOCK_ISSUE' },
    { reason: 'another count' },
    { createdByStaffAccountId: 'other-staff' },
    { metadata: { source: 'ANOTHER_WORKFLOW' } },
  ])('rejects a mismatched original opening ledger: %j', async (change) => {
    const { service, tx } = serviceWithOpeningReplay({ ...record, ...change });
    await expect(service.registerOpeningStock(context, opening, 'synthetic')).rejects.toMatchObject(
      {
        code: 'CONFLICT',
      },
    );
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('requires current store authorization even for an exact historical replay', async () => {
    const { service, tx } = serviceWithOpeningReplay(record);
    vi.spyOn(service, 'requireStoreAccess').mockRejectedValue(new Error('FORBIDDEN'));
    await expect(service.registerOpeningStock(context, opening, 'synthetic')).rejects.toThrow(
      'FORBIDDEN',
    );
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
