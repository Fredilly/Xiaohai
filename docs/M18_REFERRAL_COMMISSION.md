# M18 分享与佣金 / Referral & Commission

## 范围 / Scope

M18 提供消费者分享链接、订单级归因、可配置佣金规则、冻结/结算/退款冲正、提现申请，以及最小的小程序和总部管理入口。PostgreSQL 是唯一账务事实源。

M18 provides consumer referral links, order-scoped attribution, configurable commission rules, freeze/settlement/refund reversal, withdrawal requests, and minimal Mini Program and HQ management surfaces. PostgreSQL is the sole accounting source of truth.

本里程碑不定义未经确认的默认比例、结算周期、提现门槛、税费或真实打款渠道，也不开始 M19/M20。

This milestone does not define unapproved default rates, settlement cycles, withdrawal thresholds, taxes, or a real payout rail, and it does not begin M19/M20.

## 归因与计算 / Attribution and Calculation

消费者创建分享链接后可分享小程序路径。被分享者打开路径时，小程序仅保存不敏感的 referral code；创建订单时提交该 code。服务端在订单事务内解析 ACTIVE 链接，禁止自归因，并把订单、被推荐消费者和受益消费者写入唯一的 `referral_attributions`。客户端不能提交受益人或佣金金额。

After a consumer creates a referral link, they can share its Mini Program path. The recipient stores only the non-sensitive referral code and submits it when creating an order. Inside the order transaction, the server resolves an ACTIVE link, rejects self-attribution, and records the order, referred consumer, and beneficiary in unique `referral_attributions`. The client cannot submit the beneficiary or commission amount.

只有支付成功时刻存在的 ACTIVE 规则才产生佣金。金额按服务端订单 `totalMinor × rateBasisPoints / 10000` 向下取整；仓库不预置比例。没有已批准 ACTIVE 规则时安全地不产生权益。

Only an ACTIVE rule at payment-success time creates commission. The amount is floored from server order `totalMinor × rateBasisPoints / 10000`; the repository seeds no rate. With no approved ACTIVE rule, the system safely creates no entitlement.

## 账本与状态 / Ledger and States

`commission_events` 是不可变业务证据，`commission_ledger` 是 append-only 的冻结与可用余额增量。余额始终通过流水求和得到，禁止直接维护可变余额字段。

`commission_events` is immutable business evidence, while `commission_ledger` is the append-only stream of frozen and available balance deltas. Balances are always derived by summing ledger entries; no mutable balance field is maintained.

生命周期为 `FROZEN → SETTLED`，退款创建 `REVERSED`。冻结期内冲正扣减 frozen；结算后冲正扣减 available。若已提现导致 available 为负，负值表示可审计债务，后续提现会被余额检查拒绝。

The lifecycle is `FROZEN → SETTLED`, with refunds creating `REVERSED`. A pre-settlement reversal debits frozen balance; a post-settlement reversal debits available balance. If prior payout makes available negative, that negative value is auditable debt and further withdrawals fail the balance check.

提现状态机为 `REQUESTED → APPROVED → PAID`，以及 `REQUESTED/APPROVED → REJECTED`、`REQUESTED → CANCELLED`。申请时在数据库事务和受益人 advisory lock 下写 `WITHDRAWAL_HELD`，立即扣减可用额；拒绝或取消通过新流水释放，绝不删除历史。

The withdrawal state machine is `REQUESTED → APPROVED → PAID`, plus `REQUESTED/APPROVED → REJECTED` and `REQUESTED → CANCELLED`. A request writes `WITHDRAWAL_HELD` and immediately debits available balance under a database transaction and beneficiary advisory lock; rejection or cancellation releases it with a new entry and never deletes history.

## 权限与数据范围 / Permissions and Data Scope

消费者只能读取自己的链接、账本和提现申请。总部接口需要 `commission.read`、`commission.rules.manage`、`commission.settle` 或 `commission.withdrawals.review`，并且必须具有 GLOBAL Data Scope。客户端提供的 consumer、scope、金额计算结果、状态或版本外字段均不可信。

Consumers can only read their own links, ledger, and withdrawal requests. HQ endpoints require `commission.read`, `commission.rules.manage`, `commission.settle`, or `commission.withdrawals.review`, together with GLOBAL Data Scope. Client-supplied consumer, scope, calculated amount, status, or fields beyond the explicit version are never trusted.

## API 与界面 / API and UI

消费者 API 位于 `/api/v1/referrals/*` 和 `/api/v1/commissions/*`。总部 API 位于 `/api/v1/staff/commissions/*`。小程序“我的佣金”提供分享、余额、流水和提现申请；Admin Web 提供规则启停与提现审核的最小界面。

Consumer APIs live under `/api/v1/referrals/*` and `/api/v1/commissions/*`. HQ APIs live under `/api/v1/staff/commissions/*`. The Mini Program “My Commission” surface provides sharing, balances, ledger, and withdrawal requests; Admin Web provides minimal rule activation and withdrawal review.

## 并发、幂等与日志 / Concurrency, Idempotency, and Logging

订单归因由 order unique constraint 防重；支付、退款、结算和提现事件使用唯一 event key；提现使用 `(consumer_user_id, client_request_id)` 以及受益人事务锁。规则激活通过 PostgreSQL advisory lock 串行化，避免并发激活重叠规则。日志只记录 request、event、withdrawal 等 ID 和动作，不记录凭据或敏感支付信息。

Order attribution is deduplicated by an order unique constraint; payment, refund, settlement, and withdrawal events use unique event keys; withdrawals use `(consumer_user_id, client_request_id)` plus a beneficiary transaction lock. Rule activation is serialized with a PostgreSQL advisory lock to prevent concurrent overlapping active rules. Logs contain request, event, withdrawal IDs and actions only, never credentials or sensitive payment data.

## 验证 / Verification

运行 `npm exec --yes pnpm@11.19.0 -- check`、数据库检查和生成、fresh migration、API PostgreSQL integration、前端检查以及 `git diff --check`。佣金专项测试覆盖严格契约、归因、自归因拒绝、冻结/结算、幂等提现、并发余额占用与取消释放。

Run `npm exec --yes pnpm@11.19.0 -- check`, database check and generation, fresh migration, API PostgreSQL integration, frontend checks, and `git diff --check`. Commission tests cover strict contracts, attribution, self-referral rejection, freeze/settlement, idempotent withdrawals, concurrent balance holds, and cancellation release.

## 待确认决策 / Decisions Needed

- 真实生产佣金比例、适用商品/订单资格、规则优先级和归因窗口。
- Production commission rates, eligible products/orders, rule priority, and attribution window.
- 结算日历、最低/最高提现额、手续费、税务/KYC 与负余额追偿政策。
- Settlement calendar, minimum/maximum withdrawal, fees, tax/KYC, and negative-balance recovery policy.
- 真实打款供应商、失败重试和对账流程。
- Real payout provider, failure retry, and reconciliation workflow.
- 正式二维码生成/短链服务；当前交付使用微信小程序分享路径和 referral code。
- Production QR/short-link provider; the current delivery uses a Mini Program share path and referral code.
