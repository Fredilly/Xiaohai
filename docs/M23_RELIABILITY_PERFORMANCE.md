# M23 Reliability & Performance

## Baseline and measurement

The repeatable in-process 100-request `/health` sample prints throughput, p95 and errors in `pnpm check`. It excludes network, PostgreSQL and Redis; it is only a regression smoke sample. CI runs full API/Worker integration and E2E with PostgreSQL 17 and Redis 7.4. Capture realistic production-like latency, throughput, connection saturation and error rates in staging before selecting SLAs. No production SLA is inferred from CI hardware.

Provisional engineering triggers for investigation, subject to operations review: 5xx rate >1% for five minutes; p95 API latency >1 second for five minutes; any payment/inventory/ledger invariant violation; any failed restore; any stuck worker work past provider timeout plus 60 seconds. These are alert proposals, not contractual promises.

Critical route inventory: consumer/staff login, catalog/search, checkout/order creation, payment callback/refund/reconciliation, inventory search and mutations (receipt/adjustment/stocktake/transfer), rental and fulfillment, franchise submission/review, AI enqueue and story/picture-book/animation queues. Existing integration suites exercise PostgreSQL row locks, uniqueness and idempotency. Load testing should use separate staging identities, stores and provider mocks; preserve RBAC/Data Scope assertions under concurrent requests.

## Database review

PostgreSQL remains the source of truth. Existing queue claims use `FOR UPDATE SKIP LOCKED`; inventory writes use transactions and guarded updates; payments and finance use unique event keys and append-only ledgers. Existing search/list routes have pagination and scope checks; exports need operational limits verified with real-size staging data. The queue claim indexes include `ai_jobs_claim_idx` and `animation_scene_generations_claim_idx`; inventory has `(store_id, sku_id)` primary key and transaction reference indexes. No index was added without realistic cardinality and `EXPLAIN (ANALYZE, BUFFERS)` evidence. Review slow-query logs and plans on a seeded disposable database before proposing a migration; never run `EXPLAIN ANALYZE` on production writes.

## Queues, media, and alerts

Redis carries wake-up notifications; PostgreSQL claim and status are authoritative. The worker polls PostgreSQL even when notifications are lost, periodically recovers expired AI leases and marks orphaned image/video/composition work `FAILED` after provider timeout plus a restart grace period. A late completion must still match `RUNNING`. Failed work requires an explicit retry path; the scanner does not auto-repair records. Provider timeouts and bounded AI attempts remain active. Redis outages and worker iteration errors emit codes without prompt content.

`API_REQUEST_METRIC` logs route templates, status and duration without raw URL, query or headers. `/health` is liveness; `/ready` checks PostgreSQL and Redis and returns only ready/unavailable. Schedule `packages/db/scripts-reliability-scan.mjs` under a read-only DB role; it emits counts for payment amount mismatch, finance missing source, reconciliation discrepancy, inventory invariants and stuck/failed queue work. Alert on positive invariant counts immediately, and investigate failure spikes against a measured baseline. Wire structured events to the chosen monitoring system at deployment; keep labels bounded and strip PII.

The existing media endpoint registers metadata, not bytes; it validates HTTPS references and MIME/key agreement. Object storage/CDN provider, private asset signing, byte validation, cache headers and origin fallback cannot be verified until the production provider is selected. Never treat metadata validation as a working binary upload pipeline.

## Backup and restore drill

CI runs `scripts/verify-test-restore.sh` after integrations against **only** `xiaohai_test`. It uses PostgreSQL 17 `pg_dump` custom format, creates a new disposable database, restores with `pg_restore --exit-on-error`, then compares migration count and critical table totals (including payment, refund, finance amount, inventory quantity, AI jobs, works and staff), plus a nonempty test probe. The temporary archive and database are removed by a trap. The script refuses non-test database names and must be run after test writers stop. CI's successful drill proves test backup/restore compatibility, not production RPO/RTO or backup encryption/retention.

Local example with a disposable migrated test DB and PostgreSQL 17 client tools: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/xiaohai_test sh scripts/verify-test-restore.sh`. Do not point it at production. For a real incident: stop writes, preserve the original database, restore a verified archive into a separate DB, compare financial/inventory totals and migration history, then require human cutover approval.

## Decisions Needed

Formal latency/availability/RPO/RTO targets; realistic staging data volume and traffic profile; alert owner/escalation and monitoring vendor; production backup encryption, retention and restore schedule; CDN provider, private media access and cache policy; provider idempotency contract for image/video/composition generation. Production restore and cutover require a separate authorized operation.
