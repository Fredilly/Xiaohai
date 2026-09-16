import { describe, expect, it } from 'vitest';
import {
  createPictureBookRequestSchema,
  pictureBookIllustrationSchema,
  pictureBookPageSchema,
} from './picture-book.js';

const id = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';

describe('picture-book contracts', () => {
  it('accepts a strict source Story reference', () => {
    expect(
      createPictureBookRequestSchema.parse({
        storyWorkId: id,
        sourceStoryVersionId: id2,
        layoutPreset: 'AUTO',
      }),
    ).toEqual({
      storyWorkId: id,
      sourceStoryVersionId: id2,
      layoutPreset: 'AUTO',
    });

    expect(
      createPictureBookRequestSchema.safeParse({
        storyWorkId: id,
        sourceStoryVersionId: id2,
        consumerUserId: id,
      }).success,
    ).toBe(false);
  });

  it('enforces cover and content page numbering', () => {
    const base = {
      id,
      pictureBookId: id2,
      sceneDescription: null,
      illustrationPrompt: null,
      layoutPreset: 'AUTO',
      sourceAiJobId: null,
      illustrations: [],
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    };

    expect(
      pictureBookPageSchema.safeParse({
        ...base,
        pageNumber: 0,
        pageKind: 'COVER',
        storyText: null,
      }).success,
    ).toBe(true);

    expect(
      pictureBookPageSchema.safeParse({
        ...base,
        pageNumber: 0,
        pageKind: 'CONTENT',
        storyText: '正文',
      }).success,
    ).toBe(false);

    expect(
      pictureBookPageSchema.safeParse({
        ...base,
        pageNumber: 1,
        pageKind: 'CONTENT',
        storyText: null,
      }).success,
    ).toBe(false);
  });

  it('requires a media asset for READY illustrations', () => {
    const base = {
      id,
      pageId: id2,
      revisionNumber: 1,
      prompt: 'storybook illustration',
      sourceAiJobId: null,
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    };

    expect(
      pictureBookIllustrationSchema.safeParse({
        ...base,
        status: 'READY',
        mediaAssetId: null,
      }).success,
    ).toBe(false);

    expect(
      pictureBookIllustrationSchema.safeParse({
        ...base,
        status: 'QUEUED',
        mediaAssetId: null,
      }).success,
    ).toBe(true);
  });
});
