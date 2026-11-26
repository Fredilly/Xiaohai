import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumerToken: vi.fn(),
  getPlayback: vi.fn(),
  saveProgress: vi.fn(),
  pause: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.consumerToken }));
vi.mock('../../services/content', () => ({
  getPlayback: mocks.getPlayback,
  saveProgress: mocks.saveProgress,
}));

type PlaybackData = {
  access: {
    access: string;
    playbackUrl: string | null;
    resumePositionSeconds: number;
    previewSeconds: number | null;
  } | null;
  error: string;
  episodeId: string;
  loading: boolean;
  position: number;
};
type PlaybackPage = {
  readSequence: number;
  wasHidden: boolean;
  activeSession: string;
  playbackEnded: boolean;
  lastProgressCheckpoint: number;
  progressWrites: Promise<void>;
  data: PlaybackData;
  setData(changes: Partial<PlaybackData>): void;
  onLoad(query: Record<string, string | undefined>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(id: string): Promise<void>;
  retry(): void;
  playbackError(): void;
  time(event: WechatMiniprogram.VideoTimeUpdate): void;
  ended(): void;
  queueProgress(position: number, completed: boolean): void;
};

let definition: PlaybackPage;

beforeAll(async () => {
  vi.stubGlobal('Page', (page: PlaybackPage) => {
    definition = page;
  });
  await import('./playback');
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumerToken.mockReturnValue('session-A');
  mocks.getPlayback.mockResolvedValue(access());
  mocks.saveProgress.mockResolvedValue(undefined);
  vi.stubGlobal('wx', { createVideoContext: () => ({ pause: mocks.pause }) });
});

function access(playbackUrl: string | null = 'https://media.example/episode.mp4', mode = 'FULL') {
  return {
    episodeId: 'episode-1',
    access: mode,
    playbackUrl,
    resumePositionSeconds: 45,
    previewSeconds: mode === 'PREVIEW' ? 30 : null,
  };
}

function page(): PlaybackPage {
  const instance = {
    ...definition,
    readSequence: 0,
    wasHidden: false,
    activeSession: '',
    playbackEnded: false,
    lastProgressCheckpoint: -1,
    progressWrites: Promise.resolve(),
    data: { ...definition.data },
    setData(changes: Partial<PlaybackData>) {
      Object.assign(instance.data, changes);
    },
  } satisfies PlaybackPage;
  return instance;
}

function time(second: number): WechatMiniprogram.VideoTimeUpdate {
  return { detail: { currentTime: second } } as WechatMiniprogram.VideoTimeUpdate;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Consumer playback session and progress integrity', () => {
  it('loads the requested episode and resumes from server-owned progress', async () => {
    const instance = page();
    instance.data.episodeId = 'episode-1';
    await instance.load('episode-1');
    expect(mocks.getPlayback).toHaveBeenCalledExactlyOnceWith('episode-1');
    expect(instance.data).toMatchObject({
      loading: false,
      error: '',
      position: 45,
      access: { access: 'FULL' },
    });
  });

  it('rejects a delayed old-session response and reloads for the new account', async () => {
    const oldResponse = deferred<ReturnType<typeof access>>();
    mocks.getPlayback
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(access('https://media.example/new-account.mp4'));
    const instance = page();
    instance.data.episodeId = 'episode-1';
    const first = instance.load('episode-1');
    mocks.consumerToken.mockReturnValue('session-B');
    oldResponse.resolve(access('https://media.example/old-account.mp4'));
    await first;
    await vi.waitFor(() => {
      expect(instance.data.access?.playbackUrl).toBe('https://media.example/new-account.mp4');
    });
    expect(instance.activeSession).toBe('session-B');
    expect(mocks.getPlayback).toHaveBeenCalledTimes(2);
  });

  it('clears private media on hide and ignores responses received after leaving', async () => {
    const slow = deferred<ReturnType<typeof access>>();
    mocks.getPlayback.mockReturnValueOnce(slow.promise);
    const instance = page();
    instance.data.episodeId = 'episode-1';
    const pending = instance.load('episode-1');
    instance.onHide();
    slow.resolve(access());
    await pending;
    expect(instance.data.access).toBeNull();
    expect(instance.data.loading).toBe(false);
    expect(mocks.pause).toHaveBeenCalledOnce();

    instance.onShow();
    await vi.waitFor(() => expect(instance.data.access?.access).toBe('FULL'));
    instance.onUnload();
  });

  it('deduplicates repeated second markers and writes completion after checkpoints', async () => {
    const heldWrite = deferred<void>();
    mocks.saveProgress.mockReturnValueOnce(heldWrite.promise).mockResolvedValue(undefined);
    const instance = page();
    instance.data.episodeId = 'episode-1';
    await instance.load('episode-1');
    instance.time(time(10.1));
    instance.time(time(10.8));
    instance.ended();
    await vi.waitFor(() => expect(mocks.saveProgress).toHaveBeenCalledTimes(1));
    expect(mocks.saveProgress).toHaveBeenCalledWith('episode-1', 10, false);
    heldWrite.resolve();
    await instance.progressWrites;
    expect(mocks.saveProgress).toHaveBeenCalledTimes(2);
    expect(mocks.saveProgress).toHaveBeenLastCalledWith('episode-1', 10, true);
    instance.time(time(20));
    await instance.progressWrites;
    expect(mocks.saveProgress).toHaveBeenCalledTimes(2);
  });

  it('saves a completed episode after the page hides, but never under a different login', async () => {
    const instance = page();
    instance.data.episodeId = 'episode-1';
    await instance.load('episode-1');
    instance.ended();
    instance.onHide();
    await instance.progressWrites;
    expect(mocks.saveProgress).toHaveBeenCalledExactlyOnceWith('episode-1', 45, true);

    instance.onShow();
    await vi.waitFor(() => expect(instance.data.access?.access).toBe('FULL'));
    instance.ended();
    mocks.consumerToken.mockReturnValue('session-B');
    await instance.progressWrites;
    expect(mocks.saveProgress).toHaveBeenCalledTimes(1);
  });

  it('does not write viewing history for guests and stops previews at their boundary', async () => {
    mocks.consumerToken.mockReturnValue('');
    mocks.getPlayback.mockResolvedValue(access('https://media.example/preview.mp4', 'PREVIEW'));
    const instance = page();
    instance.data.episodeId = 'episode-1';
    await instance.load('episode-1');
    instance.time(time(30));
    await instance.progressWrites;
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.saveProgress).not.toHaveBeenCalled();
  });

  it('stops a playing episode when the account changes', async () => {
    const instance = page();
    instance.data.episodeId = 'episode-1';
    await instance.load('episode-1');
    mocks.consumerToken.mockReturnValue('session-B');
    instance.time(time(50));
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(instance.data.access).toBeNull();
    expect(instance.data.error).toContain('登录状态已变更');
    expect(mocks.saveProgress).not.toHaveBeenCalled();
  });

  it('does not leave an unusable video visible when media is unavailable', async () => {
    mocks.getPlayback.mockResolvedValue(access(null));
    const instance = page();
    instance.data.episodeId = 'episode-1';
    await instance.load('episode-1');
    expect(instance.data.access).toBeNull();
    expect(instance.data.loading).toBe(false);
    expect(instance.data.error).toContain('无法获取播放权限');
    mocks.getPlayback.mockResolvedValue(access());
    instance.retry();
    await vi.waitFor(() => expect(instance.data.error).toBe(''));
  });
});
