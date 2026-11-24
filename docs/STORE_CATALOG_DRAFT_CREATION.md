# Issue #208 — Store-created real merchandise drafts

**Stage:** Draft code only, no production or Staging writes performed by the
assistant. **This is stacked on Store edit PR #209** and must be reviewed/merged
only in that dependency order. No SQL/schema migration.

## Contract

An authenticated Staff member with `stores.read`, `catalog.edit`, and actual
scope access to the chosen Store may create **a non-public, non-purchasable
DRAFT product** from the Store Web. The Store editor UI currently supports
non-book products, including ordinary retail goods; books and food-specific
fields (allergens/lot/expiry) require further work.

- `POST /api/v1/staff/stores/:id/catalog/products` requires a valid
  `Idempotency-Key` (8–128 allowed characters), strict canonical
  `adminProductCreateInputSchema`, `status=DRAFT` and
  `sku.availableForSale=false`. The caller cannot specify a stock quantity.
- Actor identity and the **server-side** Store scope are checked before any
  database write. The `catalog.edit` permission is not `catalog.manage`,
  cannot grant GLOBAL rights, and does not enable staff account management.
- `CommerceService.createStoreDraftProduct` uses the same validated
  HQ `createAdminProduct` transaction, with **distinct Store-scoped
  idempotency/audit keys**. It atomically inserts product + SKU + an initially
  **zero-on-hand/zero-reserved** Store inventory association. Failure rolls
  all back; a browser retry with the same key returns the original product,
  and a changed request body with the same key conflicts instead of
  creating a second SKU.
- The new SKU/Store inventory association makes the draft discoverable to
  authorized Staff via existing scoped catalog read. The public Mini Program
  read service still filters `products.status=ACTIVE`; a Store draft is not
  publicly listed. Changing DRAFT to ACTIVE and physical stock movements are
  **not** provided by this form.
- The Store Web form accepts merchant name, optional SKU code (server generates
  an identifier if missing), specification/SKU name, exact CNY amount,
  description and optional HTTPS main image URL. **No uploaded image
  or actual real-data import** occurs in this code-only PR. A typed HTTPS URL
  is not a substitute for the separately authorized BOS upload/gallery workflow.

## Tests and safety checks

- Mocked Fastify route regressions: no login / wrong Store scope /
  missing `catalog.edit` denied; invalid create status, purchasable SKU,
  missing key invalid; correct creation returns a draft only.
- Disposable PostgreSQL integration: `assertMeipingApplyDisposableDatabase`
  runs **before pool creation**, and idempotent retry + one zero-stock
  association + actor audit are verified; changed same-key input and public
  ACTIVE request reject.
- The code must pass current-head CI and two distinct human reviews before
  any merge. Existing migrations and Staging deployment are untouched.

## Deliberately not claimed

- Store and HQ **full operational parity** requires later scoped editing of
  status, media and all SKU fields; cross-store ownership and price sharing are
  still undecided.
- Food category/expiry/lot model, prepared drinks recipes, stock availability
  by selected store, uploads and payment remain separate tasks under #208.
- No real merchant records have been imported or published. Current Staging
  still has disk/approval blockers under #195 and `STAGING_READY=false`.
