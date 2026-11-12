# Staging steady-state retention executor runbook

Status: **CODE-ONLY / DEFAULT DENY**. Merging this code does not authorize or start Docker image deletion.

This runbook operationalizes the policy baseline in #218 and remains separate from the consumed one-time #195 Phase B/C/D incident approvals.

## Flow

1. A genuinely successful backend staging deployment records the exact successful revision in the existing `staging-backend-success` deployment environment.
2. The existing deploy workflow may generate a read-only `staging-retention-proposal-<revision>` artifact when `STAGING_RETENTION_PLAN_GENERATION_ENABLED=true`.
3. A human reviews that proposal and records its SHA-256.
4. The designated operator manually dispatches `Execute staging retention (manual exact plan)` with:
   - exact successful revision;
   - source staging-deploy workflow run ID;
   - reviewed proposal SHA-256;
   - a new single-use `XIAOHAI-195-STEADY-...` approval ID;
   - the current owner-approved recurring retention policy ID.
5. The workflow verifies the source run, the `staging-backend-success` marker, proposal hash, one-or-two exact candidate pairs, current revision exclusion, owner policy/actor gates, SSH host identity and exact deployed retention-script blob.
6. Immediately before the host script runs, the approval ID is atomically consumed in `~/xiaohai-deploy/.retention-authorizations/`. A failed or partial run consumes the ID; never retry it. A new owner decision/approval ID is required.
7. The reviewed host script runs `--steady-state-execute` once. It retains its existing exact-ID manifest, reference/alias, protected image, volume, service, database, HTTPS, capacity, lock and bounded-GC checks, and removes at most two complete API+Worker pairs.
8. A final read-only capacity/service/health reconciliation runs even if execution fails.

## Activation variables

Keep all unset/false until Fred explicitly approves the recurring retention policy and operator scope.

- `STAGING_RETENTION_EXECUTION_ENABLED=true`: master execution opt-in. Default/unset blocks the job.
- `STAGING_RETENTION_POLICY_ID`: exact owner-approved recurring policy identifier.
- `STAGING_RETENTION_ALLOWED_ACTOR`: exact GitHub username allowed to dispatch the executor.
- `STAGING_EXPECTED_HOSTNAME`: exact staging host identity.
- Existing required protection inputs remain:
  - `STAGING_ROLLBACK_REVISIONS`: exactly two verified rollback revisions.
  - `STAGING_EXTRA_PROTECTED_REVISION`: one distinct additional protected revision.
  - `STAGING_CONFIG_COVERAGE_CONFIRMED=true`: operator-reviewed bounded deployment configuration coverage.

The workflow also uses the existing `staging` environment and staging SSH secrets. Existing environment protection/reviewer rules remain in force.

## Never permitted by this executor

- scheduled/cron deletion;
- automatic deletion merely because a plan exists;
- reuse of #195 Phase B/C/D approvals;
- direct `docker image rm` or any Docker/containerd prune command in the workflow;
- forced deletion;
- deleting unknown/dangling images, volumes, databases or backups;
- proceeding from a failed/stale deployment or an unverified plan hash;
- retrying a consumed approval ID;
- treating `STAGING_READY` or successful disk cleanup as blanket deletion authorization.

## Rollout sequence

1. Review and merge #218 policy baseline.
2. Review this operational PR independently; keep it Draft until policy ownership and environment gates are accepted.
3. Merge code only.
4. Configure variables while keeping `STAGING_RETENTION_EXECUTION_ENABLED` false.
5. Generate and inspect at least one real read-only proposal after a genuine backend deploy.
6. Fred approves the recurring policy ID/operator scope.
7. Enable execution explicitly and perform the first manual steady-state run with a new single-use approval ID.
8. Review the first run's receipt, disk/inode change, protected-image set and health before treating the system as operational.

`STAGING_READY` remains an independent deployment-readiness decision.

## Security transport and executable review gates

- Workflow inputs are validated by `scripts/staging-retention-executor-lib.mjs` against strict allowlists before SSH.
- `policy_id` must match `^XIAOHAI-195-RETENTION-[A-Za-z0-9-]+$`; approval IDs remain separately scoped as `XIAOHAI-195-STEADY-...`.
- Revision, source run ID, proposal hashes, actor, rollback set, extra protected revision and expected hostname are all validated before transport and revalidated on-host.
- User/owner values are **not interpolated into the remote shell command**. They travel in a fixed-order newline-delimited parameter file that is never sourced/eval'd; the remote executor reads fields literally and validates them again.
- The only values interpolated into the SSH remote command are generated numeric temporary paths derived from GitHub run ID/attempt.
- Single-use approval consumption uses an atomic `mkdir` under `~/xiaohai-deploy/.retention-authorizations/`; concurrent dispatches with the same approval ID cannot both proceed.
- Executable mocked integration tests cover disabled master gate, actor/policy/approval mismatch, shell metacharacters/newlines/quotes, stale/superseded backend revision, proposal hash/second image mismatch, host script hash, health refusal, reused approval, partial deletion/no retry, concurrent approval consumption and mocked SSH transport.

## Real-host acceptance remains separate

Code review, CI success and merge do **not** authorize activation. Before the first live steady-state execution:

1. Fred must separately approve the recurring policy identifier and designated operator scope.
2. Repository/environment variables must be configured while `STAGING_RETENTION_EXECUTION_ENABLED` remains false.
3. Generate a real read-only proposal from a genuinely successful, latest-main backend deployment and independently review its SHA-256 and exact image IDs.
4. Perform a read-only real-host acceptance check for installed script hash, expected hostname, current/two rollback/extra/HOLD protections, references, lock, services, volumes, PostgreSQL/Redis/HTTPS health, disk/inodes and the current backup/recovery boundary.
5. Only after that acceptance may Fred explicitly enable the master execution variable and issue the first fresh single-use `XIAOHAI-195-STEADY-...` approval.
6. The first live run must be reviewed afterwards before the executor is considered operational.

No existing Phase B/C/D approval may be reused for this acceptance or first steady-state run.

