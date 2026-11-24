# M14 进销存 / M14 Inventory Operations

## 范围 / Scope

M14 建立供应商、采购单、采购入库、直接出库、库存调整、盘点、门店调拨、库存预警和库存流水的最小闭环。完整 Store Web、租借预约、履约和总部管理不在本里程碑范围内。

M14 establishes the minimum complete loop for suppliers, purchase orders, goods receipts, direct stock issues, adjustments, stocktakes, store transfers, stock alerts, and inventory transactions. The complete Store Web, rental reservations, fulfillment, and HQ administration are outside this milestone.

PostgreSQL 是库存唯一事实源。Redis 不参与库存余额或单据状态存储。

PostgreSQL is the sole source of truth for inventory. Redis does not store stock balances or document states.

## 数据模型 / Data model

`store_inventory` 保存每个 `store + SKU` 的当前余额及乐观锁版本。`inventory_transactions` 是不可变业务流水，记录库存变化量、变化后余额、来源单据、操作员工和幂等键。M14 新增 `suppliers`、`purchase_orders`、`purchase_order_items`、`goods_receipts`、`goods_receipt_items`、`stocktakes`、`stocktake_items`、`stock_transfers` 和 `stock_transfer_items`。

`store_inventory` stores the current balance and optimistic-lock version for each `store + SKU`. `inventory_transactions` is the immutable business ledger and records the delta, resulting balance, source document, acting staff member, and idempotency key. M14 adds `suppliers`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items`, `stocktakes`, `stocktake_items`, `stock_transfers`, and `stock_transfer_items`.

M14 不创建 `inventory_reservations`。租借或订单预留的正式语义属于后续里程碑；现有 `reserved` 与 `rental_reserved` 约束保持不变。

M14 does not create `inventory_reservations`. Formal rental or order reservation semantics belong to later milestones; the existing `reserved` and `rental_reserved` constraints remain unchanged.

## 状态机 / State machines

- 采购单：`DRAFT → SUBMITTED → PARTIALLY_RECEIVED → RECEIVED`，`DRAFT` 或 `SUBMITTED` 可转为 `CANCELLED`。
- Purchase order: `DRAFT → SUBMITTED → PARTIALLY_RECEIVED → RECEIVED`; `DRAFT` or `SUBMITTED` may transition to `CANCELLED`.
- 入库单：`DRAFT → POSTED`。`POSTED` 为终态，重复过账返回原结果且不会重复增加库存。
- Goods receipt: `DRAFT → POSTED`. `POSTED` is terminal; repeated posting returns the existing result without adding stock again.
- 盘点：`DRAFT → COUNTING → REVIEWED → POSTED`，过账前可 `CANCELLED`。创建时捕获库存版本，版本过期时拒绝过账。
- Stocktake: `DRAFT → COUNTING → REVIEWED → POSTED`, with `CANCELLED` allowed before posting. The inventory version is captured at creation and stale posting is rejected.
- 调拨：`DRAFT → SUBMITTED → IN_TRANSIT → RECEIVED`，出库前可 `CANCELLED`。发出与收货分别产生 `TRANSFER_OUT` 和 `TRANSFER_IN` 流水。
- Transfer: `DRAFT → SUBMITTED → IN_TRANSIT → RECEIVED`, with `CANCELLED` allowed before dispatch. Dispatch and receipt produce `TRANSFER_OUT` and `TRANSFER_IN` ledger entries respectively.

非法跳转返回 `409 INVALID_STATE`。已经产生库存变化的单据不会被静默改写；纠错必须通过新的调整或后续明确的冲销语义完成。

Illegal transitions return `409 INVALID_STATE`. Documents that have changed stock are never silently overwritten; corrections must use a new adjustment or a future explicit reversal operation.

## 一致性与并发 / Consistency and concurrency

直接出库与调整要求 `expectedVersion` 和 UUID `idempotencyKey`。服务端在事务中锁定 `store_inventory` 行、检查版本和可用库存、更新余额与版本，并写入库存流水。余额不得低于 `reserved + rental_reserved`。

Direct issue and adjustment require `expectedVersion` and a UUID `idempotencyKey`. In one transaction, the server locks the `store_inventory` row, checks the version and available stock, updates the balance and version, and writes the inventory ledger. The balance may not fall below `reserved + rental_reserved`.

入库、盘点和调拨在 PostgreSQL 事务内锁定单据及库存行。单据终态和唯一流水约束阻止重复 POST；任一步失败会回滚余额、流水和单据状态，避免半成功。

Receipts, stocktakes, and transfers lock document and inventory rows inside PostgreSQL transactions. Terminal document states and unique ledger constraints prevent duplicate POST operations; any failure rolls back balances, ledger entries, and document state to avoid partial success.

## RBAC 与 Data Scope / RBAC and Data Scope

M14 权限为 `inventory.read`、`inventory.issue`、`inventory.adjust`、`inventory.receive`、`inventory.stocktake`、`inventory.transfer` 和 `procurement.manage`。供应商创建与修改还要求 `GLOBAL` scope。

M14 permissions are `inventory.read`, `inventory.issue`, `inventory.adjust`, `inventory.receive`, `inventory.stocktake`, `inventory.transfer`, and `procurement.manage`. Supplier creation and modification additionally require `GLOBAL` scope.

服务端根据 `stores.region_id` 与 `stores.franchisee_id` 解析真实组织关系。`STORE`、`REGION`、`FRANCHISEE` 和 `GLOBAL` 分别只能访问其真实门店范围。请求 contract 不接受 scope ID、角色或权限覆盖字段。

The server resolves the real organization relationship from `stores.region_id` and `stores.franchisee_id`. `STORE`, `REGION`, `FRANCHISEE`, and `GLOBAL` may only access their real store descendants. Request contracts do not accept scope ID, role, or permission override fields.

## API 与最小 UI / API and minimal UI

Staff API 位于 `/api/v1/staff/inventory/...`，覆盖余额、预警、流水、供应商、采购单、入库单、出库、调整、盘点与调拨。错误响应沿用 request ID 和统一错误结构；服务端结构化日志只记录请求元数据和错误码，不记录凭据。

The Staff API lives under `/api/v1/staff/inventory/...` and covers balances, alerts, ledger entries, suppliers, purchase orders, receipts, issues, adjustments, stocktakes, and transfers. Error responses retain request IDs and the common error envelope; structured server logs record only request metadata and error codes, not credentials.

Store Web 的库存模块提供真实余额、出库和调整的最小入口。采购、盘点和调拨完整管理界面留给 M19；本阶段 API 已可由受控运营工具调用。

The Store Web inventory module provides a minimal real balance, issue, and adjustment entry point. Full procurement, stocktake, and transfer management UI remains for M19; the APIs are available to controlled operations tools in this milestone.

### 2026-11-24：门店首次库存建档 / Opening stock registration

原先库存页只能操作已有 `store_inventory` 的 SKU，导致总部新建商品草稿后，门店无法录入首次实盘。本次补齐以下受控路径：

1. HQ 有权限账号先在总部后台创建商品及 SKU，保持商品 `DRAFT`。
2. Store Web 选择已授权门店，进入「库存操作 → 首次库存建档」，按 SKU 编码或商品名检索尚未关联本店的商品。
3. 具有 `inventory.read` 的账号可检索；提交必须具有 `inventory.adjust`，并通过服务端真实 `STORE/REGION/FRANCHISEE/GLOBAL` Data Scope 校验。
4. 首次实盘非零数量在单个 PostgreSQL 事务中插入 `store_inventory` 和带 `STORE_OPENING_COUNT` 标记的 `ADJUSTMENT_IN` 不可变库存流水；零数量建立零库存记录但不产生零增量流水。两种情况均记录操作人和请求 ID 的审计日志。已存在的门店 SKU 不会被覆写；重复非零请求可按 UUID 幂等键安全重放。
5. 之后从「查询已有库存」查到 SKU，数量修改走原有调整/盘点流程。首次登记**不**自动发布商品、启用销售或代替美萍正式迁移。

API：`GET /api/v1/staff/inventory/opening-candidates?storeId=...&q=...`、`POST /api/v1/staff/inventory/opening-stock`；原库存 GET 额外支持 `q` 搜索 SKU 编码和名称。

本次新增契约、Store Web、API 与隔离 PostgreSQL 集成测试；在无 `DATABASE_URL` 的环境里，集成用例无法完成实际数据库验证。正式建档还取决于可访问部署、Staff 账号、真实门店、迁移/对账及实际设备 UAT，不能把本地测试通过表述为已上线可用。

### 2026-11-24：东门店导入、南门店人工建档的操作分流

按当前门店实际安排：**东门店库存计划通过已有美萍 Excel 迁移链路导入；南门店库存计划逐件人工录入**。技术上不把门店名称硬编码到权限或账务逻辑，所有操作仍绑定员工实际授权的门店 ID。

- **东门店：** Store Web「库存」新增可上传 `.xls/.xlsx`（不超过 5 MiB）的只读预检查入口，复用现有 `POST /api/v1/staff/migrations/meiping/preflight` 及 `inventory.receive` 权限，显示源行、匹配、新建候选、异常/阻断、待核对的暂定库存和异常 CSV 下载。预检查不落地商品或库存。正式一次性迁移继续使用已有审核会话、人工实际数量、独立批准、受保护的 `INITIAL_MIGRATION` 和对账机制；不得把历史 Excel 每行暂定的 1 件当作真实盘点。
- **南门店：** 使用「首次库存建档」逐件搜索既有 SKU、录入实盘数量；有数量的建立库存流水，0 数量仍留审计记录。之后走正常库存调整或盘点。尚不存在的商品资料由具备共享主数据授权的账号先创建草稿，不得自动将南店资料公开到其他门店。
- **边界：** 这项操作分流只规定建档方法，不代表已经取得正式数据库批量写入/迁移授权，也不代表东门店 1,000 行历史数据已经准确或导入成功。

### 2026-11-24：#208 库存重试、切店与 Excel 对账保护

本轮继续在 `codex/local-release-integration` 上开发，不创建新的功能分支或 PR：

- 库存页按 Staff 会话及门店重建状态；同一门店连续查询只接受最新请求结果。首次建档选择与旧门店查询结果不会带到下一门店。
- 出库/调整在一次请求期间锁定输入并同步阻止重复提交；相同门店、SKU、版本、操作、数量、原因的手动重试复用幂等键，不自动重试。键仅在当前组件会话中保留；刷新页面/更换会话后的恢复仍须先查库存及流水，不能宣称具备持久化的一次性执行能力。
- 服务端在返回旧幂等结果前，重新校验门店权限，并绑定门店、SKU、数量、流水类型、来源类型、原因和操作员工；其他业务或首次建档流水不能冒充普通出库/调整的成功结果。首次建档已有的非零幂等路径与零库存冲突语义保持不变。
- Excel 汇总必须满足「匹配 + 新建候选 + 异常 = 源记录」、阻断不超过异常、待实盘行数等于源记录。不满足时拒绝展示。页面展示门店 ID 和源 SHA-256；CSV 文件名带门店及指纹前缀，并拒绝把成功 HTTP 中的 JSON 当作 CSV 下载。所有结果仍只是只读预检查。

**自动验证：** API 单测 197/197（含新增 11 项幂等边界）、Store Web 单测 53/53、Admin Web 单测及小程序单测 159/159 通过；API/Store Web TypeScript、lint 和 build 通过。以上单测不是 PostgreSQL 实际事务验证，不代表正式导入或真实库存验收。

**浏览器交互回归：** 新增独立的 `pnpm test:inventory-web`，使用 Vite 回环端口与拦截的合成 API，覆盖乱序库存读取、重复提交/断网重试、切店清空建档、旧 Excel 响应隔离、CSV 下载类型/指纹，以及只读/单项写权限的操作入口。须先安装 Playwright Chromium（或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定可运行的 Chromium）。本次 Work 沙箱拒绝 Chromium 本地 socket；提升执行权限也被环境策略拒绝，因此这 6 项仅已完成测试代码、类型检查与用例发现，**实际浏览器验收未通过/未完成**。本轮没有连接业务 PostgreSQL、BOS 或执行真实库存写入。

**#208 当前状态更新：** 已将 #209/#211/#213 及食品 #214–#217 的已有能力合入本地集成分支供组合测试，没有合并到 main。#217 的多批次 P1 已实现，远端 HEAD `e86bdb6` 的 CI 和容器验证成功，仍须 Fred 独立复审。集成分支已按用户决定实现门店独立售价，并通过含真实迁移的完整 API PostgreSQL 回归 254 项；四项特定门禁用例仍明确跳过。食品正式 intake/状态管理 API 与门店/总部入口已在集成分支补齐且写入默认关闭；0045 专用冻结/过期销毁已补齐；批次预留/销售/退款/调拨与实际门店验收仍需完成，不能将内部 writer 或 schema 视作已上线食品经营闭环。

## 验证 / Verification

运行 `npm exec --yes pnpm@11.19.0 -- check`、`npm exec --yes pnpm@11.19.0 -- --filter @xiaohai/db db:check`、`db:generate`、fresh database migration 和 `apps/api/test/inventory-operations.integration.test.ts`。集成测试覆盖认证、权限、Data Scope、并发超扣、版本过期、重复入库/调拨以及事务回滚。

Run `npm exec --yes pnpm@11.19.0 -- check`, `npm exec --yes pnpm@11.19.0 -- --filter @xiaohai/db db:check`, `db:generate`, a fresh database migration, and `apps/api/test/inventory-operations.integration.test.ts`. Integration tests cover authentication, permissions, Data Scope, concurrent overdraw, stale versions, duplicate receipt/transfer posting, and transaction rollback.

## 已知限制与待确认决策 / Known limitations and Decisions Needed

完整供应商结算、采购审批层级、退供单据、正式冲销单、可配置预警规则和 M19 完整操作 UI 尚未实现。当前预警由实时可用库存与请求阈值派生，不保存为第二份库存事实。

Complete supplier settlement, purchase approval hierarchy, return-to-supplier documents, formal reversal documents, configurable alert rules, and the full M19 operations UI are not implemented. Current alerts are derived from live available inventory and a request threshold and are not stored as a second inventory truth.

Rental、pickup/delivery 以及订单驱动的正式 reservation 规则必须在 M15/M16 中单独确定；M14 不预先改变这些业务语义。

Rental, pickup/delivery, and order-driven formal reservation rules must be decided separately in M15/M16; M14 does not pre-emptively alter those business semantics.
