# Issue #111 — Offline-only one-shot policy foundation

This module is **NOT a paid runner**, must not start API/Worker, and cannot
authorize any external provider action. It only inspects an untrusted,
classified in-memory snapshot and returns allowlisted STOP codes or
\`STATIC_REVIEW_ONLY\`. **\`paidExecutionAuthorized\` is always false.**

- \`scripts/i111-one-shot-policy.mjs\`: fixed #111 Mac Plan B scope and a
  pure policy for book/pages/owner, two locked private character images,
  previous settled calls and costs, approved SHA parity, isolation,
  budget, no retry, 900s signing and image timeout.
- \`scripts/i111-one-shot-policy.test.mjs\`: pure negative tests,
  max-three order, and a source consistency check against the existing
  production gate constants. No credentials, DB, model or network I/O.

This is a **separate, preparatory code review task**. It is not integrated
into the live Worker and does not accept CLI flags for paid execution.

## Still required before a one-shot executor is implemented

A separately reviewed CLI must read actual trusted runtime state and the
original Mac Plan B database **read-only**, verify unchanged backups and
reference fingerprints and confirm credentials without logging them.
It must use the normal API reservation/ownership transaction and the
strict single-target dev Worker path; never the normal Worker loop.
Its exact one-use authorization must be separate from this PR. The
900s SDK signed GET and Bailian service-side private-image fetch remain
unverified. Cost invoices (two inputs plus one output), AT_RISK status
and hard CNY 2 budget must be reconciled before a later slot.

Nothing here changes \`main\` by itself, deploys, imports old pictures,
reapplies the storyboard fixture, modifies the protected Mac database,
uses BOS, or starts paid image generation. Issue #111 stays OPEN.
