import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  getAnimation: vi.fn(),
  generatePlan: vi.fn(),
  getJob: vi.fn(),
  applyJob: vi.fn(),
  generateScene: vi.fn(),
  compose: vi.fn(),
}));

vi.mock('../../services/consumer-session', () => ({ consumerToken: mocks.token }));
vi.mock('../../services/animation', () => ({
  getAnimation: mocks.getAnimation,
  generateAnimationPlan: mocks.generatePlan,
  getAnimationJob: mocks.getJob,
  applyAnimationJob: mocks.applyJob,
  generateScene: mocks.generateScene,
  composeAnimation: mocks.compose,
  AnimationApiError: class AnimationApiError extends Error {
    constructor(readonly status: number) {
      super(`Animation API ${status}`);
    }
  },
}));

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const sceneId = '44444444-4444-4444-8444-444444444444';
const generationId = '55555555-5555-4555-8555-555555555555';
const compositionId = '66666666-6666-4666-8666-666666666666';
const detail = {
  animation: { id, title: '动画甲' },
  finalMedia: null,
  characters: [],
  scenes: [],
  compositions: [],
};

type AnimationTestPage = {
  readSequence: number;
  operationRevision: number;
  wasHidden: boolean;
  pageClosed: boolean;
  visibleSession: string;
  data: {
    id: string;
    detail: typeof detail | null;
    loading: boolean;
    busy: boolean;
    polling: boolean;
    canCompose: boolean;
    error: string;
  };
  setData(update: Record<string, unknown>): void;
  load(): Promise<void>;
  onHide(): void;
  onShow(): void;
  onUnload(): void;
  generatePlan(event: { currentTarget: { dataset: { operation: string } } }): Promise<void>;
  generateScene(event: { currentTarget: { dataset: { sceneId: string } } }): Promise<void>;
  compose(): Promise<void>;
};

let definition: AnimationTestPage;
beforeAll(async () => {
  vi.stubGlobal('Page', (value: AnimationTestPage) => {
    definition = value;
  });
  await import('./animation-detail');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockReturnValue('session-a');
  mocks.getAnimation.mockResolvedValue(detail);
});

function page(): AnimationTestPage {
  return {
    ...definition,
    readSequence: 0,
    operationRevision: 0,
    wasHidden: false,
    pageClosed: false,
    visibleSession: '',
    data: { ...definition.data, id, detail: null },
    setData(update) {
      Object.assign(this.data, update);
    },
  };
}

