# Xiaohai staging deployment (Issue #76)

This deployment is **not live** until DNS, secrets and first-time server setup are performed and verified. Do not set STAGING_READY=true prematurely.

Target: purchased Ubuntu 24.04 Hong Kong VM, 2 vCPU / 4 GiB. Only public ports 80/443; SSH 22 must be restricted after a working key login is tested. PostgreSQL and Redis have no published ports. This is **staging only**.

## First-time operator checklist

1. Protect SSH with key authentication and restrict source; retain verified console recovery access. Install Docker Compose (already done).
2. Set `staging-api.pamboo.asia` A record to the approved server address; confirm authoritative DNS and TLS via Caddy.
3. Place `~/xiaohai-deploy/staging.env` on server (mode 600). Do **not** commit it. Supply random, unique POSTGRES_PASSWORD and POSTGRES_USER/POSTGRES_DB; DATABASE_URL must point to postgres:5432 with matching URI-encoded credentials, REDIS_URL=redis://redis:6379, HOST=0.0.0.0, PORT=3000, APP_ENV=staging, NODE_ENV=production. Use `.env.staging.example` as the comprehensive starting list. Disable WECHAT_PAY_ENABLED, STORY_AI_ENABLED, PICTURE_BOOK_IMAGE_ENABLED and other paid providers. Inject distinct session secrets; never use development credentials.
4. Build a one-time recovery-tested database backup plan. The VM only has 50 GiB; monitor free space. Confirm migrations with a backup using the existing `pnpm --filter @xiaohai/db db:migrate` command before normal API traffic. Current workflow intentionally does **not** perform automatic schema migrations.
5. Configure GitHub environment `staging` secrets STAGING_SSH_HOST, STAGING_SSH_USER, STAGING_SSH_PRIVATE_KEY (dedicated restricted deploy key), and repository variable STAGING_READY=true **only when steps above are complete**. Pin the VM SSH host key out-of-band in future hardening; ssh-keyscan alone does not authenticate the host.
6. On a successful `main` CI run, workflow builds immutable SHA-tagged GHCR images and starts containers. Check `https://staging-api.pamboo.asia/health`, `/ready`, migrations, logs, and worker. Do not interpret HTTP health alone as end-to-end acceptance.
7. In WeChat management, authorize staging HTTPS request domain and run an actual-device test. Never substitute LAN/127.0.0.1 testing for this release gate.

Production must use separate compute, database, volumes, secrets, domain, and a manual protected GitHub environment approval. **Do not deploy production from this staging workflow.**

## Risks before enabling workflow

- For private GHCR packages, the ephemeral GITHUB_TOKEN used by this workflow must be authorized to pull them from this repository. Test registry permissions once.
- The first build currently retains workspace dev dependencies in the image to support migrations. Optimize after validation.
- CPU and memory are modest: measure concurrent API/worker/Postgres/Redis footprint.
- Rollback is by restoring the previous `REVISION` in `revision.env` and rerunning Compose. Schema changes require a separately approved rollback plan.
- No cloud resources, DNS or secrets are modified by merging this PR alone while STAGING_READY remains false.
