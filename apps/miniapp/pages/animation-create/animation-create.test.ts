import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumerToken } from '../../services/consumer-session';
import { AnimationApiError, createAnimation } from '../../services/animation';

vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));
vi.mock('../../services/animation', () => ({
  createAnimation: vi.fn(),
  AnimationApiError: class AnimationApiError extends Error {
    constructor(readonly status: number) {
      super(`Animation API ${status}`);
    }
  },
}));

type CreatePage = {
  sourceSession: string;
  wasHidden: boolean;
  pageClosed: boolean;
  navigating: boolean;
  data: {
    workId: string;
    versionId: string;
    title: string;
    submitting: boolean;
    creationUnknown: boolean;
    createdId: string;
    error: string;
  };
  setData(changes: Record<string, unknown>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  submit(): Promise<void>;
  viewExisting(): void;
};

const create = vi.mocked(createAnimation);
const token = vi.mocked(consumerToken);
const redirectTo = vi.fn();
let definition: CreatePage;

function page(): CreatePage {
  return {
    ...definition,
    sourceSession: 'session-a',
    wasHidden: false,
    pageClosed: false,
    navigating: false,
    data: {
      workId: 'story-1',
      versionId: 'version-1',
      title: '森林动画',
      submitting: false,
      creationUnknown: false,
      createdId: '',
      error: '',
    },
    setData(changes) {
      Object.assign(this.data, changes);
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: CreatePage) => {
    definition = options;
  });
  vi.stubGlobal('wx', { redirectTo });
  await import('./animation-create');
});
beforeEach(() => {
  vi.resetAllMocks();
  token.mockReturnValue('session-a');
});
afterAll(() => vi.unstubAllGlobals());

describe('Animation creation is single-flight, account-bound and retry-safe', () => {
  it('creates once for simultaneous taps and opens only the accepted animation', async () => {
    let complete: (value: Awaited<ReturnType<typeof createAnimation>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const current = page();
    const first = current.submit();
    const second = current.submit();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      storyWorkId: 'story-1',
      sourceStoryVersionId: 'version-1',
      title: '森林动画',
    });
    complete({ id: 'animation-1' } as Awaited<ReturnType<typeof createAnimation>>);
    await Promise.all([first, second]);
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: '/pages/animation-detail/animation-detail?id=animation-1',
      }),
    );
    await current.submit();
    expect(create).toHaveBeenCalledOnce();
  });

  it('blocks blind resubmission after a timeout or uncertain server error', async () => {
    create.mockRejectedValueOnce(new Error('request:fail timeout'));
    const current = page();
    await current.submit();
    await current.submit();
    expect(create).toHaveBeenCalledOnce();
    expect(current.data.creationUnknown).toBe(true);
    expect(current.data.error).toContain('避免重复创建');
    current.viewExisting();
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith({ url: '/pages/animations/animations' });
  });

  it('distinguishes a confirmed disabled AI capability from an uncertain creation', async () => {
    create.mockRejectedValueOnce(new AnimationApiError(503));
    const current = page();
    await current.submit();
    expect(current.data.creationUnknown).toBe(false);
    expect(current.data.error).toContain('安全关闭');
    create.mockRejectedValueOnce(new AnimationApiError(409));
    await current.submit();
    expect(current.data.creationUnknown).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('holds a successful hidden result and navigates only when the page returns', async () => {
    let complete: (value: Awaited<ReturnType<typeof createAnimation>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const current = page();
    const pending = current.submit();
    current.onHide();
    complete({ id: 'animation-1' } as Awaited<ReturnType<typeof createAnimation>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdId).toBe('animation-1');
    current.onShow();
    expect(redirectTo).toHaveBeenCalledOnce();
  });

  it('does not navigate to a former account animation when its POST returns late', async () => {
    let complete: (value: Awaited<ReturnType<typeof createAnimation>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const current = page();
    const pending = current.submit();
    token.mockReturnValue('session-b');
    complete({ id: 'animation-1' } as Awaited<ReturnType<typeof createAnimation>>);
    await pending;
    expect(current.data.workId).toBe('');
    expect(current.data.versionId).toBe('');
    expect(current.data.createdId).toBe('');
    expect(current.data.error).toContain('登录状态已变化');
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('invalidates an old story source when resuming as another user', async () => {
    const current = page();
    current.onHide();
    token.mockReturnValue('session-b');
    current.onShow();
    await current.submit();
    expect(current.data.workId).toBe('');
    expect(current.data.title).toBe('');
    expect(create).not.toHaveBeenCalled();
  });

  it('does not update a disposed page after the server accepts a creation', async () => {
    let complete: (value: Awaited<ReturnType<typeof createAnimation>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
    const current = page();
    const pending = current.submit();
    current.onUnload();
    complete({ id: 'animation-1' } as Awaited<ReturnType<typeof createAnimation>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdId).toBe('');
  });
});
