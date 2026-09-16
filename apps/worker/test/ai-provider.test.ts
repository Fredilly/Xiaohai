import { describe, expect, it, vi } from 'vitest';
import { DeepSeekAiProvider, MockAiProvider, ProviderError } from '../src/ai-provider.js';
import { BaselineModerationAdapter } from '../src/moderation.js';
describe('AI provider adapters', () => {
  it('keeps the mock explicit and records non-billable metadata', async () => {
    const result = await new MockAiProvider().generate({
      model: 'test-model',
      prompt: 'hello',
      signal: new AbortController().signal,
    });
    expect(result.text).toContain('hello');
    expect(result.costMetadata).toEqual({ source: 'MOCK', billable: false });
  });
  it('returns deterministic structured Picture Book fixtures for M10 tasks', async () => {
    const provider = new MockAiProvider();
    const signal = new AbortController().signal;

    const characters = await provider.generate({
      model: 'mock-picture-book-v1',
      prompt: 'XIAOHAI_TASK=PICTURE_BOOK_CHARACTERS',
      signal,
    });

    const characterPlan = JSON.parse(characters.text) as {
      characters: Array<{
        name: string;
        role: string;
        visualPrompt: string;
      }>;
    };

    expect(characterPlan.characters).toHaveLength(2);
    expect(characterPlan.characters[0]).toMatchObject({
      name: '小狐狸',
      role: 'MAIN',
    });
    expect(characterPlan.characters[0]!.visualPrompt).toContain('green scarf');

    const storyboard = await provider.generate({
      model: 'mock-picture-book-v1',
      prompt: 'XIAOHAI_TASK=PICTURE_BOOK_STORYBOARD',
      signal,
    });

    const storyboardPlan = JSON.parse(storyboard.text) as {
      cover: { illustrationPrompt: string };
      pages: Array<{
        storyText: string;
        illustrationPrompt: string;
      }>;
    };

    expect(storyboardPlan.cover.illustrationPrompt).toContain('green scarf');
    expect(storyboardPlan.pages).toHaveLength(2);
    expect(storyboardPlan.pages[1]!.illustrationPrompt).toContain('red satchel');

    expect(characters.costMetadata).toEqual({
      source: 'MOCK',
      billable: false,
    });
    expect(storyboard.costMetadata).toEqual({
      source: 'MOCK',
      billable: false,
    });
  });

  it('maps DeepSeek fields without leaking the API key into results', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'provider-request',
          choices: [{ message: { content: 'result' } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    const provider = new DeepSeekAiProvider('private-key', 'https://api.deepseek.com', http);
    const result = await provider.generate({
      model: 'deepseek-chat',
      prompt: 'input',
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      text: 'result',
      providerRequestId: 'provider-request',
      usage: { totalTokens: 5 },
    });
    expect(JSON.stringify(result)).not.toContain('private-key');
    const init = http.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer private-key');
  });
  it('fails safely for invalid/provider error responses', async () => {
    const invalid = new DeepSeekAiProvider(
      'key',
      'https://api.deepseek.com',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    );
    await expect(
      invalid.generate({ model: 'm', prompt: 'p', signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(ProviderError);
    const unavailable = new DeepSeekAiProvider(
      'key',
      'https://api.deepseek.com',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429 })),
    );
    await expect(
      unavailable.generate({ model: 'm', prompt: 'p', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
  it('marks baseline output for review rather than claiming production moderation', async () => {
    expect(await new BaselineModerationAdapter().moderate('safe-looking', 'OUTPUT')).toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCodes: ['PRODUCTION_POLICY_NOT_CONFIGURED'],
    });
  });
});
