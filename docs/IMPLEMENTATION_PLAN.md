# 小海童话 2.0 — M0 Implementation Plan

> Status: **M0 review draft**
>
> Scope: planning only; no M1 framework initialization or business implementation
>
> Product baseline: `docs/PRD_V3.2.md`

## 1. M0 scope and repository baseline

This plan translates the approved product and architecture documents into an implementation path. It does not approve unresolved business rules and does not change the locked stack.

Repository inspection at M0 found the governing documents plus a minimal native Mini Program placeholder under `apps/miniapp/`. There is no pnpm/Turborepo workspace, API, worker, web client, shared package, database schema, migration, CI pipeline or deployment configuration yet. The placeholder JavaScript must be assessed during M1 before conversion to the locked native TypeScript setup; it is not treated as reusable business functionality.

## 2. Target monorepo structure

```text
apps/
  miniapp/       # consumer native WeChat Mini Program
  admin-web/     # HQ operations and administration
  store-web/     # store staff and manager operations
  api/           # Fastify composition root and HTTP API
  worker/        # AI/media/import/notification background execution
packages/
  domain/        # framework-independent domain policies and state machines
  db/            # Drizzle schema, migrations and DB access primitives
  contracts/     # versioned transport DTOs and API error contracts
  validation/    # reusable Zod schemas safe for intended runtimes
  config/        # typed non-secret configuration loaders and validation
  test-utils/    # factories, fixtures and integration-test helpers
docs/            # product, architecture, ADRs and operational guidance
```

The repository root will own pnpm workspace configuration, Turborepo task orchestration, shared TypeScript/lint/format defaults and CI entry points. M1 will introduce those files only after this plan is approved.

## 3. Apps and packages boundaries

- `miniapp` contains WXML/WXSS, native WeChat pages/components and client adapters. It may consume explicitly Mini Program-safe contracts/types, but never server, Node, Drizzle or browser-only code.
- `admin-web` and `store-web` are separate React/Vite applications. They share contracts and presentation-neutral utilities, not feature pages or authorization decisions.
- `api` authenticates callers, resolves server-side authorization/data scope, validates input, coordinates use cases and exposes `/api/v1`. Route handlers remain thin.
- `worker` consumes durable jobs and calls the same application/domain services where appropriate. It has no public HTTP business API.
- `domain` contains domain rules, state transitions, value objects and ports. It must not import Fastify, React, WeChat APIs, Drizzle or provider SDKs.
- `db` owns PostgreSQL persistence, Drizzle schemas/migrations and transactional repositories. Apps do not issue unowned ad-hoc SQL.
- `contracts` describes transport shapes; database rows are not public API contracts.
- `validation` contains shared validation only when behavior is identical across runtimes. Server validation remains authoritative.
- `config` exposes typed configuration while keeping all secret values outside source control.
- `test-utils` is test-only and cannot be a production runtime dependency.

Dependency direction is `apps -> contracts/validation/domain/db as appropriate`; domain code does not depend on apps or infrastructure. Cross-domain writes go through explicit application services and transactions/events, not direct table ownership violations.

## 4. Domain and module boundaries

The modular monolith will use these bounded modules: IAM, CMS, Catalog, Commerce, Orders, Payments, Media, AI, Works, Stores, Inventory, Procurement, Rental, Delivery, Franchise, Referral/Commission, Finance, Notification, Moderation and Audit.

Each module owns its application services, domain policy, repository interface, persistence mapping and tests. Shared identifiers do not imply shared table-write ownership. Key relationships are:

- IAM owns consumer/staff identities; staff authorization combines RBAC with server-derived data scope.
- Catalog owns books, editions, products and SKUs; Inventory references SKUs but owns stock state and stock movements.
- Commerce owns carts/checkout orchestration; Orders owns order lifecycle and immutable commercial snapshots.
- Payments owns payment/refund provider interaction and payment records; Finance owns accounting/reconciliation views and ledgers.
- Media owns stored asset lifecycle; AI owns projects/jobs/attempts; Works owns saved user outputs and versions; Moderation gates inputs and outputs.
- Stores owns the HQ/region/franchisee/store hierarchy; Procurement, Inventory, Rental and Delivery apply its scope rules.
- Referral/Commission is isolated behind configurable rules and an append-only ledger until business/compliance rules are approved.
- Audit records privileged and sensitive actions across modules without becoming a back door for domain mutation.

