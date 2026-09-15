# M6 微信支付 / M6 WeChat Pay

## 范围 / Scope

实现直连普通商户 API v3 小程序支付、服务端整单退款、回调和逐笔主动对账。保留 M1–M5 身份、RBAC/Data Scope、订单归属、整数金额与订单快照规则；不实现 M7、库存扣减或佣金。生产支付默认关闭，启用及上线必须人工批准。

Implements API v3 direct-merchant Mini Program payments, server-side full refunds, notifications and on-demand per-payment reconciliation. M1–M5 identities, RBAC/Data Scope, ownership, integer amounts and order snapshots remain authoritative. No M7, inventory deduction or commissions. Production payments default to disabled; activation and release require human approval.

## 数据与迁移 / Data and migration

Drizzle custom migration `0006_wechat_pay.sql` 新增 `payments`、`payment_callbacks`、`refunds`、`payment_ledger`、`reconciliation_runs`、`reconciliation_items`。每个订单只有一笔支付意图，每笔支付只有一个整单退款意图；商户支付单号、微信交易号、退款单号和微信退款号唯一。流水仅追加，应用不提供修改或删除接口。不保存回调原文、openid、地址或密钥，回调仅保存事件 ID、SHA-256 摘要和关联信息。

Drizzle custom migration `0006_wechat_pay.sql` adds `payments`, `payment_callbacks`, `refunds`, `payment_ledger`, `reconciliation_runs` and `reconciliation_items`. Each order has one payment intent and each payment one full-refund intent. Merchant/payment/refund provider identifiers are unique. Ledger writes are append-only with no application update/delete endpoint. Callback storage contains only event ID, SHA-256 digest and references, not raw payloads, openids, addresses or keys.

沿用仓库 custom SQL migration 路径；已有 M3–M5 未完整更新生成器 snapshot，本次不重写旧迁移。`db:check` 只检查迁移元数据一致性，不能代替 PostgreSQL 实际执行；未来执行自动 schema diff 前必须先修复完整 snapshot 基线，避免重复建表。

Uses the repository's custom SQL migration approach without rewriting historical migrations. Existing M3–M5 generator snapshots are incomplete. `db:check` validates migration metadata, not actual PostgreSQL execution. Before future automatic schema diff generation, repair the complete snapshot baseline to avoid duplicate table generation.

## API 与权限 / API and authorization

- `POST /api/v1/payments/wechat`：Consumer Session，严格输入 `{ orderId }`；返回 `{ paymentId, parameters }`。服务端检查订单归属和 UNPAID，从订单 `totalMinor` 取金额，从该消费者与配置 AppID 对应的 WeChat identity 取 openid。客户端不得传金额、角色或身份。
  `POST /api/v1/payments/wechat`: Consumer Session, strict `{ orderId }`; returns `{ paymentId, parameters }`. Server checks ownership and UNPAID, reads `totalMinor` from the order and openid from the consumer identity for the configured AppID. No client amount, role or identity input.
- `POST /api/v1/payments/wechat/notify`：支付和退款共用 HTTPS 回调路径，不使用用户 Session，必须通过微信签名验证；事务提交后才返回 204，异常返回非 2xx 以便重试。
  `POST /api/v1/payments/wechat/notify`: shared HTTPS payment/refund callback, authenticated by WeChat signature rather than user session. Returns 204 only after transaction commit; failures return non-2xx for retry.
- `GET /api/v1/staff/payments`：`payments.read` + GLOBAL；最多返回最近 100 笔，避免暴露 provider 凭据或消费者信息。
  `GET /api/v1/staff/payments`: `payments.read` + GLOBAL; returns at most 100 recent records without provider credentials or consumer information.
- `POST /api/v1/staff/refunds`：`payments.refund` + GLOBAL，严格输入 `{ paymentId }`；金额固定为服务端整单金额。返回退款 ID、支付 ID、状态和金额。
  `POST /api/v1/staff/refunds`: `payments.refund` + GLOBAL, strict `{ paymentId }`; amount is the server's full payment amount. Returns refund/payment IDs, status and amount.
- `POST /api/v1/staff/payments/:id/reconcile`：`payments.reconcile` + GLOBAL；主动查询微信支付及已存在的退款单，返回 `runId` 与 `MATCHED/PENDING/REVIEW_REQUIRED/FAILED`。
  `POST /api/v1/staff/payments/:id/reconcile`: `payments.reconcile` + GLOBAL; queries WeChat payment and any existing refund and returns `runId` plus `MATCHED/PENDING/REVIEW_REQUIRED/FAILED`.

新权限键必须通过已有受控配置流程授予指定财务人员；迁移不自动授予任何员工权限，也不复用 catalog.manage 作为退款授权。当前订单未绑定正式门店，因此拒绝仅 STORE/REGION scope 的财务操作，后续不得把客户端 store_id 当作授权依据。

New permission keys must be provisioned for designated finance staff through existing controlled processes. Migrations grant no staff permissions; catalog.manage is not refund authority. Orders currently lack a formal store relationship, so STORE/REGION-only financial operations are denied. Future authorization must not trust client store_id.

