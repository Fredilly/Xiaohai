# Issue #195 — Phase C batch 2 safe recovery proposal (CODE ONLY)

**Status: DRAFT. NOT AUTHORIZED FOR HOST INSTALLATION, LIVE IMAGE DELETION, DEPLOYMENT, OR MERGE.**
The already-executed Phase B authorization `XIAOHAI-195-PHASEB-20261106-EXACT4` is consumed.
This proposal is based on the operator's 2026-11-07 read-only `--plan` and
[Issue #195 exact-ID proposal](https://github.com/Fredilly/Xiaohai/issues/195#issuecomment-6700480863).

## Why a second separately gated mode

The current staging `e4c1117e99e1d739b002f99be3b97be7ede89121` deployment is associated with
a **FAILED** GitHub Actions workflow `41982285823`. Do **not** mark it successful to bypass
the `--execute` or `--steady-state-execute` gate. The existing
`--recovery-execute` is pinned to Phase B's completed, already-deleted
`1138ce...` and `14d59d...` images, and must never be reused for additional batches.

The proposed `--batch2-recovery-execute` is a *separate*, default-DENY,
code-reviewed staging exception. It reuses the current locked, preflight-first
reference/health checks and stops after two **complete** release pairs.
**It is NOT called by GitHub Actions or any scheduled job.**
The script remains read-only when invoked with `--dry-run` or `--plan`.

## Exact Phase C batch 2 candidate allowlist

Columns are revision, **local Docker API image ID**, **local Docker Worker image ID**.
These are not GHCR manifest digests and are not an assertion of physical reclaimed bytes.

```text
15bc9dadc32b30f55cbc5cbcb2cc410c1564433e sha256:25dec94a82dfa4cee25cd5110fd857cc3785423cf0cba46c55711bda9e89bcac sha256:6dfd97eec6928f3f26608dd0091a6f97d4be9b653057af0b619d6400cfffffb3
3f0e3d0ad16352393cdeaa12e8f8482c9c9fcfeb sha256:3f6fa4334bc9dba8650a1ad68e3ee6c6f823429a6cadff8bef6f315987f75c76 sha256:c3092df879a8cc7a06980188527d17b425616f66e9d0aed4ad2551b9850c6c75
```

## Authorization and runtime barriers

No operator execution should occur on this draft. To eventually execute, the
owner must **separately**:

1. Approve the four exact image IDs above, commit and CI tests, and a new Phase C
   authorization ID of the form `XIAOHAI-195-PHASEC-...`; never reuse the
   historical Phase B approval.
2. Authorize the **new reviewed script installation on the verified staging host**,
   with its new pinned Git blob hash, original script backup and syntax tests.
   Until then the previous Phase B script at
   `/home/admin/xiaohai-deploy/staging-image-retention.sh` must not change.
3. Verify both Alibaba Oct 30 / Nov 5 system disk snapshots still
   `accomplished/100%` with usable recovery rights. A disk snapshot is not
   a verified PostgreSQL logical recovery.
4. Confirm the actual current SHA/image IDs, current + two rollback + extra
   protected + all five HOLD pairs (**9 pairs / 18 images**), five containers,
   four volumes, PostgreSQL + Redis persistence, HTTPS `/health` and `/ready`,
   lock, disk/inodes, and all deployment refs including stopped containers,
   aliases, config files, systemd/cron and external dynamic refs.
5. Refresh `--dry-run` and `--plan`, verify the exact manifest matches the
   newly authorized two IDs, and separately authorize **one live execution**.
   The caller must explicitly opt in to ordinary retention execution, recovery
   execution, **batch-2 execution**, operator runtime acceptance, bind the
   approval to an evidence file containing snapshot Success, original
   `workflow_run=41982285823 conclusion=failure reason=post_disk_gate`,
   and `batch=2 candidate_a=... candidate_b=...`.
   The `STAGING_DEPLOY_SUCCEEDED_REVISION` must remain **unset**.

Any missing approval, wrong image ID, changed refs, protected/HOLD mismatch,
unhealthy service, lock conflict, unexpected Docker state, missing required file,
or pending GC must **STOP**, not prune, retry, force-delete or expand the batch.

## Code safeguards and negative tests

- Exact full SHA + API and Worker ID constants are pinned in the script;
  user approval-plan content must **exactly** match the two triples.
- All four candidates validated before removing the first. No aliases,
  protected IDs, live/stopped container references or deployment config
  references are permitted. The four pinned revision *declaration lines* in
  the retention source are the only source-file allowlist exception.
- Locked deletion checks exact refs/IDs again immediately before each tag
  removal, then health, disk and inode. Stops at two pairs or uncertain
  containerd garbage collection. Only Docker tag removal API is used.
- Negative regression tests cover missing batch-2 opt-in, wrong/reused approval
  ID, missing evidence, failed-run success spoofing, candidate mismatches
  (including second pair before any removal), protected HOLD missing,
  service readiness/stopped worker, and active Compose refs. The original
  `--recovery-execute` must refuse a batch-2 plan.
- No PostgreSQL, Redis, Caddy, cloud snapshots, volumes, containerd layers,
  unknown or dangling images, schema, app API or miniapp semantics are changed.

## Review checkpoints and observations

- **Actual Phase B physical savings**: 2.507 GiB, root 49G total / 38G used /
  9.0G free / 81% used after cleanup.
- **Operator post-cleanup check**: 18/18 protected image tags exist, `/health=200`,
  `/ready=200`, all five containers up and PostgreSQL healthy.
- **Owner deployment clearance gate**: `<=70% used` OR `>=15GiB free`. Neither
  condition is met. **Keep `STAGING_READY=false`.**
- **Review also** script changes, full negative tests, CI on the latest PR head,
  distinct human reviews required by `docs/COLLABORATION.md`, and one-time
  installation/deletion permissions. A green CI is *not* a live authorization.

### Decisions Needed

1. Fred: approve/reject the next exact-ID pair list and the separate code path;
   supply a **new** authorization identifier and explicit installation/
   execution scope when ready.
2. Owner/operator: independently verify backup restore permissions and any
   PostgreSQL point-in-time recovery limitations prior to subsequent deletion.
3. Infra owner: replace long-term unrestricted Docker/root cleanup capability
   with an explicitly constrained, default-DENY executor. This code-level
   guard alone does not enforce OS/cloud IAM least privilege.
