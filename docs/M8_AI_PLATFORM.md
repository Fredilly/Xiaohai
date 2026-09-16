# M8 AI 平台

# M8 AI Platform

## 范围

## Scope

M8 建立可复用、Provider-neutral 的 AI 作业平台，供后续里程碑组合使用。本阶段只提供 `PLATFORM_TEXT` 探针，不包含 M9 故事、M10 绘本或 M11 动画业务流程，也不定义正式计价规则。

M8 establishes a reusable, provider-neutral AI job platform for later milestones to compose. This milestone exposes only a `PLATFORM_TEXT` probe; it does not implement the M9 story, M10 picture-book, or M11 animation workflows, and it does not define production pricing rules.

## 处理链路

## Processing flow

处理链路固定为 `API → Job → Queue → Worker → Provider Adapter → Moderation → Assets → Complete`。PostgreSQL 是作业及状态的权威来源；Redis 列表只保存不透明的 job ID 并作为低延迟唤醒信号。即使 Redis 通知丢失，worker 仍会定期扫描 PostgreSQL 中到期的 `QUEUED` 作业，因此通知故障不会让已提交作业永久丢失。

The fixed processing flow is `API → Job → Queue → Worker → Provider Adapter → Moderation → Assets → Complete`. PostgreSQL is authoritative for jobs and their state; the Redis list stores only opaque job IDs and acts as a low-latency wake-up signal. The worker also periodically scans PostgreSQL for due `QUEUED` jobs, so a lost notification cannot permanently lose a committed job.

## 数据模型与状态机

## Data model and state machine

`ai_projects` 保存平台项目容器和创建者 Staff 外键；`ai_jobs` 保存 Provider、模型、输入、结果引用、moderation、usage、cost metadata、重试与超时配置；`ai_job_attempts` 保存每次实际执行及 Provider request ID。生产外键、唯一约束和检查约束均保留，attempt number 在同一 job 内唯一。

`ai_projects` stores the platform project container and creator Staff foreign key. `ai_jobs` stores provider, model, input, result references, moderation, usage, cost metadata, retry, and timeout configuration. `ai_job_attempts` records each actual execution and provider request ID. Production foreign keys, uniqueness rules, and check constraints remain enforced, and attempt numbers are unique within a job.

允许的作业转换为：`QUEUED → RUNNING → SUCCEEDED`、`QUEUED → RUNNING → QUEUED`（可重试失败）、`QUEUED → RUNNING → FAILED`（终止失败），以及 `QUEUED|RUNNING → CANCELLED`。只有 `FAILED` 可以被人工 retry 回 `QUEUED`；终态不能被任意改写。worker 使用 `FOR UPDATE SKIP LOCKED` 原子抢占，避免多个 worker 重复执行同一 queued job。

Allowed transitions are `QUEUED → RUNNING → SUCCEEDED`, `QUEUED → RUNNING → QUEUED` for retryable failures, `QUEUED → RUNNING → FAILED` for terminal failures, and `QUEUED|RUNNING → CANCELLED`. Only `FAILED` may be manually retried to `QUEUED`; terminal states cannot be changed arbitrarily. Workers claim jobs atomically with `FOR UPDATE SKIP LOCKED` to prevent multiple workers from executing the same queued job.

每次请求使用 job 的 `timeout_ms` 创建 abort signal。失败按指数退避重试，且不得超过 `max_attempts`。worker 启动时会将超过执行租约的 `RUNNING` 作业恢复为 `QUEUED`；尝试结果区分 `FAILED`、`TIMED_OUT` 和 `CANCELLED`。

Each provider request receives an abort signal derived from the job's `timeout_ms`. Failures retry with exponential backoff and never exceed `max_attempts`. On startup, a worker recovers `RUNNING` jobs whose execution lease has expired back to `QUEUED`; attempt outcomes distinguish `FAILED`, `TIMED_OUT`, and `CANCELLED`.

