# Issue #111 — trusted read-only Mac runtime preflight

This CLI collects a sanitized, fail-closed snapshot for the original isolated
Mac Plan B fixture. It never authorizes a paid request and does not contain an
execution mode.

## Command

After the exact commit has independent review, run from a separate clean
checkout with process-local configuration:

```bash
pnpm preflight:i111-readonly
```

No positional arguments or flags are accepted. In particular, there is no
`--execute`, provider, upload, migration, restore, queue or Worker mode.

The direct CLI fixes the original Gate B paths, database name, loopback port,
role, book/page IDs, bucket, backup digest and Mimi/Pip source digests in code.
It accepts the database password and provider credential presence only from the
current process environment and never includes their values in output. It also
requires `I111_REVIEWED_SHA` to equal the independently observed checkout SHA;
that equality is still not operation authorization.

## Read-only guarantees

- PostgreSQL URL must be the exact `127.0.0.1:52511` isolated database and app
  role before connection.
- The client sets `default_transaction_read_only=on`, starts an explicit
  `REPEATABLE READ READ ONLY` transaction and always rolls it back.
- Queries are `SELECT`/session-local timeout statements only. The CLI does not
  connect to Redis, BOS or Bailian and does not start API/Worker processes.
- Backup and PNG evidence are read locally and checked for mode, size and
  SHA-256. No restore or remote object request occurs.
- Output contains only allowlisted codes and PASS/STOP classifications. It does
  not contain a DSN, key, signed URL, object body, prompt or database row ID.
- `paidExecutionAuthorized` is always `false`.

## Deliberate STOP conditions

The collector independently checks the actual database identity, ordered 42-row
migration journal, exact book/pages, locked imported READY Mimi/Pip references,
derived private object keys, active work, illustration history, reservations,
ledger entries, budget windows, Beijing Workspace binding, Worker 900-second
signer constant and timeout margin.

Offline configuration cannot prove the provider's complete invoice. Therefore
the CLI reports `I111_PRICE_BASIS_UNVERIFIED` until a separately reviewed trust
source and reconciliation design exists. The old 300-second Mac GET evidence
does not prove the new 900-second signer or Bailian service-side private-object
fetch. Those remain separate, owner-authorized real-environment acceptance
steps; this CLI never attempts them.

The existing Gate B `api.mode=enabled` marker is also a STOP even when no process
is listening. It must be reviewed separately rather than silently rewritten by
this preflight.
