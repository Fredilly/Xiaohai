# ADR: Unified store-account catalog editing and HQ control

Date: 2026-10-22  
Status: Owner-confirmed product decision; implementation in stacked Draft PR #157.

## Context

The original PR #155 read model and #156 independent correction proposal were intentionally conservative, preventing store catalog writes. The product owner subsequently confirmed a different operating model: one kind of **店铺账号 / Store Account** per store or scoped set of stores, with direct edit capabilities, while HQ centrally governs store information and accounts. The earlier per-request second-user review would be unnecessarily cumbersome for ordinary store operation.

## Decision

1. Each authorized Store Account can directly edit its store-local shelf placement, note and display fields and linked shared book/product/SKU metadata (title, author, publisher, ISBN and price) with server-side scope checks. No automatic GLOBAL scope.
2. A shared-field change is shown with its affected-store count, requires confirmation and optimistic version checks, and is audited. It may update other stores that reference the same shared catalog entity.
3. HQ Account may manage cross-store catalog and store metadata and **exclusively** create/disable/reassign Staff accounts. Disable retains historical audit references and invalidates old sessions.
4. Inventory on-hand cannot be silently written by either account type: adjustment/stocktake + immutable inventory transactions are mandatory.
5. PR #156 proposal/second-person-review history remains available for reference but is no longer the prerequisite to a normal direct edit. The separate Meiping one-time migration correction workflow still uses its specific review rules.

## Consequences and limits

- A scoped Store Account can edit shared records that also affect other stores. Server must verify a real linked SKU in an authorized store, audit, enforce ISBN/price constraints and handle version conflicts. This is a deliberate product choice, **not** a grant of global account administration.
- Existing historical PR #155/#156 documents describe the limitations *at those earlier PR stages*; their claims are not the integrated final rules.
- Staging/production deployment and decisions such as future effective pricing, special franchises and HQ emergency recovery require separate owner approval.
