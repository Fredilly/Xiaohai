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

`apps/miniapp/src/config/assets.ts` is the source of truth for deployed static image URLs. CMS and API media URLs still take precedence; the BOS objects are curated fallbacks for known editorial content only. A failed image request falls back to the existing no-cover or illustrated state and does not alter product, entitlement, payment, or inventory state.

The following assets intentionally remain local:

- `assets/brand/xiaohai-logo.png`
- `assets/tabbar/*.png`
- `assets/ui/*.svg`

## WeChat configuration

Before previewing with a real AppID, add this exact origin to the Mini Program **downloadFile legal domains** in the WeChat public platform:

`https://xiaohai-prod-assets.cd.bcebos.com`

This is an account-level setting and must not be simulated in `project.config.json`. Keep the safe tourist AppID and do not commit `project.private.config.json`.

## Verification checklist

Automated verification checks the manifest, TypeScript references, public HTTP status, MIME type, byte size, and SHA-256 equality with the selected source files. DevTools and real-device checks must use an authorized AppID and must be recorded honestly.

| Environment | Check | Status before manual validation |
| --- | --- | --- |
| HTTPS | Five versioned objects return `200 image/jpeg` and match source SHA-256 | PASS |
| Unit / static checks | Manifest origin, object keys, and fallback resolution | Automated in CI |
| WeChat DevTools | Home editorial fallback, shop covers, product cover, failure placeholder | BLOCKED until authorized AppID validation |
| iOS / Android | Normal network image display | BLOCKED until real-device validation |
| iOS / Android | Weak/offline load shows placeholders without blocking navigation | BLOCKED until real-device validation |

For weak-network testing, open the home, shop, and product-detail flows once with cache disabled or cleared; throttle or disconnect the network; confirm the page remains usable and the image region changes to the existing placeholder. Reconnect and retry/reopen to confirm recovery. Do not record an unexecuted row as PASS.
