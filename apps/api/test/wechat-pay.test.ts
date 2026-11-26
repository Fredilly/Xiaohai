import { createCipheriv, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpWeChatPayProvider,
  loadWeChatPayProvider,
  validateWeChatPayNotificationUrl,
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
function encryptedNotification(eventType: string, data: object) {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(config.apiV3Key),
    Buffer.from('012345678901'),
  );
  cipher.setAAD(Buffer.from('transaction'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  return JSON.stringify({
    id: 'event',
    event_type: eventType,
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      nonce: '012345678901',
      associated_data: 'transaction',
      ciphertext,
    },
  });
}
function notification() {
  return encryptedNotification('TRANSACTION.SUCCESS', {
    appid: config.appId,
    mchid: config.merchantId,
    out_trade_no: 'trade',
    transaction_id: 'tx',
    trade_state: 'SUCCESS',
    amount: { total: 100, currency: 'CNY' },
  });
}
describe('WeChat Pay cryptographic boundary', () => {
  it('requires an HTTPS callback to the exact registered route, without query or credentials', () => {
    expect(
      validateWeChatPayNotificationUrl('https://api.pamboo.asia/api/v1/payments/wechat/notify'),
    ).toBe('https://api.pamboo.asia/api/v1/payments/wechat/notify');
    for (const value of [
      'http://api.pamboo.asia/api/v1/payments/wechat/notify',
      'https://api.pamboo.asia/api/v1/payments/wechat/refund-notify',
      'https://api.pamboo.asia/api/v1/payments/wechat/notify?secret=abc',
      'https://user:pass@api.pamboo.asia/api/v1/payments/wechat/notify',
      'https://api.pamboo.asia/api/v1/payments/wechat/notify#fragment',
    ]) {
      expect(() => validateWeChatPayNotificationUrl(value)).toThrow(
        'PAYMENT_CONFIGURATION_INVALID',
      );
    }
  });
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
  it.each(['SUCCESS', 'CLOSED', 'ABNORMAL'])(
    'verifies and decrypts authenticated %s refund notifications',
    (status) => {
      const provider = new HttpWeChatPayProvider(config, fetch, () => now);
      const raw = encryptedNotification(`REFUND.${status}`, {
        mchid: config.merchantId,
        out_trade_no: 'trade',
        transaction_id: 'tx',
        out_refund_no: 'refund-1',
        refund_id: 'provider-refund-1',
        refund_status: status,
        amount: { total: 321, refund: 321, currency: 'CNY' },
      });
      expect(provider.notification(raw, headers(raw)).refund).toMatchObject({
        status,
        out_refund_no: 'refund-1',
        amount: { total: 321, refund: 321 },
      });
      expect(() => provider.notification(`${raw} `, headers(raw))).toThrow(
        'PAYMENT_SIGNATURE_INVALID',
      );
    },
  );
  it('rejects a signed refund whose decrypted status conflicts with its event type', () => {
    const provider = new HttpWeChatPayProvider(config, fetch, () => now);
    const raw = encryptedNotification('REFUND.SUCCESS', {
      mchid: config.merchantId,
      out_trade_no: 'trade',
      transaction_id: 'tx',
      out_refund_no: 'refund-1',
      refund_id: 'provider-refund-1',
      refund_status: 'CLOSED',
      amount: { total: 321, refund: 321, currency: 'CNY' },
    });
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
  it('submits only one server-determined full refund with the original amount and signed response', async () => {
    const result = {
      out_trade_no: 'order-no',
      transaction_id: 'wechat-transaction',
      out_refund_no: 'refund-no',
      refund_id: 'provider-refund',
      status: 'PROCESSING',
      amount: { total: 321, refund: 321, currency: 'CNY' },
    };
    const raw = JSON.stringify(result);
    const http = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response(raw, { headers: headers(raw) })));
    const provider = new HttpWeChatPayProvider(config, http, () => now);
    expect(
      await provider.refund({ outTradeNo: 'order-no', outRefundNo: 'refund-no', amountMinor: 321 }),
    ).toMatchObject(result);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/refund/domestic/refunds');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
      out_trade_no: 'order-no',
      out_refund_no: 'refund-no',
      notify_url: config.refundNotifyUrl,
      amount: { refund: 321, total: 321, currency: 'CNY' },
    });
    expect(init?.method).toBe('POST');

    await expect(provider.queryRefund('refund-no')).resolves.toMatchObject(result);
    expect(http.mock.calls[1]?.[0]).toBe(
      'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/refund-no',
    );
  });
  it('fails safely on timeout/network error', async () => {
    const http = vi.fn<typeof fetch>().mockRejectedValue(new Error('sensitive provider data'));
    await expect(new HttpWeChatPayProvider(config, http).query('test')).rejects.toThrow(
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
  });
});
