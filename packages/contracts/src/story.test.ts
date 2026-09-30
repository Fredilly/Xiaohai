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
      creationMode: 'OUTLINE_FIRST',
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

  it('allows direct BODY while keeping editing operations source-version scoped', () => {
    expect(
      storyGenerateRequestSchema.safeParse({
        operation: 'BODY',
      }).success,
    ).toBe(true);

    for (const operation of ['REWRITE', 'CONTINUE', 'POLISH'] as const) {
      expect(storyGenerateRequestSchema.safeParse({ operation }).success).toBe(false);
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

  it('accepts an explicit direct-body creation mode', () => {
    expect(
      createStoryWorkRequestSchema.parse({
        idea: 'test',
        ageRange: '6-8',
        theme: 'friendship',
        style: 'fairytale',
        creationMode: 'DIRECT_BODY',
      }).creationMode,
    ).toBe('DIRECT_BODY');
  });
});
