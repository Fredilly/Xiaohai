import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumerToken } from '../../services/consumer-session';
import { createStoryWork, StoryApiError } from '../../services/story';

vi.mock('../../services/consumer-session', () => ({ consumerToken: vi.fn() }));
vi.mock('../../services/story', () => ({
  createStoryWork: vi.fn(),
  StoryApiError: class StoryApiError extends Error {
    constructor(readonly status: number) {
      super(`Story API ${status}`);
    }
  },
}));

type StoryCreatePage = {
  activeSession: string;
  wasHidden: boolean;
  pageClosed: boolean;
  navigating: boolean;
  data: {
    isLoggedIn: boolean;
    title: string;
    idea: string;
    ageRange: string;
    theme: string;
    style: string;
    loading: boolean;
    creationUnknown: boolean;
    createdWorkId: string;
    errorMessage: string;
  };
  setData(data: Record<string, unknown>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  submit(): Promise<void>;
  openWorks(): void;
};

const token = vi.mocked(consumerToken);
const create = vi.mocked(createStoryWork);
const redirectTo = vi.fn();
const navigateTo = vi.fn();
const switchTab = vi.fn();
const showToast = vi.fn();
const workId = '11111111-1111-4111-8111-111111111111';
let definition: StoryCreatePage;

function page(): StoryCreatePage {
  return {
    ...definition,
    activeSession: 'session-a',
    wasHidden: false,
    pageClosed: false,
    navigating: false,
    data: {
      isLoggedIn: true,
      title: '森林灯塔',
      idea: '小狐狸帮助迷路的朋友',
      ageRange: '6-8岁',
      theme: '友爱',
      style: '温暖童话',
      loading: false,
      creationUnknown: false,
      createdWorkId: '',
      errorMessage: '',
    },
    setData(data) {
      Object.assign(this.data, data);
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: StoryCreatePage) => {
    definition = options;
  });
  vi.stubGlobal('wx', { redirectTo, navigateTo, switchTab, showToast });
  await import('./story-create');
});
beforeEach(() => {
  vi.resetAllMocks();
  token.mockReturnValue('session-a');
});
afterAll(() => vi.unstubAllGlobals());

describe('Story creation request and account safety', () => {
  it('submits the work only once and opens its detail under the original session', async () => {
    let finish: (value: Awaited<ReturnType<typeof createStoryWork>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const current = page();
    const first = current.submit();
    const second = current.submit();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      title: '森林灯塔',
      idea: '小狐狸帮助迷路的朋友',
      ageRange: '6-8岁',
      theme: '友爱',
      style: '温暖童话',
    });
    finish({ id: workId } as Awaited<ReturnType<typeof createStoryWork>>);
    await Promise.all([first, second]);
    expect(redirectTo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: `/pages/story-work/story-work?id=${workId}` }),
    );
    expect(current.data.createdWorkId).toBe(workId);
    await current.submit();
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not blindly retry after an uncertain creation result', async () => {
    create.mockRejectedValueOnce(new Error('request:fail timeout'));
    const current = page();
    await current.submit();
    await current.submit();
    expect(create).toHaveBeenCalledOnce();
    expect(current.data.creationUnknown).toBe(true);
    expect(current.data.errorMessage).toContain('避免重复创建');
    current.openWorks();
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/story-works/story-works' });
  });

  it('allows a confirmed feature-disabled response without claiming a creation', async () => {
    create.mockRejectedValueOnce(new StoryApiError(503));
    const current = page();
    await current.submit();
    expect(current.data.creationUnknown).toBe(false);
    expect(current.data.errorMessage).toBe('故事功能尚未开启');
    expect(current.data.createdWorkId).toBe('');
  });

  it('retains hidden success and resumes the detail navigation without another POST', async () => {
    let finish: (value: Awaited<ReturnType<typeof createStoryWork>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const current = page();
    const pending = current.submit();
    current.onHide();
    finish({ id: workId } as Awaited<ReturnType<typeof createStoryWork>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdWorkId).toBe(workId);
    current.onShow();
    expect(redirectTo).toHaveBeenCalledOnce();
    await current.submit();
    expect(create).toHaveBeenCalledOnce();
  });

  it('discards an old account success and prevents navigation to its private work', async () => {
    let finish: (value: Awaited<ReturnType<typeof createStoryWork>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const current = page();
    const pending = current.submit();
    token.mockReturnValue('session-b');
    finish({ id: workId } as Awaited<ReturnType<typeof createStoryWork>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.idea).toBe('');
    expect(current.data.createdWorkId).toBe('');
    expect(current.data.errorMessage).toContain('登录状态已变化');
  });

  it('removes the prior account draft when the page reappears with a new session', async () => {
    const current = page();
    current.onHide();
    token.mockReturnValue('session-b');
    current.onShow();
    expect(current.activeSession).toBe('session-b');
    expect(current.data.idea).toBe('');
    expect(current.data.title).toBe('');
    await current.submit();
    expect(create).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledOnce();
  });

  it('does not let an old request erase a fresh draft for the new session', async () => {
    let finish: (value: Awaited<ReturnType<typeof createStoryWork>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const current = page();
    const pending = current.submit();
    current.onHide();
    token.mockReturnValue('session-b');
    current.onShow();
    current.setData({ idea: '新账号自己的故事' });
    finish({ id: workId } as Awaited<ReturnType<typeof createStoryWork>>);
    await pending;
    expect(current.activeSession).toBe('session-b');
    expect(current.data.idea).toBe('新账号自己的故事');
    expect(current.data.createdWorkId).toBe('');
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('does not expose a result when the page has been disposed', async () => {
    let finish: (value: Awaited<ReturnType<typeof createStoryWork>>) => void = () => {};
    create.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const current = page();
    const pending = current.submit();
    current.onUnload();
    finish({ id: workId } as Awaited<ReturnType<typeof createStoryWork>>);
    await pending;
    expect(redirectTo).not.toHaveBeenCalled();
    expect(current.data.createdWorkId).toBe('');
  });
});
