import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getFulfillment: vi.fn(),
  payOrder: vi.fn(),
  token: vi.fn(),
}));
vi.mock('../../services/commerce', () => ({
  getOrder: mocks.getOrder,
  cancelOrder: mocks.cancelOrder,
}));
vi.mock('../../services/fulfillment', () => ({ getFulfillment: mocks.getFulfillment }));
vi.mock('../../services/payments', () => ({ payOrder: mocks.payOrder }));
vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));

type DetailPage = {
  readSequence: number;
  visibleSession: string;
  cancelling: boolean;
  data: {
    id: string;
    order: { status: string } | null;
    paying: boolean;
    cancellingOrder: boolean;
    cancelMessage?: string;
    [key: string]: unknown;
  };
  setData(patch: Record<string, unknown>): void;
  load(): Promise<void>;
  cancel(): Promise<void>;
  pay(): Promise<void>;
};
let definition: DetailPage;
function page(): DetailPage {
  return {
    ...definition,
    readSequence: 0,
    visibleSession: 'account-a',
    cancelling: false,
    data: { id: 'order-a', order: { status: 'UNPAID' }, paying: false, cancellingOrder: false },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (config: DetailPage) => {
    definition = config;
  });
  await import('./order-detail');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockReturnValue('account-a');
  mocks.getOrder.mockResolvedValue({ id: 'order-a', status: 'CANCELLED' });
  mocks.getFulfillment.mockResolvedValue(null);
});

describe('consumer order detail transitions', () => {
  it('never displays an order response received after logout or account change', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.getOrder.mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    mocks.getFulfillment.mockResolvedValueOnce({ orderId: 'order-a', method: 'PICKUP' });
    const detail = page();
    const pending = detail.load();
    mocks.token.mockReturnValue('account-b');
    resolve({ id: 'order-a', status: 'UNPAID' });
    await pending;
    expect(detail.data.order).toBeNull();
    expect(detail.data.error).toBe(true);
    expect(detail.visibleSession).toBe('');
  });

  it('blocks payment and cancellation from a stale account-bound order view', async () => {
    const detail = page();
    mocks.token.mockReturnValue('account-b');
    await detail.pay();
    await detail.cancel();
    expect(mocks.payOrder).not.toHaveBeenCalled();
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    expect(detail.data.order).toBeNull();
  });

  it('serializes cancellation taps, disables payment and reloads authoritative order state', async () => {
    let release: () => void = () => {};
    mocks.cancelOrder.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const detail = page();
    const cancelling = detail.cancel();
    await detail.cancel();
    await detail.pay();
    expect(mocks.cancelOrder).toHaveBeenCalledTimes(1);
    expect(mocks.payOrder).not.toHaveBeenCalled();
    expect(detail.data.cancellingOrder).toBe(true);
    release();
    await cancelling;
    expect(detail.data.cancellingOrder).toBe(false);
    expect(detail.data.order?.status).toBe('CANCELLED');
  });

  it('does not misreport a failed cancel as completed and refreshes before retry', async () => {
    mocks.cancelOrder.mockRejectedValueOnce(new Error('network'));
    const detail = page();
    await detail.cancel();
    expect(detail.data.cancelMessage).toContain('未确认');
    expect(mocks.getOrder).toHaveBeenCalledWith('order-a');
    expect(detail.data.order?.status).toBe('CANCELLED');
  });

  it('distinguishes legacy missing fulfillment from network errors and wrong-order responses', async () => {
    const detail = page();
    mocks.getFulfillment.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await detail.load();
    expect(detail.data.fulfillmentError).toBe(false);
    expect(detail.data.fulfillment).toBeNull();

    mocks.getFulfillment.mockRejectedValueOnce(new Error('HTTP_503'));
    await detail.load();
    expect(detail.data.fulfillmentError).toBe(true);
    expect(detail.data.fulfillment).toBeNull();

    mocks.getFulfillment.mockResolvedValueOnce({ orderId: 'another-order', method: 'PICKUP' });
    await detail.load();
    expect(detail.data.fulfillmentError).toBe(true);
    expect(detail.data.fulfillment).toBeNull();
  });
});
