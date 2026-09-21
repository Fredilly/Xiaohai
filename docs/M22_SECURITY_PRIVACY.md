# M22 Security & Privacy / 安全与隐私

## Goal / 目标

Harden Xiaohai for production security, privacy, and child-safety requirements without changing completed M1-M21 business semantics.

M22 is a production-hardening milestone. It does not add new commerce, finance, store, AI-creation, or inventory business features.

## Source requirements / 依据

M22 must cover:

- threat review
- secret management
- RBAC/Data Scope abuse tests
- secure uploads
- rate limiting
- PII minimization and log redaction
- child/privacy requirements
- moderation
- privileged-action audit coverage

Done means the critical controls are implemented, tested, documented, and independently reviewed.

## Existing baseline observed / 当前基础

The repository already has meaningful security foundations:

- Consumer and Staff identities are separate.
- Staff authorization is server-side RBAC + Data Scope; client-provided store/region IDs are not an authorization source.
- API responses include request IDs.
- Staff session invalidation/versioning exists from earlier IAM/HQ work.
- Privileged HQ/Finance actions have an operational audit-log foundation.
- Payment and commission authority remains server-side with append-only ledgers and reconciliation.
- CI runs a repository secret-policy scan.
- The secret scan currently rejects tracked `.env` files (except examples), WeChat private project config, common private-key files, private-key blocks, OpenAI-style `sk-...` tokens, and AWS access-key IDs.
- CI runs formatting, lint, typecheck, unit tests, integration tests, E2E, migration guard, and high-severity production dependency audit when dependency files change.
- AI jobs already expose a `moderation` field in their persisted/read model, so M22 should extend the existing AI model rather than introduce a second moderation source of truth.

## Gaps confirmed or requiring hardening / 已确认或需加固

### 1. Rate limiting

The current Fastify bootstrap does not register a centralized rate limiter. Authentication, public submission endpoints, and expensive AI operations therefore need explicit abuse controls.

### 2. Log redaction / PII

The API has structured logging and request IDs, but the Fastify bootstrap does not currently configure centralized logger redaction. M22 must prevent authorization tokens, cookies, passwords, WeChat codes/identifiers, addresses, phone/email, payment credentials, provider secrets, and raw AI prompts where inappropriate from leaking to logs.

### 3. Secret policy depth

The repository secret scan is useful but intentionally small. M22 should extend detection for project-specific provider credentials and ensure production configuration cannot silently use development/test secrets or unsafe fallbacks.

### 4. RBAC abuse coverage

Existing feature tests cover many expected authorization paths. M22 needs an adversarial matrix that deliberately tries cross-store, cross-region, missing-permission, forged-scope, stale-session, disabled-account, privilege-escalation, and self-lockout scenarios across sensitive routes.

### 5. Upload security

Architecture requires validated object-storage uploads. M22 must inventory every existing upload/media entry point and enforce one shared policy for MIME/type, size, extension/content mismatch, object-key ownership, public/private exposure, and unsafe active content. If a production upload path is not implemented yet, M22 should add the reusable policy layer and tests without inventing an unrelated storage product.

### 6. Privacy / child safety

Data collection must be minimized. Consumer-facing and AI flows need an explicit inventory of collected PII, purpose, retention, visibility, deletion/export implications, and child-safety constraints. Legal/product choices that are not defined by the PRD must be recorded as Decisions Needed instead of guessed in code.

### 7. Moderation

AI/content architecture requires moderation, but M22 must verify enforcement rather than only storage of moderation metadata. Unsafe input/output states must fail closed where required, with tests covering bypass attempts and staff-only review paths.

### 8. Privileged-action audit completeness

M20/M21 provide the audit foundation. M22 must inventory sensitive mutations and verify that high-risk operations record actor, action, resource, request ID, and safe metadata without secrets/PII.

## Threat model / 威胁模型

M22 focuses on the following production threats:

1. Credential stuffing and brute-force login attempts.
2. Session theft, stale sessions, disabled accounts, and privilege changes not taking effect promptly.
3. IDOR / broken object-level authorization across stores, regions, consumers, and HQ resources.
4. Privilege escalation through client-controlled permission/scope/resource identifiers.
5. Secret leakage through Git, configuration, logs, errors, exports, or client bundles.
6. PII leakage through logs, admin views, CSV exports, audit metadata, or over-broad APIs.
7. Malicious or oversized uploads, content-type spoofing, active-content payloads, and unsafe public exposure.
8. Abuse of expensive AI endpoints and queue exhaustion.
9. Unsafe AI/public content bypassing moderation.
10. Missing audit evidence for privileged mutations.
11. Child data collection or exposure beyond the documented minimum.

## Implementation slices / 实施切片

### M22-A — Security inventory and threat review

