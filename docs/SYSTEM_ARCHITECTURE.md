# SYSTEM_ARCHITECTURE.md — 小海童话 2.0 / Xiaohai 2.0

## 1. 架构 / Architecture
Production V1 = **modular monolith + clear domain boundaries**. Separate workers only for AI/media/batch jobs.

```text
WeChat Mini Program ─┐
Store Web ───────────┼→ HTTPS/WAF → Fastify API → Domain Modules → PostgreSQL
HQ Admin Web ────────┘                         │       │
                                               │       ├→ Redis/Queue (when needed)
                                               │       └→ Object Storage + CDN
                                               └→ Provider Adapters: WeChat/AI/Map/Delivery
```

## 2. 技术栈 / Stack
- Language: **TypeScript** across application code.
- Mini Program: **native WeChat Mini Program + TypeScript + WXML/WXSS**.
- Admin/Store: **React + Vite**, TanStack Query; use a mature component library only where it reduces admin UI work.
- API: **Node.js LTS + Fastify + Zod**.
- Data: **PostgreSQL + Drizzle ORM/migrations**.
- Monorepo: **pnpm workspaces + Turborepo**.
- Tests: **Vitest + Playwright**, plus DevTools/real-device checks.
- Async: Redis-backed queue only when required by AI/media/notifications/imports.

Why native Mini Program: WeChat is the only mobile target today; removing Taro/uni-app reduces abstraction, debugging and platform mismatch.

## 3. Monorepo / 单仓
```text
apps/
  miniapp/
  admin-web/
  store-web/
  api/
  worker/
packages/
  domain/
  db/
  contracts/
  validation/
  config/
  test-utils/
docs/
```

Mini Program UI code is platform-specific. Share contracts, validation schemas and domain types where safe; do not force browser/server packages into the Mini Program bundle.

## 4. 领域 / Domains
IAM, CMS, Catalog, Commerce, Orders, Payments, Media, AI, Works, Stores, Inventory, Procurement, Rental, Delivery, Franchise, Referral/Commission, Finance, Notification, Moderation, Audit.

## 5. Auth / RBAC
Consumers authenticate through WeChat identity. Staff use separate staff accounts. API resolves permissions and data scope from authenticated server-side identity. Never authorize based on client-provided store/region IDs.

## 6. Inventory / 库存
PostgreSQL is the source of truth. Use transaction + row/version checks or atomic conditions for reservation/deduction. Every mutation writes `inventory_transactions`. Redis never owns canonical stock.

## 7. Payment / 支付
Server creates WeChat Pay requests and handles callbacks. Verify signatures, persist provider IDs, make callbacks idempotent, reconcile and audit. Refunds are explicit state transitions.

## 8. AI / Media
`API → Job → Queue → Worker → Provider Adapter → Moderation → Object Storage → Complete`.

Provider keys remain server-side. Record usage, cost and failure metadata. Store media files outside PostgreSQL; DB stores metadata/ownership/status.

## 9. API contract
Versioned `/api/v1`; Zod validation; consistent error shape; request ID; pagination; server authorization; rate limiting; idempotency keys for critical writes; audit for sensitive operations.

## 10. Environments / 环境
`dev`, `staging`, `production` with isolated DB, secrets, payment and storage. Production activation and release require human approval.

## 11. China/WeChat deployment
Do not bind architecture to one cloud. For mainland production, confirm domain备案/ICP and WeChat requirements before selecting region. Prefer infrastructure with reliable mainland connectivity. Dev/staging may use a different region if compliant and clearly isolated.

## 12. Observability / 恢复
Structured logs, request IDs, error tracking, latency, slow queries, queue health, payment callback failures, inventory anomalies, backups and restore drills.

## 13. ADR rule
Any change to the locked stack, data source of truth, auth model, payment model or inventory consistency model requires an ADR and explicit review.
