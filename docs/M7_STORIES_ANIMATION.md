# M7 Stories & Animation

## Completed
M7 establishes browse/search/category filtering, series and episode detail, FREE/PREVIEW/PAID access modes, server-side entitlement resolution, provider-neutral media metadata, playback access, progress/resume, continue watching, entitled-content listing, and Staff content/media management APIs. It does not start M8 AI.

## Files Changed
Adds the Media/Stories database schema, migration, shared content contracts, API service/routes, Mini Program content service and list/detail/playback pages, contract tests, and this milestone document. API and DB composition are extended without changing M4-M6 business semantics.

## Database Changes
`media_assets` stores provider-neutral metadata/reference only; binaries remain outside PostgreSQL. `animation_series` and `animation_episodes` model publication and access. `content_entitlements` is a generic one-time/admin/migration grant foundation without inventing subscription rules. `playback_progress` is unique per consumer+episode and supports resume/continue watching. Constraints enforce valid publication/media/access states and PREVIEW boundaries.

## API/contracts
Public: `GET /api/v1/content/series`, `GET /api/v1/content/series/:id`, `GET /api/v1/content/episodes/:id/playback`. Consumer Session: `PUT /api/v1/content/episodes/:id/progress`, `GET /api/v1/content/continue-watching`, `GET /api/v1/content/my-entitlements`. Staff: list/create/update series, create episodes and media metadata under `/api/v1/staff/content`.

## Mini Program/Admin behavior
Mini Program provides browse/search, detail with free/preview/locked states, native video playback, preview stop boundary and progress reporting/resume. Locked paid content does not fabricate a purchase/subscription flow. Staff management is API-ready under `content.manage`; production object-storage upload UI/provider integration remains intentionally unimplemented until storage is selected.

## Security & Permissions
Consumer ownership always comes from verified Consumer Session. Entitlements and playback progress are server-resolved; clients cannot submit entitlement or price decisions. Staff mutations require Staff Session + `content.manage` + server-derived GLOBAL Data Scope. Unpublished series/episodes are excluded from public queries. Disabled/unready media fails closed. Media URLs are metadata references; production should use short-lived signed URLs or controlled CDN tokens once the provider is selected.

## Tests
Contract tests cover PREVIEW boundary and invalid progress. Existing CI should run repository lint/typecheck/tests and migration-from-zero. Real PostgreSQL integration coverage for ownership isolation, entitlement resolution, progress upsert and staff authorization remains required before M7 can be called production-complete.

## Known Issues
No production object-storage/CDN provider or signed-URL adapter is configured. Admin Web UI is not yet wired in this commit; staff APIs are present. Mini Program real-device video/domain behavior is not yet validated. This execution environment cannot clone/install dependencies, so pnpm/Prettier/PostgreSQL checks were not run locally and must be validated by CI.

## Decisions Needed
Animation purchase/subscription model remains explicitly unresolved by PRD. This implementation does not define memberships, packages, prices or entitlement purchase rules. Production storage/CDN provider, upload validation limits, signed URL/token lifetime, media transcoding/derivatives, copyright/moderation policy and retention/deletion rules also require decisions.

## External media/CDN requirements
Production requires private object storage, CDN, HTTPS Mini Program-allowlisted domains, upload MIME/signature/size validation, randomized object keys, malware/moderation controls where applicable, short-lived playback authorization, lifecycle/deletion and CDN invalidation. No vendor is selected or hard-coded.

## Next Step
Run CI and fix only M7 failures. Complete PostgreSQL integration/security tests and Admin Web management UI, then perform DevTools/real-device playback validation. Do not begin M8 until M7 review/merge and unresolved commercial/media decisions are handled.
