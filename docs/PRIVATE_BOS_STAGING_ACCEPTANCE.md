# Private BOS picture-book staging smoke / 绘本私有图片预发验收

Status: **NOT VERIFIED** until an authorized staging operator records redacted evidence.
Issue: #115; release gate: #116; implementation: PR #173.

## What this checks

The read-only `pnpm preflight:private-bos` script makes exactly three HTTP GET
requests for **the same non-sensitive synthetic PNG** under `picture-books/`:

1. Unsigned URL → **403** (bucket must not allow anonymous reads).
2. Valid, freshly signed GET URL → **200** and `Content-Type: image/png`.
3. Independently generated, already expired signed GET URL → **403**.

It rejects mismatched bucket/object paths, non-HTTPS/foreign hosts, missing
signatures, redirect responses, unexpected status or MIME and network errors.
The expired-link result assumes the operator produced a correctly signed URL
whose expiration is in the past; an HTTP 403 alone cannot distinguish expiry
from an invalid signature. Record that generation method in private operator
evidence, never the signed URL itself.
It never requests an AI image, uploads data, writes to DB, or prints URL queries,
credentials, response bodies, or image contents. Unit tests use mock fetch.

## Prerequisites / 操作前

- Use **staging only** with an explicitly approved synthetic image already
  uploaded under `picture-books/`. Do not use user/children's work.
- Owner/security must approve **object-scoped** `GetObject` for the staging
  API identity; never grant public-read or BOSFullControl. The worker's
  `PutObject` permission alone does not authorize image retrieval.
- Generate a valid 300-second GET signature and a **separate expired**
  signature for the same object with the approved BOS SDK and test identity.
  Do not print/paste URLs in an issue, CI log or chat. Never commit a signed URL.
- Provide these variables only in the operator's private environment:
  `BAIDU_BOS_BUCKET`, `BAIDU_BOS_ENDPOINT`,
  `BAIDU_BOS_PUBLIC_ORIGIN`,
  `BOS_PRIVATE_SMOKE_UNSIGNED_URL`,
  `BOS_PRIVATE_SMOKE_SIGNED_URL`,
  `BOS_PRIVATE_SMOKE_EXPIRED_URL`.
- Ensure the actual signed URL host is on the WeChat allowed request/download
  domain list as applicable; do not guess it from a sample URL.

## Run / 执行

From repository root, on the approved staging operator workstation:

```sh
pnpm test:preflight
pnpm preflight:private-bos
```

The command returns 0 only when all three GET checks pass and prints only
test names and PASS. Any missing credentials, target mismatch, public bucket,
expired-link success, missing object, or unexpected response returns nonzero.
A failure is **NO-GO** for private playback staging acceptance.

The three object URLs are ephemeral bearer capabilities: keep them out of the
shell history, GitHub Actions logs, screenshots and tickets. If the valid
signature expires before the probe starts, generate another one. Do not
increase TTL or relax authorization to make the test pass.

## Separate acceptance still required / 仍需单独验证

- Consumer A can see owned READY cover/page/character image; Consumer B
  cannot obtain A's private media URL via API. Logged-out access fails.
- The Mini Program refreshes API metadata after the 5-minute URL expires.
- Real iOS and Android device checks of actual signed hostname,
  image display and weak-network handling.
- Redacted result sheet: PASS/FAIL/NOT TESTED for the three GET outcomes,
  object/bucket scope, effective IAM policy, anonymous denial,
  ownership denial, WeChat domains, iOS, Android, expiry refresh.
- Only the system owner can approve the staging rollout. The owner must
  separately authorize any paid AI test; keep provider switches and
  budgets unchanged.

Passing this script is **not** staging release approval, production deployment,
database migration or an AI-cost authorization.
