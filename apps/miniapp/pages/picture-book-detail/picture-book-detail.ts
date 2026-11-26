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
  updatePictureBookCharacter,
  confirmPictureBookCharacters,
  reopenPictureBookCharacters,
  generateCharacterReference,
  listCharacterReferences,
  selectCharacterReference,
} from '../../services/picture-book';
import { consumerToken } from '../../services/consumer-session';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// Worker enforces a 600s minimum image deadline; keep UI polling beyond it without retrying.
const IMAGE_POLL_TIMEOUT_MS = 620_000;
const IMAGE_POLL_INTERVAL_MS = 1_000;

type PlaybackReference = { playbackUrl: string | null };

export function assertPictureBookDetailContext(
  detail: PictureBookDetail,
  id: string,
): PictureBookDetail {
  if (
    detail.pictureBook.id !== id ||
    detail.characters.some((character) => character.pictureBookId !== id) ||
    detail.pages.some(
      (page) =>
        page.pictureBookId !== id ||
        page.illustrations.some((illustration) => illustration.pageId !== page.id),
    )
  )
    throw new Error('PICTURE_BOOK_DETAIL_CONTEXT_MISMATCH');
  return detail;
}

function playbackUrls(
  detail: PictureBookDetail | null,
  references: Record<string, PlaybackReference[]>,
): string[] {
  return [
    ...(detail?.pages.flatMap((page) =>
      page.illustrations.map((revision) => revision.playbackUrl),
    ) ?? []),
    ...Object.values(references).flatMap((items) => items.map((item) => item.playbackUrl)),
  ]
    .filter((url): url is string => Boolean(url))
    .sort();
}