## Provider 与 moderation

## Providers and moderation

业务服务只依赖 `AiProvider` adapter。`MockAiProvider` 仅在 `AI_MOCK_ENABLED=true` 时可启动并明确标记为不可计费；`DeepSeekAiProvider` 集中封装 endpoint、Authorization header、请求和响应字段映射。`DEEPSEEK_API_KEY` 只从 worker 服务端环境读取，不进入 API 响应、前端、队列或日志。增加 Provider 时必须实现相同 adapter，而不能把上层业务绑定到 DeepSeek。

Business services depend only on the `AiProvider` adapter. `MockAiProvider` can start only when `AI_MOCK_ENABLED=true` and explicitly marks usage as non-billable. `DeepSeekAiProvider` centralizes endpoint, Authorization header, and request/response mapping. `DEEPSEEK_API_KEY` is read only from the worker server environment and never enters API responses, frontends, the queue, or logs. New providers must implement the same adapter rather than binding higher-level business code to DeepSeek.

当前 baseline moderation 拒绝空内容和超长内容，并把其他内容标记为 `REVIEW_REQUIRED / PRODUCTION_POLICY_NOT_CONFIGURED`；输入和输出结果均写入 metadata。它是平台边界和安全失败标记，不等于生产儿童内容审核。启用真实用户内容前必须接入经批准的 production moderation adapter 和人工复核流程。

The current baseline moderation rejects empty or oversized content and marks all other content as `REVIEW_REQUIRED / PRODUCTION_POLICY_NOT_CONFIGURED`; both input and output results are persisted as metadata. This establishes the platform boundary and an explicit safety marker, but it is not production child-content moderation. An approved production moderation adapter and human-review workflow are required before real user content is enabled.

文本结果保存在 job result 中；`assetReferences` 只保存后续资产服务产生的引用，不接受客户端伪造资产归属。M8 不生成绘本或动画资产。

Text results are stored in the job result. `assetReferences` stores only references produced by a later asset service and does not accept client-supplied asset ownership. M8 does not generate picture-book or animation assets.

## API、权限与监控

## API, permissions, and monitoring

Staff API 提供 enqueue、list、status、cancel 和 retry。所有路由要求有效 Staff session、`ai.manage` 权限和 `GLOBAL` data scope；不接受客户端传入 owner、role、permission 或 scope。请求使用严格 Zod contract，响应不返回 prompt。Admin Web 只提供最小平台探针和状态监控，不包含正式 AI 内容产品 UI。

The Staff API provides enqueue, list, status, cancel, and retry operations. Every route requires a valid Staff session, the `ai.manage` permission, and `GLOBAL` data scope; client-supplied owner, role, permission, or scope values are not accepted. Requests use strict Zod contracts, and responses do not return prompts. Admin Web provides only a minimal platform probe and status monitor, not a production AI content-product UI.

结构化日志只记录 request/job/attempt 标识、状态和错误码，不应记录 prompt、生成正文、Provider key 或 Authorization header。usage 使用 Provider 返回的 token 数；cost metadata 只保存来源数据，M8 不自行推导正式金额。

Structured logs contain only request/job/attempt identifiers, states, and error codes; prompts, generated text, provider keys, and Authorization headers must not be logged. Usage uses provider-reported token counts. Cost metadata stores source data only, and M8 does not infer production prices.

## 配置与运行

## Configuration and operation

本地 Docker Compose 提供 PostgreSQL 和 Redis。API 与 worker 都需要 `REDIS_URL`；worker 还需要 `AI_PROVIDER`。选择 `MOCK` 必须显式设置 `AI_MOCK_ENABLED=true`，选择 `DEEPSEEK` 必须注入非空 `DEEPSEEK_API_KEY`。staging/production 示例只包含安全占位符，真实 key 必须由部署 secret manager 注入。

