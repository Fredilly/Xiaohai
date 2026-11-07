# Issue #208 — Store-scoped catalog shared-field editing (first implementable slice)

**Status:** Code-only draft. This does not authorize any live Staging/production write,
deployment, or data migration. It does **not** implement full HQ/Store parity yet.

## Product requirement

The latest operator-approved direction in [Issue #208](https://github.com/Fredilly/Xiaohai/issues/208)
is **the same daily business capabilities in Store Web and HQ Admin Web**;
only HQ has the extra staff account, role and authorization management module.
The old blanket assertion that **only HQ** may edit product names and prices
is not the intended end-state. Still, Store staff must not affect unrelated
stores without a reviewed cross-store ownership/price policy.

## This PR implements (safe first subset)

A Store staff account with `stores.read`, `catalog.edit` and authenticated
access to the exact Store can edit its already-associated product's **name
and price** and its own shelf/notes/display. A change to name or price:
1. Uses the exact current product/SKU/local versions.
2. Requests the existing **HMAC-signed impact preview** scoped to store, SKU,
   actor and exact proposed fields. Only **one affected store, the authorized
   store itself**, is eligible.
3. On write, the existing service locks the entire related book/edition/
   product/SKU graph and rechecks the same affected-store set.
4. Any second store linked before write, stale versions, missing/forged/expired
   preview, or changed fields **aborts atomically with 403 or 409**, preserving
   both stores' records. The prior `GLOBAL`-scoped HQ multi-store preview path
   remains unchanged; Store permissions never grant `catalog.manage`.
5. Audit log records actor, exact impacted store IDs, before and after values,
   changed fields and version evidence. Direct inventory counts **are not edited**.

The UI labels this as **single-store item editing**; multi-store shared
catalog master updates remain disabled from Store Web until business ownership,
cross-store price and propagation decisions are resolved. This is a deliberate
safety limitation, **not** the final product scope.

## Regression

- Route tests assert `STORE_ONLY` policy, authorization and preview-token
  forwarding; they reject cross-store impact errors.
- New disposable-database test checks single-store name+price save and audit,
  missing impact acknowledgement, then introduces a second Store association
  **after** a signed preview and verifies no master/stock change.
- Reuses `assertMeipingApplyDisposableDatabase(process.env)` **before** opening
  the test pool: only allowlisted local disposable DBs, matching
  `DATABASE_URL`/`TEST_DATABASE_URL` under NODE_ENV=test.
- Frontend unit tests verify price precision and limits; no fractional cent,
  negative or overflow amount reaches API.

## Next independently reviewable changes

1. Finalize Store-created product ownership and any per-store pricing policy,
   then implement *new product* creation + SKU linking, and audited cross-store
   edits or store-local overrides without granting Store account administration.
2. Unify HQ/Store real product image management and image gallery via allowed
   BOS object storage/HTTPS URLs; keep image access and ownership secure.
3. Add food/drink type, specs, lot expiry and per-store sellable quantity
   with server-side checkout guards. Fresh-drink recipe/ingredient stock remains
   a separate undecided operational rule.
4. Add real UAT for both staff clients and WeChat images/cart once Staging
   capacity/approvals and HTTPS hosting gates are satisfied.

**Do not set `STAGING_READY=true`, merge to `main`, or run DB migrations as
a consequence of this PR.** No SQL schema or migration files are changed.
