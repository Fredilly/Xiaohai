import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/ai-provider.js';
import { expectsStructuredStory, validateAndNormalizeAiOutput } from '../src/story-output.js';

const context = (requestedPageCount: number) => ({
  context: {
    kind: 'STORY',
    operation: 'BODY',
    outputFormat: 'STRUCTURED_STORY',
    requestedPageCount,
  },
});

const validStory = (pageCount: number) =>
  JSON.stringify({
    title: '月光邮差',
    outline: '小兔子在月光下帮助大家送信。',
    characters: [
      {
        name: '小兔子',
        description: '认真可靠的小邮差',
        visualDescription: '白色长耳朵、蓝色小外套、黄色邮差包和圆圆黑眼睛。',
      },
    ],
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      scene: `月光小路 ${index + 1}`,
      text: `这是第 ${index + 1} 页的故事。`,
    })),
  });

describe('structured Story worker output validation', () => {
  it.each([10, 15])('normalizes one complete %i-page response', (pageCount) => {
    const input = context(pageCount);
    expect(expectsStructuredStory(input)).toBe(true);

    const normalized = validateAndNormalizeAiOutput(input, validStory(pageCount));
    const parsed = JSON.parse(normalized) as { title: string; pages: unknown[] };
    expect(parsed.title).toBe('月光邮差');
    expect(parsed.pages).toHaveLength(pageCount);
  });

  it.each([
    ['malformed JSON', '{'],
    ['incomplete object', '{"title":"only"}'],
    ['wrong page count', validStory(10)],
  ])('maps %s to the existing provider response error', (_case, output) => {
    let failure: unknown;
    try {
      validateAndNormalizeAiOutput(context(15), output);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).code).toBe('PROVIDER_RESPONSE_INVALID');
  });

  it('leaves non-structured provider outputs unchanged', () => {
    expect(validateAndNormalizeAiOutput({ context: undefined }, 'plain output')).toBe(
      'plain output',
    );
  });
});
