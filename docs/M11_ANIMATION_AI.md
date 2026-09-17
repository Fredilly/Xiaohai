# M11 动画 AI / M11 Animation AI

## 范围 / Scope

M11 为消费者自有的 AI 动画作品提供文本规划、场景异步生成、不可变修订、合成、进度、重试、预览和服务端限额。它不复用 M7 的 `animation_series` / `animation_episodes`；M7 表示平台发布、购买和播放的内容，M11 表示消费者创作过程和私有资产。

M11 provides consumer-owned AI animation planning, asynchronous scene generation, immutable revisions, composition, progress, retry, preview, and server-side limits. It does not reuse M7 `animation_series` / `animation_episodes`: M7 models platform-published commerce/playback content, while M11 models consumer creation state and private assets.

## 架构与状态 / Architecture and states

完整链路为 `Story BODY → Animation → SCRIPT → STORYBOARD → scenes → scene generations → composition → final media → READY`。PostgreSQL 是唯一权威状态；Redis 列表 `xiaohai:animation:jobs` 与 `xiaohai:animation:compositions` 仅发送唤醒信号。Redis notify 失败不会回滚已提交的 `QUEUED` 记录，worker 的 PostgreSQL polling 可以恢复。

The full flow is `Story BODY → Animation → SCRIPT → STORYBOARD → scenes → scene generations → composition → final media → READY`. PostgreSQL is the sole authoritative state; Redis lists `xiaohai:animation:jobs` and `xiaohai:animation:compositions` only carry wake-up signals. A failed Redis notification does not roll back a committed `QUEUED` row, and worker PostgreSQL polling can recover it.

Aggregate 状态按 `DRAFT → SCRIPT_READY → STORYBOARD_READY → GENERATING → COMPOSING → READY` 推进。文本 job 的终态为 `SUCCEEDED / FAILED / CANCELLED`，场景与合成的终态为 `READY / FAILED / CANCELLED`；失败绝不显示为完成。

Aggregate state progresses through `DRAFT → SCRIPT_READY → STORYBOARD_READY → GENERATING → COMPOSING → READY`. Text-job terminal states are `SUCCEEDED / FAILED / CANCELLED`; scene and composition terminal states are `READY / FAILED / CANCELLED`. Failures are never presented as completion.

## Provider 与审核边界 / Provider and moderation boundaries

文本规划继续使用 M8 provider-neutral `AiProvider`；DeepSeek 只可作为文本 provider。场景视频使用独立 `VideoProvider`，合成使用独立 `CompositionProvider`。目前仅有 deterministic Mock 实现，用于验证工程链路，不代表真实视频生成或生产合成能力。

Text planning continues to use the M8 provider-neutral `AiProvider`; DeepSeek remains text-only. Scene video uses an independent `VideoProvider`, and composition uses an independent `CompositionProvider`. Only deterministic Mock implementations currently exist; they validate the engineering flow and do not represent real video generation or production composition.

场景 prompt 复用 M8 moderation adapter；审核异常或阻断会安全失败，不调用视频 provider。真实视频及成片审核供应商/策略尚未确定，因此 staging/production 的视频和合成功能默认关闭。启用真实 provider 前必须接入可审计的输入、输出和媒体审核策略。

Scene prompts reuse the M8 moderation adapter; moderation outages or blocks fail safely before calling the video provider. A real video/final-media moderation vendor and policy remain undecided, so video and composition are disabled by default in staging and production. Auditable input, output, and media moderation must be configured before enabling a real provider.

## 修订、合成与并发 / Revisions, composition, and concurrency

每次场景生成或重新生成都会追加 `animation_scene_generations.revision_number`；每次合成或重新合成都会追加 `animation_compositions.revision_number`。历史记录和 composition inputs 不覆盖、不删除。API 在 animation 行上取锁后分配 revision，数据库 unique constraints 提供最终保护。

Every scene generation or regeneration appends an `animation_scene_generations.revision_number`; every composition or recomposition appends an `animation_compositions.revision_number`. Historical rows and composition inputs are neither overwritten nor deleted. The API locks the animation row before allocating a revision, with database unique constraints as final protection.

合成请求必须为每个 scene 恰好选择一个属于同一 animation 的 `READY` generation，且必须已有 `mediaAssetId`。输入按服务端 scene number 固定顺序保存。旧 composition worker 晚完成时不能覆盖较新 revision 的 `ai_animations.final_media_asset_id`。

A composition request must select exactly one `READY` generation with a `mediaAssetId` for every scene in the same animation. Inputs are persisted in server-defined scene-number order. A stale older composition worker cannot overwrite `ai_animations.final_media_asset_id` after a newer revision exists.

