import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { PaymentParameters } from '@xiaohai/contracts/payments';

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 409,
  ) {
    super(code);
  }
}
export const transactionSchema = z.object({
  appid: z.string().min(1),
  mchid: z.string().min(1),
  out_trade_no: z.string().min(1),
  transaction_id: z.string().min(1).optional(),
  trade_state: z.enum([
    'SUCCESS',
    'REFUND',
    'NOTPAY',
    'CLOSED',
    'REVOKED',
    'USERPAYING',
    'PAYERROR',
  ]),
  amount: z.object({ total: z.number().int().positive(), currency: z.literal('CNY') }),
});
export const refundResultSchema = z.object({
  mchid: z.string().optional(),
  out_trade_no: z.string().min(1),
  transaction_id: z.string().min(1),
  out_refund_no: z.string().min(1),
  refund_id: z.string().min(1),
  status: z.enum(['SUCCESS', 'PROCESSING', 'CLOSED', 'ABNORMAL']),
  amount: z.object({
    total: z.number().int().positive(),
    refund: z.number().int().positive(),
    currency: z.literal('CNY').optional(),
  }),
});
export type PayTransaction = z.infer<typeof transactionSchema>;
export type RefundResult = z.infer<typeof refundResultSchema>;
export type PayNotification = {
  id: string;
  eventType: string;
  transaction?: PayTransaction;
  refund?: RefundResult;
};
export interface WeChatPayProvider {
  readonly appId: string;
  readonly merchantId: string;
  assertConfigured(): void;
  create(input: {
    outTradeNo: string;
    amountMinor: number;
    openid: string;
  }): Promise<PaymentParameters>;
  query(outTradeNo: string): Promise<PayTransaction>;
  refund(input: {
    outTradeNo: string;
    outRefundNo: string;
    amountMinor: number;
  }): Promise<RefundResult>;
  queryRefund(outRefundNo: string): Promise<RefundResult>;
  notification(
    raw: string,
    headers: Record<string, string | string[] | undefined>,
  ): PayNotification;
}

export interface WeChatPayConfig {
  appId: string;
  merchantId: string;
  serial: string;
  privateKey: string;
  apiV3Key: string;
  platformKeyId: string;
  platformPublicKey: string;
  notifyUrl: string;
  refundNotifyUrl: string;
}

