# ADR — Private BOS picture-book playback / 私有图片安全读取

Status: Proposed; requires independent Fred/security approval before merge or rollout.

## Context

The image worker records a plain unsigned HTTPS URL after a BOS upload. A
private staging bucket returns 403 to anonymous WeChat image requests. Making
the bucket public would expose potentially sensitive children's imagery.

## Decision

Reuse existing consumer auth + picture-book ownership checks in API read
models. For owned READY `BAIDU_BOS` media under `picture-books/`, return a
**300-second GET pre-signed URL**, issued on the API server with scoped BOS
credentials. Validate the configured private bucket origin, canonical object
path and signed URL host. Fail closed if signing is impossible, rather than
returning the bare database object URL. Do not persist signed URLs.

All affected authenticated picture-book GET responses use
`Cache-Control: private, no-store`. Legacy or cross-bucket BOS assets are not
automatically signed using the staging bucket. The image Worker remains
unchanged. No DB migrations or paid AI requests are part of this PR.

## Operator prerequisites / 验收前置条件

- `xiaohai-staging-worker` currently has `PutObject` only. Add scoped
  **GetObject** for `xiaohai-staging-assets` object paths; do not grant
  `BOSFullControlAccessPolicy` or public-read access to the bucket.
- The API and Worker must receive separately authorized staging BOS secrets.
  Never put AK/SK in Mini Program or GitHub source.
- Allowlist the **actual signed BOS hostname** in WeChat's image/download
  domains, then verify on iOS and Android devices. A green CI is insufficient.
- The signed URL is a 5-minute bearer capability: never log or paste the query
  string, and reload API metadata to refresh it after expiry.
- An approved synthetic image should be uploaded/retrieved for a real
  non-paid smoke. Image generation stays OFF, and historical spend budgets
  must not be reset or reinterpreted.
- This does not cover unrelated CMS/animation media surfaces. Existing public
  assets in another bucket require separately reviewed handling.

## Verification / No-go

Automated tests check expiry, missing secrets, cross-bucket records, malicious
paths, forged signer results, and fail-closed fallback. Existing API
integration tests verify ownership of picture books and references; independent
review should verify unauthorized-user denial with private BOS assets.
No deployment, release activation, DB mutation or production migration is
authorized simply by merging this PR.
