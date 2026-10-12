import { describe, expect, it } from 'vitest';
import type { PictureBookDetail, PictureBookIllustration } from '@xiaohai/contracts/picture-book';
import { buildPictureBookPreview, selectPreviewIllustration } from './picture-book-preview';

const illustration = (
  revisionNumber: number,
  overrides: Partial<PictureBookIllustration> = {},
): PictureBookIllustration => ({
  id: `00000000-0000-4000-8000-0000000000${revisionNumber.toString().padStart(2, '0')}`,
  pageId: '00000000-0000-4000-8000-000000000100',
  revisionNumber,
  prompt: 'prompt',
  provider: 'BAILIAN',
  model: 'qwen-image-3.0',
  status: 'READY',
  errorCode: null,
  sourceAiJobId: null,
  mediaAssetId: '00000000-0000-4000-8000-000000000200',
  playbackUrl: `https://assets.example.com/${revisionNumber}.png`,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...overrides,
});

const detail = (pages: PictureBookDetail['pages']): PictureBookDetail => ({
  pictureBook: {
    id: '00000000-0000-4000-8000-000000000001',
    storyWorkId: '00000000-0000-4000-8000-000000000002',
    sourceStoryVersionId: '00000000-0000-4000-8000-000000000003',
    title: '森林绘本',
    status: 'ILLUSTRATING',
    layoutPreset: 'AUTO',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  },
  characters: [],
  pages,
});

const page = (
  pageKind: 'COVER' | 'CONTENT',
  pageNumber: number,
  illustrations: PictureBookIllustration[],
): PictureBookDetail['pages'][number] => ({
  id: `00000000-0000-4000-8000-0000000001${pageNumber.toString().padStart(2, '0')}`,
  pictureBookId: '00000000-0000-4000-8000-000000000001',
  pageNumber,
  pageKind,
  storyText: pageKind === 'CONTENT' ? `第 ${pageNumber} 页正文` : null,
  sceneDescription: 'scene',
  illustrationPrompt: 'prompt',
  characterIds: [],
  layoutPreset: 'AUTO',
  sourceAiJobId: null,
  illustrations,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
});

describe('Picture Book read-only preview', () => {
  it('orders the cover first and content pages by page number', () => {
    const preview = buildPictureBookPreview(
      detail([page('CONTENT', 2, []), page('COVER', 0, []), page('CONTENT', 1, [])]),
    );

    expect(preview.map((item) => item.label)).toEqual(['封面', '第 1 页', '第 2 页']);
  });

  it('uses the latest valid real READY image and falls back after a failed regeneration', () => {
    const revisions = [
      illustration(1),
      illustration(2, {
        status: 'FAILED',
        mediaAssetId: null,
        playbackUrl: null,
        errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
      }),
    ];

    expect(selectPreviewIllustration(revisions)?.revisionNumber).toBe(1);
    const preview = buildPictureBookPreview(detail([page('CONTENT', 1, revisions)]));
    expect(preview[0]).toMatchObject({
      imageState: 'READY',
      revisionNumber: 1,
      imageUrl: 'https://assets.example.com/1.png',
      errorCode: null,
    });
  });

  it('never treats MOCK READY or failed-only revisions as displayable images', () => {
    const mockReady = illustration(1, {
      provider: 'MOCK',
      mediaAssetId: '00000000-0000-4000-8000-000000000201',
      playbackUrl: null,
    });
    const failed = illustration(2, {
      status: 'FAILED',
      mediaAssetId: null,
      playbackUrl: null,
      errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
    });

    const preview = buildPictureBookPreview(detail([page('CONTENT', 1, [mockReady, failed])]));
    expect(preview[0]).toMatchObject({
      imageUrl: null,
      imageState: 'FAILED',
      revisionNumber: null,
      errorCode: 'IMAGE_PROVIDER_UNAVAILABLE',
    });
  });
});
