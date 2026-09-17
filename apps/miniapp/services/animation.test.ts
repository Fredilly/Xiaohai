import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeAnimation, generateAnimationPlan, generateScene } from './animation';

afterEach(() => vi.unstubAllGlobals());

describe('Mini Program Animation boundary', () => {
  it('never sends provider, model, status, media or cost controls', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('wx', {
      getStorageSync: () => 'consumer-token',
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      request: (input: Record<string, unknown> & { success: (value: unknown) => void }) => {
        requests.push(input);
        input.success({ statusCode: 202, data: {} });
      },
    });
    await generateAnimationPlan('animation-id', 'SCRIPT');
    await generateScene('animation-id', 'scene-id');
    await composeAnimation('animation-id', ['generation-id']);
    expect(requests.map((request) => request.data)).toEqual([
      { operation: 'SCRIPT' },
      {},
      { sceneGenerationIds: ['generation-id'] },
    ]);
    expect(JSON.stringify(requests)).not.toMatch(/provider|model|mediaAsset|cost|timeout/i);
  });
});
