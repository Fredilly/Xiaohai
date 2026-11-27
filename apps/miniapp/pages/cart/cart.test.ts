import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteCartItem, getCart, updateCartItem } from '../../services/commerce';
import { consumerToken } from '../../services/consumer-session';

vi.mock('../../services/commerce', () => ({
  getCart: vi.fn(),
  updateCartItem: vi.fn(),
  deleteCartItem: vi.fn(),
}));
vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));

type CartPage = {
  readSequence: number;
  mutationInFlight: boolean;
  loadedSession: string;
  wasHidden: boolean;
  pageClosed: boolean;
  reloadAfterMutation: boolean;
  data: {
    cart: { items: Array<{ id: string; quantity: number }> } | null;
    loading: boolean;
    error: boolean;
    needsLogin: boolean;
    mutating: boolean;
    mutationError: string;
  };
  setData(patch: Record<string, unknown>): void;
  load(): Promise<void>;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  plus(event: { currentTarget: { dataset: { id: string } } }): Promise<void>;
  minus(event: { currentTarget: { dataset: { id: string } } }): Promise<void>;
  remove(event: { currentTarget: { dataset: { id: string } } }): Promise<void>;
  checkout(): void;
  goToLogin(): void;
};

let definition: CartPage;
function page(): CartPage {
  return {
    ...definition,
    readSequence: 0,
    mutationInFlight: false,
    loadedSession: 'account-a',
    wasHidden: false,
    pageClosed: false,
    reloadAfterMutation: false,
    data: {
      cart: { items: [{ id: 'line-a', quantity: 2 }] },
      loading: false,
      error: false,
      needsLogin: false,
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
beforeEach(() => {
  vi.mocked(getCart).mockReset();
  vi.mocked(updateCartItem).mockReset();
  vi.mocked(deleteCartItem).mockReset();
  vi.mocked(consumerToken).mockReturnValue('account-a');
});

describe('miniapp cart mutations', () => {
  it('does not request or display a cart for a signed-out account', async () => {
    vi.mocked(consumerToken).mockReturnValue('');
    vi.mocked(getCart).mockClear();
    const cart = page();
    await cart.load();
    expect(getCart).not.toHaveBeenCalled();
    expect(cart.data).toMatchObject({ cart: null, loading: false, needsLogin: true });
    const switchTab = vi.fn();
    vi.stubGlobal('wx', { switchTab });
    cart.goToLogin();
    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/me/me' });
    vi.unstubAllGlobals();
  });

  it('never lets an older cart request overwrite a newer refresh', async () => {
    const resolves: Array<(value: Awaited<ReturnType<typeof getCart>>) => void> = [];
    vi.mocked(getCart)
      .mockReset()
      .mockImplementation(() => new Promise((accept) => resolves.push(accept)));
    const cart = page();
    const older = cart.load();
    const newer = cart.load();
    resolves[1]!({ items: [{ id: 'new-line', quantity: 4 }] } as never);
    await newer;
    resolves[0]!({ items: [{ id: 'old-line', quantity: 1 }] } as never);
    await older;
    expect(cart.data.cart?.items).toEqual([{ id: 'new-line', quantity: 4 }]);
  });

  it('clears an old account cart if logout occurs before its network response', async () => {
    let resolve: (value: Awaited<ReturnType<typeof getCart>>) => void = () => {};
    vi.mocked(getCart)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((accept) => {
            resolve = accept;
          }),
      );
    const cart = page();
    const pending = cart.load();
    vi.mocked(consumerToken).mockReturnValue('');
    resolve({ items: [{ id: 'private-line', quantity: 1 }] } as never);
    await pending;
    expect(cart.data).toMatchObject({ cart: null, loading: false, needsLogin: true });
  });

  it('never reads a new account cart as part of the old account mutation', async () => {
    let release: () => void = () => {};
    vi.mocked(updateCartItem)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<void>((accept) => {
            release = accept;
          }),
      );
    vi.mocked(getCart)
      .mockReset()
      .mockResolvedValueOnce({ items: [{ id: 'account-b-line', quantity: 1 }] } as never);
    const cart = page();
    const pending = cart.plus(event);
    vi.mocked(consumerToken).mockReturnValue('account-b');
    release();
    await pending;
    expect(getCart).toHaveBeenCalledTimes(1);
    expect(cart.data.cart?.items).toEqual([{ id: 'account-b-line', quantity: 1 }]);
    expect(cart.data.mutating).toBe(false);
  });

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

  it('clears cart on hide and ignores a late load even if visible again', async () => {
    let release: (value: Awaited<ReturnType<typeof getCart>>) => void = () => {};
    vi.mocked(getCart).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const cart = page();
    const older = cart.load();
    cart.onHide();
    expect(cart.data.cart).toBeNull();
    vi.mocked(getCart).mockResolvedValueOnce({ items: [{ id: 'fresh', quantity: 1 }] } as never);
    cart.onShow();
    await vi.waitFor(() => expect(cart.data.cart?.items[0]?.id).toBe('fresh'));
    release({ items: [{ id: 'private', quantity: 1 }] } as never);
    await older;
    expect(cart.data.cart?.items[0]?.id).toBe('fresh');
  });

  it('does not mutate or navigate with cart loaded for a previous account', async () => {
    const cart = page();
    vi.mocked(consumerToken).mockReturnValue('account-b');
    const navigate = vi.fn();
    vi.stubGlobal('wx', { navigateTo: navigate });
    await cart.plus(event);
    await cart.remove(event);
    cart.checkout();
    expect(updateCartItem).not.toHaveBeenCalled();
    expect(deleteCartItem).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('never removes an item that was not in the verified cart', async () => {
    const cart = page();
    await cart.remove({ currentTarget: { dataset: { id: 'invented-item' } } });
    expect(deleteCartItem).not.toHaveBeenCalled();
  });

  it('does not publish a write result after hide and refreshes on the next show', async () => {
    let releaseWrite: () => void = () => {};
    vi.mocked(updateCartItem).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseWrite = resolve)),
    );
    vi.mocked(getCart).mockResolvedValueOnce({ items: [{ id: 'new-line', quantity: 1 }] } as never);
    const cart = page();
    const writing = cart.plus(event);
    cart.onHide();
    releaseWrite();
    await writing;
    expect(cart.data.cart).toBeNull();
    expect(getCart).not.toHaveBeenCalled();
    cart.onShow();
    await vi.waitFor(() => expect(cart.data.cart?.items[0]?.id).toBe('new-line'));
  });

  it('defers refresh while a write resolves after the page returns', async () => {
    let releaseWrite: () => void = () => {};
    vi.mocked(updateCartItem).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseWrite = resolve)),
    );
    vi.mocked(getCart).mockResolvedValueOnce({
      items: [{ id: 'after-return', quantity: 3 }],
    } as never);
    const cart = page();
    const writing = cart.plus(event);
    cart.onHide();
    cart.onShow();
    expect(getCart).not.toHaveBeenCalled();
    releaseWrite();
    await writing;
    expect(getCart).toHaveBeenCalledTimes(1);
    expect(cart.data.cart?.items[0]?.id).toBe('after-return');
  });

  it('does not update a disposed page from a pending mutation', async () => {
    let releaseWrite: () => void = () => {};
    vi.mocked(updateCartItem).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseWrite = resolve)),
    );
    const cart = page();
    const writing = cart.plus(event);
    cart.onUnload();
    releaseWrite();
    await writing;
    expect(cart.data.cart).toBeNull();
    expect(getCart).not.toHaveBeenCalled();
  });
});
