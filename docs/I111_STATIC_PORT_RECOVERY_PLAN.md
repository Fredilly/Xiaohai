# Issue #111 — static-port isolated runtime recovery (STOP / no execution)

## Why the original resources cannot satisfy the reviewed preflight

The original Mac PostgreSQL and Redis containers were created with dynamic published ports:
`HostConfig.PortBindings["5432/tcp"][0].HostPort === ""` and the analogous Redis
`6379/tcp` binding. The reviewed preflight requires the **persisted** ports `52511`
and `52512`, **plus** matching `NetworkSettings.Ports`, `docker port`, signed Docker
Desktop backend/listener provenance, full pinned container IDs, and named volumes.

Starting the stopped containers cannot turn a dynamic persisted binding into a
fixed one. Creating a replacement with explicit ports produces **new** container
IDs and cannot pass the existing preflight's old ID checks. Do not edit Docker
Desktop's internal metadata, use an untrusted port-forwarding proxy, or weaken
the existing endpoint/daemon/backend identity checks to work around this.

## Preservation and preparation gates

This is a **plan**, not authorization to create, copy, start, or delete resources.
The actual Mac operator must supply independently observed, sanitized evidence
before any operation. Stop on any missing, conflicting, or changed fact.

1. Confirm the exact original Docker Desktop daemon, socket and signed backend,
   both old *full* container IDs, the `com.xiaohai.issue=111` and `plan-b` labels,
   old named volumes, old image IDs/digests, original data mount destinations,
   and that both old containers are stopped. Do not print container environment
   variables or credentials.
2. Verify the actual APFS volume identity, free bytes **and** inodes, the
   allowlisted Gate B backup's `0600` mode, expected size and SHA-256, the
   matching migration and fixture identities, and the ability to recover the
   original isolated data. Never use other project or staging/production data.
3. Confirm API and ordinary Worker stopped, `52511`, `52512` and `52513` are
   unused, no unexpected volume users/locks, and no alternate listener or Docker
   daemon. Preserve all original stopped containers and original volumes.
4. Design a dedicated, independently named **new** PostgreSQL volume and Redis
   volume, and two new containers using **the verified original immutable image
   identities** and exactly these creation-time published port configurations:
   - PostgreSQL: `127.0.0.1:52511:5432`
   - Redis: `127.0.0.1:52512:6379`
   No `-P`, blank `HostPort`, wildcard binding or remote Docker endpoint.
5. If cloning data is required, use a documented offline copy from an original
   **stopped, read-only mounted** volume to its **new dedicated** volume. Prove
   ownership/permissions, image compatibility, content integrity, backup and
   recovery path before any new database start. No `--volumes-from` or reuse of
   an original writable volume. Do not print or export database credentials.
6. Do not start the new containers until their configuration, source-data copy
   and all resource identities can be inspected safely. Startup may itself
   perform database recovery writes **inside the new volumes**; do not report
   this as a zero-write operation. If any step fails, STOP without retries.

## Code and trust transition

- Work only in an independent development checkout. Do not modify the previously
  approved `b4890c76...` detached checkout or the original Gate B tree.
- The new **full** container IDs, Docker volume names and image identities must
  come from the actual Mac's trusted Docker daemon **after** resource creation.
  Pin them in a new reviewable source revision; never take them from arbitrary
  environment variables or caller-supplied JSON.
- Keep checks for the exact trusted Docker socket, daemon ID, kernel port
  listeners and common signed Docker Desktop backend. Keep explicit persisted
  **and** actual fixed-port validation. Missing/bad evidence must STOP before
  TCP probes, PostgreSQL connections and Redis connections.
- Update source hashes and approval provenance through a genuine review for the
  **new** exact commit. The old PR #237 APPROVED review and local approval JSON
  are evidence only for the old code; never relabel or reuse them as approval
  for a changed source revision.
- Run static/negative tests first (wrong ID, daemon, ports, volumes, listener,
  socket and signature; dynamic `HostPort`; identity drift and zero connection
  on every failing gate). Never invoke `preflight:i111-readonly` while any gate
  is unresolved.

## Status as of 2026-11-19 (Mac operator report, pending new code review)

| Check | Status |
| --- | --- |
| Original stopped containers/volumes preserved | PASS, last Mac report |
| Original Docker daemon and container IDs | PASS, last Mac report |
| Original HostPort static mappings | STOP: both blank/dynamic |
| APFS capacity/inodes, backup, reference images and 42 migrations | PASS, last Mac operator report; ~358 GiB available |
| Offline original-source volume archive digest | PASS, last Mac operator report; source mounts read-only |
| New isolated volumes/containers and exact IDs | CREATED and RUNNING, last Mac operator report; see below |
| New fixed-port mappings and signed listener provenance | PASS, last Mac operator report |
| Previous adapter HEAD `2f0e392...` and independent code review | PASS, Fredilly review `5970618164` |
| Proposed two-mount / external approval-path code revision | PENDING new exact-head CI and independent review |
| Read-only Phase A invocations | 0 / 1 reported |
| Phase B, BOS, provider or paid generation | HOLD / 0 |

