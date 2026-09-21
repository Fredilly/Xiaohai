# M21 Finance/Audit / 财务审计实施计划

## 1. Goal / 目标

M21 adds the dedicated finance-control layer reserved by M20: a normalized append-only finance ledger projection across payment/refund and commission/withdrawal movements, formal internal reconciliation, controlled finance export, and finance-audit administration.

M21 补齐 M20 明确保留的财务控制层：将支付/退款、佣金/提现流水规范化投影到统一的 append-only 财务账本，增加正式内部对账、受控财务导出和财务审计后台。

PostgreSQL remains the system of record. Existing M6 payment/refund and M18 commission/withdrawal ledgers remain authoritative domain evidence; M21 must not replace, rewrite, or weaken their state machines.

PostgreSQL 继续作为唯一事实来源。M6 支付/退款账本和 M18 佣金/提现账本继续作为各自领域的权威业务证据；M21 不替换、不重写，也不削弱既有状态机。

## 2. Authoritative scope / 权威范围

From `PRD_V3.2.md`, `DATABASE_DESIGN.md`, `SYSTEM_ARCHITECTURE.md` and `DEVELOPMENT_TASKS.md`, M21 covers:

- payment/refund finance ledger normalization
- commission/withdrawal finance ledger normalization
- finance summary/read models
- formal internal reconciliation and persisted results
- controlled finance export
- finance-related privileged audit records
- HQ Admin finance/audit UI
- Staff RBAC + GLOBAL Data Scope
- PostgreSQL integration tests and documentation

M21 does **not** start M22 Security/Privacy, M23 Reliability, M24 WeChat experience validation, production payment activation, tax/KYC policy, or a new payout provider.

## 3. Baseline / 基线

- Base branch: `main`
- M20 merge commit: `0c98389ac367d5e660d14b9b1423a6934be618f6`
- M21 branch: `intern/m21-finance-audit`
- Existing M6 and M18 accounting evidence must remain intact.
- No M21 `finance_ledger_entries` implementation exists on `main` yet.

## 4. Current audit / 当前现状审计

### 4.1 Payment / refund already implemented

M6 already provides:

- `payments`
- `refunds`
- `payment_callbacks`
- append-only `payment_ledger`
- provider-facing `reconciliation_runs` / `reconciliation_items`
- server-side WeChat payment creation and callback verification
- idempotent payment/refund event handling
- Staff permissions `payments.read`, `payments.refund`, `payments.reconcile`
- GLOBAL Data Scope for Staff payment administration

Successful payment writes `PAYMENT` evidence to `payment_ledger`; successful refund writes `REFUND` evidence. Existing payment reconciliation queries the provider for one payment and must remain the authoritative provider reconciliation workflow.

### 4.2 Commission / withdrawal already implemented

M18 already provides:

- `commission_events` immutable business events
- append-only `commission_ledger`
- frozen/available balance deltas derived by summation
- refund reversal
- withdrawal request/hold/release/approve/pay lifecycle
- idempotent event keys and beneficiary locking
- Staff commission permissions + GLOBAL Data Scope

M21 must not introduce a mutable commission balance or recalculate commission entitlement using a second rules engine.

### 4.3 Audit already implemented

M20 provides append-only `audit_logs` with Staff actor, action key, resource identity, request ID, redacted metadata and protected `audit.read` access.

M21 should reuse this audit infrastructure for finance reconciliation/export actions rather than create another generic audit table.

### 4.4 Admin Web already implemented

HQ Admin already has separate payment/refund and commission/withdrawal managers. M21 should add a finance-control surface that links to those domain operations instead of duplicating refund, commission settlement or withdrawal-review business rules.

### 4.5 Gap

There is currently no unified `finance_ledger_entries` implementation and no formal cross-domain internal reconciliation/export workflow. Existing provider reconciliation is payment-specific and existing domain ledgers are intentionally separate.

## 5. Finance ledger model / 统一财务账本模型

### 5.1 Design principle

`finance_ledger_entries` is an immutable normalized projection over existing append-only source ledgers. It is **not** a replacement source of business-state truth.

Each finance entry must point to exactly one authoritative source ledger row:

- `payment_ledger`, or
- `commission_ledger`

This avoids re-running payment or commission business rules inside the Finance domain.

### 5.2 Proposed fields

The initial schema should include:

