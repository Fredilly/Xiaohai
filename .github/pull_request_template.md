## Actual scope / 实际改动
<!-- Describe the files and behavior in the final diff, not the original plan. -->

## Why / 原因

## Tests / 验证
<!-- Include exact latest HEAD SHA and CI/container links. No stale green checks. -->
- [ ] Format, lint, typecheck, unit and PostgreSQL integration validated on current head
- [ ] Negative security, concurrency, rollback and idempotency paths covered where applicable
- [ ] Frontend capabilities match authenticated API permissions and errors

## Security / 权限与公开错误
- [ ] No raw exception messages, secrets, or internal details in public API responses
- [ ] Staff scope, cross-store isolation and audit preserved

## Database migration / 数据库迁移
- [ ] No SQL migration or backfill in this PR
- [ ] If migration exists: dedicated runbook, backup/rehearsal, lock window, rollback and SQL before/after reconciliation documented
- [ ] Production migrations, role grants and inventory writes are not triggered by CI or PR merge

## PR dependencies / 依赖
<!-- List exact upstream PR numbers and main inclusion, base branch and intended merge order. -->
- [ ] Diff contains one business responsibility; unrelated changes split
- [ ] Descendant branch inherits final approved dependency code without stale reintroductions
- [ ] Human approvals are separate from CI. Never claim deployment or DB release from PR approval.
