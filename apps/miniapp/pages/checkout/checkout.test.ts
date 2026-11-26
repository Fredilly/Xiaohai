import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFulfillmentOrder, quoteFulfillment } from '../../services/fulfillment';
import { consumerToken } from '../../services/consumer-session';
import { listAddresses } from '../../services/commerce';
import { listStores } from '../../services/stores';

vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));
vi.mock('../../services/commerce', () => ({ listAddresses: vi.fn() }));
vi.mock('../../services/stores', () => ({ listStores: vi.fn() }));

vi.mock('../../services/fulfillment', () => ({
  quoteFulfillment: vi.fn(),
  createFulfillmentOrder: vi.fn(),
  randomClientRequestId: () => 'request-id',
}));

beforeEach(() => {
  vi.mocked(consumerToken).mockReturnValue('account-a');
  vi.mocked(quoteFulfillment).mockReset();
  vi.mocked(createFulfillmentOrder).mockReset();
  vi.mocked(listAddresses).mockReset();
  vi.mocked(listStores).mockReset();
});

describe('checkout quote under reordered network responses', () => {
  it('keeps only the newest selection and does not clear its loading state early', async () => {
    type PageState = {
      quoteSequence: number;
      loadedSession: string;
      data: {
        method: string;
        storeId: string;
        addressId: string;
        quote: unknown;
        quoting: boolean;
      };
      setData: (patch: Record<string, unknown>) => void;
      preview: () => Promise<void>;
    };
    let definition: PageState | undefined;
    vi.stubGlobal('Page', (config: PageState) => {
      definition = config;
    });
    await import('./checkout');
    const page = definition!;
    page.data.storeId = 'store-a';
    page.data.addressId = 'address-a';
    page.loadedSession = 'account-a';
    page.setData = (patch) => Object.assign(page.data, patch);
    const callbacks: Array<(value: unknown) => void> = [];
    vi.mocked(quoteFulfillment).mockImplementation(
      () => new Promise((resolve) => callbacks.push(resolve as (value: unknown) => void)),
    );
    const first = page.preview();
    page.data.storeId = 'store-b';
    const second = page.preview();
    callbacks[0]!({
      method: 'PICKUP',
      store: { id: 'store-a' },
      subtotalMinor: 100,
      deliveryFeeMinor: 0,
      totalMinor: 100,
    });
    await first;
    expect(page.data.quote).toBeNull();
    expect(page.data.quoting).toBe(true);
    const currentQuote = {
      method: 'PICKUP',
      store: { id: 'store-b' },
      subtotalMinor: 100,
      deliveryFeeMinor: 0,
      totalMinor: 100,
    };
    callbacks[1]!(currentQuote);
    await second;
    expect(page.data.quote).toEqual(currentQuote);
    expect(page.data.quoting).toBe(false);
    vi.unstubAllGlobals();
  });

  it('rejects another store’s price and prevents checkout with a stale selection', async () => {
    vi.resetModules();
    type PageState = {
      data: Record<string, unknown>;
      loadedSession: string;
      setData: (patch: Record<string, unknown>) => void;
      preview: () => Promise<void>;
      create: () => Promise<void>;
    };
    let page: PageState | undefined;
    vi.stubGlobal('Page', (config: PageState) => {
      page = config;
    });
    await import('./checkout');
    const checkout = page!;
    checkout.data.storeId = 'store-a';
    checkout.loadedSession = 'account-a';
    checkout.data.method = 'PICKUP';
    checkout.data.clientRequestId = 'request-id';
    checkout.setData = (patch) => Object.assign(checkout.data, patch);
    const wrongQuote = {
      method: 'PICKUP',
      store: { id: 'store-b' },
      subtotalMinor: 100,
      deliveryFeeMinor: 0,
      totalMinor: 100,
    };
    vi.mocked(quoteFulfillment).mockResolvedValueOnce(wrongQuote as never);
    await checkout.preview();
    expect(checkout.data.quote).toBeNull();
    expect(checkout.data.errorMessage).toContain('无法计算');

    checkout.data.quote = { ...wrongQuote, store: { id: 'store-a' } };
    checkout.data.storeId = 'store-b';
    await checkout.create();
    expect(checkout.data.quote).toBeNull();
    expect(createFulfillmentOrder).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('discards an old account address list when the login changes mid-load', async () => {
    vi.resetModules();
    type CheckoutPage = {
      loadSequence: number;
      quoteSequence: number;
      loadedSession: string;
      data: Record<string, unknown>;
      setData(patch: Record<string, unknown>): void;
      load(): Promise<void>;
    };
    let page: CheckoutPage | undefined;
    vi.stubGlobal('Page', (config: CheckoutPage) => {
      page = config;
    });
    await import('./checkout');
    const checkout = page!;
    checkout.setData = (patch) => Object.assign(checkout.data, patch);
    let resolve: (value: Awaited<ReturnType<typeof listAddresses>>) => void = () => {};
    vi.mocked(listAddresses).mockImplementationOnce(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    vi.mocked(listStores).mockResolvedValueOnce([{ id: 'store-a', name: '东门' }] as never);
    const pending = checkout.load();
    vi.mocked(consumerToken).mockReturnValue('account-b');
    resolve({ addresses: [{ id: 'address-a', recipientName: 'old-account-private' }] } as never);
    await pending;
    expect(checkout.data.addresses).toEqual([]);
    expect(checkout.data.quote).toBeNull();
    expect(checkout.data.loading).toBe(false);
    expect(quoteFulfillment).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not submit a previous account quote after session change', async () => {
    vi.resetModules();
    type CheckoutPage = {
      loadedSession: string;
      data: Record<string, unknown>;
      setData(patch: Record<string, unknown>): void;
      create(): Promise<void>;
    };
    let page: CheckoutPage | undefined;
    vi.stubGlobal('Page', (config: CheckoutPage) => {
      page = config;
    });
    await import('./checkout');
    const checkout = page!;
    checkout.setData = (patch) => Object.assign(checkout.data, patch);
    checkout.loadedSession = 'account-a';
    checkout.data.storeId = 'store-a';
    checkout.data.clientRequestId = 'original-request-key';
    checkout.data.quote = {
      method: 'PICKUP',
      store: { id: 'store-a' },
      subtotalMinor: 100,
      deliveryFeeMinor: 0,
      totalMinor: 100,
    };
    vi.mocked(consumerToken).mockReturnValue('account-b');
    await checkout.create();
    expect(checkout.data.quote).toBeNull();
    expect(createFulfillmentOrder).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps a submitted checkout selection and request key frozen after a lost response', async () => {
    vi.resetModules();
    type CheckoutPage = {
      loadedSession: string;
      orderAttemptSession: string;
      data: Record<string, unknown>;
      setData(patch: Record<string, unknown>): void;
      create(): Promise<void>;
      chooseStore(event: { detail: { value: string } }): void;
    };
    let page: CheckoutPage | undefined;
    vi.stubGlobal('Page', (config: CheckoutPage) => {
      page = config;
    });
    await import('./checkout');
    const checkout = page!;
    checkout.setData = (patch) => Object.assign(checkout.data, patch);
    checkout.loadedSession = 'account-a';
    checkout.data.storeId = 'store-a';
    checkout.data.method = 'PICKUP';
    checkout.data.clientRequestId = 'original-request-key';
    checkout.data.quote = {
      method: 'PICKUP',
      store: { id: 'store-a' },
      subtotalMinor: 100,
      deliveryFeeMinor: 0,
      totalMinor: 100,
    };
    const redirectTo = vi.fn();
    vi.stubGlobal('wx', { redirectTo });
    vi.mocked(createFulfillmentOrder)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ orderId: 'order-a' });
    await checkout.create();
    checkout.chooseStore({ detail: { value: '1' } });
    expect(checkout.data.storeId).toBe('store-a');
    expect(checkout.data.orderAttempted).toBe(true);
    const originalQuote = checkout.data.quote as Record<string, unknown>;
    checkout.data.quote = { ...originalQuote, subtotalMinor: 120, totalMinor: 120 };
    await checkout.create();
    expect(createFulfillmentOrder).toHaveBeenCalledTimes(1);
    checkout.data.quote = originalQuote;
    await checkout.create();
    expect(createFulfillmentOrder).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createFulfillmentOrder).mock.calls[0]).toEqual(
      vi.mocked(createFulfillmentOrder).mock.calls[1],
    );
    expect(redirectTo).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/pages/order-detail/order-detail?id=order-a' }),
    );
    expect(checkout.orderAttemptSession).toBe('account-a');
    vi.mocked(consumerToken).mockReturnValue('account-b');
    checkout.loadedSession = 'account-b';
    await checkout.create();
    expect(createFulfillmentOrder).toHaveBeenCalledTimes(2);
    expect(checkout.data.quote).toBeNull();
    vi.unstubAllGlobals();
  });
});
