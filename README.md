# 小海童话 2.0 / Xiaohai Fairytale 2.0 — Production V1

Greenfield commercial WeChat Mini Program + Pangzhu Store Web + HQ Admin Web.

正式商业项目，从零开发。旧源码不可依赖；美萍仅用于一次性图书和当前库存迁移。

## Source of Truth
`docs/PRD_V3.2.md` is the product baseline / 产品唯一基线。

## Stack / 技术栈
- Mini Program: native WeChat + TypeScript
- Admin/Store: React + Vite
- API: Node.js + Fastify + Zod
- DB: PostgreSQL + Drizzle
- Monorepo: pnpm + Turborepo
- Tests: Vitest + Playwright + WeChat DevTools/real devices

## Start / 开始
1. Read `AGENTS.md` and all files under `docs/`.
2. Produce `docs/IMPLEMENTATION_PLAN.md`.
3. Review the plan.
4. Start M1 only after approval.

Do not initialize major production frameworks or write business features before the implementation plan is reviewed.
