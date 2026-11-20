import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BailianImageProvider } from '../src/image-provider.js';
import { createI111SourceBoundTargetWorker } from '../src/i111-source-bound-target.js';
import type * as I111Gate from '../src/i111-paid-attempt-gate.js';

// Keep the real source-bound factory and ImageJobProcessor. Only replace the
// DB-backed marker operation at the I/O boundary: its SQL/locking semantics
// are covered separately by image-processor.integration.test.ts.
const marker = vi.hoisted(() => ({
  consume: vi.fn(),
  note: vi.fn(),
}));
vi.mock('../src/i111-paid-attempt-gate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof I111Gate>()),
  consumeI111ProviderSlot: marker.consume,
  noteI111ProviderOutcome: marker.note,
}));

const targetId = '00000000-1111-4222-8333-444444444444';
const pageId = '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb';
const budgetKey = 'I111_MAC_PLAN_B_THREE_PAID_IMAGE_CALLS';
const queued = {
  id: targetId,
  pageId,
  revisionNumber: 1,
  status: 'QUEUED',
  provider: 'BAILIAN',
  model: 'qwen-image-3.0',
  prompt: 'offline test',
  consistency: [],
};
const atomicInput = { targetId, slot: { pageId, revisionNumber: 1, regenerate: false } };

function workerOptions(db: unknown) {
  return {
    db: db as never,
    targetIllustrationId: targetId,
    workspaceId: 'ws-31e71dbr72cfr5th',
    apiKey: 'dummy-key-for-local-test',
    imageTimeoutMs: 600_000,
    bos: {
      endpoint: 'https://cd.bcebos.com/',
      bucket: 'xiaohai-i111-work-2ec3900280',
      publicOrigin: 'https://xiaohai-i111-work-2ec3900280.cd.bcebos.com/',
      accessKeyId: 'dummy-bos-access',
      secretAccessKey: 'dummy-bos-secret',
    },
  };
}

function offlineDb() {
  const updates: Array<Record<string, unknown>> = [];
  const transaction = async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => ({ for: () => Promise.resolve([queued]) }) }),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({ returning: () => Promise.resolve([{ ...queued, ...values }]) }),
        }),
      }),
    });
  const db = {
    transaction,
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([{ status: 'RESERVED', uncertainty: 'NONE', budgetKey }]),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, updates };
}

describe('#111 exact-ID real Worker call graph (all I/O mocked)', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ENV', 'dev');
    marker.consume.mockReset();
    marker.note.mockReset();
    marker.note.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never enters Bailian provider or fetch when the durable marker cannot commit', async () => {
    const { db, updates } = offlineDb();
    marker.consume.mockRejectedValue(new Error('marker transaction aborted'));
    const provider = vi.spyOn(BailianImageProvider.prototype, 'generate');
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const worker = createI111SourceBoundTargetWorker(workerOptions(db));

    // The production processor reports the processed ID even on a failed
    // generation. Only independently readFinalEvidence can establish success.
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput)).resolves.toBe(targetId);
    expect(marker.consume).toHaveBeenCalledOnce();
    expect(marker.consume).toHaveBeenCalledWith(db, targetId);
    expect(marker.note).toHaveBeenCalledOnce();
    expect(provider).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(updates).toEqual([expect.objectContaining({ status: 'FAILED' })]);
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput)).rejects.toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
    expect(marker.consume).toHaveBeenCalledOnce();
  });

  it('enters provider only after the marker commits and never repeats an uncertain call', async () => {
    const { db } = offlineDb();
    const order: string[] = [];
    marker.consume.mockImplementation(() => {
      order.push('durable-marker-committed');
      return Promise.resolve(1);
    });
    vi.spyOn(BailianImageProvider.prototype, 'generate').mockImplementation(() => {
      order.push('provider-entered');
      return Promise.reject(new Error('synthetic unknown outcome'));
    });
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', network);

    const worker = createI111SourceBoundTargetWorker(workerOptions(db));
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput)).resolves.toBe(targetId);
    expect(order).toEqual(['durable-marker-committed', 'provider-entered']);
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput)).rejects.toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
    expect(order).toHaveLength(2);
    expect(network).not.toHaveBeenCalled();
  });
});
