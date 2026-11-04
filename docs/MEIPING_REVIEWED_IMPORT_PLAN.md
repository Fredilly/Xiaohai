# Meiping Review and Physical Stocktake Gate — Phase 1

This branch is stacked on PR #145. It adds a **pure, read-only planning gate** and tests, not a formal import writer, a published admin review workflow, or authenticated approval.

## Why this stage is separate

The East-store XLS preflight counted 1,000 source items, 908 create candidates, 92 rows requiring human review, 413 with incomplete metadata, and 7 sale-blocked rows. These issue categories may overlap. The provisional one-per-row inventory is **not a physical count**.

The repository already defines books, editions, products, SKUs, store inventory and inventory transactions. However, the inventory transaction constraint does **not** yet include INITIAL_MIGRATION. Do not disguise legacy stock as ordinary purchase receipts or stocktake gains.

## Pure review plan

The new buildMeipingReviewPlan function accepts a preflight report, store ID, SHA-256 file checksum, and one decision per original Excel row. Each decision must be:

- CREATE_DRAFT with a **physically verified** nonnegative integer quantity (zero permitted), or
- EXCLUDE with an explicit reason.

The gate checks file/store identity, duplicate source rows, missing/duplicated decisions, count bounds, unknown errors and unresolved conflicts. It cannot create duplicate ISBN-matched books or directly promote blocking/review rows. Missing author or publisher does not stop draft catalog planning. Zero-price products remain sale-blocked. **Every planned product remains DRAFT and unavailable for sale.**

REVIEW_INPUT_COMPLETE means only that the proposed decisions are structurally complete. It is not administrative authorization. The function has no database connection and always returns requiresAuthenticatedApproval=true and mayWriteCatalogOrInventory=false. Its inputs and outputs must never serve as proof of a real staff approval.

## Before any formal import

1. Add persistent, auditable staging approvals keyed by batch checksum, store and original Excel row, with server-derived staff identity and RBAC/data-scope checks.
2. Implement manual resolution of ambiguous ISBNs, duplicate product identifiers, conflicting barcodes and exclusions. Confirm real physical counts and provenance.
3. Review and migrate database constraints to add an explicit INITIAL_MIGRATION inventory transaction type, with transactional catalog/SKU/inventory writer, concurrency and idempotency keys.
4. Test resume after failure, source-to-target mapping, per-store isolation, zero-quantity behavior, reconciliation and re-import rejection.
5. Keep production cutover for M26, requiring old-system freeze, final export, reconciliation and human approval.

No source XLS, production secret, product, SKU, or inventory data is written by this branch.
