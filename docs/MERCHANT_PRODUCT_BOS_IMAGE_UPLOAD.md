# #208: Store + HQ merchant product image upload (draft-only slice)

**Implementation state:** Code-only Draft PR, stacked on #212 → #210. No live
BOS upload, real merchant database insert, deployment, or production access is
performed by this change. This is **not** full Store/HQ media parity yet.

## User flow

- A Store employee with `stores.read` + `catalog.edit` and the authenticated
  data scope for that **exact Store** selects a DRAFT product. The upload is
  allowed only if that product is associated with **exactly this one Store**.
  Sharing it with any other Store prevents the Store-side upload.
- HQ staff with `catalog.manage` and true `GLOBAL` data scope can upload to
  an eligible DRAFT product through the same service, not by bypassing auth.
- Both web apps support `<input type=file>` for PNG, JPEG and WebP up to
  **2 MiB**. Images go through a permission-protected API, not to an
  unauthenticated browser-writable public BOS bucket.
- The API validates canonical Base64 and image signature/size, checks
  the **expected product version**, requires DRAFT, and checks current
  Store relationships. After a dedicated least-privilege BOS PUT, a transaction
  locks the product and every SKU, rechecks relationship scope and version,
  attaches the new image in existing `product_media` (up to 8 entries),
  fills `products.cover_url` only if empty, advances product version,
  and writes an audit event. Content-addressed keys use
  `products/{productUUID}/images/{sha256(bytes)}.{ext}`: retrying the exact
  bytes cannot silently overwrite a different photo.
- Existing #212 read route exposes approved public gallery URLs on consumer
  product detail, once the corresponding product is separately made ACTIVE.
  Uploading a DRAFT picture **does not publish that product**.

## Required manual operational configuration (not performed by CI)

The image upload adapter is intentionally **fail-closed** and returns 503 until
the operator injects separate Merchant images IAM credentials and bucket
configuration into the **API runtime**:

```text
PRODUCT_BOS_ENDPOINT=https://cd.bcebos.com
PRODUCT_BOS_BUCKET=<approved-dedicated-merchant-bucket>
PRODUCT_BOS_PUBLIC_ORIGIN=https://<bucket>.cd.bcebos.com
PRODUCT_BOS_ACCESS_KEY_ID=<runtime-secret-not-in-git>
PRODUCT_BOS_SECRET_ACCESS_KEY=<runtime-secret-not-in-git>
```

For actual use, the owner must verify these match one approved bucket, a
minimal scoped write policy limited to `products/*/images/*`, existing
approved asset-read access (not anonymous write), the actual allowed Mini
Program download domain, published image rights, and backup/asset lifecycle.
Never reuse private picture-book entitlement/playback credentials, leak signed
URLs, or relax an entire storage bucket's access policy to make a preview work.

Missing/placeholder/mismatched config results in **MEDIA_UNAVAILABLE (503)**.
No API credential, production Secret, object-storage upload, or actual
permissions are committed here.

## Safety and known gaps

1. **Active products are intentionally excluded.** Multi-store gallery
   editing, replacing/deleting/reordering pictures, setting the main cover
   explicitly, and in-stock/checkout guarantees require distinct guarded
   business flows. A Store must not silently affect other Store records.
2. A successful BOS upload followed by an optimistic DB conflict may leave a
   public but **unreferenced** immutable object. This implementation never
   deletes unknown BOS objects automatically. Before production release,
   design a scoped, dry-run-first orphan review/retention mechanism with
   owner approval, and verify behavior during concurrent edits.
3. File signatures are a basic gate, **not** complete decode/malware or
   actual display verification. A production hardening step should decode
   images with a vetted library or image-processing worker, check dimensions,
   reject decompression bombs and metadata abuse, normalize orientation, and
   verify on real WeChat devices.
4. 2 MiB raw images are JSON Base64-encoded and received under the Fastify
   per-route 3 MiB limit. Rate limiting, reverse proxy body limits, retry
   behavior and API memory must be validated in the target environment before
   allowing customer uploads at scale.
5. No database migration is necessary; existing `product_media` and
   `products.version` are used. No image, inventory, food expiry or paid
   transaction is altered on the deployed environment.

## Tests / release gate

- Route tests: no session, invalid MIME, Store scope/permission denied,
  no HQ GLOBAL privilege, safe 403/409/503 mapping.
- Storage tests: disabled/malformed config, exact bucket + object path, no
  credential exposure.
- Disposable PostgreSQL tests: first photo + cover + audit, duplicate
  content hash, stale version, second Store association, ACTIVE item reject.
- Store and HQ UI smoke tests for real upload controls.
- Required before merge: current-head green CI **and two independent human
  reviews**. Required before real merchant use: authorized runtime config,
  nonproduction upload → DB audit → public read verification, image
  integrity/decoding, miniapp DevTools plus real iOS/Android checks, and
  staging/production gate review. `STAGING_READY=false` remains unchanged.

Related: #208, PRs #209, #210, #211, #212, #195.
