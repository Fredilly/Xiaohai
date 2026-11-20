# I111 disposable PostgreSQL session-isolation acceptance plan

**Status: DESIGN ONLY / NO-GO.** This document defines a future, separately
authorized integration acceptance of PostgreSQL session ownership. It does not
create a database, start a service, run migrations, expose a Coordinator, or
authorize Phase A/B. `paidExecutionAuthorized=false` remains mandatory.

## Scope and non-goals

The future test may use only a dedicated, disposable PostgreSQL instance that
was created for this one acceptance. It must not use production, shared
staging, the original Mac fixture, or any existing I111 database. A localhost
URL, environment variable, DSN, role name, or backend PID is only an input to
be independently checked; none is proof of trust by itself.

No schema migration, reset, cleanup, restore, or destructive operation may be
performed automatically. The test must stop before connecting when the
environment, process provenance, database identity, credentials, owner grant,
or recovery plan is missing or ambiguous. Disposable-environment creation,
credentials, data retention/deletion, recovery, and the exact one-time
authorization require separate human approval.

The existing private ownership kernel and this plan are different from a
production Coordinator. The kernel remains unreachable from the public entry;
`runI111TrustedCoordinator()` must continue to return a fixed redacted STOP.

## Required pre-connection gates

An independent observer must record sanitized evidence for the exact host,
socket/port, container or VM identity, PostgreSQL executable and version,
data-directory identity, role, database name, and disposable lifecycle owner.
The observer must reject shared/remote endpoints, unexpected parents,
redirected Docker contexts, reused volumes, inherited untrusted Git/runtime
configuration, and any competing API/Worker process. Evidence must not
contain passwords, complete DSNs, keys, signed URLs, or row contents.

The test must not connect until all gates pass. It must not run migrations or
silently repair a failed gate. Any unknown or race between samples is STOP.

After connecting, and before any write, the test must re-check server identity
using authenticated PostgreSQL observations. These observations are evidence,
not an execution grant.

## Sole-owner session proof to obtain

The future reviewed Coordinator must:

1. Create its dedicated `pg.Pool` internally and checkout exactly one real
   `PoolClient`; callers cannot provide a Pool, client, Drizzle handle,
   wrapper, WeakMap brand, or PID assertion.
2. Acquire the advisory lock on that client and keep the checkout and lock for
   the entire critical lifecycle.
3. Construct Drizzle from that exact checked-out client. `Pool.query()`, a
   fallback pool, and a second client are forbidden.
4. Prove that `BEGIN`, every API/Worker SQL statement, the durable `AT_RISK`
   marker commit, final evidence read, `COMMIT`/`ROLLBACK`, and unlock all use
   the same PostgreSQL backend/session. The marker must commit before any
   provider request.
5. Re-check session identity at meaningful boundaries. A single
   `pg_backend_pid()` sample, `processID`, object shape, `instanceof`, or
   WeakMap brand is not ownership proof.
6. Stop new work, account for in-flight operations, verify the lock/session
   state, unlock on the original client, and release exactly once in `finally`.
   Unknown transaction, query, lock, release, or pool-shutdown state is
   UNKNOWN/STOP, never success or retry.

The test must include an independent observer connection for `pg_stat_activity`,
`pg_locks`, `backend_start`, transaction state, and disappearance after cleanup.
These observations can corroborate lifecycle facts but cannot turn PID equality
into complete ownership proof.

## Evidence matrix

