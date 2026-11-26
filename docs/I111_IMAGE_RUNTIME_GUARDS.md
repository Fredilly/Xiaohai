# Issue #111 — Paid-image runtime safety gates (code-only)

This PR fixes two structural prerequisites, NOT the full paid-run safety gate.
No API/Worker may be started for paid image generation solely because these
guards are merged. No provider access, database migration, image generation,
BOS mutation or configuration enablement is authorized by code review.

## Fixed endpoint scope

For Qwen Image 3.0 (qwen-image-3.0 and qwen-image-3.0-pro), both
loadServiceConfig (API) and loadWorkerConfig reject BAILIAN image-enabled
configuration unless:

- DASHSCOPE_WORKSPACE_ID matches the intended workspace identifier
- PICTURE_BOOK_IMAGE_BASE_URL is exactly HTTPS at
  <workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
- No URL credentials, unexpected port, query, fragment, alternative region,
  or generic/global endpoint may appear

The image flags are OFF by default. This does not change model defaults,
expose credentials or modify unrelated AI features.

## Signed BOS reference lifetime

The private Worker reference URL is an SDK-generated bearer GET capability.
The signed TTL is now 900 seconds, for a minimum Worker provider deadline
of 600,000 milliseconds plus 120,000 milliseconds of safety margin.

The invariant is checked in API and Worker config and at ImageJobProcessor
construction for BAILIAN. A configured picture-book image timeout greater
than 780,000 milliseconds is rejected. Invalid values fail before a paid call.

The previously accepted Mac-side signed GET 200 evidence used the old
300-second TTL. It cannot prove this new 900-second signer has passed a
real GET or that Bailian can fetch a private reference from its own service.
That requires separately approved zero-paid runtime preflight.

## What remains STOP (not fixed by this PR)

- Durable three-call hard gate: a 200-fen monetary cap is not a three-call
  counter. The ordinary API can create new revisions, and generic Worker
  can process eligible queued jobs. A persisted atomic count, exact
  page/revision allowlist and one-shot execution are still required,
  counting failed, timeout and unknown provider calls.
- Price and AT_RISK: at reported Beijing rates, two input references
  and one output are 2 × CNY 0.02 + CNY 0.18 = CNY 0.22 per successful call,
  not 0.18. Verify current rates and complete actual billing, never assume
  the output-only rate. A 25-fen reservation does not guarantee a hard
  200-fen external bill ceiling.
- One-shot runner and preflight: no exact three-task allowlist, verified
  independent durable attempt count, AT_RISK-aware stop or no-fallback
  runtime executor has yet been installed.
- Remote provider fetch: local Mac signed GET 200 for Mimi/Pip passed,
  but Bailian service-side image fetch is NOT VERIFIED.
- If the 200-fen cap includes BOS traffic/storage, those charges are
  outside the current model-cost ledger and need separate budget scope.

## Independent gates before paid action

1. Review exact PR diff and latest-head green CI, then obtain Fred APPROVED;
   merge approval is not runtime authorization.
2. Implement durable 3-attempt / exact-allowlist one-shot runner, cost
   accounting and no-spend preflight in independently reviewed code.
3. Verify original Mac isolation and backup; new DB migration (if needed)
   requires a separate code review and operation approval. Never silently
   migrate or overwrite the already-created three storyboard pages.
4. Verify Beijing Workspace actual rates, balance, complete cost snapshot,
   budget/AT_RISK state, API and Worker settings without exposing secrets.
5. Obtain a fresh paid authorization tied to the reviewed code, exactly
   three planned attempts and total CNY 2 cap; stop after each result
   until the charge is reconciled and never auto-retry.
6. Complete independent human side-by-side picture quality review.

Keep Issue #111 OPEN. Do not start the generic Worker, re-run the prior
storyboard fixture apply, reimport reference images or change BOS ACL.
