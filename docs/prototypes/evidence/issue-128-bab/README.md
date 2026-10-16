# Issue #128 Stage A — B/A/B browser evidence

> **HISTORICAL ONLY / 旧版截图，不能用于最新设计验收：** The six screenshots below were rendered from `a7aa819` and show the earlier low-fidelity B/A/B wireframe. Fred requested a higher-fidelity revision afterward. The redesigned illustrated Home / detailed mock map / compact Me prototype was changed in `ee7cf5b`; fresh 375px / 430px browser captures and interactive state checks are **NOT TESTED** on that revision. Do not present these images as new visual acceptance evidence. Replace/update them only after re-rendering the exact latest PR SHA.

These six PNGs were rendered from commit `a7aa819` using desktop Chrome headless. They show the final selected combination:

- Home: direction B / magazine cover + index
- Pangzhu Global: direction A / search + map + nearby store
- Me: direction B / reading passport + journey timeline

Each frame is the prototype's exact 375px or 430px viewport. The content is design-only illustrative data and is not a real CMS, BOS, store, account, or API response. These are browser-rendered prototype screenshots, not WeChat DevTools or real-device acceptance evidence.

| Page | 375px | 430px |
|---|---|---|
| Home | [home-narrow](./issue-128-bab-home-narrow.png) | [home-wide](./issue-128-bab-home-wide.png) |
| Pangzhu Global | [global-narrow](./issue-128-bab-global-narrow.png) | [global-wide](./issue-128-bab-global-wide.png) |
| Me | [me-narrow](./issue-128-bab-me-narrow.png) | [me-wide](./issue-128-bab-me-wide.png) |

Automated checks for all six frames reported no horizontal or vertical overflow inside the phone frame. Visual review confirmed brand consistency, bottom navigation, Chinese text hierarchy, cover/map treatment, and visible state copy.
