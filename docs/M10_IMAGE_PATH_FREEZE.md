# M10 Image Path Freeze / 绘本图片链路冻结

Issue: #106

## Proven real smoke evidence

The product-owner evidence recorded on 2026-10-08 proves one controlled path only:

- explicit cover regeneration
- provider generation completed
- permanent Baidu BOS media was persisted
- the revision reached `READY`
- the image rendered in local WeChat DevTools
- accepted revision: 4

This is evidence for one provider → BOS → DB → API → Mini Program path. It is **not** proof of all-page completion, character consistency, image quality, real-device HTTPS staging, or production readiness.

Freeze baseline before this issue: `9c2ceb95c277acd96c7a0467b6229217642e5dd8`.

No new paid provider request is required by this freeze work.

## Frozen non-secret configuration surface

Do not commit or print secret values. The image path is controlled by these non-secret configuration names:

- `PICTURE_BOOK_IMAGE_ENABLED`
- `PICTURE_BOOK_IMAGE_PROVIDER`
- `PICTURE_BOOK_IMAGE_MODEL`
- `PICTURE_BOOK_IMAGE_TIMEOUT_MS`
- `PICTURE_BOOK_IMAGE_BASE_URL` (region-matched workspace endpoint; value remains environment-owned)
- `DASHSCOPE_BASE_URL` (fallback endpoint; value remains environment-owned)
- `BAIDU_BOS_ENDPOINT`
- `BAIDU_BOS_BUCKET`
- `BAIDU_BOS_PUBLIC_ORIGIN`
- `PICTURE_BOOK_IMAGE_BUDGET_ENABLED`
- `PICTURE_BOOK_IMAGE_BUDGET_KEY`
- `PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR`
- `PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR`
- `PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR`
- `PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY`

Secret configuration such as API keys and BOS credentials must stay server-side and is intentionally omitted here.

## Deterministic regression gates

The frozen behavior is covered without real provider charges:

- API integration: active `QUEUED/RUNNING` requests reuse the existing revision; terminal `READY/FAILED` ordinary requests return a state conflict; explicit regenerate creates a new revision.
- API read model: only a `READY` media asset exposes its playback URL.
- Worker integration: a Bailian-compatible mocked result is invoked exactly once, persists a permanent `BAIDU_BOS` HTTPS media asset, links `mediaAssetId`, and reaches `READY`.
- Worker integration: terminal failures persist `FAILED` and do not create a false READY asset.
- Worker recovery: stale RUNNING work is marked terminal once; recovery does not auto-regenerate or create a paid retry.
- Budget integration: Bailian work must have a reservation before provider invocation and settlement remains scoped to the owning consumer plus GLOBAL window.

## Paid-job preflight

Before any explicitly approved real image generation:

1. Run `pnpm build`.
2. Run `pnpm preflight:image`.
3. The preflight fails closed when the config/db/worker build outputs are missing or older than source.
4. The preflight runs `drizzle-kit check` and verifies the current database has applied the latest repository migration.
5. The preflight makes **no provider request**.

If preflight fails, fix the reported build or migration issue first. Do not compensate by retrying a paid image job.

## Mini Program polling contract

The Worker enforces a 600-second minimum image deadline. Mini Program image/reference polling therefore waits 620 seconds, giving the Worker deadline plus network/API slack. Polling observes the accepted revision only; it does not issue an implicit regenerate request.

## Still outside this issue

The following remain separate gates:

- #111: character identity, style consistency, text artifacts, quality/cost comparison.
- #112: full picture-book preview/save/export UX acceptance.
- #115: staging/HTTPS/environment-wide integration preflight.
- Production enablement or any new paid smoke test requires explicit owner approval.
