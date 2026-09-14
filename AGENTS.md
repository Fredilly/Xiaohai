# AGENTS.md — 小海童话 2.0 / Xiaohai Fairytale 2.0 Production V1

## 项目 / Project
从零开发正式商业系统。旧源码不可得且不可假设可复用。美萍仅用于一次性迁移“图书主数据 + 当前库存”，迁移后新系统为唯一数据源。

Greenfield production build. No legacy source is assumed reusable. Meiping is used only for one-time migration of book master data and current inventory; the new system becomes the sole source of truth afterward.

## 必读顺序 / Required reading
1. `docs/PRD_V3.2.md`
2. `docs/SYSTEM_ARCHITECTURE.md`
3. `docs/DATABASE_DESIGN.md`
4. `docs/DEVELOPMENT_TASKS.md`
5. `docs/COLLABORATION.md`
6. `docs/WECHAT_DEVTOOLS.md`

## 文档权威 / Document authority
- `PRD_V3.2.md`: 产品范围与业务规则 / product scope and business rules.
- `SYSTEM_ARCHITECTURE.md`: 技术实现 / implementation architecture.
- `DATABASE_DESIGN.md`: 数据模型与完整性 / data model and integrity.
- `DEVELOPMENT_TASKS.md`: 交付顺序 / delivery sequence.
- `AGENTS.md`: 工程、安全、Git纪律 / engineering, security and Git rules.

冲突时：产品问题以 PRD 为准；技术问题在不改变 PRD 的前提下以架构为准；重大冲突不得自行猜测，记录到 `Decisions Needed`。

On conflict: PRD wins for product intent; architecture wins for implementation only when it does not alter the PRD. Do not silently resolve material conflicts; record them under `Decisions Needed`.

## 固定技术方向 / Locked technical direction
- Language: **TypeScript**.
- Mini Program: **native WeChat Mini Program + TypeScript**.
- Admin/Store Web: **React + Vite**.
- API: **Node.js LTS + Fastify + Zod**.
- Database: **PostgreSQL + Drizzle ORM/migrations**.
- Monorepo: **pnpm + Turborepo**.
- Tests: **Vitest + Playwright + WeChat real-device/DevTools validation**.
- Redis/Queue: only where needed for cache, rate limits, idempotency and async jobs.

Do not introduce Taro/uni-app/React Native for the Mini Program unless cross-platform becomes an explicit product requirement.

## 三端 / Three clients
- 微信小程序 / WeChat Mini Program: consumers.
- 胖竹门店端 / Pangzhu Store Web: staff and managers.
- 总部后台 / HQ Admin Web: operations, finance, moderation and administration.

All clients use one API and shared domain data.

## 首次进入仓库 / First repository entry
不要立即写业务功能。先检查仓库并生成 `docs/IMPLEMENTATION_PLAN.md`，覆盖 monorepo、模块边界、环境、部署、数据库迁移、美萍迁移、RBAC/Data Scope、安全、测试、外部账号、风险与未决事项。审核后再进入 M1。

Do not start business features immediately. First inspect the repo and produce `docs/IMPLEMENTATION_PLAN.md`. Major framework initialization starts only after review.

## 架构 / Architecture
Production V1 使用模块化单体。领域边界至少包括 IAM, CMS, Catalog, Commerce, Orders, Payments, Media, AI, Works, Stores, Inventory, Procurement, Rental, Delivery, Franchise, Referral/Commission, Finance, Notification, Moderation, Audit. AI/media workers may run separately.

## 权限 / Authorization
Consumer and Staff identities are separate. Enforce **RBAC + Data Scope on the server**. Never trust client-provided `store_id` for authorization. Staff/store/region/HQ/global access must be derived from authenticated identity and server-side scope.

## 库存 / Inventory
Every stock change creates an immutable inventory transaction. Use database transactions, idempotency and concurrency control. No direct silent quantity edits. Orders must define reserve/release/deduct rules. Meiping import creates `INITIAL_MIGRATION` transactions.

## 支付与佣金 / Payments & commissions
WeChat Pay creation and callbacks are server-side only with signature verification, idempotency, ledger records, refunds, reconciliation and audit. No production secrets in clients or Git.

The ~6% commission is a configurable pending business rule, never a hard-coded constant. Confirm basis, eligibility, settlement, refund reversal, withdrawal and compliance before implementation.

## AI / AI workflows
Provider keys stay server-side. Use provider adapters. Long jobs are queued and must support queued/running/succeeded/failed/cancelled, retry, timeout, usage/cost, moderation and logs. Story, picture-book and animation are separate workflows sharing orchestration.

## 安全 / Security
Object storage + CDN for media. Validate uploads. Minimize PII, redact logs, audit privileged actions, enforce least privilege, protect children’s data and moderate public/AI content.

## 美萍 / Meiping migration
Only books + current stock. Do not migrate members, historical orders, finance, historical rentals, suppliers or commissions. Migration must support raw archive, dry-run, mapping, normalization, dedupe, error report, batch record, reconciliation and safe rerun.

## Done
A module is Done only with applicable UI + API + DB + Admin/Store UI + Auth/RBAC + validation + errors + logs + automated tests + docs.

## Git 协作 / Git collaboration
`main` is protected conceptually as the canonical branch. Work in short-lived branches: `fred/*`, `intern/*`, `codex/*`. No direct feature work on `main`. Every PR states: **What changed / Why / How tested**. One task = one focused change set.

Do not delete unknown files, overwrite others' work, commit secrets, or change schema without migrations. Important architecture decisions require an ADR. Production release requires human approval.

## 阶段报告 / Stage report
`Completed / Files Changed / Database Changes / Tests / Security & Permissions / Known Issues / Decisions Needed / Next Step`
