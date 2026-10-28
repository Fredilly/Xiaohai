# COLLABORATION.md — Fred + Intern + Codex

## 目标 / Goal
一个 GitHub repo，一个 `main`，短分支、小 PR、持续 review。让实习生理解每次改变，而不是只复制 AI 输出。

One canonical repository, one `main`, short-lived branches and small PRs. The intern should understand each change, not merely execute AI instructions.

## Branches
- `fred/<task>`
- `intern/<task>`
- `codex/<task>`

Never develop features directly on `main`.

## Daily flow / 日常流程
```bash
git checkout main
git pull --ff-only origin main
git checkout -b intern/<task>
# work + test
git add .
git commit -m "<clear change>"
git push -u origin intern/<task>
```
Open PR → review → fix → tests green → merge → delete branch.

## PR template / PR说明
Every PR answers:
1. **What changed / 改了什么**
2. **Why / 为什么**
3. **How tested / 如何测试**

## Learning rule / 学习规则
Before merge, the intern should be able to explain the main file changes, data flow, one failure mode and the test proving the change works.

## Ownership / 工作分配
Early foundation and high-risk domains (auth, RBAC, inventory, payments, migrations) are established/reviewed by Fred/Codex. The intern begins with scoped UI, API integration, validation and tests, then progressively takes domain work.

## Conflict prevention
Pull `main` before starting. One task per branch. Avoid two people editing the same high-churn file simultaneously. Never force-push shared branches unless explicitly agreed.

## Required pre-review gate / 人工审核前必检

Review **the actual GitHub diff against the current base**, not just the PR title or an earlier green SHA. One distinct business responsibility per PR. HQ catalog/ISBN/Meiping history/guarded apply must be separately reviewable; do not claim "no HQ", "no SQL" or "no database writes" when files contradict that.

Every PR requires the template's scope, why, latest-head tests, Staff RBAC/data isolation, error-message whitelist, negative/concurrent/retry paths and dependency/merge order. For SQL migrations or backfills, include a **changed runbook** with backup, rehearsal, required owner approvals, write-window/lock expectations, safe application rollback and read-only before/after reconciliation. A successful migration test is not authorization to execute on production.

Review history-key collisions, transaction atomicity, stale version tokens, duplicate create retries, cross-store shared fields, stock ledger idempotency and malformed legacy records. Immutable history version collisions must cause rollback: do not suppress them using \`onConflictDoNothing()\`.

The CI job **PR scope, migration and error safety** enforces a subset of these requirements on pull requests using the actual changed files, added lines and source. Its unit tests protect against bypasses. Passing it never substitutes for two independent human reviews, a database owner's migration approval, staging UAT, or a production deployment decision.
