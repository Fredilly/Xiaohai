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

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const IMAGE_POLL_TIMEOUT_MS = 190_000;
const IMAGE_POLL_INTERVAL_MS = 1_000;

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
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: String(query.id || '') });
    if (this.data.id) void this.load();
    else this.setData({ loading: false, error: '绘本参数无效' });
  },
  onUnload() {
    this.pollingToken += 1;
    this.setData({ polling: false });
  },
  onImageError(event: WechatMiniprogram.CustomEvent<{ errMsg?: string }>) {
    const errMsg = String(event.detail?.errMsg || 'unknown image load error');
    console.warn(`[picture-book] local image display failed: ${errMsg}`);
    this.setData({ imageError: true });
  },
  pollingToken: 0,
  async load() {
    try {
      const detail = await getPictureBook(this.data.id);
      const references = await Promise.all(
        detail.characters.map(
          async (character) =>
            [
              character.characterId,
              (await listCharacterReferences(this.data.id, character.characterId)).references,
            ] as const,
        ),
      );
      this.setData({
        detail,
        references: Object.fromEntries(references),
        characterBibleConfirmed:
          detail.characters.length > 0 &&
          detail.characters.every((character) => character.confirmed && character.locked),
        error: '',
      });
    } catch {
      this.setData({ error: '绘本加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },
  async reference(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const characterId = String(event.currentTarget.dataset.characterId || '');
    this.setData({ busy: true, error: '' });
    const pollingToken = ++this.pollingToken;
    try {
      const accepted = await generateCharacterReference(this.data.id, characterId);
      this.setData({ polling: true });
      const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
      while (Date.now() < deadline && this.data.polling && pollingToken === this.pollingToken) {
        const result = (await listCharacterReferences(this.data.id, characterId)).references;
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
    } catch {
      this.setData({ error: '参考图生成失败，请重试。' });
    } finally {
      this.setData({ busy: false, polling: false });
    }
  },
  async selectReference(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const characterId = String(event.currentTarget.dataset.characterId || '');
    const revisionId = String(event.currentTarget.dataset.revisionId || '');
    this.setData({ busy: true, error: '' });
    try {
      this.setData({
        detail: await selectCharacterReference(this.data.id, characterId, revisionId),
      });
      await this.load();
    } catch {
      this.setData({ error: '参考图选择失败，请重试。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async generatePlan(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
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
  editCharacterField(event: {
    currentTarget: { dataset: Record<string, string> };
    detail: { value?: string };
  }) {
    const index = Number(event.currentTarget.dataset.index);
    const field = String(event.currentTarget.dataset.field) as
      'name' | 'description' | 'canonicalVisualPrompt';
    const value = String(event.detail.value || '');
    const detail = this.data.detail;
    if (!detail || detail.characters[index]?.locked) return;
    const characters = detail.characters.map((character, characterIndex) =>
      characterIndex === index ? { ...character, [field]: value } : character,
    );
    this.setData({ detail: { ...detail, characters } });
  },
  async saveCharacter(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const character = this.data.detail?.characters[index];
    if (this.data.busy || !character || character.locked) return;
    this.setData({ busy: true, error: '' });
    try {
      this.setData({
        detail: await updatePictureBookCharacter(this.data.id, character.characterId, {
          name: character.name,
          description: character.description,
          canonicalVisualPrompt: character.canonicalVisualPrompt,
        }),
      });
    } catch {
      this.setData({ error: '角色设定保存失败，请重试。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async confirmCharacters() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const detail = await confirmPictureBookCharacters(this.data.id);
      this.setData({
        detail,
        characterBibleConfirmed:
          detail.characters.length > 0 &&
          detail.characters.every((item) => item.confirmed && item.locked),
      });
    } catch {
      this.setData({ error: '角色设定确认失败，请重试。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async reopenCharacters() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const detail = await reopenPictureBookCharacters(this.data.id);
      this.setData({ detail, characterBibleConfirmed: false });
    } catch {
      this.setData({ error: '重新编辑角色设定失败，请重试。' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async illustrate(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const pageId = String(event.currentTarget.dataset.pageId || '');
    const regenerate = String(event.currentTarget.dataset.regenerate || '') === 'true';
    if (!pageId) return;
    this.setData({ busy: true, error: '' });
    let failedErrorCode: string | null = null;
    try {
      const accepted = await generateIllustration(this.data.id, pageId, regenerate);
      this.setData({ polling: true });
      const pollingToken = ++this.pollingToken;
      const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
      while (Date.now() < deadline && this.data.polling && pollingToken === this.pollingToken) {
        const detail = await getPictureBook(this.data.id);
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
    } catch (error) {
      this.setData({
        error:
          error instanceof PictureBookApiError && error.status === 503
            ? '图片生成未开启（安全关闭）'
            : error instanceof Error && error.message === 'ILLUSTRATION_FAILED'
              ? `插画生成失败（${failedErrorCode || 'ILLUSTRATION_FAILED'}）`
              : '插画任务失败，请稍后重试。',
      });
    } finally {
      this.setData({ busy: false, polling: false });
    }
  },
});
