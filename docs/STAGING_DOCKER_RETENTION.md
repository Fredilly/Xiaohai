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
and no-automatic-migrations invariant. The registry token is passed through SSH stdin only:
`scripts/staging-remote-deploy.sh` acquires the host lock, checks disk/inode capacity **before
GHCR login**, then uses a unique temporary `DOCKER_CONFIG` and an `EXIT` cleanup trap that
attempts `docker logout ghcr.io` and removes its isolated `config.json` on success,
login failure or Compose failure. The original user's Docker credentials are not replaced.
Offline tests explicitly cover a failed gate, failed lock, failed login, pull/up failure,
successful logout, credential cleanup and no token exposure in console output.
The shared host lock
`/tmp/xiaohai-staging-deploy.lock` additionally protects against simultaneous retention.
Review operational approval **before merging**, since a merged `main` workflow affects the
staging deployment path. Do not assume a green PR alone authorizes a server-side rollout.

## Image retention policy

`scripts/staging-image-retention.sh --dry-run` is the default and never invokes
`docker image rm`. Its output uses `AUDIT mode=--dry-run revision=... api=... api_id=...
worker=... worker_id=...` and `SKIP revision=... reason=...`.

- Requires the current **40-character commit SHA**, **two different explicitly verified rollback
  SHAs**, and **one additional protected historical release SHA**. These are supplied via
  `STAGING_CURRENT_REVISION`, `STAGING_ROLLBACK_REVISIONS` (exactly two), and
  `STAGING_EXTRA_PROTECTED_REVISION` (one), respectively. As of 2026-11-02, the
  extra version is the formerly deployed `e38a1796...` release; the two designated
  older rollback releases remain `f8e1fe86...` and `d79ca0ff...`. This is
  an intentionally more conservative **four-total-release** retention floor,
  until Fred approves a different rollback policy. Missing/ambiguous mappings
  or release tags resolving to an identical image ID for the same role fail closed.
- Only fully SHA-tagged `ghcr.io/fredilly/xiaohai-api` and `xiaohai-worker` revisions
  qualify, and only **complete pairs**. Unknown/dangling tags, non-Xiaohai repositories,
  infrastructure images, untagged images and persistent data are outside scope.
- Protects all current/rollback image IDs, known infrastructure IDs, and **all containers
  including stopped containers**, by both image ID and tag. Shared-image aliases are
  excluded, and candidate tag/image IDs are checked via `docker image inspect`.
- Only **explicitly allowlisted, individually bounded deployment config files**
  are searched; there is **no recursive traversal** of `/opt`, `/home`,
  `/etc/systemd/system` or Docker/containerd storage. The list is built from
  known files at `STAGING_DEPLOY_CONFIG_DIR` (defaults to
  `/home/admin/xiaohai-deploy`): `revision.env`, `staging.env`,
  `staging.compose.yml`, `Caddyfile`, `staging-remote-deploy.sh`,
  `staging-disk-gate.sh`, `staging-image-retention.sh`.
  These are the deployment files indicated by the current staging Compose and
  remote deploy scripts. Unknown service definitions or references **are not
  assumed absent**. Any additional positively identified live service config
  references must be passed as **exact absolute filenames** in
  `STAGING_EXTRA_DEPLOY_CONFIG_FILES` after independent review. If file coverage
  has not been independently confirmed, `STAGING_CONFIG_COVERAGE_CONFIRMED=true`
  must **not** be set, and the script refuses to plan candidates.
- In **dry-run**, the shared deployment lock is opened **read-only if it already exists**;
  a missing lock is never created. Results are advisory and must be reverified before
  any separately authorized deletion. In **execute**, the lock is acquired normally.
  Config scans run through `timeout --signal=TERM --kill-after=1s 5s sudo -n
  grep -Fq` against the **explicit files only**. The scanner validates each
  required regular file exists, is not a symlink, resolves to its provided
  absolute path, is readable through `sudo -n test -r`, and is at most **1 MiB**.
  At most **16 extra filenames** may be appended to the seven expected files.
  File contents and even matched filenames are not logged. Normal grep exit **1**
  means no match; exit **0** means a protected config reference, and exit
  **2+, 124 (timeout), 137, or permission errors fail closed**.
  No scan traverses `/opt/containerd` or a container/image store.
- Execution mode has additional independent
  gates (explicit enable flag, successful-deployment SHA, owner approval reference,
  expected host name, **running API/Worker containers**, and **an exact-ID approved plan file**), plus live healthy
  PostgreSQL/Redis/`/ready`, reference revalidation before each deletion, at most
  two revision pairs per execution, no force/prune and filesystem-space monitoring.
  On refusal or no reclaimed space it stops instead of bypassing the guard.
