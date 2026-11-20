import { describe, expect, it } from 'vitest';
import * as vm from 'node:vm';
import {
  I111_TRUSTED_SESSION_NEGATIVE_CASES,
  runI111TrustedCoordinator,
} from '../src/i111-trusted-coordinator.js';
import { readFile } from 'node:fs/promises';
import * as typescript from 'typescript';

const sourcePath = new URL('../src/i111-trusted-coordinator.ts', import.meta.url);

type HarnessOptions = {
  backendPids?: number[];
  unlockResult?: boolean;
  releaseThrows?: boolean;
  endNever?: boolean;
};

async function loadPrivateKernel(options: HarnessOptions = {}) {
  const source = await readFile(sourcePath, 'utf8');
  const body = source.slice(source.indexOf('const STOP =')).replace(/^export\s+/gmu, '');
  const program = `
    const pg = globalThis.__pg;
    const drizzle = globalThis.__drizzle;
    const schema = {};
    ${body}
    globalThis.__kernel = { executeOwnedLifecycle };
  `;
  const output = typescript.transpileModule(program, {
    compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.None },
  }).outputText;
  const calls: Array<{ owner: object; sql: string }> = [];
  const events: string[] = [];
  const pid = 4321;
  const backendPids = [...(options.backendPids ?? [pid, pid])];
  const client = {
    processID: pid,
    async query(sql: string) {
      calls.push({ owner: client, sql });
      if (sql.includes('pg_try_advisory_lock')) {
        events.push('lock');
        return { rows: [{ locked: true }] };
      }
      if (sql.includes('pg_backend_pid')) {
        events.push('backend');
        const backendPid = backendPids.shift() ?? pid;
        return { rows: [{ backend_pid: backendPid }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        events.push('unlock');
        return { rows: [{ unlocked: options.unlockResult ?? true }] };
      }
      throw new Error('unexpected SQL');
    },
    release() {
      events.push('release');
      if (options.releaseThrows) throw new Error('release failure');
    },
  };
  const pool = {
    async connect() {
      events.push('connect');
      return client;
    },
    end() {
      events.push('end');
      return options.endNever ? new Promise<void>(() => {}) : Promise.resolve();
    },
  };
  class FakePool {
    constructor() {
      return pool;
    }
  }
  const context: Record<string, unknown> = {
    __pg: { Pool: FakePool },
    __drizzle: (received: object) => ({ received }),
    setTimeout,
    clearTimeout,
    Promise,
    console,
  };
  context.globalThis = context;
  vm.runInNewContext(output, context);
  return {
    executeOwnedLifecycle: (context.__kernel as { executeOwnedLifecycle: typeof Function })
      .executeOwnedLifecycle,
    client,
    calls,
    events,
  };
}

describe('I111 Trusted Coordinator ownership kernel', () => {
  it('is default-deny and rejects every caller-supplied argument', async () => {
    await expect(runI111TrustedCoordinator()).resolves.toMatchObject({
      verdict: 'STOP',
      errorCode: 'I111_TRUSTED_COORDINATOR_NOT_ENABLED',
      paidExecutionAuthorized: false,
    });
    await expect(runI111TrustedCoordinator({ client: {} })).resolves.toMatchObject({
      verdict: 'STOP',
      paidExecutionAuthorized: false,
    });
  });

  it('records the required future rejection cases without claiming live proof', () => {
    expect(I111_TRUSTED_SESSION_NEGATIVE_CASES).toEqual(
      expect.arrayContaining([
        'pool-query-wrapper',
        'bare-pool',
        'caller-client-or-drizzle',
        'two-distinct-clients',
        'premature-or-double-release',
        'backend-pid-change',
        'cross-backend-transaction',
        'in-flight-query-at-release',
        'lock-query-transaction-unlock-release-failure',
        'unknown-provider-result',
      ]),
    );
  });

  it('keeps ownership and release lifecycle private and rejects unsafe composition shapes', async () => {
    const source = await readFile(sourcePath, 'utf8');
    expect(source).toContain('await pool.connect()');
    expect(source).toContain('drizzle(client, { schema })');
    expect(source).toContain('await releaseOwnedLock(client, lockState.pinnedPid)');
    expect(source).toContain('client.release()');
    expect(source).toContain('let safeToRelease = !lockState.acquired');
    expect(source).toContain('if (client && safeToRelease)');
    expect(source).toContain('POOL_END_TIMEOUT_MS');
    expect(source).toContain('await Promise.race([ending, timeout])');
    expect(source).toContain('timer.unref()');
    expect(source.indexOf('await releaseOwnedLock(client, lockState.pinnedPid)')).toBeLessThan(
      source.indexOf('client.release()'),
    );
    expect(source).not.toContain('pool.query(');
    expect(source).not.toContain('WeakMap');
    expect(source).not.toContain('provider.generate');
    expect(source).not.toContain('processTargetIdWithAtomicGateOnce');
    expect(source).not.toContain('apiService');
    expect(source).not.toContain('createTargetWorker');
  });

  it('uses one checked-out client and unlocks before release and pool end', async () => {
    const harness = await loadPrivateKernel();
    await expect(harness.executeOwnedLifecycle('offline-test')).rejects.toThrow(
      'I111_TRUSTED_COORDINATOR_PORTS_NOT_WIRED',
    );
    expect(harness.events).toEqual(['connect', 'lock', 'backend', 'backend', 'unlock', 'release', 'end']);
    expect(new Set(harness.calls.map((call) => call.owner)).size).toBe(1);
    expect(harness.calls.map((call) => call.owner)).toEqual(
      harness.calls.map(() => harness.client),
    );
  });

  it('stops without release when the backend changes after lock acquisition', async () => {
    const harness = await loadPrivateKernel({ backendPids: [9999, 9999] });
    await expect(harness.executeOwnedLifecycle('offline-test')).rejects.toThrow(
      'I111_TRUSTED_COORDINATOR_STOP',
    );
    expect(harness.events).toEqual(['connect', 'lock', 'backend', 'backend', 'end']);
  });

  it('stops without release when unlock returns false', async () => {
    const harness = await loadPrivateKernel({ unlockResult: false });
    await expect(harness.executeOwnedLifecycle('offline-test')).rejects.toThrow(
      'I111_TRUSTED_COORDINATOR_STOP',
    );
    expect(harness.events).toEqual(['connect', 'lock', 'backend', 'backend', 'unlock', 'end']);
  });

  it('reports release failure and never treats it as success', async () => {
    const harness = await loadPrivateKernel({ releaseThrows: true });
    await expect(harness.executeOwnedLifecycle('offline-test')).rejects.toThrow(
      'I111_TRUSTED_COORDINATOR_STOP',
    );
    expect(harness.events).toEqual(['connect', 'lock', 'backend', 'backend', 'unlock', 'release', 'end']);
  });

  it('bounds a pool.end that never resolves after a safe release', async () => {
    const harness = await loadPrivateKernel({ endNever: true });
    const started = Date.now();
    await expect(harness.executeOwnedLifecycle('offline-test')).rejects.toThrow(
      'I111_TRUSTED_COORDINATOR_STOP',
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(harness.events).toEqual(['connect', 'lock', 'backend', 'backend', 'unlock', 'release', 'end']);
  });

  it('bounds pool.end when unlock fails and the client must remain unreleased', async () => {
    const harness = await loadPrivateKernel({ unlockResult: false, endNever: true });
    const started = Date.now();
    await expect(harness.executeOwnedLifecycle('offline-test')).rejects.toThrow(
      'I111_TRUSTED_COORDINATOR_STOP',
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(harness.events).toEqual(['connect', 'lock', 'backend', 'backend', 'unlock', 'end']);
  });
});
