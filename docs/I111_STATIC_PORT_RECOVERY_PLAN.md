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

## Status as of 2026-11-19 (operator-reported)

| Check | Status |
| --- | --- |
| Original stopped containers/volumes preserved | PASS, last Mac report |
| Original Docker daemon and container IDs | PASS, last Mac report |
| Original HostPort static mappings | STOP: both blank/dynamic |
| New Mac disk/inode/immutable image and copy evidence | NOT_VERIFIED |
| New isolated volumes/containers and exact IDs | NOT_CREATED |
| New code revision and independent approval | NOT_READY |
| Read-only Phase A invocations | 0 / 1 reported |
| Phase B, BOS, provider or paid generation | HOLD / 0 |

`paidExecutionAuthorized=false` remains mandatory. This plan does **not** renew
or extend an earlier time-bounded invocation authorization.
