# M10 AI 绘本 / M10 AI Picture Book

## 范围 / Scope

M10 将已保存且归属于当前消费者的 Story BODY 转换为绘本。范围包括角色设定、分页分镜、逐页插画 revision、Mini Program 工作流，以及基于 Mock Image Provider 的可测试图片工程链路。M10 不包含动画生成。

M10 converts a saved Story BODY owned by the current consumer into a picture book. It includes character planning, page storyboards, per-page illustration revisions, the Mini Program workflow, and a testable image pipeline backed by the Mock Image Provider. M10 does not include animation generation.

## 能力边界 / Capability boundaries

文本任务复用 M8 的 `AiProvider`、`ai_jobs`、Redis wake-up 和 worker 状态机。`PICTURE_BOOK_CHARACTERS` 生成结构化角色设定，`PICTURE_BOOK_STORYBOARD` 生成结构化封面及正文分页。DeepSeek 只属于文本 Provider 边界，不被视为图片生成模型。

Text tasks reuse the M8 `AiProvider`, `ai_jobs`, Redis wake-up signal, and worker state machine. `PICTURE_BOOK_CHARACTERS` generates structured character plans, while `PICTURE_BOOK_STORYBOARD` generates a structured cover and content pages. DeepSeek remains inside the text-provider boundary and is not treated as an image-generation model.

图片任务使用独立的 `ImageProvider` 接口、独立 Redis wake-up key 和 `ImageJobProcessor`。PostgreSQL 的 `work_page_illustrations` 是权威任务状态；Redis 只发送不透明 illustration ID 作为唤醒信号。当前仅实现 `MockImageProvider`，它返回确定性的伪对象存储引用，不生成真实图片。

Image tasks use a separate `ImageProvider` interface, a separate Redis wake-up key, and `ImageJobProcessor`. PostgreSQL `work_page_illustrations` is authoritative for task state; Redis carries only an opaque illustration ID as a wake-up signal. Only `MockImageProvider` is implemented now, and it returns deterministic fake object-storage references rather than real images.

## 数据与状态机 / Data and state machines

`picture_books` 关联消费者、来源 Story work、不可变来源 BODY version 和 M8 AI project。`character_profiles` 保存角色描述、`visualPrompt`、稳定 `consistencyKey` 和可选 `referenceMediaAssetId`。`work_pages` 保存封面与正文页分镜。`work_page_illustrations` 保存不可变 revision 历史。

`picture_books` links the consumer, source Story work, immutable source BODY version, and M8 AI project. `character_profiles` stores the character description, `visualPrompt`, stable `consistencyKey`, and optional `referenceMediaAssetId`. `work_pages` stores cover and content-page storyboards. `work_page_illustrations` stores immutable revision history.

插画状态为 `QUEUED → RUNNING → READY | FAILED`。只有存在 `mediaAssetId` 时才能进入 `READY`。Provider 失败写入 `FAILED` 和安全错误码，不创建虚假 READY asset。重新生成总是创建下一条 revision；旧 revision 和旧 media reference 不被删除或覆盖。页面行锁与 `(page_id, revision_number)` 唯一约束共同保证并发 revision 单调且不重复。

Illustration states are `QUEUED → RUNNING → READY | FAILED`. A revision can become `READY` only when `mediaAssetId` exists. Provider failures persist `FAILED` with a safe error code and never create a false READY asset. Regeneration always creates the next revision; earlier revisions and media references are neither deleted nor overwritten. A page row lock plus the unique `(page_id, revision_number)` constraint keeps concurrent revisions monotonic and unique.

图片二进制和 base64 不进入 PostgreSQL。`media_assets` 只保存 provider、object key、播放/访问 URL、MIME type、大小和状态等 metadata/reference。Mock 的每个 illustration revision 使用独立 generation key，因此即使 prompt 相同也不会复用并更新旧 revision 的对象引用。

Image binary and base64 data never enter PostgreSQL. `media_assets` stores only metadata/references such as provider, object key, playback/access URL, MIME type, size, and status. Each Mock illustration revision uses a distinct generation key, so identical prompts do not reuse and update an older revision's object reference.

## 一致性约束 / Consistency constraints

每次图片请求会把相关绘本角色的 `consistencyKey`、`visualPrompt` 和可选 `referenceMediaAssetId` 持久化在 revision 中，并原样传给 `ImageProvider`。当前数据模型没有页面到角色的显式映射，因此安全地传递该绘本的全部角色约束。

Every image request persists each relevant book character's `consistencyKey`, `visualPrompt`, and optional `referenceMediaAssetId` on the revision and passes them unchanged to `ImageProvider`. The current model has no explicit page-to-character mapping, so all character constraints for the book are safely supplied.

Mock 测试只证明一致性约束和 reference 被正确传播、revision 和 media reference 被正确保存；它不证明真实供应商生成结果具有视觉一致性或达到质量标准。

Mock tests prove only that consistency constraints and references are propagated and that revisions and media references are persisted correctly. They do not prove visual consistency or production image quality from a real provider.

## API 与权限 / API and authorization

所有 Picture Book API 都要求有效 Consumer Session。来源 Story BODY、picture book、page、AI job 和 illustration 查询均按当前消费者归属过滤。跨消费者 ID 返回 not found，防止对象枚举。客户端只能提交产品级操作和资源 ID，不能提交 consumer ID、provider、model、prompt 或媒体状态。

