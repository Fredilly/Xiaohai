# Mini Program Baidu BOS assets

Issue #70 moves selected large editorial images out of the Mini Program bundle. Small UI assets remain local so navigation, placeholders, and brand chrome do not depend on the network.

## Deployment

- Bucket: `xiaohai-prod-assets`
- Region: Southwest China (Chengdu)
- Endpoint: `cd.bcebos.com`
- Public asset origin: `https://xiaohai-prod-assets.cd.bcebos.com`
- Access: public read; write access remains controlled in Baidu Intelligent Cloud

No access key, secret key, private Bucket configuration, or Baidu Netdisk share URL is stored in the repository.

| Runtime logical asset | BOS object key | Source removed from bundle |
| --- | --- | --- |
| `home.parentChildReading` | `home/hero/parent-child-reading-v2.jpg` | `assets/brand/home-parent-reading.jpg` |
| `shop.dinosaursNeedBigHandCover` | `books/covers/dinosaurs-need-a-big-hand-v1.jpg` | `assets/books/book-dinosaurs-need-a-big-hand.jpg` |
| `shop.pewPewTigerCover` | `books/covers/pew-pew-tiger-v1.jpg` | `assets/books/book-pew-pew-tiger.jpg` |
| `shop.dodosHairyDayCover` | `books/covers/dodos-hairy-day-v1.jpg` | `assets/books/book-dodos-hairy-day.jpg` |
| `shop.yunsDiaryCover` | `books/covers/yuns-diary-v1.jpg` | `assets/books/book-yuns-diary.jpg` |

The version suffix makes replacement explicit: publish a new object such as `-v2.jpg`, verify it, then update the manifest. Do not overwrite a versioned object used by a released Mini Program.

## Runtime boundary

`apps/miniapp/src/config/assets.ts` is the source of truth for deployed static image URLs.

- Explicit CMS/API media URLs keep precedence.
- A media-less HOME HERO uses the curated BOS home fallback.
- Known book titles without an API cover use their matching BOS cover fallback.
- A failed image request falls back to the existing illustration/no-cover state.
- Image failure never changes product, entitlement, payment, inventory, or other business state.

These assets intentionally remain local:

- `assets/brand/xiaohai-logo.png`
- `assets/tabbar/*.png`
- `assets/ui/*.svg`

## WeChat configuration

Historical #70 acceptance evidence records that the authorized Xiaohai Mini Program has this exact origin under **downloadFile legal domains**:

`https://xiaohai-prod-assets.cd.bcebos.com`

This is an account-level setting and must not be simulated in `project.config.json`. Keep the safe tourist AppID in tracked config and never commit `project.private.config.json`.

## Automated verification

CI verifies:

- the approved HTTPS BOS origin;
- the five migrated large images remain absent from the bundled assets directory;
- all five versioned runtime object paths;
- runtime visual helpers no longer reference the removed bundled editorial files;
- HOME / shop / product images keep `binderror` fallbacks;
- image areas reserve stable dimensions to avoid material layout jumps.

The five migrated files are removed from the Mini Program source bundle.

## Current evidence status

The historical Issue #70 / PR #75 record reported HTTP 200 and source-file hash matches for the original five v1 assets, but **the old home v1 proved undecodable**; HTTP 200 and matching hashes did not establish usable imagery. The four book-cover v1 objects still require their own decode and visual checks. The home v2 upload is shown in the owner's BOS console; public fetch/decode and DevTools acceptance remain pending.

For the current release gate, GitHub CI, static file inventory, and deterministic tests are separate from WeChat DevTools screenshots and real-device evidence. This PR does **not** claim that live image loading or network recovery on a device has been demonstrated. A fresh runtime network check is still required before marking #70 complete.

## Home HERO v2 source and runtime evidence

The previous `home/hero/parent-child-reading-v1.jpg` is preserved for diagnosis but **must not be used**: the Git-tracked bundled source and downloaded BOS copy matched SHA-256, yet both failed macOS Preview and `sips` dimension decoding. WeChat DevTools `wx.getImageInfo` returned `getImageInfo:fail invalid` despite an HTTP 200 image response. A successful network request alone is not a visual acceptance.

For v2, the owner recovered the archived source `图片/3939cc01762a13ccd07eb8e462681c75.jpg` on their Mac. The file opened in macOS Preview, `sips` reported **2496 × 1664**, and the owner approved its embedded Chinese copy. The owner uploaded a new `home/hero/parent-child-reading-v2.jpg` object into the existing BOS bucket; the BOS console screenshot shows it alongside v1 (approximately 540 KB).

**Pending before marking PASS:** a fresh HTTPS fetch and image decode of the public v2 URL, stable real image display in WeChat DevTools with Network evidence, and explicit CMS media precedence; later, real-device checks in #76. The assistant's environment could not independently resolve the BOS hostname, so upload listing is not proof of successful public retrieval or decode. This PR updates the versioned URL for controlled verification, not as a claim of final acceptance.

## Manual acceptance matrix

Do not mark an unexecuted row as PASS.

| Target | Network | Flow | Expected | Current status |
| --- | --- | --- | --- | --- |
| WeChat DevTools | Normal | Home editorial HERO | BOS image loads in reserved area; explicit CMS media still wins | PENDING SCREENSHOT |
| WeChat DevTools | Normal | Shop → known book | Correct BOS cover loads; unrelated item keeps “暂无封面” | PENDING SCREENSHOT |
| WeChat DevTools | Normal | Product detail | Correct BOS cover loads in fixed cover area | PENDING SCREENSHOT |
| DevTools | Forced image failure | Home / shop / product | Existing placeholder appears; business state remains usable | PENDING SCREENSHOT |
| iPhone | Normal / weak | Home → shop → product | BOS images load or fail safely without broken navigation | BLOCKED BY #76 |
| Android | Normal / weak | Home → shop → product | BOS images load or fail safely without broken navigation | BLOCKED BY #76 |

Issue #76 owns the separate real-device API reachability problem where the Mini Program development environment still depends on `127.0.0.1`. Do not solve that problem in #70 by committing a developer LAN IP or changing API/server/payment/database behavior.

## Rollback

Rollback is a reviewed code change only. Do not delete or overwrite BOS objects during an incident.

1. Point `miniappRemoteAssets` back to the last verified versioned object, or revert the release commit.
2. Run Mini Program checks, tests, lint/typecheck, and CI.
3. Compile and preview with the authorized Mini Program configuration.
4. Verify home, shop, product detail, and failure placeholders.
5. Retain the affected BOS object for diagnosis; remove it only through a separately reviewed storage-lifecycle decision.
