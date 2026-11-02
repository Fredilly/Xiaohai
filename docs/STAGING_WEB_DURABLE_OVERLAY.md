# Staging web continuity: default-OFF, separate approval required

Depends on the **unmerged PR #198** candidate Store/HQ Caddy and Compose overlay. This
change must not be merged separately before #198 is integrated and reviewed.
Do **not** interpret an approved PR as permission to change GitHub Variables,
execute a staging deployment or activate Caddy.

## Guarded normal deployment

- `STAGING_WEB_ENABLED` defaults to `false`: the existing base-only staging
  deployment path remains intact. Invalid values abort before any rollout.
- When explicitly `true`, the host must already have two separately authorized
  Store/HQ releases from a **successful main CI** and a dedicated, approved
  staging release SHA in `STAGING_WEB_RELEASE_SHA` (40 lowercase hexadecimal).
  The guarded preflight checks both `current` relative symlinks, immutable release
  directories, matching `.xiaohai-release-revision` markers, nonempty index
  files, absence of symlinks inside assets, both config files and an effective
  `base + overlay` Compose check. Missing/inconsistent references abort **before**
  Docker login, API/Worker pull, or revision switch. Capacity and shared lock
  checks happen first. There is never a base-only fallback when enabled.
- If enabled, the remote deploy passes **both** Compose files to `pull` and
  `up -d --remove-orphans`, so later routine API deployments retain web mounts.
  The existing five services and volumes are unchanged.
- An enabled deploy persists a `WEB_STATE=pending` guard in
  `staging-web.active` **before** its potentially activating Compose `up`,
  using a temporary file, atomic rename, and file/directory sync. On success,
  the guard transitions to `WEB_STATE=active`. If SSH/runner/host fails in
  the gap, `pending` remains; both `pending` and `active` block ordinary
  default-OFF deployments until explicit owner-approved reconciliation or
  deactivation (`STAGING_WEB_DEACTIVATION_APPROVED=true`). Guard checks happen
  under the shared deployment lock; no silent base-only fallback.

## Immutable build provenance (build only, no staging deployment)

The `staging-web-release.yml` workflow triggers **only** after successful CI
for a `push` to `main`. It checks out that exact CI SHA, builds both Vite sites
with `VITE_API_BASE_URL=''`, places the SHA into
`.xiaohai-release-revision`, rejects output symlinks and excessive build size,
and uploads 7-day immutable review artifacts:

- `staging-store-web-<40-char-main-SHA>`
- `staging-admin-web-<40-char-main-SHA>`

It cannot use SSH, apply Caddy config, enable flags or write staging files.
The operator must separately download **matching SHA** artifacts from a
successful main CI build, verify their contents and SHA provenance, and create
new **immutable** host release directories (never overwrite existing releases):

- `~/xiaohai-deploy/web/store/releases/<sha>`
- `~/xiaohai-deploy/web/admin/releases/<sha>`

The operator then creates two relative `current -> releases/<sha>` symlinks
under the **existing staging deployment lock**, records old link targets,
checks the 70% warning / 85% block / 4 GiB capacity gate, and asks Fred for
separate authorization before changing `STAGING_WEB_ENABLED` and
`STAGING_WEB_RELEASE_SHA` on the staging environment. The code does **not**
automatically upload artifacts or create host symlinks.

## Safe rollback and stop conditions

Before initial activation, capture the current live proxy mount configuration,
current API revision, both old `current` links (if any), and the prior Caddy
configuration. Keep immutable releases and any previous successful API/Worker
images. If activation fails or either URL/API route or authorization isolation
check fails: **STOP**. An owner-approved rollback holds the same deployment
lock, restores previously recorded links/Caddy config, and restores the
previous base-vs-overlay Compose selection. The `staging-web.active` pending/active guard
must **not** be cleared merely because a deploy failed; disabling an active
web surface needs distinct `STAGING_WEB_DEACTIVATION_APPROVED=true` and an
approved deployment. Verify `/health`, `/ready`, both site URLs, and the
no-token 401 / out-of-scope 403 checks afterward. Do not trigger `prune`,
Docker image deletion, volume removal, database writes, schema migrations,
manual server cleanup or production deployment.

**Remaining live acceptance (NOT TESTED):** DNS propagation and automatic TLS,
real Caddy mount, current and rollback link provenance, disk peaks, nonproduction
Store/HQ account login, HTTP 401/403 isolation, and authorized business flow.
No live activation was performed by this patch.