- `id`
- unique `event_key`
- `source_kind` = `PAYMENT_LEDGER | COMMISSION_LEDGER`
- nullable `payment_ledger_id`
- nullable `commission_ledger_id`
- `event_type`
- `currency` (V1: `CNY`)
- signed `cash_delta_minor`
- signed `commission_frozen_delta_minor`
- signed `commission_available_delta_minor`
- `occurred_at`
- `created_at`

Constraints:

- exactly one source ledger FK is present
- at least one delta is non-zero
- one normalized finance entry per source event
- monetary values are integer minor units, never float
- entries are append-only

### 5.3 Normalization

Expected normalized movements:

- payment success → positive cash delta
- refund success → negative cash delta
- commission frozen → positive frozen commission delta
- commission settlement → negative frozen + positive available commission delta
- commission reversal → source commission ledger deltas exactly as recorded
- withdrawal hold/release → source available commission delta exactly as recorded
- withdrawal paid → finance cash outflow only when the existing M18 event is actually `WITHDRAWAL_PAID`

The Finance domain reads source ledger rows and copies their already-authoritative deltas. It must not infer a new commission amount from order totals or commission rules.

## 6. Projection consistency / 投影一致性

New M21 writes should create the normalized finance entry in the **same PostgreSQL transaction** as the source payment or commission ledger entry whenever the source lifecycle is mutated.

Required properties:

- deterministic event key
- unique constraint / idempotent retry
- source ledger write and finance projection succeed or fail together
- no direct update/delete of finance ledger history

Existing source ledger rows created before M21 also need an idempotent backfill path so dev/staging databases do not silently show incomplete finance history. Backfill must use source rows only and must be safe to rerun.

## 7. Reconciliation / 正式内部对账

M21 internal reconciliation is separate from M6 provider reconciliation.

M6 provider reconciliation remains:

`WeChat provider state ↔ payment/refund domain state`

M21 finance reconciliation adds:

`payment_ledger + commission_ledger ↔ finance_ledger_entries`

The implementation should persist dedicated finance reconciliation runs/items instead of changing the meaning of M6 `reconciliation_runs` / `reconciliation_items`.

Proposed models:

- `finance_reconciliation_runs`
- `finance_reconciliation_items`

A run uses an explicit bounded time range and records:

- requested Staff actor
- start/end range
- status
- matched count
- missing count
- mismatch count
- created/completed timestamps

Each item records only server-derived source references, expected normalized deltas, actual normalized deltas and outcome (`MATCHED | MISSING | MISMATCH`).

Reconciliation must never silently repair historical finance rows. Differences are reported for controlled operator review. A separate idempotent backfill/projector may create missing projections when explicitly invoked by the implementation path, but reconciliation itself remains evidence, not mutation-by-surprise.

## 8. Controlled export / 受控导出

Finance export must be server-generated and permission-gated.

Requirements:

- explicit `finance.export` permission
- GLOBAL Data Scope
- bounded date range and row limit
- server-owned filters only
- CSV/structured export contains finance event IDs/types/source references, signed minor-unit deltas, currency and timestamps
- no raw WeChat identifiers, password material, provider credentials, callback payloads or unnecessary consumer PII
- every export emits an `audit_logs` record with actor, request ID, filters and exported row count
- exports do not alter finance state

Exact retention period and external-accounting column format remain Decisions Needed; M21 should deliver a safe V1 export without inventing tax/accounting policy.

## 9. Permissions / 权限

Introduce explicit M21 permissions:

- `finance.read`
- `finance.reconcile`
- `finance.export`

All M21 HQ routes require authenticated Staff plus GLOBAL Data Scope. Existing `payments.*`, `commission.*` and `audit.read` permissions keep their current meanings.

Frontend visibility is never authorization.

## 10. API / API 规划

Proposed Staff endpoints:

- `GET /api/v1/staff/finance/summary`
- `GET /api/v1/staff/finance/ledger`
- `POST /api/v1/staff/finance/reconciliation-runs`
- `GET /api/v1/staff/finance/reconciliation-runs/:id`
- `POST /api/v1/staff/finance/exports`

All query/body schemas are strict Zod contracts. Date ranges and result sizes are bounded server-side.

The Finance API must not expose new mutation endpoints for refunds, commission settlement or withdrawal review; those continue through their existing domain APIs.

## 11. HQ Admin / 总部后台

Add a Finance workspace that provides:

