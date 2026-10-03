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
} from '../../services/picture-book';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

Page({
  data: {
    id: '',
    detail: null as PictureBookDetail | null,
    characterBibleConfirmed: false,
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
      const detail = await getPictureBook(this.data.id);
      this.setData({
        detail,
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
    try {
      await generateIllustration(this.data.id, pageId, regenerate);
      this.setData({ polling: true });
      for (let index = 0; index < 90 && this.data.polling; index += 1) {
        const detail = await getPictureBook(this.data.id);
        this.setData({ detail });
        const page = detail.pages.find((item: PictureBookPage) => item.id === pageId);
        const latest = page?.illustrations[page.illustrations.length - 1];
        if (latest?.status === 'READY') return;
        if (latest?.status === 'FAILED') throw new Error('Illustration failed');
        await sleep(1000);
      }
      throw new Error('Illustration polling timed out');
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
