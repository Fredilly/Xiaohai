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
| `shop.dinosaursNeedBigHandCover` | `books/covers/dinosaurs-need-a-big-hand-v2.png` | `assets/books/book-dinosaurs-need-a-big-hand.jpg` |
| `shop.pewPewTigerCover` | `books/covers/pew-pew-tiger-v1.jpg` | `assets/books/book-pew-pew-tiger.jpg` |
| `shop.dodosHairyDayCover` | `books/covers/dodos-hairy-day-v1.jpg` | `assets/books/book-dodos-hairy-day.jpg` |
| `shop.yunsDiaryCover` | `books/covers/yuns-diary-v2.png` | `assets/books/book-yuns-diary.jpg` |

The version suffix makes replacement explicit: publish a new object such as `-v2.jpg` or `-v2.png`, verify it, then update the manifest. Do not overwrite a versioned object used by a released Mini Program.

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

The historical Issue #70 / PR #75 record reported HTTP 200 and source-file hash matches for the original five v1 assets, but **the old home v1 and Yun's Diary v1 did not decode**. The recovered home v2 JPEG (2496×1664), Yun's Diary v2 PNG (800×800), and dinosaur v2 PNG (799×800) have since passed owner-local public HTTPS download, image dimension decode, and byte-for-byte comparisons against valid originals. Although the dinosaur v1 JPEG decoded as 600×601, its rendered pixels were mostly gray compared with the correct colorful archived source. Two other cover v1 JPEGs decoded locally (PEW PEW TIGER 260×284, DoDo 260×293), but their visible content still needs separate quality inspection. File validity alone does not prove commerce UI rendering.

For the current release gate, GitHub CI, static file inventory, and deterministic tests are separate from WeChat DevTools screenshots and real-device evidence. Owner DevTools screenshots demonstrate a manually injected Home HERO with v2 JPEG rendering consistently at 16:02 and 16:03, plus a 200 image response. This is a **partial** image rendering PASS, not full CMS integration or shop/product/failure-state acceptance. Device checks remain outstanding.

## Home HERO v2 source and runtime evidence

The previous `home/hero/parent-child-reading-v1.jpg` is preserved for diagnosis but **must not be used**: the Git-tracked bundled source and downloaded BOS copy matched SHA-256, yet both failed macOS Preview and `sips` dimension decoding. WeChat DevTools `wx.getImageInfo` returned `getImageInfo:fail invalid` despite an HTTP 200 image response. A successful network request alone is not a visual acceptance.

For v2, the owner recovered the archived source `图片/3939cc01762a13ccd07eb8e462681c75.jpg` on their Mac. The file opened in macOS Preview, `sips` reported **2496 × 1664**, and the owner approved its embedded Chinese copy. The owner uploaded a new `home/hero/parent-child-reading-v2.jpg` object into the existing BOS bucket; the BOS console screenshot shows it alongside v1 (approximately 540 KB).

**Evidence:** the owner downloaded v2 over HTTPS, decoded 2496×1664 dimensions, and obtained `V2_MATCH_OK`. DevTools screenshots show the parent-child image displayed in a manually injected HERO with Network HTTP 200; the image remained present between 16:02 and 16:03. **Remaining:** real CMS HERO path and explicit CMS media precedence, plus real-device checks in #76. Do not interpret a manual `setData` test as CMS integration acceptance.

## Yun's Diary cover v2 source and verification

The prior `books/covers/yuns-diary-v1.jpg` gave `pixelWidth: <nil>` and `pixelHeight: <nil>` under macOS `sips` after public HTTPS download. The owner recovered the legacy original `图片/big_922c4ce3663df0954434a6f203c708d7.png`, confirmed the visible cover says "YUN'S DIARY / 归云日记", and checked it with macOS Preview and `sips` as an **800 × 800 PNG**. No format conversion or paid generation was performed.

The owner uploaded a separate `books/covers/yuns-diary-v2.png` object to the existing BOS bucket (the console shows both versions). The public URL then downloaded successfully, decoded at **800 × 800**, and `cmp` against the owner's local verified PNG returned **`V2_MATCH_OK`**. The v1 JPG remains preserved for diagnosis, but the Mini Program manifest now selects v2 PNG.

**Still pending:** WeChat DevTools shop-list and product-detail visual checks for this cover, as well as the other three previously decoded covers and image-error placeholders. Do not treat a valid downloaded object as proof the Mini Program UI has rendered it.

## Dinosaurs Need a Big Hand cover v2

The owner observed a mostly gray `books/covers/dinosaurs-need-a-big-hand-v1.jpg` in a manually injected Shop list and confirmed the same defective content in macOS Preview. Image dimensions were readable, so **successful decoding did not mean correct visual content**.

The corresponding archived original `图片/big_380ebb63a00b19c66daec2bff3637593.png` was shown in macOS Preview as the intended colorful yellow dinosaur book cover, with the title "Dinosaurs Need a Big Hand". The verified source was copied without conversion and uploaded as a separate versioned `books/covers/dinosaurs-need-a-big-hand-v2.png`. The owner-provided BOS object list shows v2 alongside retained v1. After public HTTPS download, macOS `sips` decoded v2 at **799 × 800**, and `cmp -s` against the local source returned **`V2_MATCH_OK`**.

The runtime manifest and checks now select v2 PNG. **Pending:** new WeChat DevTools Shop card and Product Detail visual screenshots for v2; assess the gray lower bands seen on the PEW PEW TIGER and DoDo covers rather than assuming those two v1 assets are fully correct. No DB seed, payment action, paid generation, or v1 overwrite was performed.

## Manual acceptance matrix

Do not mark an unexecuted row as PASS.

| Target | Network | Flow | Expected | Current status |
| --- | --- | --- | --- | --- |
| WeChat DevTools | Normal | Home editorial HERO | Stable v2 image in manually injected HERO and HTTP 200; real CMS override still unverified | PARTIAL PASS (manual injection screenshots) |
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
