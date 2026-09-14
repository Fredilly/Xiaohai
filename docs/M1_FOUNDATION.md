# M1 基础工程说明 / M1 Foundation Guide

## 范围 / Scope

M1 建立五个应用、六个共享包、统一工具链、本地 PostgreSQL、Drizzle 迁移入口、环境校验、结构化日志、测试和 CI 基础。它不包含 M2 身份/RBAC 或任何正式业务功能。

M1 establishes five applications, six shared packages, the common toolchain, local PostgreSQL, the Drizzle migration entry point, environment validation, structured logging, tests and CI foundations. It does not include M2 Identity/RBAC or any production business feature.

## 应用边界 / Application boundaries

- `apps/miniapp`：原生微信 TypeScript 消费者端占位工程。
  `apps/miniapp`: native WeChat TypeScript consumer shell.
- `apps/admin-web`：React/Vite 总部后台占位工程。
  `apps/admin-web`: React/Vite HQ Admin shell.
- `apps/store-web`：React/Vite 门店端占位工程。
  `apps/store-web`: React/Vite Store Web shell.
- `apps/api`：Fastify API 组合入口，仅提供基础健康检查。
  `apps/api`: Fastify API composition root with a foundation health check only.
- `apps/worker`：独立 Worker 进程入口，尚未引入业务队列。
  `apps/worker`: separate Worker process entry point with no business queue yet.

## 共享包边界 / Shared package boundaries

- `domain`：与框架无关的领域类型和规则；M1 不含业务领域实现。
  `domain`: framework-independent domain types and rules; M1 contains no business-domain implementation.
- `db`：PostgreSQL/Drizzle 客户端、配置和迁移入口；M1 schema 有意为空。
  `db`: PostgreSQL/Drizzle client, configuration and migration entry point; the M1 schema is intentionally empty.
- `contracts`：版本化传输契约；目前只有基础健康检查契约。
  `contracts`: versioned transport contracts; currently limited to the foundation health contract.
- `validation`：跨运行时安全共享的 Zod 校验。
  `validation`: Zod validation that is safe to share across runtimes.
- `config`：启动时环境变量校验，限定 `dev/staging/production`。
  `config`: startup environment validation restricted to `dev/staging/production`.
- `test-utils`：仅供测试使用的辅助工具。
  `test-utils`: test-only helpers.

## 环境与密钥 / Environments and secrets

`.env.example` 只用于本地开发；`.env.staging.example` 和 `.env.production.example` 只描述所需键。真实值由各环境的密钥管理系统注入。三个环境不得共享数据库、凭据或其他状态。

`.env.example` is for local development only; `.env.staging.example` and `.env.production.example` describe required keys only. Real values are injected by each environment's secret manager. The three environments must not share databases, credentials or other state.

## 数据库迁移 / Database migrations

本地 PostgreSQL 由 `docker-compose.yml` 提供。Drizzle schema 和 migration tooling 位于 `packages/db`。M1 不创建业务表；以后每次 schema 变更必须生成、评审并提交 migration，禁止生产环境运行自动 schema push。

Local PostgreSQL is provided by `docker-compose.yml`. The Drizzle schema and migration tooling live in `packages/db`. M1 creates no business tables; every future schema change must generate, review and commit a migration, and automatic schema push is forbidden in production.

## 检查与验收 / Checks and acceptance

`pnpm check` 顺序执行 workspace、小程序、密钥、格式、lint、typecheck、Vitest 和 build 检查；`pnpm test:e2e` 验证 Playwright 基础。微信开发者工具和 Docker PostgreSQL 仍需在安装了对应软件的开发机上验证。

`pnpm check` runs workspace, Mini Program, secret, formatting, lint, typecheck, Vitest and build checks in order; `pnpm test:e2e` verifies the Playwright foundation. WeChat DevTools and Docker PostgreSQL still require validation on a development machine where those tools are installed.