Explicit state machines are required for orders, payments, refunds, reservations, rentals, AI jobs and withdrawals. Material boundary changes require an ADR.

## 5. Environments and configuration

| Environment | Purpose | Isolation and controls |
| --- | --- | --- |
| `dev` | local development and automated integration tests | local/developer-specific DB and storage namespace; sandbox/fake providers; synthetic data only |
| `staging` | integrated acceptance, DevTools/real-device checks and migration rehearsals | isolated DB, Redis, bucket/CDN namespace and provider credentials; payment sandbox/test mode where supported; no production PII |
| `production` | live commercial operation | dedicated DB, Redis, storage, domains and secrets; least privilege; backups; monitoring; human-controlled activation and release |

Configuration is validated at process startup. Non-secret defaults may be committed; secrets use a managed secret store or protected CI/environment settings. No environment shares database credentials, encryption keys, buckets or queue namespaces. Production access and deployment require human approval. Preview environments, if later adopted, must never connect to production data or provider credentials.

Initial reliability targets proposed for review (not yet approved SLOs): monthly API availability 99.9% excluding announced maintenance; p95 read API latency below 500 ms and p95 write latency below 800 ms at the service boundary, excluding third-party/long-running jobs; payment callbacks acknowledged within provider limits after durable recording; critical payment/inventory alerts within 5 minutes. Final SLOs need expected traffic and business-hours input.

## 6. Deployment plan

- Deploy `api` and `worker` as separate processes from the same reviewed commit; scale independently while retaining a modular monolith codebase.
- Deploy `admin-web` and `store-web` as static assets behind HTTPS/CDN, with separate origins or strict route boundaries and security headers.
- Build and upload the Mini Program through the official WeChat DevTools/CLI supported by the installed version; experience/review/release promotion is human-approved.
- Use managed PostgreSQL with point-in-time recovery where available, managed Redis when queues/rate limiting/idempotency require it, and private object storage fronted by CDN.
- Put HTTPS/WAF/rate limiting ahead of public APIs. Health/readiness endpoints must not expose internals.
- Use immutable build artifacts promoted from staging evidence to production; do not rebuild unreviewed source during promotion.
- Keep cloud/provider selection open until mainland connectivity, ICP/domain, WeChat, residency, cost and operational ownership are confirmed. This plan does not select a cloud vendor.

## 7. PostgreSQL and Drizzle migration strategy

- PostgreSQL is the sole production system of record. Drizzle migration SQL is versioned in `packages/db`; schema changes never rely on runtime auto-sync or manual production edits.
- Use forward-only, small, reviewable migrations. Each migration records its applied version/checksum and runs once under a deployment migration lock.
- CI provisions a clean PostgreSQL instance, applies all migrations from zero, validates schema, then runs integration tests. It also upgrades a representative previous schema snapshot.
- Production uses expand/migrate/contract for incompatible changes: add compatible structures, deploy dual-compatible code/backfill in bounded batches, verify, then remove old structures in a later release.
- Destructive or long-lock migrations require an execution plan, backup/PITR confirmation, staging timing evidence and explicit human approval. Rollback normally means application rollback plus a forward corrective migration; irreversible data migrations need a restore/recovery procedure.
- Money uses integer minor units or reviewed `numeric`, never floating point. Use database constraints, foreign keys and uniqueness for invariants that must survive application bugs.
- Migration credentials are separate and more privileged than runtime credentials. Runtime roles receive only required schema/table permissions.
- Backups, restore drills, retention and recovery objectives must be approved before production. Proposed starting targets for decision: RPO <= 15 minutes and RTO <= 4 hours.

## 8. Meiping migration strategy

Scope is strictly book master data and current store inventory. Members, historical sales/finance/rentals, suppliers, logs and commission history are excluded.

