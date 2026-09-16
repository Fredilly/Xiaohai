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

describe('picture-book AI planning contracts', () => {
  it('accepts strict character planning output', async () => {
    const { pictureBookCharacterPlanSchema } = await import('./picture-book.js');

    expect(
      pictureBookCharacterPlanSchema.safeParse({
        characters: [
          {
            name: '小狐狸',
            role: 'MAIN',
            description: '一只勇敢又温柔的小狐狸',
            visualPrompt: 'orange fox, green scarf, round eyes',
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      pictureBookCharacterPlanSchema.safeParse({
        characters: [],
      }).success,
    ).toBe(false);
  });

  it('accepts storyboard output without trusting provider page numbers', async () => {
    const { pictureBookStoryboardPlanSchema } = await import('./picture-book.js');

    expect(
      pictureBookStoryboardPlanSchema.safeParse({
        cover: {
          sceneDescription: '森林晨光中的小狐狸',
          illustrationPrompt: 'storybook cover, forest sunrise, little fox',
        },
        pages: [
          {
            storyText: '清晨，小狐狸离开了家。',
            sceneDescription: '小狐狸站在森林小路入口。',
            illustrationPrompt: 'little fox on forest path, morning light',
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      pictureBookStoryboardPlanSchema.safeParse({
        cover: {
          sceneDescription: '封面',
          illustrationPrompt: 'cover',
        },
        pages: [],
      }).success,
    ).toBe(false);
  });
});
