import { request } from './commerce';

type PaymentParameters = {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
};
export async function payOrder(orderId: string): Promise<void> {
  const result = await request<{ paymentId: string; parameters: PaymentParameters }>(
    '/api/v1/payments/wechat',
    'POST',
    { orderId },
  );
  await new Promise<void>((resolve, reject) => {
    wx.requestPayment({ ...result.parameters, success: () => resolve(), fail: reject });
  });
  // Client success is NOT payment confirmation. Reload the server order; never set PAID here.
}
