import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './commerce';
import { payOrder } from './payments';
vi.mock('./commerce', () => ({ request: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
describe('Mini Program payment boundary', () => {
  it('requests only orderId and uses signed server parameters', async () => {
    const parameters = {
      timeStamp: '1',
      nonceStr: 'n',
      package: 'prepay_id=test',
      signType: 'RSA',
      paySign: 'test',
    };
    vi.mocked(request).mockResolvedValue({ paymentId: 'test', parameters });
    const requestPayment = vi.fn((input: { success: () => void }) => input.success());
    vi.stubGlobal('wx', { requestPayment });
    await payOrder('order-id');
    expect(request).toHaveBeenCalledWith('/api/v1/payments/wechat', 'POST', {
      orderId: 'order-id',
    });
    expect(requestPayment).toHaveBeenCalledWith(expect.objectContaining(parameters));
    expect(request).toHaveBeenCalledTimes(1); // No client-side PAID mutation API.
  });
  it('never opens cashier if server payment creation fails', async () => {
    vi.mocked(request).mockRejectedValue(new Error('not configured'));
    const requestPayment = vi.fn();
    vi.stubGlobal('wx', { requestPayment });
    await expect(payOrder('order-id')).rejects.toThrow('not configured');
    expect(requestPayment).not.toHaveBeenCalled();
  });
  it('propagates cashier cancellation rather than claiming success', async () => {
    vi.mocked(request).mockResolvedValue({ parameters: {} });
    vi.stubGlobal('wx', {
      requestPayment: (input: { fail: (error: Error) => void }) =>
        input.fail(new Error('cancelled')),
    });
    await expect(payOrder('order-id')).rejects.toThrow('cancelled');
  });
});
