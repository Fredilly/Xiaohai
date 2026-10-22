# Stacked Meiping → Store Catalog integration / 合并前集成检查

Status: Draft only. Based on PR #157; do not merge or deploy this chain without a human review.

## Dependency order (checked 2026-10-22)

- PR #143–#148: Meiping Excel preflight, staging decisions and HQ draft review
- PR #151–#153: review resume, proposed corrections, independent Meiping review
- PR #154: scoped Store Web Meiping draft review (historical migration only)
- PR #155: scoped store catalog read model
- PR #156: historical daily catalog correction **recommendations** and independent review
- PR #157: direct catalog edits, local store metadata, HQ store/Staff administration
- This PR: forward-safe migration and integrated journal guard

All listed PRs are stacked Draft. Existing PR #150 staging migration correction is already in main; PR #149 is superseded. Avoid cherry-picking the tail to main or force-updating parent branches.

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
2. On another **disposable DB** with migrations only through 0036, run the current migrator. Verify that 0038 repairs a skipped 0037; compare schema and permissions to fresh install. Do not run the upgrade experiment against the existing PR153/PR156/PR157 UAT databases or real stores.
3. Verify store-owned metadata stays scoped while shared title/ISBN/price propagates; cross-store write/read 403 after scope revocation; staff deactivation session invalidation; Meiping DRAFT reviews never alter canonical catalog.
4. Record status of **each** upstream Draft PR's head CI, including migrations and the stacked base chain. Passing only tail PR CI is not proof that every predecessor has been reviewed.
5. Verify that existing staging/production database migration state is known and deployment/backups/rollback approach reviewed by the owner. No unattended cutover, merge or seed.

## Not yet proven

The CI migration-chain check and fresh PostgreSQL tests cannot prove an **incremental 0036→0038 upgrade** without the separate disposable upgrade rehearsal. Production release readiness remains blocked until that dry run and owner-approved merge/release plan.
