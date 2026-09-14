# 小海童话 2.0 / Xiaohai Fairytale 2.0 — Production V1

小海童话 2.0 是从零建设的商业微信小程序、胖竹门店端和总部后台。旧源码不可依赖；美萍只用于一次性迁移图书主数据和当前库存。

Xiaohai Fairytale 2.0 is a greenfield commercial WeChat Mini Program, Pangzhu Store Web and HQ Admin Web. Legacy source is not reusable; Meiping is used only for the one-time migration of book master data and current inventory.

## 产品基线 / Product baseline

`docs/PRD_V3.2.md` 是产品范围和业务规则的唯一基线。开始工作前必须阅读 `AGENTS.md` 及 `docs/` 中的权威文档。

`docs/PRD_V3.2.md` is the single baseline for product scope and business rules. Read `AGENTS.md` and the governing documents under `docs/` before starting work.

## 技术栈 / Stack

- 微信小程序：原生微信小程序 + TypeScript。
  WeChat Mini Program: native WeChat Mini Program + TypeScript.
- 总部后台和门店端：React + Vite。
  HQ Admin and Store Web: React + Vite.
- API：Node.js LTS + Fastify + Zod。
  API: Node.js LTS + Fastify + Zod.
- 数据库：PostgreSQL + Drizzle ORM/migrations。
  Database: PostgreSQL + Drizzle ORM/migrations.
- Monorepo：pnpm workspaces + Turborepo。
  Monorepo: pnpm workspaces + Turborepo.
- 测试：Vitest + Playwright + 微信开发者工具/真机验证。
  Tests: Vitest + Playwright + WeChat DevTools/real-device validation.

## M1 本地开始 / M1 local start

要求 Node.js 22 或 24 LTS、pnpm 11，以及用于本地 PostgreSQL 的 Docker。不要把个人 `.env`、真实 AppID 或 `project.private.config.json` 提交到 Git。

Node.js 22 or 24 LTS, pnpm 11 and Docker for local PostgreSQL are required. Never commit a personal `.env`, real AppID or `project.private.config.json`.

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm --filter @xiaohai/db db:migrate
pnpm check
pnpm test:e2e
```

API 和 Worker 可以分别启动；也可以从根目录并行启动全部开发任务。

The API and Worker can be started individually, or all development tasks can be started in parallel from the repository root.

```bash
pnpm --filter @xiaohai/api dev
pnpm --filter @xiaohai/worker dev
pnpm dev
```

## 微信开发者工具 / WeChat DevTools

使用微信开发者工具打开 `apps/miniapp/`。已提交的 `project.config.json` 使用安全的 `touristappid` 并启用 TypeScript 编译插件；开发者工具生成的个人配置保存在被 Git 忽略的 `project.private.config.json` 中。真实 AppID 只能通过授权的本地/环境配置管理，不得提交到仓库。

Open `apps/miniapp/` in WeChat DevTools. The committed `project.config.json` uses the safe `touristappid` and enables the TypeScript compiler plugin; personal DevTools settings remain in the Git-ignored `project.private.config.json`. A real AppID must be managed through authorized local/environment configuration and must never be committed.

## 当前范围 / Current scope

当前仓库只完成 M1 基础工程，不包含登录、RBAC、商城、支付、AI、库存或其他正式业务功能。后续里程碑必须在独立评审和明确批准后开始。

The repository currently contains M1 foundation only. It does not implement login, RBAC, commerce, payment, AI, inventory or other production business functionality. Later milestones begin only after separate review and explicit approval.
