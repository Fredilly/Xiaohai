import type { PackagedFoodStockResult } from './food-stock.js';

/** Deterministic expiry-first allocation over a verified, store-local stock projection.
 * The projection is only a plan: the caller MUST lock and revalidate persisted rows
 * in a single transaction before changing reservation balances.
 */
export function planFoodFefoAllocation(
  projection: PackagedFoodStockResult,
  quantity: number,
): Array<{ batchId: string; quantity: number }> {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000)
    throw new Error('INVALID_FOOD_QUANTITY');
  if (projection.status !== 'READY' || projection.sellable < quantity)
    throw new Error('INSUFFICIENT_FOOD_STOCK');

  let remaining = quantity;
  const result: Array<{ batchId: string; quantity: number }> = [];
  for (const batch of [...projection.batches].sort(
    (a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.id.localeCompare(b.id),
  )) {
    if (batch.disposition !== 'AVAILABLE' || batch.sellable <= 0) continue;
    const allocated = Math.min(remaining, batch.sellable);
    if (allocated) result.push({ batchId: batch.id, quantity: allocated });
    remaining -= allocated;
    if (remaining === 0) break;
  }
  if (remaining !== 0) throw new Error('INSUFFICIENT_FOOD_STOCK');
  return result;
}
