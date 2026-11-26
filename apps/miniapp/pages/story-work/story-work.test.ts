import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  getWork: vi.fn(),
  generate: vi.fn(),
  getJob: vi.fn(),
  saveVersion: vi.fn(),
  navigateTo: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/story', () => ({
  getStoryWork: mocks.getWork,
  generateStory: mocks.generate,
  getStoryJob: mocks.getJob,
  saveStoryVersion: mocks.saveVersion,
  StoryApiError: class StoryApiError extends Error {
    constructor(readonly status: number) {
      super(`Story API ${status}`);
    }
  },
}));

const workId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const detail = {
  work: { id: workId, title: '故事甲', controls: { idea: '小狐狸', theme: '友谊' } },
  versions: [],
};

type WorkPage = {
  readSequence: number;
  generationRevision: number;
  wasHidden: boolean;
  pageClosed: boolean;
  workSession: string;
  data: {
    workId: string;
    work: { id: string; title: string; controls: { idea: string; theme: string } } | null;
    versions: Array<{ workId: string }>;
    latestOutlineId: string;
    latestBodyId: string;
    instruction: string;
    loading: boolean;
    generating: boolean;
    statusText: string;
    errorMessage: string;
  };
  setData(update: Record<string, unknown>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  generate(event: { currentTarget: { dataset: { operation: string } } }): Promise<void>;
  createPictureBook(): void;
  createAnimation(): void;
};

let definition: WorkPage;
beforeAll(async () => {
  vi.stubGlobal('Page', (value: WorkPage) => {
    definition = value;
  });
  await import('./story-work');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockReturnValue('session-a');
  mocks.getWork.mockResolvedValue(detail);
  vi.stubGlobal('wx', { navigateTo: mocks.navigateTo, showToast: mocks.showToast });
});

function page(): WorkPage {
  return {
    ...definition,
    readSequence: 0,
    generationRevision: 0,
    wasHidden: false,
    pageClosed: false,
    workSession: '',
    data: { ...definition.data, workId, versions: [] },
    setData(update) {
      Object.assign(this.data, update);
    },
  };
}

describe('story work detail session and job continuity', () => {
  it('does not display a hidden response and refreshes when shown again', async () => {
    let resolveWork: (value: unknown) => void = () => {};
    mocks.getWork.mockImplementationOnce(() => new Promise((resolve) => (resolveWork = resolve)));
    const current = page();
    const pending = current.load();
    current.onHide();
    resolveWork(detail);
    await pending;
    expect(current.data.work).toBeNull();
    expect(current.data.versions).toEqual([]);
    expect(current.workSession).toBe('');

    current.onShow();
    await vi.waitFor(() => expect(current.data.work?.id).toBe(workId));
    expect(mocks.getWork).toHaveBeenCalledTimes(2);
    expect(current.workSession).toBe('session-a');
  });

  it('rejects responses for another work or version without exposing them', async () => {
    const current = page();
    mocks.getWork.mockResolvedValueOnce({ ...detail, work: { ...detail.work, id: otherId } });
    await current.load();
    expect(current.data.work).toBeNull();
    expect(current.data.errorMessage).toContain('作品加载失败');

    mocks.getWork.mockResolvedValueOnce({ ...detail, versions: [{ workId: otherId }] });
    await current.load();
    expect(current.data.versions).toEqual([]);
    expect(current.workSession).toBe('');
  });

  it('rejects an old account response without filling the new account page', async () => {
    let resolveWork: (value: unknown) => void = () => {};
    mocks.getWork.mockImplementationOnce(() => new Promise((resolve) => (resolveWork = resolve)));
    const current = page();
    const pending = current.load();
    mocks.token.mockReturnValue('session-b');
    resolveWork(detail);
    await pending;
    expect(current.data.work).toBeNull();
    expect(current.workSession).toBe('');
    expect(current.data.errorMessage).toContain('登录状态已变化');
  });

  it('preserves a confirmed server-side save after hiding without restoring private UI', async () => {
    let resolveAccepted: (value: unknown) => void = () => {};
    mocks.generate.mockImplementationOnce(
      () => new Promise((resolve) => (resolveAccepted = resolve)),
    );
    const current = page();
    await current.load();
    mocks.getJob.mockResolvedValue({ jobId, workId, status: 'SUCCEEDED' });
    mocks.saveVersion.mockResolvedValue({ workId, sourceAiJobId: jobId });
    const pending = current.generate({ currentTarget: { dataset: { operation: 'OUTLINE' } } });
    current.onHide();
    resolveAccepted({ workId, jobId });
    await pending;
    expect(mocks.getJob).toHaveBeenCalledOnce();
    expect(mocks.saveVersion).toHaveBeenCalledWith(workId, jobId);
    expect(current.data.work).toBeNull();
    expect(current.data.generating).toBe(false);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('does not poll or save a job under a replaced account session', async () => {
    let resolveAccepted: (value: unknown) => void = () => {};
    mocks.generate.mockImplementationOnce(
      () => new Promise((resolve) => (resolveAccepted = resolve)),
    );
    const current = page();
    await current.load();
    const pending = current.generate({ currentTarget: { dataset: { operation: 'OUTLINE' } } });
    current.onHide();
    mocks.token.mockReturnValue('session-b');
    resolveAccepted({ workId, jobId });
    await pending;
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.saveVersion).not.toHaveBeenCalled();
    expect(current.data.work).toBeNull();
  });

  it('does not save a job associated with a different work', async () => {
    const current = page();
    await current.load();
    mocks.generate.mockResolvedValue({ workId, jobId });
    mocks.getJob.mockResolvedValue({ jobId, workId: otherId, status: 'SUCCEEDED' });
    await current.generate({ currentTarget: { dataset: { operation: 'OUTLINE' } } });
    expect(mocks.getJob).toHaveBeenCalledOnce();
    expect(mocks.saveVersion).not.toHaveBeenCalled();
    expect(current.data.errorMessage).toContain('生成失败');
  });

  it('can still save a valid successful job and prevents navigation after a session change', async () => {
    const current = page();
    await current.load();
    mocks.generate.mockResolvedValue({ workId, jobId });
    mocks.getJob.mockResolvedValue({ jobId, workId, status: 'SUCCEEDED' });
    mocks.saveVersion.mockResolvedValue({ workId, sourceAiJobId: jobId });
    await current.generate({ currentTarget: { dataset: { operation: 'OUTLINE' } } });
    expect(mocks.saveVersion).toHaveBeenCalledWith(workId, jobId);
    expect(current.data.statusText).toContain('新版本已保存');

    current.data.latestBodyId = otherId;
    mocks.token.mockReturnValue('session-b');
    current.createPictureBook();
    current.createAnimation();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
