import { describe, expect, it, vi } from 'vitest';
import {
  createPrivateBosReferenceResolver,
  PRIVATE_REFERENCE_TTL_SECONDS,
} from '../src/private-bos-reference.js';

const bucket = 'xiaohai-i111-work-2ec3900280';
const endpoint = 'https://cd.bcebos.com';
const publicOrigin = 'https://' + bucket + '.cd.bcebos.com';
const owner = '11111111-1111-4111-8111-111111111111';
const book = '90d7f77e-ae23-40ef-90b6-a672412c6318';
const character = 'de0169d8-d975-4f1b-b04c-a15c25f54bdc';
const hash = 'a'.repeat(64);
const key = [
  'picture-books',
  'character-references',
  'i111',
  owner,
  book,
  character,
  hash + '.png',
].join('/');
const recorded = publicOrigin + '/' + key;
const asset = { provider: 'BAIDU_BOS', objectKey: key, playbackUrl: recorded };
const config = {
  endpoint,
  publicOrigin,
  bucket,
  accessKeyId: 'test-ak-not-real',
  secretAccessKey: 'test-sk-not-real',
};
const now = () => 1_700_000_000_000;

describe('Bailian private BOS reference inputs', () => {
  it('signs the canonical key with short TTL without exposing the unsigned URL', () => {
    const signer = {
      generatePresignedUrl: vi.fn(() => endpoint + '/' + key + '?authorization=signed-test'),
    };
    const resolve = createPrivateBosReferenceResolver(config, signer, now);
    const signed = resolve(asset);
    expect(signer.generatePresignedUrl).toHaveBeenCalledOnce();
    expect(signer.generatePresignedUrl).toHaveBeenCalledWith(
      bucket,
      key,
      1_700_000_000,
      PRIVATE_REFERENCE_TTL_SECONDS,
    );
    expect(PRIVATE_REFERENCE_TTL_SECONDS).toBe(300);
    expect(signed).not.toBe(recorded);
    expect(new URL(signed!).search).toBe('?authorization=signed-test');
  });

  it('accepts only the original #111 historical double slash in stored metadata', () => {
    const signer = {
      generatePresignedUrl: vi.fn(() => endpoint + '/' + key + '?authorization=signed-test'),
    };
    const resolve = createPrivateBosReferenceResolver(config, signer, now);
    expect(resolve({ ...asset, playbackUrl: publicOrigin + '//' + key })).toContain(
      '?authorization=signed-test',
    );
    const nonI111 = 'picture-books/character-references/other/' + hash + '.png';
    expect(
      resolve({
        ...asset,
        objectKey: nonI111,
        playbackUrl: publicOrigin + '//' + nonI111,
      }),
    ).toBeNull();
  });

  it('rejects wrong bucket, unsafe key, unsigned or redirected signer outputs', () => {
    const signer = {
      generatePresignedUrl: vi.fn(() => endpoint + '/' + key + '?authorization=signed-test'),
    };
    const resolve = createPrivateBosReferenceResolver(config, signer, now);
    for (const changed of [
      { ...asset, provider: 'MOCK_IMAGE' },
      { ...asset, playbackUrl: 'https://another-bucket.cd.bcebos.com/' + key },
      { ...asset, playbackUrl: 'http://' + bucket + '.cd.bcebos.com/' + key },
      { ...asset, playbackUrl: recorded + '?token=old' },
      { ...asset, objectKey: 'picture-books/../other.png' },
      { ...asset, objectKey: 'picture-books/images/image.png' },
      { ...asset, playbackUrl: null },
    ]) {
      expect(resolve(changed)).toBeNull();
    }
    const unsigned = createPrivateBosReferenceResolver(
      config,
      { generatePresignedUrl: () => endpoint + '/' + key },
      now,
    );
    expect(unsigned(asset)).toBeNull();
    const redirected = createPrivateBosReferenceResolver(
      config,
      { generatePresignedUrl: () => 'https://attacker.example/' + key + '?signature=fake' },
      now,
    );
    expect(redirected(asset)).toBeNull();
    const mismatched = createPrivateBosReferenceResolver(
      config,
      { generatePresignedUrl: () => endpoint + '/picture-books/wrong.png?signature=fake' },
      now,
    );
    expect(mismatched(asset)).toBeNull();
  });

  it('disables signing with missing or mismatched credentials, endpoint or origin', () => {
    const signer = { generatePresignedUrl: vi.fn(() => endpoint + '/' + key + '?s=1') };
    for (const changes of [
      { secretAccessKey: '' },
      { accessKeyId: 'INJECT_PLACEHOLDER' },
      { publicOrigin: 'https://another-bucket.cd.bcebos.com' },
      { endpoint: 'https://example.com' },
      { publicOrigin: publicOrigin + '/extra' },
      { endpoint: endpoint + '?unsafe=1' },
    ]) {
      const resolver = createPrivateBosReferenceResolver({ ...config, ...changes }, signer);
      expect(resolver(asset)).toBeNull();
    }
    expect(signer.generatePresignedUrl).not.toHaveBeenCalled();
  });
});
