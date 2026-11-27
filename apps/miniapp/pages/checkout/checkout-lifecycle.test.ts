import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumerToken } from '../../services/consumer-session';
import { listAddresses } from '../../services/commerce';
import { listStores } from '../../services/stores';
import { createFulfillmentOrder, quoteFulfillment } from '../../services/fulfillment';

vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));
vi.mock('../../services/commerce', () => ({ listAddresses: vi.fn() }));
vi.mock('../../services/stores', () => ({ listStores: vi.fn() }));
vi.mock('../../services/fulfillment', () => ({
  createFulfillmentOrder: vi.fn(),
  quoteFulfillment: vi.fn(),
  randomClientRequestId: () => 'original-request-key',
}));

const token = vi.mocked(consumerToken);
const addresses = vi.mocked(listAddresses);
const stores = vi.mocked(listStores);
const quote = vi.mocked(quoteFulfillment);
const create = vi.mocked(createFulfillmentOrder);
const redirectTo = vi.fn();
const navigateTo = vi.fn();
const switchTab = vi.fn();
const priced = {
  method: 'PICKUP',
  store: { id: 'store-a', name: '东门' },
  subtotalMinor: 1000,
  deliveryFeeMinor: 0,
  totalMinor: 1000,
};

type CheckoutPage = {
  quoteSequence: number;
  loadSequence: number;
  loadedSession: string;
  orderAttemptSession: string;
  attemptedContext: unknown;
  reloadOnShow: boolean;
  wasHidden: boolean;
  pageClosed: boolean;
  navigating: boolean;
  data: {
    storeId: string;
    method: string;
    addressId: string;
    clientRequestId: string;
    quote: typeof priced | null;
    creating: boolean;
    quoting: boolean;
    orderAttempted: boolean;
    createdOrderId: string;
    errorMessage: string;
    addresses: unknown[];
    stores: unknown[];
  };
  setData(changes: Record<string, unknown>): void;
  onHide(): void;
  onShow(): void;
  onUnload(): void;
  create(): Promise<void>;
  preview(): Promise<void>;
};

let definition: CheckoutPage;
beforeAll(async () => {
  vi.stubGlobal('Page', (options: CheckoutPage) => {
    definition = options;
  });
  vi.stubGlobal('wx', { redirectTo, navigateTo, switchTab });
  await import('./checkout');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  token.mockReturnValue('account-a');
  addresses.mockResolvedValue({ addresses: [] });
  stores.mockResolvedValue([{ id: 'store-a', name: '东门' }] as never);
  quote.mockResolvedValue(priced as never);
  create.mockResolvedValue({ orderId: 'order-a' });
});

function page(): CheckoutPage {
  return {
    ...definition,
    quoteSequence: 0,
    loadSequence: 0,
    loadedSession: 'account-a',
    orderAttemptSession: '',
    attemptedContext: null,
    reloadOnShow: false,
    wasHidden: false,
    pageClosed: false,
    navigating: false,
    data: {
      ...definition.data,
      storeId: 'store-a',
      method: 'PICKUP',
      addressId: '',
      clientRequestId: 'original-request-key',
      quote: priced,
      creating: false,
      quoting: false,
      orderAttempted: false,
      createdOrderId: '',
      errorMessage: '',
      addresses: [],
      stores: [{ id: 'store-a', name: '东门' }],
    },
    setData(changes) {
      Object.assign(this.data, changes);
    },
  };
}

function pending<T>() {
  let resolve!: (result: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

describe('Checkout order submission lifecycle and account isolation', () => {
  it('does not issue a second order POST once the first has succeeded', async () => {
    const current = page();
    await current.create();
    await current.create();
    expect(create).toHaveBeenCalledOnce();
    expect(current.data.createdOrderId).toBe('order-a');
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: '/pages/order-detail/order-detail?id=order-a' }),
    );
  });

  it('does not redirect from a hidden page; resumes the same accepted order after return', async () => {
    const deferred = pending<Awaited<ReturnType<typeof createFulfillmentOrder>>>();
    create.mockImplementationOnce(() => deferred.promise);
    const current = page();
    const submitted = current.create();
    current.onHide();
    deferred.resolve({ orderId: 'order-a' });
    await submitted;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdOrderId).toBe('order-a');
    current.onShow();
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: '/pages/order-detail/order-detail?id=order-a' }),
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it('never opens an old account order after the consumer token changes mid-request', async () => {
    const deferred = pending<Awaited<ReturnType<typeof createFulfillmentOrder>>>();
    create.mockImplementationOnce(() => deferred.promise);
    const current = page();
    const submitted = current.create();
    token.mockReturnValue('account-b');
    deferred.resolve({ orderId: 'order-a' });
    await submitted;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdOrderId).toBe('');
    expect(current.data.quote).toBeNull();
    expect(current.data.errorMessage).toContain('登录状态已变化');
  });

  it('drops an accepted result after disposal without redirect or a new POST', async () => {
    const deferred = pending<Awaited<ReturnType<typeof createFulfillmentOrder>>>();
    create.mockImplementationOnce(() => deferred.promise);
    const current = page();
    const submitted = current.create();
    current.onUnload();
    deferred.resolve({ orderId: 'order-a' });
    await submitted;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdOrderId).toBe('');
    expect(create).toHaveBeenCalledOnce();
    current.onShow();
    expect(addresses).not.toHaveBeenCalled();
  });

  it('keeps the original order attempt frozen after a hidden network error', async () => {
    const deferred = pending<Awaited<ReturnType<typeof createFulfillmentOrder>>>();
    create.mockImplementationOnce(() => deferred.promise);
    const current = page();
    const submitted = current.create();
    current.onHide();
    deferred.reject(new Error('network timeout'));
    await submitted;
    current.onShow();
    await vi.waitFor(() => expect(quote).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(current.data.errorMessage).toContain('原请求'));
    expect(current.data.orderAttempted).toBe(true);
    expect(current.data.clientRequestId).toBe('original-request-key');
    expect(current.data.storeId).toBe('store-a');
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not publish a pending quote after hiding the checkout', async () => {
    const deferred = pending<Awaited<ReturnType<typeof quoteFulfillment>>>();
    quote.mockImplementationOnce(() => deferred.promise);
    const current = page();
    const preview = current.preview();
    current.onHide();
    deferred.resolve(priced as never);
    await preview;
    expect(current.data.quote).toBeNull();
    expect(current.data.quoting).toBe(false);
    expect(current.data.addresses).toEqual([]);
  });
});
