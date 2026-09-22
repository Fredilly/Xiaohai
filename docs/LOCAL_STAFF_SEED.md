# Local Staff Seed

This helper provisions local-only Staff accounts, RBAC roles, permissions, and Data Scopes for viewing the Store Web and HQ Admin Web during development.

It is intentionally manual and refuses to run against a non-local PostgreSQL host or a production environment.

## Accounts

- `hq.admin`: local HQ administrator with `GLOBAL` Data Scope and the Staff permissions currently used by the implemented HQ APIs.
- `store.manager`: local store manager with `STORE` Data Scope for `胖竹书店南门店` by default and the permissions used by the Store Web.

Existing accounts such as integration-test fixtures are not modified.

## Passwords

Passwords are never committed. Set them only in the shell for the seed command:

```bash
export LOCAL_HQ_STAFF_PASSWORD='choose-a-local-password'
export LOCAL_STORE_STAFF_PASSWORD='choose-another-local-password'
```

Both passwords must be at least 8 characters. They are hashed through the same `ScryptPasswordHasher` used by Staff authentication.

Optionally choose another existing local store:

```bash
export LOCAL_STORE_NAME='胖竹书店南门店'
```

## Run

From the repository root:

```bash
pnpm seed:local-staff
```

On machines where the repository-pinned pnpm executable cannot self-switch, use the project workaround:

```bash
npm exec --yes pnpm@11.19.0 -- seed:local-staff
```

The command is idempotent. Re-running it refreshes the two local accounts, their managed local roles, role-permission assignments, and Data Scopes. Re-running also increments the local accounts' `session_version`, invalidating older local Staff sessions.

## Security boundary

The seed does not weaken Staff authentication, RBAC, or Data Scope checks. `store.manager` receives only a `STORE` scope; endpoints that additionally require `GLOBAL` still reject that account. `hq.admin` receives the explicit `GLOBAL` scope needed by HQ-only APIs.

The seed refuses:

- `NODE_ENV=production`
- `APP_ENV=prod` or `APP_ENV=production`
- any `DATABASE_URL` whose hostname is not `localhost`, `127.0.0.1`, or loopback IPv6

This is a development convenience, not a production Staff provisioning mechanism.
