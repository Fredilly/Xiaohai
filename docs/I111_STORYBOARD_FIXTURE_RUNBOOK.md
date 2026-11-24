# Issue #111 — one-time isolated storyboard fixture (Mac Plan B ONLY)

This is a DEV-ONLY fixture initialization, not a normal picture-book storyboard
generation workflow. It may only touch the original Mac Plan B isolated database,
not the original checkout, staging, shared systems or production.

## Frozen content and scope

- Book ID: 90d7f77e-ae23-40ef-90b6-a672412c6318
- Owner ID: 11111111-1111-4111-8111-111111111111
- Database: xiaohai_i111_mac_20261116
- Connect from Mac only to 127.0.0.1:52511 as xiaohai_i111_app, with APP_ENV=dev.
- Page 0 COVER reuses the exact page-1 sunrise stream scene. It is not a third generated picture.
- Page 1 CONTENT: 清晨，Mimi 沿着森林溪流散步，Pip 轻轻飞过水面。
- Page 2 CONTENT: 温暖的午后，Mimi 和 Pip 坐在树下，一起分享一张纸质地图。
- Page 2 regeneration is a later illustration revision of this SAME page-2 ID.
- Prompts are generated deterministically from the frozen
  benchmarks/picture-book-quality/FIXTURE.json scenes, locked character clothes
  and bright polished cartoon storybook visual style.
- No AI job is forged: all three new rows have source_ai_job_id=NULL to
  distinguish an isolated test fixture from actual AI STORYBOARD/apply output.
- Exactly three work_pages rows and one DRAFT-to-PLANNED book status transition;
  no other database table may be written, no migration or media operation.

## Code review and operation authority are distinct

User approved preparing this scoped code and, after independent code review and
strict safety checks, a one-time fixture setup. Merge requires latest-HEAD CI
and Fred's independent APPROVED review. Approval to merge is NOT permission to
install a deployment or start a paid model. Before any Mac --apply, operator
must independently verify the reviewed commit/hash, exact host and worktree,
backup and recovery path, and new safe --plan results. STOP if any proof is
missing. Do not force-reset or modify /Volumes/Data/Xiaohai.

## Preflight / plan (default no write)

1. Confirm original detached worktree
   /Volumes/Data/Xiaohai-i111-gate-b has clean tracked files; preserve all
   untracked .i111-plan-b/ secrets, assets and state.
2. Verify original containers, named volumes, localhost port mapping, correct
   app DB identity, 42 migrations, user ownership, exactly two confirmed and
   locked Mimi/Pip references with READY private BOS PNG media. Ensure no
   storyboard page, illustration or active AI job.
3. Ensure API and Worker are stopped. Do not invoke an integration test with
   TRUNCATE, migration or job processing.
4. Take a NEW, restricted (0600), verifiable custom-format backup of only this
   isolated database using the existing verified local tools; do not overwrite
   previous backups. Keep it in .i111-plan-b/evidence/ with directory 0700.
   Verify pg_restore --list and checksum, plus a documented recovery command;
   do not perform a restore in normal flow. Never commit or share backup.
5. Build existing package compiler dependencies only if needed. Construct
   DATABASE_URL privately from the pre-existing local app password file and
   point it to the exact localhost, port, user and DB above. Never print DSN.
   Set APP_ENV=dev explicitly.
6. From the repository root, invoke the package-scoped CLI:

    pnpm --filter @xiaohai/db exec tsx src/i111-storyboard-fixture-cli.ts --plan

The plan starts an isolated serializable transaction; checks endpoint,
connected database identity, schema migration count, owner, locked READY assets,
existing pages, illustrations and active jobs; always ROLLBACKs; logs only
PLAN_PASS_NO_WRITE, ALREADY_APPLIED_NO_WRITE or a sanitized I111_STOP code.

## Apply exactly once, after all review gates

Only with a verified recoverable backup, exact reviewed code and PLAN_PASS_NO_WRITE,
pass these process-local markers (NOT stored in Git or general .env):

- I111_STORYBOARD_APPLY_AUTHORIZATION=I111_MAC_PLAN_B_PAGES_0_1_2_ONLY
- I111_BACKUP_VERIFIED=YES

Then with the same private local DATABASE_URL and APP_ENV=dev:

    pnpm --filter @xiaohai/db exec tsx src/i111-storyboard-fixture-cli.ts --apply

The script takes a book row lock and performs all three inserts and DRAFT ->
PLANNED transition in one transaction. It has no retries. Exact repeat pages
yield an ALREADY_APPLIED_NO_WRITE response; conflicting old pages, unknown DB,
missing images, changed user, running jobs, stale state or failed constraints
produce STOP and rollback, without altering locked character references.

Do not invoke --apply on any other environment, clone, different DB, or
unchecked branch.

## Postflight and recovery

1. Read-only verify exactly pages 0/1/2, original approved scenes, two stable
   character IDs, null source_ai_job_id; book PLANNED.
2. Confirm no illustration, queue job, paid reservation or provider work was
   created; DB migrations and locked READY media are unchanged.
3. Add a sanitized count/status/page-ID report to Issue #111. Preserve
   database, backup, Redis, Docker volumes and BOS private media. Keep Issue OPEN.
4. Any mismatch: STOP, do not automatically retry or restore. A recovery write
   or restoration requires its own explicit, reviewed operation authorization.

Only after this separate data gate may the three-image paid quality benchmark
be considered with a separate strict 3-attempt / CNY 2-yuan cumulative limit,
verified budget reservation and independent visual review. This fixture
initialization never calls any provider.
