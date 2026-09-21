import { describe, expect, it } from 'vitest';
import { safeMediaReference } from '../src/security/media-policy.js';

describe('media metadata security gate', () => {
  const valid = {
    mimeType: 'video/mp4',
    objectKey: 'managed/example.mp4',
    playbackUrl: 'https://media.example.test/example.mp4',
    byteSize: 1024,
  };
  it('accepts passive HTTPS media references', () => expect(safeMediaReference(valid)).toBe(true));
  it('rejects active content, path traversal, huge assets and URL credentials', () => {
    expect(safeMediaReference({ ...valid, mimeType: 'text/html' })).toBe(false);
    expect(safeMediaReference({ ...valid, objectKey: '../script.mp4' })).toBe(false);
    expect(safeMediaReference({ ...valid, objectKey: 'script.svg' })).toBe(false);
    expect(safeMediaReference({ ...valid, byteSize: 2 ** 31 })).toBe(false);
    expect(
      safeMediaReference({ ...valid, playbackUrl: 'https://user:pass@media.test/a.mp4' }),
    ).toBe(false);
    expect(safeMediaReference({ ...valid, playbackUrl: 'data:video/mp4;base64,AA==' })).toBe(false);
  });
});
