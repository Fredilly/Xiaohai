# M24 微信体验验证记录 / WeChat experience evidence

## Runtime audit

- `app.json` registers the existing pages and fixed tabs 首页 / 胖竹全球 / 我的. Tab navigation uses `switchTab`; details and creation routes use `navigateTo` or `redirectTo`. Referral shares carry a bounded referral code; no token/session/openid is placed in a share URL.
- `project.config.json` still uses `touristappid`. After Issue #76, Mini Program `develop` and `trial` use the non-production HTTPS endpoint `https://staging-api.pamboo.asia`. On 2026-11-25 the owner approved the release hostname `https://api.pamboo.asia` and the release configuration was updated. This code mapping does **not** prove the request domain is authorized for a real AppID, production API is deployed, or that device login/payment/privacy work.
- Services now set a 10-second `wx.request` timeout. The session helper stores expiry/user identity, removes expired credentials before requests and clears them on 401. A network timeout preserves the session so the user can retry.
- Checkout reuses its server idempotency key and ignores outdated quote responses; order detail reloads on foreground entry and never infers `PAID` from `wx.requestPayment`. Story, picture-book and animation terminal failures are reported; video reports playback errors and saves the current position only on full playback completion.
- Location is requested only after the user taps nearby. Denial leaves the non-location store list available; no location is fabricated. The map's default viewport is not a device position.

## 2026-11-26 AI works list isolation regression (offline only)

- The consumer-owned Story, Picture Book and AI Animation list pages now clear personal rows when hidden or while a new request is pending, reject superseded responses, and re-read the current account after a token change. A stale result or image load failure cannot repopulate another session's work. Detail navigation is limited to works loaded for the currently active session.
- The AI Animation list has an explicit login-required state and does not call its protected list endpoint while signed out. Picture Book cover failures are bound to the exact current cover URL, preventing a previous signed media URL failure from hiding a refreshed cover.
- Deterministic Mini Program tests cover concurrent responses, account changes, hide/show, unloaded pages, retry and navigation. These are **offline regression tests**, not DevTools, iOS, Android, paid-AI or production acceptance. The runtime matrix below remains BLOCKED until separate evidence exists.

## 2026-11-26 authorized DevTools attempt (blocked)

- The installed WeChat DevTools CLI was found at `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`.
- Opening `apps/miniapp/` with the configured local AppID was not executed because the IDE service port is disabled. The official CLI returned the fixed instruction to enable **设置 → 安全设置 → 服务端口**; no project compile, network request, preview, or device session was started.
- This is an environment prerequisite failure, not a Mini Program runtime result. No AppID, token, request payload, or customer data was logged.

## 2026-11-26 DevTools service port enabled (automation still blocked)

- The official CLI connected to the existing IDE service at `http://127.0.0.1:37215` and `cli auto --trust-project` completed successfully for this project, identifying the configured authorized AppID. The configured development API remains `https://staging-api.pamboo.asia`.
- Simulator/page automation did not produce a runtime result: the WeChatIDE skill client requested an additional local authorization handshake and timed out before `simulator_open_page`, screenshot, network, or console collection. No page was marked PASS and no real request was initiated by this attempt.
- This is an automation authorization block, distinct from the previously closed service-port block. A human must complete the local WeChatIDE authorization prompt before the M24 matrix can record page or weak-network results.

## 2026-11-26 owner-provided DevTools screen recording (manual UI evidence)

- Evidence: owner-provided local screen recording titled `录屏2026-11-26 11.49.48.mov` (about 29 seconds); **not checked into Git**. The visible IDE is WeChat DevTools Stable `2.02.2608080`, running an iPhone simulator. Exact simulator/OS version, real-device environment and request-domain acceptance are not established by the recording.
- **PASS, visible UI only:** the 首页, 我的 and 胖竹全球 TabBar destinations were displayed and navigated between; the home banner, My orders/services area and Pangzhu store search/map area rendered. This establishes those visible routes, not cold-start reliability, every deep link, backend data freshness or location-permission behavior.
- **PASS, visible UI only:** the AI 动画 list displayed a sign-in-required state when unauthenticated. A later My page showed a transition from a sign-in prompt to a signed-in-looking profile. The recording does not expose the network response, token lifecycle or server-side consumer identity; authenticated API/login acceptance remains **BLOCKED**.
- **Known unfinished service:** the 我的 → 会员中心 tile explicitly displays `即将开放`; its destination is a generic unavailable-service page. This is an implementation gap, **not** a runtime or AppID error. Do not label paid membership enabled.
- Console visibly contained yellow runtime/tooling warnings (including a grey-release base-library notice and preload hints); no red exception is visible in the shown portion. The Network tab, request/response status, weak-network behavior and full console history were **not** captured. No claim is made that backend requests succeeded.
- Owner recording is not a physical iOS/Android test, payment/AI-provider execution or production acceptance. Remaining end-to-end matrix rows stay **BLOCKED** until their own evidence exists.

