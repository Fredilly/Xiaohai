# #130 Stage 0: Illustrated Xiaohai foundation / 绘本视觉基础

**Status:** proposal for Fred's visual review; no runtime screen or API changes. **Reference:** issue #130, #128, PR #129, acceptance #113.

## 1. What we found on `main` / 当前实际结构

| Screen | Existing source | Live behavior that MUST survive | Safe UI seam |
|---|---|---|---|
| Home 首页 | `apps/miniapp/pages/index/index.wxml` | `sections` render HERO, FEATURE_GRID, CONTENT_LIST, BANNER; CMS `mediaUrl`, `openAction`, `openShop`, `mediaError`, `loading/error/retry`; empty CMS stays honest | WXML/WXSS arrangement; illustrations only as fallback when no media, never replace CMS covers |
| Pangzhu 胖竹全球 | `apps/miniapp/pages/global/global.wxml` | native `<map>`, `markers`, `mapLatitude/Longitude`, nearby mode/location permission, input/search/picker, store state/error/retry and actual store routing | header/filter/list-card skins; optional decoration AROUND native map |
| Me 我的 | `apps/miniapp/pages/me/me.wxml` | `chooseAvatar`, `login` and `isLoggedIn`, real `avatarUrl`, `consumerDisplayId`, `openFeature` action keys; order/service data source | Profile background, layout, tile icons and spacing; no invented stats |
| Navigation | `apps/miniapp/app.json` | TabBar page paths `pages/index/index`, `pages/global/global`, `pages/me/me`; actual icons under `assets/tabbar` | Brand color/icons may change only after tested assets & tab behavior |
| Other flows | 31 registered routes in `app.json` | Route and backend behavior unaffected in Stage 0 | Scope later separate PRs |

**Important observation:** existing Me includes placeholder `—` stats (收藏/优惠券/积分). In the future Me PR, hide/label unavailable metrics instead of inventing numbers, preserving existing login/navigation. Do **not** fix it in Stage 0.

## 2. Visual direction / 视觉方向

Target: **a children's illustrated storybook world inside a parent-usable bookstore app**, not a green enterprise dashboard and not six unrelated cartoon posters. Reference the two *AI-generated visual concept collages* in the project conversation (2026-10-17) as **mood and hierarchy only**, not production graphics. Keep the approved B Home / A Global / B Me architecture where it improves discovery.

**Art-direction proposal for approval, NOT established character canon:**
- Recurring **Xiaohai explorer**: lively young illustrated adventurer holding an open book, with a simple recurring animal companion. The collage examples disagree (bear-costume child vs fox mascot), so **Fred must choose canonical protagonist before drawing production variants**.
- Pangzhu: own panda/bookstore identifier, visually related palette, never confuse fictional map decoration with provider map or brand's existing approved IP.
- Illustration language: warm hand-painted/gouache-like edges, textured storybook scenes, expressive faces, detailed foreground and soft atmospheric depth. No generic emoji icons, random gradient cover placeholders or stock cartoon swaps.
- Hierarchy: storybook hero → immediate 4 action entries → real book/story covers → contextual call-to-action. Keep adult commerce controls readable; use calmer visual density for payments/orders.
- Tokens **proposed** (not implemented): sky `#A4D8F4`, forest `#226F52`, sunshine `#FFC65A`, coral `#F39469`, paper `#FFF9EF`, ink `#24384B`. Validate contrast in running UI; never encode transactional success/error solely by color.
- Chinese copy first. English subtitle optional and secondary; large-enough type for parents; avoid AI-image-generated text in shipping art (render text as WXML).

## 3. Character bible / 角色一致性验收表

Before approving image generation, create **one canonical reference sheet** with front/side/three-quarter views, neutral/happy/surprised expressions, reading/walking/pointing/creating poses, fixed face/hair/costume/colors, companion fixed anatomy, and Pangzhu mascot distinction. Record creator, usage rights, approval date, exported asset hashes, dimensions, intended use and responsible reviewer.

**Asset examples / 素材命名 (proposal):**
`xiaohai/characters/explorer/v1/explorer-reading.webp`
`xiaohai/scenes/home/v1/hero-mobile.webp`
`pangzhu/scenes/store/v1/store-empty.webp`
`shared/states/v1/network-error.webp`

Keep a source/manifest (logical key → source → dimensions/aspect → license/approval → local fallback → CDN/BOS path). Use original artwork or properly licensed source; do not copy reference-site images.

## 4. Critical image engineering guardrails / 图片落地规则

- Original collages are visual references only. They contain generated text, fictional stores and example prices; **none of these may be baked into live product UI**.
- CMS/BOS product/media image takes priority. Approved illustration is for decorative hero, empty state or contextual explanation; a missing real book image is not an excuse to show an unrelated illustration as that book's cover.
- Ship with known dimensions and declared aspect ratio. Prefer optimized WebP where WeChat compatibility is verified; keep compatible PNG fallback. Test the *actual* DevTools/device version before relying on a format.
- Avoid loading six large scenic illustrations on first paint. Compress art variants, delay offscreen work, preserve scrolling and network retry behavior. No new external domains without WeChat domain/security approval.
- Native `<map>` must remain real and interactive. Decorative maps from the concept collage never replace geolocation, marker callbacks, backend store list, or native map controls.
- Do not embed third-party image search results or AI output with unknown rights into production.

## 5. PR sequence and acceptance / 分 PR 实施

0. **This PR:** source-verified constraints + proposed art system + tests, no production modifications. Fred picks character direction/visual samples before artwork implementation.
1. **Home PR:** update Home WXML/WXSS and approved artwork only. Confirm CMS populated/empty/error/loading, click routes, broken media fallback, long Chinese titles.
2. **Global PR:** update chrome/cards; leave native map binding and search/nearby/store logic unchanged. Test permissions denied, real markers, empty/error, pan and navigation.
3. **Me PR:** update profile/tiles; leave WeChat login/avatar/action keys untouched. Test logged-out/logged-in/expired login, account data privacy and no fictional counters.
4. **Separate follow-ups:** stories, animation, AI and commerce; no mixing business changes into UI PRs.

Every PR: `pnpm` workspace validation & CI, screenshot 375/430 + narrow device, data/state comparisons, explicit rollback, reviewer sign-off. Any business behavior regression blocks merge. Real iOS/Android WeChat acceptance tracked by #113; browser mockups alone do not count.

## 6. Explicit open decisions / 等待确认

- [ ] **Protagonist:** illustrated child explorer with animal companion OR mascot fox? Existing Xiaohai brand asset/IP may override both.
- [ ] **Pangzhu:** verify actual panda/logo rights and existing files before replacing icons.
- [ ] **Assets:** get original image collage attached to issue or reference-approved examples, plus BOS assets manifest for real covers.
- [ ] **Visual acceptance:** Fred signs off on canonical character sheet, representative Home hero and store/Me illustration samples.
- [ ] **Deployment:** verify asset domain, WeChat media budget and real-device acceptance environment before Stage 1.

## 7. Demonstration workflow for intern / 给实习生看的标准流程

Read the route WXML + associated TS/WXSS; write down every existing handler/binding; isolate a design-only change; preserve data and action contracts; add before/after screenshots; test ready/loading/empty/error; submit short focused PR with **What / Why / Tests / NOT TESTED**. Stop at review; no merge or business logic changes.

**Evidence boundary:** this document is based on inspected `main` `app.json`, `index.wxml`, `global.wxml`, `me.wxml` and `docs/FRONTEND_IMPLEMENTATION.md`. No full runtime tests or real-device screenshots were executed in this docs-only PR.