- **Critical**: No `--execute` invocation, deletion enable flag or approved plan file is
  configured in GitHub Actions. Real deletion requires a **new, separate Fred approval**,
  with audit/recovery review; do not set any of those variables as part of #195.

## Workflow opt-in dry-run

The optional post-deploy audit runs only if repository/environment variable
`STAGING_RETENTION_PLAN_READY=true`, `STAGING_ROLLBACK_REVISIONS` lists exactly
two verified SHAs separated by whitespace, `STAGING_EXTRA_PROTECTED_REVISION`
is explicitly set to the verified *third* historical release SHA, **and
`STAGING_CONFIG_COVERAGE_CONFIRMED=true`** is separately operator-attested.
All historical SHAs must be distinct from the new current release. Missing
configuration fails **before SSH**; do not silently assume an unlisted previous
release or an unscanned deployment config is disposable. The default GitHub
workflow does **not** pass any extra config paths, and must **not** be enabled
if separate service references are found until they are securely incorporated
and independently reviewed. The CI job's first step remains the capacity gate;
the optional audit never invokes deletion.
**Do not enable the optional automation as part of this code-only follow-up.**

No staging variables, secrets, server files, or volumes have been changed by preparing this PR.

## Tests and acceptance checklist

Offline tests use faked `df` and `docker` commands. CI executes:

```bash
node --test scripts/staging-deploy-gate.test.mjs scripts/staging-remote-deploy.test.mjs
node --test scripts/staging-disk-gate.test.mjs scripts/staging-image-retention.test.mjs scripts/staging-retention-execute.test.mjs
node --test scripts/staging-no-automatic-db-writes.test.mjs
```

Review the simulation coverage for: 70/85% thresholds, inode exhaustion, insufficient
headroom, read-only dry run, exact IDs, stopped containers, shared tags, incomplete
pairs, no-tag candidates, unknown rollback, missing authorization, grep's normal
no-match exit, duplicated rollback image IDs, stopped current Worker, failed API
readiness, partial Docker deletion failure, a validated
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

## 2026-11-02 read-only staging reconciliation and code-only follow-up

An operator-supplied, entirely read-only audit on staging `12091f5d...` verified 17 historical
API/Worker revision pairs (34 tagged images) as *candidates only*. These IDs exactly matched
remaining P2 entries in #194. Current + prior deployed + two older rollback pairs (8 tagged
images) were protected. Disk was 73% used; inodes 34% used; the image store used
`overlayfs` and containerd snapshotter. No image was removed.

The original shipped script was **not** directly run during that strict read-only audit:
it created a lock file, had unprivileged `/opt` grep permission failures, and only protected
two historical revisions. This follow-up fixes those boundaries in code, but **passing CI
is not proof of staging script acceptance**. No new staging command, image removal, service
restart, deployment or config change is authorized by this follow-up PR itself.

Fred must review the changes and explicitly authorize a later merge (which itself may
trigger a staging deployment). Activating any `--execute` cleanup requires a further,
separate and unambiguous approval, independent of code review and dry-run acceptance.

## PR #197 review update — bounded deployment configuration scan

Fred's 2026-11-02 `CHANGES_REQUESTED` review correctly rejected the first
revision's recursive `sudo grep` over all of `/opt`, `/home` and
`/etc/systemd/system`: it descended into `/opt/containerd` on the 49 GiB
staging disk, risking high I/O for **each** old revision.

The replacement enumerates the seven **specific** known staging deployment
files listed above, each limited to **1 MiB**, plus no more than **16**
individually approved and existing extra files. Every candidate scan has a
**5-second wall-clock timeout**, with no directory recursion, no glob expansion,
and no traversal of Docker/containerd image stores. File symlinks, untrusted
relative paths, containerd storage paths, missing files, unauthorized access,
unexpected sizes, and scan errors fail closed.

**Coverage is a separate human-operational gate, not inferred from the
repository.** Before authorizing any real-host retention audit, an operator must
inspect active container Compose references and any systemd/service configuration
paths without disclosing credentials. Confirm that these seven files and any
explicitly supplied extra service files cover **all** live deployment/rollback
references. If there are unknown references, stop and do not set
`STAGING_CONFIG_COVERAGE_CONFIRMED`. The bundled tests only simulate coverage;
a green check does not claim the host has passed this review.

**No staging changes or deletion are allowed by this PR.**
