# Stacked Meiping → Store Catalog integration / 合并前集成检查

Status (2026-10-25): PR #143–#156 are merged. This integration/0038 repair is now included directly in Draft PR #157 for migration-safe review. PR #158 overlaps with these migrated fixes and must be reconciled or marked superseded after #157 merge; do not merge duplicate changes without rechecking.

## Dependency order (checked 2026-10-22)

- PR #143–#148: Meiping Excel preflight, staging decisions and HQ draft review
- PR #151–#153: review resume, proposed corrections, independent Meiping review
- PR #154: scoped Store Web Meiping draft review (historical migration only)
- PR #155: scoped store catalog read model
- PR #156: historical daily catalog correction **recommendations** and independent review (merged)
- PR #157: direct catalog edits, local store metadata, HQ store/Staff administration, **now includes forward-safe 0038 migration and integrated journal guard**
- PR #158: originally carried 0038 and migration guard, now overlaps #157; do not merge independently without reconciliation

Upstream #143–#156 have merged, including the final #156 concurrency/pending-pagination repairs. PR #150 is merged and #149 superseded. This direct-edit branch has merged latest main without force push. Never reapply a duplicate 0038 migration or deploy based on outdated stacked ancestry.

## Critical migration upgrade issue

The migration journal has `0036_store_catalog_correction_requests.when = 1792590000000`, but the later `0037_store_catalog_direct_edit.when = 1792584849830`. Since the Drizzle migrator compares migration timestamps to the latest applied timestamp, **an existing database at 0036 can skip 0037**, although a clean PostgreSQL integration database may appear healthy.

**Do not edit the already-published timestamp of 0037**: PR157 disposable environments may have recorded that exact timestamp, and changing it can rerun a non-idempotent ALTER TABLE migration. Instead, `0038_store_catalog_direct_edit_upgrade_repair.sql` repeats only the missing 0037 schema/permission guarantees using idempotent operations and a strictly newer journal timestamp. For a clean database 0037 may already have applied and 0038 is a no-op. For a database coming from 0036, 0038 adds missing columns, constraints, local metadata table, index, and `catalog.edit` permission.

The CI `migration journal guard` detects missing journal/SQL entries, duplicate/out-of-order migrations, and additional timestamp inversions. Only the **verified historical** 0036/0037 pair is exempted, contingent on the 0038 repair. Existing schema and migration files 0000–0037 are not rewritten.

## Current operational business decision (owner-confirmed)

- One **Store Account** role, not separate employee/manager catalog roles. Authorized store accounts can directly edit linked shared catalog fields and their own store-local metadata, with version checks and audit.
- HQ Account can edit cross-store catalog and store details, and exclusively manages Staff account lifecycle and store assignments.
- A shared book/ISBN/SKU price modification can affect multiple stores. The API verifies store scope and the UI must explain the shared impact. This is *not* GLOBAL Staff scope for store accounts.
- Inventory changes must use stocktake/adjustment plus immutable inventory transactions.
- PR156 correction recommendations remain historical and viewable. They do not apply master data; daily edits no longer require second-person review.
- Meiping Excel staging and independently reviewed source corrections are **one-time migration-only**. Their approval is not an inventory or catalog publication.

## Remaining integration acceptance before merging anything

1. On a freshly created **disposable** DB, run 0000→0038. Confirm `catalog.edit`, version columns, local metadata table and audit paths; run all relevant integration tests.
2. In CI, `packages/db/test/stacked-upgrade.integration.mjs` creates a **separate disposable DB**, migrates to 0036, then executes the full journal to 0038. It checks that version fields, nonnegative constraints, local metadata and the `catalog.edit` permission exist, and confirms a repeat migrate does not rerun applied SQL. Verify that this job passed on the current PR commit. Do **not** run it against existing PR153/PR156/PR157 UAT or real databases.
3. Verify store-owned metadata stays scoped while shared title/ISBN/price propagates; cross-store write/read 403 after scope revocation; staff deactivation session invalidation; Meiping DRAFT reviews never alter canonical catalog.
4. Verify #156's approved merge and run the **final PR #157 head** CI after every new change. An earlier green #158 CI does not replace the latest #157 checks.
5. Verify that existing staging/production database migration state is known and deployment/backups/rollback approach reviewed by the owner. No unattended cutover, merge or seed.

## Not yet proven

The separate disposable **CI rehearsal** is now implemented, but does not prove the state of any existing production/staging database. Production release readiness remains blocked until environment-specific migration inventory, backups and owner-approved merge/release plan.
