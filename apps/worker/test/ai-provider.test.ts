import { describe, expect, it, vi } from 'vitest';
import {
  BailianAiProvider,
  DeepSeekAiProvider,
  MockAiProvider,
  ProviderError,
} from '../src/ai-provider.js';
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

  it('returns deterministic structured Animation fixtures for M11 planning tasks', async () => {
    const provider = new MockAiProvider();
    const signal = new AbortController().signal;
    const script = await provider.generate({
      model: 'mock-animation-v1',
      prompt: 'XIAOHAI_TASK=ANIMATION_SCRIPT',
      signal,
    });
    const storyboard = await provider.generate({
      model: 'mock-animation-v1',
      prompt: 'XIAOHAI_TASK=ANIMATION_STORYBOARD',
      signal,
    });

    const scriptPlan = JSON.parse(script.text) as { title: unknown; script: unknown };
    const storyboardPlan = JSON.parse(storyboard.text) as {
      characters: Array<{ visualPrompt: unknown }>;
      scenes: Array<{ plannedDurationMs: unknown; generationPrompt: unknown }>;
    };
    expect(typeof scriptPlan.title).toBe('string');
    expect(typeof scriptPlan.script).toBe('string');
    expect(typeof storyboardPlan.characters[0]?.visualPrompt).toBe('string');
    expect(typeof storyboardPlan.scenes[0]?.plannedDurationMs).toBe('number');
    expect(typeof storyboardPlan.scenes[0]?.generationPrompt).toBe('string');
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
  it('maps Bailian OpenAI-compatible fields and x-request-id without leaking the API key', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'body-request-id',
          choices: [{ message: { content: 'qwen result' } }],
          usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
        }),
        { status: 200, headers: { 'x-request-id': 'bailian-request-id' } },
      ),
    );
    const provider = new BailianAiProvider(
      'private-bailian-key',
      'https://workspace.example.invalid/compatible-mode/v1',
      http,
    );
    const result = await provider.generate({
      model: 'qwen3.7-flash',
      prompt: 'input',
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      text: 'qwen result',
      providerRequestId: 'bailian-request-id',
      usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
      costMetadata: { source: 'BAILIAN_USAGE_ONLY', amountMinor: null, currency: null },
    });
    expect(JSON.stringify(result)).not.toContain('private-bailian-key');
    expect(http).toHaveBeenCalledWith(
      'https://workspace.example.invalid/compatible-mode/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer private-bailian-key' }),
      }),
    );
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
