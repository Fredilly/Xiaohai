# Integration Preflight / 集成发布预检

Issue: #115

## Purpose

This gate unifies release checks before an owner-approved paid image smoke test. It reuses the already-merged reliability and budget work instead of duplicating it.

It does **not** enable production AI, raise any budget, change provider/model defaults, or make a paid request.

## Command

```bash
pnpm build
pnpm preflight:release
```

The release preflight performs:

1. the #106 image preflight:
   - stale/missing config, DB and Worker build outputs
   - Drizzle migration file validation
   - latest repository migration applied to the configured database
2. Mini Program staging API validation:
   - HTTPS required
   - localhost/127.0.0.1 rejected
   - `.invalid` placeholder domains rejected
3. paid-image configuration validation:
   - Bailian image mode explicitly enabled
   - server-side budget gate explicitly enabled
   - per-request reservation + global/consumer limit configured as positive safe integer minor units; reservation no greater than either cap
   - public BOS origin present
4. live dependency probes:
   - `GET <staging-api>/ready` must report `{ status: "ready" }`
   - `HEAD BOS_PREFLIGHT_OBJECT_URL` must succeed
   - BOS smoke URL must be stable/public, use the configured public origin, and have no query/hash
5. no AI provider call is made by the preflight itself.

## Existing evidence reused by this issue

### Image path / #106

Merged PR #120 froze the known working provider → BOS → DB → API → Mini Program path with deterministic regressions and a manual image preflight.

### Budget protection / #101 and #118

The existing PostgreSQL integration suite already verifies:

- atomic/idempotent reservation and settlement
- cumulative hard cap rejection
- two concurrent consumers competing for the remaining global budget: only one reservation succeeds
- uncertain provider exposure blocks further spend
- per-consumer windows settle independently while global actual spend is shared
- conflicting confirmation replay is rejected without mutating settled state
- missing/under-reserved windows fail closed and roll back settlement

This issue does not duplicate that implementation.

## Current staging prerequisites (after PR #171)

PR #171 merged the Mini Program configuration fix from #76: `develop` and
`trial` now point at `https://staging-api.pamboo.asia`. The `release` domain
remains deliberately blocked (`.invalid`) pending separate production approval.

This is **source configuration only**, not proof of WeChat request-domain
allowlisting, iOS/Android device connectivity, actual `/ready` health or BOS
object reachability. The preflight must be run against an **authorized staging
environment** after an operator provides the non-secret configuration values
and a safe **read-only** DB migration-status check. Device test evidence stays
under #32/#76.

The preflight additionally requires positive **safe integer** cost estimates
in minor units; per-image reservation must not exceed the configured global
or consumer cap. Invalid, zero, fractional, negative or imprecise amounts fail
closed. This is configuration validation and does not replace the transactional
budget enforcement confirmed separately in #118.

A green mocked CI run is **not** authorization for real paid generation.

## Secrets and logging

The preflight reports configuration **names and pass/fail state only**. It does not print API keys, BOS credentials, private prompts, signed URLs, or provider response bodies.

`BOS_PREFLIGHT_OBJECT_URL` must be a public non-signed object URL with no query string or fragment.

## Real smoke test status

No new real-provider request is authorized or performed by this work.

One limited real smoke test remains an owner-approved acceptance step only after:

- #76 staging HTTPS is complete
- `pnpm preflight:release` passes
- production paid generation remains disabled except for the explicitly approved test window

Record only redacted cost/accounting metadata and visible WeChat evidence. Never paste credentials, signed URLs, prompts, or provider response bodies into GitHub.
