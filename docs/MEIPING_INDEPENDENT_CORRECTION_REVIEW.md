# M3 Meiping — Independent Correction Review (Draft only)

## Purpose
Stacked on #152. Independent staff review can accept or reject a specific version of a proposed Excel metadata correction. **ACCEPTED is a reviewer verdict on a suggestion only, never authorization to import, update a product, resolve the original source disposition or publish stock.**

## Access & four-eyes control
- A dedicated permission \`meiping.correction.review\` is registered by migration 0035. **No role is automatically assigned** by migration. Local-only \`seed:local-staff\` adds it only to the HQ admin role when explicitly run in a disposable environment; store.manager does not receive it.
- A reviewer must be a logged-in Staff identity with that permission AND server-verifiable access to the source store/data scope.
- Staff who most recently submitted that version of a proposal **cannot review their own proposal**, even if they hold the reviewer permission.
- Original staff who created the source review session is not separately barred if they did not write the correction. Future stronger separation can consider session and proposal authors jointly.

## Persistence & concurrency
- Migration \`0035_meiping_correction_reviews.sql\` adds immutable records keyed \`(session_id, source_row_number, correction_version)\`.
- A valid verdict is \`ACCEPTED\` or \`REJECTED\`, with a required human reason and reviewer identity. Same version may not be reviewed twice.
- Editing a correction creates another version: prior verdict stays in history, but is **not** treated as the verdict on the new version.
- The review transaction locks the correction row; concurrent correction saves and duplicate reviews fail closed. Audit metadata records reviewer, version, decision, source row and store; never the proposed values, barcode or free-text reason.

## Conservative barcode check
- Before accepting a correction with a proposed barcode, reject known collisions with other original barcode/ISBN values in the **same source workbook** and existing formal SKU codes and book-edition ISBNs, plus current already-accepted corrections in the same session.
- A barcode approval is **not** a certificate of global uniqueness, nor independent physical verification. Other sessions, unpublished external systems and future imports may still conflict. Approval cannot turn a \`REVIEW\`/\`DUPLICATE\` source row into \`CREATE_CANDIDATE\`.
- When a source row is blocked by barcode issues and no replacement barcode is proposed, accepting is refused. Rejecting with reason remains available.

## API
\`POST /api/v1/staff/migrations/meiping/review-sessions/:id/corrections/:sourceRowNumber/review?storeId=...\`

Requires: \`expectedChecksum\`, \`expectedCorrectionVersion\` (positive), \`verdict\`, \`reason\` (1–500 chars). Responds with \`approved:false\`, \`catalogOrInventoryWritten:false\`. Existing review GET additionally returns the verdict for the current correction version only.

## HQ Admin
Show saved correction proposals and verdict for the current version. Only users with the new permission see the acceptance/rejection form. A reviewer choosing ACCEPTED sees explicit wording “采纳建议（不入库）”.

## Verification & safe rollout
- CI: migration guard; formatting/lint/typing/unit/build; disposable PostgreSQL integration.
- Integration scenarios: separate reviewer, self-review forbidden, duplicate verdict forbidden, stale version forbidden, source-barcode collision, access scoping, persistent audit records and zero formal catalog/inventory writes.
- User Mac UAT **not performed yet**. Clone the already isolated \`xiaohai_pr152_test\` to a new disposable DB, apply 0035 there only after explicit authorization; do not mutate original source DB, \`xiaohai_dev\`, or production. To test two-person rule, provision a distinct Staff reviewer identity in the new disposable database with narrowly granted review permission, no reuse of any real personnel credentials.
- Keep this and stacked upstream PRs Draft. No merge or production deployment.

### Future limitations
Full cross-session barcode deduplication, physical book verification, product/SKU creation, ISBN matching resolution, independent stocktake approval and INITIAL_MIGRATION remain independent follow-up work.
