# Issue #111 — isolated one-shot orchestration contract

**Status: IMPLEMENTED / OFFLINE-VERIFIED / REAL-RUN NOT AUTHORIZED.** The repository now contains a trusted
Mac-specific runner at `scripts/i111-trusted-one-shot-runner.mjs`. Its default
entrypoint is an offline dry-run. The live path owns its PostgreSQL pool and
session, but remains fail-closed behind the read-only preflight and an
independent, exact-scope GitHub owner operation grant. It does not authorize a
paid operation by itself; live validation and quality acceptance remain blocked
until those external conditions are satisfied.

The previous general-purpose `scripts/i111-formal-api-worker-ports.mjs` adapter
was removed from the runtime source tree: its caller-injected `apiService` and
`createTargetWorker` could be invoked independently of the owner grant and
exclusive-lock coordinator. Its synthetic tests were retired with it. The
source-bound API and Worker keep their dedicated negative tests; a future
composition root must not revive the generic adapter or expose independently
callable paid operation ports. The executable coordinator remains fail-closed.

The subsequently rejected caller-branded session-binding attempt has also
been reverted. The required single-owner checkout, Drizzle binding and release
lifecycle are specified in
[`I111_TRUSTED_SESSION_OWNERSHIP_CONTRACT.md`](./I111_TRUSTED_SESSION_OWNERSHIP_CONTRACT.md).
That document remains the design reference; it does not grant operation authority.

## Why this separate change

PR #237 merged the independent read-only Mac preflight. The previous one-shot
snapshot policy already rejects cover pages, unexpected revisions, extra calls,
unsettled prior costs, unknown provider outcomes and wrong resource identity,
but policy alone does not specify the **execution sequence**. This PR adds
`scripts/i111-one-shot-orchestration.mjs` and synthetic regression tests for
that sequence, without changing the normal API, Worker or schema.

The review/source binding for this executor is PR #242 and the exact checked-out
commit. PR #241 evidence is not accepted, and a code review alone is never a
paid-operation grant.

## Fixed contract for one invocation

1. Acquire and hold an **actual exclusive runtime/DB lease** for the entire
   invocation. A callback mock is **not** proof of exclusivity. The trusted
   runner owns one `pg.Pool`, checks out one client, pins its backend PID and
   uses the same Drizzle session for the formal API, reservation, Worker and
   final evidence. The paid boundary rechecks database identity, target page,
   active tasks, reservation and budget state while that lock is held.
2. Collect an independently authenticated fresh snapshot. Apply the existing
   `assessI111OneShotSnapshot` fail-closed policy. Its best result is
   `STATIC_REVIEW_ONLY`, never a spending permission.
3. Separately verify Fred's **new, specific, one-time operational approval**
   from a trusted source. It must bind the **exact merged executor SHA**, the
   original Mac/database/book/page/revision, allowed three-call maximum,
   CNY 2 full spend cap, deadline, no retry and STOP conditions. A local JSON
   flag, a GitHub code review, or the snapshot alone cannot authorize this.
4. In the isolated environment, invoke the formal
   `PictureBookService.generateIllustration` transaction **once** with the
   fixed consumer/book/next page and regeneration mode. It must create one
   **new** `QUEUED` illustration plus one budget reservation. The queue
   notifier must be a no-op or fully isolated; no generic Worker may be active.
5. Verify the returned illustration ID, exact revision, reservation, and the
   absence of other queued/active work. A reused previously queued job is a
   **STOP**, not a successful new reservation.
6. Recheck live isolation, budget, scope and the operation grant at the paid
   boundary **under the exclusive lock**. The existing
   `consumeI111ProviderSlot` performs the irreversible database marker under
   its transaction lock immediately before the provider POST; neither layer
   may automatically retry.
7. Invoke the target-ID `ImageJobProcessor.processOne` **once** and no other
   Worker path. Re-read the illustration, media and reservation/ledger state;
   require matching target ID, `READY` (or synthetic-contract `SUCCEEDED`), media `READY` and immutable
   `AT_RISK` marker. Even then the coordinator returns **STOP** pending
   independent provider charge/invoice reconciliation and next-slot approval.

The trusted runner now owns the live Pool/PoolClient lifecycle and wires the
formal API and exact-ID Worker only after the independent preflight and owner
grant gates. Provider, BOS and database failures remain redacted and
conservative; no retry or second provider POST is possible. BOS and price
evidence are structured, scoped, hash-bound and time-bounded; a boolean or
stale manifest is rejected. Dry-run is the only mode available without those
gates.

## Fail-closed behavior

- Any missing port, unverified snapshot, missing approval, incorrect page/
  revision/ID, missing or unexpected reservation, worker mismatch or final
  result yields an allowlisted `STOP` code and
  `paidExecutionAuthorized: false`.
- Network exceptions, timeouts, unknown provider results and exceptions from
  the injected adapter map to a redacted `I111_EXECUTOR_OUTCOME_UNCERTAIN`.
  No raw error, secret, signed URL, DSN or provider response is returned.
- The coordinator performs no retries and no automatic next slot. The caller
  must never use a successful illustration as authority to start slot 2 or 3.
- Tests exercise all three exact slots only with synthetic data, including
  prior settled fees and no fourth-call path.

## Still required before any real invocation

- Fred's independent code review and merge of this runner change.
- A fresh live preflight and independent review of the exact runtime resources:
  real Docker backend identity, verified one-time owner grant, exclusive
  runtime/DB lock, formal API transaction, locked fresh paid-boundary proof,
  exactly-one reservation, targeted Worker and final read-only verification.
- Explicit approval for original Mac credentials/environment access before
  attempting any real probing; no staging/production side effects.
- Separate authorized zero-fee verification of 900-second private BOS GET and
  provider-side fetch, producing a scoped manifest; no public ACL change.
- Independent Beijing Workspace full price and invoice basis verification,
  covering **two input images plus one output** under the full CNY 2 cap.
- A **new paid operation approval** for exact merged code/resources/limits and
  one invocation. A code `APPROVED` or a green CI does not grant it.
- On success, invoice reconciliation and independent human quality review.

**Forbidden here unless every live gate passes:** launching API/Worker, real Mac
DB/Redis/BOS reads or writes, provider POST, cost settlement, protected fixture
mutation, staging deployment, automatic retry or merging without applicable
human review.

## Test commands

```bash
pnpm i111:trusted-runner
pnpm test:i111-trusted-runner
pnpm test:preflight
pnpm lint
pnpm typecheck
pnpm format:check
```

No migrations, new dependencies or production behavior changes are included.
