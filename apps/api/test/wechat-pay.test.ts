import { createCipheriv, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpWeChatPayProvider,
  loadWeChatPayProvider,
  type WeChatPayConfig,
} from '../src/payments/wechat-pay.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: WeChatPayConfig = {
  appId: 'test-app',
  merchantId: 'test-merchant',
  serial: 'test-serial',
  privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  platformPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  platformKeyId: 'test-platform',
  apiV3Key: 'a'.repeat(32),
  notifyUrl: 'https://example.invalid/notify',
  refundNotifyUrl: 'https://example.invalid/notify',
};
const now = 1_800_000_000_000;
function headers(raw: string, timestamp = String(now / 1000)) {
  return {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': 'test-nonce',
    'wechatpay-serial': config.platformKeyId,
    'wechatpay-signature': sign(
      'RSA-SHA256',
      Buffer.from(`${timestamp}\ntest-nonce\n${raw}\n`),
      keys.privateKey,
    ).toString('base64'),
  };
}
function notification() {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(config.apiV3Key),
    Buffer.from('012345678901'),
  );
  cipher.setAAD(Buffer.from('transaction'));
  const data = {
    appid: config.appId,
    mchid: config.merchantId,
    out_trade_no: 'trade',
    transaction_id: 'tx',
    trade_state: 'SUCCESS',
    amount: { total: 100, currency: 'CNY' },
  };
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  return JSON.stringify({
    id: 'event',
    event_type: 'TRANSACTION.SUCCESS',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      nonce: '012345678901',
      associated_data: 'transaction',
      ciphertext,
    },
  });
}
describe('WeChat Pay cryptographic boundary', () => {
  it('fails closed without configuration', async () => {
    const provider = loadWeChatPayProvider({});
    await expect(
      provider.create({ outTradeNo: 'x', amountMinor: 1, openid: 'x' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_CONFIGURED' });
    expect(() => loadWeChatPayProvider({ WECHAT_PAY_ENABLED: 'true' })).toThrow(
      'PAYMENT_CONFIGURATION_INVALID',
    );
  });
  it('verifies raw bytes and decrypts authenticated AES-GCM', () => {
    const provider = new HttpWeChatPayProvider(config, fetch, () => now);
    const raw = notification();
    expect(provider.notification(raw, headers(raw)).transaction?.amount.total).toBe(100);
    expect(() => provider.notification(raw + ' ', headers(raw))).toThrow(
      'PAYMENT_SIGNATURE_INVALID',
    );
    expect(() =>
      provider.notification(raw, { ...headers(raw), 'wechatpay-serial': 'untrusted' }),
    ).toThrow('PAYMENT_SIGNATURE_INVALID');
    expect(() => provider.notification(raw, headers(raw, String(now / 1000 - 301)))).toThrow(
      'PAYMENT_SIGNATURE_INVALID',
    );
    expect(() =>
      provider.notification(raw, {
        ...headers(raw),
        'wechatpay-signature': 'WECHATPAY/SIGNTEST/invalid',
      }),
    ).toThrow('PAYMENT_SIGNATURE_INVALID');
  });
  it('rejects authenticated but invalid encrypted resources', () => {
    const provider = new HttpWeChatPayProvider(config, fetch, () => now);
    const raw = notification().replace('012345678901', '112345678901');
    expect(() => provider.notification(raw, headers(raw))).toThrow('PAYMENT_NOTIFICATION_INVALID');
  });
  it('signs outgoing requests and Mini Program parameters, verifies provider response', async () => {
    const raw = JSON.stringify({ prepay_id: 'test-prepay' });
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(raw, { headers: headers(raw) }));
    const provider = new HttpWeChatPayProvider(config, http, () => now);
    const result = await provider.create({
      outTradeNo: 'order-no',
      amountMinor: 321,
      openid: 'private-openid',
    });
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toMatchObject({
      amount: { total: 321, currency: 'CNY' },
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(
          `${config.appId}\n${result.timeStamp}\n${result.nonceStr}\n${result.package}\n`,
        ),
        keys.publicKey,
        Buffer.from(result.paySign, 'base64'),
      ),
    ).toBe(true);
    expect(result).not.toHaveProperty('openid');
    http.mockResolvedValue(new Response(raw));
    await expect(
      provider.create({ outTradeNo: 'order-no', amountMinor: 321, openid: 'x' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
  });
  it('fails safely on timeout/network error', async () => {
    const http = vi.fn<typeof fetch>().mockRejectedValue(new Error('sensitive provider data'));
    await expect(new HttpWeChatPayProvider(config, http).query('test')).rejects.toThrow(
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
  });
});