## 状态机与并发 / State machines and concurrency

支付：`PENDING → SUCCEEDED` 仅接受验签回调或验签查询确认的 SUCCESS/REFUND；`PENDING → CLOSED` 仅接受微信 CLOSED/REVOKED。超时和 HTTP 错误不是支付失败终态，保留原商户单号重试。SUCCEEDED 不回退为 PENDING/CLOSED。

Payment: `PENDING → SUCCEEDED` only from verified SUCCESS/REFUND notifications or queries; `PENDING → CLOSED` only from provider CLOSED/REVOKED. A provider-side `REFUND` is treated as a financial discrepancy and never changes an `UNPAID` order to `PAID`; it is flagged for review/reconciliation. Timeouts/HTTP failures are not terminal payment rejection; retries reuse the merchant number. SUCCEEDED never regresses to PENDING/CLOSED.

订单：支付确认时仅 `UNPAID → PAID`。M5 的 `UNPAID → CANCELLED` 保持；若取消先发生而微信成功晚到，记录已收款流水和 `reviewRequired`，订单保持 CANCELLED，禁止恢复履约。由受控财务整单退款处理，不自动编造退款成功。行锁顺序为 order → payment → refund。

Order: payment confirmation permits only `UNPAID → PAID`. M5 `UNPAID → CANCELLED` remains. If cancellation wins before late payment success, record the received money and `reviewRequired`, leave the order CANCELLED and never revive fulfillment. Controlled finance full-refund handling is required; no fabricated refund success. Lock order is order → payment → refund.

退款：仅 PAID 或存在晚到支付的 CANCELLED 订单支持整单退款。先持久化 PENDING；PAID 订单变 REFUNDING。微信受理后进入 PROCESSING；验签返回或回调/查询 SUCCESS 后进入 SUCCEEDED，REFUNDING → REFUNDED。CLOSED 表示退款关闭，REFUNDING 恢复原 PAID；ABNORMAL 保持人工关注，不自动恢复。CANCELLED 订单即使退款成功也保持 CANCELLED，退款事实由退款表和流水表达。终态不接受逆向跳转，迟到 PROCESSING 响应不能覆盖终态。

Refund: full refunds support PAID orders or CANCELLED orders with late payment. Persist PENDING first; PAID becomes REFUNDING. Provider acceptance becomes PROCESSING; verified SUCCESS response/notification/query becomes SUCCEEDED and REFUNDING → REFUNDED. CLOSED restores REFUNDING to original PAID. ABNORMAL requires review without automatic restoration. CANCELLED remains CANCELLED even after refund success; refunds and ledger express the financial result. Terminal states cannot reverse; stale PROCESSING responses cannot overwrite them.

相同回调事件 ID 和摘要重复投递直接幂等返回；相同 ID 不同摘要拒绝。不同事件 ID 的同笔支付通过行锁、终态检查和唯一流水键避免重复记账。微信交易号跨订单重复会触发数据库唯一约束并回滚整个回调事务。退款接口超时保留同一退款单号，不用新号再次扣款/退款。

Repeated callback ID plus digest is idempotent; same ID with a different digest is rejected. Different event IDs for the same payment are deduplicated through locks, terminal-state checks and unique ledger event keys. Reusing a WeChat transaction ID across orders violates a DB unique index and rolls back the entire callback transaction. Refund timeouts preserve the same refund number rather than creating a new refund.

## 签名、配置与日志 / Signatures, configuration and logging

使用 Node.js crypto 的 RSA-SHA256 请求签名和小程序调起签名。响应及回调校验微信公钥 ID、时间戳（5 分钟容差）、nonce 与原始报文签名，再使用 API v3 key 进行 AES-256-GCM 解密。未知公钥 ID、篡改、过期、解密失败均安全拒绝。平台公钥从授权来源通过 secret mount 配置，不从未认证请求下载；轮换前应同步部署受信任公钥。HTTP 超时 5 秒，禁止重定向。

Uses Node.js crypto RSA-SHA256 for request and Mini Program signatures. Responses/notifications validate the trusted WeChat key ID, timestamp (five-minute tolerance), nonce and exact raw-body signature before AES-256-GCM decryption with the API v3 key. Unknown key IDs, tampering, stale timestamps and decryption failures are rejected. Trusted platform public keys are configured from an authorized source through secret mounts, never downloaded from unauthenticated input. Deploy trusted keys before rotation. HTTP timeout is five seconds; redirects are disabled.

三个环境的 example 均默认 `WECHAT_PAY_ENABLED=false`。真实配置由 secret manager 注入：`WECHAT_APP_ID`、`WECHAT_PAY_MCH_ID`、`WECHAT_PAY_MERCHANT_SERIAL`、`WECHAT_PAY_PRIVATE_KEY_PATH`、`WECHAT_PAY_API_V3_KEY`（32 字节）、`WECHAT_PAY_PLATFORM_KEY_ID`、`WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH`、支付及退款 HTTPS notify URL。私钥、公钥/证书内容不提交 Git。启用但配置不完整时拒绝启动支付配置；关闭时接口返回 503，其他 M1–M5 能力仍可运行。