1. Obtain an owner-approved, read-only export and record export time, source version, store mapping and checksums.
2. Preserve the original export unchanged in access-controlled raw archive storage.
3. Load into `migration_book_staging` and `migration_inventory_staging` under a `migration_batches` record; never write raw input directly into canonical tables.
4. Normalize encoding, whitespace, ISBN/barcodes, publisher/author fields and store identifiers. Report duplicate ISBNs, missing ISBNs, malformed barcodes, unknown stores, negative/invalid stock and conflicting rows; do not silently discard or invent values.
5. Dedupe by explicit reviewed rules, retaining source row references and decisions.
6. Run dry-runs that produce counts, mappings, exceptions, checksums and predicted book/edition/product/SKU/inventory results without canonical writes.
7. Require business/store review and signed exception disposition before import.
8. Import in an auditable transaction/bounded batches and emit one or more `INITIAL_MIGRATION` inventory transactions tied to the migration batch.
9. Reconcile source totals by store/SKU and exception category; require store-owner approval.
10. Rehearse safe reruns using source checksum + batch identity + stable source-row keys. A rerun must not duplicate catalog, stock or inventory transactions.
11. At M26, freeze legacy inventory changes, take the final export, repeat validation/reconciliation, approve cutover, then declare PostgreSQL the sole source of truth. No ongoing dual-write.

Exact parsers, identity/dedupe rules and reconciliation tolerances are blocked on a representative Meiping export and store list.

## 9. RBAC and Data Scope

Consumer identity (WeChat) and staff identity are separate authentication realms. The API creates an authorization context from the authenticated staff account, active assignments, roles, permissions and server-side `staff_data_scopes`.

Scope levels are planned as HQ/global, region, franchisee and store, with explicit resource/action permissions. The exact role catalogue and scope inheritance require approval. A client-supplied store/region ID is only a requested resource/filter and is checked against server-derived scope; it never grants access.

Every protected use case performs authorization before reading or mutating scoped data. Repository queries receive an already-validated scope and enforce it in query predicates. Sensitive cross-scope operations, role changes, exports, refunds, stock adjustments and finance actions create audit entries. Deny by default, least privilege, short sessions, revocation, login throttling and separation of duties apply. Permission tests cover allowed, denied, cross-store, cross-region, stale assignment and privilege-escalation cases.

## 10. Inventory consistency

- `store_inventory` is the materialized current balance; immutable `inventory_transactions` is the movement history. No caller directly edits quantities.
- Each mutation executes in one PostgreSQL transaction, validates reason/state/scope, locks or guarded-updates the `(store_id, sku_id)` row using `version`, writes the movement, updates balance and links a unique idempotency/business key.
- Enforce non-negative and availability invariants with database constraints/guarded updates. Redis and search indexes are never canonical stock.
- Define reservation lifecycle explicitly before M5/M13: reserve, expire/release, pay/deduct, cancel/release, refund/return handling, rental reservation and transfer-in-transit behavior.
- Transfers use paired, correlated movements and explicit states; stocktakes/adjustments require reason, authorization and audit.
- Scheduled reconciliation recomputes balances from movements/reservations and alerts on negative stock, mismatches, duplicate keys, stuck reservations or incomplete transfers.
- Concurrency tests must prove no oversell under parallel reserve/deduct/release attempts and no duplicate effects after retry.

## 11. Payment security, idempotency and reconciliation

- Only the server creates WeChat Pay requests, holds merchant credentials and initiates refunds. Clients never receive API keys, certificates or signing material.
- Validate authenticated order ownership, amount/currency and payable state from server records. Never trust client totals or callback fields without verification.
- Verify callback signature/certificate, timestamp/nonce requirements and provider identity before processing. Persist the callback envelope with sensitive fields encrypted/redacted as appropriate and enforce uniqueness on provider event/transaction IDs.
- A callback is durably recorded before acknowledgement and processed idempotently in a DB transaction. Duplicate, delayed and out-of-order callbacks must produce no duplicate order, ledger, inventory, entitlement or commission effects.
- Critical write APIs accept scoped idempotency keys bound to caller, operation and request hash with controlled expiry. A reused key with a different payload is rejected.
- Model payment/refund state transitions explicitly. Side effects use transactional outbox or an equivalent durable handoff so retries cannot lose or duplicate work.
- Automated reconciliation compares provider statements/APIs with payments, refunds, orders and finance ledger entries; mismatches enter a review queue and trigger alerts. Manual correction is privileged, reasoned and audited—never a silent status edit.
- Production activation, merchant configuration, refund authority and live verification require human approval. Exact reconciliation cadence/ownership and retention are Decisions Needed.

## 12. AI and media worker strategy

