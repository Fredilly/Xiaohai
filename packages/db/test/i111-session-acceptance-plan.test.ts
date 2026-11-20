import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const planUrl = new URL('../../../docs/I111_DISPOSABLE_POSTGRES_SESSION_ACCEPTANCE_PLAN.md', import.meta.url);
const coordinatorUrl = new URL('../src/i111-trusted-coordinator.ts', import.meta.url);

describe('I111 disposable PostgreSQL acceptance plan', () => {
  it('keeps the live acceptance explicitly disposable, independent and fail-closed', async () => {
    const plan = await readFile(planUrl, 'utf8');
    for (const required of [
      'DESIGN ONLY / NO-GO',
      'dedicated, disposable PostgreSQL',
      'must not use production',
      /shared\s+staging/,
      'must not run migrations',
      'independent observer',
      'pg_stat_activity',
      'pg_locks',
      'backend_start',
      'UNKNOWN/STOP',
      'Future human authorization required',
      'I111_ATOMIC_ISOLATION_UNVERIFIED',
      'I111_RETRY_SEMANTICS_UNVERIFIED',
      'I111_REMOTE_BOS_UNVERIFIED',
      'I111_PRICE_BASIS_UNVERIFIED',
      '`paidExecutionAuthorized=false`',
    ] as const) {
      if (required instanceof RegExp) {
        expect(plan).toMatch(required);
      } else {
        expect(plan).toContain(required);
      }
    }
  });

  it('does not turn the private kernel into a public execution entry', async () => {
    const source = await readFile(coordinatorUrl, 'utf8');
    expect(source).toContain("errorCode: DISABLED");
    expect(source).toContain('paidExecutionAuthorized: false');
    expect(source).not.toContain('provider.generate(');
    expect(source).not.toContain('processOne(');
    expect(source).not.toContain('export async function executeOwnedLifecycle');
  });
});
