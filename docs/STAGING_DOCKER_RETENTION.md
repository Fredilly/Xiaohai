# Staging Docker disk/retention safety — Issue #195

## Scope and current findings (2026-11-01)

This is a staging-only, **dry-run-first** safety change. It does not migrate or seed PostgreSQL,
restart services, modify application business logic, or enable live image deletion.

- `.github/workflows/staging-deploy.yml` builds and pushes an API and Worker image for each successful
  `main` CI SHA. The deploy then pulls that SHA and updates Compose. Previously it never checked
  disk/inode capacity and never established a retention policy.
- `deploy/staging.compose.yml` runs API/Worker plus PostgreSQL 17, Redis 7.4 and Caddy, backed by
  **four named persistent volumes**. None of these is a deletion target.
- The observed staging root is `/dev/vda3` (ext4, approximately 49 GiB), and the #194 runbook
  identified many unused SHA-tagged API/Worker images. After authorized Phase 2, the operator
  reported approximately 15G free / 70% used, and passing PostgreSQL/Redis/`/ready` checks.
- The **actual Docker storage driver and containerd image-store mode remain unverified from source**.
  The owner should collect sanitized read-only `docker info --format '{{.Driver}}'`,
  `docker info --format '{{json .DriverStatus}}'`, `docker system df -v`, `df -hT /`, and
  `df -Pi /` on staging before relying on storage-layer estimates. Do not infer filesystem
  reclaim from Docker's `RECLAIMABLE` value (it was negative in some #194 reports).
- `deploy/Dockerfile` copies the entire monorepo and installs all workspace dependencies for
  **both** API and Worker images. A multi-stage, service-specific runtime image may reduce
  repeated layers, but any change needs `docker history`/`docker image inspect` measurements
  and an independent PR. Image size optimization is **not** attempted in #195.

## Capacity gate (deployment path)

`scripts/staging-disk-gate.sh pre` runs **inside a shared staging lock, before** updating
`revision.env` or running `docker compose pull`. It reads `df -Pk /` and `df -Pi /`.

- Warning at disk **or inode** usage >= 70%.
- Block at disk **or inode** usage >= 85%.
- Block if available capacity < `STAGING_MIN_FREE_KIB`, default **4 GiB / 4194304 KiB**,
  an initial conservative image-pull headroom threshold. Reassess from observed peak
  API+Worker pull/unpack footprint; do not assume image layer size equals free-space delta.
- Invalid or unavailable capacity data fails closed.
- A `post` check prints utilization and alerts; readiness is checked separately with
  `GET https://staging-api.pamboo.asia/ready`. Neither gate triggers cleanup.

The GitHub workflow retains the exact green-CI-SHA deployment, existing concurrency group,
and no-automatic-migrations invariant. The shared host lock
`/tmp/xiaohai-staging-deploy.lock` additionally protects against simultaneous retention.
Review operational approval **before merging**, since a merged `main` workflow affects the
staging deployment path. Do not assume a green PR alone authorizes a server-side rollout.

## Image retention policy

`scripts/staging-image-retention.sh --dry-run` is the default and never invokes
`docker image rm`. Its output uses `AUDIT mode=--dry-run revision=... api=... api_id=...
worker=... worker_id=...` and `SKIP revision=... reason=...`.

- Requires a current **40-character commit SHA** and **two different, explicitly verified
  rollback SHAs**, supplied via `STAGING_CURRENT_REVISION` and
  `STAGING_ROLLBACK_REVISIONS`. Missing/ambiguous mappings fail closed.
- Only fully SHA-tagged `ghcr.io/fredilly/xiaohai-api` and `xiaohai-worker` revisions
  qualify, and only **complete pairs**. Unknown/dangling tags, non-Xiaohai repositories,
  infrastructure images, untagged images and persistent data are outside scope.
- Protects all current/rollback image IDs, known infrastructure IDs, and **all containers
  including stopped containers**, by both image ID and tag. Shared-image aliases are
  excluded, and candidate tag/image IDs are checked via `docker image inspect`.
- Scans deployment-related `.env/.yaml/.yml/.sh` configuration under `/opt`,
  `/home` and `/etc/systemd/system`; any matching revision is excluded. Scan errors
  fail closed. Normal `grep` exit code **1** (no match) is not an error; regression
  tests cover the Batch 4 false-error case.
- Protects the staging host's shared lock. Execution mode has additional independent
  gates (explicit enable flag, successful-deployment SHA, owner approval reference,
  expected host name and **an exact-ID approved plan file**), plus live healthy
  PostgreSQL/Redis/`/ready`, reference revalidation before each deletion, at most
  two revision pairs per execution, no force/prune and filesystem-space monitoring.
  On refusal or no reclaimed space it stops instead of bypassing the guard.
- **Critical**: No `--execute` invocation, deletion enable flag or approved plan file is
  configured in GitHub Actions. Real deletion requires a **new, separate Fred approval**,
  with audit/recovery review; do not set any of those variables as part of #195.

## Workflow opt-in dry-run

The optional post-deploy audit runs only if repository/environment variable
`STAGING_RETENTION_PLAN_READY=true` and `STAGING_ROLLBACK_REVISIONS` lists exactly
two verified SHAs separated by whitespace. Missing configuration does not silently
invent rollback versions. The CI job's first step remains the capacity gate; the
optional audit never has permission to delete.

No staging variables, secrets, server files, or volumes have been changed by preparing this PR.

## Tests and acceptance checklist

Offline tests use faked `df` and `docker` commands. CI executes:

```bash
node --test scripts/staging-deploy-gate.test.mjs
node --test scripts/staging-disk-gate.test.mjs scripts/staging-image-retention.test.mjs scripts/staging-retention-execute.test.mjs
node --test scripts/staging-no-automatic-db-writes.test.mjs
```

Review the simulation coverage for: 70/85% thresholds, inode exhaustion, insufficient
headroom, read-only dry run, exact IDs, stopped containers, shared tags, incomplete
pairs, no-tag candidates, unknown rollback, missing authorization, grep's normal
no-match exit, failed API readiness, partial Docker deletion failure, a validated
exact-ID approval manifest, and concurrent deploy contention. The enabled-mode tests
are simulated **only**: live rollback recovery and physical staging Docker storage
behavior are **not** demonstrated by CI. Do not enable real deletion without a
separate owner-approved dry-run/recovery rehearsal.

## Decisions needed / rollout boundary

1. Fred/ops must verify server Docker/containerd mode, real image-layer footprint,
   acceptable minimum headroom and backup/restore availability.
2. Fred must approve any deployment workflow changes **before merge/rollout**.
3. Fred must approve actual automatic deletion **separately**, including retention
   horizon, max batch size and explicit rollback mapping.
4. Disk/inode warnings appear in Actions output; forwarding to a monitoring vendor,
   alert owner and notification channel require a separate operational decision.
