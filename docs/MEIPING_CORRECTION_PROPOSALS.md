# M3 Meiping — Manual Correction Proposals (Draft-only)

## Scope

This is a staged draft PR on the completed browser-accepted review resume implementation. It adds **auditable, versioned human correction proposals**, not final conflict resolution or approval. Existing source Excel, persisted preflight report and derived row dispositions remain immutable.

For each source Excel row under a Staff-authorized store and review session, the HQ Admin can propose changes to one or more of: **title, author, publisher, barcode, unit price (RMB)**. A free-text justification is required. Only populated proposed fields are submitted. The server saves the proposal in its own table; the operator can edit it (optimistic version concurrency control) and reopen it through the existing review session list.

## Database and API

- Migration **0034_meiping_review_corrections.sql** creates a separate table keyed by review session and source row number. Original raw report, formal catalog, SKU and inventory tables are untouched.
- \`PUT /api/v1/staff/migrations/meiping/review-sessions/:id/corrections/:sourceRowNumber?storeId=<uuid>\`:
  - requires existing authenticated Staff authorization + \`inventory.receive\`, \`inventory.stocktake\` and authorized store/data scope;
  - validates checksum, source row, proposed field whitelist, lengths, nonnegative integer minor-unit price, reason (1–500 chars), version;
  - writes **only** correction proposal and a sanitized audit entry without barcode or proposed values;
  - returns \`status: PENDING_VERIFICATION\`, \`approved: false\`, \`catalogOrInventoryWritten: false\`.
- Existing review page GET returns saved correction alongside each row and original source facts, still behind the same authorization.
- Concurrent edits use optimistic \`expectedVersion\` and reject stale changes.
- Original \`CREATE_DRAFT\` guard and barcode collision classification are **unchanged**, including for rows with a saved proposal. A proposed new barcode has **not** been verified against other source rows, the current catalog or a physical book, and never upgrades a blocked row to a candidate.

## Safety / Limitations

- **Do not treat suggestions as resolved conflicts.** Requires separate human cross-record verification and independent approval workflow.
- No new import writer, stock ledger, sale activation, bulk updates, automatic price normalization or download of proposed correction data.
- No changes to \`main\`; no merge of upstream PRs. Do not apply migration 0034 to \`xiaohai_dev\` or production. Local validation should use a newly isolated/disposable test DB or obtain specific authorization before modifying \`xiaohai_pr148_test\`.
- The existing six-row acceptance data and audit decisions must be preserved.
- The Admin control is "保存纠错建议（待复核）", not "纠错完成" or "批准建档".

## Verification

1. CI: format, lint, typecheck, unit, PostgreSQL integration and migration guard.
2. Unit tests: reject blank proposals, invalid barcode, bad price, missing justification; accept 0 price as *suggestion* but retain sale restrictions.
3. PostgreSQL integration: create/update correction, reject stale version/wrong store/checksum/row; verify original report and catalog/inventory remain unchanged; audit metadata does not contain proposed values.
4. Local browser (after isolated migration authorization): view existing session, propose a corrected barcode for a synthetic duplicate row, save version 1, edit version 2, reload session and verify the suggestion remains pending with original row disposition unchanged.
