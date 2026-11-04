# Meiping HQ Review UI — Draft-stage manual decisions

## Scope

This PR is stacked on #147. The existing HQ Admin "美萍导入预检查" page now offers a separate **explicit** action, "建立 / 继续本文件的审核草稿", after a successful preflight of the *same selected file and store*.

The standard preflight and exception CSV remain strictly read-only. A Staff operator with \`stores.read\`, \`inventory.receive\`, and \`inventory.stocktake\` can create/reuse a review session, page through server-derived source rows (25 per page), submit draft decisions for create candidates with **manually entered, nonnegative** stocktake-declaration quantities, or explicitly exclude rows with a reason. Existing version numbers are honored, and 409 conflicts require refresh.

## Constraints

- No default quantity is proposed. The XLS's provisional 1 per row is never copied into the review form.
- Conflict, matched and review-blocked rows cannot be automatically made into draft candidates. They may be explicitly excluded with a reason but **manual conflict resolution is not implemented yet**.
- An entered quantity is a **staff claim pending verification**, not final stocktake approval.
- No UI route calls a product writer, SKU writer or inventory ledger. Backend response must explicitly indicate \`approved: false\` and \`catalogOrInventoryWritten: false\`.
- Review sessions are limited to the source file checksum + store; a different selected workbook or store resets the review UI.
- "Saved count" and filters refer **only to the current page**, not full-file review completion.
- No global approve/post-to-inventory button; the protected INITIAL_MIGRATION flow requires separate work.

## Acceptance

1. After preflight, with Staff permission, create/reuse draft review session from a test-only workbook; verify save/reload and persisted versions.
2. Enter 0 as valid quantity, reject blanks/fractions/negative and out-of-range quantities.
3. Exclude a blocked row with a reason; verify blocked row cannot be created as a candidate.
4. Edit and retry stale versions; confirm 409 is shown clearly and refresh loads the latest record.
5. Switch file/store, verify old review context is not shown.
6. Confirm books/SKUs/store inventory and inventory transactions remain untouched.

**Do not run a real East-store import or migrate any production database.** Backend DB migration 0033 from #147 is required for browser testing in a disposable/local environment, and must be applied only with authorization.