The API validates/moderates requests, creates `ai_jobs`, and enqueues only after the DB transaction commits through a durable outbox or equivalent. Workers claim jobs with leases, update `queued/running/succeeded/failed/cancelled`, record attempts, usage/cost/failure metadata and use provider adapters.

Retries are bounded with exponential backoff and jitter; retry only classified transient failures. Each provider request and asset write uses an idempotency/correlation key where available. Jobs have timeouts, cancellation checks, per-user/project budgets and dead-letter/manual-review handling. Story, picture-book and animation remain distinct workflows sharing orchestration primitives.

Inputs and generated outputs pass age-appropriate moderation gates. Provider keys and provider callbacks stay server-side. Media uploads use allowlisted MIME/signature/size/dimension rules, randomized object keys, malware scanning where applicable and quarantine until accepted. Object storage is private by default; access uses short-lived signed URLs or controlled CDN tokens. PostgreSQL stores ownership, status and metadata, not large binaries. Lifecycle, derivative generation, deletion and CDN invalidation are auditable.

## 13. Secrets, security, privacy and child safety

- Maintain a secret inventory with owner, purpose, environment, rotation and revocation. Use a managed secret store/protected CI variables; never commit secrets or place production credentials in Mini Program/web bundles.
- Separate service identities per environment and component. Restrict DB, bucket, queue and provider permissions; rotate after suspected exposure.
- Threat-model authentication, RBAC/data scope, payments, inventory, uploads, AI prompt/content abuse, account recovery, exports and admin operations before their milestone.
- Apply TLS, secure headers, input validation, output encoding, CSRF protection where cookie auth is used, SSRF controls, rate limits, dependency/code scanning and timely patching.
- Minimize PII, document purpose/retention/deletion, encrypt sensitive data at rest where warranted, redact logs and restrict exports. Production data must not be copied to dev/staging.
- Confirm guardian/consent requirements, age treatment, child-profile minimization, public sharing defaults, deletion/appeal flows and applicable Chinese privacy/children regulations with qualified owners/counsel before implementation.
- Moderate public and AI input/output with policy versions, escalation and audit. Copyright/provenance rules, provider data-use terms and AI-generated-content labelling are release gates.

## 14. Logging, monitoring and audit

- Emit structured logs with timestamp, environment, service, request/job ID, route/use case, status, latency and safe actor/resource identifiers. Redact tokens, credentials, payment secrets, raw child content and unnecessary PII.
- Propagate request/correlation IDs through API, DB/outbox, queue, worker and provider calls.
- Monitor API availability/latency/error rate, DB connections/slow queries/replication/backups, queue depth/age/failures, worker saturation, storage/CDN failures, auth anomalies, inventory reconciliation, payment callback/reconciliation and AI cost/moderation failures.
- Alerts have severity, owner, runbook and escalation. Avoid alerts without an actionable response.
- `audit_logs` is append-only for login/security events, permission changes, scoped privileged reads/exports, financial actions, stock adjustments, migration actions, moderation and configuration changes. Record actor, server-derived scope, action, target, before/after summary where safe, reason, request ID and time.
- Security/audit logs use restricted access and tamper-evident retention/export controls. Exact retention periods and monitoring vendors remain Decisions Needed.

## 15. Testing strategy

- Unit: domain policies, money calculations, explicit state machines, normalization/dedupe and authorization decisions with Vitest.
- Integration: real ephemeral PostgreSQL for Drizzle migrations/repositories/transactions; Redis/queue integration when introduced; provider adapters against fakes/sandboxes and signed callback fixtures.
- Contract/API: Zod request/response/error shape, version compatibility, authentication, RBAC/data-scope negatives, idempotency and rate limits.
- Concurrency/fault: parallel inventory operations, callback duplication/reordering, job retry/lease expiry, transaction/outbox recovery and migration reruns.
- End-to-end: Playwright for Admin/Store critical paths; API-backed test data with isolated accounts/scopes.
- Mini Program: CI-testable logic outside DevTools, then official DevTools simulator plus real iOS/Android validation for login, navigation, permissions, payment, media, map, sharing and weak-network behavior.
- Security: dependency/secret scanning, upload abuse, authorization matrix, injection, sensitive logging and critical threat scenarios.
- Migration: golden Meiping fixtures, malformed/duplicate/negative cases, dry-run snapshots, checksum stability and source-to-target reconciliation.
- Reliability: representative load, slow-query/query-plan checks, backup restore drills and failure exercises before launch.

