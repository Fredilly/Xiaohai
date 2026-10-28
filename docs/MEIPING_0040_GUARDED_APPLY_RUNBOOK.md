# 0040 Guarded Meiping Apply — migration and release gate

**Applies only after 0039 has been reviewed and deployed.** PR #162 introduces batch planning, independent approval, results and `INITIAL_MIGRATION` inventory ledger support. It must not be deployed as a side effect of a PR merge. Real Meiping files, production books/SKUs, inventory balances and stock transactions are **out of scope for developer testing**.

## Migration 0040 change inventory

- New `meiping_import_batches` and `meiping_import_results` tables; session and idempotency key uniqueness, batch-row uniqueness, FKs and indexes. The schema does **not** migrate existing Meiping source rows into inventory.
- Update `inventory_transactions_type_check` to admit `INITIAL_MIGRATION`. This changes a live inventory table's CHECK constraint. It can require an exclusive table lock while applied; a disposable/rehearsed lock window is mandatory.
- Add three Staff permissions (`meiping.import.preview`, `meiping.import.approve`, `meiping.import.execute`). Merely creating permissions does not grant them to a Staff account. Authorize roles individually after human review.
- The API execution flag defaults to OFF and requires explicit `MEIPING_IMPORT_EXECUTION_ENABLED=true`, `MEIPING_IMPORT_EXECUTION_CONFIRMATION=LOCAL_ONLY`, and nonproduction `APP_ENV`/`NODE_ENV`. The production code path must remain blocked until a separately reviewed release implementation and owner approval; do **not** change the flag here.

## Release preconditions — human-owned

1. Two independent human code approvals, DBA approval for 0040 and inventory owner signoff for the changed ledger constraint. Confirm all ancestor PRs and **0039** have safely entered the deployment base.
2. Capture full restorable database backup and migration journal state, confirm 0039 is the latest applied migration and 0040 has not been applied; record checksum and exact release SHA.
3. Rehearse on a **restored disposable** database with representative volume and concurrent application traffic; measure lock wait, statement duration, failed transactions and constraint correctness. Confirm the old application remains compatible with the newly widened allowed transaction types.
4. Record baseline counts for products, SKUs, store inventory, inventory transactions and all Meiping sessions/batches/results. Expect no change to product/stock/ledger counts when schema migration alone runs.
5. Schedule a maintenance window with an authorized operator; pause write traffic as needed. CI and developer terminals must not run migrations against production.

## Read-only acceptance queries

```sql
-- Independently verify that the Drizzle migration journal shows 0039 before 0040.
-- Do not infer migration state from table existence alone.

SELECT
  to_regclass('public.meiping_import_batches') IS NOT NULL AS batches_exist,
  to_regclass('public.meiping_import_results') IS NOT NULL AS results_exist;
SELECT count(*) FROM products;
SELECT count(*) FROM skus;
SELECT count(*) FROM store_inventory;
SELECT count(*) FROM inventory_transactions;
SELECT count(*) FROM meiping_import_batches;
SELECT count(*) FROM meiping_import_results;
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname = 'inventory_transactions_type_check';
SELECT key FROM permissions
WHERE key IN ('meiping.import.preview','meiping.import.approve','meiping.import.execute')
ORDER BY key;
```

Expected **immediately after schema-only rollout**: both new tables exist, all three permissions exist but have not been auto-assigned, and the new batch/result counts are zero. No book, SKU, stock, ledger or previous review row count may change. Inspect the constraint definition to confirm it retains all pre-existing types and adds only `INITIAL_MIGRATION`.

## UAT before any import authorization

- Only synthetic files on an isolated disposable database. Test other-store 403, unauthenticated 401, preview-only authorization, second distinct Staff approval, invalid/stale correction checksum and version, execution flag OFF, concurrent duplicate execute, duplicate ISBN/SKU resolution, nonzero existing inventory rejection, full transaction rollback and exact per-row/result/ledger count.
- **Mandatory pre-connection database guard:** all three Meiping apply PostgreSQL integration suites permit only local loopback databases named exactly `xiaohai_test` or `xiaohai_pr162_security_test`. They reject development, staging, production, remote hosts, malformed URLs, production/staging environment markers, and mismatched `DATABASE_URL` / effective `TEST_DATABASE_URL` before a pool is created. The unit tests exercise those negative cases without connecting to any database. New mutating PostgreSQL integration suites must add an equivalent fail-closed pre-connection guard or the PR safety checker rejects them.
- Confirm no silent inventory overwrite and no production import; an accepted correction alone never approves an import.
- On a disposable database, include one pre-existing hyphenated ISBN-10 edition with lowercase `x` and a known SKU. Verify preview and guarded synthetic execution both reuse the exact edition/product/SKU IDs instead of creating a second catalog record; ensure an `INITIAL_MIGRATION` ledger entry is scoped only to the intended store and count. This regression is not permission to import real stock.
- Capture signed dry-run reconciliation and evidence of independent approval with **no real data**. Confirm no credentials, complete file data or raw exception messages in HTTP responses/logs.

## Abort and recovery

- If a production migration fails, STOP rollout and Staff write traffic. Preserve backup, logs, journal, constraint definition and table counts; do not edit `drizzle.__drizzle_migrations` manually.
- If the schema is installed but application rollout fails, roll back application binaries only; **retain** the additive batch/result tables and widened ledger constraint. Dropping new tables after a batch is created could destroy the import audit trail.
- For a data issue, freeze import execution, compare the batch-row results, inventory transactions and per-SKU balances against a pre-apply snapshot. Do **not** replay the import with a fresh key or truncate the ledger. Any forward repair requires a separately approved change.
- Catastrophic restore requires a verified backup restored to an isolated recovery instance, with post-snapshot inventory transactions reconciled before cutover. No automatic down migration of a production import ledger.

**Release record required:** database/environment, backup reference, rehearsal results, 0039→0040 journal status, row-count baselines, constraint evidence, Staff permission grants, two independent reviewers, DBA/inventory-owner approvals and go/no-go decision.
