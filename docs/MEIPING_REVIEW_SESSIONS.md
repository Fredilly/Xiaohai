# Meiping Review Session Staging — backend phase

This PR is stacked on #146. It introduces **review-only, auditable draft storage** for the real Meiping workbook, not catalog creation or inventory import.

## Endpoints

- POST /api/v1/staff/migrations/meiping/review-sessions?storeId=UUID — raw XLS/XLSX file body (max 5 MiB). Server authenticates Staff, checks inventory.receive + inventory.stocktake and store scope, parses the workbook, computes SHA-256, computes preflight/classification and stores a DRAFT review session. Reupload with same store/checksum returns the existing session.
- GET /api/v1/staff/migrations/meiping/review-sessions/:id?storeId=UUID&offset=0&limit=50 — paginated server-derived row snapshots and saved decisions, within Staff store scope.
- PUT /api/v1/staff/migrations/meiping/review-sessions/:id/decisions/:sourceRowNumber?storeId=UUID — requires expectedChecksum, expectedVersion and either CREATE_DRAFT with manually countedQuantity or EXCLUDE with reason. Version 0 creates, subsequent version must match exactly. No automatic duplicate/ambiguous ISBN/barcode resolution.

Each update creates an audit log within the same database transaction. Review sessions are isolated by store and checksum. The source workbook bytes are not committed to Git or copied into the catalog.

## Safety boundaries

- DRAFT review decisions are **not approved** and do **not assert that physical counting was independently verified**. A Staff-entered quantity is only an unapproved declaration requiring independent stocktake/approval.
- No upload, GET or decision route modifies books, editions, products, SKUs, store_inventory or inventory_transactions.
- The actual final import must have dedicated approval separation, immutable review/reconciliation, INITIAL_MIGRATION inventory transactions, idempotent transactional catalog writes, and the M26 cutover checklist.
- Do not use this API with production data before upstream PRs and migrations have been reviewed. This PR does not include the HQ interactive review UI; that is a separate phase.