`paidExecutionAuthorized=false` remains mandatory. This plan does **not** renew
or extend an earlier time-bounded invocation authorization.

### Observed candidate identities (reported by the trusted Mac operator)

The fixed-port candidates are **additional** Docker resources. They do not
replace, reuse, modify, or delete the original stopped containers and original
volumes. The Mac operator separately confirmed the new resources have labels
referring to the old full container IDs and old volume names. Exact labels,
runtime provenance and source-copy evidence must still be verified on the Mac
before any Phase A invocation; this table is not a substitute for live proof.

| Resource | PostgreSQL | Redis |
| --- | --- | --- |
| New container name | `xiaohai-i111-planb-fixed-postgres` | `xiaohai-i111-planb-fixed-redis` |
| Full container ID | `3fdfd302d45de4f487197bdc0e335f8f3f6dec8a38cd6eb16b1ead883fe3b87f` | `9a57c5bd1e310f47880c5fba3e7be21c76441359eeda82d3f897f34937be02e1` |
| Image ID | `sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73` | `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf` |
| New dedicated volume | `xiaohai_i111_planb_fixed_pgdata` | `xiaohai_i111_planb_fixed_redisdata` |
| Persisted and actual binding | `127.0.0.1:52511:5432` | `127.0.0.1:52512:6379` |
| Observed `com.xiaohai.plan` label | `plan-b-fixed-ports-v1` | `plan-b-fixed-ports-v1` |
| Observed source container label key | `com.xiaohai.source-container` | `com.xiaohai.source-container` |
| Original source container | `fdede2cf57f70465a950b0a4ea2d13cb6894cc13bc97b540ecf660b9c1629f24` | `920804ca22010bfe8ae8791e9f6ec88604d870151685ea6a31e66dc23182f031` |
| Original preserved volume | `xiaohai_i111_planb_pgdata` | `xiaohai_i111_planb_redisdata` |

The new code pins these candidate IDs, immutable image IDs, source provenance
labels by the **Mac-observed exact** `com.xiaohai.source-container` and
`com.xiaohai.source-volume` keys, the exact `plan-b-fixed-ports-v1` label,
and exact dedicated volume mounts. The earlier reviewed `source-container-id`
and `plan-b` names did not match the already-running isolated candidates;
this change does **not** permit those alternate names to substitute for the
observed labels. Its local regression suite
must reject identity drift without opening PostgreSQL or Redis. This is a
**new unreviewed source revision**: the prior `#237` approval and existing
local approval JSON **must not** be reused. The new approval verifier accepts
**only PR #239** approval URLs and queries that exact GitHub PR's Review API;
it still requires a live Fredilly `APPROVED` review for the exact checked-out
SHA, matching review ID and canonical URL. No Phase A CLI invocation occurred.

### 2026-11-19: additional Mac field evidence and bounded follow-up

Mac operator's **metadata-only** inspection found that each new container has
**exactly two** mounts. This differs from the former source assumption of a
single named volume. Both runtime bind mounts have `RW=false` and
`Propagation=rprivate`; their persisted declarations are in
`HostConfig.Mounts` (`HostConfig.Binds=null`) with `ReadOnly=true`:

| Container | Independently named data volume | Read-only bind destination | Host source (Mac) |
| --- | --- | --- | --- |
| PostgreSQL | `xiaohai_i111_planb_fixed_pgdata` → `/var/lib/postgresql/data` | `/run/secrets/postgres_bootstrap_password` | `/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/secrets/postgres_bootstrap_password` |
| Redis | `xiaohai_i111_planb_fixed_redisdata` → `/data` | `/usr/local/etc/redis/redis.conf` | `/Volumes/Data/Xiaohai-i111-gate-b/.i111-plan-b/secrets/redis.conf` |

Docker Desktop reports each bind runtime `Source` with an exact `/host_mnt`
prefix. The corresponding Mac files were verified without reading their
contents: regular files, canonical paths, UID/GID `501/20`, mode `0600`, no
ACL/flags, device `16777224`, inodes `576874` (PostgreSQL) and `576877`
(Redis). The trusted parent chain is owner/root-owned and group/world
non-writable; the dedicated secrets directory is `0700`. The original stopped
containers and their volumes are still preserved and never mounted into the
new containers.

The independent, newly verified approval evidence is now located at
`/Volumes/Data/Xiaohai-i111-pr239-approval/i111-readonly-runtime-approval.json`
in a `0700` directory with `0600` file mode. The original Gate B approval
remains **unchanged**. The previous reviewed runtime still defaulted to that
old Gate B evidence path. The proposed source revision instead pins the new
independent path and strictly allows one named writable data volume **plus**
one pinned read-only bind, with metadata-only source checks and negative tests.

**HOLD:** The new revision changes one of the eight approval-hashed files. The
existing approval for `2f0e392...` must **not** be recycled for the new HEAD;
once reviewed, a separate 0600 exact-head record must be prepared without
overwriting prior evidence. The Mac operator must re-check live field identity
and missing process-level environment prerequisites. No Phase A CLI invocation,
PostgreSQL/Redis connection, provider/BOS call, paid operation or main merge is
authorized by this code change. `paidExecutionAuthorized=false`.
