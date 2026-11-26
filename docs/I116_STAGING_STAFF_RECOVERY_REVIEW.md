# #116 Staging single-account break-glass recovery — REVIEW ONLY

**Execution status: DENY. No Staging or Production password has been changed.**

This document proposes the smallest recovery path for the existing single
`STAGING_UAT_OPERATOR` account when the sole authorized `staff.manage` session
is unavailable. It is not an authorization, a production runbook, or permission
to execute a new SQL statement. Code review and a one-time host-scoped operation
authorization remain separate required decisions.

## Specific audit-design decision required from Fred

The existing `audit_logs.actor_staff_account_id` column is non-null and
references an authenticated Staff account. A host-initiated recovery has **no
authenticated Staff actor**. Writing the target's ID or a made-up admin ID
there would falsely attribute the action. Do **not** insert such a row.

The proposed alternative, subject to explicit independent acceptance in #116:

1. The real, verified SSH operator uses their existing trusted Mac SSH identity.
2. Before password input or any database write, the operator prepares a
   **durable, permission-0600 host-side audit journal** with actual SSH login,
   host fingerprint, exact reviewed script digest, #116 approval link, target
   immutable ID and expected previous `session_version`. The journal must be
   protected from unprivileged reads and verified writable and durable.
3. The interactive CLI emits sanitized `PREFLIGHT_OK`, `COMMIT_ATTEMPT`,
   `COMMITTED`/`STOPPED` records to the operator's controlled audit capture.
   No password, hash, connection URL, cookie or token may appear in it.
4. If a write result is ambiguous (e.g. SSH interruption after `COMMIT_ATTEMPT`),
   STOP; reconcile `session_version` by **read-only** inspection before any
   decision about retry. Do not run a second reset blindly.

This host journal is **not** the existing database audit table, and its event
records are **not atomic with the password transaction**. The truthful audit
identity is established by trusted SSH authentication and separately retained
host logs, not by an arbitrary CLI parameter. This limitation requires Fred's
explicit approval or a different reviewed schema-backed audit design. Merely
setting `STAGING_RECOVERY_EXTERNAL_AUDIT` does **not** prove an audit is present.

## Reviewable CLI boundaries

- `scripts/staging-staff-recovery.mjs` is not a route, migration, seed, login
  bypass or recurring capability. It is not included in the runtime image.
  It must only be copied into the existing Staging API container after review.
- Default deny unless `--execute` and exact UUID, login, existing session
  version, #116 approval comment and pre-existing prepared host audit are given.
- Require `APP_ENV=staging`, `NODE_ENV=production`, `SERVICE_NAME=api`, the
  internal PostgreSQL host `postgres:5432`, database `xiaohai_staging`, user
  `xiaohai`, a writable primary, `/app` production runtime and an interactive
  TTY. Must independently verify SSH endpoint `47.238.143.29` and its pinned
  ED25519 fingerprint before any copy/command.
- Read only the necessary account identifiers, enabled state, generation,
  existing roles, permissions and scopes. Require exactly one enabled Staff
  account, the specified target, its precise generation, exactly the
  `STAGING_UAT_OPERATOR` role, `staff.manage` and only `GLOBAL` scope.
- Prompt twice with terminal echo disabled; 12–128 characters; no secret in
  argv, environment, GitHub, transcript or files. Hash only with the existing
  compiled `ScryptPasswordHasher`.
- In one `SERIALIZABLE` transaction, recheck identity/permissions and perform
  an atomic conditional update of **only** `staff_accounts.password_hash`,
  `session_version = session_version + 1`, `updated_at`. No other table writes.
  The expected old version prevents repeating the same one-time command.
- The normal Staff auth guard compares session generation on every authorized
  request, so the version increment revokes all previously issued sessions.
- Do not modify the global 12-character policy, RBAC, inventory, payments,
  production secrets/services, the Staff login API, or the existing audit schema.

## Conditions before a Mac operator may execute

1. A **different human reviewer** has approved the exact PR head, and latest
   required CI is green. No unresolved `CHANGES_REQUESTED`.
2. Fred has independently approved the audit model above and an exact
   **one-time Staging host + immutable script digest + target + action + expiry**
   in #116; prior general permission to reset is not equivalent to accepting
   a new host-level audit mechanism.
3. Mac SSH host-key validation is pinned and successful; Postgres/API/HTTPS,
   deployment lock, session-version preflight and backups/actual recovery path
   are verified. Capture no secrets in evidence.
4. The operator is sitting at the trusted Mac terminal and the 0600 host audit
   journal is prepared and verified. Only the operator enters the new password
   (twice, silently). The operator, not Codex chat, retains the password.
5. Do not change live containers, Docker image, Compose, DNS, Caddy, DB schema,
   role/scope, production or any payment/inventory/ordering data. Stop when
   a check is false or cannot be verified.

## Required post-execution evidence (no secrets)

- One sanitized committed event, generation `N` → `N + 1`, and a single
  verified target; original roles/permission/scope unchanged.
- Verify the existing API rejects a token with the old generation without
  disclosing its content. A fresh login with the new password works for the
  Store and HQ websites only where that account's unchanged privileges allow.
- If actual pre-reset session tokens are unavailable, label real-token
  invalidation **NOT DIRECTLY TESTED** and cite the generation check instead.
- Record the outcome and audit receipt location in #116 without passwords,
  secret hashes, session tokens, full personal identifiers or DB URLs.

**Current gate:** audit model acceptance and exact code review/operation
authorization are pending. Do not enter a password or run the CLI yet.
