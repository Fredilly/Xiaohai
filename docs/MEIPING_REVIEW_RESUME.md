# Meiping Review Resume — PR #149

## Scope and user flow

This is a stacked draft PR on #148. It fixes a verified browser-acceptance usability gap: previously refreshing the HQ Admin Meiping page required selecting the same Excel, running preflight again and clicking continue.

- With Staff permissions \`stores.read\`, \`inventory.receive\` and \`inventory.stocktake\`, select an authorized store in the existing HQ Meiping page.
- The page now lists that store's **DRAFT review sessions** without Excel upload, in pages of up to 20, displaying creation time, row count, number of saved review decisions, and a shortened source checksum.
- Choose **继续审核** and directly see the persisted rows, quantities, reasons and optimistic-lock versions. Return to the list to switch sessions. The original upload/preflight flow is unchanged for a *new* workbook.
- The backend GET \`/api/v1/staff/migrations/meiping/review-sessions?storeId=UUID&offset=0&limit=20\` is read-only. It shares the existing Staff permission and store-scope checks. It returns only summaries, never an XLS, original source rows, user-entered details, tokens or credentials.
- The existing GET /:id still checks store scope and report checksum; existing PUT still checks row/decision versions. No authorization is derived from the browser cache.

## Safety

- No new DB migration, seed, approval flow, product writer or inventory writer.
- Only the existing DRAFT review/decision tables are read during resume; the existing explicit save decision flow remains unchanged.
- No auto-import, physical stocktake approval, duplicate-barcode resolution, or sale activation.
- Session list is scoped to authorized store and paginated. Switching the selected store unmounts the old review component and invalidates its in-memory selected session.
- \`savedDecisions\` is **not** an approval count; all sessions continue to report \`approved:false\` and \`catalogOrInventoryWritten:false\`.

## Verification

- Unit tests: list API shape, authorization-header forwarding, malformed/foreign-store/approved responses fail closed.
- Isolated PostgreSQL integration tests: correct store boundary, saved decision counts, no source data leakage, read-only behavior.
- CI must pass before calling implementation complete.
- Manual browser check on \`xiaohai_pr148_test\`: reload HQ page and choose PR148-TEST store; see the original six-row DRAFT without reupload; open and verify saved versions 2/2/1 without changing records. Verify no real catalog/SKU/stock writes and no production DB contact.

Keep PR Draft and stacked on #148; do not merge or alter \`main\` or \`xiaohai_dev\`.