| Property | Observation point | Evidence source / expected result | Failure and fixed outcome | Not proven by this evidence |
| --- | --- | --- | --- | --- |
| Disposable identity | before first connection and immediately before connect | independent process/container/data-directory checks match the approved allowlist | missing, shared, replaced, or racing identity → `I111_ATOMIC_ISOLATION_UNVERIFIED` / STOP | provider isolation or invoice correctness |
| Runtime artifact | before connect and before critical call | exact reviewed HEAD/tree, source and loaded API/Worker bytes, signer/build record | mismatch, unsigned or substituted artifact → STOP | hostile in-process dependency |
| Sole checkout | during connect | Coordinator-created pool emits exactly one checkout; no caller object | injected Pool/Client, second checkout, or unknown checkout → STOP | server-side lock ownership |
| Session identity | after checkout, after lock, before marker, after Worker, before unlock | same server session via backend observations plus independent activity/lock evidence | PID/backend/`backend_start` drift or missing observation → STOP | adversary with DB superuser or process memory |
| Transaction continuity | BEGIN, each SQL, marker commit, final read | server-side transaction/backend evidence and instrumented SQL audit all agree | cross-backend, implicit pool query, cancelled/unknown transaction → STOP | semantic correctness of every business query |
| Lock lifetime | lock acquisition through final evidence | `pg_locks` shows the approved lock held by the same session; unlock result and disappearance are observed | competing holder, early unlock, unknown unlock → STOP | future lock after connection loss without live evidence |
| Durable marker ordering | immediately before provider boundary | committed database row/ledger evidence precedes any provider attempt | marker absent, ambiguous, or late → `I111_ATOMIC_ISOLATION_UNVERIFIED` / STOP | provider charge outcome |
| Cleanup | after final evidence | no in-flight query, unlock observed, client release once, pool end completed | timeout, late result, release/end failure or unknown session → STOP/UNKNOWN | physical socket teardown without OS evidence |
| Final evidence | after Worker and before cleanup | same-session read confirms exact target, media and marker; independent observer confirms lifecycle | missing/ambiguous/stale evidence → STOP | invoice, BOS and price basis |

Client declarations, static source scans, simulated errors and local JSON are
never promoted to independent runtime evidence. All observations are sanitized
to fixed codes and counts.

## Negative-test matrix (future, not run here)

Each case must produce a redacted fixed STOP, zero provider calls, no retry,
and preserve any uncertain durable marker:

| Case | Required future method |
| --- | --- |
| fake PoolClient / `pool.query` wrapper | inject only at a test seam outside production exports; assert rejection before checkout/SQL |
| two real clients crossed between API and Worker | trace backend identity for every statement; assert no provider call |
| Drizzle transaction crossing backends | use server-side transaction/backend observations and a concurrent observer |
| premature or double release | instrument client lifecycle and assert one release, then STOP |
| backend PID or `backend_start` change | terminate/replace session in disposable DB; assert no further SQL |
| lock released early or competing holder | observe `pg_locks` from the independent connection; assert callback never proceeds |
| query still running at unlock | delayed server query plus observer; assert no unlock/release until settled, otherwise UNKNOWN/STOP |
| client timeout while server continues | server-side delayed statement and observer; assert no follow-up SQL or normal release |
| connection interruption / transaction cancel | terminate backend or cancel statement only in disposable DB; assert rollback/cleanup is unknown → STOP |
| late connect | delayed checkout substitute plus real pool lifecycle; assert destroy request, no normal release, no retry |
| `pool.end()` timeout or late resolve/reject | bounded wait plus observer; distinguish waiting timeout from actual session disappearance |
| cleanup failure or multiple errors | fault-inject release/unlock/end; assert fixed error code, no raw DB details |
| final evidence unavailable | remove/alter evidence in disposable DB; assert no success claim |
| untrusted runtime artifact/process | replace or redirect loaded bytes/process parent in a safe harness; assert STOP before connect |

Pure VM tests can validate logic and redaction, but cannot certify checkout,
server-side transaction continuity, advisory-lock ownership, or physical
session termination.

## Future human authorization required

Before any live acceptance, the responsible owner must separately approve, in
writing and for one bounded run:

- exact disposable host/VM/container, database and role allowlist;
- credential delivery and expiry without recording secrets;
- creation, test data scope, destructive-test permission, retention and
  deletion/recovery procedure;
- exact reviewed commit, build/artifact digests and observer tooling;
- independent human review of the test code and failure evidence;
- explicit prohibition on production/shared staging/original fixture access;
- zero-fee/no-provider mode and confirmation that no Phase A/B or paid call is
  permitted;
- stop conditions for identity drift, lock/transaction uncertainty, cleanup
  failure, unknown provider result, or evidence race.

No approval in this document renews an earlier grant. The four permanent STOP
conditions remain:

- `I111_ATOMIC_ISOLATION_UNVERIFIED`
- `I111_RETRY_SEMANTICS_UNVERIFIED`
- `I111_REMOTE_BOS_UNVERIFIED`
- `I111_PRICE_BASIS_UNVERIFIED`
