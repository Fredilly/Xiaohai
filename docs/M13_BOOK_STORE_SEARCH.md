# M13 Book + Store Inventory Search / 找书与门店库存搜索

## Goal

M13 connects the existing catalog and M12 store network with a public, searchable inventory read model.

Users must be able to search by **title / author / publisher / ISBN / barcode-or-SKU code** and see which active stores currently have stock, including sale/rental availability and clear entry points to later purchase, rental, pickup and delivery flows.

M13 is a **search/read milestone**. It does not implement M14 stock operations, M15 rental order state, or M16 pickup/delivery fulfillment.

## Governing rules

- PostgreSQL remains the inventory source of truth.
- `store_inventory` is the materialized current balance keyed by `(store_id, sku_id)`.
- Search never trusts client-provided store/region identifiers for authorization. Public inventory exposes only active catalog items in active store hierarchy.
- M13 introduces no public stock mutation API.
- Any future stock mutation must write immutable `inventory_transactions`; operational mutation flows belong to M14+.
- Redis/search indexes, if introduced later, are not canonical stock.

## Data model

M13 establishes the current-balance inventory table defined by `DATABASE_DESIGN.md`:

`store_inventory(store_id, sku_id, on_hand, reserved, rental_reserved, version)`

Availability is derived, never persisted separately:

`available = max(0, on_hand - reserved - rental_reserved)`

For M13 public discovery:

- sell available = `available > 0` and the SKU is active + `available_for_sale = true`;
- rent available = `available > 0` as a discovery signal only. M15 owns rental eligibility, reservations, fees and lifecycle rules;
- pickup/delivery buttons are navigation entry points only until M16 implements fulfillment.

The existing SKU `code` participates in barcode/code search. M13 does not invent a second barcode value without a confirmed Meiping mapping.

## Public API

### `GET /api/v1/inventory/books`

Query fields:

- `q`: optional title/author/publisher/ISBN/SKU-code search, max 120 chars;
- `availability`: `ANY | SALE | RENT`;
- `storeId`, `regionId`, `city`;
- optional `latitude`, `longitude`, `radiusKm` for nearby stock;
- `limit` bounded to 1..100, default 50.

Coordinates must be supplied as a pair. `radiusKm` requires coordinates.

Response rows contain catalog identity, SKU/price, store summary, current stock counts, derived available quantity, sell/rent flags and optional server-computed distance.

Only rows from active products, active SKUs, active stores, active regions and active franchisees (when present) are public.

## Mini Program

- Add a dedicated `找书` page reachable from `胖竹全球`.
- Text search uses the same API.
- `wx.scanCode` may fill the search input with ISBN/barcode/SKU code before requesting the API.
- Results show title, author, ISBN/publisher, store, address, stock quantity, sale/rent state and distance when location is used.
- Store result opens M12 store detail.
- Buy opens the existing M5 product detail.
- Rent/pickup/delivery remain clearly marked future-flow entry points until M15/M16.

## M14 boundary

M13 must not add supplier, procurement, receipt, issue, adjustment, stocktake, transfer or alert workflows. It must not add arbitrary quantity-edit endpoints.

M14 owns inventory mutations, immutable movement writing, idempotency, concurrency control, authorization and audit for operational stock changes.

## Automated acceptance

- Contract validation for query bounds and coordinate pairing.
- Search by title, author, publisher, ISBN and SKU code.
- Public results exclude inactive product/SKU/store/region/franchisee rows.
- `SALE` filtering respects `available_for_sale` and positive derived availability.
- `RENT` filtering requires positive derived availability.
- Nearby search enforces radius and sorts by server-computed distance.
- Limit is bounded and enforced in SQL.
- Database constraints reject negative stock counters and invalid reservation totals/version.
- Mini Program service tests cover encoded query parameters and non-2xx error handling.

## Manual acceptance

In WeChat DevTools / real device:

1. Open `胖竹全球` → `找书`.
2. Search by title/author/ISBN/code and verify matching stores.
3. Test an empty result.
4. Use scan-code input where available.
5. Use nearby stock and verify location permission/error behavior.
6. Open a store result and return.
7. Open a purchasable product result and return.

## Deferred

- Dedicated rental eligibility policy and rental order lifecycle: M15.
- Pickup codes, delivery zones/fees/provider adapter: M16.
- Supplier/procurement/receipt/issue/adjustment/stocktake/transfer/alerts: M14.
- Production Meiping inventory cutover and `INITIAL_MIGRATION` transaction emission: M26.
