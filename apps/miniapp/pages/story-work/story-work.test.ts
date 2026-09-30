import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/story', () => ({
  StoryApiError: class StoryApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | null = null,
    ) {
      super(`Story API ${status}`);
    }
  },
  confirmStoryDraft: vi.fn(),
  createStoryDraftFromJob: vi.fn(),
  discardStoryDraft: vi.fn(),
  generateStory: vi.fn(),
  getStoryJob: vi.fn(),
  getStoryWork: vi.fn(),
  updateStoryDraft: vi.fn(),
}));

type StoryWorkPage = {
  data: {
    workId: string;
    activeTab: string;
    bodyDraft: typeof draft | null;
    bodyContent: string;
    draftSaveFailed: boolean;
    draftStatus: string;
    errorMessage: string;
    confirming: boolean;
    [key: string]: unknown;
  };
  setData: (patch: Record<string, unknown>) => void;
  saveDraft: (kind: 'OUTLINE' | 'BODY') => Promise<unknown>;
  confirmDraft: (event: { currentTarget: { dataset: { kind: string } } }) => Promise<void>;
};

const draft = {
  id: '00000000-0000-4000-8000-000000000001',
  workId: '00000000-0000-4000-8000-000000000002',
  contentKind: 'BODY' as const,
  content: '服务端旧内容',
  sourceAiJobId: '00000000-0000-4000-8000-000000000003',
  draftRevision: 1,
  updatedAt: '2026-09-30T00:00:00.000Z',
};

describe('story work draft autosave failures', () => {
  const loadStoryService = () => import('../../services/story');
  let page: StoryWorkPage;
  let storyService: Awaited<ReturnType<typeof loadStoryService>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal('Page', (definition: StoryWorkPage) => {
      page = definition;
      page.setData = (patch) => Object.assign(page.data, patch);
    });
    storyService = await loadStoryService();
    await import('./story-work');
    Object.assign(page.data, {
      workId: draft.workId,
      activeTab: 'BODY',
      bodyDraft: { ...draft },
      bodyContent: '用户尚未保存的新内容',
    });
  });

  it('keeps textarea input and does not reload after a temporary request failure', async () => {
    vi.mocked(storyService.updateStoryDraft).mockRejectedValueOnce(
      new Error('network unavailable'),
    );

    await page.saveDraft('BODY');

    expect(page.data.bodyContent).toBe('用户尚未保存的新内容');
    expect(page.data.bodyDraft).toEqual(draft);
    expect(page.data.draftSaveFailed).toBe(true);
    expect(page.data.draftStatus).toContain('本地内容仍保留');
    expect(storyService.getStoryWork).not.toHaveBeenCalled();
  });

  it('reloads only for an explicit revision conflict', async () => {
    vi.mocked(storyService.updateStoryDraft).mockRejectedValueOnce(
      new storyService.StoryApiError(409, 'REVISION_CONFLICT'),
    );
    vi.mocked(storyService.getStoryWork).mockResolvedValueOnce({
      work: {
        id: draft.workId,
        title: '故事',
        workType: 'STORY',
        creationMode: 'DIRECT_BODY',
        draftKinds: ['BODY'],
        hasConfirmedBody: false,
        controls: { idea: '想法', ageRange: '6-8', theme: '主题', style: '风格' },
        createdAt: '2026-09-30T00:00:00.000Z',
        updatedAt: '2026-09-30T00:00:00.000Z',
      },
      drafts: [{ ...draft, content: '其他设备的新内容', draftRevision: 2 }],
      versions: [],
    });

    await page.saveDraft('BODY');

    expect(storyService.getStoryWork).toHaveBeenCalledWith(draft.workId);
    expect(page.data.bodyContent).toBe('其他设备的新内容');
    expect(page.data.draftSaveFailed).toBe(false);
  });

  it('returns null for whitespace-only content and never confirms it', async () => {
    page.data.bodyContent = '  \n\t  ';

    await expect(page.saveDraft('BODY')).resolves.toBeNull();
    await page.confirmDraft({ currentTarget: { dataset: { kind: 'BODY' } } });

    expect(storyService.updateStoryDraft).not.toHaveBeenCalled();
    expect(storyService.confirmStoryDraft).not.toHaveBeenCalled();
    expect(page.data.errorMessage).toBe('请输入正文内容后再确认');
    expect(page.data.draftStatus).toBe('草稿内容不能为空');
  });
});
