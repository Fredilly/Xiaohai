# M24 微信体验验证记录 / WeChat experience evidence

## Runtime audit

- `app.json` registers the existing pages and fixed tabs 首页 / 胖竹全球 / 我的. Tab navigation uses `switchTab`; details and creation routes use `navigateTo` or `redirectTo`. Referral shares carry a bounded referral code; no token/session/openid is placed in a share URL.
- `project.config.json` uses `touristappid`; staging and production API URLs remain `.invalid` placeholders. These settings cannot prove real-device request-domain, payment or privacy behavior.
- Services now set a 10-second `wx.request` timeout. The session helper stores expiry/user identity, removes expired credentials before requests and clears them on 401. A network timeout preserves the session so the user can retry.
- Checkout reuses its server idempotency key and ignores outdated quote responses; order detail reloads on foreground entry and never infers `PAID` from `wx.requestPayment`. Story, picture-book and animation terminal failures are reported; video reports playback errors and saves the current position only on full playback completion.
- Location is requested only after the user taps nearby. Denial leaves the non-location store list available; no location is fabricated. The map's default viewport is not a device position.

## Evidence fields

For each execution record **device/model, OS, WeChat version, DevTools version, environment/AppID (no secret), date, flow, expected, actual, PASS/FAIL/BLOCKED, screenshot or sanitized log reference, bug commit**. `BLOCKED` means untested, never passed. Do not capture tokens, payment credentials, precise location or customer PII in screenshots.

| Platform | Flow | Expected | Actual | Status | Evidence / bug commit |
|---|---|---|---|---|---|
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

1. In WeChat DevTools, open the repository's `apps/miniapp/` directory. Use an authorized **test** AppID in local private configuration and a reachable non-production API with approved request domains. Record DevTools version, test environment and compile errors. The committed `touristappid` and `.invalid` URLs cannot perform real network journeys.
2. Click **编译**, then exercise 首页 → 胖竹全球 → 我的, product → cart → checkout → order detail, stories → playback, and each AI creation page. For each error state, capture a screenshot with sensitive data hidden. Check payment return by opening the order detail and using **刷新订单状态**; never use production payment credentials.
3. In DevTools Network settings, simulate slow network and disconnection during login, checkout, order refresh, video and AI polling. Reconnect and use the visible retry/refresh action. Record whether a timeout is recoverable and whether the server remains authoritative.
4. On 胖竹全球 and 找书, tap **附近**. Test allowed and denied location permission separately; verify denial still permits ordinary search. Capture the permission outcome and map/list view with precise location hidden.
5. Use **预览** to scan with an authorized test iPhone, then an Android device. Record model, OS and WeChat version; repeat the flows, background/foreground transitions, location permission and referral sharing. Capture screenshots of failures and note the page and reproducible steps.

## Blockers and decisions

Authorized test AppID/developer access, non-production request-domain configuration, representative iOS and Android devices, real WeChat permission prompts, safe payment test environment, and any required privacy wording need human participation. No device or DevTools execution has been marked PASS by repository CI. Do not close Issue #32 solely on automated tests.
