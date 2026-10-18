# PR #133 — Pangzhu Global acceptance evidence

- UI source commit: `86ad52e2877da8bdd2b67de4096156fa9f269042`; evidence update commit is recorded by Git history for this report.
- Test date: 2026-10-18 (Asia/Shanghai)
- Environment: WeChat DevTools simulator, iPhone 12/13 Pro profile, reported window 390×671 CSS px (screenshots 780×1342 px), isolated API on `127.0.0.1:3000` backed by the issue-113 test database. No production data was used.
- These are real DevTools screenshots, not browser prototypes or real-device evidence.

## Screenshots

- [global-ready.png](./global-ready.png) — initial loaded viewport: storybook styling, search, region picker, nearby entry, native Tencent map, one marker, and `1` store.
- [global-scroll-1000.png](./global-scroll-1000.png) — lower viewport: map/data note, the test store card, service entries, and franchise entry.
- [global-empty.png](./global-empty.png) — actual page empty state after the isolated API returned HTTP 200 with `stores: []` for `NO_MATCH_PR133`.
- [global-error.png](./global-error.png) — actual page error state with quantity unknown and visible retry control after an isolated `wx.request` failure mock; no production request was made.
- [global-location-denied.png](./global-location-denied.png) — actual page response to an isolated `wx.getLocation` authorization-denied callback.
- [global-375-manual-screen.png](./global-375-manual-screen.png) — real DevTools screen capture after the user manually selected 375px; visual-only evidence, not an automator `windowWidth` reading.
- [global-430-manual-screen.png](./global-430-manual-screen.png) — real DevTools screen capture after the user manually selected 430px; visual-only evidence, not an automator `windowWidth` reading.

The only store shown is the explicitly labelled isolated fixture `[TEST-ISSUE113] 虚构成都门店`; its address and opening text are marked test-only. It is not a production or fabricated business listing.

## Result matrix

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Loaded layout, green storybook visual system, search and region controls | PASS | `global-ready.png` |
| Native map renders with Chengdu labels and marker | PASS | `global-ready.png`; map is the real DevTools `map` component |
| Store card, address, opening text and service tag render | PASS | `global-scroll-1000.png` |
| Map marker exactly matched to a store ID | NOT TESTED | Runtime `page.data()` introspection hangs; screenshot visibly shows one marker and one store, but ID-level correspondence was not asserted |
| 320px viewport adaptation | PASS | `global-320.png`; automator reported `windowWidth=320`, no visible horizontal overflow |
| 375px viewport adaptation | PASS (manual visual) | `global-375-manual-screen.png`; user selected 375px, no visible horizontal overflow or text clipping; `windowWidth` was not programmatically read |
| 430px viewport adaptation | PASS (manual visual) | `global-430-manual-screen.png`; user selected 430px, no visible horizontal overflow or text clipping; `windowWidth` was not programmatically read |
| No-match empty state in the page | PASS | `global-empty.png`: page visibly shows `0 家门店`, map empty state and `没有找到门店` after the real isolated API response |
| API error state and recovery | PASS / NOT TESTED | `global-error.png` shows quantity unknown, both error cards and `重试`; the same session restored the real API and returned to 1 store. Physical button tap was not asserted |
| Location denied handling | PASS (isolated callback) / NOT TESTED (real permission dialog) | `global-location-denied.png` shows the permission guidance and retry control after a safe `wx.getLocation` denial callback |
| Store detail navigation | PASS | Safe runtime route reached `pages/store-detail/store-detail` using the ID of the isolated ACTIVE fixture; no write was performed |
| Book search navigation | PASS | Safe runtime route reached `pages/book-search/book-search` |
| Rental navigation | PASS | Safe runtime route reached `pages/rentals/rentals` |
| Franchise navigation | PASS | Safe runtime route reached `pages/franchise-apply/franchise-apply` |
| Horizontal overflow, clipping, safe-area behavior | PASS (visual) | 320px automated screenshot plus manual 375px/430px screen captures; no visible overflow or important clipping |

## API-only check

The isolated read-only probes returned: `/health` HTTP 200; `/api/v1/stores/regions` HTTP 200 with 1 region; `/api/v1/stores?q=NO_MATCH_PR133` HTTP 200 with `stores: []`. This is API evidence only and is not substituted for page-level empty-state evidence.