Page({
  data: {
    id: '',
    detail: null as PictureBookDetail | null,
    references: {},
    characterBibleConfirmed: false,
    loading: true,
    busy: false,
    polling: false,
    error: '',
    imageError: false,
    planNeedsReview: false,
  },
  // A short-lived BOS GET signature must be reissued by the owned read API,
  // not logged, cached locally, or regenerated using a paid AI endpoint.
  refreshAfterHide: false,
  pageClosed: false,
  loadRevision: 0,
  planRevision: 0,
  planPendingSession: '',
  planNeedsReview: false,
  planReviewSession: '',
  visibleSession: '',
  active(session: string, id: string) {
    return Boolean(
      session &&
      !this.pageClosed &&
      !this.refreshAfterHide &&
      this.visibleSession === session &&
      consumerToken() === session &&
      this.data.id === id &&
      this.data.detail?.pictureBook.id === id,
    );
  },
  clearPrivate(error = '') {
    this.visibleSession = '';
    this.setData({
      detail: null,
      references: {},
      characterBibleConfirmed: false,
      imageError: false,
      busy: false,
      polling: false,
      error,
    });
  },
  clearIfSessionChanged(session: string) {
    if (
      !this.pageClosed &&
      !this.refreshAfterHide &&
      this.visibleSession === session &&
      consumerToken() !== session
    )
      this.clearPrivate('登录状态已变化，请重新读取绘本。');
  },
  onHide() {
    this.refreshAfterHide = true;
    this.loadRevision += 1;
    this.pollingToken += 1;
    this.clearPrivate();
  },
  onShow() {
    if (!this.refreshAfterHide || !this.data.id || this.pageClosed) return;
    this.refreshAfterHide = false;
    void this.load();
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: String(query.id || '') });
    if (this.data.id) void this.load();
    else this.setData({ loading: false, error: '绘本参数无效' });
  },
  onUnload() {
    this.pageClosed = true;
    this.loadRevision += 1;
    this.pollingToken += 1;
    this.clearPrivate();
  },
  onImageError() {
    // WeChat image error strings can include signed bearer URLs; never log them.
    if (this.active(this.visibleSession, this.data.id)) this.setData({ imageError: true });
  },
  pollingToken: 0,
  async load() {
    if (this.pageClosed || this.refreshAfterHide || !this.data.id) return;
    const revision = ++this.loadRevision;
    const session = consumerToken();
    const id = this.data.id;
    if (this.planReviewSession && this.planReviewSession !== session) {
      this.planNeedsReview = false;
      this.planReviewSession = '';
    }
    // Keep the last visible image failure during a same-session manual refresh.
    // On hide/account change the private content (including bearer URLs) is discarded.
    const previousUrls =
      session && session === this.visibleSession
        ? playbackUrls(this.data.detail, this.data.references)
        : [];
    const previousImageError = Boolean(
      session && session === this.visibleSession && this.data.imageError,
    );
    this.clearPrivate();
    this.setData({ loading: true });
    if (!session) {
      this.setData({ loading: false, error: '请先登录后查看绘本。' });
      return;
    }
    try {
      const detail = assertPictureBookDetailContext(await getPictureBook(id), id);
      const references = await Promise.all(
        detail.characters.map(async (character) => {
          try {
            return {
              characterId: character.characterId,
              items: (await listCharacterReferences(id, character.characterId)).references,
              unavailable: false,
            };
          } catch (error) {
            // Reference thumbnails must not make the owned book unreadable on a
            // transient failure, but an auth denial must still hide its content.
            if (
              error instanceof PictureBookApiError &&
              (error.status === 401 || error.status === 403)
            ) {
              throw error;
            }
            return { characterId: character.characterId, items: [], unavailable: true };
          }
        }),
      );
      if (this.pageClosed || this.refreshAfterHide || revision !== this.loadRevision) return;
      if (consumerToken() !== session || this.data.id !== id) {
        this.setData({ error: '登录状态已变化，请重新读取绘本。' });
        return;
      }
      const freshReferences = Object.fromEntries(
        references.map(({ characterId, items }) => [characterId, items]),
      );
      const freshUrls = playbackUrls(detail, freshReferences);
      const urlChanged =
        previousUrls.length !== freshUrls.length ||
        previousUrls.some((url, index) => url !== freshUrls[index]);
      const referencesUnavailable = references.some((item) => item.unavailable);
      this.visibleSession = session;
      this.setData({
        detail,
        planNeedsReview: this.planNeedsReview,
        references: freshReferences,
        imageError: previousImageError && (!urlChanged || referencesUnavailable),
        characterBibleConfirmed:
          detail.characters.length > 0 &&
          detail.characters.every((character) => character.confirmed && character.locked),
        error: this.planNeedsReview
          ? '上次规划结果尚未确认，请先核对绘本状态，勿重复提交。'
          : referencesUnavailable
            ? '部分角色参考图未加载，绘本内容仍可查看；请刷新状态重试。'
            : '',
      });
    } catch (error) {
      if (!this.pageClosed && !this.refreshAfterHide && revision === this.loadRevision) {
        if (consumerToken() !== session) {
          this.setData({ error: '登录状态已变化，请重新读取绘本。' });
          return;
        }
        if (
          error instanceof PictureBookApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          this.setData({
            detail: null,
            references: {},
            characterBibleConfirmed: false,
            imageError: false,
            error: '登录状态已失效，请重新登录后查看绘本。',
          });
        } else {
          this.setData({ error: '绘本加载失败' });
        }
      }
    } finally {
      if (!this.pageClosed && !this.refreshAfterHide && revision === this.loadRevision)
        this.setData({ loading: false });
    }
  },
  async reference(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || !this.active(session, id)) return;
    const characterId = String(event.currentTarget.dataset.characterId || '');
    if (
      !characterId ||
      !this.data.detail?.characters.some((item) => item.characterId === characterId)
    )
      return;
    this.setData({ busy: true, error: '' });
    const pollingToken = ++this.pollingToken;
    let acceptedByServer = false;
    try {
      const accepted = await generateCharacterReference(id, characterId);
      acceptedByServer = true;
      this.clearIfSessionChanged(session);
      if (pollingToken !== this.pollingToken || !this.active(session, id)) return;
      if (accepted.pictureBookId !== id || accepted.characterId !== characterId)
        throw new Error('REFERENCE_CONTEXT_MISMATCH');
      this.setData({ polling: true });
      const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
      while (
        Date.now() < deadline &&
        this.data.polling &&
        pollingToken === this.pollingToken &&
        this.active(session, id)
      ) {
        const result = (await listCharacterReferences(id, characterId)).references;
        this.clearIfSessionChanged(session);
        if (pollingToken !== this.pollingToken || !this.active(session, id)) return;
        this.setData({ [`references.${characterId}`]: result });
        const revision = result.find((item) => item.id === accepted.referenceRevisionId);
        if (revision?.status === 'READY') {
          await this.load();
          return;
        }
        if (revision?.status === 'FAILED') {
          this.setData({
            error: `参考图生成失败（${revision.errorCode || 'REFERENCE_GENERATION_FAILED'}）`,
          });
          return;
        }
        await sleep(IMAGE_POLL_INTERVAL_MS);
      }
      if (pollingToken === this.pollingToken && this.data.polling && this.active(session, id)) {
        this.setData({ error: '参考图仍在后台处理中，请稍后返回绘本查看最新状态。' });
      }
    } catch (error) {
      this.clearIfSessionChanged(session);
      if (pollingToken === this.pollingToken && this.active(session, id)) {
        this.setData({
          error:
            error instanceof PictureBookApiError && error.status === 503 && !acceptedByServer
              ? '参考图生成未开启（安全关闭）'
              : acceptedByServer
                ? '参考图状态查询失败，请稍后查看任务结果。'
                : '参考图请求状态未确认，请稍后查看任务结果。',
        });
      }
    } finally {
      if (pollingToken === this.pollingToken && this.active(session, id)) {
        this.setData({ busy: false, polling: false });
      }
    }
  },
  async selectReference(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || !this.active(session, id)) return;
    const characterId = String(event.currentTarget.dataset.characterId || '');
    const revisionId = String(event.currentTarget.dataset.revisionId || '');
    if (
      !characterId ||
      !revisionId ||
      !this.data.detail?.characters.some((item) => item.characterId === characterId)
    )
      return;
    this.setData({ busy: true, error: '' });
    try {
      const detail = assertPictureBookDetailContext(
        await selectCharacterReference(id, characterId, revisionId),
        id,
      );
      this.clearIfSessionChanged(session);
      if (!this.active(session, id)) return;
      this.setData({ detail });
      await this.load();
    } catch {
      this.clearIfSessionChanged(session);
      if (this.active(session, id)) this.setData({ error: '参考图选择失败，请重试。' });
    } finally {
      if (this.active(session, id)) this.setData({ busy: false });
    }
  },
  async generatePlan(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (
      this.data.busy ||
      this.planNeedsReview ||
      this.planPendingSession === session ||
      !this.active(session, id)
    )
      return;
    const detail = this.data.detail;
    if (
      !detail ||
      detail.characters.length === 0 ||
      detail.characters.some((character) => !character.confirmed || !character.locked)
    ) {
      this.setData({ error: '请先保存并确认角色设定' });
      return;
    }
    const operation = String(event.currentTarget.dataset.operation) as PictureBookTextOperation;
    if (operation !== 'CHARACTERS' && operation !== 'STORYBOARD') return;
    const revision = ++this.planRevision;
    const serverActive = () =>
      this.planRevision === revision && this.data.id === id && consumerToken() === session;
    const viewActive = () => serverActive() && this.active(session, id);
    this.planPendingSession = session;
    let acceptedByServer = false;
    let jobFailed = false;
    let applied = false;
    this.setData({ busy: true, error: '' });
    try {
      const accepted = await generatePictureBookPlan(id, operation);
      if (!serverActive()) return;
      acceptedByServer = true;
      if (accepted.pictureBookId !== id || accepted.operation !== operation)
        throw new Error('PICTURE_BOOK_PLAN_CONTEXT_MISMATCH');
      for (let index = 0; index < 90 && serverActive(); index += 1) {
        const job = await getPictureBookJob(accepted.jobId);
        if (!serverActive()) return;
        if (job.pictureBookId !== id || job.jobId !== accepted.jobId || job.operation !== operation)
          throw new Error('PICTURE_BOOK_JOB_CONTEXT_MISMATCH');
        if (job.status === 'SUCCEEDED') {
          const next = assertPictureBookDetailContext(await applyPictureBookJob(id, job.jobId), id);
          applied = true;
          if (viewActive()) this.setData({ detail: next });
          return;
        }
        if (job.status === 'FAILED' || job.status === 'CANCELLED') {
          jobFailed = true;
          throw new Error(job.lastErrorCode || job.status);
        }
        await sleep(1000);
      }
      throw new Error('polling timeout');
    } catch (error) {
      if (acceptedByServer && !applied && !jobFailed) {
        this.planNeedsReview = true;
        this.planReviewSession = session;
      }
      this.clearIfSessionChanged(session);
      if (viewActive())
        this.setData({
          planNeedsReview: this.planNeedsReview,
          error: this.planNeedsReview
            ? '规划结果尚未确认，请先核对绘本状态，勿重复提交。'
            : error instanceof PictureBookApiError && error.status === 503
              ? 'AI 功能未开启（安全关闭）'
              : '生成失败，请稍后重试。',
        });
    } finally {
      if (this.planRevision === revision) this.planPendingSession = '';
      this.clearIfSessionChanged(session);
      if (viewActive()) this.setData({ busy: false });
    }
  },
  editCharacterField(event: {
    currentTarget: { dataset: Record<string, string> };
    detail: { value?: string };
  }) {
    const index = Number(event.currentTarget.dataset.index);
    const field = String(event.currentTarget.dataset.field) as
      'name' | 'description' | 'canonicalVisualPrompt';
    const value = String(event.detail.value || '');
    if (!['name', 'description', 'canonicalVisualPrompt'].includes(field)) return;
    if (!this.active(this.visibleSession, this.data.id)) return;
    const detail = this.data.detail;
    if (!detail || detail.characters[index]?.locked) return;
    const characters = detail.characters.map((character, characterIndex) =>
      characterIndex === index ? { ...character, [field]: value } : character,
    );
    this.setData({ detail: { ...detail, characters } });
  },
  async saveCharacter(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (!this.active(session, id)) return;
    const index = Number(event.currentTarget.dataset.index);
    const character = this.data.detail?.characters[index];
    if (this.data.busy || !character || character.locked) return;
    this.setData({ busy: true, error: '' });
    try {
      const detail = assertPictureBookDetailContext(
        await updatePictureBookCharacter(id, character.characterId, {
          name: character.name,
          description: character.description,
          canonicalVisualPrompt: character.canonicalVisualPrompt,
        }),
        id,
      );
      this.clearIfSessionChanged(session);
      if (this.active(session, id)) this.setData({ detail });
    } catch {
      this.clearIfSessionChanged(session);
      if (this.active(session, id)) this.setData({ error: '角色设定保存失败，请重试。' });
    } finally {
      if (this.active(session, id)) this.setData({ busy: false });
    }
  },
  async confirmCharacters() {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || !this.active(session, id)) return;
    this.setData({ busy: true, error: '' });
    try {
      const detail = assertPictureBookDetailContext(await confirmPictureBookCharacters(id), id);
      this.clearIfSessionChanged(session);
      if (this.active(session, id))
        this.setData({
          detail,
          characterBibleConfirmed:
            detail.characters.length > 0 &&
            detail.characters.every((item) => item.confirmed && item.locked),
        });
    } catch {
      this.clearIfSessionChanged(session);
      if (this.active(session, id)) this.setData({ error: '角色设定确认失败，请重试。' });
    } finally {
      if (this.active(session, id)) this.setData({ busy: false });
    }
  },
  async reopenCharacters() {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || !this.active(session, id)) return;
    this.setData({ busy: true, error: '' });
    try {
      const detail = assertPictureBookDetailContext(await reopenPictureBookCharacters(id), id);
      this.clearIfSessionChanged(session);
      if (this.active(session, id)) this.setData({ detail, characterBibleConfirmed: false });
    } catch {
      this.clearIfSessionChanged(session);
      if (this.active(session, id)) this.setData({ error: '重新编辑角色设定失败，请重试。' });
    } finally {
      if (this.active(session, id)) this.setData({ busy: false });
    }
  },
  openPreview() {
    if (!this.active(this.visibleSession, this.data.id) || !this.data.detail?.pages.length) return;
    void wx.navigateTo({
      url: `/pages/picture-book-preview/picture-book-preview?id=${encodeURIComponent(this.data.id)}`,
    });
  },
  async illustrate(event: WechatMiniprogram.TouchEvent) {
    const id = this.data.id;
    const session = this.visibleSession;
    if (this.data.busy || !this.active(session, id)) return;
    const pageId = String(event.currentTarget.dataset.pageId || '');
    const regenerate = String(event.currentTarget.dataset.regenerate || '') === 'true';
    if (!pageId || !this.data.detail?.pages.some((page) => page.id === pageId)) return;
    this.setData({ busy: true, error: '' });
    const pollingToken = ++this.pollingToken;
    let acceptedByServer = false;
    let failedErrorCode: string | null = null;
    try {
      const accepted = await generateIllustration(id, pageId, regenerate);
      acceptedByServer = true;
      this.clearIfSessionChanged(session);
      if (pollingToken !== this.pollingToken || !this.active(session, id)) return;
      if (accepted.pictureBookId !== id || accepted.pageId !== pageId)
        throw new Error('ILLUSTRATION_CONTEXT_MISMATCH');
      this.setData({ polling: true });
      const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
      while (
        Date.now() < deadline &&
        this.data.polling &&
        pollingToken === this.pollingToken &&
        this.active(session, id)
      ) {
        const detail = assertPictureBookDetailContext(await getPictureBook(id), id);
        this.clearIfSessionChanged(session);
        if (pollingToken !== this.pollingToken || !this.active(session, id)) return;
        this.setData({ detail });
        const page = detail.pages.find((item: PictureBookPage) => item.id === pageId);
        const latest = page?.illustrations.find((item) => item.id === accepted.illustrationId);
        if (latest?.status === 'READY') return;
        if (latest?.status === 'FAILED') {
          failedErrorCode = latest.errorCode || 'ILLUSTRATION_FAILED';
          throw new Error('ILLUSTRATION_FAILED');
        }
        await sleep(IMAGE_POLL_INTERVAL_MS);
      }
      if (pollingToken === this.pollingToken && this.data.polling && this.active(session, id)) {
        this.setData({ error: '插画仍在后台处理中，请稍后返回绘本查看最新状态。' });
      }
    } catch (error) {
      this.clearIfSessionChanged(session);
      if (pollingToken === this.pollingToken && this.active(session, id)) {
        this.setData({
          error:
            error instanceof PictureBookApiError && error.status === 503 && !acceptedByServer
              ? '图片生成未开启（安全关闭）'
              : error instanceof Error && error.message === 'ILLUSTRATION_FAILED'
                ? `插画生成失败（${failedErrorCode || 'ILLUSTRATION_FAILED'}）`
                : acceptedByServer
                  ? '插画状态查询失败，请稍后查看任务结果。'
                  : '插画请求状态未确认，请稍后查看任务结果。',
        });
      }
    } finally {
      if (pollingToken === this.pollingToken && this.active(session, id)) {
        this.setData({ busy: false, polling: false });
      }
    }
  },
});
