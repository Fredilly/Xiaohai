# Issue #111 — Isolated existing-reference PNG import acceptance runbook

## Purpose and boundaries

This PR adds a deliberately **disabled-by-default**, **dev-only** route to import
an owner-supplied character-reference PNG **only into an isolated #111 database
and dedicated BOS bucket**. It solves the missing link between approved Mimi/Pip
candidate assets and the existing Character Bible selection/confirmation workflow.

- No provider call or AI charge occurs during PNG import.
- No automatic character confirmation or reference selection occurs.
- The ordinary Qwen image-generation path, prompt, Worker retries and budgets remain unchanged.
- No deployment to staging or production is approved.
- Do **not** use the existing `xiaohai-prod-assets` bucket, shared PostgreSQL,
  shared Redis, or existing persistent Docker volumes.

## Required prerequisites (STOP if any is unknown)

1. Obtain Fred's review of this PR, latest-HEAD CI, and explicit permission for
   the **dedicated** local test migration/rollout. Merging code is not approval
   to run a migration on a shared server.
2. Provision fresh, independently identified disposable PostgreSQL and Redis,
   with private loopback-only ports, no shared volumes and documented owner/cleanup.
   The connected DB must have a unique name matching `xiaohai_i111_[a-z0-9_]{8,32}`;
   both the configured URL and the live `current_database()` value are verified
   before the import route is enabled. No remote/shared DB endpoint is permitted.
3. Provision a **separate** BOS bucket matching `xiaohai-i111-<unique-test-id>`.
   The same bucket must be configured for the isolated API and Worker. Never
   change the credentials or bucket of an existing API/Worker.
4. Provide the exact owner-approved PNGs: Mimi SHA-256
   `a50abb6b7195a2be7886b47351f259c930aca36ebacec500b6fbfab65136f304`,
   Pip SHA-256
   `af3845b30a28a82c7cbcc491b76c1291355009c347274437ff23968ee144c06d`.
   Confirm the source image appearance, size, and no extra character/text.
5. Validate the isolated DB target and schema journal before *any* migration.
   Migration `0041_character_reference_import_provider` only widens the
   character-reference provider CHECK to allow truthful `IMPORTED` provenance.
   It never rewrites existing references.

## API activation (isolated dev instance only)

Use managed environment secrets; **do not post values, signed URLs, token, or
raw image bodies into GitHub/logs**.

- `APP_ENV=dev`
- `PICTURE_BOOK_REFERENCE_IMPORT_DATABASE_NAME=xiaohai_i111_<unique_test_id>`
- `DATABASE_URL=postgres://<isolated_credentials>@127.0.0.1:<isolated_port>/<exact_database_name>`
- The database name in the URL must match the explicit name above **and** the
  live connection's `current_database()`. Any mismatch disables the import.
- `TEST_DATABASE_URL` must be absent outside `NODE_ENV=test`; in tests it must
  be exactly equal to the allowlisted `DATABASE_URL`.
- `PICTURE_BOOK_REFERENCE_IMPORT_ENABLED=true`
- `NODE_ENV` must not be `production`
- `BAIDU_BOS_BUCKET=xiaohai-i111-<unique-test-id>`
- `BAIDU_BOS_ENDPOINT` must be the approved HTTPS BCE BOS endpoint.
- `BAIDU_BOS_PUBLIC_ORIGIN` must be exactly
  `https://<bucket>.<endpoint-host>/`.
- Credentials must be scoped to the dedicated bucket only.
- Do not reuse a production `.env`; isolate DB, Redis, session secret and
  non-production provider configuration.

Route:

`POST /api/v1/ai/picture-books/:bookId/characters/:characterId/reference-images/import`

Requires a genuine consumer bearer session and the existing picture-book owner
identity. JSON body: `{ "imageBase64": "<base64-encoded PNG bytes>" }`.
The API refuses payloads over 4.5 MB, validates 8-bit RGB/RGBA PNG framing,
dimensions, CRC and size (at most 3 MiB), and requires a successful isolated BOS
PUT plus HEAD before inserting **READY** rows.

An idempotent content-based key is generated under
`picture-books/character-references/i111/<consumer>/<book>/<character>/<sha256>.png`.
Repeated imports for a still-unlocked character reuse an existing revision with
the same key. The revision records provider `IMPORTED`, model
`OWNER_SUPPLIED_PNG`, and a linked real `BAIDU_BOS` media row.

The route **does not auto-select**. Call the already-existing owner-scoped
reference select route, and then the existing Character Bible confirm route
only after both characters have verified READY assets. Do not forge READY rows.

## Evidence and failure cases

- Check 401 (missing session), 404 (other owner's book), 400 (bad bytes),
  409 (locked/active generation), 503 (feature disabled), 500 sanitized
  (BOS PUT/HEAD failure). No user-supplied object key or URL is accepted.
- Confirm the BOS object really exists through scoped HEAD and the existing
  playback signing path; never enable anonymous public reads.
- If BOS succeeds but the DB transaction fails due to a race or outage,
  the orphan object may remain **only inside the dedicated bucket**. Record
  its exact key and review ownership before cleanup; never globally delete
  prefixes or unrelated objects.
- The imported reference is distinct from a paid provider-generated image.
  Neither `IMPORTED` nor a simulated success is evidence of completed #111
  three-image visual acceptance.

## Migration and rollback

Only on the approved disposable database, with backup/restore procedure
documented by the operator: review `0041` migration SQL and journal, use
the repository's standard migration runner, and verify existing rows continue
to satisfy the new constraint. Do not run migrations against staging/production.

Application rollback: disable `PICTURE_BOOK_REFERENCE_IMPORT_ENABLED`,
stop only the isolated API/Worker, and leave historical imported revisions
for explicit owner-reviewed cleanup. Schema rollback (isolated DB only) requires
confirming **no `IMPORTED` rows exist**, then restoring the prior CHECK
`provider IN ('MOCK','BAILIAN')`. Do not silently delete imported history.

Retain the two verified reference PNGs and eventual three-image review evidence
until the owner completes quality scoring. Then clean up **only resources proven
to have been created for #111**, never pre-existing services.

## Paid test remains a separate gate

After the reference import, full build, preflight:image, migrations, current
workspace price, global/user budget headroom, and outstanding AT_RISK
reservations must all be verified. Only then may the previously authorized
fixed **three-call qwen-image-3.0** evaluation proceed, no automatic retry,
hard total **¥2**; failed/unknown calls consume a slot and stop the run.
