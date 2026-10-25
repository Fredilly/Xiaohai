# Daily Store Catalog Corrections / 门店日常商品纠错申请与独立复核

## Dependency and non-goals

**Integration checkpoint 2026-10-25:** PR #155 was merged to `main` (merge commit `a5c7f21`), and this PR was retargeted to `main`. We merged the latest approved main changes into this branch without force-push; the existing read-only catalog and two-store query test stay intact. This workflow is **not** Meiping historical Excel correction and is **not** HQ catalog CRUD. Global shared books/ISBN/price/SKU are never directly changed by a store, by ACCEPTED, or by this feature.

## Initial controlled business rule

A store staff member with stores.read + inventory.read + inventory.stocktake can request a **single field** correction against a SKU already linked to that store's inventory. An independent second person, separately granted catalog.correction.review and authorized for the same store, can ACCEPT or REJECT with a reason. Acceptance means the proposed correction was reviewed **for subsequent HQ action only**. It does not apply the proposal to canonical master data and cannot change sale status, quantities, stock transactions, prices or ISBNs.

Fields: product name, book title, author, publisher, ISBN and SKU price in integer minor units (0–2,147,483,647). ISBN / price / shared product fields have no local override; no direct store-owned mutable field exists in the present schema. A reviewer may need an HQ role or a specially granted store reviewer role; **the migration does not assign this permission to any production role**.

## Safety and versioning

- Staff identity, granular permissions and store scope are enforced server-side. The requested SKU must be linked to that store in store_inventory.
- The submission includes an expected inventory version from the store catalog read model, and records the current field value. Duplicate pending store/SKU/field requests are blocked.
- The reviewer cannot review their own request. Only PENDING entries can be decided and concurrent decisions use an atomic conditional update. Submission and ACCEPTED review use the **same PostgreSQL transaction connection** for reading the store-linked SKU and original master fields; rows are locked in a fixed order (inventory, SKU, product, edition, book), then canonical fields are **re-read after locks** to reject concurrent HQ edits rather than accepting a stale snapshot. An ACCEPTED recommendation remains non-binding and HQ must independently recheck before any future apply. ISBN recommendation acceptance serializes by proposed ISBN and rejects conflicts with live editions or previously accepted proposals for different products, even across stores.
- The list endpoint returns **bounded, pending-first, stable paginated** pages (default 30, maximum 100); Store Web offers previous/next navigation so older pending requests cannot be lost behind more than 50 completed requests. Integration coverage inserts 62 newer reviewed rows, verifies all pages and explicitly reviews the oldest pending record. A separate concurrent HQ title edit test checks rollback of stale ACCEPTED without any phantom review audit.\n- Writes are limited to a dedicated requests table and sanitized audit_logs records. Audit metadata contains field names, record identifiers and verdict, not free-text values or reasons.
- Production/staging data or permissions must not be seeded or modified merely for testing. Use a fresh disposable PostgreSQL DB with at least two virtual stores, separate applicant/reviewer accounts and purpose-built SKUs.

## Decisions Needed before any catalog mutation or release

1. Who may implement ACCEPTED **global** title/ISBN/publisher/price corrections in HQ? Who ultimately authorizes each field?
2. Which fields, if any, should be **store-owned** (for example local shelf placement / local signage)? These have no durable per-store columns today.
3. Should proposed price changes be limited by merchant/franchise ownership, and must changes be future-dated?

Do not add a direct apply endpoint until these are agreed and checked against current order-price snapshots and conflict handling.

## Acceptance and status

Draft until latest integrated HEAD CI and Fred review. PR CI, isolated PostgreSQL integration tests, UI manual acceptance, and staging deployment must be separately recorded; do not label this production-ready from route mocks alone. The catalog-correction PostgreSQL integration fixture now refuses database names outside `xiaohai_test` or the dedicated `xiaohai_pr156_test`; never run these mutating fixtures on the production or shared development database. The latest integrated GitHub CI verifies the disposable database only, not a real Store Web browser with independently authenticated staff accounts. Historical PR #154 manual cancellations and cross-store UAT remain BLOCKED without proper isolation.
