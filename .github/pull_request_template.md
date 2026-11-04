## Actual scope / 实际改动

<!-- Describe the files and behavior in the final diff, not the original plan. -->

## Why / 原因

## Tests / 验证

<!-- Include exact latest HEAD SHA and CI/container links. No stale green checks. -->

- [ ] Format, lint, typecheck, unit and PostgreSQL integration validated on current head
- [ ] Negative security, concurrency, rollback and idempotency paths covered where applicable
- [ ] Every new/modified destructive PostgreSQL integration suite validates BOTH DATABASE_URL and effective TEST_DATABASE_URL, local allowlisted DB, and APP_ENV/NODE_ENV **before** createDatabase; add mismatched/remote/prod negative tests
- [ ] If touching existing unguarded suites, fix their disposal guard before running them (do not assume a test-name-only database check is sufficient)
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

## External service / private media acceptance / 外部服务与私有媒体验收

- [ ] If this PR reads private cloud objects: verify bucket/object-key scope, least-privilege GetObject IAM, short-lived signed URL ownership and expiry, forbidden cross-user/cross-bucket requests; never make a bucket public to fix 403
- [ ] Record a **real synthetic-object GET + expired-URL** check and actual WeChat signed-host allowlisting + iOS/Android image test, OR explicitly mark **NOT VERIFIED** with owner, remaining configuration and deploy/no-go gate
- [ ] Separate automated CI success, independent Fred/security approval, staging real-environment acceptance and release permission. Do not mark private-media playback "working" based on mocks alone
- [ ] Any outstanding reviewer CHANGES_REQUESTED must be resolved and re-approved on the latest HEAD before merge; merge then delete branch only after all repository gates
