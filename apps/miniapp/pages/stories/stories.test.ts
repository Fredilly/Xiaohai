import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listSeries: vi.fn(), navigateTo: vi.fn() }));
vi.mock('../../services/content', () => ({ listSeries: mocks.listSeries }));

type StoriesPage = {
  requestVersion: number;
  wasHidden: boolean;
  data: {
    q: string;
    category: string;
    series: Array<{ id: string; title: string }>;
    loading: boolean;
    error: string;
  };
  setData(changes: Partial<StoriesPage['data']>): void;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  onQuery(event: WechatMiniprogram.Input): void;
  search(): void;
  open(event: WechatMiniprogram.TouchEvent): void;
};

let definition: StoriesPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: StoriesPage) => {
    definition = page;
  });
  await import('./stories');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSeries.mockResolvedValue({ series: [] });
  vi.stubGlobal('wx', { navigateTo: mocks.navigateTo });
});

function page(): StoriesPage {
  const instance = {
    ...definition,
    requestVersion: 0,
    wasHidden: false,
    data: { ...definition.data, series: [] },
    setData(changes: Partial<StoriesPage['data']>) {
      Object.assign(instance.data, changes);
    },
  } satisfies StoriesPage;
  return instance;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const series = (id: string) => ({ series: [{ id, title: id }] });

describe('Published animation search on weak networks', () => {
  it('keeps the newest query when older search results arrive later', async () => {
    const old = deferred<ReturnType<typeof series>>();
    mocks.listSeries.mockReturnValueOnce(old.promise).mockResolvedValueOnce(series('new-result'));
    const instance = page();
    instance.data.q = 'old';
    const first = instance.load();
    instance.onQuery({ detail: { value: 'new' } } as WechatMiniprogram.Input);
    const second = instance.load();
    await second;
    old.resolve(series('old-result'));
    await first;
    expect(mocks.listSeries).toHaveBeenNthCalledWith(1, 'old', '');
    expect(mocks.listSeries).toHaveBeenNthCalledWith(2, 'new', '');
    expect(instance.data).toMatchObject({
      series: [{ id: 'new-result' }],
      loading: false,
      error: '',
    });
  });

  it('never replaces a successful search with a delayed error', async () => {
    const old = deferred<ReturnType<typeof series>>();
    mocks.listSeries.mockReturnValueOnce(old.promise).mockResolvedValueOnce(series('fresh'));
    const instance = page();
    const first = instance.load();
    await instance.load();
    old.reject(new Error('timeout'));
    await first;
    expect(instance.data.series).toEqual([{ id: 'fresh', title: 'fresh' }]);
    expect(instance.data.error).toBe('');
  });

  it('invalidates reads on hide, then refreshes only when the page returns', async () => {
    const old = deferred<ReturnType<typeof series>>();
    mocks.listSeries.mockReturnValueOnce(old.promise);
    const instance = page();
    const first = instance.load();
    instance.onHide();
    old.resolve(series('hidden-result'));
    await first;
    expect(instance.data.series).toEqual([]);
    expect(instance.data.loading).toBe(false);

    mocks.listSeries.mockResolvedValue(series('visible-result'));
    instance.onShow();
    await vi.waitFor(() => expect(instance.data.series[0]?.id).toBe('visible-result'));
    expect(instance.data.loading).toBe(false);
    instance.onUnload();
  });

  it('retries a failed search with the currently selected query and category', async () => {
    mocks.listSeries
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(series('retry'));
    const instance = page();
    instance.data.q = 'cat';
    instance.data.category = '动画';
    await instance.load();
    expect(instance.data.error).toContain('加载失败');
    instance.search();
    await vi.waitFor(() => expect(instance.data.series[0]?.id).toBe('retry'));
    expect(mocks.listSeries).toHaveBeenLastCalledWith('cat', '动画');
  });

  it('opens only a selected series using an encoded ID', () => {
    const instance = page();
    instance.open({
      currentTarget: { dataset: { id: '' } },
    } as unknown as WechatMiniprogram.TouchEvent);
    expect(mocks.navigateTo).not.toHaveBeenCalled();
    instance.open({
      currentTarget: { dataset: { id: 'series/1' } },
    } as unknown as WechatMiniprogram.TouchEvent);
    expect(mocks.navigateTo).toHaveBeenCalledExactlyOnceWith({
      url: '/pages/story-detail/story-detail?id=series%2F1',
    });
  });
});
