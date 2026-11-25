# Production web domain handoff (code-only)

User-provided intended web hostnames (2026-11-25):

- Store Web: `https://store.pamboo.asia`
- HQ Admin Web: `https://admin.pamboo.asia`

This **does not** confirm DNS ownership records, issuance of TLS certificates, access to a server, or a deployed application. The **production API hostname is still unconfirmed**. `https://api.pamboo.asia` in tests is only an illustrative value, not a configured or approved endpoint. The Mini Program release continues to fail closed with `https://api.example.invalid` until the actual API origin, WeChat console request domain and real-device readiness are confirmed.

## Prepared artifacts

- `Dockerfile.production-web`: builds both TypeScript/React sites from one audited source revision; embeds _same-origin_ `/api` access (`VITE_API_BASE_URL=""`), serves compiled files from Caddy only, no Node runtime or secrets in the final web image.
- `Caddyfile.production-web`: automatic HTTPS for the two named sites. Each routes `/api`, `/api/*`, `/health`, `/ready` to the **explicitly supplied separate production API** and serves its own SPA, without an accidental Vite development or staging proxy.
- `production-web.compose.yml`: an isolated web-only Compose project. It has no PostgreSQL/Redis/worker/API containers or staging volumes. It expects `WEB_REVISION` and `PRODUCTION_API_UPSTREAM` to be set; it does **not** itself deploy production.
- `scripts/production-web-preflight.mjs`: read-only local config validation; rejects placeholder, insecure, staging or self-referential API origins and unpinned revisions.

## Human-operated readiness gates

1. Confirm the **actual** production API hostname and dedicated production API infrastructure. Do not reuse `staging-api.pamboo.asia` or its database, secrets and volumes. Record a separately reviewed source SHA and restore strategy.
2. Point `store.pamboo.asia` and `admin.pamboo.asia` DNS records to an approved **isolated** web server. Verify ports 80/443 are free, and avoid binding on a server already exposing staging Caddy. Both web hosts need valid TLS; Caddy obtains certificates only after valid DNS and outbound ACME connectivity exist.
3. Only once independently authorized, check out the exact reviewed commit with a clean working tree; set `WEB_REVISION` to that exact 40-character SHA and `PRODUCTION_API_UPSTREAM` to the verified HTTPS production API **origin**. Run `node scripts/production-web-preflight.mjs` (checks the exact HEAD and cleanliness); then use `docker compose -f deploy/production-web.compose.yml config` as a _render-only_ check. Do not build/start until deployment approval and resource/port prechecks are complete.
4. Verify response routing at both sites: `/` serves the correct application, `/api/v1/...` reaches the production API, `/health` and `/ready` show the production API status, deep links survive refresh, HTTPS and browser requests contain no staging/localhost requests. Confirm Staff RBAC and store scope with authorized test accounts; no real stock/payment mutation during smoke checks.
5. Separately configure the company-authorized WeChat AppID and the confirmed production API domain in the WeChat request/upload/download allowlist. A valid website certificate does not substitute for a WeChat real-device domain check. Keep food writes/checkout and payment switches disabled until their own approval and operational acceptance.

This is only a buildable deployment definition and a safety gate for Fred's independent security review and UI work. It is **not** an authorization to edit DNS, launch Caddy, run migrations, open production checkout or publish the Mini Program.
