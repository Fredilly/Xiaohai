# Issue #208 — Packaged food batch safety policy (code-only foundation)

**Status:** Draft PR, no database migration, no API route or Store/HQ UI, no
deployed inventory change. The pure domain helper **must not be presented as a
live stock gate** until the transactional storage and checkout integration is
separately reviewed and proven. This PR deliberately avoids manufacturing
unsupported food item data or silently expanding the Meiping migration.

## Scope

This policy covers **prepackaged food** and **factory-sealed beverages**,
tracked by Store + SKU + lot/batch. Each batch must include a unique ID,
Store, SKU, expiration date, on-hand, reserved, blocked stock and a disposition
(AVAILABLE / HELD / RECALLED). A business-local calendar date is **supplied**
by the caller; the policy never guesses the Store timezone from the server's
UTC clock.

- A labeled expiration date remains eligible through the end of that local
  date; expired batches are unavailable from the following local date.
- Reserved stock, blocked stock, held batches and recalled batches are never
  saleable. Product DRAFT / INACTIVE, inactive SKU or disabled SKU sale flag
  also force availability to zero.
- Every batch must belong to the queried Store + SKU, with valid nonnegative
  integer quantities and unique IDs; cross-store batch references are errors.
- All batches for a Store + SKU must reconcile exactly to its authoritative
  `store_inventory` on-hand and reserved counts (and packaged items cannot
  carry a rental reservation). Missing batches or mismatches **return zero
  saleable**, rather than falling back to an unverified aggregate quantity.
- The projection reports per-batch dispositions and aggregate expired/blocked
  quantities. Display ordering is by labeled expiry date, **not** a decision
  to automatically consume stock in FEFO order. No allocation strategy,
  receipt, sale or inventory ledger write is performed.

## What is explicitly not included yet

- No food batch tables, migrations or SQL backfill.
- No production or shared Staging writes, initial stock, receiving, refunds,
  purchase orders, stock movements, sale reservations or payment checkout.
- No food receipt/expiry UI, no store select, no public stock endpoint.
- No prepared beverages, recipe ingredients, container/packaging consumption,
  manufacture costs, or raw-material automatic deductions. These require
  explicit business confirmation before design.
- No changes to existing `store_inventory` or `inventory_transactions`.
  The Meiping one-time migration remains books + current Store stock only.

## Integrating safely (follow-on PRs, not implied by this one)

1. Review expiry-day/timezone semantics and which products require lots.
2. Add a separately reviewed migration and reconciliation/rollback runbook
   before introducing `food_batches` and immutable `food_batch_transactions`.
3. Define atomic receipt, adjust, reservation/release, sale, transfer, recall
   and disposal rules, including exact reconciliation with the current
   `store_inventory` authoritative balance. Never silently overwrite
   recorded inventory.
4. Provide identical food operations in authorized **Store and HQ** UIs,
   with server-side RBAC + Data Scope; keep account/role administration HQ-only.
5. Wire the batch calculation to server-side cart/checkout and customer
   Store selection after both read and write models are fully integrated.
   UI-only "out of stock" checks are insufficient.
6. Verify purchased/expired/frozen/held batches on disposable DB and real
   authorized UAT; include date change and concurrent checkout scenarios.

## Tests

- Pure domain tests: expiry day and next day, blocked & recalled, absent
  batches and total mismatch, DRAFT/INACTIVE disabled, cross-Store input,
  duplicate IDs, bad dates, negative balances.
- Strict contract tests: packaged kind, unit and net content, per-batch
  traceability, no fake ISBN/author, negative allocation, invalid chronology.
- All tests run offline with no environment secrets or database connection.

## Decisions Needed

- Use FEFO or FIFO for batch allocation, and what actions are allowed on
  short-date stock?
- Local Store timezone authority and owner-approved definition of last
  sellable date, per product category/regulatory labeling.
- Whether prepared food and drinks should hold finished-goods quantity only
  or deduct ingredients/packaging via recipes in the first release.
- Whether different Stores can own distinct food SKU prices/batch types.