## 成本控制 / Cost controls

创建 animation 时，服务端把 `maxGenerations`、`maxCompositions` 和 `maxPlannedDurationMs` 写入 cost-limit metadata。每个场景 revision（包括失败后的 retry）计入 generation 次数，每个 composition revision 计入 composition 次数；超限返回 `BUDGET_EXCEEDED`。Mock 使用 generation/revision 数量、计划时长和 deterministic cost units，不伪造人民币价格。客户端不能提交或覆盖这些限额。

When an animation is created, the server records `maxGenerations`, `maxCompositions`, and `maxPlannedDurationMs` in cost-limit metadata. Every scene revision, including retries after failure, counts toward the generation limit; every composition revision counts toward the composition limit. Exceeding a limit returns `BUDGET_EXCEEDED`. Mock uses generation/revision counts, planned duration, and deterministic cost units without inventing RMB pricing. Clients cannot submit or override these limits.

同一 animation 与 planning operation 若已有 `QUEUED` / `RUNNING` job，服务端在数据库锁内拒绝重复创建，避免重复成本；`FAILED` / `CANCELLED` 后允许新 job。

If the same animation and planning operation already has a `QUEUED` or `RUNNING` job, the server rejects a duplicate inside a database lock to prevent duplicate cost. A new job is allowed after `FAILED` or `CANCELLED`.

## Mini Program 流程 / Mini Program flow

Mini Program 提供 animation 列表、从 Story BODY 创建、脚本/分镜规划、角色与 scenes 展示、逐 scene 生成/重新生成、composition/重新合成、polling、错误状态和最终视频 preview。页面卸载会停止 polling，并通过 busy 状态防止重复点击。客户端从不提交 provider/model/cost/status/media 字段。

The Mini Program provides animation listing, creation from Story BODY, script/storyboard planning, character and scene display, per-scene generation/regeneration, composition/recomposition, polling, error states, and final video preview. Page unload stops polling, and busy state prevents duplicate actions. The client never submits provider/model/cost/status/media fields.

配音、字幕、音乐当前版本未启用，UI 会明确显示这一限制，不伪造相关能力。

Voice-over, subtitles, and music are not enabled in this version; the UI states this limitation explicitly and does not simulate those capabilities.

## 配置 / Configuration

`ANIMATION_AI_*` 控制文本规划；`ANIMATION_VIDEO_*` 控制 Mock 场景生成；`ANIMATION_COMPOSITION_*` 控制 Mock 合成。服务端限额使用 `ANIMATION_MAX_GENERATIONS`、`ANIMATION_MAX_COMPOSITIONS` 和 `ANIMATION_MAX_PLANNED_DURATION_MS`。所有 provider/model 配置仅存在于服务端环境变量；staging/production example 默认 `false`。

`ANIMATION_AI_*` controls text planning; `ANIMATION_VIDEO_*` controls Mock scene generation; `ANIMATION_COMPOSITION_*` controls Mock composition. Server limits use `ANIMATION_MAX_GENERATIONS`, `ANIMATION_MAX_COMPOSITIONS`, and `ANIMATION_MAX_PLANNED_DURATION_MS`. All provider/model configuration remains in server environment variables; staging and production examples default to `false`.

## 验证 / Verification

运行 `npm exec --yes pnpm@11.19.0 -- check`、`npm exec --yes pnpm@11.19.0 -- --filter @xiaohai/db db:check`、API/worker PostgreSQL integration tests、Mini Program tests、Redis queue smoke、`test:e2e` 和 `git diff --check`。真实 PostgreSQL/Redis 集成验证必须使用隔离测试数据库。

Run `npm exec --yes pnpm@11.19.0 -- check`, `npm exec --yes pnpm@11.19.0 -- --filter @xiaohai/db db:check`, API/worker PostgreSQL integration tests, Mini Program tests, Redis queue smoke, `test:e2e`, and `git diff --check`. Real PostgreSQL/Redis integration verification must use an isolated test database.

## 待确认决策 / Decisions Needed

- 真实动画/视频生成 provider 与模型。
  Real animation/video generation provider and model.
- 真实 composition provider。
  Real composition provider.
- production object storage、CDN 与签名 URL 策略。
  Production object storage, CDN, and signed-URL strategy.
- 视频与成片 moderation vendor、策略、人工复核流程。
  Video/final-media moderation vendor, policy, and human-review workflow.
- production pricing、币种、结算和预算换算规则。
  Production pricing, currency, settlement, and budget conversion rules.
- TTS/voice、字幕渲染、音乐 provider 与授权。
  TTS/voice, subtitle rendering, music provider, and licensing.
