import type {
  PictureBookDetail,
  PictureBookPage,
  PictureBookTextOperation,
} from '@xiaohai/contracts/picture-book';
import {
  applyPictureBookJob,
  generateIllustration,
  generatePictureBookPlan,
  getPictureBook,
  getPictureBookJob,
  PictureBookApiError,
} from '../../services/picture-book';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

Page({
  data: {
    id: '',
    detail: null as PictureBookDetail | null,
    loading: true,
    busy: false,
    polling: false,
    error: '',
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: String(query.id || '') });
    if (this.data.id) void this.load();
    else this.setData({ loading: false, error: '绘本参数无效' });
  },
  onUnload() {
    this.setData({ polling: false });
  },
  async load() {
    try {
      this.setData({ detail: await getPictureBook(this.data.id), error: '' });
    } catch {
      this.setData({ error: '绘本加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },
  async generatePlan(event: WechatMiniprogram.TouchEvent) {
    const operation = String(event.currentTarget.dataset.operation) as PictureBookTextOperation;
    this.setData({ busy: true, error: '' });
    try {
      const accepted = await generatePictureBookPlan(this.data.id, operation);
      for (let index = 0; index < 90; index += 1) {
        const job = await getPictureBookJob(accepted.jobId);
        if (job.status === 'SUCCEEDED') {
          this.setData({ detail: await applyPictureBookJob(this.data.id, job.jobId) });
          return;
        }
        if (job.status === 'FAILED' || job.status === 'CANCELLED') {
          throw new Error(job.lastErrorCode || job.status);
        }
        await sleep(1000);
      }
      throw new Error('polling timeout');
    } catch (error) {
      this.setData({
        error:
          error instanceof PictureBookApiError && error.status === 503
            ? 'AI 功能未开启（安全关闭）'
            : '生成失败，请稍后重试。',
      });
    } finally {
      this.setData({ busy: false });
    }
  },
  async illustrate(event: WechatMiniprogram.TouchEvent) {
    const pageId = String(event.currentTarget.dataset.pageId || '');
    const regenerate = String(event.currentTarget.dataset.regenerate || '') === 'true';
    if (!pageId) return;
    this.setData({ busy: true, error: '' });
    try {
      await generateIllustration(this.data.id, pageId, regenerate);
      this.setData({ polling: true });
      for (let index = 0; index < 90 && this.data.polling; index += 1) {
        const detail = await getPictureBook(this.data.id);
        this.setData({ detail });
        const page = detail.pages.find((item: PictureBookPage) => item.id === pageId);
        const latest = page?.illustrations[page.illustrations.length - 1];
        if (latest && ['READY', 'FAILED'].includes(latest.status)) return;
        await sleep(1000);
      }
    } catch (error) {
      this.setData({
        error:
          error instanceof PictureBookApiError && error.status === 503
            ? '图片生成未开启（安全关闭）'
            : '插画任务失败，请稍后重试。',
      });
    } finally {
      this.setData({ busy: false, polling: false });
    }
  },
});
