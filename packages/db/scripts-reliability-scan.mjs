import pg from 'pg';

// Read-only scanner. Schedule against a read-only DB role; never repairs the source of truth.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const rules = {
  inventory_invalid: `select count(*)::int as count from store_inventory
    where on_hand < 0 or reserved < 0 or rental_reserved < 0
      or reserved + rental_reserved > on_hand`,
  inventory_event_invalid: `select count(*)::int as count from inventory_transactions
    where balance_after < 0 or quantity_delta = 0`,
  payment_amount_mismatch: `select count(*)::int as count from payment_ledger l
    join payments p on p.id = l.payment_id
    where l.kind = 'PAYMENT' and l.amount_minor <> p.amount_minor`,
  refund_amount_mismatch: `select count(*)::int as count from payment_ledger l
    join refunds r on l.event_key = 'refund:' || r.id::text
    where l.kind = 'REFUND' and l.amount_minor <> r.amount_minor`,
  finance_missing_source: `select count(*)::int as count from payment_ledger l
    left join finance_ledger_entries f on f.payment_ledger_id = l.id
    where f.id is null`,
  reconciliation_discrepancy: `select count(*)::int as count from reconciliation_items
    where outcome in ('REVIEW_REQUIRED','FAILED')`,
  ai_stuck: `select count(*)::int as count from ai_jobs
    where status = 'RUNNING' and started_at < now() - (timeout_ms * interval '1 millisecond')`,
  ai_failed: `select count(*)::int as count from ai_jobs where status = 'FAILED'`,
  image_stuck: `select count(*)::int as count from work_page_illustrations
    where status = 'RUNNING' and updated_at < now() - interval '30 minutes'`,
  video_stuck: `select count(*)::int as count from animation_scene_generations
    where status = 'RUNNING' and started_at < now() - interval '30 minutes'`,
  composition_stuck: `select count(*)::int as count from animation_compositions
    where status = 'RUNNING' and started_at < now() - interval '30 minutes'`,
};

try {
  await client.connect();
  const counts = {};
  for (const [rule, query] of Object.entries(rules)) {
    counts[rule] = (await client.query(query)).rows[0].count;
  }
  console.log(
    JSON.stringify({ event: 'RELIABILITY_SCAN', counts, checkedAt: new Date().toISOString() }),
  );
  if (Object.values(counts).some((count) => count > 0)) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: 'RELIABILITY_SCAN_FAILED' }));
  process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}
