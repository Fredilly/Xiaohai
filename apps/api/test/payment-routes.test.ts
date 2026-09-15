import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { buildApp } from '../src/app.js';
import { ConsumerSessionService } from '../src/auth/session.js';
import { StaffSessionService } from '../src/auth/staff-session.js';
import { StaffAuthorizationService } from '../src/auth/staff-authorization.js';
import { registerPaymentRoutes } from '../src/payments/payment-routes.js';
import type { PaymentService } from '../src/payments/payment-service.js';
import { PaymentError } from '../src/payments/wechat-pay.js';

const consumerSessions = new ConsumerSessionService('c'.repeat(32), 600);
const staffSessions = new StaffSessionService('s'.repeat(32), 600);
function fixture(permissionKeys: string[] = [], global = true) {
  const logs: string[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logs.push(line);
      },
    },
  );
  const app = buildApp({ loggerInstance: logger });
  const paymentId = randomUUID();
  const payments = {
    create: vi.fn().mockResolvedValue({
      paymentId,
      parameters: {
        timeStamp: '1',
        nonceStr: 'test',
        package: 'prepay_id=sensitive-prepay',
        signType: 'RSA',
        paySign: 'sensitive-signature',
      },
    }),
    list: vi.fn().mockResolvedValue([]),
    callback: vi.fn().mockResolvedValue({ reviewRequired: false }),
    requestRefund: vi
      .fn()
      .mockResolvedValue({ id: randomUUID(), paymentId, status: 'PROCESSING', amountMinor: 100 }),
    reconcile: vi.fn().mockResolvedValue({ runId: randomUUID(), outcome: 'MATCHED' }),
  };
  const authorization = new StaffAuthorizationService(
    {
      loadContext: (id) =>
        Promise.resolve({
          staffAccountId: id,
          loginIdentifier: 'test',
          permissions: permissionKeys,
          dataScopes: [{ type: global ? 'GLOBAL' : 'STORE', id: global ? null : randomUUID() }],
        }),
    },
    staffSessions,
  );
  registerPaymentRoutes(app, {
    payments: payments as unknown as PaymentService,
    consumerSessions,
    staffAuthorization: authorization,
  });
  return { app, payments, logs };
}
describe('payment routes security', () => {
  it('rejects unauthenticated and Staff tokens on Consumer creation', async () => {
    const { app, payments } = fixture();
    for (const token of ['', staffSessions.issue(randomUUID()).token]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/wechat',
        headers: { authorization: `Bearer ${token}` },
        payload: { orderId: randomUUID() },
      });
      expect(response.statusCode).toBe(401);
    }
    expect(payments.create).not.toHaveBeenCalled();
    await app.close();
  });
  it('strictly rejects amount/identity injection and preserves request IDs', async () => {
    const { app, payments, logs } = fixture();
    const token = consumerSessions.issue(randomUUID()).token;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/wechat',
      headers: { authorization: `Bearer ${token}`, 'x-request-id': 'test-request' },
      payload: { orderId: randomUUID(), amountMinor: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { requestId: string } }>().error.requestId).toBe('test-request');
    const success = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/wechat',
      headers: { authorization: `Bearer ${token}` },
      payload: { orderId: randomUUID() },
    });
    expect(success.statusCode).toBe(200);
    expect(payments.create).toHaveBeenCalledTimes(1);
    expect(logs.join('')).not.toContain('sensitive-prepay');
    expect(logs.join('')).not.toContain('sensitive-signature');
    expect(logs.join('')).not.toContain(token);
    await app.close();
  });
  it('requires financial permission AND GLOBAL scope', async () => {
    for (const [permissions, global] of [
      [[], true],
      [['payments.refund'], false],
    ] as [string[], boolean][]) {
      const { app, payments } = fixture(permissions, global);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/staff/refunds',
        headers: { authorization: `Bearer ${staffSessions.issue(randomUUID()).token}` },
        payload: { paymentId: randomUUID() },
      });
      expect(response.statusCode).toBe(403);
      expect(payments.requestRefund).not.toHaveBeenCalled();
      await app.close();
    }
    const { app } = fixture(['payments.refund']);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/staff/refunds',
      headers: { authorization: `Bearer ${staffSessions.issue(randomUUID()).token}` },
      payload: { paymentId: randomUUID() },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
  it('passes exact raw callback body, acknowledges only success, redacts errors', async () => {
    const { app, payments, logs } = fixture();
    const raw = '{ "private" : "sensitive-callback" }';
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/wechat/notify',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(response.statusCode).toBe(204);
    expect(payments.callback).toHaveBeenCalledWith(raw, expect.any(Object));
    payments.callback.mockRejectedValue(new PaymentError('PAYMENT_SIGNATURE_INVALID', 401));
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/wechat/notify',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(invalid.statusCode).toBe(401);
    expect(logs.join('')).not.toContain('sensitive-callback');
    await app.close();
  });
});
