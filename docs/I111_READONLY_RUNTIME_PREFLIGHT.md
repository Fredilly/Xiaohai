# Issue #111 — trusted read-only Mac runtime preflight

This CLI collects a sanitized, fail-closed snapshot for the original isolated
Mac Plan B fixture. It never authorizes a paid request and does not contain an
execution mode.

## Command

After the exact commit has independent review, run from a separate clean
checkout with process-local configuration:

```bash
pnpm preflight:i111-readonly
```

No positional arguments or flags are accepted. In particular, there is no
`--execute`, provider, upload, migration, restore, queue or Worker mode.

The real-SQL regression is intentionally separate from the normal preflight
suite. It runs only when `I111_DISPOSABLE_DATABASE=YES` and both explicit URLs
identify the guarded loopback disposable PostgreSQL (never port 52511). Without
that marker it skips. CI and operators must never point it at Gate B.

The direct CLI fixes the original Gate B paths, container/volume identities,
database and Redis loopback ports, database role, book/page/character/reference
IDs, bucket, backup digest and Mimi/Pip source digests in code. It accepts the
database/Redis passwords and provider credential presence only from the current
process environment and never includes their values in output.

The process cannot self-assert review. A mode-0600 local record can bind the
actual clean checkout commit, Fred's PR review URL, reviewed source SHA-256
values and the ordered migration digest, but that proves only local record
consistency. The CLI separately reads the exact GitHub review ID and requires
its trusted API response to name `Fredilly`, state `APPROVED`, and bind the
exact checkout commit and review URL. Missing authentication, network failure,
or any mismatch leaves code provenance at STOP. A local record alone is never
reported as independent human approval. The review request explicitly passes
`gh api --hostname github.com`; an inherited `GH_HOST` cannot redirect it.

## Read-only guarantees

- PostgreSQL and Redis URLs must use the exact isolated loopback ports and
  restricted identities. Docker inspection is pinned to the reviewed local
  Docker Desktop Unix socket, CLI path and daemon ID; remote context/TLS
  overrides are rejected. Container IDs, volumes, configured and actual
  published ports and the stopped API/Worker state are checked before either
  connector may run. Kernel process/socket evidence must also trace the Docker
  Unix-socket server and both published-port listeners through their parent
  processes to one common Docker Desktop backend root. Each participating
  backend process must map the same on-disk executable vnode, whose Apple code
  signature identity, team and reviewed CDHash are independently checked. This
  permits Docker Desktop's legitimate multi-PID backend while rejecting three
  individually plausible listeners from different backend roots. A failed
  static endpoint or provenance check stops before TCP probing and causes zero
  PostgreSQL and Redis protocol connection attempts.
- The client sets `default_transaction_read_only=on`, starts an explicit
  `REPEATABLE READ READ ONLY` transaction and always rolls it back.
- Queries are `SELECT`/session-local timeout statements only. The CLI does not
  start API/Worker processes. Redis inspection uses only queue-length reads for
  the four queues consumed by the Worker. It makes no BOS or Bailian request.
- Backup, PNG, approval, source and migration evidence reject symlinks and
  untrusted parents, and are opened with `O_NOFOLLOW`; reads are bounded to the
  opened file's size, and file plus parent identity are rechecked after the
  same-handle read. No restore or remote object request occurs. Portable Node
  APIs cannot provide a fully descriptor-relative `openat` walk, so this is
  fail-closed hardening rather than a claim that every parent race is
  cryptographically impossible.
- Read-only Git probes set `GIT_OPTIONAL_LOCKS=0` and reject a dirty tracked
  checkout. Untracked local evidence is not modified.
- Output contains only allowlisted codes and PASS/STOP classifications. It does
  not contain a DSN, key, signed URL, object body, prompt or database row ID.
- `paidExecutionAuthorized` is always `false`.

## Deliberate STOP conditions

The collector independently checks the fixed Docker container IDs, loopback
listeners, volumes and PostgreSQL data directory; restricted role attributes;
all 42 Drizzle SQL hashes/timestamps/order; exact Mimi/Pip IDs/order on all three
pages; every character row and selected reference; all image work; Redis queue
lengths; illustration media joins; every reservation, ledger and budget-window
row; Beijing Workspace binding; and the 900-second signer/timeout invariant.
Processes and Redis queues are sampled before and after the database snapshot;
the output labels this narrowly as `processAndRedisSampling`. PostgreSQL active
jobs are checked inside the read-only database snapshot and can independently
STOP the overall result, but are not misrepresented as part of that sampling
label. An observed Worker/queue race stops the check. These remain
time-separated samples, not atomic isolation. The complete provider/queue retry
chain is also not provable from source regexes. Accordingly atomic isolation
and retry semantics are always explicit STOP conditions that a future executor
must recheck under its own lock immediately before any paid call.

Offline configuration cannot prove the provider's complete invoice. Therefore
the CLI unconditionally reports `I111_PRICE_BASIS_UNVERIFIED`. Matching database
reservation and ledger amounts is labelled ledger consistency, never provider
invoice verification. Local PNG bytes and database BOS metadata are also
reported separately from real remote-object validation; the CLI unconditionally
reports `I111_REMOTE_BOS_UNVERIFIED`. The old 300-second Mac GET evidence does
not prove the new 900-second signer or Bailian service-side private-object fetch.
Those remain separate, owner-authorized real-environment acceptance steps; this
CLI never attempts them.

The existing Gate B `api.mode=enabled` marker is also a STOP even when no process
is listening. It must be reviewed separately rather than silently rewritten by
this preflight.
