# M15 租借 / M15 Rental

## 范围 / Scope

M15 提供消费者预约、门店借出、服务端到期/逾期判断、归还与取消的最小闭环，并提供消费者小程序和门店工作台的必要入口。M16 取书码、配送，以及押金、租金、逾期收费和支付均不在本里程碑范围内。

M15 provides the minimum closed loop for consumer reservation, staff checkout, server-side due/overdue evaluation, return, and cancellation, together with the necessary Mini Program and store-workspace entry points. M16 pickup codes and delivery, plus deposits, rental fees, overdue charges, and payments are outside this milestone.

## 状态机 / State machine

合法转换为 `RESERVED → BORROWED → OVERDUE → RETURNED`、`BORROWED → RETURNED` 和 `RESERVED → CANCELLED`。`RETURNED` 与 `CANCELLED` 是终态；客户端不能提交或覆盖状态。

Legal transitions are `RESERVED → BORROWED → OVERDUE → RETURNED`, `BORROWED → RETURNED`, and `RESERVED → CANCELLED`. `RETURNED` and `CANCELLED` are terminal, and clients cannot submit or override status.

`due_at` 在借出时由服务端使用 `RENTAL_LOAN_DAYS` 生成。读取租借数据或执行归还时，服务端以 PostgreSQL 时间将已到期的 `BORROWED` 推进为 `OVERDUE` 并写入 `SYSTEM` 事件；不依赖客户端时钟，也不计算罚金。

At checkout, the server derives `due_at` from `RENTAL_LOAN_DAYS`. When rentals are read or returned, the server uses PostgreSQL time to promote expired `BORROWED` records to `OVERDUE` and writes a `SYSTEM` event. Client clocks and financial penalties are not involved.

## 预约与库存语义 / Reservation and inventory semantics

`inventory_reservations` 是租借预留的正式状态账本。预约在单一事务内按 SKU 稳定顺序锁定 `store_inventory`，检查 `on_hand - reserved - rental_reserved`，增加 `rental_reserved`，并创建订单、项目、ACTIVE reservation 和 RESERVED event。任一步失败均整体回滚。

`inventory_reservations` is the canonical state ledger for rental reservations. Reservation locks `store_inventory` rows in stable SKU order in one transaction, checks `on_hand - reserved - rental_reserved`, increments `rental_reserved`, and creates the order, items, ACTIVE reservations, and RESERVED event. Any failure rolls back the entire operation.

取消仅释放 `rental_reserved` 并将 reservation 标记为 `RELEASED`，不产生物理库存流水。借出同时减少 `on_hand` 与 `rental_reserved`，将 reservation 标记为 `COMPLETED`；归还增加 `on_hand`。数据库约束持续保证库存非负以及 `reserved + rental_reserved <= on_hand`。

Cancellation only releases `rental_reserved` and marks reservations `RELEASED`; it does not create a physical-stock transaction. Checkout decreases both `on_hand` and `rental_reserved` and marks reservations `COMPLETED`; return increases `on_hand`. Database constraints continue to enforce nonnegative inventory and `reserved + rental_reserved <= on_hand`.

## 库存流水 / Inventory ledger

`inventory_transactions` 仅记录物理库存变化：借出写 `RENTAL_OUT`，归还写 `RENTAL_RETURN`。预留数量变化由不可变的 `rental_events` 与 `inventory_reservations` 生命周期共同审计，避免扭曲 `quantity_delta` 和 `balance_after` 的物理库存含义。

`inventory_transactions` records physical stock changes only: checkout writes `RENTAL_OUT` and return writes `RENTAL_RETURN`. Reservation changes are audited by immutable `rental_events` together with the `inventory_reservations` lifecycle, preserving the physical-stock meaning of `quantity_delta` and `balance_after`.

## 并发与幂等 / Concurrency and idempotency

预约使用消费者与幂等键的事务级 advisory lock，并保存规范化请求指纹；同一键但不同请求返回 `IDEMPOTENCY_CONFLICT`。取消、借出与归还锁定租借单，再按 SKU 顺序锁库存行。唯一事件、唯一物理流水引用、订单版本与状态检查共同防止重复释放、扣减或增加库存。

Reservation uses a transaction-level advisory lock scoped to consumer and idempotency key and stores a canonical request fingerprint; reuse with a different request returns `IDEMPOTENCY_CONFLICT`. Cancellation, checkout, and return lock the rental before locking inventory rows in SKU order. Unique events, unique physical-ledger references, order versions, and state guards prevent repeated release, deduction, or increment.