- Map public, consumer-authenticated, Staff, Store, HQ, payment, AI, upload/media, export, and webhook surfaces.
- Classify data: public, internal, PII, payment-sensitive, secret, child-sensitive.
- Produce route-to-control matrix: auth, permission, data scope, rate limit, validation, audit, logging/redaction.
- Record unresolved legal/product privacy decisions under Decisions Needed.

Deliverable: this document expanded with the verified inventory and test matrix.

### M22-B — Logging and secret hardening

- Centralize Fastify/Pino redaction for sensitive headers and body/query fields.
- Ensure error logs use codes/IDs instead of raw credentials, tokens, provider payloads, or unnecessary PII.
- Expand `check:secrets` for project-relevant credential formats while keeping false positives manageable.
- Add tests for redaction and secret-policy fixtures.
- Tighten production config validation so known development/test fallback secrets are rejected in production.

### M22-C — Rate limiting and abuse controls

- Add a centralized rate-limit abstraction suitable for production deployment.
- Apply stricter limits to Consumer/Staff login, public franchise submission, AI job creation/retry, and other high-cost or anonymous surfaces found by inventory.
- Key limits by trusted server context (IP/session/staff/consumer as appropriate), never by arbitrary client IDs.
- Return stable public error responses and request IDs.
- Add deterministic tests for allow/deny/reset behavior.

Redis may be used because the locked architecture explicitly allows Redis for rate limits, but canonical business state must remain outside Redis.

### M22-D — RBAC/Data Scope adversarial suite

Add integration coverage for:

- no token / malformed token
- missing permission
- wrong Data Scope
- forged store/region/resource IDs
- cross-store access
- cross-region access
- disabled Staff account
- stale session after password reset / role / scope revocation
- role escalation attempts
- self-lockout protections where applicable
- GLOBAL-only HQ/Finance/Audit/Staff-admin surfaces

The suite should reuse production authorization services, not mock away the security boundary.

### M22-E — Upload/media security

- Inventory actual upload paths first.
- Introduce one reusable upload policy with explicit allowlists and size ceilings.
- Reject MIME/extension mismatch and unsafe active formats where applicable.
- Generate server-owned object keys; do not trust client object paths for ownership.
- Keep private/source assets non-public unless business rules explicitly publish them.
- Test malformed metadata, oversize input, unsupported content, and ownership violations.

### M22-F — PII minimization and privacy

- Inventory PII fields and all API/admin/export/log exposure.
- Remove fields from responses that are not required for the caller's task.
- Redact sensitive metadata in audit/log records.
- Ensure finance exports, support views, and Staff views remain purpose-bounded.
- Document retention/deletion/export responsibilities and flag policy gaps for product/legal approval.
- Do not invent consent ages, retention periods, or legal bases not specified by approved requirements.

### M22-G — Moderation and child-safety enforcement

- Verify moderation state transitions for AI input/output and public content.
- Add fail-closed behavior where moderation is required before publication/exposure.
- Prevent clients from setting trusted moderation outcomes.
- Add bypass/adversarial tests.
- Keep moderation decisions auditable without storing unnecessary sensitive prompt content in operational logs.

### M22-H — Audit completeness and final verification

- Build a privileged-action inventory.
- Add missing audit events only for materially sensitive operations.
- Verify audit metadata contains actor/resource/request ID and excludes secrets/PII not needed for audit.
- Run full repository checks, PostgreSQL/Redis integration, E2E, dependency audit, secret scan, and branch-vs-main review.
- Require independent review before merge.

## Non-goals / 非目标

- M23 load/performance tuning, backup/restore drills, broad monitoring/alert tuning.
- M24 real-device WeChat experience acceptance.
- M25 production account/domain/payment/filing activation.
- New business workflows unrelated to security/privacy hardening.
- Rewriting M1-M21 authorization or financial business semantics unless a verified security defect requires a focused fix.

## Initial acceptance criteria / 初始完成标准

M22 is ready for PR only when:

- threat/control inventory is documented
- critical auth/RBAC/Data Scope abuse cases are automated
- sensitive logs are centrally redacted and tested
- high-risk endpoints have tested rate limits
- secret policy/config hardening is tested
- upload security is enforced on every existing upload entry point or explicitly documented as not yet applicable
- PII exposure inventory is reviewed and unnecessary fields are removed/redacted
- moderation enforcement and bypass tests cover applicable AI/public flows
- privileged-action audit coverage is reviewed
- full CI/integration/E2E is green
- no production secrets are committed
- independent review is requested

## Decisions Needed / 待确认

The following must not be guessed if the approved product documents do not define them:

- exact child/guardian consent model and age rules
- PII retention periods and deletion/export SLA
- which AI/public-content categories require blocking vs Staff review
- production object-storage/CDN malware scanning provider, if external scanning is required
- production WAF/rate-limit edge provider and final numeric quotas
- incident-response contacts and security escalation SLA

These can be implemented once product/legal/operations decisions are approved; M22 may establish safe defaults and technical enforcement points without pretending those policy decisions are already final.
