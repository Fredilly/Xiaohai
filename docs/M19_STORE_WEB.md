# M19 Store Web / 门店端实施计划

## Goal / 目标

M19 completes the production Store Web for day-to-day store operations by wiring the existing M12–M16 store, inventory, rental and fulfillment capabilities into one authenticated, store-scoped React application.

M19 完成可正式用于门店日常运营的门店端，把 M12–M16 已有的门店、库存、租借、自提配送能力接入同一个经过员工认证和门店数据范围约束的 React 应用。

This milestone is an operational surface, not a second source of business truth. PostgreSQL and existing server-side services remain authoritative.

本里程碑只建设运营工作台，不在前端复制业务规则；PostgreSQL 与现有服务端业务服务仍是唯一权威来源。

## Baseline audit / 现状审计

Already present:

- Staff login and `/api/v1/staff/me` session context.
- Store Web React/Vite shell with sidebar navigation.
- Working Inventory, Rental and Fulfillment panels.
- Existing M12 Store Network APIs with RBAC + Data Scope.
- Existing M13 book/store inventory search API.
- Existing M14 inventory operation APIs for stock, transactions, alerts, suppliers, procurement, receipt, stocktake and transfer.
- Existing M15 rental APIs.
- Existing M16 pickup/delivery fulfillment APIs.

Current gaps:

- Dashboard values and Book Query are still mock data.
- Store selection/context is not driven by the staff member's accessible stores.
- Inventory Web client only exposes balance list, issue and adjustment; existing alerts/transactions and operational actions are not fully surfaced.
- Procurement has no Store Web implementation.
- Orders are represented by the fulfillment panel rather than a complete Store Web operations entry.
- Store manager staff/reporting surfaces are not implemented.
- Store Web has no dedicated tests yet.
- Existing inventory APIs expose many write operations, but some operational read/list views required by a usable procurement/stocktake/transfer UI may need small store-scoped backend additions after audit.

## Scope / 范围

### 1. Authenticated Store Context / 登录与门店上下文

- Keep existing staff login/session flow.
- Load stores visible to the current staff context from `GET /api/v1/staff/stores`.
- Use an explicit selected store when multiple stores are available.
- Selected store IDs are only UI context; every API remains server-authorized by RBAC + Data Scope.
- Handle 401/403 distinctly and never silently fall back to mock operational data.

### 2. Dashboard / 门店首页

Replace static metrics with live operational summaries derived from authoritative APIs:

- low-stock alerts
- open pickup/delivery fulfillment
- active/overdue rentals
- inventory summary for the selected store

No mutable dashboard table is introduced.

### 3. Orders / 订单履约

Promote the existing M16 fulfillment capability into the Store Web Orders surface:

- order/fulfillment list
- preparation / ready state
- pickup-code verification and handoff
- local-delivery workflow and provider state
- clear permission and state errors

All state transitions continue to use M16 server rules and idempotency protections.

### 4. Book Query / 找书

Replace preview/mock books with the M13 API:

- title / author / publisher / ISBN / barcode-style query
- selected-store filter
- sell/rent availability
- stock values and SKU information

Primary API: `GET /api/v1/inventory/books`.

### 5. Inventory / 库存

Complete the Store Web inventory operations surface:

- stock balances and search
- low-stock alerts
- inventory transaction history
- issue
- adjustment
- stocktake
- transfer

Inventory mutations must continue to provide the required optimistic version/idempotency inputs and must not bypass M14 authorization/concurrency rules.

### 6. Rental / 租借

Keep M15 as the source of truth and improve the Store Web operational flow where needed:

- reservation/pickup
- borrowed contracts
- due/overdue visibility
- return
- cancellation where allowed

Do not duplicate rental state-machine logic in React.

### 7. Procurement / 采购与收货

Build the manager procurement surface around M14:

- suppliers
- purchase-order creation and allowed actions
- goods receipt creation/posting
- visible purchase-order/receipt status required for daily operation

If current M14 APIs lack required read/list endpoints, add the smallest store-scoped read APIs needed by the UI, with RBAC/Data Scope tests. Do not redesign the M14 inventory model.

### 8. Store Manager: Staff & Reporting / 店长能力

M19 provides only store-operational manager capabilities:

- store-scoped staff visibility / operational context where server support exists or can be added safely
- operational reporting based on existing orders, inventory, rentals and fulfillment data

Out of scope for M19:

- HQ-wide staff lifecycle administration
- global RBAC/role editor
- finance/audit administration
- cross-region HQ reporting

Those remain M20/M21 responsibilities.

## Security and authorization / 安全与权限

- Consumer and Staff identities remain separate.
- Staff authorization is enforced server-side using RBAC + Data Scope.
- The UI must not grant access because a tab/button is visible.
- Store IDs supplied by the client are always re-validated against staff Data Scope by the server.
- Mutation endpoints keep existing optimistic-lock/idempotency requirements.
- No secrets, provider credentials or sensitive PII are logged or embedded in Store Web.
- GLOBAL-only operations stay GLOBAL-only; Store Web must surface 403 rather than attempting to work around it.

## API reuse / API 复用

M19 should reuse the existing business APIs first:

- Store Network: `/api/v1/staff/stores*`
- Book Query: `/api/v1/inventory/books`
- Inventory Operations: `/api/v1/staff/inventory*`
- Rental: existing M15 staff rental endpoints
- Fulfillment: existing M16 staff fulfillment endpoints

New APIs are allowed only for proven Store Web read-model gaps and must remain thin wrappers over the existing domain model.

## Implementation sequence / 实施顺序

1. Store context + shared authenticated API helper.
2. Real Book Query and live Dashboard.
3. Complete Inventory alerts/history + issue/adjustment UX.
4. Orders/fulfillment operational surface.
5. Rental operational polish.
6. Procurement + receipt.
7. Stocktake + transfer manager flows.
8. Minimal store manager staff/reporting gaps.
9. Tests, docs, full workspace checks and PR review.

## Tests / 测试

Required before M19 review:

- Store Web API-client tests for auth headers, URLs, query parameters and mutation payloads.
- UI/pure-logic tests for store selection, permission/error handling and critical action-state mapping where practical.
- Existing M14/M15/M16 integration suites remain green.
- Any new backend read endpoint receives PostgreSQL integration coverage for RBAC + Data Scope.
- `pnpm check`
- `pnpm --filter @xiaohai/db db:check` when database files are touched.
- `git diff --check`
- GitHub Actions fully green.

## Definition of Done / 完成标准

M19 is complete when:

- Store Web no longer depends on mock business data for Dashboard or Book Query.
- An authenticated staff member can operate only stores allowed by server Data Scope.
- Orders/pickup/delivery, inventory, rental and procurement are usable from Store Web.
- Manager stocktake/transfer and the agreed store-scoped manager views are usable.
- Existing M12–M18 business semantics remain unchanged unless a documented Store Web read gap requires a reviewed backend addition.
- Tests, validation, error handling, logs and documentation are complete.
- M20 HQ Admin has not been started.
