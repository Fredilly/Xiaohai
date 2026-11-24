# Issue #208 — Food batch movement preflight (proposal only)

**Status:** Draft, code-only review stacked on PR #215 → PR #214. No database table or migration, API route, stock mutation, inventory transaction, Store/HQ role, deployed service, public checkout or real inventory data is created.

## Scope

PR #214 provides the food-batch expiry/reconciliation domain, and #215 adds Store/HQ read-only comparison with actual aggregate balances. This change adds a pure function, `previewFoodBatchAdjustment`, to conservatively preview **single existing, reconciled** packaged-food/sealed-beverage lot changes:

- `EXISTING_LOT_RECEIPT`: verified positive units into an already-known, nonexpired AVAILABLE lot.
- `DAMAGE`: proposed loss only from nonreserved, nonblocked, nonexpired AVAILABLE units.
- `STOCKTAKE_LOSS`: counted quantity must be lower than current on-hand; an unexplained gain is not accepted.

Caller supplies an expected `store_inventory.version`, source reference, idempotency key and reason. **These are not authenticated, version-checked against DB or persisted here.** The output always includes `mode=DRY_RUN_ONLY`, `persisted=false`, `checkoutEnabled=false`. Source aggregate and all lots must reconcile both before and after proposal. Unknown, foreign-Store, expired, HELD and RECALLED lots cannot pass this workflow.

No code here grants permission to read or edit a Store's real data. There are no actual SQL writes, ledger inserts, stock reservation, transfer, recall disposal, food imports or paid calls.

## Separate database and audit design requiring independent approval

Propose separately reviewed Drizzle + SQL migrations for:

1. `food_batches`: UUID primary key, composite `(store_id,sku_id)` reference to preexisting `store_inventory`, lot code, manufacture date (nullable), expiry date, state, on-hand/reserved/blocked, row version and audit timestamps/actor. Reject negative values, impossible dates, invalid states, `reserved+blocked>on_hand` and foreign-Store references; settle logical lot-code uniqueness with the business owner.
2. `food_batch_transactions`: append-only Store/SKU/batch event, type, delta, pre/post batch and aggregate balances, source reference, server-verified actor, idempotency key, audit timestamp and request correlation. Prevent update/delete using **database privileges/constraints or reviewed trigger**, not frontend policy. Corrections must append reversal entries rather than rewrite history.
3. No silent backfill from existing aggregate stock. If genuine lot provenance is unknown or quantities cannot reconcile, packaged food remains **non-saleable** pending authorized verified intake.

## Mandatory transactional flow (NOT implemented in this PR)

- Server authenticates Staff and derives Store/HQ RBAC + Data Scope; caller-provided IDs never confer authorization.
- Derive business-local date from the Store's approved timezone; do not trust client-supplied preview date.
- In one PostgreSQL transaction, lock the `store_inventory` and relevant batch rows in a stable order; compare expected versions, source evidence and idempotency atomically.
- Reconcile **all** lots before and after the write. Update both authoritative aggregate and batch quantity, append an immutable batch event **and** the current aggregate `inventory_transactions`. Fail closed and roll back the whole transaction on any mismatch.
- Separate approved flows for new lots, gains, refunds, reserved/released quantities, recall/expiry, disposal, transfers and checkout. Do not use this preflight as a sale gate.
- Review migration rollout, compatibility, backups, rollback/reversal and operations separately. Never auto-drop recorded history, never apply to shared Staging or production without explicit owner authorization.

## Tests and release gates

Pure Vitest coverage includes receipt/loss, allocation floor, invalid counts, expired/held/recalled, mismatched/missing/foreign lot, evidence/version, no mutation and draft never sellable. Type/CI tests do **not** prove PostgreSQL locking, append-only permissions, live stock, domain permissions or real WeChat checkout.

Open business decisions: lot identity, handling expired inventory, food category labeling, FEFO/FIFO allocation, authoritative Store timezone, transfers and prepared-drink ingredients. Keep `STAGING_READY=false`. Neither the existing #195 recovery approval nor this PR authorizes deployment, migration, or live stock mutation.
