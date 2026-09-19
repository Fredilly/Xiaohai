export type DashboardSummary = {
  inventorySkus: number | null;
  availableUnits: number | null;
  lowStock: number | null;
  outOfStock: number | null;
  openFulfillment: number | null;
  pickupWaiting: number | null;
  deliveryActive: number | null;
  activeRentals: number | null;
  overdueRentals: number | null;
};

type InventoryInput = { items: Array<{ available: number }> } | null;
type AlertInput = { alerts: Array<{ severity: string }> } | null;
type FulfillmentInput = {
  items: Array<{
    orderStatus: string;
    pickup: { status: string } | null;
    delivery: { status: string } | null;
  }>;
} | null;
type RentalInput = {
  items: Array<{ status: string; isOverdue: boolean }>;
} | null;

export function summarizeDashboard(input: {
  inventory: InventoryInput;
  alerts: AlertInput;
  fulfillment: FulfillmentInput;
  rentals: RentalInput;
}): DashboardSummary {
  const pickupWaiting = input.fulfillment
    ? input.fulfillment.items.filter(
        (item) =>
          item.pickup?.status === 'ISSUED' &&
          (item.orderStatus === 'PAID' || item.orderStatus === 'PICKUP_READY'),
      ).length
    : null;
  const deliveryActive = input.fulfillment
    ? input.fulfillment.items.filter(
        (item) =>
          item.delivery !== null &&
          (item.delivery.status === 'PENDING' || item.delivery.status === 'DISPATCHED') &&
          (item.orderStatus === 'PAID' || item.orderStatus === 'DELIVERING'),
      ).length
    : null;

  return {
    inventorySkus: input.inventory ? input.inventory.items.length : null,
    availableUnits: input.inventory
      ? input.inventory.items.reduce((sum, item) => sum + item.available, 0)
      : null,
    lowStock: input.alerts ? input.alerts.alerts.length : null,
    outOfStock: input.alerts
      ? input.alerts.alerts.filter((item) => item.severity === 'OUT_OF_STOCK').length
      : null,
    openFulfillment:
      pickupWaiting === null || deliveryActive === null ? null : pickupWaiting + deliveryActive,
    pickupWaiting,
    deliveryActive,
    activeRentals: input.rentals
      ? input.rentals.items.filter((item) =>
          ['RESERVED', 'BORROWED', 'OVERDUE'].includes(item.status),
        ).length
      : null,
    overdueRentals: input.rentals
      ? input.rentals.items.filter((item) => item.status === 'OVERDUE' || item.isOverdue).length
      : null,
  };
}
