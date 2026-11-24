# Issue #111 — Migration 0041 verification and rollback runbook

Migration file: `packages/db/migrations/0041_character_reference_import_provider.sql`.
Parent issue: #111; implementation PR: #227.

## Scope and execution approval

This migration only extends `character_reference_images_provider_check` to
allow the literal `IMPORTED`, **in addition to** the existing `MOCK` and
`BAILIAN`. The API uses this value only to truthfully identify user-supplied
PNG reference revisions; no AI cost or model call is associated with import.

**Code review is not DB migration execution authorization.** Do not apply to
shared, staging or production DB. Dedicated disposable #111 test database only,
with exact target host/database/name validated before migrations.

## Before migration (read-only reconciliation)

- Record the isolated database's identity, last applied migration and backup
  location (not secrets).
- Run a read-only count grouped by `provider` and `status` on
  `character_reference_images`; confirm no `IMPORTED` rows exist yet.
- Confirm no unrelated source branch is writing to the isolated database.
- Compare applied migration journal with repository through 0040, no missing
  migrations or checksum mismatch.
- Record the pre-migration constraint definition and table row count.

## Apply (only under separate approval)

Use the existing repository migration runner against the **approved disposable**
PostgreSQL instance after verifying the exact URL and the target DB guard.
Do not run this migration with an existing development, staging or production
`DATABASE_URL` or `TEST_DATABASE_URL`.

## After migration (read-only reconciliation)

- Verify `character_reference_images_provider_check` allows exactly
  `MOCK`, `BAILIAN`, `IMPORTED`.
- Verify counts of pre-existing rows are unchanged, and existing provider and
  media relationships still validate.
- Confirm migration journal entry 0041 is applied once and schema drift check
  does not report unexpected changes.
- Run guarded API integration tests with the disposable database guard enabled.
- Verify ordinary AI-generated reference revision behaviour remains unchanged.

## Application rollback and data recovery

Disable `PICTURE_BOOK_REFERENCE_IMPORT_ENABLED` first. Preserve a snapshot and
any imported media evidence before cleanup. An isolated schema rollback is safe
**only when no `IMPORTED` revisions remain**. If imported revisions exist,
decide explicitly whether to preserve or migrate them; never silently delete.

For a disposable empty test database only, the prior check may be restored:

```sql
ALTER TABLE character_reference_images
  DROP CONSTRAINT IF EXISTS character_reference_images_provider_check;
ALTER TABLE character_reference_images
  ADD CONSTRAINT character_reference_images_provider_check
  CHECK (provider IN ('MOCK','BAILIAN'));
```

Do not forge or erase existing READY references. Never revert the migration
journal without a recorded schema rollback and fresh reconciliation. Clean up
only owner-verified #111 isolated resources after preserving signed-off
evidence. The full acceptance procedure is in
`docs/M10_REFERENCE_IMPORT_UAT.md`.
