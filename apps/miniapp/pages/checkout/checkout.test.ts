import { describe, expect, it, vi } from 'vitest';
import { quoteFulfillment } from '../../services/fulfillment';

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
    callbacks[0]!({ store: { id: 'store-a' } });
    await first;
    expect(page.data.quote).toBeNull();
    expect(page.data.quoting).toBe(true);
    callbacks[1]!({ store: { id: 'store-b' } });
    await second;
    expect(page.data.quote).toEqual({ store: { id: 'store-b' } });
    expect(page.data.quoting).toBe(false);
    vi.unstubAllGlobals();
  });
});
