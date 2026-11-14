import { describe, expect, it, vi } from 'vitest';
import {
  createIsolatedReferenceImageStorage,
  decodeReferencePng,
  InvalidReferencePngError,
  isConnectedToIsolatedReferenceDatabase,
  isIsolatedReferenceImportDatabase,
  referenceObjectKey,
  uploadVerifiedReferenceToBos,
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

  it('fails closed on shared, remote, mismatched and undisclosed database targets', () => {
    const isolated = {
      APP_ENV: 'dev',
      NODE_ENV: 'development',
      PICTURE_BOOK_REFERENCE_IMPORT_DATABASE_NAME: 'xiaohai_i111_disposable01',
      DATABASE_URL: 'postgres://test:secret@127.0.0.1:5432/xiaohai_i111_disposable01',
    };
    expect(isIsolatedReferenceImportDatabase(isolated)).toBe(true);
    for (const env of [
      { ...isolated, APP_ENV: 'staging' },
      { ...isolated, NODE_ENV: 'production' },
      { ...isolated, DATABASE_URL: 'postgres://test:secret@127.0.0.1:5432/xiaohai_test' },
      {
        ...isolated,
        DATABASE_URL: 'postgres://test:secret@db.internal:5432/xiaohai_i111_disposable01',
      },
      {
        ...isolated,
        DATABASE_URL:
          'postgres://test:secret@127.0.0.1:5432/xiaohai_i111_disposable01?sslmode=disable',
      },
      { ...isolated, TEST_DATABASE_URL: 'postgres://test:secret@127.0.0.1:5432/xiaohai_test' },
      { ...isolated, PICTURE_BOOK_REFERENCE_IMPORT_DATABASE_NAME: 'xiaohai_test' },
      { ...isolated, DATABASE_URL: '' },
      { ...isolated, NODE_ENV: 'test' },
    ]) {
      expect(isIsolatedReferenceImportDatabase(env)).toBe(false);
    }
    expect(
      isIsolatedReferenceImportDatabase({
        ...isolated,
        NODE_ENV: 'test',
        TEST_DATABASE_URL: isolated.DATABASE_URL,
      }),
    ).toBe(true);
  });

  it('checks the actual connected DB name before enabling reference import', async () => {
    const env = {
      APP_ENV: 'dev',
      NODE_ENV: 'development',
      PICTURE_BOOK_REFERENCE_IMPORT_DATABASE_NAME: 'xiaohai_i111_disposable01',
      DATABASE_URL: 'postgres://test:secret@localhost:5432/xiaohai_i111_disposable01',
    };
    const query = vi.fn().mockResolvedValue({ rows: [{ name: 'xiaohai_i111_disposable01' }] });
    expect(await isConnectedToIsolatedReferenceDatabase(env, query)).toBe(true);
    query.mockResolvedValueOnce({ rows: [{ name: 'xiaohai_production' }] });
    expect(await isConnectedToIsolatedReferenceDatabase(env, query)).toBe(false);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await isConnectedToIsolatedReferenceDatabase(env, query)).toBe(false);
    query.mockRejectedValueOnce(new Error('db offline'));
    expect(await isConnectedToIsolatedReferenceDatabase(env, query)).toBe(false);
    query.mockClear();
    expect(
      await isConnectedToIsolatedReferenceDatabase(
        {
          ...env,
          DATABASE_URL: 'postgres://test:secret@db.internal:5432/xiaohai_i111_disposable01',
        },
        query,
      ),
    ).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects missing/wrong BOS HEAD metadata, 404, and MD5 mismatch before READY', async () => {
    const image = decodeReferencePng(onePixelPng);
    const key = referenceObjectKey({
      consumerUserId: '00000000-0000-4000-8000-000000000001',
      pictureBookId: '00000000-0000-4000-8000-000000000002',
      characterId: '00000000-0000-4000-8000-000000000003',
      image,
    });
    const headers = { 'Content-Length': String(image.length), 'Content-Type': 'image/png' };
    const client = {
      putObject: vi.fn().mockResolvedValue({}),
      getObjectMetadata: vi.fn().mockResolvedValue({ http_headers: headers }),
    };
    const upload = () =>
      uploadVerifiedReferenceToBos(
        client,
        'xiaohai-i111-disposable01',
        'https://xiaohai-i111-disposable01.cd.bcebos.com',
        { objectKey: key, body: image },
      );
    expect((await upload()).byteSize).toBe(image.length);
    expect(client.putObject).toHaveBeenCalledWith('xiaohai-i111-disposable01', key, image, {
      'Content-Type': 'image/png',
      'Content-Length': image.length,
    });
    expect(client.getObjectMetadata).toHaveBeenCalledWith('xiaohai-i111-disposable01', key);
    for (const metadata of [
      null,
      {},
      { http_headers: {} },
      { http_headers: { ...headers, 'Content-Length': String(image.length + 1) } },
      { http_headers: { ...headers, 'Content-Type': 'application/octet-stream' } },
      { http_headers: { ...headers, 'Content-Md5': 'incorrect' } },
    ]) {
      client.getObjectMetadata.mockResolvedValueOnce(metadata);
      await expect(upload()).rejects.toThrow('REFERENCE_BOS_METADATA_UNVERIFIED');
    }
    client.getObjectMetadata.mockRejectedValueOnce(new Error('HEAD 404'));
    await expect(upload()).rejects.toThrow('HEAD 404');
    client.getObjectMetadata.mockResolvedValueOnce({
      http_headers: { ...headers, 'Content-Md5': 'incorrect' },
    });
    await expect(upload()).rejects.toThrow('REFERENCE_BOS_METADATA_UNVERIFIED');
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
