# M17 加盟 / M17 Franchise

## 范围 / Scope

M17 实现加盟业务的最小生产闭环：用户端查看加盟介绍、条件与流程并提交申请；总部端查看线索、分配负责人、追加跟进记录、审核并推进状态。M18 分享佣金、M19 门店端完整运营、M20 总部后台总整合、合同电子签署与加盟费用支付均不在本里程碑范围内。

M17 delivers the minimum production franchise workflow: public/consumer introduction, requirements, process and application submission; HQ lead listing/detail, assignment, append-only follow-up, review and lifecycle status management. M18 referral/commission, M19 full Store Web, M20 full HQ Admin consolidation, e-signature and franchise-fee payment are out of scope.

## 当前基线 / Baseline audit

- M16 已进入 `main`；M17 分支从最新 `main` 创建。
- API 当前没有 `franchise` 领域模块。
- M12 已有组织层级中的 `franchisees`，它表示正式加盟商组织，不等同于 M17 的加盟申请/线索。
- DB 当前没有 `franchise_applications` 与 `franchise_followups` 的 Drizzle schema/export/migration。
- 小程序“胖竹全球”已有门店、地图、找书入口，但没有加盟申请页面。
- HQ Admin 目前有真实 CMS/Catalog/Content/AI/Payment 模块以及未来模块占位，没有 Franchise Manager。

M17 必须保持“申请线索”和“正式加盟商组织”两个概念分离。只有业务流程达到后续正式建档条件时，才允许未来显式转化；本里程碑不自动创建 M12 `franchisees`。

## 状态机 / State machine

服务端控制状态，客户端不能任意提交目标状态。建议状态：

`SUBMITTED → ASSIGNED → FOLLOWING_UP → APPROVED → SIGNED → PREPARING → OPENED`

允许终止状态：`REJECTED`、`CLOSED`。

- 新申请固定进入 `SUBMITTED`。
- 分配负责人后进入 `ASSIGNED`。
- 首次有效跟进可进入 `FOLLOWING_UP`。
- 审核只能从服务端允许的前置状态进入 `APPROVED` 或 `REJECTED`。
- `SIGNED / PREPARING / OPENED` 只表示业务进度，不代表本系统已实现合同签署或开店自动化。
- 具体加盟审核标准仍是业务待确认项，不在代码中硬编码。

## 数据模型 / Data model

### `franchise_applications`

核心字段：

- `id` UUID PK
- `application_number` unique
- `name`, `phone`, optional `email`
- 意向区域：`country`, `region/province`, `city`, optional `district`
- optional `background`, `message`
- `status`
- `assigned_staff_account_id` nullable FK → `staff_accounts`
- `submitted_by_consumer_user_id` nullable FK → `consumer_users`
- review metadata: `reviewed_by_staff_account_id`, `reviewed_at`, `review_note`
- lifecycle timestamps as applicable
- `version`
- `created_at`, `updated_at`

公共申请允许匿名或已登录消费者提交，但不得把 Staff 身份或审核字段暴露给客户端写入。手机号等 PII 不写入普通业务日志。

### `franchise_followups`

- `id` UUID PK
- `franchise_application_id` FK
- `staff_account_id` FK
- `channel/type`
- `note`
- optional `next_followup_at`
- `created_at`

跟进记录 append-only；新增记录而不是覆盖历史。

## 权限与数据范围 / RBAC and Data Scope

总部员工端使用服务端 Staff Session + RBAC + Data Scope。客户端传入的 application/staff/region 标识只作为目标资源，不授予权限。

建议权限：

- `franchise.read`
- `franchise.assign`
- `franchise.followup`
- `franchise.review`
- `franchise.manage`

M17 HQ 操作默认要求 GLOBAL/HQ 级能力；若后续允许 Region/Franchisee 层参与跟进，再通过服务端 Data Scope 明确开放，不由前端自行判断。

## API / Contracts

Shared Zod contracts 放在 `packages/contracts`，输入 strict，禁止注入 `status`, assignment, review metadata, timestamps 等服务端字段。

Public/consumer:

- `POST /api/v1/franchise/applications` — 提交申请
- 可选：`GET /api/v1/franchise/applications/:id` 仅在明确需要消费者查询自己申请进度时开放；若本阶段无产品入口则不暴露。

HQ Staff:

- `GET /api/v1/staff/franchise/applications`
- `GET /api/v1/staff/franchise/applications/:id`
- `POST /api/v1/staff/franchise/applications/:id/assign`
- `POST /api/v1/staff/franchise/applications/:id/followups`
- `POST /api/v1/staff/franchise/applications/:id/review`
- `POST /api/v1/staff/franchise/applications/:id/status`

列表支持 status、assignee、区域、关键词和分页过滤；服务端始终做权限过滤。

## 小程序 / Mini Program

在“胖竹全球”增加加盟入口与申请页：

- 加盟介绍
- 基础条件
- 流程说明
- 申请表单
- 提交成功状态

不伪造审核进度、合同签署或费用支付能力。UI 只做必要布局，不在 M17 进行整体视觉重构。

## HQ Admin

新增真实 Franchise Manager：

- 线索列表/筛选
- 详情
- 分配负责人
- 跟进记录时间线
- 审核
- 状态推进

沿用现有 HQ Admin Staff Session，不在前端做权限授予判断；403/404/409 等由服务端统一返回并展示。

## 数据库与迁移 / Database & migration

新增独立 `franchise-schema.ts`（或仓库既有约定下的等价文件），更新 `packages/db/src/index.ts` export，并生成下一号 Drizzle migration。禁止手写跳号或运行时自动建表。

索引至少覆盖：

- `application_number` unique
- `status + created_at`
- `assigned_staff_account_id + status`
- 区域字段的常用查询组合
- `franchise_followups(application_id, created_at)`

## 测试 / Testing

至少覆盖：

- 公共申请 strict validation、PII 字段边界与服务端字段注入拒绝
- application number 唯一性
- Staff Session / permission deny-by-default
- HQ read/assign/followup/review/status 权限
- 非法状态跳转返回 conflict
- follow-up append-only
- assignment/review 审计字段正确
- 并发/版本检查避免覆盖更新
- PostgreSQL integration + fresh migration
- Mini Program service/page 逻辑测试
- Admin API client/component logic tests
- 全仓 `pnpm check`, DB check/migrate, integration, e2e, `git diff --check`

## 实施顺序 / Implementation order

1. Contracts + DB schema + migration
2. Franchise service/state machine
3. Public + Staff API routes
4. RBAC/Data Scope integration
5. PostgreSQL integration tests
6. Mini Program 加盟入口/申请
7. HQ Admin Franchise Manager
8. 全仓回归、文档与 PR

## Known issues / Decisions needed

以下业务规则未确认，因此 M17 不硬编码：

- 加盟审核具体评分/门槛
- 是否允许消费者查询完整申请进度
- 合同签署方式
- 加盟费/保证金/支付方式
- 自动创建正式 `franchisees` 的条件
- 区域级员工是否可参与线索处理
- PII retention/export policy

在规则确认前，状态机只提供可审计的运营流程，不把未确认业务决定伪装成已完成能力。