多 SKU 操作始终位于单一 PostgreSQL 事务中。同门店同 SKU 的预约与 M14 出库、调整或调拨竞争相同的库存行锁，因此不足库存不会产生部分订单、事件、reservation 或流水。

Multi-SKU operations always run in one PostgreSQL transaction. Reservations and M14 issue, adjustment, or transfer operations for the same store/SKU contend on the same inventory-row lock, so insufficient stock cannot leave partial orders, events, reservations, or ledger entries.

## 权限与数据范围 / RBAC and Data Scope

消费者 API 要求 Consumer Session，并按 `consumer_user_id` 隔离；猜测其他租借单 ID 返回 `NOT_FOUND`。员工端使用 `rental.read`、`rental.checkout`、`rental.return`、`rental.manage`，且每次操作均根据数据库中的门店层级执行 STORE、REGION、FRANCHISEE 或 GLOBAL Data Scope。

Consumer APIs require a Consumer Session and isolate data by `consumer_user_id`; guessed IDs belonging to another consumer return `NOT_FOUND`. Staff operations use `rental.read`, `rental.checkout`, `rental.return`, and `rental.manage`, and every operation enforces STORE, REGION, FRANCHISEE, or GLOBAL Data Scope against the database store hierarchy.

客户端传入的 `storeId` 和 `rentalOrderId` 仅标识目标资源，不授予权限。禁用员工无法形成授权上下文，日志仅记录 request、rental、action 和安全错误码，不记录会话凭据。

Client-provided `storeId` and `rentalOrderId` identify target resources only and never grant access. Disabled staff cannot obtain an authorization context. Logs contain request, rental, action, and safe error-code metadata, never session credentials.

## API 与界面 / API and UI

消费者端提供 `POST/GET /api/v1/rentals`、`GET /api/v1/rentals/:id` 与 `POST /api/v1/rentals/:id/cancel`。员工端在 `/api/v1/staff/rentals` 下提供列表、详情、borrow、return 与 cancel。请求 schema 为 strict，不能提交 status、dueAt、费用或授权范围。

Consumer endpoints include `POST/GET /api/v1/rentals`, `GET /api/v1/rentals/:id`, and `POST /api/v1/rentals/:id/cancel`. Staff endpoints under `/api/v1/staff/rentals` provide list, detail, borrow, return, and cancel. Request schemas are strict and do not accept status, dueAt, fees, or authorization scope.

小程序从找书结果创建单本预约，并提供“我的租借”、详情、到期/逾期展示和 RESERVED 取消。门店工作台只提供查预约、确认借出、确认归还和状态查看，不扩展为完整 M19 Store Web，也不伪造 M16 取书码。

The Mini Program creates a one-copy reservation from book-search results and provides My Rentals, detail, due/overdue display, and RESERVED cancellation. The store workspace only lists reservations and confirms checkout/return; it is not a full M19 Store Web and does not simulate M16 pickup codes.

## 测试 / Testing

契约测试覆盖 strict 输入和禁止服务端字段注入。PostgreSQL integration 覆盖认证、ownership、RBAC/Data Scope、最后一本并发预约、多 SKU 回滚、取消/借出/归还 exactly-once、逾期推进、reservation invariant 与 `RENTAL_OUT/RENTAL_RETURN` 流水。全套 API integration 必须串行执行并按 FK 顺序清理 M15 数据。

Contract tests cover strict input and rejection of server-controlled-field injection. PostgreSQL integration covers authentication, ownership, RBAC/Data Scope, last-copy concurrent reservation, multi-SKU rollback, exactly-once cancel/checkout/return, overdue promotion, reservation invariants, and `RENTAL_OUT/RENTAL_RETURN` entries. The full API integration suite must run serially and clean M15 data in FK order.

验证命令包括 `npm exec --yes pnpm@11.19.0 -- check`、DB check/generate、fresh migration、targeted/full integration、Mini Program check 和 `git diff --check`。

Verification commands include `npm exec --yes pnpm@11.19.0 -- check`, DB check/generate, fresh migration, targeted/full integration, Mini Program check, and `git diff --check`.

## 已知限制与待确认 / Known limitations and decisions needed

押金、租金、逾期收费与微信支付租借流程仍需业务确认，当前没有金额字段或收费逻辑。预约自动过期策略、续借规则、最大在借数量、损坏/遗失处理也未定义。M16 将单独处理取书码/核销码和配送。

Deposits, rental fees, overdue charges, and the WeChat Pay rental flow still require business decisions; there are no amount fields or charging logic today. Automatic reservation expiry, renewal policy, maximum concurrent rentals, and damage/loss handling are also undefined. M16 will separately cover pickup/verification codes and delivery.
