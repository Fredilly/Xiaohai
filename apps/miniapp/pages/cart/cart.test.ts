import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCart, updateCartItem } from '../../services/commerce';

vi.mock('../../services/commerce', () => ({
  getCart: vi.fn(),
  updateCartItem: vi.fn(),
  deleteCartItem: vi.fn(),
}));

type CartPage = {
  readSequence: number;
  mutationInFlight: boolean;
  data: {
    cart: { items: Array<{ id: string; quantity: number }> } | null;
    loading: boolean;
    error: boolean;
    mutating: boolean;
    mutationError: string;
  };
  setData(patch: Record<string, unknown>): void;
  load(): Promise<void>;
  plus(event: { currentTarget: { dataset: { id: string } } }): Promise<void>;
  minus(event: { currentTarget: { dataset: { id: string } } }): Promise<void>;
  checkout(): void;
};

let definition: CartPage;
function page(): CartPage {
  return {
    ...definition,
    readSequence: 0,
    mutationInFlight: false,
    data: {
      cart: { items: [{ id: 'line-a', quantity: 2 }] },
      loading: false,
      error: false,
      mutating: false,
      mutationError: '',
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
  };
}

const event = { currentTarget: { dataset: { id: 'line-a' } } };

beforeAll(async () => {
  vi.stubGlobal('Page', (config: CartPage) => {
    definition = config;
  });
  await import('./cart');
});
afterAll(() => vi.unstubAllGlobals());

describe('miniapp cart mutations', () => {
  it('serializes rapid quantity taps and blocks checkout until the new cart is confirmed', async () => {
    let resolveWrite: () => void = () => {};
    vi.mocked(updateCartItem).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    vi.mocked(getCart).mockResolvedValueOnce({ items: [{ id: 'line-a', quantity: 3 }] } as never);
    const cart = page();
    const navigate = vi.fn();
    vi.stubGlobal('wx', { navigateTo: navigate });
    const write = cart.plus(event);
    await cart.minus(event);
    cart.checkout();
    expect(updateCartItem).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    resolveWrite();
    await write;
    expect(cart.data.cart?.items[0]?.quantity).toBe(3);
    expect(cart.data.mutating).toBe(false);
    vi.unstubAllGlobals();
  });

  it('reports an unconfirmed write and refreshes authoritative cart state', async () => {
    vi.mocked(updateCartItem).mockReset().mockRejectedValueOnce(new Error('network'));
    vi.mocked(getCart)
      .mockReset()
      .mockResolvedValueOnce({ items: [{ id: 'line-a', quantity: 2 }] } as never);
    const cart = page();
    await cart.plus(event);
    expect(cart.data.mutationError).toContain('未确认');
    expect(cart.data.cart?.items[0]?.quantity).toBe(2);
    expect(cart.data.mutating).toBe(false);
    expect(getCart).toHaveBeenCalledTimes(1);
  });
});
