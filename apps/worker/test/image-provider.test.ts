import { describe, expect, it } from 'vitest';
import { MockImageProvider } from '../src/image-provider.js';

describe('MockImageProvider', () => {
  it('returns a deterministic storage reference and never image binary', async () => {
    const provider = new MockImageProvider();
    const input = {
      model: 'mock-image-v1',
      prompt: 'fox in a forest',
      consistency: [
        {
          consistencyKey: '7dbe8e93-17cc-4bd5-87a5-1c787287f734',
          visualPrompt: 'orange fox with green scarf',
          referenceMediaAssetId: null,
        },
      ],
      signal: new AbortController().signal,
    };
    const first = await provider.generate(input);
    const second = await provider.generate(input);
    expect(first).toEqual(second);
    expect(first.objectKey).toMatch(/^picture-books\/mock\/[a-f0-9]{64}\.png$/);
    expect(JSON.stringify(first)).not.toMatch(/base64|data:image/i);
  });
});
