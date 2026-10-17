# #129 — Approved illustrated design direction (2026-10-17)

**Status: approved visual target, NOT implemented mockups.** This file records the direction chosen by Fred. The existing Stage A wireframes and screenshots remain *superseded visual evidence* until regenerated in this style.

## Non-negotiable visual target
- **Hero / scene:** watercolor/gouache picture-book landscape with consistent young explorer and fox companion, lush foliage and generous cream negative space.
- **Everything below hero:** **FLAT tiles and restrained flat vector icons**, not miniature watercolor paintings in every tile. Rounded light-cream surfaces, restrained shadow, clean Chinese text, green accents, simple colored pictograms.
- Maintain same existing information hierarchy/routes: **首页 / 胖竹全球 / 我的**. No new features, tabs, buttons, account stats, extra products or invented services.
- **Home:** illustrated hero; search; four existing functional entry tiles (商城/故事/动画/AI as supported by implementation); book cover images are legitimate cover thumbnails, not decorative invented products.
- **Pangzhu Global:** slim illustrative banner, ordinary search/region controls, real native map integration boundary, flat store cards and list; never bake fabricated map locations or shops into production.
- **Me:** illustrative banner, existing login CTA, current order/status shortcuts and reading/AI/rental/address/settings/commission tiles, flat icons; explicit loading/empty/error states and no fake balances.
- **States:** preserve structure of already-submitted loading/empty/error mockups, but update decorative treatments to the same illustration+flat-tile system. Keep error messages legible without scenic image behind text.
- Chinese typography first; use native text separate from image. Keep accessible tap target sizes and 375/430 layout tests.

## Visual reference
The final user-approved direction is the **last three-phone collage generated in the conversation on 2026-10-17**: watercolor illustration in main hero only, flat icon tiles below, restrained elegant white/cream surfaces, soft forest green highlight. The earlier collage with watercolor icons in every tile is **not** the target.

**Required before PR #129 can be considered finished:** commit actual NEW high-fidelity prototype source plus Home/Global/Me 375px and 430px screenshots and loading/empty/error variants. The screenshot collage in chat is a **visual target**, not an interactive WXML screen and not proof of implementation. Do not claim replacement is finished without actual artifacts in this PR.

**Scope: design/prototype only.** No production `apps/miniapp` changes, API changes, routing changes, fake data injection, or merge in PR #129. Track implementation separately under #130/#132.
