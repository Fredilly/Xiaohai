# I111 — trusted PostgreSQL session ownership contract (design only)

**Status: NOT IMPLEMENTED / NO-GO.** This is a review contract for a future
Mac-specific Trusted Coordinator. It does not introduce a runnable coordinator,
checkout a client, create a job, call a provider, or authorize Phase A/B.
`paidExecutionAuthorized=false` and all four existing I111 STOP conditions remain.

## Why the previous attempt was reverted

The proposed `createI111SessionBoundDatabase()` registered caller-supplied
`query` / `release` / `processID` objects in a `WeakMap`. That brand proved only
that the constructor had been called; it did **not** prove a real checked-out
PostgreSQL session or that the client remained checked out. An object wrapping
`pool.query.bind(pool)` with a fake `release()` and `processID` passed its
checks, potentially sending `BEGIN`, statements and `COMMIT` to different
backends. Two different clients could each receive a valid brand, and a
released client retained its brand. The implementation was reverted after
independent offline negative probes.

Do not recreate that brand under a different name. Neither `instanceof`, a
`processID` property, a matching `pg_backend_pid()` sample, a structural type,
nor a caller-provided `db` handle is alone an authorization or ownership proof.

## Ownership boundary required for a future implementation

The **single source-reviewed Coordinator** must own the entire lifecycle, not
accept an already-created client, Drizzle DB or fake ownership token from a
caller. No standalone session-minting service, generic API/Worker adapter,
paid CLI or sequence of independently callable paid ports may be exposed.

1. Authenticate the exact allowed Mac/process, Docker/PostgreSQL identities,
   target database and DB role from independently checked evidence. An
   environment variable or API request is never sufficient. Verify no ordinary
   API/Worker and no unapproved competing jobs are running. Stop before any DB
   connection when a required preflight fact is missing or mismatched.
2. Create or acquire the **dedicated, isolated `pg.Pool` internally** under the
   reviewed configuration. Obtain exactly one real `PoolClient` using its own
   `pool.connect()`. Do not accept an externally supplied client, Pool-like
   object, `query` wrapper, `WeakMap` brand or `processID` assertion as proof of
   checkout. Do not expose the raw client, pool, or `release()` to API/Worker
   constructors, CLI arguments, user code or independent callbacks.
3. On that same private client, obtain the I111 advisory lock and verify its
   server-side backend PID. The helper's current client-shape and PID checks
   are defense in depth, **not** session provenance. Verify the holder again
   before and after the critical operations; a PID change or unknown state is
   STOP. Keep this lock and checkout for the **whole invocation**.
4. Construct **one** Drizzle database using that exact private checked-out
   client (and the repository's complete schema). Never use `drizzle(pool)`,
   `pool.query()`, a fallback new pool, or independently constructed DB handles
   for any operation in the invocation. If a restricted query façade is ever
   considered, independently prove its transaction behavior and that no
   in-flight query can outlive the lease; do not rely on Drizzle's Pool
   detection heuristics.
5. Under that lock and DB, collect an independently authenticated fresh
   snapshot and exact owner grant. Bind a single immutable slot; check
   freshness, use the **real** formal API once, verify exactly one new
   reservation, then use the exact-ID Worker once. The Worker must durably
   commit the atomic `AT_RISK` ledger/reservation marker before any provider
   POST. Never substitute a preparatory boolean or replay a failed/unknown
   provider attempt.
6. Read independent final evidence on the same held session; do not treat the
   Worker returning an illustration ID as success. Success evidence still
   leaves the next slot blocked until independent invoice reconciliation and
   new one-time approval. Do not automatically advance to the next slot.
7. In a **single finally path**, stop new queries, account for any outstanding
   operations, verify server-side session identity, attempt advisory unlock
   on the original client, and only then call its `release()` exactly once.
   Unknown unlock, transaction, query or release outcome is a fixed-code STOP,
   never a retry or successful execution report. A dropped backend may release
   locks server-side, but do not claim that without live evidence.

This ownership boundary cannot prove isolation from an adversary with access
to the same process, direct pool internals, malicious dependencies, a replaced
runtime bundle, or independent database users ignoring the advisory protocol.
Those require external process/runtime and artifact provenance controls.

## Mandatory offline negative tests before accepting a runtime patch

Each failure below must return a redacted STOP, issue **zero paid provider
calls**, leave the next slot blocked, and preserve any uncertain durable marker.

| Case | Required behavior |
| --- | --- |
| `pool.query.bind(pool)` plus fake `release` and PID | Reject before checkout/lock/prepare |
| Bare `pg.Pool` passed as claimed checked-out client | Reject before any SQL |
| Client or Drizzle handle supplied by caller | Reject; Coordinator must own creation |
| Two distinct checked-out clients/Drizzle handles | Reject any cross-session handoff |
| Premature or double `release()` | Stop; never start provider or report success |
| PID mismatch or backend change | Stop; no further paid attempt |
| Transaction begins or commits on a different backend | Stop; no provider POST |
| Callback returns with in-flight/unawaited queries | Do not unlock or release while work is outstanding |
| Lock, query, transaction, unlock or release failure | Fixed-code STOP, redacted, never retry |
| Wrong/expired owner grant, stale slot, duplicate reservation | Stop before any paid provider call |
| ProcessOne returns ID after failure | Final evidence must fail; no success claim |
| Replaced/unsigned loaded runtime artifacts | Stop before checkout and paid work |

The test harness must exercise the actual Drizzle/node-postgres transaction
path, not merely an object-shaped mock. Such tests require a separately
authorized **disposable local PostgreSQL** environment with identity and
destructive-test guards; they must never silently connect to the original Mac
fixture, shared staging or production. Pure synthetic tests can validate
logic, but cannot certify checkout/session/commit behavior.

## Review and authorization sequence

1. Review this contract and the exact code-only patch separately. No runtime
   capability is created here.
2. Implement the real sole-owner Coordinator in a later reviewable change,
   preserving the no-generic-adapter rule. Independently test fake handles,
   transaction backend identity, lock lifetime and release semantics.
3. Obtain independent source/build/dependency provenance and prove exact bytes
   loaded at runtime. Matching offline builds alone are observations.
4. Verify actual Mac-specific identities, isolated DB, no competing workers,
   owner grant, complete evidence, price basis, retry semantics and remote BOS
   with the appropriate *separate* permissions. Nothing in this document
   renews an earlier approval or permits Phase A/B.

Four permanent blockers until separately cleared:

- `I111_ATOMIC_ISOLATION_UNVERIFIED`
- `I111_RETRY_SEMANTICS_UNVERIFIED`
- `I111_REMOTE_BOS_UNVERIFIED`
- `I111_PRICE_BASIS_UNVERIFIED`
