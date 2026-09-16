import { describe, expect, it } from 'vitest';
import {
  animationCompositionSchema,
  animationSceneGenerationSchema,
  animationScriptPlanSchema,
  animationStoryboardPlanSchema,
  createAnimationRequestSchema,
} from './animation.js';

const id = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const now = '2026-09-16T00:00:00.000Z';

describe('M11 Animation contracts', () => {
  it('accepts only a source Story reference and optional title from the client', () => {
    expect(
      createAnimationRequestSchema.parse({
        storyWorkId: id,
        sourceStoryVersionId: id2,
        title: '森林动画',
      }),
    ).toEqual({ storyWorkId: id, sourceStoryVersionId: id2, title: '森林动画' });

    expect(
      createAnimationRequestSchema.safeParse({
        storyWorkId: id,
        sourceStoryVersionId: id2,
        provider: 'CLIENT_PROVIDER',
        model: 'client-model',
        consumerUserId: id,
      }).success,
    ).toBe(false);
  });

  it('validates strict structured script and storyboard output', () => {
    expect(
      animationScriptPlanSchema.safeParse({
        title: '森林动画',
        synopsis: '小狐狸帮助小鸟回家。',
        script: '场景一：森林晨光。',
      }).success,
    ).toBe(true);

    expect(
      animationStoryboardPlanSchema.safeParse({
        characters: [
          {
            name: '小狐狸',
            role: 'MAIN',
            description: '勇敢的小狐狸',
            visualPrompt: 'orange fox, green scarf',
          },
        ],
        scenes: [
          {
            scriptText: '小狐狸走进森林。',
            narration: '清晨，森林醒来了。',
            dialogue: [{ speaker: '小狐狸', text: '今天也要帮助朋友。' }],
            visualDescription: '晨光下的森林小路',
            generationPrompt: 'cinematic forest path, orange fox, morning light',
            plannedDurationMs: 5000,
          },
        ],
      }).success,
    ).toBe(true);

    expect(animationStoryboardPlanSchema.safeParse({ characters: [], scenes: [] }).success).toBe(
      false,
    );
  });

  it('requires media assets for READY generation and composition views', () => {
    const generation = {
      id,
      animationId: id,
      sceneId: id2,
      revisionNumber: 1,
      provider: 'SERVER_PROVIDER',
      model: 'server-model',
      status: 'READY',
      progressPercent: 100,
      mediaAssetId: null,
      errorCode: null,
      usage: null,
      costMetadata: null,
      createdAt: now,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    };
    expect(animationSceneGenerationSchema.safeParse(generation).success).toBe(false);

    const composition = {
      id,
      animationId: id2,
      revisionNumber: 1,
      status: 'READY',
      progressPercent: 100,
      mediaAssetId: null,
      errorCode: null,
      usage: null,
      costMetadata: null,
      inputs: [{ sceneGenerationId: id, sceneOrder: 1 }],
      createdAt: now,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    };
    expect(animationCompositionSchema.safeParse(composition).success).toBe(false);
  });
});
