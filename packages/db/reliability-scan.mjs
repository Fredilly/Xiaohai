// Read-only PostgreSQL checks shared by the CLI and integration tests.
export const invariantQueries = {
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
  finance_payment_projection_missing: `select count(*)::int as count from payment_ledger l
    left join finance_ledger_entries f on f.payment_ledger_id = l.id
    where f.id is null`,
  finance_payment_projection_mismatch: `select count(*)::int as count from finance_ledger_entries f
    join payment_ledger l on l.id = f.payment_ledger_id
    where f.source_kind <> 'PAYMENT_LEDGER' or f.event_type <> l.kind
      or f.event_key <> 'payment-ledger:' || l.event_key
      or f.cash_delta_minor <> case when l.kind = 'PAYMENT' then l.amount_minor else -l.amount_minor end`,
  finance_commission_projection_missing: `select count(*)::int as count from commission_events e
    left join finance_ledger_entries f on f.commission_event_id = e.id
    where e.type in ('FROZEN','SETTLED','REVERSED','WITHDRAWAL_HELD','WITHDRAWAL_RELEASED','WITHDRAWAL_PAID')
      and f.id is null`,
  payment_reconciliation_discrepancy: `select count(*)::int as count from (
      select distinct on (payment_id) outcome from reconciliation_items
      order by payment_id, created_at desc, id desc
    ) latest where outcome in ('REVIEW_REQUIRED','FAILED')`,
  finance_reconciliation_discrepancy: `select count(*)::int as count from finance_reconciliation_items
    where run_id = (select id from finance_reconciliation_runs
      where status = 'COMPLETED' order by completed_at desc, id desc limit 1)
      and outcome in ('MISSING','MISMATCH')`,
};

export const stuckQueries = {
  ai_stuck: `select count(*)::int as count from ai_jobs
    where status = 'RUNNING' and started_at < now() - (timeout_ms * interval '1 millisecond')`,
  image_stuck: `select count(*)::int as count from work_page_illustrations
    where status = 'RUNNING' and updated_at < now() - interval '30 minutes'`,
  video_stuck: `select count(*)::int as count from animation_scene_generations
    where status = 'RUNNING' and started_at < now() - interval '30 minutes'`,
  composition_stuck: `select count(*)::int as count from animation_compositions
    where status = 'RUNNING' and started_at < now() - interval '30 minutes'`,
};

export const metricQueries = {
  ai_failed_total: `select count(*)::int as count from ai_jobs where status = 'FAILED'`,
};

export async function scanReliability(client) {
  const counts = {};
  for (const [name, query] of Object.entries({
    ...invariantQueries,
    ...stuckQueries,
    ...metricQueries,
  })) {
    counts[name] = (await client.query(query)).rows[0].count;
  }
  const alerts = {
    invariant: Object.keys(invariantQueries).filter((name) => counts[name] > 0),
    stuck: Object.keys(stuckQueries).filter((name) => counts[name] > 0),
  };
  return { counts, alerts, hasAlert: alerts.invariant.length + alerts.stuck.length > 0 };
}
