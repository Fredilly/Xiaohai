# M12 Pangzhu Stores / 胖竹门店网络

## Scope

M12 implements the physical store directory and organization hierarchy required by Pangzhu Global:

`HQ -> Region -> Franchisee -> Store -> Staff`

Included in M12:

- Regions, franchisees and stores as PostgreSQL source-of-truth entities.
- Public active-region and active-store discovery APIs.
- Store name, country, city, region and service filtering.
- Nearby-store search using client coordinates with server-computed distance and radius filtering.
- Public store detail including address, coordinates, phone, opening hours and service items.
- Native WeChat Mini Program map, nearby-location flow, store list and store detail/navigation UI.
- Staff read/manage APIs protected by existing Staff authentication, RBAC and Data Scope.

Explicitly not included in M12:

- Book/title/author/ISBN/barcode search.
- Store inventory availability, sell/rent availability or inventory mutations.
- Purchase, rental, pickup or delivery workflows.
- Full Store Web operational UI or HQ Admin store administration UI.

Those remain later milestones (M13+ and M19/M20) and are not silently implemented here.

## Database

Migration: `packages/db/migrations/0014_pangzhu_stores.sql`

Tables:

- `regions`
- `franchisees`
- `stores`

Important integrity rules:

- Region, franchisee and store codes are unique.
- Franchisees reference a valid region.
- Stores reference a valid region and optionally a valid franchisee.
- Store latitude is constrained to `[-90, 90]` and longitude to `[-180, 180]`.
- Operational status is explicit (`ACTIVE` / `INACTIVE`).
- Public APIs expose only active stores whose parent region and optional franchisee are active.

No inventory quantity is stored or mutated by M12.

## Public API

All routes are versioned under `/api/v1`.

### Regions

`GET /api/v1/stores/regions`

Returns active public regions ordered for display.

### Store list / search

`GET /api/v1/stores`

Supported query parameters:

- `q` - store-name search.
- `country` - country code or country name.
- `city` - city filter.
- `regionId` - region UUID.
- `service` - exact service item match, case-insensitive.
- `latitude` + `longitude` - enables distance calculation and nearest-first ordering.
- `radiusKm` - optional positive radius, max 200 km; coordinates are required when provided.

Latitude and longitude must be supplied together. Distance is computed server-side; client-supplied values never grant authorization.

### Store detail

`GET /api/v1/stores/:id`

Returns an active public store or `404` if the store is missing or not publicly active.

## Staff API / RBAC + Data Scope

Permissions:

- `stores.read`
- `stores.manage`

Routes:

- `GET /api/v1/staff/stores`
- `GET /api/v1/staff/stores/:id`
- `POST /api/v1/staff/stores/regions`
- `PATCH /api/v1/staff/stores/regions/:id`
- `POST /api/v1/staff/stores/franchisees`
- `PATCH /api/v1/staff/stores/franchisees/:id`
- `POST /api/v1/staff/stores`
- `PATCH /api/v1/staff/stores/:id`

Authorization is resolved from the authenticated Staff identity on the server. Client-provided `regionId`, `franchiseeId` or store IDs do not create access.

Hierarchy expansion is limited to proven relationships in PostgreSQL:

- `GLOBAL` can access all store-network resources allowed by permission.
- `REGION` can access descendant franchisees/stores in that region.
- `FRANCHISEE` can access stores belonging to that franchisee.
- `STORE` can access that exact store.

Creating a store under another region/franchisee is denied even if the client submits those IDs.

## Mini Program

`pages/global/global` now uses the real M12 API instead of demo store data.

It supports:

- Store-name search.
- Region selector.
- Native `map` markers.
- "附近门店" using `wx.getLocation` with a 50 km default radius.
- Location permission failure state.
- Empty/loading/error states.
- Store cards linking to `pages/store-detail/store-detail`.

Store detail supports:

- Address, opening hours, phone and services.
- Native map marker.
- `wx.openLocation` navigation.
- `wx.makePhoneCall` when a phone number exists.

`app.json` declares the user-location purpose and `getLocation` private API requirement. Real-device privacy/permission behavior must still be validated before release.

## Errors and logging

Store-network API input is validated with Zod.

Expected API errors use the existing consistent shape and include request IDs:

- `400 INVALID_REQUEST`
- `401 STAFF_AUTHENTICATION_REQUIRED`
- `403 STAFF_FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`
- `500 INTERNAL_ERROR`

Failed store-network requests emit structured warning logs with request ID and error code. Sensitive values are not logged by this module.

## Automated validation

Coverage added for:

- Store contracts and invalid query combinations.
- Public active-store visibility.
- Name/region/service filters.
- Nearby radius filtering and server distance ordering.
- REGION and FRANCHISEE descendant Data Scope expansion.
- Cross-scope forged create attempts.
- Database uniqueness, foreign key and coordinate constraints.

Repository verification before merge should include:

```bash
pnpm check
pnpm --filter @xiaohai/db db:check
pnpm --filter @xiaohai/db db:migrate
pnpm test:integration
pnpm test:e2e
```

## Manual WeChat validation required

Automated tests cannot prove device map/privacy behavior. Before M12 acceptance, validate in WeChat DevTools and at least one real device:

1. Open `胖竹全球` and confirm real API loading, map and store list.
2. Search by store name and switch region filters.
3. Tap `附近门店`, approve location permission and confirm nearest-first results.
4. Deny location permission and confirm a safe error state without breaking other store search.
5. Open a store detail and verify map coordinates, opening information and services.
6. Tap map navigation and confirm WeChat opens the correct destination.
7. If a phone number exists, confirm contact action uses the displayed store phone.

## Decisions / follow-up

- Map provider abstraction, book/store inventory lookup and fulfillment entry points belong to later milestones.
- M12 does not assume inventory, rental, pickup or delivery capability simply because a store exists.
- Full Store Web and HQ Admin operational screens remain M19/M20 rather than being pulled forward into M12.
