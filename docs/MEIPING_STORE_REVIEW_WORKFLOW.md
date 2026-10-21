# 门店端商品资料纠错与总部职责 / Store Meiping Workflow

## Product ownership (2026-10-21)
The user confirmed that **Store Web owns daily store operations**. HQ Admin owns store account lifecycle (create, update roles/data scope, disable as a safe alternative to destructive deletion), plus cross-store visibility/monitoring. Existing Admin staff administration and HQ summaries are retained, not recreated.

The Meiping Excel migration is an **one-time historical import**, not the source of daily catalog updates after cutover. This PR addresses the existing **migration DRAFT** workflow in Store Web only. Live catalog edit/approval APIs after cutover remain a separate future deliverable. This milestone must not claim to implement daily catalog edits.

## What is implemented
- Store Web navigation: "迁移资料审核" scoped to Staff with both inventory.receive + inventory.stocktake, or meiping.correction.review.
- Existing DRAFT sessions and paginated rows for the current authorized store; no re-upload needed.
- Authorized original editor: amend original decision (still CREATE_DRAFT candidates only, EXCLUDE otherwise) and propose corrections with version and checksum checks, preserved source rows and an audit trail.
- Different authorized reviewer: see original and proposed metadata field-by-field, proposal author reason and version; choose ACCEPTED/REJECTED **explicitly** (no default), enter mandatory reason, confirm irreversible action; see historical decision for current correction version.
- All requests use the **existing** Staff Meiping ReviewService APIs. No new DB table, migration, inventory writes or AI integration.
- Changing Store Web's selected store discards the currently displayed draft. API always checks token, permission and selected store scope on server.

## Safety / Limits
- Frontend permissions are UX only; server remains authority for role and store data scope.
- **An author cannot independently review their own correction.** Existing service enforces this; Store Web cannot bypass.
- "ACCEPTED" is a suggestion-only verdict. It never resolves an original duplicate issue, creates products/SKUs, or modifies inventory.
- This PR does not enable formal INITIAL_MIGRATION, stock transactions, production product/SKU writes or daily catalog mutation.
- HQ Account Admin already provides create/enable/disable/password reset/roles/data scopes. Permanent deletion is intentionally not provided because it would lose audit lineage.
- HQ operations reporting is currently scoped to **data its Staff identity may read**. Unrestricted global reporting requires GLOBAL scope in the server authorization context; the front-end does not escalate.
- Existing stacked PRs #152/#153 remain Draft and unmerged.

## Verification
- Store Web nav permission test: limited inventory permission cannot reveal migration review; dedicated reviewer can see it without inventory mutation grant.
- Store Review API adapter tests: same Staff endpoints as HQ, auth/response validation, 401/403 error mapping.
- Store panel tests: explicit no-default verdict, required reason, immutable reviewed record, source/proposal comparison, stale-version safety, original duplicate blocked from CREATE_DRAFT.
- Run full CI, build and disposable integration. Mac browser UAT of Store Web remains pending; no Mac database writes authorized/performed by this branch.
