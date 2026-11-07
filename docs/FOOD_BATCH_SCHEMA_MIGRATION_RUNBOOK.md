# #208 Food batch persistence: SQL migration / rollback runbook

**Status: Draft review only.** This PR creates an *additive* Drizzle schema and SQL migration `0041_food_batch_ledger_foundation` for packaged-food/sealed-beverage lots. It does **not** call `db:migrate` on shared Staging/production, import food, backfill old stock, expose a new API, enable checkout or authorize a real inventory transaction. The GitHub CI disposable-PostgreSQL runner may migrate its isolated test database only.

## Source of truth and invariant boundary

- `store_inventory(store_id,sku_id)` remains the authoritative total inventory. A lot's composite foreign key requires that exact Store/SKU to exist; a cross-Store batch event cannot reference another Store's lot.
- `food_batches` is reserved for *verified packaged food and sealed beverages*, but the current catalog has no approved food type discriminator. **No insert service yet**. Until real category verification, provenance and reconciliation exist, the table must not authorize any sale.
- An unconfirmed lot defaults to `HELD`. Nonnegative quantity, allocation ceiling, version, date sequence and lot identity are DB constraints. `AVAILABLE` must never be inferred from the default. Duplicate store/SKU/lot-code/expiry records are rejected.
- No hidden import/backfill runs. Existing books, products, inventory, payments and Meiping migration data are untouched by this additive change.
- `food_batch_transactions` is a separate append-only record of a **proposed future** event model. Its database foreign key checks the complete (`store_id`, `sku_id`, `aggregate_transaction_id`) against the same Store/SKU aggregate stock event. The older ID-only foreign key is insufficient. The additional unique (`store_id`, `sku_id`, `id`) index on `inventory_transactions` is only a PostgreSQL FK target and does not rewrite existing stock history. Initially it allows only `EXISTING_LOT_RECEIPT`, `DAMAGE` and `STOCKTAKE_LOSS`; reservation/transfer/expiry/refund operations need their own reviewed models and migrations. All current on-hand event types require a linked existing `inventory_transactions` event and a Staff actor, and enforce balanced before/after quantity and unchanged reserved/blocked values.
- A database `BEFORE UPDATE OR DELETE` trigger forbids rewriting/deleting ledger rows. This is a database-level guard for normal application behavior, **not an absolute protection against a privileged DB owner who can disable triggers or modify the schema**. Verify least-privilege DB credentials before deployment.

## Safe CI / developer verification

1. Confirm the PR is stacked on #216 → #215 → #214 and compare the full combined schema against the current target `main`; do not rebase or merge without checking all upstream changes.
2. Use only an allowlisted disposable PostgreSQL URL. Run the existing migration journal guard, Drizzle check, typecheck, unit tests and critical integration. CI's disposable migration must create both empty tables and the mutation-reject trigger with no changes to the original Store inventory data.
3. Inspect `pg_constraint` for the **same Store/SKU composite aggregate FK** and lot FK, `pg_indexes` for the aggregate composite unique target, idempotency/lot unique keys, `pg_trigger` for `food_batch_transactions_append_only`, and `pg_proc` for its function. Attempt an UPDATE/DELETE of a specifically seeded test event only in an isolated, allowlisted disposable database to prove the trigger blocks mutation. Also test wrong Store/SKU, invalid dates, negative balance and duplicate idempotency/lot identity.
4. CI must apply migration 0041 to its allowlisted disposable PostgreSQL database **before** running `apps/api/test/food-batch-schema.integration.test.ts`. The guarded integration test performs real inserts and explicit negative tests inside a single transaction which is rolled back, proving that mismatched aggregate Store/SKU, foreign lot scope, duplicate idempotency, invalid balances/dates and ledger UPDATE/DELETE are rejected by PostgreSQL. If the migration is missing, it fails rather than silently passing. No test ever connects to shared Staging/production.
5. Record before/after migration journal state and that `food_batches` and `food_batch_transactions` remain empty after schema-only migration. Do not seed real merchant data.
5. Treat CI success as **code verification**, not production authorization. Obtain independent human review, a separately approved migration window and verified backup/restore capability before any shared Staging or production application.

## Preconditions for any future authorized live schema installation

- Fresh, independently verified backup and restore access, capacity, migration sequencing, existing deployed code compatibility and current migration journal. Staging is presently blocked (`STAGING_READY=false`) under #195.
- Explicit owner authorization naming **this exact migration**, environment, immutable commit and operator. Do not reuse Phase B / Phase C Docker approvals, or the unrelated Meiping import authorizations.
- Ensure no other PR is assigning `0041` to a different migration, verify `main` and all stacked PR bases; if another migration lands first, regenerate the journal/snapshot using repository tooling and get a new review.
- Audit DB owner privileges; the append-only trigger is bypassable by an account able to disable triggers. Future event insert code must authenticate Staff, enforce RBAC/Data Scope, lock aggregate and lot rows, check versions, and atomically append aggregate and lot events. There is **no such write code in this PR**.

## Post-apply reconciliation (when separately authorized)

- Verify both new tables exist and the migration journal reports exactly the reviewed migration.
- Confirm both new tables contain **zero rows** immediately after application.
- Check original `store_inventory`, `inventory_transactions` and existing catalog counts/checksums against preflight evidence.
- Confirm linked Store/SKU foreign keys, lot uniqueness, state/quantity/date constraints and the database append-only trigger.
- Keep checkout and the public API unchanged and disabled for batch-derived availability.

## Rollback / recovery (owner-controlled, no automatic destructive operations)

- Code rollback: disable the future food endpoints (none exist in this PR) and restore previously tested application binaries; older application code does not query the new tables.
- Schema rollback is **not** an automatic `DROP TABLE`: first independently establish whether food batches/events now contain records or are referenced by newer versions. Preserve records and existing backup. Any schema removal needs a separate reviewed migration, explicit owner approval and a verified data/export/recovery plan. Never truncate food or inventory history.
- A failed migration must stop and surface safe metadata. Do not reset or directly alter `drizzle.__drizzle_migrations`, do not force reapply and do not run any broad Docker/SQL cleanup.

## Outstanding product and operational decisions

Who owns a food SKU, authoritative Store timezone and expiry-day rule, FEFO/FIFO allocation, duplicate lot-code policy, food labeling/traceability, handling frozen/expired stock, individual Store pricing, and prepared-drink ingredient deduction. Resolve before enablement. Neither a successful migration nor `READY` from the #215 operator-supplied preview certifies real sellable stock.
