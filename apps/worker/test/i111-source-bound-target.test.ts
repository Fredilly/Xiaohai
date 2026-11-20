import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageJobProcessor } from '../src/image-processor.js';
import { createI111SourceBoundTargetWorker } from '../src/i111-source-bound-target.js';

const targetIllustrationId = '00000000-1111-4222-8333-444444444444';
const options = () => ({
  db: { transaction: () => Promise.resolve(null) } as never,
  targetIllustrationId,
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

  it('constructs real Worker/provider dependencies without network and permits processOne once', async () => {
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
      await expect(worker.processOne()).resolves.toBe(targetIllustrationId);
      await expect(worker.processOne()).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
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
    await expect(worker.processOne()).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
    await expect(worker.processOne()).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
    expect(processOne).toHaveBeenCalledOnce();
  });

  it('rejects an absent or wrong exact target without trying a second DB claim', async () => {
    const processOne = vi.spyOn(ImageJobProcessor.prototype, 'processOne').mockResolvedValue(null);
    const worker = createI111SourceBoundTargetWorker(options());
    await expect(worker.processOne()).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
    await expect(worker.processOne()).rejects.toThrow('I111_SOURCE_BOUND_TARGET_STOP');
    expect(processOne).toHaveBeenCalledOnce();
  });

  it('rejects any production env, wrong fixed BOS identity, timeout or illustration ID', () => {
    for (const invalid of [
      { targetIllustrationId: 'bad-id' },
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
