# #208 Merchant product gallery — public read model (code-only)

**Stacked on [PR #210](https://github.com/Fredilly/Xiaohai/pull/210).** This first gallery
slice reads existing `product_media` rows without adding database tables or
enabling any image upload. **Do not merge/deploy without reviewed PR dependency
order and independent human approval.**

## Data flow

1. Product must be published/visible according to the existing API's
   `products.status=ACTIVE` and `skus.status=ACTIVE` guards. The single
   product detail endpoint fetches matching `product_media` rows in stable
   `display_order, id` order, bounded to 40 scanned records.
2. A conservative public URL sanitizer filters **HTTPS only**, max 2048 chars,
   duplicates, invalid/private/loopback hosts, credentials, query strings and
   fragments. Expiring BOS signed GET query links are **never** returned from
   the public gallery. At most **8** valid URLs are exposed as optional
   `mediaUrls` alongside the existing `coverUrl`.
3. Public catalog list contract stays compatible; the gallery is fetched only
   on a single product detail request. The Mini Program renders the real
   `coverUrl` first, else the first merchant gallery photo, else the existing
   curated book-only artwork fallback. Non-books never borrow cover artwork
   based on a similar title.
4. The product detail page shows tappable horizontal thumbnails (if more than
   one image), opens native `wx.previewImage`, and removes failed images while
   falling back to the next real photo.

## Evidence

- Pure URL sanitizer negative tests cover query-signed/private links,
  invalid schemes, credentials, loopback/private addresses, duplicate URLs,
  bounds and stable order.
- Fastify detail contract test verifies gallery exposure and backward
  compatibility with no `mediaUrls` field.
- Mini Program presentation tests verify unique URL order, preference for
  merchant actual photos and empty-cover fallback. No WeChat real-device or
  cloud network access is claimed by these tests.

## Not implemented in this PR

- **No image upload, crop/compress, secure BOS signed PUT, or gallery management
  editor** for HQ or Store. Existing `product_media` content is read-only
  here. A real upload pipeline requires a separately reviewed staff-only
  upload endpoint, owner/scope checks, key/type/size limits, valid HTTPS
  delivery origin, object ownership and removal audit.
- No public/private BOS bucket permissions are changed; never solve display
  403 by granting broad anonymous read or exposing signed query tokens.
- No food classification, food expiry/batch/ingredient inventory, stocking,
  payment or order checkout changes.
- Actual WeChat allowed download domains and signed/private image architecture
  must be independently verified on devices. On-host staging changes are
  **NOT authorized** (`STAGING_READY=false`, #195).
