# Staging Store Web + HQ Admin Web candidate — #116

**Code-only proposal, NOT DEPLOYED.** Approved domain *names* and using the existing
staging host were operator-relayed from Fred's “yes” on 2026-11-02. This is not
approval to merge the PR, edit DNS/HTTPS or run a live server rollout. Production
hosting and API deployment are separate projects.

## Known domain mapping

| Client | Existing / proposed staging | Future production |
| --- | --- | --- |
| Consumer Mini Program API | `https://staging-api.pamboo.asia` (already live) | `https://api.pamboo.asia` (Fred selected; not verified live) |
| Store staff Web | `https://staging-store.pamboo.asia` (proposed) | `https://store.pamboo.asia` |
| Headquarters Web | `https://staging-admin.pamboo.asia` (proposed) | `https://admin.pamboo.asia` |

Existing `deploy/staging.compose.yml` and `deploy/Caddyfile` remain **unchanged**.
The current staging deployment still has only the API hostname, with no web
static sites mounted. This avoids turning every routine main merge into a
new live web rollout. It also avoids adding a new persistent Docker image.

## Architecture and safety

- Both Vite builds set `VITE_API_BASE_URL=''`; all API calls should resolve
  on the same site origin as `/api/v1/...`. Caddy's `/api/*` handler proxies
  to the existing `api:3000` on the private Compose network.
- API-side Staff JWT authentication, roles and store/data scope remain
  authoritative. Two hostnames do **not** themselves isolate staff privileges.
  For negative UAT, verify a Store account cannot access HQ or other stores,
  and a session/token from one UI cannot override server authorization.
- The candidate Caddyfile retains the existing staging API site and adds only
  staging Store/HQ hosts. Each site's `/assets/*` is served as a real asset
  (missing files do not return HTML); other non-API routes use SPA fallback.
  Security response headers disallow framing and content type sniffing.
- Only site assets are mounted into the existing Caddy container, read-only.
  No new image, public DB port, Redis port, server-side write, migration,
  secrets or payment functionality is introduced.
- CI on this PR builds both sites using the audited same-origin base, runs
  read-only Compose and Caddy validation, and uploads **short-lived candidate
  artifacts** for review. No CI/PR job can SSH to staging or activate the sites.

## Operator-owned activation prerequisites (not yet authorized)

1. Fred approves PR HEAD and **separately** authorizes staging activation. Due to
   current staging disk ~76% used with a 70% warning / 85% stop gate, confirm
   root disk/inode headroom and an acceptable static artifact size first; do
   not disable the safety gate or clean unknown Docker files.
2. Domain owner confirms `staging-store.pamboo.asia` and
   `staging-admin.pamboo.asia` DNS records point to the intended staging
   endpoint, TLS issuance is permitted and reaches the real staging server.
   No production hostname may resolve to staging by accident.
3. Obtain **matching, trusted main-SHA** static artifacts from the validated
   workflow. Extract only the generated `dist` contents (never archive
   absolute/parent paths) into two *new* immutable release directories:
   `~/xiaohai-deploy/web/store/releases/<full-sha>` and
   `~/xiaohai-deploy/web/admin/releases/<full-sha>`. Do not overwrite an
   existing current or historical release, and do not delete old releases
   without separate authorization.
4. Within the **existing staging deployment/retention lock** and after the
   existing `staging-disk-gate.sh pre` passes, create checked
   `web/store/current` and `web/admin/current` relative symlinks
   to their matching `releases/<full-sha>` versions. Keep the prior
   symlink targets recorded for rollback.
5. Stage the two candidate files as `staging-web.Caddyfile` and
   `staging-web.compose.yml` in the existing staging deployment directory.
   Validate their exact on-host content and Docker Compose **effective**
   configuration with the **base + overlay** files. Validate Caddy
   configuration without overwriting the active configuration.
   Only after separate operator approval, activate the overlay using
   `docker compose ... -f staging.compose.yml -f staging-web.compose.yml
   up -d --no-deps proxy`; do not recreate API/Worker/Postgres/Redis.
   IMPORTANT: normal API deployment currently invokes the **base Compose
   only**; a future API deploy may revert the overlay, so ongoing orchestration
   must be separately approved and implemented before claiming durable hosting.
6. Verify both HTTPS roots, nested SPA routes, required static assets,
   same-origin `/api/v1/staff/me` negative 401 without a token (and safe
   authorized Store/HQ test accounts), then confirm Caddy, API, PostgreSQL and
   Redis health. A browser's ability to render a login screen is NOT proof
   of authorization/isolation or business operation.
7. If any check fails, stop. Under explicit operator control, restore the
   previous symlinks and previously saved Compose/Caddy configuration, restart
   only the proxy as authorized, and verify `/health`, `/ready` and the
   original staging API route. Do not purge image releases or DB volumes.

**Important unresolved integration item:** the current auto staging workflow
deploys only `staging.compose.yml`; this proposal deliberately does not yet
alter it. The next approved PR/rollout step must coordinate the overlay's
persistence across normal CI-triggered API deploys, with proper dry-run and
rollback tests. Do not regard this validation-only PR as permission to
activate the site or a complete production deployment mechanism.

## Acceptance matrix (all NOT TESTED at the real host)

- [ ] Approved DNS, TLS and read-only static hosting smoke: Store/HQ
- [ ] Store login + logout/session expiry with authorized nonproduction staff
- [ ] HQ login + logout/session expiry with authorized nonproduction HQ account
- [ ] Staff wrong/no token 401 and forbidden store/HQ/cross-store 403
- [ ] Correct inventory/catalog/order read and explicitly approved safe writes
- [ ] UI route refresh and missing asset 404; no leaked credentials in JS
- [ ] Rollback of proxy/site artifacts without changing the API, DB or Worker
- [ ] iOS/Android WeChat flow and separate production API/DB readiness

Do not copy a real AppID Secret, consumer code, staff password, token, real
customer records, payment result or private DB export into issues or CI.
