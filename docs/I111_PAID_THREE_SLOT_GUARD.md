# Issue #111 — durable max-three paid provider slots (code review only)

**NO-GO:** This branch does not authorize a paid request or enable an
image Worker. It depends on the reviewed endpoint/TTL prerequisite PR #234.
No database migration is introduced or executed. The original Mac isolated
database, backup, book, three storyboard pages and private Mimi/Pip assets
must remain unchanged.

## Exact one-time allowlist

For the already-established Mac Plan B fixture only:

- Book: 90d7f77e-ae23-40ef-90b6-a672412c6318
- Consumer: 11111111-1111-4111-8111-111111111111
- Slot 1: CONTENT page 1, ID 6fe359ee-71b0-43f5-b49b-08fe2b48a9cb, revision 1
- Slot 2: CONTENT page 2, ID eae00ed5-6026-4a41-b95a-6c9eea09d076, revision 1
- Slot 3: SAME page 2, revision 2; never create a third content page
- COVER 0 and every other page or revision are forbidden
- Provider BAILIAN, model qwen-image-3.0, exactly two reference inputs, n=1
- One reservation: 25 minor units (fen); global/consumer window limit:
  200 minor units (CNY 2). The monetary limit does not replace max 3 slots.
- Scoped budget key: I111_MAC_PLAN_B_THREE_PAID_IMAGE_CALLS
- Scoped window key: I111_20261117_ISOLATED_BOOK_ONLY

## Atomic irreversible consumption

The API must first create exactly ONE allowed illustration plus its
ai_cost_reservations record in one transaction. The existing reservation is
a conservative planned-attempt record: never delete, release or reuse it
after an uncertain result.

Immediately before provider.generate, the dedicated target-ID Worker:
1. Locks the run's existing GLOBAL ai_budget_windows row FOR UPDATE.
2. Locks the paired consumer window and checks 200-fen limits.
3. Validates EVERY reservation for the exact run key, including exact
   book ownership, allowed page/revision, model, 25-fen reserve and status.
4. Requires all prior consumed slots to have one audited SUCCEEDED ledger,
   matching immutable provider request ID, SETTLED/NONE budget state and
   READY media. A previous failure, timeout, missing provider ID or AT_RISK
   always STOPs the next slot.
5. Inserts exactly one ai_cost_ledger AT_RISK entry and atomically changes
   the current reservation to AT_RISK before a provider POST. The ledger's
   usage JSON is a permanent marker with the planned two-input/one-output
   rate basis; it explicitly says actual charge is NOT verified.
6. Commits the marker BEFORE provider.generate. A process crash between
   this commit and the POST conservatively consumes the slot anyway.
7. After a known provider result, only an explicit request ID/error code
   is attached. Money is NEVER automatically settled by the Worker.
   An approved invoice-based confirmAtRiskImageBudget call may settle
   this same ledger in place, preserving the original marker.

The three slots cannot be re-opened by a retry, process restart, HTTP error,
timeout, unknown provider outcome or manual AT_RISK confirmation. A fourth
reservation or an unexpected job causes STOP. Concurrent contenders are
serialized through the row lock and cannot consume the same slot twice.

## Generic Worker protection

ImageJobProcessor may accept an explicit single illustration ID only in
APP_ENV=dev; it claims that ID alone and never falls back to a queued
character-reference generation. A generic Worker with no target ID refuses
the special run budget key; the two fixed fixture page IDs are also guarded
even if a budget key is misconfigured. This is defense in depth: **do not
start the ordinary Worker** on the isolated paid execution environment.

## Required further work before execution

This PR is deliberately limited to provider-slot consumption and guard
tests, not a complete runnable paid benchmark:

1. Merge PR #234 first after independent human review and branch checks.
2. Review this actual stacked PR diff and latest-head CI and obtain separate
   Fred APPROVED. Rebase/retarget only after the prerequisite is merged.
3. Implement a dedicated ONE-SHOT CLI that verifies the original Mac
   detached worktree, DB name/user, exact book/pages/references, backup,
   absence of other pending jobs, current budget state and scoped secret
   injection, before preparing exactly one illustration via the formal API
   path and processing only its returned ID.
4. Revalidate actual Beijing Workspace full charge and price ceiling:
   the current indicative two-input plus one-output price is 22 fen,
   but usage JSON is a planning snapshot, not an invoice. Do not
   confirm 18 fen or claim hard provider-billing certainty from a 25-fen
   reservation. The full CNY 2 cap must include all agreed spend categories.
5. Prove the new 900-second SDK signed GET safety separately using an
   approved one-shot zero-fee check. Mac signed GETs for the OLD 300-second
   signer do not establish new 900-second behavior or Bailian server-side fetch.
6. Obtain a NEW paid, one-time operation authorization tied to exact merged
   code SHA, DB/book/pages, three-attempt max, CNY 2 maximum and explicit
   no-retry and stop conditions.
7. Only process one task per invocation. STOP on any error/AT_RISK/unknown;
   require verified complete cost reconciliation before the next slot.
8. Complete the independent human picture quality review.

Strictly prohibited in this PR: any provider POST, API/Worker launch, new
DB writes or migration on the protected Mac fixture, BOS PUT/ACL changes,
original storyboard --apply, image re-import, staging deployment and merge.

## Test plan

- Pure tests for strict sequence and forbidding cover, revision 3,
  wrong provider/model and call 4.
- Disposable PostgreSQL integration: competing transactions for slot 1
  yield one success and one STOP; ledger marker remains after retry or
  simulated 22-fen manual settlement; slots 2/3 require prior complete
  settlement; fourth attempt is denied.
- Existing generic Worker tests must remain green, proving other AI/image
  flows retain their prior behavior.
- Real credentials, BOS URLs, images, user data and provider response
  bodies never enter test data or CI logs.

**Known limitation:** This gate alone is not a complete one-shot
operator workflow and cannot enforce the external provider's invoice.
Issue #111 remains OPEN and paid image execution remains NOT_RUN.
