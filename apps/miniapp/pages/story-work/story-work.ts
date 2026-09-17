import type { StoryOperation, StoryVersion, StoryWork } from '@xiaohai/contracts/story';
import {
  generateStory,
  getStoryJob,
  getStoryWork,
  saveStoryVersion,
  StoryApiError,
} from '../../services/story';

type InputEvent = {
  detail: { value?: string };
};

const operations: StoryOperation[] = ['OUTLINE', 'BODY', 'REWRITE', 'CONTINUE', 'POLISH'];

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

Page({
  data: {
    workId: '',
    work: null as StoryWork | null,
    versions: [] as StoryVersion[],
    latestOutlineId: '',
    latestBodyId: '',
    instruction: '',
    loading: true,
    generating: false,
    statusText: '',
    errorMessage: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const workId = String(query.id || '');
    this.setData({ workId });

    if (workId) void this.load();
    else this.setData({ loading: false, errorMessage: '作品参数无效' });
  },

  async load() {
    try {
      const detail = await getStoryWork(this.data.workId);

      const latestOutline = [...detail.versions]
        .reverse()
        .find((version) => version.contentKind === 'OUTLINE');

      const latestBody = [...detail.versions]
        .reverse()
        .find((version) => version.contentKind === 'BODY');

      this.setData({
        work: detail.work,
        versions: detail.versions,
        latestOutlineId: latestOutline?.id || '',
        latestBodyId: latestBody?.id || '',
        loading: false,
        errorMessage: '',
      });
    } catch {
      this.setData({
        loading: false,
        errorMessage: '作品加载失败',
      });
    }
  },

  inputInstruction(event: InputEvent) {
    this.setData({ instruction: String(event.detail.value || '') });
  },

  async generate(event: WechatMiniprogram.TouchEvent) {
    const rawOperation = String(event.currentTarget.dataset.operation || '');

    if (!operations.includes(rawOperation as StoryOperation)) return;

    const operation = rawOperation as StoryOperation;
    let sourceVersionId: string | undefined;

    if (operation === 'BODY') {
      sourceVersionId = this.data.latestOutlineId || undefined;

      if (!sourceVersionId) {
        void wx.showToast({ title: '请先生成并保存故事大纲', icon: 'none' });
        return;
      }
    }

    if (['REWRITE', 'CONTINUE', 'POLISH'].includes(operation)) {
      sourceVersionId = this.data.latestBodyId || undefined;

      if (!sourceVersionId) {
        void wx.showToast({ title: '请先生成故事正文', icon: 'none' });
        return;
      }
    }

    this.setData({
      generating: true,
      statusText: '正在提交生成任务…',
      errorMessage: '',
    });

    try {
      const accepted = await generateStory(this.data.workId, {
        operation,
        sourceVersionId,
        instruction: this.data.instruction.trim() || undefined,
      });

      this.setData({ statusText: 'AI 正在创作，请稍候…' });

      const job = await this.waitForJob(accepted.jobId);

      if (job.status !== 'SUCCEEDED') {
        this.setData({
          statusText: '',
          errorMessage:
            job.status === 'CANCELLED'
              ? '本次生成已取消'
              : `生成失败${job.lastErrorCode ? `：${job.lastErrorCode}` : ''}`,
        });
        return;
      }

      this.setData({ statusText: '生成完成，正在保存版本…' });

      await saveStoryVersion(this.data.workId, accepted.jobId);
      await this.load();

      this.setData({
        instruction: '',
        statusText: '新版本已保存',
      });

      void wx.showToast({ title: '新版本已保存', icon: 'success' });
    } catch (error) {
      let message = '生成失败，请稍后重试';

      if (error instanceof StoryApiError) {
        if (error.status === 503) {
          message = 'Story AI 当前尚未开启';
        } else if (error.status === 401) {
          message = '登录状态已失效，请重新登录';
        } else if (error.status === 409) {
          message = '当前版本状态不支持这个操作';
        }
      }

      this.setData({ statusText: '', errorMessage: message });
    } finally {
      this.setData({ generating: false });
    }
  },

  async waitForJob(jobId: string) {
    for (let index = 0; index < 60; index += 1) {
      const job = await getStoryJob(jobId);

      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) {
        return job;
      }

      await sleep(1000);
    }

    throw new Error('Story job polling timeout');
  },

  retryLoad() {
    this.setData({ loading: true });
    void this.load();
  },

  createPictureBook() {
    if (!this.data.latestBodyId || !this.data.work) return;
    void wx.navigateTo({
      url: `/pages/picture-book-create/picture-book-create?workId=${encodeURIComponent(this.data.workId)}&versionId=${encodeURIComponent(this.data.latestBodyId)}&title=${encodeURIComponent(this.data.work.title)}`,
    });
  },
  createAnimation() {
    if (!this.data.latestBodyId || !this.data.work) return;
    void wx.navigateTo({
      url: `/pages/animation-create/animation-create?workId=${encodeURIComponent(this.data.workId)}&versionId=${encodeURIComponent(this.data.latestBodyId)}&title=${encodeURIComponent(this.data.work.title)}`,
    });
  },
});
