import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from './commerce';
import { consumerToken } from './consumer-session';
import { payOrder } from './payments';
vi.mock('./commerce', () => ({ request: vi.fn() }));
vi.mock('./consumer-session', () => ({ consumerToken: vi.fn() }));
beforeEach(() => vi.mocked(consumerToken).mockReturnValue('account-a'));
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
  it('does not create payment intent or open cashier without a consumer login', async () => {
    vi.mocked(consumerToken).mockReturnValue('');
    const requestPayment = vi.fn();
    vi.stubGlobal('wx', { requestPayment });
    await expect(payOrder('order-id')).rejects.toThrow('PAYMENT_LOGIN_REQUIRED');
    expect(request).not.toHaveBeenCalled();
    expect(requestPayment).not.toHaveBeenCalled();
  });
  it('never opens the previous account cashier after a delayed prepay response', async () => {
    let release: (result: unknown) => void = () => {};
    vi.mocked(request).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const requestPayment = vi.fn();
    vi.stubGlobal('wx', { requestPayment });
    const pending = payOrder('order-id');
    vi.mocked(consumerToken).mockReturnValue('account-b');
    release({ paymentId: 'payment-a', parameters: {} });
    await expect(pending).rejects.toThrow('PAYMENT_SESSION_CHANGED');
    expect(requestPayment).not.toHaveBeenCalled();
  });
  it('does not claim successful payment after a session change during cashier interaction', async () => {
    vi.mocked(request).mockResolvedValueOnce({ paymentId: 'payment-a', parameters: {} });
    let complete: () => void = () => {};
    const requestPayment = vi.fn((input: { success: () => void }) => (complete = input.success));
    vi.stubGlobal('wx', {
      requestPayment,
    });
    const pending = payOrder('order-id');
    await vi.waitFor(() => expect(requestPayment).toHaveBeenCalledOnce());
    vi.mocked(consumerToken).mockReturnValue('account-b');
    complete();
    await expect(pending).rejects.toThrow('PAYMENT_SESSION_CHANGED');
  });
});
