# Issue #128 Stage A — B/A/B browser evidence

These screenshots were rendered from source commit `297135d` using desktop Chrome headless. They show the redesigned final selected combination:

- Home: direction B / magazine cover + index
- Pangzhu Global: direction A / search + map + nearby store
- Me: direction B / compact login + orders + reading history + AI works + rentals

Each frame is the prototype's exact 375px or 430px viewport. The content is design-only illustrative data and is not a real CMS, BOS, store, account, or API response. These are browser-rendered prototype screenshots, not WeChat DevTools or real-device acceptance evidence.

| Page | 375px | 430px |
|---|---|---|
| Home | [home-narrow](./issue-128-bab-home-narrow.png) | [home-wide](./issue-128-bab-home-wide.png) |
| Pangzhu Global | [global-narrow](./issue-128-bab-global-narrow.png) | [global-wide](./issue-128-bab-global-wide.png) |
| Me | [me-narrow](./issue-128-bab-me-narrow.png) | [me-wide](./issue-128-bab-me-wide.png) |

## Six-frame result

All six frames are PASS. Automated checks reported no horizontal or vertical overflow inside the phone frame. Visual review confirmed the fox reading illustration and four Home entries, road/name/marker/map/store treatment, compact Me login area, orders, reading history, AI works, rentals, Chinese long-title wrapping, bottom navigation, and consistent paper/leaf/ink styling.

| Check | Result |
|---|---|
| Source commit | `297135d` |
| Browser | Desktop Chrome headless via Playwright |
| Viewports | 375px and 430px exact frame widths |
| Horizontal/vertical overflow | PASS for all six |
| Runtime API / CMS / BOS | NOT TESTED; static prototype only |
| WeChat DevTools / real device | NOT TESTED |

## State matrix

The prototype's scenario control was exercised for all three pages. Each state panel was visible inside the 375px frame and contained the expected non-production copy; the state test screenshots are included below.

| Page | Loading | Empty | Error + retry |
|---|---|---|---|
| Home | [loading](./issue-128-bab-state-home-loading-narrow.png) PASS | [empty](./issue-128-bab-state-home-empty-narrow.png) PASS | [error](./issue-128-bab-state-home-error-narrow.png) PASS |
| Pangzhu Global | [loading](./issue-128-bab-state-global-loading-narrow.png) PASS | [empty](./issue-128-bab-state-global-empty-narrow.png) PASS | [error](./issue-128-bab-state-global-error-narrow.png) PASS |
| Me | [loading](./issue-128-bab-state-me-loading-narrow.png) PASS | [empty](./issue-128-bab-state-me-empty-narrow.png) PASS | [error](./issue-128-bab-state-me-error-narrow.png) PASS |

All state panels are design-only demonstrations. They do not call a server or prove Mini Program runtime behavior.
