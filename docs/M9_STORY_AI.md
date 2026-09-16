# M9 Story AI / 故事 AI

## Scope / 范围

M9 implements the first consumer workflow built on the M8 provider-neutral AI platform.

M9 实现首个建立在 M8 Provider-neutral AI 平台之上的 Consumer AI 创作流程。

Included:

- story prompt controls: idea, age range, theme and style
- outline generation
- body generation from an outline
- rewrite, continue and polish operations
- persistent works and immutable version history
- Consumer ownership isolation
- Mini Program creation and works UI
- server-controlled AI provider and model selection

M9 does not implement picture-book pagination, character profiles, illustration generation or animation. Those belong to M10/M11.

## Architecture / 架构

The Story flow is:

Consumer Mini Program
→ Story API
→ PostgreSQL `ai_jobs`
→ Redis wake-up queue
→ M8 Worker
→ Provider Adapter
→ Moderation metadata
→ Job result
→ `work_versions`

PostgreSQL remains authoritative for job state. Redis contains only opaque job IDs and is used as a wake-up channel.

Story does not create a second AI queue or bypass the M8 state machine.

## Story project and job types

M9 adds the `STORY` AI project type.

Story job types are:

- `STORY_OUTLINE`
- `STORY_BODY`
- `STORY_REWRITE`
- `STORY_CONTINUE`
- `STORY_POLISH`

`PLATFORM_TEXT` remains an M8 platform probe and is not used for the Story product workflow.

## Data model / 数据模型

`ai_projects` supports either a Staff creator or a Consumer creator, enforced by a database owner constraint.

`works` stores the Consumer-owned Story container and creation controls:

- title
- idea
- age range
- theme
- style
- associated AI project

`work_versions` stores immutable generated versions.

Each version records:

- monotonically increasing version number within the work
- content kind: `OUTLINE` or `BODY`
- operation that produced it
- source version
- source AI job
- generated content

Outline versions have no source version.

BODY must reference an OUTLINE version from the same work.

REWRITE, CONTINUE and POLISH must reference a BODY version from the same work.

A `CONTINUE` job generates only the new continuation segment. When it is persisted, the service combines the source BODY and the new segment so every saved BODY version remains a complete story body rather than an isolated continuation fragment.

M10/M11 page, scene, character and media structures are intentionally not implemented in M9.

## Consumer ownership / 用户隔离

Consumer identity comes only from the verified Consumer Session.

The client cannot submit or override:

- consumer owner ID
- provider
- model
- AI project ownership

Work, version and job lookups are always constrained by the authenticated Consumer.

A Consumer cannot use another Consumer's work, version or job ID.

Cross-work source-version use is also rejected.

## Provider and prompt boundary / Provider 与 Prompt 边界

The Mini Program submits only product-level Story controls and editing instructions.

Provider and model are selected by server configuration:

- `STORY_AI_PROVIDER`
- `STORY_AI_MODEL`

The API constructs the provider prompt server-side.

Raw prompts, provider keys and authorization values are not exposed to the Mini Program response or structured logs.

## Feature gate and moderation / 功能开关与审核

`STORY_AI_ENABLED` defaults to `false`.

Development may explicitly enable it with the Mock Provider for engineering verification.

The current M8 baseline moderation adapter is not production child-content moderation. Normal non-empty content is currently recorded as:

`REVIEW_REQUIRED / PRODUCTION_POLICY_NOT_CONFIGURED`

This metadata is useful for validating the workflow boundary, but must not be interpreted as production content approval.

Staging and production examples therefore keep `STORY_AI_ENABLED=false`.

Real-user Story AI must not be enabled until an approved moderation policy/provider and the required human-review/compliance decisions exist.

## Mini Program / 小程序

M9 adds:

- Story creation page
- Story workspace
- My AI Works page

The Story workspace supports:

1. create a work from prompt controls
2. generate and persist an outline
3. generate body from the saved outline
4. rewrite, continue or polish saved body versions
5. inspect persistent version history

The existing Consumer Session token is reused; M9 does not introduce a second authentication mechanism.

## Failure and recovery behavior / 故障与恢复

A committed Story job remains recoverable if Redis notification fails because PostgreSQL is authoritative and the M8 worker polls queued jobs.

Only `SUCCEEDED` jobs may be saved into `work_versions`.

Failed, cancelled, queued or running jobs cannot become Story versions.

Saving the same successful AI job is idempotent through the unique `source_ai_job_id` relationship and service transaction handling.

## Verification / 验证

M9 automated coverage includes:

- strict Story contracts
- Consumer authentication
- Consumer ownership isolation
- cross-work and cross-user version rejection
- server-controlled provider/model
- Story feature gate
- Redis notification failure recovery
- unfinished/failed job rejection
- version-source semantics
- idempotent version save
- existing M5/M8 integration regression coverage

A fresh PostgreSQL database was migrated from migration 0000 through 0009.

Local Mock end-to-end verification executed:

`OUTLINE → BODY → REWRITE → CONTINUE → POLISH`

The result produced five successful Story jobs and five persisted versions in order.

Mock verification proves the engineering workflow only. It is not evidence of production DeepSeek approval or production moderation readiness.

## Deferred to later milestones / 后续里程碑

M9 intentionally does not implement:

- M10 picture-book pagination
- character consistency profiles
- illustration generation/regeneration
- cover/layout workflows
- M11 storyboard/scenes/video generation
- production child-content moderation
- production AI pricing/budget policy
- real DeepSeek production enablement
