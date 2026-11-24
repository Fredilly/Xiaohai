import { sql } from 'drizzle-orm';
import type { createDatabase } from '@xiaohai/db';
type Db = ReturnType<typeof createDatabase>['db'];
export type FoodTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Global per-SKU trace lock: ancestry recall and descendant fulfillment serialize.
 * Acquire before any stock row; multi-SKU callers use ascending SKU order. */
export async function lockFoodSku(tx: FoodTransaction, skuId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'food-sku:' + skuId},0))`);
}
