import { describe, expect, it, vi } from 'vitest';
import {
  BailianAiProvider,
  DeepSeekAiProvider,
  MockAiProvider,
  ProviderError,
  QwenAiProvider,
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

  it.each([10, 15])('keeps MOCK working for a structured %i-page Story', async (pageCount) => {
    const result = await new MockAiProvider().generate({
      model: 'mock-story-v1',
      prompt: `XIAOHAI_TASK=STRUCTURED_STORY\nREQUESTED_PAGE_COUNT=${pageCount}`,
      signal: new AbortController().signal,
      responseFormat: 'json_object',
    });
    const story = JSON.parse(result.text) as {
      characters: Array<{ visualDescription: string }>;
      pages: Array<{ pageNumber: number; text: string }>;
    };

    expect(story.characters[0]?.visualDescription).toContain('绿色围巾');
    expect(story.pages).toHaveLength(pageCount);
    expect(story.pages.at(-1)?.pageNumber).toBe(pageCount);
    expect(story.pages.every((page) => page.text.length > 0)).toBe(true);
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
      costMetadata: {
        source: 'BAILIAN_USAGE_ONLY',
        amountMinor: null,
        currency: null,
      },
    });
    expect(typeof result.costMetadata.latencyMs).toBe('number');
    expect(JSON.stringify(result)).not.toContain('private-bailian-key');
    expect(http).toHaveBeenCalledOnce();
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://workspace.example.invalid/compatible-mode/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer private-bailian-key',
    );
  });

  it('uses the existing DashScope transport for Qwen and maps token usage', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'qwen-body-id',
          choices: [{ message: { content: 'short safe answer' } }],
          usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
        }),
        { status: 200, headers: { 'x-request-id': 'qwen-header-id' } },
      ),
    );
    const provider = new QwenAiProvider(
      'qwen-test-secret',
      'https://dashscope.example.invalid/compatible-mode/v1',
      http,
    );

    const result = await provider.generate({
      model: 'qwen-flash',
      prompt: 'private prompt',
      signal: new AbortController().signal,
      responseFormat: 'json_object',
    });

    expect(result).toMatchObject({
      text: 'short safe answer',
      providerRequestId: 'qwen-header-id',
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
      costMetadata: { source: 'QWEN_USAGE_ONLY' },
    });
    expect(typeof result.costMetadata.latencyMs).toBe('number');
    expect(JSON.stringify(result)).not.toContain('qwen-test-secret');
    expect(http.mock.calls[0]?.[0]).toBe(
      'https://dashscope.example.invalid/compatible-mode/v1/chat/completions',
    );
    const requestBody = http.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('expected JSON request body');
    const body = JSON.parse(requestBody) as {
      response_format?: { type?: string };
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it.each([
    [401, 'AUTHENTICATION'],
    [403, 'AUTHENTICATION'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER'],
  ] as const)(
    'maps Qwen HTTP %i failures without exposing secrets or prompts',
    async (status, type) => {
      const provider = new QwenAiProvider(
        'never-log-this-secret',
        'https://dashscope.example.invalid/compatible-mode/v1',
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response('sensitive provider response', {
            status,
            headers: { 'x-request-id': 'safe-request-id' },
          }),
        ),
      );

      const failure = await provider
        .generate({
          model: 'qwen-flash',
          prompt: 'never-log-this-prompt',
          signal: new AbortController().signal,
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ProviderError);
      if (!(failure instanceof ProviderError)) throw new Error('expected ProviderError');
      expect(failure).toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        providerRequestId: 'safe-request-id',
        failureMetadata: { failureType: type, httpStatus: status },
      });
      expect(typeof failure.failureMetadata?.latencyMs).toBe('number');
      const serialized = JSON.stringify(failure);
      expect(serialized).not.toContain('never-log-this-secret');
      expect(serialized).not.toContain('never-log-this-prompt');
      expect(serialized).not.toContain('sensitive provider response');
    },
  );

  it('maps an aborted Qwen request to a timeout without sensitive data', async () => {
    const controller = new AbortController();
    const http = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    const provider = new QwenAiProvider(
      'timeout-secret',
      'https://dashscope.example.invalid/compatible-mode/v1',
      http,
    );

    const failure = await provider
      .generate({
        model: 'qwen-flash',
        prompt: 'timeout prompt',
        signal: controller.signal,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderError);
    if (!(failure instanceof ProviderError)) throw new Error('expected ProviderError');
    expect(failure).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      failureMetadata: { failureType: 'TIMEOUT' },
    });
    expect(typeof failure.failureMetadata?.latencyMs).toBe('number');
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
