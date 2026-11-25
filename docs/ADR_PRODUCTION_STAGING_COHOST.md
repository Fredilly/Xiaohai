# ADR: Owner-selected shared ECS for Staging and Production (2026-11-25)

**Status: owner topology decision recorded; implementation code only, NOT approved for live activation.**

## Context and decision

The original deployment policy in `deploy/README.md` requires **separate production compute**, in addition to separate data, credentials, volumes and domains. The owner now explicitly chooses to **reuse the existing Alibaba Cloud ECS** for Staging and the three proposed production origins (`api.pamboo.asia`, `store.pamboo.asia`, `admin.pamboo.asia`). The owner additionally reports a **planned separate website** `orientalsourcepress.com`, domain already purchased but not confirmed as currently serving traffic; its application deployment and ingress rules are not yet provided.

This is an explicit change to the infrastructure topology, **not** to the isolation of business data or authorization to manipulate live services. Capacity and shared ingress become common-failure domains. Keep production and staging Compose projects, PostgreSQL/Redis instances, immutable volumes, environment files, application credentials and deployments separate; share only the necessary HTTPS ingress container and a limited Docker edge network.

## Implementation option (disabled by default)

- `production-cohost.compose.yml` is a **distinct Compose project**. It creates only dedicated production DB/Redis volumes, no migrations, and no published host ports; the production worker and database cannot join the shared edge network.
- The existing staging Compose and Caddyfile remain the **default**. `staging-cohost.override.yml` is opt-in and attaches **only** the staging proxy to the externally created `xiaohai-production-edge` network. This bridge must be `internal: true` at the Docker level.
- `Caddyfile.cohost` imports the original staging site configuration and an **operator-owned read-only `Caddyfile.preserved`** containing all other pre-existing website routes, then adds exactly the three new production hosts. The additional site's unknown details fail the live cutover gate; never replace its routing by inference.
- A persistent operator-created `cohost.enabled` marker selects the override for later staging CI deployments. With no marker, normal staging remains unchanged; if production containers exist without the marker, staging deploy refuses to proceed instead of silently disconnecting production HTTPS.
- `production-cohost-preflight.mjs` checks exact revision pins, separate credentials/local data endpoints, payment/food OFF and explicit evidence flags. It cannot verify the real server and **never authorizes** operations.

## Residual risks and required decision gates

1. **Small host capacity and common failure:** the staging runbook records 2 vCPU / 4 GiB RAM / 50 GiB storage, which may be inadequate for two Node backends, workers, two PostgreSQL, two Redis, web and Caddy. Inspect live memory, disk, inodes, performance, resource contention and usable backups; STOP if there is insufficient independently reviewed headroom.
2. **Other website:** preserve the reserved independent `orientalsourcepress.com` hostname and ascertain whether it has become active at cutover time; obtain the ingress owner's live rules for it and any other site. Do not route this domain to Xiaohai or claim it is already online. Inspect live proxy config read-only and validate final Caddy config before any restart. Do not rely on tracked files alone to represent live ingress.
3. **Isolation is weaker than separate compute:** shared kernel/Docker daemon, common Caddy certificate store and a shared host failure remain; a proxy compromise could affect both environments. Fred must independently audit the exception and security controls before launch.
4. **Release gates stay independent:** human review of immutable code plus separately bounded production/shared-Staging operation authorization, production secret management, database backup and rehearsed restore, migration-owner approval, DNS/TLS, WeChat AppID and true-device verification, and operational UAT are still required. Existing Staging approval does not grant production approval.
5. **Image retention cross-talk:** the same API/Worker image repositories can contain production rollback revisions with no running containers. Legacy staging-only retention is disabled whenever cohost is active or any production containers exist, until a separately reviewed multi-environment policy protects all current/rollback/HOLD revisions and the other site's dependencies. No cleanup is implicitly authorized by this decision.

See `deploy/PRODUCTION_COHOST_RUNBOOK.md` for the exact fail-closed handoff. No production deployment, DNS change, live Caddy restart, database initialization, migration or real inventory/payment action occurred as part of this ADR.
