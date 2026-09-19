# M20 HQ Admin / 总部后台实施计划

## 1. Goal / 目标

M20 consolidates the already completed production domains into the HQ Admin Web and fills the minimum missing HQ-only administration capabilities required by the PRD.

M20 将 M1–M19 已完成的生产域能力汇总到总部后台，并补齐 PRD 明确要求、但当前尚不存在的总部级管理能力。

The HQ Admin remains one client of the shared API. PostgreSQL and the existing domain services remain the source of truth. The Admin Web must not duplicate business rules or create client-side authorization semantics.

总部后台只是共享 API 的一个客户端；PostgreSQL 与现有领域服务继续作为唯一事实来源。Admin Web 不复制业务规则，也不在前端创造新的权限语义。

## 2. Authoritative scope / 权威范围

From `PRD_V3.2.md` and `DEVELOPMENT_TASKS.md`, HQ Admin covers:

- users / 用户
- catalog / 图书商品
- content / 内容
- AI
- stores / 组织与门店
- inventory + procurement / 库存与进销存
- orders / 订单
- rentals / 租借
- delivery / 自提配送
- franchise / 加盟
- payments/refunds / 支付退款
- commission / 佣金提现
- operational finance views / 运营财务视图
- CMS
- Staff / RBAC / Data Scope
- audit administration / 审计管理
- system/configuration entry points / 系统与配置入口

M20 does **not** implement M21's dedicated finance/audit hardening scope: finance ledger consolidation, controlled export, formal reconciliation workflows and finance-audit reporting remain M21.

## 3. Baseline / 基线

- Base branch: `main`
- M19 merge commit: `61293cafd0eef76b2aadcb003cf63135e2847384`
- Post-M19 CI hotfix merge commit: `0b80805acca420b4371aa095552c52d4e99d8ec7`
- Main CI run #158: success
- M20 branch: `intern/m20-hq-admin`
- M20 is rebased/reset onto the latest green `main`; it is not based on the earlier pre-hotfix branch state.

## 4. Current audit / 当前现状审计

### 4.1 Already connected in Admin Web / 已接入后台

The current Admin Web already has real managers/adapters for:

- Catalog / 商品
- CMS / 首页运营
- Content / 动画内容
- AI monitoring
- Franchise
- Payment / refund / reconciliation views
- Commission / withdrawal
- Staff login + current authorization context

These modules should be preserved and consolidated, not reimplemented.

### 4.2 Preview-only gaps / 当前仍为预览的模块

Current Admin navigation still marks these areas as preview-only:

- organization / stores
- inventory / procurement
- orders
- rental
- Staff / permissions
- system / audit

M12–M16 already provide most store, inventory, rental and fulfillment backend capabilities, so M20 should connect them rather than recreate them.

### 4.3 Backend gaps found during audit / 后端缺口

1. **Orders**: Commerce currently exposes consumer order list/detail/cancel and HQ catalog endpoints, but no dedicated Staff/HQ order list/detail read model.
2. **Staff / RBAC**: authentication and authorization exist, but there is no production Staff lifecycle/RBAC management API for HQ.
3. **Users**: consumer identity tables exist, but there is no HQ user read API.
4. **Audit**: authoritative DB design calls for `audit_logs`, but the current schema does not yet implement a dedicated audit-log domain.
5. **Finance**: payment/refund and commission operational data exist. The generic `finance_ledger_entries` model from the design is intentionally reserved for M21 unless M20 needs only a read-only operational summary.
6. **Configuration**: there is no generic mutable configuration subsystem. M20 must not invent an unrestricted key/value configuration store; it should expose only existing domain-owned configuration and system status.

## 5. Security boundary / 安全边界

- Consumer and Staff identities remain separate.
- Every HQ endpoint requires Staff authentication.
- HQ mutations require explicit permissions; visibility in the Admin Web is never authorization.
- HQ-wide administration uses `GLOBAL` Data Scope unless the domain explicitly supports narrower scope safely.
- Client-provided region/franchisee/store IDs never expand authorization.
- Staff password hashes, provider credentials, payment secrets and AI keys are never returned to clients or logs.
- Staff account creation/reset accepts plaintext password only over the authenticated request boundary and hashes it server-side.
- Privileged mutations must emit audit records without storing secrets or excessive PII.
- Existing inventory/payment/commission state machines and ledgers remain authoritative.

## 6. Implementation phases / 实施阶段

### M20-A — HQ shell consolidation / 总部后台整合

