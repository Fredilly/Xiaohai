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

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

Page({
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
  onUnload() {
    this.setData({ polling: false });
  },
  async load() {
    try {
      const detail = await getAnimation(this.data.id);
      this.setData({
        detail,
        canCompose: this.readyGenerationIds(detail).length === detail.scenes.length,
        error: '',
      });
    } catch (error) {
      this.setData({ error: this.message(error, '动画加载失败') });
    } finally {
      this.setData({ loading: false });
    }
  },
  async generatePlan(event: WechatMiniprogram.TouchEvent) {
    const operation = String(event.currentTarget.dataset.operation) as AnimationPlanningOperation;
    this.setData({ busy: true, error: '' });
    try {
      const accepted = await generateAnimationPlan(this.data.id, operation);
      this.setData({ polling: true });
      for (let index = 0; index < 90 && this.data.polling; index += 1) {
        const job = await getAnimationJob(accepted.jobId);
        if (job.status === 'SUCCEEDED') {
          const detail = await applyAnimationJob(this.data.id, job.jobId);
          this.setData({ detail, canCompose: false });
          return;
        }
        if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(job.status);
        await sleep(1000);
      }
      throw new Error('polling timeout');
    } catch (error) {
      this.setData({ error: this.message(error, '规划生成失败，请稍后重试。') });
    } finally {
      this.setData({ busy: false, polling: false });
    }
  },
  async generateScene(event: WechatMiniprogram.TouchEvent) {
    const sceneId = String(event.currentTarget.dataset.sceneId || '');
    if (!sceneId) return;
    this.setData({ busy: true, polling: true, error: '' });
    try {
      await generateScene(this.data.id, sceneId);
      await this.pollDetail((detail) => {
        const scene = detail.scenes.find((item) => item.id === sceneId);
        const latest = scene?.generations[scene.generations.length - 1];
        return Boolean(latest && ['READY', 'FAILED', 'CANCELLED'].includes(latest.status));
      });
    } catch (error) {
      this.setData({ error: this.message(error, '场景生成失败，请稍后重试。') });
    } finally {
      this.setData({ busy: false, polling: false });
    }
  },
  async compose() {
    const detail = this.data.detail;
    if (!detail) return;
    const ids = this.readyGenerationIds(detail);
    if (ids.length !== detail.scenes.length) return;
    this.setData({ busy: true, polling: true, error: '' });
    try {
      await composeAnimation(this.data.id, ids);
      await this.pollDetail((next) => {
        const latest = next.compositions[next.compositions.length - 1];
        return Boolean(latest && ['READY', 'FAILED', 'CANCELLED'].includes(latest.status));
      });
    } catch (error) {
      this.setData({ error: this.message(error, '合成失败，请稍后重试。') });
    } finally {
      this.setData({ busy: false, polling: false });
    }
  },
  async pollDetail(done: (detail: AnimationDetail) => boolean) {
    for (let index = 0; index < 120 && this.data.polling; index += 1) {
      const detail = await getAnimation(this.data.id);
      this.setData({
        detail,
        canCompose: this.readyGenerationIds(detail).length === detail.scenes.length,
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
