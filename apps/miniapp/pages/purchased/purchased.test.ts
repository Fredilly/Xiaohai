import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumerToken: vi.fn(),
  getEntitlements: vi.fn(),
  getContinueWatching: vi.fn(),
  navigateTo: vi.fn(),
  navigateBack: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.consumerToken }));
vi.mock('../../services/content', () => ({
  getEntitlements: mocks.getEntitlements,
  getContinueWatching: mocks.getContinueWatching,
}));

type PageData = {
  needsLogin: boolean;
  loading: boolean;
  purchased: Array<{ id: string; title: string; displayCoverUrl: string }>;
  continueItems: Array<{
    episodeId: string;
    seriesTitle: string;
    positionMinutes: number;
    displayCoverUrl: string;
  }>;
  purchasedError: boolean;
  continueError: boolean;
};
type PurchasedPage = {
  readSequence: number;
  data: PageData;
  setData(changes: Partial<PageData>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  openSeries(event: WechatMiniprogram.TouchEvent): void;
  resume(event: WechatMiniprogram.TouchEvent): void;
  coverError(event: WechatMiniprogram.TouchEvent): void;
  backToMe(): void;
};

let definition: PurchasedPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: PurchasedPage) => {
    definition = page;
  });
  await import('./purchased');
});

afterAll(() => vi.unstubAllGlobals());

const purchased = (title: string, coverUrl = 'https://bos.example/c.png') => ({
  series: [{ id: title, title, category: '动画', coverUrl, grantedAt: '2026-01-01' }],
});
const watching = (title: string, coverUrl = 'https://bos.example/w.png') => ({
  items: [
    {
      series: { id: `series-${title}`, title, coverUrl },
      episode: { id: `episode-${title}`, title: '第一集', episodeNumber: 1 },
      progress: { positionSeconds: 165 },
    },
  ],
});

function page(): PurchasedPage {
  const instance: PurchasedPage = {
    ...definition,
    readSequence: 0,
    data: { ...definition.data, purchased: [], continueItems: [] },
    setData(changes) {
      Object.assign(instance.data, changes);
    },
  };
  return instance;
}

function tap(dataset: Record<string, string>): WechatMiniprogram.TouchEvent {
  return { currentTarget: { dataset } } as unknown as WechatMiniprogram.TouchEvent;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumerToken.mockReturnValue('session-A');
  mocks.getEntitlements.mockResolvedValue(purchased('小熊'));
  mocks.getContinueWatching.mockResolvedValue(watching('小熊'));
  vi.stubGlobal('wx', {
    navigateTo: mocks.navigateTo,
    navigateBack: mocks.navigateBack,
  });
});

describe('Purchased animation and continue-watching page', () => {
  it('never reads private data while signed out', async () => {
    mocks.consumerToken.mockReturnValue('');
    const instance = page();
    await instance.load();
    expect(instance.data.needsLogin).toBe(true);
    expect(instance.data.purchased).toEqual([]);
    expect(mocks.getEntitlements).not.toHaveBeenCalled();
    expect(mocks.getContinueWatching).not.toHaveBeenCalled();
    instance.backToMe();
    expect(mocks.navigateBack).toHaveBeenCalledOnce();
  });

  it('shows real server-granted rights and incomplete episodes with correct destinations', async () => {
    const instance = page();
    await instance.load();
    expect(instance.data).toMatchObject({
      loading: false,
      purchasedError: false,
      continueError: false,
      purchased: [{ id: '小熊', title: '小熊' }],
      continueItems: [{ episodeId: 'episode-小熊', positionMinutes: 2 }],
    });
    instance.openSeries(tap({ id: '小熊' }));
    instance.resume(tap({ id: 'episode-小熊' }));
    expect(mocks.navigateTo).toHaveBeenNthCalledWith(1, {
      url: '/pages/story-detail/story-detail?id=%E5%B0%8F%E7%86%8A',
    });
    expect(mocks.navigateTo).toHaveBeenNthCalledWith(2, {
      url: '/pages/playback/playback?id=episode-%E5%B0%8F%E7%86%8A',
    });
  });

  it('keeps purchased rights usable if the continue-watching read fails', async () => {
    mocks.getContinueWatching.mockRejectedValue(new Error('network timeout'));
    const instance = page();
    await instance.load();
    expect(instance.data).toMatchObject({
      purchasedError: false,
      continueError: true,
      purchased: [{ title: '小熊' }],
      continueItems: [],
    });
    mocks.getContinueWatching.mockResolvedValue(watching('重试'));
    await instance.load();
    expect(instance.data.continueItems[0]?.seriesTitle).toBe('重试');
  });

  it('does not show an earlier account after session switch or delayed responses', async () => {
    const oldEntitlements = deferred<ReturnType<typeof purchased>>();
    const oldWatching = deferred<ReturnType<typeof watching>>();
    mocks.getEntitlements.mockImplementationOnce(() => oldEntitlements.promise);
    mocks.getContinueWatching.mockImplementationOnce(() => oldWatching.promise);
    const instance = page();
    const first = instance.load();
    mocks.consumerToken.mockReturnValue('session-B');
    mocks.getEntitlements.mockResolvedValue(purchased('账号B'));
    mocks.getContinueWatching.mockResolvedValue(watching('账号B'));
    await instance.load();
    oldEntitlements.resolve(purchased('账号A'));
    oldWatching.resolve(watching('账号A'));
    await first;
    expect(instance.data.purchased[0]?.title).toBe('账号B');
    expect(instance.data.continueItems[0]?.seriesTitle).toBe('账号B');
  });

  it('clears private results after a 401 invalidates the active session', async () => {
    mocks.consumerToken.mockReturnValueOnce('session-A').mockReturnValue('');
    const instance = page();
    await instance.load();
    expect(instance.data).toMatchObject({
      needsLogin: true,
      loading: false,
      purchased: [],
      continueItems: [],
    });
  });

  it('invalidates pending reads and clears private rows on hide and unload', async () => {
    const waiting = deferred<ReturnType<typeof purchased>>();
    mocks.getEntitlements.mockReturnValueOnce(waiting.promise);
    const instance = page();
    const work = instance.load();
    instance.onHide();
    waiting.resolve(purchased('过期响应'));
    await work;
    expect(instance.data.purchased).toEqual([]);
    await instance.load();
    expect(instance.data.purchased).toHaveLength(1);
    instance.onUnload();
    expect(instance.readSequence).toBe(4);
  });

  it('only clears the failing cover version, not a newer image or another item', async () => {
    const instance = page();
    await instance.load();
    instance.coverError(
      tap({ section: 'purchased', id: '小熊', src: 'https://old.example/a.jpg' }),
    );
    expect(instance.data.purchased[0]?.displayCoverUrl).toBe('https://bos.example/c.png');
    instance.coverError(
      tap({ section: 'purchased', id: '小熊', src: 'https://bos.example/c.png' }),
    );
    expect(instance.data.purchased[0]?.displayCoverUrl).toBe('');
    expect(instance.data.continueItems[0]?.displayCoverUrl).toBe('https://bos.example/w.png');
  });
});
