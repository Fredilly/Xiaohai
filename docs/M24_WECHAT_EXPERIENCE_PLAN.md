# M24 WeChat Experience Build Plan

## Goal
Validate the production Mini Program experience in WeChat DevTools and representative real devices without changing the completed M1-M23 business semantics.

M24 is primarily a WeChat runtime/experience hardening milestone. Git remains the source of truth; DevTools and real devices are validation environments.

## Current baseline
- M23 is merged into `main`.
- Mini Program source lives in `apps/miniapp/`.
- Fixed tab bar remains 首页 / 胖竹全球 / 我的.
- Existing Mini Program routes already cover commerce, orders, stories/playback, story/picture-book/animation AI, store/map discovery, rentals, franchise, commission and referral.
- `scope.userLocation` / `getLocation` is declared for nearby-store behavior.
- CI remains responsible for domain/API/DB/unit/integration validation; M24 adds WeChat-specific runtime and device evidence.

## Scope
Issue #32 requires validation across:
- WeChat DevTools
- representative iOS and Android devices
- weak/unreliable network behavior
- login
- payment
- video playback
- AI creation/status flows
- map/location permission
- privacy behavior
- sharing
- order flows

M24 may fix Mini Program-specific runtime, navigation, permission, compatibility and device issues discovered by that validation.

## Non-goals
- Do not start M25 launch-readiness work.
- Do not activate production payment or use production credentials.
- Do not change business rules merely to make a device test pass.
- Do not move domain validation from API/DB into the client.
- Do not add undocumented DevTools GUI automation to CI.

## Work plan

### M24-A — Mini Program runtime audit
- Audit `apps/miniapp/app.json`, `project.config.json`, config/environment handling, services and all registered pages.
- Check runtime-only assumptions: navigation targets, tab navigation vs normal navigation, query decoding, storage/session restore, lifecycle hooks and error handling.
- Confirm private-info declarations match actual location usage.
- Record any capabilities that require authorized AppID, real device or production-like external provider.

### M24-B — Login and session experience
Validate and harden:
- `wx.login` success/failure/cancel-like failure handling
- expired consumer session recovery
- page re-entry after login
- duplicate login taps
- offline / timeout handling
- clear, non-sensitive user-facing errors

### M24-C — Commerce, order and payment experience
Validate:
- catalog/detail/cart/address/checkout/order flows
- duplicate submission protection in Mini Program UX
- returning from background/foreground during checkout
- payment success/cancel/failure/unknown-result handling
- order refresh after payment
- no client-side assumption that payment succeeded

Real production payment activation remains outside M24 unless explicitly approved.

### M24-D — Video/content experience
Validate:
- story/animation playback startup and resume
- preview vs entitlement behavior
- loading/error/retry states
- background/foreground behavior
- interrupted/weak-network playback
- invalid/unavailable media handling

### M24-E — AI creation experience
Validate:
- story, picture-book and animation submit flows
- duplicate tap protection
- queued/running/failed/ready states
- polling/refresh behavior
- page reopen while a job is running
- weak network / timeout / retry UX
- terminal failure does not appear permanently loading

### M24-F — Map, location and privacy
Validate:
- first-use location permission
- denied permission
- previously denied permission
- device location unavailable
- nearby/store fallback without location
- privacy prompts/declarations required by the installed WeChat environment

The client must not fake a location or broaden server-side data scope.

### M24-G — Sharing and navigation
Validate:
- share entry points that already exist in product scope
- deep-link/page query restoration where supported
- share target opening into a valid state
- no sensitive token/session data in share payloads or URLs
- tab-bar navigation and back-stack behavior

### M24-H — Weak-network and device matrix
Test representative scenarios under throttled/interrupted networking:
- initial page load
- login
- checkout/payment return
- order refresh
- media playback
- AI submit/status refresh
- map/location

Record results separately for DevTools, iOS and Android. Do not infer real-device pass from simulator pass.

### M24-I — Regression evidence
Create a repeatable checklist/report including:
- environment/device
- WeChat version / DevTools version
- scenario
- expected result
- actual result
- screenshots/log references where useful
- bug/commit/PR reference

Automate deterministic client checks where practical, but keep real-device evidence explicitly manual.

## Acceptance criteria
M24 code can be considered implementation-complete when:
- Mini Program-specific defects found during validation are fixed and regression-tested where automatable.
- CI remains green for existing repository checks.
- Critical journeys pass in DevTools.
- Representative iOS and Android passes are recorded for the required journeys.
- Weak-network behavior is tested and documented.
- Remaining environment/provider limitations are explicit.

Issue #32 should not be closed merely because CI is green; real-device evidence is part of its Done definition.

## Human-required validation
The following cannot be honestly replaced by repository CI:
- authorized WeChat AppID runtime behavior
- real iOS device behavior
- real Android device behavior
- actual WeChat permission prompts
- real-device video behavior
- real-device sharing
- real payment experience if/when a non-production-safe test environment is available

## Decisions / external dependencies
Track without inventing values:
- representative device/OS versions
- authorized test AppID/developer access
- payment test environment availability
- privacy-policy wording if WeChat requires product/legal confirmation
- any provider/domain allowlist required for real-device requests

## Branch / collaboration rules
- Branch: `intern/m24-wechat-experience`
- Base: latest `main` containing M23
- Do not modify `main` directly
- Do not start M25
- Do not merge the eventual M24 PR without review
