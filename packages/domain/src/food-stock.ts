/** Batch-level stock checks for packaged food and sealed drinks.
 *
 * This is a pure safety projection: it does not perform a receipt, sale,
 * reservation or inventory transaction. Callers must supply the store's
 * verified local business date; UTC "today" must not be guessed here.
 */
export type PackagedFoodBatchState = 'AVAILABLE' | 'HELD' | 'RECALLED';

export type PackagedFoodBatch = {
  id: string;
  storeId: string;
  skuId: string;
  expiresOn: string;
  onHand: number;
  reserved: number;
  blocked: number;
  state: PackagedFoodBatchState;
};

export type PackagedFoodAggregate = {
  storeId: string;
  skuId: string;
  onHand: number;
  reserved: number;
  rentalReserved: number;
  productStatus: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  skuStatus: 'ACTIVE' | 'INACTIVE';
  availableForSale: boolean;
};

export type PackagedFoodStockResult = {
  status: 'READY' | 'MISSING_BATCHES' | 'MISMATCH' | 'DISABLED';
  sellable: number;
  expiredOnHand: number;
  blockedOnHand: number;
  batches: Array<{
    id: string;
    expiresOn: string;
    disposition: 'AVAILABLE' | 'EXPIRED' | 'HELD' | 'RECALLED';
    sellable: number;
  }>;
};

const MAX_QUANTITY = 1_000_000_000;
const MAX_BATCHES = 500;

function quantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUANTITY;
}

function assertValidQuantity(value: number) {
  if (!quantity(value)) throw new Error('INVALID_STOCK_QUANTITY');
}

function assertBusinessDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_BUSINESS_DATE');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('INVALID_BUSINESS_DATE');
  }
}

function checkedSum(values: readonly number[]) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) throw new Error('INVALID_STOCK_QUANTITY');
  return sum;
}

export function evaluatePackagedFoodStock(input: {
  businessDate: string;
  aggregate: PackagedFoodAggregate;
  batches: readonly PackagedFoodBatch[];
}): PackagedFoodStockResult {
  const { businessDate, aggregate, batches } = input;
  assertBusinessDate(businessDate);
  if (batches.length > MAX_BATCHES) throw new Error('TOO_MANY_FOOD_BATCHES');
  for (const value of [aggregate.onHand, aggregate.reserved, aggregate.rentalReserved]) {
    assertValidQuantity(value);
  }
  if (aggregate.onHand < aggregate.reserved + aggregate.rentalReserved) {
    throw new Error('INVALID_STOCK_QUANTITY');
  }

  const seen = new Set<string>();
  for (const batch of batches) {
    if (!batch.id || seen.has(batch.id)) throw new Error('DUPLICATE_FOOD_BATCH');
    seen.add(batch.id);
    if (batch.storeId !== aggregate.storeId || batch.skuId !== aggregate.skuId) {
      throw new Error('CROSS_STORE_FOOD_BATCH');
    }
    assertBusinessDate(batch.expiresOn);
    for (const value of [batch.onHand, batch.reserved, batch.blocked]) {
      assertValidQuantity(value);
    }
    if (batch.reserved + batch.blocked > batch.onHand) {
      throw new Error('INVALID_STOCK_QUANTITY');
    }
    if (!['AVAILABLE', 'HELD', 'RECALLED'].includes(batch.state)) {
      throw new Error('INVALID_FOOD_BATCH_STATE');
    }
  }

  // Batch records cannot authorize sellable stock until they reconcile to
  // the authoritative store_inventory totals. A different aggregate balance
  // indicates a missing receipt, shipment, reservation or write transaction.
  const batchOnHand = checkedSum(batches.map((batch) => batch.onHand));
  const batchReserved = checkedSum(batches.map((batch) => batch.reserved));
  const reconciled =
    batches.length > 0 &&
    batchOnHand === aggregate.onHand &&
    batchReserved === aggregate.reserved &&
    aggregate.rentalReserved === 0;
  const active =
    aggregate.productStatus === 'ACTIVE' &&
    aggregate.skuStatus === 'ACTIVE' &&
    aggregate.availableForSale;
  const status: PackagedFoodStockResult['status'] = !batches.length
    ? 'MISSING_BATCHES'
    : !reconciled
      ? 'MISMATCH'
      : !active
        ? 'DISABLED'
        : 'READY';

  // Date-only expiry: an item expires *after* its labeled expiration day
  // in the store's local calendar. Keep allocation strategy undecided.
  const assessed = batches.map((batch) => {
    const expired = batch.expiresOn < businessDate;
    const disposition: PackagedFoodStockResult['batches'][number]['disposition'] = expired
      ? 'EXPIRED'
      : batch.state === 'AVAILABLE'
        ? 'AVAILABLE'
        : batch.state;
    return {
      id: batch.id,
      expiresOn: batch.expiresOn,
      disposition,
      sellable:
        status === 'READY' && disposition === 'AVAILABLE'
          ? batch.onHand - batch.reserved - batch.blocked
          : 0,
    };
  });
  const sellable = checkedSum(assessed.map((batch) => batch.sellable));
  const expiredOnHand = checkedSum(
    batches.filter((batch) => batch.expiresOn < businessDate).map((batch) => batch.onHand),
  );
  const blockedOnHand = checkedSum(
    batches.map((batch) => (batch.state === 'AVAILABLE' ? batch.blocked : batch.onHand)),
  );

  return {
    status,
    sellable,
    expiredOnHand,
    blockedOnHand,
    batches: assessed.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)),
  };
}