## Evidence fields

For each execution record **device/model, OS, WeChat version, DevTools version, environment/AppID (no secret), date, flow, expected, actual, PASS/FAIL/BLOCKED, screenshot or sanitized log reference, bug commit**. `BLOCKED` means untested, never passed. Do not capture tokens, payment credentials, precise location or customer PII in screenshots.

| Platform | Flow | Expected | Actual | Status | Evidence / bug commit |
|---|---|---|---|---|---|
| DevTools | 首页 / 我的 / 胖竹全球 visible TabBar navigation | Tap each tab; destination view renders | All three destinations rendered in the owner recording; Pangzhu list/map UI visible | PASS (UI only) | Owner-provided 2026-11-26 11:49:48 local screen recording; not committed |
| DevTools | AI 动画 list while signed out | Explicit sign-in-required state; no private work shown | Sign-in-required state visible before a separate My-page login interaction | PASS (UI only) | Same owner recording; network access not captured |
| DevTools | Cold start, tabs, deep links and back stack | All registered pages open; invalid IDs show error and retry | Pending authorized DevTools run | BLOCKED | Pending |
| DevTools | Login, expiry, duplicate tap, timeout, 401 | One login, recoverable error, expired session removed | Automated service tests only; runtime pending | BLOCKED | Pending |
| DevTools | Catalog, cart, address, checkout, order, payment return | No duplicate order; payment status loaded from API | Automated checkout race test only; runtime pending | BLOCKED | Pending |
| DevTools | Story/video preview and entitlement | Preview limit enforced; unavailable media shows retry | Runtime pending | BLOCKED | Pending |
| DevTools | Story, picture-book, animation generation | Queued/running/terminal states; reopening reloads detail | Runtime pending | BLOCKED | Pending |
| DevTools | Map permission denied/allowed, nearby fallback | Denial retains ordinary store search; accepted position is real | Runtime pending | BLOCKED | Pending |
| DevTools | Referral/share opening | Only referral code in share path; target loads | Runtime pending | BLOCKED | Pending |
| DevTools | Offline/slow network for home, login, checkout, payment return, orders, media, AI and map | Loading ends with retry/clear error; no false paid/ready state | Runtime pending | BLOCKED | Pending |
| iOS | All flows above, including background/foreground | Same business state as API; no permanent loading | Physical device pending | BLOCKED | Pending |
| Android | All flows above, including background/foreground | Same business state as API; no permanent loading | Physical device pending | BLOCKED | Pending |

## Manual run instructions

1. In WeChat DevTools, open the repository's `apps/miniapp/` directory. Use an authorized **test** AppID in local private configuration and the HTTPS staging API `https://staging-api.pamboo.asia`; add it to that AppID's **request 合法域名** in the WeChat console, using the real domain approval process. Record the AppID/environment (not secrets), DevTools version, TLS/request-domain results and compile errors. The committed `touristappid` is insufficient for authorized real-device journeys; the release API domain `https://api.pamboo.asia` must also pass the separate production request-domain/device gates before publishing.
2. Click **编译**, then exercise 首页 → 胖竹全球 → 我的, product → cart → checkout → order detail, stories → playback, and each AI creation page. For each error state, capture a screenshot with sensitive data hidden. Check payment return by opening the order detail and using **刷新订单状态**; never use production payment credentials.
3. In DevTools Network settings, simulate slow network and disconnection during login, checkout, order refresh, video and AI polling. Reconnect and use the visible retry/refresh action. Record whether a timeout is recoverable and whether the server remains authoritative.
4. On 胖竹全球 and 找书, tap **附近**. Test allowed and denied location permission separately; verify denial still permits ordinary search. Capture the permission outcome and map/list view with precise location hidden.
5. Use **预览** to scan with an authorized test iPhone, then an Android device. Record model, OS and WeChat version; repeat the flows, background/foreground transitions, location permission and referral sharing. Capture screenshots of failures and note the page and reproducible steps.

## Blockers and decisions

Authorized test AppID/developer access, non-production request-domain configuration, representative iOS and Android devices, real WeChat permission prompts, safe payment test environment, and any required privacy wording need human participation. No device or DevTools execution has been marked PASS by repository CI. Do not close Issue #32 solely on automated tests.
