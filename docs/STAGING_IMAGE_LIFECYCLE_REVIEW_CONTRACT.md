# Staging image lifecycle: short-term recovery and recurring retention — review contract

**Status: CODE/TEST/DESIGN ONLY. NO LIVE AUTOMATIC DELETION OR DEPLOYMENT AUTHORIZATION.**
Tracks [Issue #195](https://github.com/Fredilly/Xiaohai/issues/195) and [#203](https://github.com/Fredilly/Xiaohai/issues/203). Keep `STAGING_READY=false`.

## A. Short-term incident (not part of this PR's executable changes)

- Root filesystem operator-measured again on **2026-11-09**: **49G total, 38G used, 9.1G free, 81% usage; inodes 38% used**. This is a timestamped observation, not ongoing monitoring or deploy clearance.
- Prior Phase B removed four exact Docker image IDs, measured **2.507 GiB** reclaim; its authorization is exhausted.
- [Draft PR #205](https://github.com/Fredilly/Xiaohai/pull/205) holds Phase C's *different* exact four IDs, on immutable reviewed HEAD `571bbcdb276b0d39f360f91cdcdc0d2fb9db7e5b`.
- Fred's [distinct conditional installation and one-time deletion authorizations](https://github.com/Fredilly/Xiaohai/issues/195#issuecomment-6704655515) remain separately scoped. The owner [explicitly amended the Phase C reviewer-count requirement for this incident](https://github.com/Fredilly/Xiaohai/issues/195#issuecomment-6731844100): Fred's independent human review plus exact-head green CI and checkable technical safeguards, **not** a nonexistent third reviewer. This narrow exception does not grant deletion or relax unrelated safeguards.
- Per [operator evidence](https://github.com/Fredilly/Xiaohai/issues/195#issuecomment-6733526701), the exact reviewed Phase C script was installed on the verified host with prior version backed up. Follow-up [read-only plan](https://github.com/Fredilly/Xiaohai/issues/195#issuecomment-6734366851) completed cleanly with nine protected pairs (from the full dry-run), exactly two pinned candidate pairs, `deleted_pairs=0` and exit code 0. These reports are **operator evidence, not independent SSH verification**. **Never** use direct `docker image rm`, Docker prune, containerd snapshot commands, delete volumes/backups or spoof failed workflow #41982285823. Preserve all 9 protected pairs / 18 images.
- Do not mark deployment safe until **≤70% used OR ≥15 GiB free**, plus the independent backup and health gates. Actual image deletion may reclaim less than nominal image size due to shared layers/leases.

### Recovery-evidence boundary (2026-11-09)

- **Provider snapshot existence/completion:** operator supplied Alibaba SWAS `ListSnapshots` response showing **both Oct 30 and Nov 5 system-disk snapshots** on the matched disk as `accomplished / 100%`; the console operation history shows their creation events. This establishes a completed system-disk snapshot, **not** the ability to restore safely.
- **Identity/permission claim:** operator states they are using the primary Alibaba account; this is an **operator attestation**. A visible `回滚` button or primary-account identity is not independent proof of a currently executable, scoped restore procedure.
- **Recovery procedure:** a disk rollback is destructive to later disk state and may require stopping the server. The precise instance/disk binding, permission path, recovery order, preservation of post-snapshot writes and the decision maker for invoking a rollback must be documented and independently checked **without executing one**. If unresolved, the restore gate remains **PENDING**.
- **PostgreSQL/Redis:** a full-system disk snapshot is **not** an independently tested logical PostgreSQL backup, WAL/PITR restore, or Redis persistence restore. Explicitly document RPO/data-loss exposure and post-restore health/reconciliation before authorizing a high-risk operation. Do not claim a restore rehearsal happened.
- **Review contract only:** this PR's booleans record review assertions, not cloud or host proof. A value of `true` cannot grant deletion; missing/untrusted evidence must remain BLOCKED and the host executor stays separate and default-DENY.

## B. Root cause and changes already merged

- On Nov 5 four frontend-only merges triggered four unnecessary backend builds/pulls and approximately 5.09 GiB of additional disk use.
- Merged [PR #202](https://github.com/Fredilly/Xiaohai/pull/202) reduces API/Worker runtime images and adds disk/inode gates; [PR #204](https://github.com/Fredilly/Xiaohai/pull/204) skips frontend-only backend builds based on actual previously successful backend deployment.
- **Still missing:** live automatic retirement of old tagged API/Worker Docker image pairs. Current `staging-deploy.yml` has an opt-in **read-only retention plan**; the deployment workflow never calls an image removal mode. `--steady-state-execute` exists in the host script source but has no automation wiring and requires a separately owner-approved **exact image-ID plan** on each invocation. Merely enabling `--plan` will not curb accumulation.
- #203's genuinely successful backend SHA plus immutable API/Worker GHCR manifest digests must be validated separately; a running container from the FAILED Nov 5 workflow cannot bootstrap a successful deployment record.

## C. Proposed steady-state policy — REVIEW REQUIRED, not activated

1. Run regular CI for every merge; build/pull backend Docker images **only** for verified backend-impacting changes relative to the last genuinely successful deployed backend.
2. After a **genuinely successful**, healthy, latest-main backend deploy, generate a bounded plan. Preserve: (a) actual running current API+Worker pair; (b) at least **two separately proven rollback pairs**; (c) one additional explicitly held historical pair; (d) **all five hardcoded November provisional HOLD pairs**, with **no automatic expiry**; (e) all other images referenced by running/stopped containers, Compose, aliases, infra, unknown tags/content/leases.
3. Once a future owner-approved *recurring execution policy* and restricted executor exist, remove **at most two complete, verified obsolete API+Worker pairs per eligible backend deployment**. Use exact current local image IDs, bounded references/alias scan, no forced deletion, exclusive staging deploy lock, service/volume/DB/Redis/HTTPS checks **before each pair**, and measured disk/inodes afterwards. If the protection set, storage accounting, GC state or snapshot recovery evidence is uncertain, **STOP** rather than reusing a prior approval.
4. Keep the `#195` incident Phase C exact four-ID permission **separate** from any future recurrent authorization. Current `--steady-state-execute` uses an exact-ID operator approval manifest, **not an approved perpetual automatic-deletion capability**. Do not infer blanket policy consent from Fred's one-time Phase C authorizations.
5. The existing 90-day shared-layer simulation illustrates that two retirements per one successful new pair could bound image accumulation *in the model*. It is **not** a physical disk guarantee. Periodically reconcile actual `df -hT /`, `df -i /`, Docker/containerd exclusive layers and immutable success markers. A `RECLAIM_PENDING` or no measurable reclaim must stop all future removals until separate review.
6. Automated operations must not have unrestricted Docker/root delete privileges by default. Before any rollout, separately review a least-privilege executor, evidence signing/provenance, how rollback eligibility is proven, a deployment failure recovery strategy, alerts and immediate disable/kill switch.

## D. Blocking owner decisions (do not silently guess)

| Decision | Conservative default |
| --- | --- |
| May automatic deletion run on each successfully deployed backend? | **NO** until independently approved code/policy and an explicit enablement decision |
| May a generic reviewed policy replace per-run owner-approved exact IDs? | **NO**; current exact-ID manifest remains mandatory |
| Which successful release/digests bootstrap #203? | **UNVERIFIED**; stop before build/deploy |
| Can the 5 provisional HOLD pairs expire automatically? | **NO**, each requires a separately reviewed release decision |
| Are both Alibaba snapshots complete on the matched disk? | **Operator-evidenced PASS**; provider reported accomplished/100%, not recovery proof |
| Is usable restore authorization and the non-destructive verification of the restore path independently established? | **PENDING**; primary-account statement alone is not sufficient |
| Are PostgreSQL/Redis recovery limitations and post-snapshot data-loss exposure explicitly documented? | **PENDING**; no logical/PITR restore was exercised |
| May containerd/volume/DB/Redis/unknown images be removed? | **NO** |
| Maximum permitted obsolete complete pairs per eventual execution | **2**, subject to future owner approval and hard-stop gates |
| When can Staging resume deploying? | After capacity **and** baseline/backup/health/release gates all pass |

## E. Acceptance for a future implementation PR

- Test absent/incorrect approval, stale or failed deploy marker, invalid/missing manifest digest, missing HOLD or rollback, cross-reference, stopped container, changed tag/ID, **snapshot completion without restore rights/path, or primary-account attestation without a verifiable restore runbook**, unacknowledged database recovery limitations, Caddy/DB/Redis/ready unhealthy, lock contention, disk/inode failure, shared-layer ambiguity, `RECLAIM_PENDING`, and multi-pair limit. **All must prevent deletion**.
- Demonstrate fresh exact-ID plan for only complete unprotected API+Worker pairs and at most two pairs per true successful backend release. Require no Docker operations for UI-only merges.
- Prove permission boundary by testing actual executor restrictions; a booleans-only policy checklist is NOT security enforcement.
- Run standalone `node --test scripts/staging-retention-model.test.mjs` plus required GitHub CI. New `assessSteadyStateRetention()` is a **pure review checklist**, permanently returns `dockerDeletionAuthorized=false`; it performs no cloud/host attestation.
- Before *any* real rollout: require new independent review, separate owner policy approval, verified backup recovery, Staging-capacity clearance, exact fresh host preflight, and explicit rollback/kill-switch tests.

**Out of scope here:** changing `scripts/staging-image-retention.sh`, modifying `staging-deploy.yml`, enabling Actions variables, running SSH, installing scripts, deleting images, deploying, merging PRs, changing databases or changing five HOLD protections.