- summary cards for payment cash inflow, refunds, net cash movement and commission liability movements
- normalized ledger filtering and drill-down by event/source
- finance reconciliation run creation and result review
- controlled export action
- links/context pointing operators back to existing Payments and Commission managers for domain actions

Do not duplicate domain state machines in React.

## 12. Implementation phases / 实施阶段

### M21-A — Contracts + schema

- finance contracts and strict schemas
- `finance_ledger_entries`
- finance reconciliation run/item schema
- DB exports / Drizzle config
- migration generated and reviewed before application

### M21-B — Finance projection

- normalize payment/refund source ledger events
- normalize commission/withdrawal source ledger events
- same-transaction projection for new events
- idempotent historical backfill/projector
- PostgreSQL integration coverage for retry/concurrency correctness

### M21-C — Finance reads + reconciliation

- ledger/summary read service
- persisted internal reconciliation runs/items
- Staff RBAC + GLOBAL Data Scope
- strict filtering/date bounds

### M21-D — Controlled export + audit

- server-generated bounded export
- `finance.export` permission
- audit record for export and reconciliation actions
- verify no sensitive fields leak

### M21-E — HQ Admin + final regression

- Finance Admin API adapter
- Finance workspace
- contracts/API/Admin tests
- full PostgreSQL integration
- full workspace check, DB check and applicable E2E
- docs and PR review

## 13. Security & accounting invariants / 安全与账务约束

- No client-supplied finance amount is trusted.
- No float money.
- No mutable aggregate balance fields.
- No deletion or rewrite of accounting history.
- No second commission calculator.
- No second payment/refund state machine.
- Provider secrets and callback payloads never enter finance export/audit metadata.
- Reconciliation reports mismatches instead of hiding them.
- Retry/concurrency must not duplicate ledger entries.
- Finance reads/exports require explicit permission and GLOBAL scope.

## 14. Tests / 测试

Required M21 coverage:

- strict contracts reject unknown/server-controlled fields
- payment success produces exactly one normalized cash entry
- payment callback retry does not duplicate finance entry
- refund success produces exactly one negative cash entry
- commission freeze/settle/reversal preserve source ledger deltas exactly
- withdrawal hold/release/paid projection is idempotent
- backfill is safe to rerun and never duplicates entries
- reconciliation detects missing/mismatched projections and persists evidence
- reconciliation does not mutate existing ledger history silently
- finance permissions and GLOBAL Data Scope are mandatory
- export is bounded, audited and excludes sensitive data
- existing M6 payment/provider reconciliation semantics remain unchanged
- existing M18 commission/withdrawal semantics remain unchanged
- full `pnpm check`, DB checks, PostgreSQL integration and applicable E2E pass

## 15. Out of scope / 不在 M21

- production tax calculation / tax filing
- KYC / AML policy
- final commission rate or withdrawal threshold policy
- real withdrawal/payout provider integration
- external ERP/accounting-system integration
- arbitrary finance journal entry UI
- editing/deleting finance history
- M22 security/privacy hardening campaign
- M23 load/performance/backup/monitoring campaign
- M24 WeChat real-device acceptance

## 16. Decisions Needed / 待确认

Do not guess these policies during M21:

1. Exact finance/audit retention period.
2. Exact external accounting/export column format and downstream system, if any.
3. Tax/KYC/AML obligations for commission withdrawal.
4. Real withdrawal payout rail and provider reconciliation.
5. Whether finance reconciliation is scheduled automatically in a later milestone; M21 V1 may remain operator-triggered.
6. Exact reporting timezone/display policy; persisted timestamps remain timezone-aware.
7. Whether manual accounting adjustments are ever allowed; default M21 behavior is **no arbitrary manual journal entries**.

## 17. Done / 完成标准

M21 is done only when:

- payment/refund and commission/withdrawal source ledgers project into an immutable normalized finance ledger without duplicating business rules
- historical source rows have a safe idempotent backfill path
- formal internal reconciliation is persisted and reviewable
- controlled export is server-generated, bounded, permission-gated and audited
- HQ Admin exposes the Finance workspace without duplicating domain mutations
- M6/M18/M20 semantics and authorization boundaries remain intact
- applicable contracts/API/DB/Admin/migration/tests/docs are complete
- `pnpm check`, DB checks, PostgreSQL integration and applicable E2E are green
- PR documents What / Why / How tested and receives review before merge
