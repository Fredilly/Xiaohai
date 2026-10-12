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
| `home.parentChildReading` | `home/hero/parent-child-reading-v1.jpg` | `assets/brand/home-parent-reading.jpg` |
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
- all five versioned runtime object paths;
- runtime visual helpers no longer reference the removed bundled editorial files;
- HOME / shop / product images keep `binderror` fallbacks;
- image areas reserve stable dimensions to avoid material layout jumps.

The five migrated files are removed from the Mini Program source bundle.

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
