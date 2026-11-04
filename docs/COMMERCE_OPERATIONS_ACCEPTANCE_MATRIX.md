# Issue #114 — Commerce & operations acceptance evidence / 商业运营验收证据矩阵

Baseline: PRD_V3.2 §§3, 7, 9–13; DEVELOPMENT_TASKS M5–M23. Scope: audit evidence inventory only. Git baseline: `main@8924c0577a5ab0edc6067915c653bb43daf6ca39` (2026-10-29, after #175). No live payment, DB mutation, real user or staging execution in this audit.

## Status rules / 状态定义

- **CODE EVIDENCE PRESENT** = a route/source file and a relevant automated test *exist* in Git; not proof the business flow passed staging.
- **PASS** = the specific acceptance journey was actually executed, with exact environment, SHA, expected/actual result, timestamp and redacted evidence.
- **FAIL** = a reproduced acceptance failure with exact trigger and linked narrow defect.
- **NOT TESTED** = no independent live/staging acceptance evidence available in this audit.
- **N/A** = documented product decision explaining why the behavior is not part of V1. No silent N/A.

All real-environment rows below remain **NOT TESTED**, even if source tests or previous green CI exist. Do not infer that all components have been integrated or deployed from files alone. Assignment fields are intentionally **UNASSIGNED** until the owner confirms.

## Traceability / 路径追踪

| ID / PRD workflow | API / contract evidence | Client surface located | DB effect or invariants to verify | Existing automated evidence | Staging/UAT |
| --- | --- | --- | --- | --- | --- |
| C01 Catalog/search/SKU | `GET /api/v1/catalog/products`, `/:id`; `apps/api/src/commerce/commerce-routes.ts` | `apps/miniapp/pages/shop`, `product`; `apps/admin-web/src/catalog-manager.tsx` | `books/book_editions/products/skus`; real price/status and search contract | `apps/api/test/commerce.integration.test.ts`, `hq-catalog-create.integration.test.ts` | NOT TESTED |
| C02 Cart + address + checkout | `/api/v1/commerce/cart*`, `/addresses*`, `/checkout/preview` | `pages/cart`, `address`, `checkout` | Consumer-scoped carts/addresses; calculate live SKU price at checkout | `commerce.integration.test.ts`: ownership, unavailable SKU, server price | NOT TESTED |
| C03 Order create/list/cancel | `/api/v1/commerce/orders*` | `pages/orders`, `order-detail` | Immutable order snapshots, client request idempotency, UNPAID-only cancel | `commerce.integration.test.ts`: ownership and allowed cancel | NOT TESTED |
| P01 WeChat pay + callback | `POST /api/v1/payments/wechat`, `/notify`; `apps/api/src/payments/payment-routes.ts` | `pages/checkout`; HQ `payments-manager.tsx` | `payments/payment_callbacks/payment_ledger`; signature, amount, callback idempotency | `payment.integration.test.ts`: concurrent callbacks, amount/merchant mismatch, late success; `payment-routes.test.ts` | NOT TESTED; no real money permitted |
| P02 Refund + reconciliation | `POST /api/v1/staff/refunds`, `/payments/:id/reconcile` | HQ `payments-manager.tsx` | `refunds/reconciliation_*`; unique refund intent and append-only accounting | `payment.integration.test.ts`: retry-safe full refund, provider abnormal/closed, reconciliation discrepancies | NOT TESTED |
| I01 Inventory issue/receipt/adjust | `/api/v1/staff/inventory/issues`, `/goods-receipts*`, `/adjustments` | Store `inventory-panel.tsx`, `operations-panel.tsx`; HQ `hq-inventory-workflows.tsx` | `store_inventory.version` + immutable `inventory_transactions`; no overdraw | `inventory-operations.integration.test.ts`: concurrency, stale version, receipt idempotency | NOT TESTED |
| I02 Stocktake/transfer | `/api/v1/staff/inventory/stocktakes*`, `/transfers*` | Store `operations-panel.tsx`; HQ inventory workflows | Multi-SKU transfer rollback, stocktake version, scoped stores | `inventory-operations.integration.test.ts`: stocktake and transfer rollback | NOT TESTED |
| R01 Rental reserve/borrow/return | `/api/v1/rentals*`, `/staff/rentals*` | `pages/rentals`, `rental-detail`; Store `rental-panel.tsx` | Stock/reservation and ledger transitions, overdue, owner and store isolation | `rental.integration.test.ts`: last-copy concurrency, borrow/return once, scoped staff | NOT TESTED |
| F01 Pickup / delivery | `/api/v1/fulfillment/quote`, `/orders*`, `/staff/fulfillment*` | Store `fulfillment-panel.tsx`; consumer checkout/order pages | Reservation/release, pickup code, delivery zone and deduct-once | `fulfillment.integration.test.ts`, `fulfillment-reservation.integration.test.ts` | NOT TESTED |
| FR01 Franchise application/lifecycle | `apps/api/src/franchise` domain | `pages/franchise-apply`; HQ `franchise-manager.tsx` | Application state, assignment, history, GLOBAL scope | `franchise.integration.test.ts`: validation, followups and illegal transitions | NOT TESTED |
| CO01 Attribution/commission/withdrawal | `apps/api/src/commission` domain | `pages/commission`, `referral`; HQ `commission-manager.tsx` | Append-only commission ledger, refund reversal, double-spend prevention | `commission.integration.test.ts`: concurrent withdrawals, reversals, stale decisions | NOT TESTED |
| HQ01 Catalog + shared store scope | `/api/v1/staff/catalog/products*` and store catalog reads | HQ `catalog-manager.tsx`; Store `store-catalog-panel.tsx` | Shared product versions, ISBN uniqueness and store-linked SKUs | `hq-catalog-create.integration.test.ts`, `store-catalog-read.integration.test.ts` | NOT TESTED |
| S01 Staff RBAC + Data Scope | `apps/api/src/auth` + inventory/fulfillment routes | Store/HQ staff sign-in and role-restricted panels | Identity-derived STORE/REGION/FRANCHISEE/GLOBAL; no client-supplied scope | `staff-authorization.integration.test.ts`, `inventory-operations.integration.test.ts`, `security-controls.test.ts` | NOT TESTED |
| FI01 Finance audit/reconciliation/export | `apps/api/src/finance/finance-routes.ts` | HQ `finance-manager.tsx` | Finance ledger derived from verified events; permission/audit and bounded exports | `finance.integration.test.ts`: GLOBAL scope, mismatches, audited export | NOT TESTED |

Paths establish only that UI/API/test artifacts are present, **not** that screen actions were exercised or that every named endpoint covers the full product flow. Test names are a discovery index; independent reviewers must read relevant assertions and fresh CI results before recording any CODE PASS.

## Required executable acceptance sequence / 下一轮真正验收

1. **Environment gate:** record staging deployment SHA, HTTPS API and WeChat allowed domains, isolated PostgreSQL, non-production payment/provider configuration, test account/store ownership. If unavailable, record NOT TESTED, not PASS. #76 is closed but that alone does not prove this deployment.
2. **Consumer commerce:** catalog → SKU → cart → address → checkout preview → UNPAID order → order list/detail → cancel; test invalid quantity, unavailable SKU, 401/no owner, duplicate client request. Capture redacted HTTP status, safe order references and screenshots.
3. **Inventory + order:** for two scoped stores and one cross-scope staff identity, verify issue/receipt/stocktake/transfer changes + exactly one inventory transaction; race last-unit actions and verify no negative stock, rollback and version conflict.
4. **Payment/refund:** mock/sandbox ONLY unless the owner explicitly authorizes money. Test signed callback, duplicate/late callback, refunded once, reconciliation mismatches, 401/403. Never send real payment or issue production refunds as part of CI.
5. **Rental + fulfillment:** last-copy reservation race, borrow/return, correct/incorrect pickup code, cancellation releasing reservation, failed delivery and retry without double decrement. Verify both customer screen and Store Web in the same staging data set.
6. **HQ + finance + franchise/commission:** test restricted staff, server-scoped list/approve/review/withdrawal, append-only ledger, cross-store denied access and bounded finance exports. Record precise expected and actual DB effects without copying personal data.
7. **Exit review:** for every row, attach SHA, date, environment, status, redacted screenshot/trace, executing tester, independent reviewer and open defects. No production release if P0/P1 remains or critical rows are NOT TESTED.

## Evidence fields (fill for each case)

`Case ID | SHA | Environment | Tester (UNASSIGNED) | Reviewer (UNASSIGNED) | Expected | Actual | PASS/FAIL/NOT TESTED/N/A | Redacted evidence link | Linked defect | Date`.

## Known blockers / explicitly not claimed

- #126/#113: current core Mini Program UI PR is still open; DevTools visual screenshot proof and human approval were missing when this matrix was prepared. Do not claim this UI is in main.
- #115: #173/#175 code and offline tests were merged, but real scoped BOS GetObject / signed expiry / WeChat devices remain NOT VERIFIED.
- Live staging deployments, sandbox payment confirmation, real-device screenshots and owner release approval are **not accessible in this code-only review**.
- No paid AI run, inventory cutover, payment, production deployment, credentials or customer records were used here.

This is the **first code-evidence inventory** for #114; it is not #114 completion and does not close the issue.
