import { describe, expect, it } from 'vitest';
import { MockCompositionProvider } from '../src/composition-provider.js';

describe('MockCompositionProvider', () => {
  it('returns deterministic metadata without media binary', async () => {
    const provider = new MockCompositionProvider();
    const input = {
      compositionId: 'composition-1',
      scenes: [
        {
          sceneGenerationId: 'generation-1',
          sceneOrder: 1,
          playbackUrl: 'https://mock.invalid/scene.mp4',
          mimeType: 'video/mp4',
          durationSeconds: 5,
        },
      ],
      signal: new AbortController().signal,
    };
    const first = await provider.compose(input);
    const second = await provider.compose(input);
    expect(first).toEqual(second);
    expect(first.mimeType).toBe('video/mp4');
    expect(first.durationSeconds).toBe(5);
    expect(JSON.stringify(first)).not.toMatch(/base64|data:video/i);
  });
});
