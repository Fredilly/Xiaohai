import { describe, expect, it, vi } from 'vitest';
import { createFulfillmentOrder, quoteFulfillment } from '../../services/fulfillment';

vi.mock('../../services/fulfillment', () => ({
  quoteFulfillment: vi.fn(),
  createFulfillmentOrder: vi.fn(),
  randomClientRequestId: () => 'request-id',
}));

describe('checkout quote under reordered network responses', () => {
  it('keeps only the newest selection and does not clear its loading state early', async () => {
    type PageState = {
      quoteSequence: number;
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
});
