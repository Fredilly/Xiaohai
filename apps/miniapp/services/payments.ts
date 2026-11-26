import { request } from './commerce';
import { consumerToken } from './consumer-session';

type PaymentParameters = {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
};
export async function payOrder(orderId: string): Promise<void> {
  const session = consumerToken();
  if (!session) throw new Error('PAYMENT_LOGIN_REQUIRED');
  const result = await request<{ paymentId: string; parameters: PaymentParameters }>(
    '/api/v1/payments/wechat',
    'POST',
    { orderId },
  );
  // Do not open the cashier with prepay parameters issued to a previous login.
  if (consumerToken() !== session) throw new Error('PAYMENT_SESSION_CHANGED');
  await new Promise<void>((resolve, reject) => {
    wx.requestPayment({ ...result.parameters, success: () => resolve(), fail: reject });
  });
  if (consumerToken() !== session) throw new Error('PAYMENT_SESSION_CHANGED');
  // Client success is NOT payment confirmation. Reload the server order; never set PAID here.
}
