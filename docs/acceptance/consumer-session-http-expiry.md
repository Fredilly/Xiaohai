# Issue #116 — Consumer session expiry: isolated HTTP acceptance evidence

**Scope:** Code-only, no staged or production operations. Follow-up to Fred's
[real consumer session expiry acceptance instructions](https://github.com/Fredilly/Xiaohai/issues/116#issuecomment-6649585599).

## What the test actually proves

`apps/api/test/consumer-session-http.test.ts` issues a **real signed session**
using the production `ConsumerSessionService` implementation, through the
**actual** Fastify `POST /api/v1/auth/wechat/login` route. It then uses that
token over the protected **actual** `GET /api/v1/commerce/cart` route via
Fastify `app.inject` (real route, HTTP request/response, auth gate,
security error mapping). The consumer identity repository, external WeChat
provider and cart persistence are **test doubles** with isolated UUID fixtures.

A deterministic injected clock verifies:
- **T+59 seconds:** signed 60-second token accepted; the server retrieves
  the cart strictly using the token's signed `sub`.
- **T+60 seconds (exact `exp`):** same request returns HTTP 401 with
  `CONSUMER_AUTHENTICATION_REQUIRED`, and does not invoke the cart service
  or expose a session token/user ID.
- **T+61 seconds:** the same token remains denied.
- **Two identities:** forging `x-consumer-user-id` does not override the
  signed token identity used by the protected endpoint.
- Missing, malformed and tampered token cases return 401 without protected
  service access or token disclosure.

Existing Mini Program tests continue to check local expiry/401 clearing:
`apps/miniapp/services/consumer-session.test.ts`, and the Me page
signed-out re-entry behavior:
`apps/miniapp/pages/me/me-session.test.ts`.

## What this does NOT prove

- **Not deployed Staging / production:** this is HTTP injection using
  isolated clock and mock storage, not a true 60-second live WeChat session.
- No real WeChat login, no live PostgreSQL, no shop purchase, paid payment,
  or production data changes.
- Does not substitute for iOS/Android/weak network user acceptance, real
  checkout, or a naturally expired live test account.
- A genuine live expiry verification still needs a dedicated nonproduction
  environment with approval, or natural expiry of an authorized test
  account; **do not shorten shared Staging TTL or rotate secrets**.

## Reproduce safely

```bash
pnpm --filter @xiaohai/api exec vitest run test/consumer-session-http.test.ts
pnpm --filter @xiaohai/miniapp exec vitest run services/consumer-session.test.ts pages/me/me-session.test.ts
```

The first test uses no database, network, WeChat credentials or secrets.
It changes no API contracts and can be run in ordinary CI.

## Launch gate status

- Signed-token HTTP expiry before/after `exp`: **PASS only after current HEAD CI**.
- Consumer Mini Program session storage/Me page: covered by existing unit tests.
- Real staging/WeChat naturally expired session: **NOT TESTED**, remains open
  under Issue #116 and real-device gate #32.
- Release status remains **BLOCKED**, including Staging disk
  81% used / `STAGING_READY=false`, production HTTPS/domain and
  three-client commercial UAT.