Each milestone defines its own acceptance evidence. M0 validation is documentation/repository review only; no runtime suite exists yet.

## 16. CI/CD

Planned M1 pipeline, subject to review:

1. On PR: secret scan, dependency policy, formatting/lint, TypeScript checks, unit tests, clean-DB migration and integration tests; build affected apps through Turborepo.
2. Add Playwright, concurrency, migration fixtures and security tests as their components appear; do not report absent suites as passed.
3. Produce immutable, traceable artifacts with commit SHA and dependency lockfile; generate an SBOM if supported by the selected platform.
4. Merge only through reviewed PRs with required green checks; no direct feature work on `main` and no force-push of shared branches.
5. Deploy automatically or on approval to isolated staging. Run migrations with a single controlled job, then smoke tests.
6. Production promotion uses the reviewed artifact, environment protection and human approval. Database, API/worker, web and Mini Program release order must follow compatibility rules.
7. Post-deploy smoke tests and monitoring determine go/no-go. Application rollback is automated where safe; database recovery follows the approved migration/runbook strategy.

Exact GitHub branch protection, reviewers, CI provider, artifact registry and deployment platform are not yet configured.

## 17. External accounts and services required

| Area | Required account/service or decision | Needed by |
| --- | --- | --- |
| WeChat | verified主体, Mini Program AppID, developer roles, approved categories and privacy declarations | M1/M2; production gates M24-M27 |
| WeChat Pay | merchant ID, API v3 key/certificates, callback domain, refund permissions and sandbox/test procedure | M6 |
| Domains/compliance | owned domains, HTTPS certificates, ICP/备案 and WeChat domain allowlists | staging/prod before M24 |
| Infrastructure | cloud account/region, compute, managed PostgreSQL, backup/PITR, Redis, secret manager | M1 staging decision; production before launch |
| Media | object storage, CDN, image/video processing and malware-scanning approach | M7/M8 |
| AI | approved text/image/video/audio providers, contracts, quotas, data-use/retention terms and moderation capabilities | M8 |
| Map/location | WeChat-compatible map/geocoding account and keys | M12 |
| Delivery | supported local-delivery provider accounts/webhook credentials or approved manual adapter | M16 |
| Communication | SMS/email/WeChat notification providers/templates if required | relevant milestone |
| Observability | error tracking, metrics/logging/alerting destination and on-call contacts | M1 baseline, expanded continuously |
| Security/legal | privacy/child-safety/copyright/compliance owners and review path | before affected design; release gate |
| Meiping | representative export, final export access, field dictionary, store list and business data owner | before M3 |

All accounts require named business and technical owners, least-privilege access, recovery/rotation procedure and separate non-production credentials.

## 18. Risks and mitigations

| Risk | Impact | Planned mitigation/gate |
| --- | --- | --- |
| Product breadth across 27 milestones | schedule/quality dilution | keep milestone gates, modular boundaries and reviewed scope; prioritize only through owner decision |
| Missing Meiping sample/store mapping | migration design and reconciliation uncertainty | block final parser/schema mapping; obtain sample before M3 entry |
| Mainland hosting/ICP/WeChat approval unknowns | staging or launch delay | decide ownership/region/domains early; track M25 gates from M1 |
| Payment/refund mistakes | financial/security loss | server-only integration, verified callbacks, idempotency, ledger, reconciliation and human production activation |
| Inventory concurrency/legacy quality | oversell or incorrect opening stock | transactional guarded writes, immutable movements, dry-runs, exceptions and store reconciliation |
| RBAC/data-scope leakage | cross-store/region data exposure | deny-by-default server scope, authorization matrix and abuse tests |
| Child data/AI unsafe content | safety, trust and regulatory harm | minimize data, guardian/policy decisions, layered moderation, private defaults and escalation |
| AI/media cost and provider variability | runaway cost, failed jobs and poor consistency | adapters, budgets, quotas, async retries, usage/cost logs and provider evaluation |
| Three clients drifting | inconsistent behavior | shared versioned contracts; server-owned domain rules; contract/E2E tests |
| Premature abstraction in shared packages | Mini Program bundle/runtime failures | strict dependency boundaries and runtime-safe exports |
| Large or locking DB migrations | downtime/data loss | expand/contract, staging timing, migration lock, PITR and approved runbooks |
| Insufficient operational ownership | missed incidents/reconciliation | named service owners, alert runbooks, on-call and audit review before production |