- Replace preview navigation with permission-aware production module routing.
- Connect Stores using existing M12 Staff Store APIs.
- Connect Inventory/Procurement using existing M14 APIs.
- Connect Rental using M15 APIs.
- Connect Pickup/Delivery using M16 APIs.
- Refresh HQ Dashboard to show live operational summaries where server APIs already exist.
- Preserve existing Catalog/CMS/Content/AI/Franchise/Payments/Commission managers.

No schema change is expected in M20-A.

### M20-B — HQ Orders + Users read models / 订单与用户

Add minimal server-owned HQ read APIs and contracts:

- Staff order list with status/time/query filters.
- Staff order detail with immutable product/price/address snapshots and fulfillment/payment references where safe.
- Consumer user list/detail using minimal identity metadata needed for support operations.
- Do not expose password material, raw provider secrets or unnecessary WeChat identity data.
- Require dedicated permissions and GLOBAL Data Scope.

### M20-C — Staff / RBAC / Data Scope administration

Implement an HQ IAM administration module around the existing tables:

- list/create Staff accounts
- enable/disable Staff accounts
- server-side password set/reset
- list roles and permissions
- assign/remove Staff roles
- configure Staff Data Scopes
- list store assignments/context where useful

Rules:

- Require explicit IAM administration permissions + GLOBAL Data Scope.
- Use transactions for role/scope replacement.
- Prevent malformed GLOBAL vs scoped Data Scope shapes.
- Prefer disable over hard delete.

### M20-D — Operational audit administration / 操作审计

Introduce generic privileged-action audit infrastructure if still absent:

- `audit_logs` append-only table + migration
- actor Staff ID
- action key
- resource type + resource ID
- request ID / correlation metadata
- redacted structured metadata
- created timestamp

Add audit writes first for M20 Staff/RBAC mutations and other newly introduced HQ mutations. Do not retrofit every historical M1–M19 operation in this milestone unless needed for correctness.

### M20-E — System / configuration + final consolidation

- System status page for current Staff context, API health and domain/module readiness.
- Surface existing domain-owned configuration entry points only.
- Do not create an unrestricted generic configuration store.
- Remove stale preview labels for modules that are now genuinely connected.
- Complete docs and regression tests.

## 7. Testing / 测试

Required M20 coverage:

- Admin API adapters send Staff bearer token.
- Permission-aware navigation never claims authorization.
- Strict contracts reject server-controlled fields.
- Dashboard aggregation handles partial permission sets/failures.
- HQ order/user reads require explicit permissions + GLOBAL scope.
- Staff account lifecycle does not expose password hash.
- role/permission assignment is transactional.
- Data Scope shape and cross-boundary attempts are rejected.
- disabled Staff cannot authenticate.
- audit rows are append-only and unauthorized audit reads are rejected.
- Existing M12–M19 authorization/state-machine semantics remain unchanged.
- Full `pnpm check`, DB checks, PostgreSQL integration and applicable E2E must pass.

## 8. Out of scope / 不在 M20

- M21 unified finance ledger and controlled finance exports
- M21 formal finance reconciliation/audit reports beyond existing payment reconciliation
- M22 threat-model/security/privacy hardening program
- M23 load/performance/reliability campaign
- production release/activation
- arbitrary client-editable system configuration

## 9. Decisions Needed / 待确认

Do not guess these policies during implementation:

1. Whether Staff password reset requires forced change-on-next-login.
2. Whether the last GLOBAL HQ administrator may be disabled/de-scoped.
3. Exact retention period for operational audit logs.
4. Whether consumer support UI may display masked WeChat identity identifiers; default M20 behavior should minimize PII.
5. Whether role creation is fully dynamic in V1 or limited to assigning seeded roles.
6. Whether Staff account deletion is ever allowed; default should be disable, not hard delete.
7. Which system settings are genuinely operator-editable versus deployment configuration.

## 10. Done / 完成标准

M20 is done only when:

- HQ Admin modules required by the PRD are connected to real server capabilities or explicitly bounded to M21+.
- Staff/RBAC management is server-authorized and tested.
- HQ order/user support reads are available with least-privilege access.
- Operational audit administration exists for M20 privileged mutations.
- No M21 finance-ledger/export scope is pulled forward.
- applicable Admin/API/contracts/DB/migration/tests/docs are complete.
- `pnpm check`, DB checks and PostgreSQL integration are green.
- PR documents What / Why / How tested and receives review before merge.
