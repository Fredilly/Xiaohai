import type { StoryOperation, StoryVersion, StoryWork } from '@xiaohai/contracts/story';
import {
  generateStory,
  getStoryJob,
  getStoryWork,
  saveStoryVersion,
  StoryApiError,
} from '../../services/story';
import { consumerToken } from '../../services/consumer-session';

type InputEvent = {
  detail: { value?: string };
};

type PickerEvent = {
  detail: { value?: string | number };
};

const operations: StoryOperation[] = ['OUTLINE', 'BODY', 'REWRITE', 'CONTINUE', 'POLISH'];

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

Page({
  readSequence: 0,
  generationRevision: 0,
  wasHidden: false,
  pageClosed: false,
  workSession: '',
  data: {
    workId: '',
    work: null as StoryWork | null,
    versions: [] as StoryVersion[],
    latestOutlineId: '',
    latestBodyId: '',
    instruction: '',
    pageCountOptions: [10, 11, 12, 13, 14, 15],
    pageCountIndex: 0,
    requestedPageCount: 10,
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

  onShow() {
    const needsRefresh = this.wasHidden;
    this.wasHidden = false;
    if (needsRefresh && this.data.workId) void this.load();
  },
  onHide() {
    this.wasHidden = true;
    this.readSequence++;
    this.workSession = '';
    this.setData({
      work: null,
      versions: [],
      latestOutlineId: '',
      latestBodyId: '',
      instruction: '',
      loading: false,
      statusText: '',
      errorMessage: '',
    });
  },
  onUnload() {
    this.wasHidden = true;
    this.pageClosed = true;
    this.readSequence++;
    this.workSession = '';
  },

  async load() {
    if (this.wasHidden || !this.data.workId) return;
    const sequence = ++this.readSequence;
    const session = consumerToken();
    const workId = this.data.workId;
    this.workSession = '';
    this.setData({
      loading: true,
      work: null,
      versions: [],
      latestOutlineId: '',
      latestBodyId: '',
      errorMessage: '',
    });
    if (!session) {
      this.setData({ loading: false, errorMessage: '请先登录后查看作品' });
      return;
    }
    try {
      const detail = await getStoryWork(workId);
      if (sequence !== this.readSequence || this.wasHidden || workId !== this.data.workId) return;
      if (consumerToken() !== session) {
        this.setData({ loading: false, errorMessage: '登录状态已变化，请重新读取作品' });
        return;
      }
      if (detail.work.id !== workId || detail.versions.some((item) => item.workId !== workId)) {
        throw new Error('STORY_WORK_CONTEXT_MISMATCH');
      }

      const latestOutline = [...detail.versions]
        .reverse()
        .find((version) => version.contentKind === 'OUTLINE');

      const latestBody = [...detail.versions]
        .reverse()
        .find((version) => version.contentKind === 'BODY');

      this.workSession = session;
      this.setData({
        work: detail.work,
        versions: detail.versions,
        latestOutlineId: latestOutline?.id || '',
        latestBodyId: latestBody?.id || '',
        loading: false,
        errorMessage: '',
      });
    } catch {
      if (sequence !== this.readSequence || this.wasHidden || workId !== this.data.workId) return;
      this.setData({
        work: null,
        versions: [],
        loading: false,
        errorMessage:
          consumerToken() === session ? '作品加载失败' : '登录状态已变化，请重新读取作品',
      });
    }
  },

  inputInstruction(event: InputEvent) {
    this.setData({ instruction: String(event.detail.value || '') });
  },

  selectPageCount(event: PickerEvent) {
    const index = Number(event.detail.value ?? 0);
    const requestedPageCount = this.data.pageCountOptions[index] ?? 10;
    this.setData({ pageCountIndex: index, requestedPageCount });
  },

  async generate(event: WechatMiniprogram.TouchEvent) {
    const workId = this.data.workId;
    const session = this.workSession;
    if (
      this.data.generating ||
      this.wasHidden ||
      !this.data.work ||
      !session ||
      session !== consumerToken()
    )
      return;
    const revision = ++this.generationRevision;
    // Once the user has initiated a paid job, leaving the page must not silently
    // abandon its server-side save. Continue only under the original session;
    // all private UI updates additionally require the page to be visible.
    const serverActive = () =>
      this.generationRevision === revision &&
      this.data.workId === workId &&
      consumerToken() === session;
    const viewActive = () =>
      serverActive() && !this.wasHidden && !this.pageClosed && this.workSession === session;
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
      const accepted = await generateStory(workId, {
        operation,
        sourceVersionId,
        instruction: this.data.instruction.trim() || undefined,
        ...(operation === 'BODY' ? { requestedPageCount: this.data.requestedPageCount } : {}),
      });
      if (!serverActive()) return;
      if (accepted.workId !== workId) throw new Error('STORY_JOB_CONTEXT_MISMATCH');

      if (viewActive()) this.setData({ statusText: 'AI 正在创作，请稍候…' });

      const job = await this.waitForJob(accepted.jobId, serverActive);
      if (!serverActive() || !job) return;
      if (job.jobId !== accepted.jobId || job.workId !== workId)
        throw new Error('STORY_JOB_CONTEXT_MISMATCH');

      if (job.status !== 'SUCCEEDED') {
        if (viewActive())
          this.setData({
            statusText: '',
            errorMessage:
              job.status === 'CANCELLED'
                ? '本次生成已取消'
                : `生成失败${job.lastErrorCode ? `：${job.lastErrorCode}` : ''}`,
          });
        return;
      }

      if (viewActive()) this.setData({ statusText: '生成完成，正在保存版本…' });

      const saved = await saveStoryVersion(workId, accepted.jobId);
      if (saved.workId !== workId || saved.sourceAiJobId !== accepted.jobId)
        throw new Error('STORY_SAVE_CONTEXT_MISMATCH');
      if (!serverActive() || !viewActive()) return;
      await this.load();
      if (!viewActive()) return;

      this.setData({
        instruction: '',
        statusText: '新版本已保存',
      });

      void wx.showToast({ title: '新版本已保存', icon: 'success' });
    } catch (error) {
      if (!serverActive() || !viewActive()) return;
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
      if (!this.pageClosed && this.generationRevision === revision) {
        if (!this.wasHidden && this.workSession === session && consumerToken() !== session) {
          this.workSession = '';
          this.setData({
            work: null,
            versions: [],
            latestOutlineId: '',
            latestBodyId: '',
            errorMessage: '登录状态已变化，请重新读取作品',
          });
        }
        this.setData({ generating: false });
      }
    }
  },

  async waitForJob(jobId: string, active: () => boolean) {
    for (let index = 0; index < 60; index += 1) {
      if (!active()) return null;
      const job = await getStoryJob(jobId);
      if (!active()) return null;

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
    if (
      !this.data.latestBodyId ||
      !this.data.work ||
      !this.workSession ||
      this.workSession !== consumerToken() ||
      this.wasHidden
    )
      return;
    void wx.navigateTo({
      url: `/pages/picture-book-create/picture-book-create?workId=${encodeURIComponent(this.data.workId)}&versionId=${encodeURIComponent(this.data.latestBodyId)}&title=${encodeURIComponent(this.data.work.title)}`,
    });
  },
  createAnimation() {
    if (
      !this.data.latestBodyId ||
      !this.data.work ||
      !this.workSession ||
      this.workSession !== consumerToken() ||
      this.wasHidden
    )
      return;
    void wx.navigateTo({
      url: `/pages/animation-create/animation-create?workId=${encodeURIComponent(this.data.workId)}&versionId=${encodeURIComponent(this.data.latestBodyId)}&title=${encodeURIComponent(this.data.work.title)}`,
    });
  },
});
