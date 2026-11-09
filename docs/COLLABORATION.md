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

The CI job **PR scope, migration and error safety** enforces a subset of these requirements on pull requests using the actual changed files, added lines and source. Its unit tests protect against bypasses. Passing it never substitutes for an independent human review by someone other than the author, any stricter task-specific multi-review requirement, a database owner's migration approval, staging UAT, or a production deployment decision.

## Two-person team review and exceptional infrastructure operations / 双人团队审核与高风险操作

**Policy scope:** These are proposed standing collaboration rules for a team with one PR
author and one distinct human reviewer. They do **not** automatically amend existing
task-specific authorizations, GitHub branch protection, or infrastructure permissions.
A draft PR proposing these rules is not itself an approval or an operational permit.

### Normal code / 常规代码

- The author implements a scoped change on a feature branch, documents the actual
  latest-head diff and tests, and requests review from a **different human**.
  Fred may serve as that distinct human reviewer. The author, a bot, an AI
  assistant, and repeated reviews from the *same* person do not count as
  additional independent humans.
- A latest-head human `APPROVED` review and passing required CI are the ordinary
  review baseline, **subject to** active branch-protection/rulesets and any
  stricter task-specific human-review requirements. Never merge a draft PR,
  bypass a `CHANGES_REQUESTED` review, or treat a comment as a submitted approval.
- A reviewer checks code/data scope, security risks, missing negative tests, and
  applicable runbooks before a separate merge decision. CI is a gate, not a
  substitute for a person or real environment acceptance.

### Destructive infrastructure / 破坏性基础设施操作

- Infrastructure deletion, storage cleanup, migrations/backfills, and production
  or shared-Staging changes require **two distinct decisions**: review of the
  exact immutable code/artifact and a separately documented, owner-scoped
  **operation authorization**. Both may involve Fred when the team has only
  two humans **only if** the owner explicitly adopts that arrangement for the
  task and it is compatible with GitHub rules; it must never be misreported as
  two independent reviewer identities.
- The operational authorization must identify the precise environment/host,
  resource allowlist (e.g., exact Docker image IDs), script commit/blob hash,
  allowed one-time action and expiry/stop condition. Require preflight
  verification of snapshot status **and usable recovery path**, live
  protected/rollback/HOLD mapping, stopped/running references, dynamic
  deployment files, identity, container/service/DB/Redis/HTTPS health,
  locks, disk/inodes and no unapproved side effects. Record sanitized evidence.
- Use a reviewed default-DENY runbook, separate installation from execution,
  keep dry-run/plan results with zero mutations, stop on any failed/unknown
  condition or partial success, and verify post-operation state. Do **not**
  force-delete, prune, touch unknown volumes/backups/data, or enable recurring
  deletion without a separately reviewed and explicitly activated policy.
- **Existing stricter requirements are not waived:** if a specific issue, prior
  authorization or branch rule demands a second *independent* human, it remains
  binding until the responsible owner explicitly amends **that exact prior
  authorization in its original issue**, identifying the replaced clause and
  replacement technical controls, or a genuine second human reviews. A
  chat message, self-review, AI audit, updated general policy or Fred's earlier
  code `APPROVED` does not retroactively authorize an operation.
- Any reduction of GitHub branch-protection review counts needs a separate,
  authorized administrator decision. This policy cannot override settings.
  Final release/production deployment still requires its own approval.

**Incident separation:** For [Issue #195](https://github.com/Fredilly/Xiaohai/issues/195)
and [PR #205](https://github.com/Fredilly/Xiaohai/pull/205), the existing owner
Phase C second-human condition and installation/deletion HOLD stay in effect
until explicitly revised **in #195** or satisfied by a real independent
reviewer. [Issue #219](https://github.com/Fredilly/Xiaohai/issues/219) tracks
that decision; [PR #218](https://github.com/Fredilly/Xiaohai/pull/218) only
proposes future recurring retention rules. Do not install or delete based on
this policy proposal.

## Destructive integration database safety / 破坏性集成测试的数据库保护

A green test suite does **not** prove that its target database is safe. When a test calls
`createDatabase(process.env)` under `NODE_ENV=test`, it connects through
`TEST_DATABASE_URL`, not the `DATABASE_URL` that older guards might inspect.
For every new or modified integration suite using `TRUNCATE`, `DROP TABLE`
or Drizzle `.delete()`, require
`assertMeipingApplyDisposableDatabase(process.env)` **before** creating the pool.
It must fail closed on mismatched DATABASE_URL/TEST_DATABASE_URL, remote hosts,
non-allowlisted database names, and staging/production environments.
Keep negative regression tests for these cases. CI enforces this on changed
destructive suites; legacy suites not touched by a PR may still need migration
to the stricter guard. Never run legacy unguarded destructive tests against
shared databases.

## Private cloud media acceptance / 私有云图片验收

A signed media URL is a temporary bearer capability, never a public asset URL.
Review the owner entitlement, short TTL, exact bucket/key allowlist, credential
failure behavior, least-privilege GetObject and cross-user/cross-bucket denial.
Do not solve private bucket 403 by enabling anonymous public read. Production/staging
access and real WeChat display cannot be asserted by SDK mocks or green CI alone:
record synthetic-object GET/expiry, the actual signed hostname allowed by WeChat,
and iOS/Android verification, or mark these NOT VERIFIED with an explicit
deployment no-go owner and prerequisites. Do not log signed query strings.

Never merge a PR with unresolved CHANGES_REQUESTED or pretend reviewer approval
can be substituted by an author's merge permission. Request an up-to-date
independent re-review after fixes; merge/delete only after required human
approvals and current-head CI pass.
