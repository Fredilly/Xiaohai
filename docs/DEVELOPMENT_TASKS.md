# DEVELOPMENT_TASKS.md — 小海童话 2.0 / Xiaohai 2.0 Production V1

Each milestone is reviewed before the next. Done = applicable UI + API + DB + Admin/Store UI + permissions + tests + logs + docs.

## M0 Plan / 方案
Create and approve `IMPLEMENTATION_PLAN.md`, monorepo design, deployment/envs, migration plan, security risks, CI, external accounts and unresolved decisions.

## M1 Foundation / 基础工程
pnpm/Turborepo; native TS Mini Program; React/Vite Admin + Store; Fastify API; worker; PostgreSQL/Drizzle; lint/test/CI; dev/staging; secrets/logging.

## M2 Identity & RBAC / 身份权限
WeChat consumer login; Staff auth; roles/permissions/data scope; permission tests.

## M3 Meiping migration / 美萍迁移工具
Books + current stock only. Raw archive, staging, normalization, dedupe, dry-run, batch, exception/reconciliation report and safe rerun.

## M4 Home/CMS / 首页
Fixed TabBar: 首页 / 胖竹全球 / 我的. Configurable home sections and content.

## M5 Commerce / 商城
Catalog/search/detail/SKU/cart/address/checkout/orders/cancel + Admin.

## M6 WeChat Pay / 微信支付
Server payment creation, verification, callback idempotency, ledger, refund, reconciliation, alerts. Production activation requires human approval.

## M7 Stories & Animation / 内容动画
Browse/search/detail/free/preview/paid entitlement/playback progress/purchases + media admin/CDN.

## M8 AI Platform / AI基础
Adapters, projects/jobs, queue/workers, retry/timeout/cost/moderation/assets/status/admin monitoring.

## M9 Story AI / 故事
Prompt controls, outline, body, rewrite/continue/polish, versions, works.

## M10 Picture Book AI / 绘本
Pagination, character profile/reference, storyboard, illustration/regenerate, layout, cover, preview. Test character consistency.

## M11 Animation AI / 动画
Script/storyboard/scenes/async generation/composition/retry/progress/preview/cost limits.

## M12 Pangzhu Stores / 门店
Regions/franchisees/stores/map/nearby/filter/search/store detail.

## M13 Book + Store Inventory Search / 找书
Title/author/ISBN/barcode → stores with sell/rent availability → buy/rent/pickup/delivery.

## M14 Inventory Operations / 进销存
Supplier/procurement/receipt/issue/adjustment/stocktake/transfer/alerts. Concurrency and authorization tests are mandatory.

## M15 Rental / 租借
Reserve/pickup/borrow/due/overdue/return/cancel + Store operations.

## M16 Pickup & Delivery / 自提配送
Pickup codes, verification, delivery zones/fees/orders/provider adapter.

## M17 Franchise / 加盟
Public application + HQ lead assignment/follow-up/approval/status.

## M18 Referral & Commission / 分享佣金
Attribution, configurable rules, freeze/settle/reverse, refund reversal, ledger, withdrawal. Gate on final business/compliance rules.

## M19 Store Web / 门店端
Operational UI for stock, orders, pickup, rental, delivery; manager adds procurement/stocktake/transfer/staff/reporting.

## M20 HQ Admin / 总部后台
Full operational, financial, content, AI, store, RBAC and audit administration.

## M21 Finance/Audit / 财务审计
Payment/refund/commission/withdrawal ledger, reconciliation, controlled export, audit.

## M22 Security/Privacy / 安全隐私
Threat review, secrets, RBAC abuse tests, uploads, rate limits, PII, child/privacy requirements, moderation.

## M23 Reliability / 性能可靠性
Load, concurrency, slow queries, queues, CDN, backup/restore, monitoring/alerts.

## M24 WeChat Experience Build / 体验版
DevTools + real iOS/Android + weak network + login/pay/video/AI/map/privacy/share/order flows.

## M25 Launch Readiness / 上线准备
WeChat主体/类目/备案/域名/支付/隐私/客服/content safety/prod DB/CDN/backups/secrets/accounts.

## M26 Final Meiping Cutover / 最终切换
Freeze old inventory → final export → dry-run → exception resolution → import → store reconciliation → owner approval → new system SoT.

## M27 Review & Release / 审核发布
Final experience acceptance → WeChat review → fixes/regression → release → smoke test → production monitoring. Human approval required.
