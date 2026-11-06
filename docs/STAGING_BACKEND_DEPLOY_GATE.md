# Staging backend change gate — Issue #203

**Code and test only.** This change does not authorize live deployments, manual image deletion, database work, migrations, Git branch deletion, or automatic retention execution. It is stacked on PR #202 to preserve its production-only multi-stage API/Worker Dockerfile, main-SHA checks, disk/inode preflight, and read-only retention controls.

## One decision, one baseline

The `workflow_run` trigger still waits for successful `main` CI. `eligibility` then:

1. Confirms the CI-tested SHA is still the latest `main` commit (PR #202).
2. Reads the newest **successful** `staging-backend-success` GitHub deployment marker, containing the actually deployed commit and both GHCR digests. Failed/pending deployment markers are not successes.
3. Computes a complete Git diff from that last successful commit to the exact CI SHA. It never compares only with the immediately preceding merge, so failed backend work followed by UI merges remains pending.
4. Classifies paths. Miniapp, Store/HQ frontend, documentation, tests and UI assets skip backend; API, Worker, their runtime packages, lockfiles, Docker/Compose, workflow and runtime configuration trigger backend. Mixed changes trigger; unknown file paths, missing history, invalid digests, and API errors **fail closed** (no build or deploy).
5. Logs `FRONTEND_ONLY -> BACKEND_SKIP` / `STAGING_DEPLOY_SKIPPED: frontend-only` or `BACKEND_CHANGED -> BUILD_AND_DEPLOY` / `STAGING_DEPLOY_TRIGGERED`, with CI SHA, previous successful backend SHA, image digests and changed paths. Merge PR association is logged separately.

Only the backend-changed branch creates **one latest-head API+Worker pair**, pushes to GHCR and contacts staging. PR #202's second latest-main check, pre-pull disk/inode gates, SSH isolation, health checks and default-OFF retention plan are retained.

After post-deploy health/disk validation (and successful or skipped optional read-only plan), `record-backend-success` creates a GitHub deployment marker and marks it successful. It records **both actual pushed digests** from the build matrix. If deploy is skipped as stale, or any required step fails, the baseline does not advance. A later UI-only merge still detects the outstanding backend change. This marker creates no cloud server deployment; it records a previously verified result.

## One-time safe bootstrap — owner review required

The historical staging runs predate these success markers. Until a first marker exists, an authorized owner must verify the **last genuinely successful full staging deployment**, including its actual API/Worker GHCR digests, using prior successful workflow logs and read-only server evidence. A failed workflow with healthy running containers is **not** sufficient; in particular, do not treat the failed `e4c1117e` post-disk-gate run as successful.

Set these *repository variables* only after that review (not secrets, not a new deploy authorization):

- `STAGING_VERIFIED_BASELINE_SHA`: 40-character commit of that last fully successful deployment
- `STAGING_VERIFIED_BASELINE_API_DIGEST`: its `sha256:` GHCR API image digest
- `STAGING_VERIFIED_BASELINE_WORKER_DIGEST`: its `sha256:` GHCR Worker image digest

When there are no success-marker records, the gate uses this verified bootstrap. Once the first success marker is recorded, it uses that marker instead. If the variables or marker cannot be verified, it stops **before Docker build or staging SSH**. Never guess the baseline or use the current running container version as proof of completed CI. No variables are modified by this PR.

## Tests and verification

Run `node --test scripts/staging-backend-gate.test.mjs scripts/staging-deploy-gate.test.mjs scripts/staging-check-main.test.mjs` and the normal PR CI. Regression fixtures simulate four sequential Nov 5 UI merges and assert no backend image build; also cover a pending Worker change followed by UI, mixed changes, shared dependencies, lockfiles, backend-file renames, malformed digests, unknown paths, missing Git history and stale-main protection. Live GHCR pushes, SSH/pulls and actual Docker deletions are **not tested or authorized** by this PR. CI workflow structural tests ensure the gate is upstream of both build and deploy, and success-marker writes follow health checks.

## Git branch deletion is separate

Repository metadata reports `delete_branch_on_merge=false`. The connected account does not have admin permission. Fred must enable GitHub **Settings → General → Pull Requests → Automatically delete head branches** once, then verify with a future unprotected merged feature branch. Do not delete old historical branches en masse. Deleting Git branches preserves PR history and **does not** reclaim Docker storage. Issue #195 governs image retention separately; none of its protected images, volumes, PostgreSQL, Redis, Caddy or Alibaba backup resources may be removed by this change.
