type InventoryItem = {
  available: number;
};

type RentalItem = {
  status: string;
  isOverdue: boolean;
};

type FulfillmentItem = {
  pickup: { status: string } | null;
  delivery: { status: string } | null;
};

export type HqDashboardSummaryInput = {
  storeCount?: number;
  inventory?: InventoryItem[];
  rentals?: RentalItem[];
  fulfillment?: FulfillmentItem[];
};

export type HqDashboardSummary = {
  storeCount: number | null;
  inventorySkuCount: number | null;
  inventoryAvailable: number | null;
  activeRentalCount: number | null;
  overdueRentalCount: number | null;
  pendingFulfillmentCount: number | null;
};

export function buildHqDashboardSummary(input: HqDashboardSummaryInput): HqDashboardSummary {
  return {
    storeCount: input.storeCount ?? null,
    inventorySkuCount: input.inventory?.length ?? null,
    inventoryAvailable:
      input.inventory?.reduce((sum, item) => sum + item.available, 0) ?? null,
    activeRentalCount:
      input.rentals?.filter((item) => !['RETURNED', 'CANCELLED'].includes(item.status)).length ?? null,
    overdueRentalCount: input.rentals?.filter((item) => item.isOverdue).length ?? null,
    pendingFulfillmentCount:
      input.fulfillment?.filter((item) => {
        if (item.pickup) return !['VERIFIED', 'CANCELLED'].includes(item.pickup.status);
        if (item.delivery) return !['DELIVERED', 'CANCELLED'].includes(item.delivery.status);
        return false;
      }).length ?? null,
  };
}
