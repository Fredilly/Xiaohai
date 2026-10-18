# PR #133 — Pangzhu Global acceptance evidence

- Source commit: `86ad52e2877da8bdd2b67de4096156fa9f269042`
- Test date: 2026-10-18 (Asia/Shanghai)
- Environment: WeChat DevTools simulator, iPhone 12/13 Pro profile, reported window 390×671 CSS px (screenshots 780×1342 px), isolated API on `127.0.0.1:3000` backed by the issue-113 test database. No production data was used.
- These are real DevTools screenshots, not browser prototypes or real-device evidence.

## Screenshots

- [global-ready.png](./global-ready.png) — initial loaded viewport: storybook styling, search, region picker, nearby entry, native Tencent map, one marker, and `1` store.
- [global-scroll-1000.png](./global-scroll-1000.png) — lower viewport: map/data note, the test store card, service entries, and franchise entry.

The only store shown is the explicitly labelled isolated fixture `[TEST-ISSUE113] 虚构成都门店`; its address and opening text are marked test-only. It is not a production or fabricated business listing.

## Result matrix

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Loaded layout, green storybook visual system, search and region controls | PASS | `global-ready.png` |
| Native map renders with Chengdu labels and marker | PASS | `global-ready.png`; map is the real DevTools `map` component |
| Store card, address, opening text and service tag render | PASS | `global-scroll-1000.png` |
| Map marker exactly matched to a store ID | NOT TESTED | Runtime `page.data()` introspection hangs; screenshot visibly shows one marker and one store, but ID-level correspondence was not asserted |
| 320px / 375px / 430px viewport adaptation | NOT TESTED | DevTools was on its 390px profile; requested widths were not changed during this run |
| No-match empty state in the page | NOT TESTED | Safe API probe returned HTTP 200 with `stores: []`; automator input/callMethod timed out, so no page empty-state screenshot was claimed |
| API error and retry | MANUAL REQUIRED | Automator interaction timed out; no failure state was claimed |
| Location denied handling | MANUAL REQUIRED | Requires a DevTools permission action; no permission result was inferred |
| Store detail, book search, rental and franchise navigation | NOT TESTED | No reliable click automation in this session |
| Horizontal overflow, clipping, safe-area behavior | NOT TESTED | Requires the requested viewport profiles and/or manual inspection |

## API-only check

The isolated read-only probes returned: `/health` HTTP 200; `/api/v1/stores/regions` HTTP 200 with 1 region; `/api/v1/stores?q=NO_MATCH_PR133` HTTP 200 with `stores: []`. This is API evidence only and is not substituted for page-level empty-state evidence.

