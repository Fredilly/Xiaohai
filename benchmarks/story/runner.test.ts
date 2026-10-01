import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../apps/worker/src/ai-provider.js';
import { runBenchmark, summarize, type BenchmarkProvider } from './runner.js';

const story = (pageCount = 10) =>
  JSON.stringify({
    title: '小狐狸与小鸟',
    outline: '小狐狸帮助小鸟回家。',
    characters: [
      {
        name: '小狐狸',
        description: '胆小但善良。',
        visualDescription: '橙色短毛、绿色围巾和圆眼睛。',
      },
    ],
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      scene: `场景${index + 1}`,
      text: `正文${index + 1}`,
    })),
  });
const provider = (...texts: string[]): BenchmarkProvider => ({
  generate: vi.fn(async () => ({
    text: texts.shift() ?? story(),
    assetReferences: [],
    providerRequestId: 'safe-id',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    costMetadata: { latencyMs: 5 },
  })),
});

describe('story benchmark runner', () => {
  it('uses one call for ONE_SHOT and two for OUTLINE_FIRST', async () => {
    const one = provider(story());
    const two = provider('outline', story());
    await runBenchmark(one, 'qwen-flash', 'ONE_SHOT', 1, {
      idea: 'i',
      ageRange: '5-7',
      theme: 't',
      style: 's',
      requestedPageCount: 10,
    });
    await runBenchmark(two, 'qwen-flash', 'OUTLINE_FIRST', 1, {
      idea: 'i',
      ageRange: '5-7',
      theme: 't',
      style: 's',
      requestedPageCount: 10,
    });
    expect(one.generate).toHaveBeenCalledTimes(1);
    expect(two.generate).toHaveBeenCalledTimes(2);
    expect(one.generate).toHaveBeenCalledWith(
      expect.objectContaining({ responseFormat: 'json_object' }),
    );
    const twoCalls = vi.mocked(two.generate).mock.calls;
    expect(twoCalls[0]?.[0]).not.toHaveProperty('responseFormat');
    expect(twoCalls[1]?.[0]).toHaveProperty('responseFormat', 'json_object');
  });
  it('aggregates p50 and tokens', () => {
    const runs = [1, 2, 3].map((runNumber) => ({
      strategy: 'ONE_SHOT' as const,
      runNumber,
      requestedPageCount: 10,
      actualPageCount: 10,
      success: true,
      totalLatencyMs: runNumber * 10,
      providerCalls: [
        {
          latencyMs: 5,
          ttftMs: null,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          providerRequestId: 'id',
        },
      ],
      retries: 0,
      timeout: false,
      regenerationNeeded: false,
      structuredValidation: 'PASSED' as const,
      characterCount: 1,
      qualityNotes: [],
      errorCode: null,
    }));
    expect(summarize('ONE_SHOT', runs)).toMatchObject({
      p50TotalLatencyMs: 20,
      averageInputTokens: 10,
      averageOutputTokens: 20,
      averageTotalTokens: 30,
      providerCallCount: 3,
    });
  });
  it('marks malformed output without retaining content', async () => {
    const result = await runBenchmark(
      provider('{"title":"secret story body"}'),
      'qwen-flash',
      'ONE_SHOT',
      1,
      { idea: 'private idea', ageRange: '5-7', theme: 't', style: 's', requestedPageCount: 10 },
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret story body');
    expect(JSON.stringify(result)).not.toContain('private idea');
  });

  it('records provider failure and timeout metadata without response content', async () => {
    const failed: BenchmarkProvider = {
      generate: vi.fn(async () => {
        throw new ProviderError('PROVIDER_TIMEOUT', 'safe-request-id', {
          source: 'QWEN_USAGE_ONLY',
          latencyMs: 17,
          failureType: 'TIMEOUT',
        });
      }),
    };
    const result = await runBenchmark(failed, 'qwen-flash', 'ONE_SHOT', 1, {
      idea: 'private idea',
      ageRange: '5-7',
      theme: 't',
      style: 's',
      requestedPageCount: 10,
    });
    expect(result).toMatchObject({
      success: false,
      timeout: true,
      errorCode: 'PROVIDER_TIMEOUT',
      providerCalls: [{ latencyMs: 17, providerRequestId: 'safe-request-id' }],
    });
    expect(JSON.stringify(result)).not.toContain('private idea');
  });
});
