import { describe, expect, it, vi } from 'vitest';
import {
  createMerchantImageStorage,
  type MerchantImageStorage,
} from '../src/commerce/merchant-image-storage.js';

const config = {
  PRODUCT_BOS_ENDPOINT: 'https://cd.bcebos.com',
  PRODUCT_BOS_PUBLIC_ORIGIN: 'https://merchant-test.cd.bcebos.com',
  PRODUCT_BOS_BUCKET: 'merchant-test',
  PRODUCT_BOS_ACCESS_KEY_ID: 'dummy-test-access',
  PRODUCT_BOS_SECRET_ACCESS_KEY: 'dummy-test-secret',
};

describe('merchant product BOS upload adapter (#208)', () => {
  it('fails closed with missing, placeholder or mismatched configuration', () => {
    expect(createMerchantImageStorage({})).toBeNull();
    expect(
      createMerchantImageStorage({ ...config, PRODUCT_BOS_SECRET_ACCESS_KEY: 'INJECT_SECRET' }),
    ).toBeNull();
    expect(
      createMerchantImageStorage({
        ...config,
        PRODUCT_BOS_PUBLIC_ORIGIN: 'https://different.cd.bcebos.com',
      }),
    ).toBeNull();
    expect(
      createMerchantImageStorage({
        ...config,
        PRODUCT_BOS_ENDPOINT: 'http://cd.bcebos.com',
      }),
    ).toBeNull();
    expect(
      createMerchantImageStorage({
        ...config,
        PRODUCT_BOS_PUBLIC_ORIGIN: 'https://merchant-test.cd.bcebos.com/unsafe/path',
      }),
    ).toBeNull();
  });

  it('sends only image bytes, MIME and size to private IAM write capability', async () => {
    const putObject = vi.fn().mockResolvedValue({});
    const storage: MerchantImageStorage | null = createMerchantImageStorage(config, {
      putObject,
    });
    expect(storage).not.toBeNull();
    const key = `products/11111111-1111-4111-8111-111111111111/images/${'a'.repeat(64)}.png`;
    const body = Buffer.from([137, 80, 78, 71]);
    const url = await storage!.putImage({ objectKey: key, mimeType: 'image/png', body });
    expect(url).toBe(`https://merchant-test.cd.bcebos.com/${key}`);
    expect(putObject).toHaveBeenCalledExactlyOnceWith('merchant-test', key, body, {
      'Content-Type': 'image/png',
      'Content-Length': body.length,
    });
    await expect(
      storage!.putImage({
        objectKey: 'picture-books/other-private-asset.png',
        mimeType: 'image/png',
        body,
      }),
    ).rejects.toThrow('Invalid merchant image object key');
    expect(putObject).toHaveBeenCalledTimes(1);
  });
});
