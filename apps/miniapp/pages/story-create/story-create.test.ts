import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/story', () => ({
  createStoryWork: vi.fn(),
  StoryApiError: class StoryApiError extends Error {},
}));
vi.mock('../../services/consumer-session', () => ({ storedConsumerId: vi.fn() }));

type StoryCreatePage = {
  data: Record<string, unknown>;
  setData: (patch: Record<string, unknown>) => void;
  onShow: () => void;
  input: (event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }) => void;
  saveLocalDraft: (consumerUserId?: string, updateStatus?: boolean) => void;
};

describe('story create draft account isolation', () => {
  const storage = new Map<string, unknown>();
  let page: StoryCreatePage;
  let storedConsumerId: ReturnType<typeof vi.fn<() => string>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    storage.clear();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('Page', (definition: StoryCreatePage) => {
      page = definition;
      page.setData = (patch) => Object.assign(page.data, patch);
    });
    const sessionService = await import('../../services/consumer-session');
    storedConsumerId = vi.mocked(sessionService.storedConsumerId);
    await import('./story-create');
  });

  it('restores only the active consumer draft across account changes and logout', () => {
    storedConsumerId.mockReturnValue('user-a');
    page.onShow();
    page.input({ currentTarget: { dataset: { field: 'idea' } }, detail: { value: 'A 的故事' } });
    vi.advanceTimersByTime(500);

    expect(storage.get('story_create_form_draft_v2:user-a')).toMatchObject({ idea: 'A 的故事' });

    storedConsumerId.mockReturnValue('');
    page.onShow();
    expect(page.data.idea).toBe('');
    expect(page.data.isLoggedIn).toBe(false);

    storedConsumerId.mockReturnValue('user-b');
    page.onShow();
    expect(page.data.idea).toBe('');
    page.input({ currentTarget: { dataset: { field: 'idea' } }, detail: { value: 'B 的故事' } });
    vi.advanceTimersByTime(500);

    storedConsumerId.mockReturnValue('user-a');
    page.onShow();
    expect(page.data.idea).toBe('A 的故事');
    expect(storage.get('story_create_form_draft_v2:user-b')).toMatchObject({ idea: 'B 的故事' });
  });

  it('never restores the legacy unscoped draft', () => {
    storage.set('story_create_form_draft_v1', { idea: '其他账号的旧草稿' });
    storedConsumerId.mockReturnValue('user-a');

    page.onShow();

    expect(page.data.idea).toBe('');
    expect(storage.has('story_create_form_draft_v1')).toBe(false);
  });
});
