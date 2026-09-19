import { describe, expect, it } from 'vitest';
import { buildHqDashboardSummary } from './hq-dashboard-summary';

describe('M20 HQ dashboard summary', () => {
  it('derives operational counts from authorized domain data', () => {
    expect(
      buildHqDashboardSummary({
        storeCount: 3,
        inventory: [{ available: 4 }, { available: 6 }],
        rentals: [
          { status: 'BORROWED', isOverdue: false },
          { status: 'OVERDUE', isOverdue: true },
          { status: 'RETURNED', isOverdue: false },
        ],
        fulfillment: [
          { pickup: { status: 'ISSUED' }, delivery: null },
          { pickup: { status: 'VERIFIED' }, delivery: null },
          { pickup: null, delivery: { status: 'DISPATCHED' } },
        ],
      }),
    ).toEqual({
      storeCount: 3,
      inventorySkuCount: 2,
      inventoryAvailable: 10,
      activeRentalCount: 2,
      overdueRentalCount: 1,
      pendingFulfillmentCount: 2,
    });
  });

  it('keeps unavailable permission domains distinct from zero', () => {
    expect(buildHqDashboardSummary({ storeCount: 0 })).toEqual({
      storeCount: 0,
      inventorySkuCount: null,
      inventoryAvailable: null,
      activeRentalCount: null,
      overdueRentalCount: null,
      pendingFulfillmentCount: null,
    });
  });
});