// Mounted secret files only; never place key material in the repository or a client bundle.
export function loadWeChatPayProvider(env: NodeJS.ProcessEnv): WeChatPayProvider {
  if (env.WECHAT_PAY_ENABLED !== 'true') return new DisabledWeChatPayProvider();
  try {
    const required = (key: string) => {
      const value = env[key];
      if (!value || /placeholder|replace|example|tourist/i.test(value))
        throw new Error('configuration');
      return value;
    };
    const https = (key: string) => {
      const value = required(key);
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw new Error('configuration');
      return value;
    };
    const config = {
      appId: required('WECHAT_APP_ID'),
      merchantId: required('WECHAT_PAY_MCH_ID'),
      serial: required('WECHAT_PAY_MERCHANT_SERIAL'),
      privateKey: readFileSync(required('WECHAT_PAY_PRIVATE_KEY_PATH'), 'utf8'),
      apiV3Key: required('WECHAT_PAY_API_V3_KEY'),
      platformKeyId: required('WECHAT_PAY_PLATFORM_KEY_ID'),
      platformPublicKey: readFileSync(required('WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH'), 'utf8'),
      notifyUrl: https('WECHAT_PAY_NOTIFY_URL'),
      refundNotifyUrl: https('WECHAT_PAY_REFUND_NOTIFY_URL'),
    };
    if (Buffer.byteLength(config.apiV3Key) !== 32) throw new Error('configuration');
    const privateKey = createPrivateKey(config.privateKey);
    const publicKey = createPublicKey(config.platformPublicKey);
    if (
      privateKey.asymmetricKeyType !== 'rsa' ||
      publicKey.asymmetricKeyType !== 'rsa' ||
      (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      throw new Error('configuration');
    return new HttpWeChatPayProvider(config);
  } catch {
    throw new PaymentError('PAYMENT_CONFIGURATION_INVALID', 503);
  }
}

class DisabledWeChatPayProvider implements WeChatPayProvider {
  appId = '';
  merchantId = '';
  assertConfigured(): never {
    throw new PaymentError('PAYMENT_NOT_CONFIGURED', 503);
  }
  create(): Promise<PaymentParameters> {
    return Promise.reject(new PaymentError('PAYMENT_NOT_CONFIGURED', 503));
  }
  query(): Promise<PayTransaction> {
    return Promise.reject(new PaymentError('PAYMENT_NOT_CONFIGURED', 503));
  }
  refund(): Promise<RefundResult> {
    return Promise.reject(new PaymentError('PAYMENT_NOT_CONFIGURED', 503));
  }
  queryRefund(): Promise<RefundResult> {
    return Promise.reject(new PaymentError('PAYMENT_NOT_CONFIGURED', 503));
  }
  notification(): PayNotification {
    return this.assertConfigured();
  }
}

export class HttpWeChatPayProvider implements WeChatPayProvider {
  readonly appId: string;
  readonly merchantId: string;
  constructor(
    private readonly config: WeChatPayConfig,
    private readonly http: typeof fetch = fetch,
    private readonly now = Date.now,
  ) {
    this.appId = config.appId;
    this.merchantId = config.merchantId;
  }
  assertConfigured() {
    /* Configuration validated at service startup. */
  }
  private signature(message: string) {
    return sign('RSA-SHA256', Buffer.from(message), this.config.privateKey).toString('base64');
  }
  private verifyBody(raw: string, header: (name: string) => string | undefined) {
    const timestamp = header('wechatpay-timestamp'),
      nonce = header('wechatpay-nonce');
    const signature = header('wechatpay-signature'),
      serial = header('wechatpay-serial');
    if (
      !timestamp ||
      !/^\d+$/.test(timestamp) ||
      Math.abs(this.now() / 1000 - Number(timestamp)) > 300 ||
      !nonce ||
      !signature ||
      serial !== this.config.platformKeyId ||
      !verify(
        'RSA-SHA256',
        Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
        this.config.platformPublicKey,
        Buffer.from(signature, 'base64'),
      )
    ) {
      throw new PaymentError('PAYMENT_SIGNATURE_INVALID', 401);
    }
  }
  private async request(method: 'POST' | 'GET', path: string, data?: object): Promise<unknown> {
    const body = data ? JSON.stringify(data) : '';
    const timestamp = String(Math.floor(this.now() / 1000)),
      nonce = randomBytes(16).toString('hex');
    const signature = this.signature(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
    try {
      const response = await this.http(`https://api.mch.weixin.qq.com${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.config.serial}",signature="${signature}"`,
          'Wechatpay-Serial': this.config.platformKeyId,
        },
        ...(body ? { body } : {}),
      });
      const raw = await response.text();
      this.verifyBody(raw, (name) => response.headers.get(name) ?? undefined);
      if (!response.ok) throw new PaymentError('PAYMENT_PROVIDER_UNAVAILABLE', 502);
      return JSON.parse(raw) as unknown;
    } catch {
      throw new PaymentError('PAYMENT_PROVIDER_UNAVAILABLE', 502);
    }
  }
  async create(input: { outTradeNo: string; amountMinor: number; openid: string }) {
    const result = z.object({ prepay_id: z.string().min(1) }).parse(
      await this.request('POST', '/v3/pay/transactions/jsapi', {
        appid: this.appId,
        mchid: this.merchantId,
        description: 'Xiaohai order',
        out_trade_no: input.outTradeNo,
        notify_url: this.config.notifyUrl,
        amount: { total: input.amountMinor, currency: 'CNY' },
        payer: { openid: input.openid },
      }),
    );
    const timeStamp = String(Math.floor(this.now() / 1000)),
      nonceStr = randomBytes(16).toString('hex');
    const packageValue = `prepay_id=${result.prepay_id}`;
    return {
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: 'RSA' as const,
      paySign: this.signature(`${this.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`),
    };
  }
  async query(outTradeNo: string) {
    return transactionSchema.parse(
      await this.request(
        'GET',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.merchantId)}`,
      ),
    );
  }
  async refund(input: { outTradeNo: string; outRefundNo: string; amountMinor: number }) {
    return refundResultSchema.parse(
      await this.request('POST', '/v3/refund/domestic/refunds', {
        out_trade_no: input.outTradeNo,
        out_refund_no: input.outRefundNo,
        notify_url: this.config.refundNotifyUrl,
        amount: { refund: input.amountMinor, total: input.amountMinor, currency: 'CNY' },
      }),
    );
  }
  async queryRefund(outRefundNo: string) {
    return refundResultSchema.parse(
      await this.request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`),
    );
  }
  notification(
    raw: string,
    headers: Record<string, string | string[] | undefined>,
  ): PayNotification {
    try {
      this.verifyBody(raw, (name) =>
        typeof headers[name] === 'string' ? headers[name] : undefined,
      );
      const envelope = z
        .object({
          id: z.string().min(1).max(128),
          event_type: z.string(),
          resource: z.object({
            algorithm: z.literal('AEAD_AES_256_GCM'),
            ciphertext: z.string(),
            nonce: z.string(),
            associated_data: z.string().optional(),
          }),
        })
        .parse(JSON.parse(raw));
      const encrypted = Buffer.from(envelope.resource.ciphertext, 'base64');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.config.apiV3Key),
        Buffer.from(envelope.resource.nonce),
      );
      decipher.setAuthTag(encrypted.subarray(-16));
      decipher.setAAD(Buffer.from(envelope.resource.associated_data ?? ''));
      const plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(0, -16)),
        decipher.final(),
      ]).toString('utf8');
      const data = JSON.parse(plaintext) as Record<string, unknown>;
      if (envelope.event_type === 'TRANSACTION.SUCCESS') {
        const transaction = transactionSchema.parse(data);
        if (transaction.trade_state !== 'SUCCESS') throw new Error('event');
        return { id: envelope.id, eventType: envelope.event_type, transaction };
      }
      if (['REFUND.SUCCESS', 'REFUND.CLOSED', 'REFUND.ABNORMAL'].includes(envelope.event_type)) {
        const refund = refundResultSchema.parse({ ...data, status: data.refund_status });
        if (!refund.mchid || envelope.event_type !== `REFUND.${refund.status}`)
          throw new Error('event');
        return { id: envelope.id, eventType: envelope.event_type, refund };
      }
      throw new Error('event');
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError('PAYMENT_NOTIFICATION_INVALID', 400);
    }
  }
}