Local Docker Compose provides PostgreSQL and Redis. Both API and worker require `REDIS_URL`; the worker also requires `AI_PROVIDER`. Selecting `MOCK` requires the explicit `AI_MOCK_ENABLED=true` gate, while selecting `DEEPSEEK` requires an injected, non-empty `DEEPSEEK_API_KEY`. Staging and production examples contain safe placeholders only; real keys must be injected by the deployment secret manager.

当前一个 worker deployment 只处理其配置 Provider 的作业。需要同时运行 Mock 和 DeepSeek 时，应部署分别配置的 worker；数据库抢占条件会让每个 worker 只领取自己的 Provider 作业。

One worker deployment currently processes jobs for its configured provider only. To run Mock and DeepSeek concurrently, deploy separately configured workers; the database claim predicate ensures each worker claims only its own provider's jobs.

## 测试与手动验证

## Testing and manual verification

自动化覆盖严格 contract、RBAC 与 GLOBAL scope、数据库约束、原子创建、合法状态转换、Redis 通知、并发 worker 抢占、成功 metadata、重试上限、超时 attempt、Mock/DeepSeek adapter 映射和 secret 不泄漏。CI 使用真实 PostgreSQL migration 和 Redis service 运行 integration tests。

Automation covers strict contracts, RBAC and GLOBAL scope, database constraints, atomic creation, legal state transitions, Redis notification, concurrent worker claiming, successful metadata, retry limits, timeout attempts, Mock/DeepSeek adapter mapping, and secret non-disclosure. CI runs integration tests against a real PostgreSQL migration and Redis service.

手动验证时，以具备 `ai.manage` 和 `GLOBAL` scope 的 Staff 登录 Admin Web，创建平台探针并观察 `QUEUED → RUNNING → SUCCEEDED|FAILED`。DeepSeek 集成只能在批准的测试账号、合法 endpoint 和服务端 secret 已配置后验证；不得用 Mock 结果冒充真实 Provider 成功。

For manual verification, sign into Admin Web as a Staff identity with `ai.manage` and `GLOBAL` scope, create a platform probe, and observe `QUEUED → RUNNING → SUCCEEDED|FAILED`. DeepSeek integration may be verified only after an approved test account, valid endpoint, and server-side secret are configured; Mock results must never be represented as real-provider success.

## 已知限制与待确认决策

## Known limitations and decisions needed

- 当前没有 production moderation provider 或人工审核队列；真实儿童内容上线前必须决定并接入该能力。
- No production moderation provider or human-review queue exists yet; this capability must be selected and integrated before real child content is enabled.

- `RUNNING` 作业取消会阻止结果提交，但当前不能保证第三方 Provider 已立即停止计费；请求会在返回或 timeout 后结束。
- Cancelling a `RUNNING` job prevents result commitment, but cannot currently guarantee that the third-party provider immediately stops billing; the request ends when it returns or times out.

- Redis 是唤醒通道而非 durable source of truth；当前恢复延迟受 `AI_WORKER_POLL_MS` 影响。生产容量、Redis HA 和 dead-letter 运维告警阈值仍需确认。
- Redis is a wake-up channel, not the durable source of truth; recovery latency currently depends on `AI_WORKER_POLL_MS`. Production capacity, Redis HA, and dead-letter operational alert thresholds still require decisions.

- DeepSeek 真实凭据、允许模型、区域/数据处理条款和预算告警尚未提供或验证；M8 不提交任何生产 secret。
- Real DeepSeek credentials, allowed models, regional/data-processing terms, and budget alerts have not been provided or verified; M8 commits no production secrets.

- M9/M10/M11 必须建立自己的业务 project/job 类型、输入 contract、资产授权和 moderation policy，不得复用 `PLATFORM_TEXT` 作为正式产品流程。
- M9/M10/M11 must define their own business project/job types, input contracts, asset authorization, and moderation policies; `PLATFORM_TEXT` must not be reused as a production product workflow.
