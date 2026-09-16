import { describe, expect, it } from 'vitest';
import { createStoryWorkRequestSchema, storyGenerateRequestSchema } from './story.js';

const sourceVersionId = '00000000-0000-4000-8000-000000000001';

describe('M9 story contracts', () => {
  it('accepts bounded story controls without provider or model fields', () => {
    expect(
      createStoryWorkRequestSchema.parse({
        title: '森林里的小灯塔',
        idea: '一只小狐狸第一次独自帮助迷路的小鸟回家',
        ageRange: '6-8',
        theme: '勇气与互助',
        style: '温暖童话',
      }),
    ).toMatchObject({
      theme: '勇气与互助',
      style: '温暖童话',
    });
  });

  it('keeps OUTLINE independent from an existing version', () => {
    expect(
      storyGenerateRequestSchema.safeParse({
        operation: 'OUTLINE',
        sourceVersionId,
      }).success,
    ).toBe(false);

    expect(
      storyGenerateRequestSchema.safeParse({
        operation: 'OUTLINE',
      }).success,
    ).toBe(true);
  });

  it('requires a source version for body editing operations', () => {
    expect(
      storyGenerateRequestSchema.safeParse({
        operation: 'BODY',
      }).success,
    ).toBe(false);

    for (const operation of ['BODY', 'REWRITE', 'CONTINUE', 'POLISH'] as const) {
      expect(
        storyGenerateRequestSchema.safeParse({
          operation,
          sourceVersionId,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects client-controlled provider and model fields', () => {
    expect(
      createStoryWorkRequestSchema.safeParse({
        idea: 'test',
        ageRange: '6-8',
        theme: 'friendship',
        style: 'fairytale',
        provider: 'DEEPSEEK',
        model: 'anything',
      }).success,
    ).toBe(false);
  });
});
