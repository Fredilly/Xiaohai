# #208 Store/HQ food batch reconciliation preview — READ ONLY

**Status:** Draft code-only follow-on to [#214](https://github.com/Fredilly/Xiaohai/pull/214).
No schema/migration, stock update, real Store data import, publish, paid
checkout or cloud operation is included. Merge only after parent #214
passes exact-current-HEAD CI and independent human approvals.

## Shared operational feature

An authorized **Store** employee or **HQ** employee can preview how proposed
packaged-food lots compare with the Store's **actual current** `store_inventory`
summary:

- Store API:
  `POST /api/v1/staff/stores/:storeId/inventory/food-batches/:skuId/preview`
  authenticates Staff, requires `stores.read` + `inventory.read`, and
  checks `getStaffStore` against server-authenticated Store scope.
- HQ API:
  `POST /api/v1/staff/inventory/stores/:storeId/food-batches/:skuId/preview`
  requires `inventory.read` and true `GLOBAL` data scope. Both endpoints
  call the *same service and domain evaluator*. HQ does not gain separate
  business rules and Store does not gain staff-account administration.
- The body supplies a **simulation business date** and at most 500 complete
  proposed batches with Store ID, SKU ID, lot code, manufacture/expiration
  dates, on-hand, reserved, blocked and disposition. The server rejects
  malformed, cross-Store, cross-SKU or duplicate batches.
- The service loads Store + SKU totals and product/SKU sale flags directly
  from the existing PostgreSQL read model, and performs the #214 fail-closed
  reconciliation and expiry evaluation. It returns
  `mode=READ_ONLY_PROPOSAL`, `checkoutEnabled=false` **always**, even if
  the proposed lots' status is `READY`.
- `READY` means only that these **operator-supplied proposed records** would
  reconcile against the **observed aggregate** at preview time. It does
  **not** establish that any actual lot/expiry value exists in the DB,
  that real products are edible/legal for sale, or that a subsequent
  checkout may trust the proposed quantity.

## Acceptance and safety

The API creates **no new database table**, does not write stock, does not
log proposed batch data and never makes a signed/public consumer endpoint.
Stock counts remain authoritative in the existing `store_inventory`
table; no inventory ledger entry is written, because no mutation occurs.

- Mocked route tests: no session, missing permissions, foreign-store denial,
  missing GLOBAL scope, strict invalid body, same Store/HQ business function.
- Disposable PostgreSQL integration: seed isolated Store+SKU fixtures only
  behind `assertMeipingApplyDisposableDatabase(process.env)`; confirm real
  totals, missing lot/mismatch, expiry, disabled product, foreign lot and
  unknown SKU fail-safe behavior. No staging/production connection.
- No live POS stock ingestion or production availability is claimed.

## Remaining steps before operational inventory / 上线门禁

1. Fred/owner review of food expiry-day policy, prepared-drink ingredients,
   and cross-store food SKU pricing/ownership.
2. Separate reviewed Drizzle schema + generated migration for
   `food_batches` and immutable movement history, with backup, safety
   guard, rehearsal, rollback/reconciliation runbook and explicit owner
   approval **before running** on shared Staging or production.
3. Atomic batch receipt, release, loss, transfer, recall, sale and refund
   flows that update both batch and aggregate/immutable ledger in the same
   transaction, with idempotency and row locks.
4. Shared Store/HQ UI for intake and operations; explicit public consumer
   selected-Store availability; server-side reserve/checkout recheck.
5. Independent approval and real-data UAT. Do not change
   `STAGING_READY=false` or treat CI success as real business acceptance.

Related: #208, #214, #195, #116.
