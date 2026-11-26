import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageJobProcessor } from '../src/image-processor.js';
import { createI111SourceBoundTargetWorker } from '../src/i111-source-bound-target.js';

const targetIllustrationId = '00000000-1111-4222-8333-444444444444';
const slot = {
  pageId: '6fe359ee-71b0-43f5-b49b-08fe2b48a9cb',
  revisionNumber: 1,
  regenerate: false,
};
const validSlots = [
  slot,
  { pageId: 'eae00ed5-6026-4a41-b95a-6c9eea09d076', revisionNumber: 1, regenerate: false },
  { pageId: 'eae00ed5-6026-4a41-b95a-6c9eea09d076', revisionNumber: 2, regenerate: true },
] as const;
const slotSwaps = validSlots.flatMap((expectedSlot, index) =>
  validSlots
    .filter((_, suppliedIndex) => index !== suppliedIndex)
    .map((suppliedSlot) => ({ expectedSlot, suppliedSlot })),
);
const atomicInput = () => ({ targetId: targetIllustrationId, slot });
const options = () => ({
  db: { transaction: () => Promise.resolve(null) } as never,
  targetIllustrationId,
  expectedSlot: slot,
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
});

describe('I111 source-bound exact-target Worker construction', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ENV', 'dev');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('constructs real Worker/provider dependencies without network and permits exact atomic target once', async () => {
    const processOne = vi
      .spyOn(ImageJobProcessor.prototype, 'processOne')
      .mockResolvedValue(targetIllustrationId);
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', network);
    try {
      const worker = createI111SourceBoundTargetWorker(options());
      expect(network).not.toHaveBeenCalled();
      expect(worker.transportUsageSummary()).toEqual({
        paidPostConsumed: false,
        paidPostSucceeded: false,
        imageDownloadConsumed: false,
        paidExecutionAuthorized: false,
      });
      await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).resolves.toBe(
        targetIllustrationId,
      );
      await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).rejects.toThrow(
        'I111_SOURCE_BOUND_TARGET_STOP',
      );
      expect(processOne).toHaveBeenCalledOnce();
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not retry after an unknown result from the real processOne method', async () => {
    const processOne = vi
      .spyOn(ImageJobProcessor.prototype, 'processOne')
      .mockRejectedValue(new Error('do not expose details'));
    const worker = createI111SourceBoundTargetWorker(options());
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).rejects.toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).rejects.toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
    expect(processOne).toHaveBeenCalledOnce();
  });

  it('rejects an absent or wrong exact target without trying a second DB claim', async () => {
    const processOne = vi.spyOn(ImageJobProcessor.prototype, 'processOne').mockResolvedValue(null);
    const worker = createI111SourceBoundTargetWorker(options());
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).rejects.toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).rejects.toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
    expect(processOne).toHaveBeenCalledOnce();
  });

  it('rejects a wrong target, invalid slot, extra fields and legacy direct processOne', async () => {
    const processOne = vi.spyOn(ImageJobProcessor.prototype, 'processOne');
    const worker = createI111SourceBoundTargetWorker(options());
    expect('processOne' in worker).toBe(false);
    for (const input of [
      { ...atomicInput(), targetId: crypto.randomUUID() },
      { ...atomicInput(), slot: { ...slot, pageId: '00000000-1111-4222-8333-444444444446' } },
      { ...atomicInput(), slot: { ...slot, revisionNumber: 2 } },
      {
        ...atomicInput(),
        slot: {
          pageId: 'eae00ed5-6026-4a41-b95a-6c9eea09d076',
          revisionNumber: 1,
          regenerate: false,
        },
      },
      { ...atomicInput(), extra: true },
    ]) {
      await expect(worker.processTargetIdWithAtomicGateOnce(input)).rejects.toThrow(
        'I111_SOURCE_BOUND_TARGET_STOP',
      );
    }
    expect(processOne).not.toHaveBeenCalled();
  });

  it.each(slotSwaps)(
    'rejects an otherwise legal slot swap %# before the exact worker can claim DB work',
    async ({ expectedSlot, suppliedSlot }) => {
      const processOne = vi.spyOn(ImageJobProcessor.prototype, 'processOne');
      const worker = createI111SourceBoundTargetWorker({ ...options(), expectedSlot });
      await expect(
        worker.processTargetIdWithAtomicGateOnce({
          targetId: targetIllustrationId,
          slot: suppliedSlot,
        }),
      ).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
      expect(processOne).not.toHaveBeenCalled();
    },
  );

  it('pins the expected slot even if the constructor input is mutated later', async () => {
    const processOne = vi
      .spyOn(ImageJobProcessor.prototype, 'processOne')
      .mockResolvedValue(targetIllustrationId);
    const expectedSlot = { ...slot };
    const worker = createI111SourceBoundTargetWorker({ ...options(), expectedSlot });
    expectedSlot.pageId = 'eae00ed5-6026-4a41-b95a-6c9eea09d076';
    await expect(
      worker.processTargetIdWithAtomicGateOnce({
        targetId: targetIllustrationId,
        slot: expectedSlot,
      }),
    ).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
    await expect(worker.processTargetIdWithAtomicGateOnce(atomicInput())).resolves.toBe(
      targetIllustrationId,
    );
    expect(processOne).toHaveBeenCalledOnce();
  });

  it('rejects any production env, wrong fixed BOS identity, timeout or illustration ID', () => {
    for (const invalid of [
      { targetIllustrationId: 'bad-id' },
      { expectedSlot: { ...slot, revisionNumber: 2 } },
      { expectedSlot: null as never },
      { imageTimeoutMs: 10_000 },
      { imageTimeoutMs: 780_001 },
      { apiKey: 'INJECT_UNSAFE_KEY' },
      { bos: { ...options().bos, bucket: 'xiaohai-prod-assets' } },
      { bos: { ...options().bos, publicOrigin: 'https://evil.invalid/' } },
      { bos: { ...options().bos, secretAccessKey: 'INJECT_MISSING' } },
    ]) {
      expect(() => createI111SourceBoundTargetWorker({ ...options(), ...invalid })).toThrow(
        'I111_SOURCE_BOUND_TARGET_STOP',
      );
    }
    vi.stubEnv('APP_ENV', 'production');
    expect(() => createI111SourceBoundTargetWorker(options())).toThrow(
      'I111_SOURCE_BOUND_TARGET_STOP',
    );
  });
});