Every Picture Book API requires a valid Consumer Session. Source Story BODY, picture book, page, AI job, and illustration lookups are constrained to the current consumer. Cross-consumer IDs return not found to resist object enumeration. The client submits only product operations and resource IDs; it cannot submit consumer ID, provider, model, prompt, or media state.

主要接口包括：创建/列出/读取绘本、提交角色或分镜文本任务、查询并应用成功任务，以及逐页生成、重新生成和列出插画 revisions。Provider 与 model 完全由服务端环境配置控制。

The primary endpoints create/list/read books, enqueue character or storyboard text jobs, query and apply successful jobs, and generate, regenerate, or list per-page illustration revisions. Provider and model selection is controlled exclusively by server environment configuration.

## Mini Program 流程 / Mini Program flow

消费者可从已有 Story BODY 创建绘本，然后依次生成角色设定和分页分镜。工作台展示 COVER 与 CONTENT 页、页面文案、分镜状态、插画任务状态、当前及历史 revisions，并支持逐页首次生成和保留历史的重新生成。loading、polling、empty、error 与 feature-disabled 状态均有明确反馈。

A consumer can create a picture book from an existing Story BODY, then generate character planning and the page storyboard in order. The workspace displays COVER and CONTENT pages, story text, planning status, illustration task status, current and historical revisions, and per-page initial generation or history-preserving regeneration. Loading, polling, empty, error, and feature-disabled states all have explicit feedback.

Mini Program 保持现有 Consumer Session，不发送 provider/model，也不伪造 media URL 或成功状态。当前 Mock media reference 以 ID 展示；真实图片展示依赖未来对象存储/CDN 决策。

The Mini Program preserves the existing Consumer Session, sends no provider/model, and never invents media URLs or success states. Mock media references are currently displayed as IDs; real image rendering depends on the future object-storage/CDN decision.

## 配置与安全关闭 / Configuration and fail-closed behavior

`PICTURE_BOOK_AI_ENABLED` 和 `PICTURE_BOOK_IMAGE_ENABLED` 默认均为 `false`。staging/production 示例保持关闭。文本配置包括 provider、model、attempt 和 timeout；图片配置包括独立 provider、model 和 timeout。生产 secret、供应商 key、证书或真实域名不得进入仓库。

`PICTURE_BOOK_AI_ENABLED` and `PICTURE_BOOK_IMAGE_ENABLED` both default to `false`, and the staging/production examples keep them disabled. Text configuration includes provider, model, attempts, and timeout; image configuration has its own provider, model, and timeout. Production secrets, provider keys, certificates, and real domains must never enter the repository.

## 测试与手动验证 / Testing and manual verification

自动化覆盖来源与 ownership 隔离、严格请求 schema、服务端 provider/model、功能关闭、结构化文本输出原子应用、并发 revision 分配、历史保留、consistency 传播、worker READY/FAILED 语义、media reference 以及无图片二进制存储。fresh database 必须从 `0000` 迁移到最新版本，并重复执行 `db:generate` 确认没有 schema drift。

Automation covers source and ownership isolation, strict request schemas, server-controlled provider/model, disabled features, atomic application of structured text output, concurrent revision allocation, history preservation, consistency propagation, worker READY/FAILED semantics, media references, and absence of image binary storage. A fresh database must migrate from `0000` to the latest version, and a repeated `db:generate` must confirm no schema drift.

本地 Mock 手动验证需要 PostgreSQL 与 Redis，显式开启两个 Picture Book feature flags，并使用 Consumer Session 执行：Story BODY → Picture Book → CHARACTERS → STORYBOARD → illustration revision 1 → regenerate revision 2 → 检查两条 revision 与各自 `media_assets` reference → 打开整书工作台。

Local Mock manual verification requires PostgreSQL and Redis, both Picture Book feature flags explicitly enabled, and a Consumer Session. Execute: Story BODY → Picture Book → CHARACTERS → STORYBOARD → illustration revision 1 → regenerate revision 2 → verify both revisions and their `media_assets` references → open the full-book workspace.

## 已知限制 / Known limitations

当前没有真实图片生成供应商、真实对象存储/CDN、图片内容审核或正式 AI pricing。Mock URL 不可用于生产展示。当前没有页面到角色的显式选择，图片请求传递整本绘本的全部角色一致性约束。

There is currently no real image-generation provider, production object storage/CDN, image moderation, or formal AI pricing. Mock URLs are not suitable for production display. Pages do not yet select characters explicitly, so image requests carry all character consistency constraints for the book.

## 待确认决策 / Decisions Needed

- 选择并安全评审真实 production image provider 及其模型能力、区域、数据保留和儿童内容条款。
- Select and security-review the production image provider, including model capability, region, data retention, and child-content terms.
- 确定对象存储、CDN、签名 URL、生命周期与删除策略。
- Decide object storage, CDN, signed URL, lifecycle, and deletion policies.
- 确定输入/输出图片审核供应商、失败策略和人工复核流程。
- Decide input/output image moderation provider, failure policy, and human-review workflow.
- 确定正式 usage/cost/pricing 与消费者额度策略。
- Decide formal usage, cost, pricing, and consumer quota policies.
- 是否新增页面级角色关联，以缩小传给图片 Provider 的一致性集合。
- Decide whether to add page-level character associations to narrow the consistency set sent to the image provider.
