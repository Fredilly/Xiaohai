import type {
  AnimationDetail,
  AnimationPlanningOperation,
  AnimationScene,
} from '@xiaohai/contracts/animation';
import {
  AnimationApiError,
  applyAnimationJob,
  composeAnimation,
  generateAnimationPlan,
  generateScene,
  getAnimation,
  getAnimationJob,
} from '../../services/animation';
import { consumerToken } from '../../services/consumer-session';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function assertAnimationDetailContext(detail: AnimationDetail, id: string): AnimationDetail {
  if (
    detail.animation.id !== id ||
    detail.characters.some((character) => character.animationId !== id) ||
    detail.scenes.some(
      (scene) =>
        scene.animationId !== id ||
        scene.generations.some(
          (generation) => generation.animationId !== id || generation.sceneId !== scene.id,
        ),
    ) ||
    detail.compositions.some((composition) => composition.animationId !== id)
  ) {
    throw new Error('ANIMATION_DETAIL_CONTEXT_MISMATCH');
  }
  return detail;
}

Page({
  readSequence: 0,
  operationRevision: 0,
  wasHidden: false,
  pageClosed: false,
  visibleSession: '',
  data: {
    id: '',
    detail: null as AnimationDetail | null,
    loading: true,
    busy: false,
    polling: false,
    error: '',
    canCompose: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: String(query.id || '') });
    if (this.data.id) void this.load();
    else this.setData({ loading: false, error: '动画参数无效' });
  },
  onShow() {
    const needsRefresh = this.wasHidden;
    this.wasHidden = false;
    if (needsRefresh && !this.pageClosed && this.data.id) void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.visibleSession = '';
    this.setData({ detail: null, canCompose: false, error: '' });
  },
  onUnload() {
    this.wasHidden = true;
    this.pageClosed = true;
    this.readSequence++;
    this.visibleSession = '';
  },
  async load() {
    if (this.wasHidden || this.pageClosed || !this.data.id) return;
    const sequence = ++this.readSequence;
    const id = this.data.id;
    const session = consumerToken();
    this.visibleSession = '';
    this.setData({ loading: true, detail: null, canCompose: false, error: '' });
    if (!session) {
      this.setData({ loading: false, error: '请先登录后查看动画' });
      return;
    }
    try {
      const detail = assertAnimationDetailContext(await getAnimation(id), id);
      if (sequence !== this.readSequence || this.wasHidden || this.pageClosed) return;
      if (id !== this.data.id || consumerToken() !== session) {
        this.setData({ detail: null, error: '登录状态已变化，请重新读取动画' });
        return;
      }
      this.visibleSession = session;
      this.setData({
        detail,
        canCompose:
          detail.scenes.length > 0 &&
          this.readyGenerationIds(detail).length === detail.scenes.length,
        error: '',
      });
    } catch (error) {
      if (sequence !== this.readSequence || this.wasHidden || this.pageClosed) return;
      this.setData({
        detail: null,
        error:
          consumerToken() === session
            ? this.message(error, '动画加载失败')
            : '登录状态已变化，请重新读取动画',
      });
    } finally {
      if (sequence === this.readSequence && !this.wasHidden && !this.pageClosed)
        this.setData({ loading: false });
    }
  },
  async generatePlan(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || this.wasHidden || !session || session !== consumerToken()) return;
    const operation = String(event.currentTarget.dataset.operation) as AnimationPlanningOperation;
    if (operation !== 'SCRIPT' && operation !== 'STORYBOARD') return;
    const revision = ++this.operationRevision;
    const serverActive = () =>
      this.operationRevision === revision && this.data.id === id && consumerToken() === session;
    const viewActive = () =>
      serverActive() && !this.wasHidden && !this.pageClosed && this.visibleSession === session;
    this.setData({ busy: true, error: '' });
    try {
      const accepted = await generateAnimationPlan(id, operation);
      if (!serverActive()) return;
      if (accepted.animationId !== id || accepted.operation !== operation)
        throw new Error('ANIMATION_JOB_CONTEXT_MISMATCH');
      if (viewActive()) this.setData({ polling: true });
      for (let index = 0; index < 90 && serverActive(); index += 1) {
        const job = await getAnimationJob(accepted.jobId);
        if (!serverActive()) return;
        if (job.animationId !== id || job.jobId !== accepted.jobId || job.operation !== operation)
          throw new Error('ANIMATION_JOB_CONTEXT_MISMATCH');
        if (job.status === 'SUCCEEDED') {
          const detail = assertAnimationDetailContext(await applyAnimationJob(id, job.jobId), id);
          if (viewActive()) this.setData({ detail, canCompose: false });
          return;
        }
        if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(job.status);
        await sleep(1000);
      }
      throw new Error('polling timeout');
    } catch (error) {
      if (viewActive()) this.setData({ error: this.message(error, '规划生成失败，请稍后重试。') });
    } finally {
      if (!this.pageClosed && this.operationRevision === revision) {
        if (!this.wasHidden && this.visibleSession === session && consumerToken() !== session) {
          this.visibleSession = '';
          this.setData({
            detail: null,
            canCompose: false,
            error: '登录状态已变化，请重新读取动画',
          });
        }
        this.setData({ busy: false, polling: false });
      }
    }
  },
  async generateScene(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || this.wasHidden || !session || session !== consumerToken()) return;
    const sceneId = String(event.currentTarget.dataset.sceneId || '');
    if (!sceneId || !this.data.detail?.scenes.some((scene) => scene.id === sceneId)) return;
    const revision = ++this.operationRevision;
    const serverActive = () =>
      !this.pageClosed &&
      this.operationRevision === revision &&
      this.data.id === id &&
      consumerToken() === session;
    const viewActive = () =>
      serverActive() && !this.wasHidden && !this.pageClosed && this.visibleSession === session;
    this.setData({ busy: true, polling: true, error: '' });
    try {
      const accepted = await generateScene(id, sceneId);
      if (!serverActive()) return;
      if (accepted.animationId !== id || accepted.sceneId !== sceneId)
        throw new Error('ANIMATION_SCENE_CONTEXT_MISMATCH');
      await this.pollDetail(
        (detail) => {
          const scene = detail.scenes.find((item) => item.id === sceneId);
          const generation = scene?.generations.find((item) => item.id === accepted.generationId);
          if (generation?.status === 'FAILED' || generation?.status === 'CANCELLED')
            throw new Error('Scene generation failed');
          return generation?.status === 'READY';
        },
        serverActive,
        viewActive,
      );
    } catch (error) {
      if (viewActive()) this.setData({ error: this.message(error, '场景生成失败，请稍后重试。') });
    } finally {
      if (!this.pageClosed && this.operationRevision === revision) {
        if (!this.wasHidden && this.visibleSession === session && consumerToken() !== session) {
          this.visibleSession = '';
          this.setData({
            detail: null,
            canCompose: false,
            error: '登录状态已变化，请重新读取动画',
          });
        }
        this.setData({ busy: false, polling: false });
      }
    }
  },
  async compose() {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || this.wasHidden || !session || session !== consumerToken()) return;
    const detail = this.data.detail;
    if (!detail || detail.animation.id !== id) return;
    if (detail.scenes.length === 0) return;
    const ids = this.readyGenerationIds(detail);
    if (ids.length !== detail.scenes.length) return;
    const revision = ++this.operationRevision;
    const serverActive = () =>
      !this.pageClosed &&
      this.operationRevision === revision &&
      this.data.id === id &&
      consumerToken() === session;
    const viewActive = () =>
      serverActive() && !this.wasHidden && !this.pageClosed && this.visibleSession === session;
    this.setData({ busy: true, polling: true, error: '' });
    try {
      const accepted = await composeAnimation(id, ids);
      if (!serverActive()) return;
      if (accepted.animationId !== id) throw new Error('ANIMATION_COMPOSITION_CONTEXT_MISMATCH');
      await this.pollDetail(
        (next) => {
          const composition = next.compositions.find((item) => item.id === accepted.compositionId);
          if (composition?.status === 'FAILED' || composition?.status === 'CANCELLED')
            throw new Error('Composition failed');
          return composition?.status === 'READY';
        },
        serverActive,
        viewActive,
      );
    } catch (error) {
      if (viewActive()) this.setData({ error: this.message(error, '合成失败，请稍后重试。') });
    } finally {
      if (!this.pageClosed && this.operationRevision === revision) {
        if (!this.wasHidden && this.visibleSession === session && consumerToken() !== session) {
          this.visibleSession = '';
          this.setData({
            detail: null,
            canCompose: false,
            error: '登录状态已变化，请重新读取动画',
          });
        }
        this.setData({ busy: false, polling: false });
      }
    }
  },
  async pollDetail(
    done: (detail: AnimationDetail) => boolean,
    serverActive: () => boolean,
    viewActive: () => boolean,
  ) {
    const id = this.data.id;
    for (let index = 0; index < 120 && serverActive(); index += 1) {
      const detail = assertAnimationDetailContext(await getAnimation(id), id);
      if (!serverActive()) return;
      if (viewActive())
        this.setData({
          detail,
          canCompose:
            detail.scenes.length > 0 &&
            this.readyGenerationIds(detail).length === detail.scenes.length,
        });
      if (done(detail)) return;
      await sleep(1000);
    }
    throw new Error('polling timeout');
  },
  readyGenerationIds(detail: AnimationDetail) {
    return detail.scenes.flatMap((scene: AnimationScene) => {
      const ready = [...scene.generations]
        .reverse()
        .find((generation) => generation.status === 'READY');
      return ready ? [ready.id] : [];
    });
  },
  message(error: unknown, fallback: string) {
    if (!(error instanceof AnimationApiError)) return fallback;
    if (error.status === 401) return '登录状态已失效，请重新登录。';
    if (error.status === 404) return '动画不存在或无权访问。';
    if (error.status === 409) return '当前状态不支持此操作，或已达到服务端限额。';
    if (error.status === 503) return '对应 AI 能力未启用（安全关闭）。';
    return fallback;
  },
});
