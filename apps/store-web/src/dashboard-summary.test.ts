import { describe, expect, it } from 'vitest';
import { summarizeDashboard } from './dashboard-summary';

describe('M19 dashboard summary', () => {
  it('derives operational counts without treating closed work as pending', () => {
    expect(
      summarizeDashboard({
        inventory: { items: [{ available: 3 }, { available: 0 }] },
        alerts: {
          alerts: [{ severity: 'LOW_STOCK' }, { severity: 'OUT_OF_STOCK' }],
        },
        fulfillment: {
          items: [
            { orderStatus: 'PAID', pickup: { status: 'ISSUED' }, delivery: null },
            { orderStatus: 'COMPLETED', pickup: { status: 'VERIFIED' }, delivery: null },
            {
              orderStatus: 'DELIVERING',
              pickup: null,
              delivery: { status: 'DISPATCHED' },
            },
            {
              orderStatus: 'COMPLETED',
              pickup: null,
              delivery: { status: 'DELIVERED' },
            },
          ],
        },
        rentals: {
          items: [
            { status: 'RESERVED', isOverdue: false },
            { status: 'BORROWED', isOverdue: false },
            { status: 'OVERDUE', isOverdue: true },
            { status: 'RETURNED', isOverdue: false },
          ],
        },
      }),
    ).toEqual({
      inventorySkus: 2,
      availableUnits: 3,
      lowStock: 2,
      outOfStock: 1,
      openFulfillment: 2,
      pickupWaiting: 1,
      deliveryActive: 1,
      activeRentals: 3,
      overdueRentals: 1,
    });
  });

  it('uses null for modules the staff account cannot read', () => {
    expect(
      summarizeDashboard({ inventory: null, alerts: null, fulfillment: null, rentals: null }),
    ).toEqual({
      inventorySkus: null,
      availableUnits: null,
      lowStock: null,
      outOfStock: null,
      openFulfillment: null,
      pickupWaiting: null,
      deliveryActive: null,
      activeRentals: null,
      overdueRentals: null,
    });
  });
});
