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

  it('still checks current store authorization before returning an old result', async () => {
    const { service } = serviceWithReplay(original);
    vi.spyOn(service, 'requireStoreAccess').mockRejectedValue(new Error('FORBIDDEN'));
    await expect(service.issue(context, input)).rejects.toThrow('FORBIDDEN');
  });
});
