# ADR: Unified store-account catalog editing and HQ control

Date: 2026-10-22  
Status: Security amendment under Fred's CHANGES_REQUESTED (2026-10-26); original direct shared edits overridden by least privilege pending owner policy reconfirmation.

## Context

The original PR #155 read model and #156 independent correction proposal were intentionally conservative, preventing store catalog writes. The product owner subsequently confirmed a different operating model: one kind of **店铺账号 / Store Account** per store or scoped set of stores, with direct edit capabilities, while HQ centrally governs store information and accounts. The earlier per-request second-user review would be unnecessarily cumbersome for ordinary store operation.

## Decision

1. Authorized Store Account can directly edit only **store-local shelf placement, note and display** fields. Shared book/product/SKU metadata (title, author, publisher, ISBN, price) is **HQ GLOBAL only**, and neither a single-store link nor `catalog.edit` grants write authority over other stores. Normal store correction proposals (#156) remain available for suggested shared changes.
2. A HQ shared-field change requires `catalog.manage` + GLOBAL, a **server-signed short-lived preview/impact token** tied to actor, store, SKU, exact proposed fields, input versions, shared field set, and all affected store IDs. PATCH recomputes impact under transaction locks and rejects missing, tampered, expired or stale tokens and changed linked-store scope. Browser confirmation is supplementary, not the security boundary.
3. HQ Account may manage cross-store catalog and store metadata and **exclusively** create/disable/reassign Staff accounts. Disable retains historical audit references and invalidates old sessions.
4. Inventory on-hand cannot be silently written by either account type: adjustment/stocktake + immutable inventory transactions are mandatory.
5. PR #156 proposal/second-person-review history remains available for reference but is no longer the prerequisite to a normal direct edit. The separate Meiping one-time migration correction workflow still uses its specific review rules.

## Consequences and limits

- Original owner intent allowed scoped stores to modify shared records used by other stores. Fred's independent security review identified that as cross-store privilege escalation; therefore the safe implementation now disallows it until the owner chooses a defensible per-all-affected-store approval policy. This is a **business capability change** requiring owner sign-off before production rollout. No global account-administration privilege is granted to Store Accounts.
- Existing historical PR #155/#156 documents describe the limitations *at those earlier PR stages*; their claims are not the integrated final rules.
- Staging/production deployment and decisions such as future effective pricing, special franchises and HQ emergency recovery require separate owner approval.

## Evidence required before merge
- Signed-session two-store tests: store A account cannot preview/PATCH shared fields even through its own store route; local-only edit remains allowed and cannot write stock or B-store metadata.
- HQ preview token tests: missing token, different actor, changed input versions and a new/removed affected-store link all reject. Authorized HQ with unchanged impact can save, and audit remains transactionally complete.
- Migration 0036→0038 safeguards and disposable PostgreSQL CI remain mandatory. Actual browser UAT and owner acceptance are separate.
