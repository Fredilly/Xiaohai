import { describe, expect, it, vi } from 'vitest';
import { BosStorage, type BosPutObjectClient } from '../src/bos-storage.js';

describe('BosStorage', () => {
  it('uploads bytes with metadata and returns a permanent public URL', async () => {
    const putObject = vi.fn<BosPutObjectClient['putObject']>().mockResolvedValue({});
    const storage = new BosStorage({
      bucket: 'xiaohai-assets',
      publicOrigin: 'https://assets.example.com/',
      client: { putObject },
    });
    const body = Buffer.from('png-bytes');

    await expect(
      storage.putImage({
        objectKey: 'picture-books/bailian/id with space.png',
        body,
        mimeType: 'image/png',
      }),
    ).resolves.toEqual({
      objectKey: 'picture-books/bailian/id with space.png',
      playbackUrl: 'https://assets.example.com/picture-books/bailian/id%20with%20space.png',
      byteSize: body.byteLength,
    });
    expect(putObject).toHaveBeenCalledWith(
      'xiaohai-assets',
      'picture-books/bailian/id with space.png',
      body,
      { headers: { 'Content-Type': 'image/png', 'Content-Length': body.byteLength } },
    );
  });
});
