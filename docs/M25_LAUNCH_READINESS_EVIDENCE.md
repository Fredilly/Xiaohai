# M25 Launch Readiness — evidence register / 上线准备验收台账

> **Status: NOT APPROVED / 尚未达到上线条件.** Baseline reviewed 2026-10-28, against
> `main` at `d79ca0ff400f52f05a140235565b9c981163ead5` (merged PR #162).
> This document is a **read-only evidence inventory** for Issue #33, **not** production,
> staging, database, payment, WeChat or inventory deployment authorization.

## Authority, order and grading

- Product/scope: `docs/PRD_V3.2.md`, `docs/DEVELOPMENT_TASKS.md`, `AGENTS.md`.
- Release sequencing: [Issue #116](https://github.com/Fredilly/Xiaohai/issues/116);
  [M24 #32](https://github.com/Fredilly/Xiaohai/issues/32) →
  [M25 #33](https://github.com/Fredilly/Xiaohai/issues/33) →
  [M26 #34](https://github.com/Fredilly/Xiaohai/issues/34) →
  [M27 #35](https://github.com/Fredilly/Xiaohai/issues/35).
- M24's existing `docs/M24_DEVICE_MATRIX.md` is the source of device-test evidence;
  **do not duplicate or mark its pending entries PASS**. Gate 0/1/2 of #116 also
  remain separately evidence-gated; a merged implementation PR is not acceptance.
- `PASS`: a named accountable human has reviewed a dated artifact referencing
  the exact environment and revision. `FAIL`: a verified noncompliance.
  `BLOCKED`: a known prerequisite is absent. `NOT VERIFIED`: neither a pass
  nor a fail is demonstrated. `N/A`: written rationale and owner approval.
- An evidence link to source code, green CI, a DNS hostname or a closed milestone
  **alone never proves real-device, production infrastructure or compliance readiness**.

## Baseline evidence and explicit gaps

| Gate | Required proof / acceptance | Source-derived baseline on 2026-10-28 | Status | Human owner / next artifact |
| --- | --- | --- | --- | --- |
| M24 device journeys | Recorded DevTools, iOS, Android, weak-network login/pay/media/AI/map/privacy/order outcomes | `docs/M24_DEVICE_MATRIX.md` records pending runtime/device rows; Issue #32 remains open | BLOCKED | WeChat operator: signed device matrix and redacted screenshots |
| WeChat app eligibility | Legal subject, approved app category, owned AppID and developer permissions | No ownership or category approval proven by repository | NOT VERIFIED | WeChat account owner: portal verification record |
| Domains and TLS | WeChat request/upload/download/socket domain allowlists, HTTPS certificate and reachability from actual devices | `apps/miniapp/config.ts` uses develop `http://127.0.0.1:3000`, trial `https://staging-api.pamboo.asia`, release `https://api.example.invalid` | BLOCKED | Infra/WeChat owner: approved production domain and iOS/Android evidence |
| ICP / regional compliance | Applicability determination, ICP/备案 if required, legal ownership and DNS/TLS approvals | Legal/hosting eligibility cannot be established from repo | NOT VERIFIED | Compliance owner: applicable permits or signed N/A |
| Payment/refund | Approved WeChat Pay merchant, isolated non-production test, signature/callback/idempotency/refund reconciliation evidence | PRD and M6 describe controls; no live merchant or sandbox acceptance verified here | NOT VERIFIED | Payment/finance owner: sandbox reconciliation and go/no-go |
| Privacy/children | Reviewed privacy notice, data minimization, consent/guardian controls where applicable, user-data deletion/contact handling | M22 describes controls and residual policy decisions, not legal approval | NOT VERIFIED | Product/legal/security owner: approved text and platform screenshots |
| Moderation/content safety | Approved child-appropriate policies, provider configuration and blocked/allow test cases | `docs/M22_SECURITY_PRIVACY.md`: staging/production text/scene flows fail closed when no moderation policy configured | BLOCKED | Content safety owner: policy, provider and negative tests |
| Customer service | Visible contact channel, assigned support owner, incident/SLA/refund escalation | No staffed or verified channel evidenced | NOT VERIFIED | Operations owner: actual customer-service acceptance |
| BOS/CDN/media | Authorized media origins, key/access policy, signed/private object handling, WeChat-domain tests, fallback | BOS architecture exists; M22/M23 explicitly leave deployment-specific byte validation/CDN verification outstanding | NOT VERIFIED | Media/infra owner: HTTPS/device and signed-access proof |
| Production infrastructure | Separate production compute/DB/Redis/object storage, secrets, least privilege, backup, monitoring | `deploy/README.md` covers staging topology only; production isolation not proven | NOT VERIFIED | Infra/DBA: redacted topology, restore drill and secret-rotation checklist |
| 0039 schema prerequisite | Actual applied 0039 journal, approval, backup and post-0039 snapshot reconciliation | PR #164 code was merged, but deployment to any specific database is not proven | BLOCKED | DBA: environment-specific journal and signed 0039 evidence |
| 0040 schema safety | Owner signoff, restorable backup, restored-disposable rehearsal, lock window, before/after counts | PR #162 merged 0040 code; `docs/MEIPING_0040_GUARDED_APPLY_RUNBOOK.md` expressly separates merge from schema deploy | BLOCKED | DBA + stock owner: signed 0040 rollout/reconciliation record |
| Inventory import execution | Review → preview → independent approval → reconciled import in M26 | Production execution is explicitly disabled under #162 and **is not M25 work** | BLOCKED | M26 operator/stock owner: separate cutover plan and authorization |
| Cross-domain operations | Catalog/checkout/orders/pay/refund/inventory/rental/delivery/commission/RBAC failures and recovery proof | Issue #114 is open; closed M5–M23 implementation milestones do not prove end-to-end acceptance | NOT VERIFIED | Domain owners: #114 PASS/FAIL/NOT TESTED worksheet |
| AI spend/preflight | Atomic budget caps, retry limits, Qwen→BOS readiness, one approved cost-bounded smoke | Issue #115 and release Gate 0 require independent proof; do not perform paid calls here | NOT VERIFIED | AI/infra owner: redacted preflight + budget-approved smoke evidence |
| Observability/restore | On-call/alerts, PostgreSQL restore time, payment/inventory anomalies, rollback drill | M23 defines proposed thresholds and CI scanner, not a staging/production signoff | NOT VERIFIED | SRE/DBA: alert drill, restored backup and response owner |
| Launch decision | Gate 0/1/2/3 evidence complete, no open P0/P1, exact release SHA, approvers and rollback contacts | No signed launch decision exists in this register | BLOCKED | Project owner: separate dated GO/NO-GO authorization |

The `Human owner` column defines the **responsibility role**, not a claim that a
person has already accepted that role. Assign named owners privately and record
their dated signoff without exposing access credentials or personal data.

## Immediate critical hold: staging auto-migration

As checked on this baseline, **the committed** `.github/workflows/staging-deploy.yml`
still includes `workflow_dispatch`, accepts manual invocation in its `build` guard,
and runs `node packages/db/dist/src/migrate.js` automatically inside the
`Deploy exact CI-verified revision` step. Its older
`deploy/README.md` description says migrations are not automatic, which conflicts
with the actual workflow. Trust the **executable workflow** rather than this prose.

[PR #163](https://github.com/Fredilly/Xiaohai/pull/163) is a separate, reviewed
but **unmerged** focused fix for only successful, push-triggered `main` CI and exact
image SHA. **It does not remove the automatic migration command.** Do not claim
that merging #163 authorizes 0039/0040 application.

Since PR #162 put 0040 SQL into `main`, any future eligible staging deployment
could apply 0040 if `STAGING_READY` permits it. GitHub workflow success alone
does **not** demonstrate DBA and inventory-owner approval for this migration.

**Owner containment actions (do not execute automatically from this document):**

1. Before the new `main` CI can trigger a staging deployment, an authorized
   repository/environment operator should verify `STAGING_READY` is disabled
   or that a protected deployment environment is effectively blocking dispatch.
   Record the actual setting and time; never infer it from source or CI alone.
2. Record whether any staging workflow ran for the PR #162 merge SHA and whether
   its migration command executed. Check deployment logs and **read-only**
   migration journal/counts. Do not replay the migration or alter the journal.
3. Fix and review the independent release-control gap: do not attach production-
   relevant schema rollout to ordinary staging deploy without approved
   environment-specific backup, restored-disposable rehearsal and operator gate.
   Coordinate with #163 to avoid conflicting workflow edits.
4. Stop launch and migration rollout if the observed state disagrees with the
   planned journal/version; investigate with DBA rather than automatic recovery.

## Evidence capture template (copy once for each gate)

- **Gate / scope:** `<M25 gate or linked issue>`
- **Environment and exact revision:** `<dev/staging/production + full SHA>`
- **Responsible role and reviewer(s):** `<approved owner(s)>`
- **Observed on:** `<ISO timestamp + timezone>`
- **Expected / actual / status:** `<PASS | FAIL | BLOCKED | NOT VERIFIED | N/A>`
- **Sanitized evidence:** `<GitHub issue, CI run, safe screenshot, read-only query receipt>`
- **Rollback/abort condition:** `<specific measurable trigger>`
- **Decision/signoff:** `<linked human decision; absent means not approved>`

Do not paste private keys, passwords, API tokens, customer records, precise
locations or full Meiping source files into GitHub evidence.

## Decisions needed before exiting M25

1. Who owns WeChat AppID, domain, subject/category and legal/child privacy approvals?
2. Which verified domain and environment replace the production `.invalid` URL,
   and how is the dev/physical-device `127.0.0.1` problem resolved (#76)?
3. What is the **approved** protected staging migration workflow, and what is
   the actual applied 0039/0040 journal in each environment?
4. Who signs the 0040 lock-window rehearsal, DB backup/restore and stock-ledger
   constraint approval, separate from M26 real import?
5. Which payment test environment, staff/customer-support channels, moderation
   policy, real-device evidence and monitoring on-call are authorized?
6. Which unresolved issues from #116, #113, #114, #115 and #32 block launch?

**Exit condition:** all applicable gates have accountable owners, verified
environment-specific evidence and signed product/operations GO decision.
The current evidence register is **NO-GO / blocked**. Moving the status to PASS
requires new evidence and explicit human review, not editing this heading alone.
