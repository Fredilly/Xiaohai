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
   - per-request reservation + global/consumer limit names present
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

## Current staging blocker

At the start of #115, `apps/miniapp/config.ts` still maps:

- `develop` → local dev using `http://127.0.0.1:3000`
- `trial` → `https://staging-api.example.invalid`

Therefore a real staging release preflight is expected to fail until #76 provides the real WeChat-allowlisted HTTPS API domain. #115 intentionally reports this blocker instead of silently changing #76 scope.

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
