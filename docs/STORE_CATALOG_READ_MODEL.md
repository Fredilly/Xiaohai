# Store Catalog Read Model / 门店日常商品资料（首阶段）

## Why
Current `/api/v1/staff/catalog/products` is GLOBAL-scoped and `catalog.manage`-gated. Its mutation endpoints edit shared book/product/SKU master records, potentially affecting *every* store. Do **not** grant that permission to store managers, and do not pass the HQ global edit endpoint into Store Web.

Meiping is a one-time historical migration tool. This PR establishes a **distinct, ordinary daily catalog read surface** in Store Web, before implementing staff edit proposals.

## Implemented
- `GET /api/v1/staff/stores/:id/catalog?q=&offset=&limit=`: Staff-authenticated, requires both `stores.read` and `inventory.read`, then checks the exact target store through the existing `StoreNetworkService.getStaffStore` RBAC+scope model.
- The database query begins with **`store_inventory`** filtered by the authenticated target store. Joins SKU, product, book edition and book metadata. No global all-products leakage. Includes DRAFT / ACTIVE / INACTIVE products already linked to a store-inventory record, including zero available stock. **Not** an exhaustive global catalog or an unreceived draft product list.
- Returns read-only SKU/price/metadata/inventory version and stock; 1–100 rows per page, offset and bounded keyword search.
- New `本店商品资料` Store Web module, visible with both `inventory.read` and `stores.read`. User can search/inspect only; no submit/edit button or write method.
- API tests cover auth, missing permissions, authenticated wrong-store 403, pagination validation and scoped success. Client and UI tests cover Bearer, store selection, error handling and no-write presentation.

## Safety
- All writes to formal products/books/SKUs remain **HQ GLOBAL catalog.manage only** under the unchanged existing routes.
- No DB schema migration, seed, catalog write or stock transaction in this PR.
- No consumer access, no production staging deployment by this PR.
- Real approval workflow for **daily product metadata corrections** (separate proposal table, immutable audit, second-person authorization, ID/ISBN/barcode checks, globally-shared vs store-owned field definitions) remains unimplemented and needs focused review. A single store manager must not silently rewrite globally shared ISBN or pricing for all stores.

## Browser UAT
Use a fresh Store Web worktree and only a disposable test DB with purpose-built books/SKUs/store_inventory links. The PR153 isolated database currently contains **zero formal book/product/SKU rows**, so an empty catalog screen is expected there and is not proof of query filtering. Do not seed into the existing PR153 database to fake UAT. No merge before tests.