describe('AI animation detail isolation and exact job tracking', () => {
  it('does not offer composition before any scenes exist', async () => {
    const current = page();
    await current.load();
    expect(current.data.canCompose).toBe(false);
    await current.compose();
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('drops a hidden response and refreshes only after returning to the page', async () => {
    let resolveDetail: (value: unknown) => void = () => {};
    mocks.getAnimation.mockImplementationOnce(
      () => new Promise((resolve) => (resolveDetail = resolve)),
    );
    const current = page();
    const pending = current.load();
    current.onHide();
    resolveDetail(detail);
    await pending;
    expect(current.data.detail).toBeNull();
    expect(current.visibleSession).toBe('');
    current.onShow();
    await vi.waitFor(() => expect(current.data.detail?.animation.id).toBe(id));
    expect(mocks.getAnimation).toHaveBeenCalledTimes(2);
  });

  it('does not show an old account animation response after changing sessions', async () => {
    let resolveDetail: (value: unknown) => void = () => {};
    mocks.getAnimation.mockImplementationOnce(
      () => new Promise((resolve) => (resolveDetail = resolve)),
    );
    const current = page();
    const pending = current.load();
    mocks.token.mockReturnValue('session-b');
    resolveDetail(detail);
    await pending;
    expect(current.data.detail).toBeNull();
    expect(current.visibleSession).toBe('');
    expect(current.data.error).toContain('登录状态已变化');
  });

  it('rejects another animation and wrong nested scene/generation ownership', async () => {
    const current = page();
    mocks.getAnimation.mockResolvedValueOnce({
      ...detail,
      animation: { ...detail.animation, id: other },
    });
    await current.load();
    expect(current.data.detail).toBeNull();
    expect(current.data.error).toContain('动画加载失败');

    mocks.getAnimation.mockResolvedValueOnce({
      ...detail,
      scenes: [
        {
          id: sceneId,
          animationId: id,
          generations: [{ id: generationId, animationId: other, sceneId }],
        },
      ],
    });
    await current.load();
    expect(current.data.detail).toBeNull();
    expect(current.visibleSession).toBe('');
  });

  it('does not accept an animation planning job for a different animation', async () => {
    const current = page();
    await current.load();
    mocks.generatePlan.mockResolvedValue({ animationId: other, jobId, operation: 'SCRIPT' });
    await current.generatePlan({ currentTarget: { dataset: { operation: 'SCRIPT' } } });
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.applyJob).not.toHaveBeenCalled();
    expect(current.data.error).toContain('规划生成失败');
  });

  it('can apply a completed planning job after hiding without exposing its detail', async () => {
    const current = page();
    await current.load();
    mocks.generatePlan.mockResolvedValue({ animationId: id, jobId, operation: 'SCRIPT' });
    mocks.getJob.mockResolvedValue({
      animationId: id,
      jobId,
      operation: 'SCRIPT',
      status: 'SUCCEEDED',
    });
    let resolveApply: (value: unknown) => void = () => {};
    mocks.applyJob.mockImplementationOnce(() => new Promise((resolve) => (resolveApply = resolve)));
    const pending = current.generatePlan({ currentTarget: { dataset: { operation: 'SCRIPT' } } });
    await vi.waitFor(() => expect(mocks.applyJob).toHaveBeenCalledOnce());
    current.onHide();
    resolveApply(detail);
    await pending;
    expect(mocks.applyJob).toHaveBeenCalledWith(id, jobId);
    expect(current.data.detail).toBeNull();
    expect(current.data.busy).toBe(false);
  });

  it('stops before applying a job when the login session changes during polling', async () => {
    const current = page();
    await current.load();
    mocks.generatePlan.mockResolvedValue({ animationId: id, jobId, operation: 'SCRIPT' });
    let resolveJob: (value: unknown) => void = () => {};
    mocks.getJob.mockImplementationOnce(() => new Promise((resolve) => (resolveJob = resolve)));
    const pending = current.generatePlan({ currentTarget: { dataset: { operation: 'SCRIPT' } } });
    await vi.waitFor(() => expect(mocks.getJob).toHaveBeenCalledOnce());
    mocks.token.mockReturnValue('session-b');
    resolveJob({ animationId: id, jobId, operation: 'SCRIPT', status: 'SUCCEEDED' });
    await pending;
    expect(mocks.applyJob).not.toHaveBeenCalled();
    expect(current.data.detail).toBeNull();
    expect(current.data.error).toContain('登录状态已变化');
  });

  it('tracks the accepted scene generation rather than a newer failed revision', async () => {
    const current = page();
    const initial = { ...detail, scenes: [{ id: sceneId, animationId: id, generations: [] }] };
    mocks.getAnimation.mockResolvedValueOnce(initial);
    await current.load();
    mocks.generateScene.mockResolvedValue({ animationId: id, sceneId, generationId });
    mocks.getAnimation.mockResolvedValueOnce({
      ...detail,
      scenes: [
        {
          id: sceneId,
          animationId: id,
          generations: [
            { id: generationId, animationId: id, sceneId, status: 'READY' },
            { id: other, animationId: id, sceneId, status: 'FAILED' },
          ],
        },
      ],
    });
    await current.generateScene({ currentTarget: { dataset: { sceneId } } });
    expect(mocks.generateScene).toHaveBeenCalledWith(id, sceneId);
    expect(mocks.getAnimation).toHaveBeenCalledTimes(2);
    expect(current.data.error).toBe('');
  });

  it('stops scene polling after page disposal without issuing a second paid job', async () => {
    const current = page();
    mocks.getAnimation.mockResolvedValueOnce({
      ...detail,
      scenes: [{ id: sceneId, animationId: id, generations: [] }],
    });
    await current.load();
    let resolveAccepted: (value: unknown) => void = () => {};
    mocks.generateScene.mockImplementationOnce(
      () => new Promise((resolve) => (resolveAccepted = resolve)),
    );
    const pending = current.generateScene({ currentTarget: { dataset: { sceneId } } });
    current.onUnload();
    resolveAccepted({ animationId: id, sceneId, generationId });
    await pending;
    expect(mocks.generateScene).toHaveBeenCalledOnce();
    expect(mocks.getAnimation).toHaveBeenCalledOnce();
    expect(current.visibleSession).toBe('');
  });

  it('tracks the accepted composition instead of another later failed composition', async () => {
    const current = page();
    mocks.getAnimation.mockResolvedValueOnce({
      ...detail,
      scenes: [
        {
          id: sceneId,
          animationId: id,
          generations: [{ id: generationId, animationId: id, sceneId, status: 'READY' }],
        },
      ],
    });
    await current.load();
    expect(current.data.canCompose).toBe(true);
    mocks.compose.mockResolvedValue({ animationId: id, compositionId });
    mocks.getAnimation.mockResolvedValueOnce({
      ...detail,
      scenes: [
        {
          id: sceneId,
          animationId: id,
          generations: [{ id: generationId, animationId: id, sceneId, status: 'READY' }],
        },
      ],
      compositions: [
        { id: compositionId, animationId: id, status: 'READY' },
        { id: other, animationId: id, status: 'FAILED' },
      ],
    });
    await current.compose();
    expect(mocks.compose).toHaveBeenCalledWith(id, [generationId]);
    expect(current.data.error).toBe('');
  });
});
