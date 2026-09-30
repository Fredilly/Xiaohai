import { describe, expect, it } from 'vitest';
import {
  createStoryWorkRequestSchema,
  parseStructuredStoryJson,
  storyGenerateRequestSchema,
} from './story.js';

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
          ...(operation === 'BODY' ? { requestedPageCount: 10 } : {}),
        }).success,
      ).toBe(true);
    }
  });

  it.each([10, 15])('validates a complete %i-page structured story', (pageCount) => {
    const story = {
      title: '森林里的小灯塔',
      outline: '小狐狸帮助迷路的小鸟找到回家的路。',
      characters: [
        {
          name: '小狐狸',
          description: '勇敢又温柔的主角',
          visualDescription: '橙色短毛、圆圆棕眼睛、始终佩戴绿色围巾',
        },
      ],
      pages: Array.from({ length: pageCount }, (_, index) => ({
        pageNumber: index + 1,
        scene: `森林场景 ${index + 1}`,
        text: `这是第 ${index + 1} 页的故事内容。`,
      })),
    };

    expect(parseStructuredStoryJson(JSON.stringify(story), pageCount)).toEqual(story);
  });

  it.each([
    ['malformed JSON', '{'],
    [
      'wrong page count',
      JSON.stringify({
        title: '标题',
        outline: '大纲',
        characters: [
          { name: '角色', description: '角色说明', visualDescription: '固定的红帽子和蓝色外套' },
        ],
        pages: Array.from({ length: 10 }, (_, index) => ({
          pageNumber: index + 1,
          scene: '场景',
          text: '正文',
        })),
      }),
    ],
    [
      'missing page',
      JSON.stringify({
        title: '标题',
        outline: '大纲',
        characters: [
          { name: '角色', description: '角色说明', visualDescription: '固定的红帽子和蓝色外套' },
        ],
        pages: Array.from({ length: 10 }, (_, index) => ({
          pageNumber: index < 5 ? index + 1 : index + 2,
          scene: '场景',
          text: '正文',
        })),
      }),
    ],
    [
      'duplicate page number',
      JSON.stringify({
        title: '标题',
        outline: '大纲',
        characters: [
          { name: '角色', description: '角色说明', visualDescription: '固定的红帽子和蓝色外套' },
        ],
        pages: Array.from({ length: 10 }, (_, index) => ({
          pageNumber: index === 9 ? 9 : index + 1,
          scene: '场景',
          text: '正文',
        })),
      }),
    ],
    [
      'missing character details',
      JSON.stringify({
        title: '标题',
        outline: '大纲',
        characters: [{ name: '角色', description: '', visualDescription: '' }],
        pages: Array.from({ length: 10 }, (_, index) => ({
          pageNumber: index + 1,
          scene: '场景',
          text: '正文',
        })),
      }),
    ],
    [
      'empty page text',
      JSON.stringify({
        title: '标题',
        outline: '大纲',
        characters: [
          { name: '角色', description: '角色说明', visualDescription: '固定的红帽子和蓝色外套' },
        ],
        pages: Array.from({ length: 10 }, (_, index) => ({
          pageNumber: index + 1,
          scene: '场景',
          text: index === 5 ? '   ' : '正文',
        })),
      }),
    ],
  ])('rejects %s', (_case, raw) => {
    expect(() => parseStructuredStoryJson(raw, 15)).toThrow();
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
