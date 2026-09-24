# Mini Program Baidu BOS assets

Issue #70 moves the selected large editorial images out of the Mini Program bundle. Small UI assets remain local so navigation, placeholders, and the brand mark do not depend on the network.

## Deployment

- Bucket: `xiaohai-prod-assets`
- Region: Southwest China (Chengdu)
- Endpoint: `cd.bcebos.com`
- Public asset origin: `https://xiaohai-prod-assets.cd.bcebos.com`
- Access: public read; write access remains controlled in Baidu Intelligent Cloud

No access key, secret key, private Bucket configuration, or Baidu Netdisk share URL is stored in the repository.

| Runtime logical asset | BOS object key | Source removed from bundle |
| --- | --- | --- |
| `home.parentChildReading` | `home/hero/parent-child-reading-v1.jpg` | `assets/brand/home-parent-reading.jpg` |
| `shop.dinosaursNeedBigHandCover` | `books/covers/dinosaurs-need-a-big-hand-v1.jpg` | `assets/books/book-dinosaurs-need-a-big-hand.jpg` |
| `shop.pewPewTigerCover` | `books/covers/pew-pew-tiger-v1.jpg` | `assets/books/book-pew-pew-tiger.jpg` |
| `shop.dodosHairyDayCover` | `books/covers/dodos-hairy-day-v1.jpg` | `assets/books/book-dodos-hairy-day.jpg` |
| `shop.yunsDiaryCover` | `books/covers/yuns-diary-v1.jpg` | `assets/books/book-yuns-diary.jpg` |

The version suffix makes replacement explicit: publish a new object such as `-v2.jpg`, verify it, then update the manifest. Do not overwrite a versioned object used by a released Mini Program.

## Runtime boundary

`apps/miniapp/src/config/assets.ts` is the source of truth for deployed static image URLs. Explicit CMS/API media URLs still take precedence. A media-less home `HERO` uses the curated BOS home fallback, and known book titles without an API cover use their matching BOS cover fallback. A failed image request falls back to the existing no-cover or illustrated state and does not alter product, entitlement, payment, or inventory state.

The following assets intentionally remain local:

- `assets/brand/xiaohai-logo.png`
- `assets/tabbar/*.png`
- `assets/ui/*.svg`

## WeChat configuration

The authorized Xiaohai Mini Program has been configured with this exact origin under **downloadFile legal domains**:

`https://xiaohai-prod-assets.cd.bcebos.com`

This is an account-level setting and must not be simulated in `project.config.json`. Keep the safe tourist AppID in the tracked project config and do not commit `project.private.config.json`.

## Verification checklist

Automated verification checks the manifest, TypeScript references, public HTTP status, MIME type, byte size, and SHA-256 equality with the selected source files. DevTools and real-device checks must use the authorized Mini Program environment and must be recorded honestly.

| Environment | Check | Status before manual validation |
| --- | --- | --- |
| HTTPS | Five versioned objects return `200 image/jpeg` and match source SHA-256 | PASS |
| Unit / static checks | Manifest origin, object keys, and fallback resolution | Automated in CI |
| WeChat account config | BOS origin present in `downloadFile` legal domains | PASS |
| WeChat DevTools | Home BOS hero fallback, shop covers, product cover, failure placeholder | Manual check required |
| iOS / Android | Normal network image display | Blocked by separate API reachability Issue #76 until staging API is available |
| iOS / Android | Weak/offline load shows placeholders without blocking navigation | Blocked by separate API reachability Issue #76 until staging API is available |

For weak-network testing, open the home, shop, and product-detail flows once with cache disabled or cleared; throttle or disconnect the network; confirm the page remains usable and the image region changes to the existing placeholder. Reconnect and retry/reopen to confirm recovery. Do not record an unexecuted row as PASS.

## Manual acceptance checklist

DevTools may temporarily disable legal-domain validation for local visual debugging only. A result obtained that way is not release approval and does not replace the public-platform `downloadFile` domain configuration or real-device validation.

| Target | Network | Flow | Expected | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| WeChat DevTools | Normal | Home editorial section | BOS image loads inside the reserved hero area; CMS media still wins when present | PENDING | Add screenshot and DevTools version |
| WeChat DevTools | Normal | Shop → known book | Correct BOS cover loads; unrelated/no-cover item keeps “暂无封面” | PENDING | Add screenshots |
| WeChat DevTools | Normal | Product detail | Correct BOS cover loads inside the fixed-height cover area | PENDING | Add screenshot |
| iPhone | Normal | Home → shop → product | Images load without broken controls or material layout movement | BLOCKED BY #76 | Record device, iOS, WeChat version, screenshots |
| Android | Normal | Home → shop → product | Images load without broken controls or material layout movement | BLOCKED BY #76 | Record device, Android, WeChat version, screenshots |
| iPhone | Weak/offline | Home → shop → product | Failed images switch to illustration/no-cover UI; navigation remains usable | BLOCKED BY #76 | Record network profile and video/screenshots |
| Android | Weak/offline | Home → shop → product | Failed images switch to illustration/no-cover UI; navigation remains usable | BLOCKED BY #76 | Record network profile and video/screenshots |
| DevTools or device | Forced invalid image request | Home, shop, product | `binderror` fallback appears and no business state changes | PENDING | Record method and screenshots |

Issue #76 owns the separate problem where a real phone cannot reach the development API because `develop` currently points at `127.0.0.1`. Do not solve that problem in Issue #70 by committing a developer LAN IP or changing API/server/payment/database behavior.

## Rollback

Rollback is a code-only manifest change; do not delete or overwrite BOS objects during an incident.

1. Revert the release commit that changes `miniappRemoteAssets`, or point a logical asset to the last verified versioned BOS object.
2. Run `pnpm check:miniapp`, Mini Program tests, typecheck, and `git diff --check`.
3. Compile and preview with the authorized AppID, then verify home, shop, product detail, and failure placeholders.
4. Publish the corrected Mini Program through the normal reviewed release process.
5. Retain the affected versioned object for diagnosis and audit. Remove it only through a separately reviewed storage-lifecycle decision.

The previous Git-bundled large images remain recoverable from repository history, but restoring them is an emergency fallback that requires a reviewed code change; it is not performed by changing Bucket permissions or weakening legal-domain checks.
