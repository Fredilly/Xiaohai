# Staging Store/HQ read-only smoke acceptance — Issue #116

This focused probe is **not deployment**, cannot enable staging web hosting, and
does not replace Fred's approval for PR #198/#199 or live activation.

## When to run

Only **after** separately authorized staging web activation, verified DNS/TLS,
and a recorded exact merged-main release SHA and rollback plan, run from a
trusted Node 22+ client with normal HTTPS certificate verification:

```bash
node scripts/staging-web-smoke.mjs --run
```

Without `--run`, it exits without making any requests. It performs only GET
requests; there are no credentials, session tokens, cookies, SSH commands,
Docker commands, writes, retries, paid API calls or payment tests.

## What is verified

- Both staging DNS CNAME records resolve to `staging-api.pamboo.asia`.
- Existing API `/health` and `/ready` return 200.
- Both HTTPS roots return HTML 200 (the default Node fetch validates TLS).
- Both staging sites support a nested SPA route and return 404 for a nonexistent
  `/assets/` file rather than serving the HTML index.
- Same-origin `/api/v1/staff/me` without a token returns 401 on both hosts.
- Both sites emit `noindex`, `nosniff` and `X-Frame-Options: DENY`.

A failing check produces a nonzero exit. The output is limited to check names,
status and fixed reason codes; **no network error body, credentials, token or
private application data** are printed. The offline unit tests mock DNS and
HTTP entirely, and the CI job never sends probes to live staging.

## Remaining human acceptance (NOT automated, NOT TESTED by this probe)

- Authorized Store/HQ account login/logout, refresh and expired sessions.
- Store-vs-HQ and cross-store 403 permissions using authorized safe accounts.
- Real inventory/catalog/order flows and approved test writes.
- Static artifact SHA provenance, proxy rollback rehearsal, actual disk and
  inode headroom, Caddy logs and post-deploy infrastructure health.
- WeChat real-device tests and production release readiness.

Do not mark #116/#33 complete from a successful anonymous public smoke test.
