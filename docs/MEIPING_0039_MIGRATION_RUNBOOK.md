# Meiping review history 0039 — migration and reconciliation gate

**Scope:** This PR is only the Meiping review decision/correction history schema, transactional history writes, read models, and the one-time backfill of **current** review records. It does **not** import Meiping stock, modify products/SKUs/inventory, grant approvals, or enable production import.

## Data changes and compatibility

- `0039_awesome_snowbird.sql` adds `meiping_review_decision_history` and `meiping_review_correction_history`, keyed uniquely by `(session_id, source_row_number, version)`.
- Backfill copies the **currently persisted version** of each decision/correction into the new history tables, preserving actor, fields, reason and original `updated_at`. `captured_at` records migration time; it is not the original decision time.
- **Limitation:** overwritten revisions from before 0039 cannot be reconstructed from the mutable current tables. Do not describe this backfill as a complete historical timeline. Preserve existing audit logs independently.
- Future changes write the current row and immutable historical snapshot in the **same** database transaction. Versions cannot silently overwrite an existing history key.
- The migration is additive; old application readers remain compatible. Deploy schema before enabling new application writers. App rollback must **not** drop the history tables.

## Before touching any real database (manual release gate)

1. Require two independent human code reviews plus the database owner’s explicit written sign-off for **the exact commit and the exact environment**; CI green is not approval.
2. Identify database and current journal: check `drizzle.__drizzle_migrations`, confirm 0038 already applied, no unreviewed entries, and verify that 0039 has not been applied. Abort on mismatch.
3. Arrange a write-free migration window and take a restorable full DB snapshot using the approved operator backup procedure; record backup location, checksum, restoration procedure and owner. Do not copy Staff or review data into public logs.
4. Record read-only counts and non-sensitive mismatches from the queries below. Preserve a signed baseline:
   ```sql
   SELECT count(*) FROM meiping_review_decisions;
   SELECT count(*) FROM meiping_review_corrections;
   SELECT count(*) FROM meiping_review_sessions;
   SELECT count(*) FROM inventory_transactions;
   ```
5. Execute a **disposable** restored-backup rehearsal with the exact same migration files. Record lock duration, SQL errors, counts and post-deploy application contract checks; abort if mismatched.
6. Production rollout is separate from PR merge. Do not run `db:migrate` on production from CI or a developer terminal.

## Post-migration reconciliation (read only)

For a quiesced database, verify every **current** row was backfilled and matches its contents:

```sql
SELECT count(*) AS missing_or_mismatched_decision_snapshots
FROM meiping_review_decisions d
WHERE NOT EXISTS (
  SELECT 1 FROM meiping_review_decision_history h
  WHERE h.session_id = d.session_id
    AND h.source_row_number = d.source_row_number
    AND h.version = d.version
    AND h.action IS NOT DISTINCT FROM d.action
    AND h.counted_quantity IS NOT DISTINCT FROM d.counted_quantity
    AND h.reason IS NOT DISTINCT FROM d.reason
    AND h.updated_by_staff_account_id = d.updated_by_staff_account_id
    AND h.updated_at = d.updated_at
);

SELECT count(*) AS missing_or_mismatched_correction_snapshots
FROM meiping_review_corrections c
WHERE NOT EXISTS (
  SELECT 1 FROM meiping_review_correction_history h
  WHERE h.session_id = c.session_id
    AND h.source_row_number = c.source_row_number
    AND h.version = c.version
    AND h.proposed_fields = c.proposed_fields
    AND h.reason = c.reason
    AND h.updated_by_staff_account_id = c.updated_by_staff_account_id
    AND h.updated_at = c.updated_at
);
```

Both counts must be **zero**. Verify new history counts are at least the current row counts. Record `inventory_transactions` and unrelated stock/product counts before/after; **no changes** are expected from this migration. Verify version-uniqueness constraints, a representative session read, and new version writes only in isolated UAT.

## Abort, rollback and recovery

- **Before migration:** on failed backup/preflight/rehearsal, do not proceed.
- **Migration failure:** halt application rollout and write traffic; preserve error logs and backup. Determine whether Drizzle recorded 0039 and whether tables exist. Do not manually alter migration journal or rerun ad hoc SQL.
- **Post-migration app failure:** roll back **application binaries only**, keeping both history tables (additive/compatible). Stop new writes while reconciling; old app can still read current review tables. Restore traffic only after version/count/inventory checks are clean.
- **History backfill mismatch:** freeze writes; investigate and forward-repair in a separately reviewed migration using a restored clone first. Never blindly `DROP TABLE` the history tables or overwrite newer versions.
- **Irrecoverable schema/data incident:** restore the operator-approved full database backup to a separate recovery instance, verify integrity and reconcile writes made after snapshot before cutover. The rollback is **not** a naive reverse SQL migration once dual writes start.

**Required sign-offs (fill during release, not in PR):** operator, database owner, two reviewer handles, commit SHA, DB/environment, backup ID, rehearsal result, before/after counts, and go/no-go decision.