All environment examples default to `WECHAT_PAY_ENABLED=false`. Inject actual configuration through a secret manager: `WECHAT_APP_ID`, `WECHAT_PAY_MCH_ID`, `WECHAT_PAY_MERCHANT_SERIAL`, `WECHAT_PAY_PRIVATE_KEY_PATH`, 32-byte `WECHAT_PAY_API_V3_KEY`, `WECHAT_PAY_PLATFORM_KEY_ID`, `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH`, and HTTPS payment/refund notify URLs. Never commit private keys or public-key/certificate contents. Enabled but incomplete configuration fails startup validation; disabled payment endpoints return 503 while M1–M5 remain available.

日志只记录 request ID、内部支付/退款 ID、员工 ID、状态或固定错误码，不记录密钥、签名、prepay_id、openid、回调原文、完整请求体或 provider 错误内容。`PAYMENT_REVIEW_REQUIRED`、对账 FAILED/REVIEW_REQUIRED 与固定失败日志作为告警接入点；外部告警投递、响应值班与告警阈值仍需部署配置。

Logs contain only request IDs, internal payment/refund IDs, staff IDs, statuses or fixed error codes—not keys, signatures, prepay IDs, openids, raw callbacks, full request bodies or provider error contents. `PAYMENT_REVIEW_REQUIRED`, FAILED/REVIEW_REQUIRED reconciliation and fixed failure logs are alert integration points; external alert delivery, on-call ownership and thresholds still require deployment configuration.

## 前端与验证 / Clients and verification

小程序订单详情调用服务端创建接口，再调用 `wx.requestPayment`；客户端 success 只触发刷新，不修改 PAID。后台财务入口提供真实支付列表、逐笔对账和二次确认整单退款，服务端权限仍是最终边界。

Mini Program order detail requests server payment parameters then calls `wx.requestPayment`; client success only refreshes the server order, never assigns PAID. The Admin finance entry offers real payment records, per-payment reconciliation and confirmation-gated full refunds, with server authorization as the final boundary.

自动检查命令如下。单元测试用运行时生成的 RSA 测试密钥验证验签/解密和安全失败；真实 PostgreSQL integration 覆盖并发回调、唯一约束、金额/归属、取消竞争、退款重试和对账。测试 provider 仅存在于测试中，不作为生产 fallback。CI 继续使用已有 PostgreSQL service 执行完整迁移和 integration。

Run the following automated checks. Unit tests use runtime-generated RSA test keys for signature/decryption and fail-closed behavior; real PostgreSQL integration covers concurrent callbacks, uniqueness, amount/ownership, cancellation races, refund retries and reconciliation. Test providers exist only in tests, never as production fallbacks. Existing CI PostgreSQL service runs migrations and integration tests.

```bash
pnpm check
pnpm --filter @xiaohai/db db:check
pnpm --filter @xiaohai/db db:migrate
pnpm test:integration
pnpm test:e2e
git diff --check
```

## 未验证与待确认 / Unverified items and decisions needed

尚需真实商户与 AppID 绑定、JSAPI/小程序支付权限、微信支付公钥/商户证书配置、外网 HTTPS 回调及合法 request 域名，以及授权真机支付/退款验证。不要把真实密钥发进 PR 或聊天；应配置到部署环境的 secret manager。上线前必须验证支付取消、网络超时、重复回调、退款与资金账单一致性。

Still requires real merchant/AppID binding, JSAPI/Mini Program payment capability, WeChat public-key/merchant-certificate configuration, public HTTPS callbacks, legal request domains and authorized real-device payment/refund validation. Do not send real secrets in PRs or chat; configure the deployment secret manager. Before launch, validate cancellation, timeouts, duplicate notifications, refunds and consistency with financial bills.

当前是逐笔主动查询对账基础，不是微信日账单下载/解析、手续费结算或完整 M21 财务总账。尚无自动定时补查、外部告警投递、公钥双钥轮换、部分退款、已履约退款政策、关闭退款后的重新申请流程。超过 100 笔的批处理、零元订单、自动关单以及取消后晚到支付的自动退款需独立确认；当前保守拒绝/人工处理。M5 尚无正式库存，不能据此直接开放生产售卖。

This is per-payment query reconciliation, not daily WeChat bill download/parsing, fee settlement or the full M21 finance ledger. Scheduled recovery, external alert delivery, dual-key rotation, partial refunds, post-fulfillment refund policy and reapplication after a CLOSED refund are not implemented. Batch processing beyond 100 records, zero-value orders, automatic provider close and automatic refunds for late payments require separate decisions; current handling is fail-closed/manual. M5 lacks formal inventory; this does not authorize production sales.

这些限制不应通过修改 M5 金额、归属或已有授权语义来规避。M6 PR 必须人工安全评审，真实配置和验收完成前不得认定生产支付已可上线。

Do not bypass these limitations by changing M5 amounts, ownership or existing authorization semantics. The M6 PR requires human security review; production payment readiness must not be claimed before real configuration and acceptance testing.
