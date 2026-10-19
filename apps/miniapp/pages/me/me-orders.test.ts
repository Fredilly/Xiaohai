import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('../../services/auth', () => ({ loginWithWeChat: vi.fn() }));
vi.mock('../../services/consumer-session', () => ({ storedConsumerId: vi.fn() }));

type PageDef = { openFeature(event: WechatMiniprogram.TouchEvent): void };
let definition: PageDef;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: PageDef) => {
    definition = page;
  });
  await import('./me');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('wx', { navigateTo: mocks.navigateTo });
});

function tap(key: string, view?: string) {
  definition.openFeature.call({} as PageDef, {
    currentTarget: { dataset: { key, view } },
  } as unknown as WechatMiniprogram.TouchEvent);
}

describe('Me order actions', () => {
  it.each(['unpaid', 'shipping', 'receiving', 'review', 'after-sales'])(
    'passes the explicit %s view without triggering an order request',
    (view) => {
      tap('orders', view);
      expect(mocks.navigateTo).toHaveBeenCalledWith({
        url: `/pages/orders/orders?view=${view}`,
      });
    },
  );

  it('preserves unfiltered navigation for View All', () => {
    tap('orders');
    expect(mocks.navigateTo).toHaveBeenCalledWith({ url: '/pages/orders/orders' });
  });
});
