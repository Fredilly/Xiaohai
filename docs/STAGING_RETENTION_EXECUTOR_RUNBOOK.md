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
