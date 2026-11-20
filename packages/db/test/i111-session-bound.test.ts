import type { PoolClient } from 'pg';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertI111SessionBoundDatabase,
  createI111SessionBoundDatabase,
  type DatabaseHandle,
} from '../src/client.js';

const makeClient = () => {
  const query = vi.fn(async () => ({ rows: [{ checked: 1 }] }));
  const client = {
    processID: 4321,
    query,
    release() {},
  } as unknown as PoolClient;
  return { client, query };
};

describe('I111 Drizzle on a checked-out PostgreSQL session', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('constructs without querying and retains the identical checked-out client', () => {
    vi.stubEnv('APP_ENV', 'dev');
    const { client, query } = makeClient();
    const db = createI111SessionBoundDatabase(client);
    expect(db.$client).toBe(client);
    expect(() => assertI111SessionBoundDatabase(db)).not.toThrow();
    expect(query).not.toHaveBeenCalled();
    // Source-bound API/Worker accept the same Drizzle type as createDatabase().
    const compatible: DatabaseHandle = db;
    expect(compatible).toBe(db);
  });

  it('routes transaction BEGIN, SQL, and COMMIT through the same client', async () => {
    vi.stubEnv('APP_ENV', 'dev');
    const { client, query } = makeClient();
    const db = createI111SessionBoundDatabase(client);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 as checked`);
    });
    const statements = query.mock.calls.map(([statement]) =>
      typeof statement === 'string'
        ? statement
        : ((statement as { text?: string })?.text ?? String(statement)),
    );
    expect(statements[0]).toMatch(/^begin\b/iu);
    expect(statements[1]).toMatch(/select 1 as checked/iu);
    expect(statements[2]).toMatch(/^commit\b/iu);
  });

  it('rejects a Pool, disconnected session, and forged environment', () => {
    vi.stubEnv('APP_ENV', 'dev');
    const { client } = makeClient();
    for (const invalid of [
      null,
      { query() {}, connect() {}, totalCount: 1 },
      { ...client, release: undefined },
      { ...client, processID: 0 },
      { ...client, processID: '4321' },
    ]) {
      expect(() => createI111SessionBoundDatabase(invalid as PoolClient)).toThrow(
        'I111_SESSION_DB_STOP',
      );
    }
    vi.stubEnv('APP_ENV', 'production');
    expect(() => createI111SessionBoundDatabase(client)).toThrow('I111_SESSION_DB_STOP');
  });

  it('rejects an unrelated handle and detects a changed session PID', () => {
    vi.stubEnv('APP_ENV', 'dev');
    const { client } = makeClient();
    const db = createI111SessionBoundDatabase(client);
    expect(() => assertI111SessionBoundDatabase({} as DatabaseHandle)).toThrow(
      'I111_SESSION_DB_STOP',
    );
    (client as PoolClient & { processID: number }).processID = 7890;
    expect(() => assertI111SessionBoundDatabase(db)).toThrow('I111_SESSION_DB_STOP');
  });
});
