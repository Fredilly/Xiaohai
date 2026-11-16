import { describe, expect, it } from 'vitest';
import { createPrivateBosPlaybackResolver } from '../src/picture-book/private-bos-urls.js';

const bucket = 'xiaohai-staging-assets';
const host = `${bucket}.cd.bcebos.com`;
const key = 'picture-books/bailian/test.png';
const importedKey = [
  'picture-books/character-references/i111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  `${'a'.repeat(64)}.png`,
].join('/');
const asset = {
  provider: 'BAIDU_BOS',
  objectKey: key,
  playbackUrl: `https://${host}/${key}`,
};
const env = {
  BAIDU_BOS_ENDPOINT: 'https://cd.bcebos.com',
  BAIDU_BOS_PUBLIC_ORIGIN: `https://${host}`,
  BAIDU_BOS_BUCKET: bucket,
  BAIDU_BOS_ACCESS_KEY_ID: 'test-ak',
  BAIDU_BOS_SECRET_ACCESS_KEY: 'test-sk',
};

describe('private BOS owner-scoped playback signer', () => {
  it('creates a short-lived 300-second GET capability without a provider call', () => {
    const calls: unknown[][] = [];
    const resolveUrl = createPrivateBosPlaybackResolver(
      env,
      {
        generatePresignedUrl: (...args) => {
          calls.push(args);
          return `https://cd.bcebos.com/${bucket}/${key}?authorization=signature`;
        },
      },
      () => 1_800_000_000_000,
    );
    expect(resolveUrl(asset)).toContain('?authorization=signature');
    expect(calls).toEqual([[bucket, key, 1_800_000_000, 300]]);
  });

  it('signs the exact legacy #111 double-slash URL without changing the stored record', () => {
    const calls: unknown[][] = [];
    const signedUrl = `https://cd.bcebos.com/${bucket}/${importedKey}?authorization=signature`;
    const resolveUrl = createPrivateBosPlaybackResolver(
      { ...env, BAIDU_BOS_PUBLIC_ORIGIN: `https://${host}/` },
      {
        generatePresignedUrl: (...args) => {
          calls.push(args);
          return signedUrl;
        },
      },
      () => 1_800_000_000_000,
    );
    const originalUrl = `https://${host}//${importedKey}`;
    const importedAsset = { ...asset, objectKey: importedKey, playbackUrl: originalUrl };
    expect(resolveUrl(importedAsset)).toBe(signedUrl);
    expect(importedAsset.playbackUrl).toBe(originalUrl);
    expect(calls).toEqual([[bucket, importedKey, 1_800_000_000, 300]]);

    // Compatibility is limited to one historical extra slash on #111 imports.
    for (const playbackUrl of [
      `https://${host}///${importedKey}`,
      `https://${host}//${importedKey}?token=bad`,
      `https://${host}//${importedKey}#fragment`,
      `https://xiaohai-prod-assets.cd.bcebos.com//${importedKey}`,
      `http://${host}//${importedKey}`,
      `https://${host}//other.png`,
    ]) {
      expect(resolveUrl({ ...importedAsset, playbackUrl })).toBeNull();
    }
    expect(resolveUrl({ ...asset, playbackUrl: `https://${host}//${key}` })).toBeNull();
  });

  it('returns null without credentials and never discloses a raw BOS URL', () => {
    expect(createPrivateBosPlaybackResolver({})(asset)).toBeNull();
    expect(
      createPrivateBosPlaybackResolver({
        ...env,
        BAIDU_BOS_SECRET_ACCESS_KEY: 'INJECT_FROM_SECRET_MANAGER',
      })(asset),
    ).toBeNull();
  });

  it('rejects unrelated assets, forged origins, bare query tokens and other keys', () => {
    const signer = { generatePresignedUrl: () => `https://${host}/${key}?bce-auth=test` };
    const resolveUrl = createPrivateBosPlaybackResolver(env, signer);
    expect(resolveUrl({ ...asset, provider: 'EXTERNAL' })).toBeNull();
    expect(resolveUrl({ ...asset, objectKey: '../secret.png' })).toBeNull();
    expect(
      resolveUrl({
        ...asset,
        playbackUrl: 'https://xiaohai-prod-assets.cd.bcebos.com/private.png',
      }),
    ).toBeNull();
    expect(resolveUrl({ ...asset, playbackUrl: `https://${host}/other.png` })).toBeNull();
    expect(resolveUrl({ ...asset, playbackUrl: `https://${host}/${key}?token=bad` })).toBeNull();
  });

  it('rejects unsafe signing results including unsigned URLs', () => {
    const forged = createPrivateBosPlaybackResolver(env, {
      generatePresignedUrl: () => 'https://attacker.example/secret.png?authorization=secret',
    });
    expect(forged(asset)).toBeNull();
    const unsigned = createPrivateBosPlaybackResolver(env, {
      generatePresignedUrl: () => `https://${host}/${key}`,
    });
    expect(unsigned(asset)).toBeNull();
  });

  it('fails closed when endpoint or configured bucket does not match the public origin', () => {
    expect(
      createPrivateBosPlaybackResolver({
        ...env,
        BAIDU_BOS_PUBLIC_ORIGIN: 'https://xiaohai-prod-assets.cd.bcebos.com',
      })(asset),
    ).toBeNull();
  });
});
