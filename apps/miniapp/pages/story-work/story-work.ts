import type {
  StoryContentKind,
  StoryDraft,
  StoryOperation,
  StoryVersion,
  StoryWork,
} from '@xiaohai/contracts/story';
import {
  confirmStoryDraft,
  createStoryDraftFromJob,
  discardStoryDraft,
  generateStory,
  getStoryJob,
  getStoryWork,
  StoryApiError,
  updateStoryDraft,
} from '../../services/story';

type InputEvent = {
  currentTarget: { dataset: { kind?: string } };
  detail: { value?: string };
};

const operations: StoryOperation[] = ['OUTLINE', 'BODY', 'REWRITE', 'CONTINUE', 'POLISH'];
const isContentKind = (value: string): value is StoryContentKind =>
  value === 'OUTLINE' || value === 'BODY';
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
const lastSavedContent: Record<StoryContentKind, string> = { OUTLINE: '', BODY: '' };

Page({
  data: {
    workId: '',
    work: null as StoryWork | null,
    versions: [] as StoryVersion[],
    outlineDraft: null as StoryDraft | null,
    bodyDraft: null as StoryDraft | null,
    outlineContent: '',
    bodyContent: '',
    latestOutline: null as StoryVersion | null,
    latestBody: null as StoryVersion | null,
    activeTab: 'OUTLINE',
    instruction: '',
    loading: true,
    generating: false,
    savingDraft: false,
    draftSaveFailed: false,
    confirming: false,
    statusText: '',
    draftStatus: '',
    errorMessage: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const workId = String(query.id || '');
    this.setData({ workId });
    if (workId) void this.load();
    else this.setData({ loading: false, errorMessage: '作品参数无效' });
  },

  onUnload() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    const kind = this.data.activeTab === 'OUTLINE' ? 'OUTLINE' : 'BODY';
    if (this.data.activeTab !== 'HISTORY') void this.saveDraft(kind);
  },

  onHide() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    const kind = this.data.activeTab === 'OUTLINE' ? 'OUTLINE' : 'BODY';
    if (this.data.activeTab !== 'HISTORY') void this.saveDraft(kind);
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
      const outlineDraft = detail.drafts.find((draft) => draft.contentKind === 'OUTLINE');
      const bodyDraft = detail.drafts.find((draft) => draft.contentKind === 'BODY');
      const outlineContent = outlineDraft?.content ?? latestOutline?.content ?? '';
      const bodyContent = bodyDraft?.content ?? latestBody?.content ?? '';

      lastSavedContent.OUTLINE = outlineDraft?.content ?? '';
      lastSavedContent.BODY = bodyDraft?.content ?? '';

      this.setData({
        work: detail.work,
        versions: detail.versions,
        outlineDraft: outlineDraft ?? null,
        bodyDraft: bodyDraft ?? null,
        outlineContent,
        bodyContent,
        latestOutline: latestOutline ?? null,
        latestBody: latestBody ?? null,
        activeTab:
          detail.work.creationMode === 'DIRECT_BODY' && this.data.activeTab === 'OUTLINE'
            ? 'BODY'
            : this.data.activeTab,
        loading: false,
        errorMessage: '',
      });
    } catch {
      this.setData({ loading: false, errorMessage: '作品加载失败' });
    }
  },

  switchTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || '');
    if (!['OUTLINE', 'BODY', 'HISTORY'].includes(tab)) return;
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    const previous = this.data.activeTab;
    if (isContentKind(previous)) void this.saveDraft(previous);
    this.setData({ activeTab: tab, draftStatus: '' });
  },

  inputInstruction(event: InputEvent) {
    this.setData({ instruction: String(event.detail.value || '') });
  },

  inputDraft(event: InputEvent) {
    const kind = String(event.currentTarget.dataset.kind || '') as StoryContentKind;
    if (!['OUTLINE', 'BODY'].includes(kind)) return;
    const field = kind === 'OUTLINE' ? 'outlineContent' : 'bodyContent';
    this.setData({
      [field]: String(event.detail.value || ''),
      draftStatus: '正在自动保存…',
      draftSaveFailed: false,
    });
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => void this.saveDraft(kind), 700);
  },

  async saveDraft(kind: StoryContentKind): Promise<StoryDraft | null> {
    draftSaveTimer = null;
    const draft = kind === 'OUTLINE' ? this.data.outlineDraft : this.data.bodyDraft;
    const content = (kind === 'OUTLINE' ? this.data.outlineContent : this.data.bodyContent).trim();
    if (!draft) return null;
    if (!content) {
      this.setData({
        draftStatus: '草稿内容不能为空',
        draftSaveFailed: false,
        errorMessage: kind === 'OUTLINE' ? '请输入大纲内容后再确认' : '请输入正文内容后再确认',
      });
      return null;
    }
    if (content === lastSavedContent[kind]) return draft;

    this.setData({ savingDraft: true, draftStatus: '正在自动保存…', draftSaveFailed: false });
    try {
      const updated = await updateStoryDraft(this.data.workId, kind, content, draft.draftRevision);
      lastSavedContent[kind] = updated.content;
      const contentField = kind === 'OUTLINE' ? 'outlineContent' : 'bodyContent';
      const currentContent = String(this.data[contentField]).trim();
      const hasNewerInput = currentContent !== content;
      this.setData({
        [kind === 'OUTLINE' ? 'outlineDraft' : 'bodyDraft']: updated,
        ...(hasNewerInput ? {} : { [contentField]: updated.content }),
        draftStatus: hasNewerInput ? '正在自动保存…' : '草稿已自动保存',
        draftSaveFailed: false,
      });
      if (hasNewerInput) {
        if (draftSaveTimer) clearTimeout(draftSaveTimer);
        draftSaveTimer = setTimeout(() => void this.saveDraft(kind), 100);
      }
      return updated;
    } catch (error) {
      if (error instanceof StoryApiError && error.code === 'REVISION_CONFLICT') {
        this.setData({
          draftStatus: '',
          draftSaveFailed: false,
          errorMessage: '草稿已在其他设备更新，正在同步最新内容',
        });
        await this.load();
      } else {
        this.setData({
          draftStatus: '自动保存失败，本地内容仍保留',
          draftSaveFailed: true,
          errorMessage: '草稿暂未保存，请检查网络后重试',
        });
      }
      return null;
    } finally {
      this.setData({ savingDraft: false });
    }
  },

  retrySaveDraft() {
    if (this.data.savingDraft || !isContentKind(this.data.activeTab)) return;
    void this.saveDraft(this.data.activeTab);
  },

  async generate(event: WechatMiniprogram.TouchEvent) {
    if (this.data.generating) return;
    const rawOperation = String(event.currentTarget.dataset.operation || '');
    if (!operations.includes(rawOperation as StoryOperation) || !this.data.work) return;

    const operation = rawOperation as StoryOperation;
    let sourceVersionId: string | undefined;
    if (operation === 'OUTLINE' && this.data.work.creationMode !== 'OUTLINE_FIRST') return;
    if (operation === 'BODY' && this.data.work.creationMode === 'OUTLINE_FIRST') {
      sourceVersionId = this.data.latestOutline?.id;
      if (!sourceVersionId) {
        void wx.showToast({ title: '请先确认故事大纲', icon: 'none' });
        return;
      }
    }
    if (['REWRITE', 'CONTINUE', 'POLISH'].includes(operation)) {
      sourceVersionId = this.data.latestBody?.id;
      if (!sourceVersionId) {
        void wx.showToast({ title: '请先确认故事正文', icon: 'none' });
        return;
      }
    }

    this.setData({ generating: true, statusText: '正在提交生成任务…', errorMessage: '' });
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

      this.setData({ statusText: '生成完成，正在建立可编辑草稿…' });
      const draft = await createStoryDraftFromJob(this.data.workId, accepted.jobId);
      await this.load();
      this.setData({
        activeTab: draft.contentKind,
        instruction: '',
        statusText: '草稿已保存，请编辑并确认',
      });
      void wx.showToast({ title: '已生成可编辑草稿', icon: 'success' });
    } catch (error) {
      let message = '生成失败，请稍后重试';
      if (error instanceof StoryApiError) {
        if (error.status === 503) message = 'Story AI 当前尚未开启';
        else if (error.status === 401) message = '登录状态已失效，请重新登录';
        else if (error.status === 409) message = '请先确认或放弃当前草稿';
      }
      this.setData({ statusText: '', errorMessage: message });
    } finally {
      this.setData({ generating: false });
    }
  },

  async confirmDraft(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '') as StoryContentKind;
    if (!['OUTLINE', 'BODY'].includes(kind) || this.data.confirming) return;
    const content = (kind === 'OUTLINE' ? this.data.outlineContent : this.data.bodyContent).trim();
    if (!content) {
      this.setData({
        draftStatus: '草稿内容不能为空',
        draftSaveFailed: false,
        errorMessage: kind === 'OUTLINE' ? '请输入大纲内容后再确认' : '请输入正文内容后再确认',
      });
      return;
    }
    this.setData({ confirming: true, errorMessage: '' });
    try {
      const draft = await this.saveDraft(kind);
      if (!draft) return;
      await confirmStoryDraft(this.data.workId, kind, draft.draftRevision);
      lastSavedContent[kind] = '';
      await this.load();
      this.setData({
        draftStatus: '',
        statusText: kind === 'OUTLINE' ? '大纲已确认' : '正文已确认',
      });
      void wx.showToast({
        title: kind === 'OUTLINE' ? '大纲已确认' : '正文已确认',
        icon: 'success',
      });
    } catch {
      this.setData({ errorMessage: '确认失败，可能草稿已在其他设备更新' });
      await this.load();
    } finally {
      this.setData({ confirming: false });
    }
  },

  async discardDraft(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind || '') as StoryContentKind;
    const draft = kind === 'OUTLINE' ? this.data.outlineDraft : this.data.bodyDraft;
    if (!draft) return;
    const result = await wx.showModal({ title: '放弃草稿？', content: '未确认的修改将无法恢复。' });
    if (!result.confirm) return;
    try {
      await discardStoryDraft(this.data.workId, kind, draft.draftRevision);
      lastSavedContent[kind] = '';
      await this.load();
      this.setData({ draftStatus: '', statusText: '未确认草稿已放弃' });
    } catch {
      this.setData({ errorMessage: '草稿状态已变化，请重试' });
      await this.load();
    }
  },

  async waitForJob(jobId: string) {
    for (let index = 0; index < 150; index += 1) {
      const job = await getStoryJob(jobId);
      if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) return job;
      await sleep(1000);
    }
    throw new Error('Story job polling timeout');
  },

  retryLoad() {
    this.setData({ loading: true });
    void this.load();
  },

  createPictureBook() {
    if (!this.data.latestBody || !this.data.work) return;
    void wx.navigateTo({
      url: `/pages/picture-book-create/picture-book-create?workId=${encodeURIComponent(this.data.workId)}&versionId=${encodeURIComponent(this.data.latestBody.id)}&title=${encodeURIComponent(this.data.work.title)}`,
    });
  },

  createAnimation() {
    if (!this.data.latestBody || !this.data.work) return;
    void wx.navigateTo({
      url: `/pages/animation-create/animation-create?workId=${encodeURIComponent(this.data.workId)}&versionId=${encodeURIComponent(this.data.latestBody.id)}&title=${encodeURIComponent(this.data.work.title)}`,
    });
  },
});
