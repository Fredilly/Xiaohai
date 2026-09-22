import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { scanReliability } from '../reliability-scan.mjs';

test('scanner executes real schema, distinguishes alerts and metrics, and remains read-only', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/xiaohai_test');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const baseline = await scanReliability(client);
    assert.equal(baseline.hasAlert, false, JSON.stringify(baseline.alerts));
    assert.ok(Object.values(baseline.counts).every((count) => Number.isInteger(count)));

    const cli = spawnSync(process.execPath, ['scripts-reliability-scan.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: process.env,
      encoding: 'utf8',
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).event, 'RELIABILITY_SCAN');

    await client.query('BEGIN');
    try {
      const user = await client.query('insert into consumer_users default values returning id');
      const project = await client.query(
        `insert into ai_projects (project_type, title, created_by_consumer_user_id)
         values ('STORY', 'scanner fixture', $1) returning id`,
        [user.rows[0].id],
      );
      await client.query(
        `insert into ai_jobs (project_id, provider, model, status, input)
         values ($1, 'MOCK', 'scanner-fixture', 'FAILED', '{"prompt":"fixture"}'::jsonb)`,
        [project.rows[0].id],
      );
      const historical = await scanReliability(client);
      assert.equal(historical.counts.ai_failed_total, baseline.counts.ai_failed_total + 1);
      assert.equal(historical.hasAlert, false, JSON.stringify(historical.alerts));

      const staff = await client.query(
        'insert into staff_accounts (login_identifier, password_hash) values ($1, $2) returning id',
        [randomUUID(), 'test-only'],
      );
      const run = await client.query(
        `insert into finance_reconciliation_runs
          (requested_by_staff_account_id, range_from, range_to, status, completed_at)
         values ($1, now() - interval '1 day', now(), 'COMPLETED', now()) returning id`,
        [staff.rows[0].id],
      );
      await client.query(
        `insert into finance_reconciliation_items
          (run_id, source_kind, source_id, event_key, event_type, outcome,
           expected_cash_delta_minor, expected_commission_frozen_delta_minor,
           expected_commission_available_delta_minor)
         values ($1, 'PAYMENT_LEDGER', $2, 'scanner-fixture', 'PAYMENT', 'MISSING', 100, 0, 0)`,
        [run.rows[0].id, randomUUID()],
      );
      const discrepancy = await scanReliability(client);
      assert.equal(discrepancy.counts.finance_reconciliation_discrepancy, 1);
      assert.ok(discrepancy.alerts.invariant.includes('finance_reconciliation_discrepancy'));

      await client.query(
        `insert into ai_jobs (id, project_id, provider, model, status, input, started_at, timeout_ms)
         values ($1, $2, 'MOCK', 'scanner-fixture', 'RUNNING', '{"prompt":"fixture"}'::jsonb,
           '2020-01-01', 1000)`,
        [randomUUID(), project.rows[0].id],
      );
      const before = await client.query('select count(*)::int as count from ai_jobs');
      const anomaly = await scanReliability(client);
      const after = await client.query('select count(*)::int as count from ai_jobs');
      assert.equal(anomaly.counts.ai_stuck, baseline.counts.ai_stuck + 1);
      assert.ok(anomaly.alerts.stuck.includes('ai_stuck'));
      assert.equal(anomaly.hasAlert, true);
      assert.equal(after.rows[0].count, before.rows[0].count);
    } finally {
      await client.query('ROLLBACK');
    }
    assert.deepEqual((await scanReliability(client)).counts, baseline.counts);
  } finally {
    await client.end();
  }
});