## 19. Decisions Needed

These are not resolved by M0 and must be owned, documented and approved before the indicated milestone:

1. Business priority/MVP slicing within the committed Production V1 breadth, target launch date, budget, traffic and growth assumptions.
2. Cloud vendor, mainland region/connectivity, infrastructure ownership, ICP/备案 path, domain ownership and production support/on-call model.
3. WeChat主体, AppID, merchant account, approved categories, developer access, callback/allowlist domains and account recovery owners.
4. Final SLOs, maintenance window, RPO/RTO, backup retention, log/audit retention and incident severity/escalation.
5. Staff role catalogue, permission matrix, HQ/region/franchisee/store scope inheritance, multi-store assignments, separation-of-duty and privileged approval rules.
6. Consumer/staff session mechanism, staff MFA/account recovery and whether any guardian-linked identity/profile is required.
7. Order/inventory reservation timing: allocation point, expiry, payment race handling, cancel/refund restock, rental availability formula, transfer-in-transit and negative-stock policy.
8. Meiping sample export/format/encoding, field dictionary, stable row identifiers, duplicate/empty ISBN policy, abnormal barcode handling, stock reconciliation tolerances, store mapping/list and freeze window.
9. AI providers, pricing/budget/quotas, model policy, data retention/training terms, animation purchase versus subscription model and expected character-consistency acceptance.
10. Public/AI content moderation policy, child age/guardian/consent requirements, default sharing visibility, appeal/deletion/retention rules, copyright/licensing and AI-content labelling.
11. Complete commission rules: percentage/basis, attribution window, eligibility, freeze/settlement, refund reversal, withdrawal thresholds/fees/tax/compliance. The approximate 6% remains configurable and unapproved.
12. Rental deposit, fees, duration, renewals, damage/loss, overdue and refund rules.
13. Delivery regions, zones, fees, SLA, provider(s), fallback/manual fulfilment and delivery-data sharing terms.
14. Franchise application fields, assignment, approval authority, statuses, document retention and opening criteria.
15. Media/CDN provider, geographic storage/residency, signed-access model, upload limits, transcoding, retention/deletion and malware-scanning service.
16. Observability/security vendors, alert destinations, on-call owners, vulnerability response SLA and audit-review cadence.
17. CI/CD/deployment provider, artifact registry, branch protection/required reviewers and production approval roles.
18. Whether the existing `apps/miniapp` JavaScript placeholder should be converted in place or replaced during M1; no unknown files are to be removed without owner confirmation.

No material conflict between the governing documents was found. The unresolved areas above are explicit omissions or business/operational choices already signalled by the documents; implementation must not silently decide them.

## 20. M1 entry criteria

M1 may start only when all of the following are true:

- This implementation plan is reviewed and explicitly approved by the project owner/technical reviewer.
- No requested M0 correction remains open; material architecture changes have an approved ADR.
- The locked stack and modular-monolith boundary are reconfirmed without adding a competing major framework.
- The proposed repository layout, package dependency rules, environment isolation and migration ownership are accepted.
- Owners are assigned for GitHub, WeChat, cloud/infrastructure, database/backups, secrets and staging operations; access can be granted without sharing personal credentials.
- A decision is recorded for the existing Mini Program placeholder (convert or replace) and its files are preserved until then.
- Initial staff RBAC/data-scope design inputs and a representative Meiping export acquisition plan have named owners, even though M2/M3 implementation decisions may remain gated.
- Dev and staging approach is selected enough to create isolated non-production resources; production vendor activation is not required to begin local foundation work.
- CI required checks, branch protection/reviewer policy and secret-handling rules are agreed.
- M1 has a focused ticket/acceptance checklist limited to workspace/tooling, app shells, API/worker shells, PostgreSQL/Drizzle baseline, lint/test/CI, config/secrets/logging and dev/staging foundations.
- The M1 ticket explicitly excludes business features, production payment activation, final Meiping import and any unresolved commission/rental/delivery/child-policy behavior.

Approval of M0 authorizes planning completion only. Starting M1 requires a separate explicit instruction after review.
