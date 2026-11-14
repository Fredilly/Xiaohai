import { describe, expect, it } from 'vitest';
import {
  createIsolatedReferenceImageStorage,
  decodeReferencePng,
  InvalidReferencePngError,
  referenceObjectKey,
} from '../src/picture-book/reference-image-import.js';

const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';

describe('isolated character reference PNG import', () => {
  it('accepts a valid PNG and produces a stable owner-scoped key', () => {
    const image = decodeReferencePng(onePixelPng);
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const ids = {
      consumerUserId: '00000000-0000-4000-8000-000000000001',
      pictureBookId: '00000000-0000-4000-8000-000000000002',
      characterId: '00000000-0000-4000-8000-000000000003',
      image,
    };
    const key = referenceObjectKey(ids);
    expect(key).toMatch(
      /^picture-books\/character-references\/i111\/00000000-0000-4000-8000-000000000001\//,
    );
    expect(referenceObjectKey(ids)).toBe(key);
    expect(
      referenceObjectKey({
        ...ids,
        characterId: '00000000-0000-4000-8000-000000000004',
      }),
    ).not.toBe(key);
  });

  it('rejects malformed, empty, truncated and oversized PNGs', () => {
    for (const payload of [
      '',
      'YWJjZA==',
      onePixelPng.slice(0, -12),
      Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64'),
      onePixelPng.replace(/=/g, 'A'),
    ]) {
      expect(() => decodeReferencePng(payload)).toThrow(InvalidReferencePngError);
    }
  });

  it('refuses to configure an uploader in any non-dev or shared-bucket setting', () => {
    const base = {
      PICTURE_BOOK_REFERENCE_IMPORT_ENABLED: 'true',
      BAIDU_BOS_ENDPOINT: 'https://cd.bcebos.com/',
      BAIDU_BOS_PUBLIC_ORIGIN: 'https://xiaohai-prod-assets.cd.bcebos.com/',
      BAIDU_BOS_BUCKET: 'xiaohai-prod-assets',
      BAIDU_BOS_ACCESS_KEY_ID: 'test-key',
      BAIDU_BOS_SECRET_ACCESS_KEY: 'test-secret',
    };
    expect(createIsolatedReferenceImageStorage({ ...base, APP_ENV: 'production' })).toBeNull();
    expect(createIsolatedReferenceImageStorage({ ...base, APP_ENV: 'staging' })).toBeNull();
    expect(createIsolatedReferenceImageStorage({ ...base, APP_ENV: 'dev' })).toBeNull();
    expect(
      createIsolatedReferenceImageStorage({
        ...base,
        APP_ENV: 'dev',
        PICTURE_BOOK_REFERENCE_IMPORT_ENABLED: 'false',
      }),
    ).toBeNull();
    expect(
      createIsolatedReferenceImageStorage({
        ...base,
        APP_ENV: 'dev',
        NODE_ENV: 'production',
      }),
    ).toBeNull();
  });
});
