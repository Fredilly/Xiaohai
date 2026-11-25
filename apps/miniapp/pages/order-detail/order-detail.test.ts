import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(),
  cancelOrder: vi.fn(),
  getFulfillment: vi.fn(),
  payOrder: vi.fn(),
}));
vi.mock('../../services/commerce', () => ({
  getOrder: mocks.getOrder,
  cancelOrder: mocks.cancelOrder,
}));
vi.mock('../../services/fulfillment', () => ({ getFulfillment: mocks.getFulfillment }));
vi.mock('../../services/payments', () => ({ payOrder: mocks.payOrder }));

type DetailPage = {
  readSequence: number;
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
  mocks.getOrder.mockResolvedValue({ id: 'order-a', status: 'CANCELLED' });
  mocks.getFulfillment.mockResolvedValue(null);
});

describe('consumer order detail transitions', () => {
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
});
