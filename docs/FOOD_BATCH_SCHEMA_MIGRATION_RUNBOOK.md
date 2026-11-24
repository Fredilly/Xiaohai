# #208 Food multi-lot ledger: migration and transactional writer

## Scope and current status

Code review only; no shared Staging/production migration, real merchant stock, BOS,
checkout, API activation or deployment is authorized by this document.

PR dependency order remains **#214 → #215 → #216 → #217**. The existing branches
have been updated with current main; none has been merged into main. Main's
`0000–0041` migration files and journal entries are retained. The *unpublished food
schema draft*, formerly numbered `0041`, is regenerated as
`0042_food_batch_ledger_foundation` with a Drizzle-generated snapshot. This avoids
colliding with main's `0041_character_reference_import_provider`; it is NOT a
repair procedure for a database that already installed the older food draft.
Such an environment must stop and receive a separately reviewed recovery plan.

This PR now also includes an **internal** `FoodBatchMovementService` for an
already registered, reconciled Store/SKU and existing lots. It has no registered
HTTP endpoint and creates no product or lot. It must not be described as a live
Store/HQ food workflow. Verified category/provenance intake, UI, freeze/release,
expiry disposal, reservations, FEFO, sales/refunds and checkout remain separate
work. Existing read-only proposal endpoints stay read-only.

## Operation model and integrity

- One operation creates **one aggregate inventory transaction** and **one event
  per affected lot**. `(aggregate_transaction_id,batch_id)` is unique; the old
  global unique aggregate-ID index is removed from the unpublished draft.
- All child events share the aggregate's Store/SKU, actor, reference and reason.
  `EXISTING_LOT_RECEIPT` maps to `PURCHASE_RECEIPT`, `DAMAGE` to `ADJUSTMENT_OUT`,
  and `STOCKTAKE_LOSS` to `STOCKTAKE_LOSS`. Mixed operation kinds are rejected.
- Aggregate reference/source are `FOOD_BATCH_OPERATION`. A marked aggregate
  **cannot commit without children**. Deferred constraints check both directions
  and require the sum of child signed deltas (using bigint) to equal the aggregate
  delta. Incomplete, excessive or missing splits abort the transaction.
- Inserting an event locks its parent. Both food events and their aggregate
  history reject UPDATE/DELETE. These controls do not resist a DB owner who can
  disable triggers; deployment still needs least-privilege role review.
- The writer authenticates *server-provided* Staff context permissions
  (`inventory.read` plus `inventory.receive` or `inventory.adjust`) and Store
  data scope. No client scope or caller-supplied date is trusted.
- The writer serializes each UUID operation key with a transaction advisory lock,
  then locks aggregate stock and all lots in stable order. It verifies inventory
  and lot versions, actual lot totals/reservations against aggregate stock, and
  remaining unallocated stock before writing anything.
- Same-key retries, including reordered input lines, return the original result.
  Changed payload/actor/key reuse fails closed. Lot-event keys are derived from
  operation UUID + lot UUID. A lost response never justifies a new operation key.
- Store-local date is calculated from the stored timezone and PostgreSQL's
  transaction clock. Expired, HELD and RECALLED lots cannot be received/deducted
  through this writer. Blocked/reserved stock cannot be consumed. Explicit
  expiry/quarantine disposal and allocation changes require their own workflow;
  they must not be emulated by silently changing balances.
- Nothing publishes DRAFT products or enables checkout. Existing totals remain
  the sole aggregate source of truth; Redis does not store stock balances.

## Reproducible verification

Use only `assertMeipingApplyDisposableDatabase`-allowlisted disposable local
PostgreSQL. Set both effective URLs to the **same** explicitly owned
`xiaohai_test`; no shared/remote database, `.env` substitution or production role.
Use the repository's `db:migrate` for the full real migration chain first.

```bash
pnpm --filter @xiaohai/db db:migrate
pnpm --filter @xiaohai/api exec vitest run --config vitest.integration.config.ts \
  test/food-batch-schema.integration.test.ts \
  test/food-batch-movement.integration.test.ts
node scripts/check-migration-chain.mjs
pnpm --filter @xiaohai/db db:check
```

Work verification used a newly initialized, private scratch cluster running
PostgreSQL **16.16**, bound only to `127.0.0.1:45928` with Unix sockets disabled,
owner `i208_test_owner`, database `xiaohai_test`. Its lifecycle and all child
migration/test processes ran together; the server stopped at the end. This is
independent of original Mac/#111 resources and contains synthetic fixtures only.
A successful run applied **all 43 real migrations (0000–0042)** and passed the
real schema and multi-lot service integration tests. No synthetic schema was
substituted. Record the latest run's test count and commit separately.

Coverage includes positive two-lot receipt/damage/stocktake loss; parallel
same-key replay; parallel distinct deductions at the same version; changed
payload/actor; wrong Store/lot; duplicate lots; stale versions; expiry, HELD,
RECALLED, blocked stock; aggregate mismatch; incomplete/absent child groups failing
at COMMIT with full rollback; and food aggregate/event mutation denial.

## Shared-environment application remains STOP

Before any authorized installation: exact-head independent review, current CI,
canonical main journal/hash comparison, explicit owner-scoped migration window,
verified backup **and restoration**, least-privilege DB roles, disk/capacity,
old-code compatibility and a controlled write window. `STAGING_READY=false`
remains unchanged. Existing #195 cleanup permissions are unrelated and consumed.

Immediately before/after migration compare original catalog, inventory and
ledger counts/checksums; both new food tables should be empty after schema-only
installation. Inspect actual composite FKs, unique indexes, deferred triggers and
immutable-history triggers. Execute negative checks only in the disposable clone.

Rollback is code rollback / endpoint disablement. Do not automatically drop,
truncate, disable triggers, reset the Drizzle journal, replay migrations blindly,
or delete lots/events. If any food history exists, retain it and require a
separate data-preserving recovery migration and verified backup. A green test or
internal writer does not authorize food sales, actual migration or release.
