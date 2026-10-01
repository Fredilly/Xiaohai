import {
  parseStructuredStoryJson,
  type StructuredStory,
} from '../../packages/contracts/src/story.js';
import {
  QwenAiProvider,
  ProviderError,
  type AiProvider,
  type AiProviderResult,
} from '../../apps/worker/src/ai-provider.js';

export type Strategy = 'ONE_SHOT' | 'OUTLINE_FIRST';

export type BenchmarkInput = {
  idea: string;
  ageRange: string;
  theme: string;
  style: string;
  requestedPageCount: number;
};

export type ProviderCallRecord = {
  latencyMs: number | null;
  ttftMs: null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
};

export type BenchmarkRun = {
  strategy: Strategy;
  runNumber: number;
  requestedPageCount: number;
  actualPageCount: number | null;
  success: boolean;
  totalLatencyMs: number;
  providerCalls: ProviderCallRecord[];
  retries: number;
  timeout: boolean;
  regenerationNeeded: boolean;
  structuredValidation: 'PASSED' | 'FAILED' | 'NOT_RUN';
  characterCount: number | null;
  qualityNotes: string[];
  errorCode: string | null;
};

export type BenchmarkSummary = {
  strategy: Strategy;
  runCount: number;
  successCount: number;
  successRate: number;
  p50TotalLatencyMs: number | null;
  slowestRunMs: number | null;
  averageInputTokens: number | null;
  averageOutputTokens: number | null;
  averageTotalTokens: number | null;
  timeoutCount: number;
  failureCount: number;
  regenerationCount: number;
  structuralQualityProblems: number;
  providerCallCount: number;
};

export type BenchmarkProvider = Pick<AiProvider, 'generate'>;

const basePrompt = (input: BenchmarkInput) =>
  [
    '你是小海童话的儿童故事创作助手。',
    `目标年龄：${input.ageRange}`,
    `主题：${input.theme}`,
    `风格：${input.style}`,
    `用户想法：${input.idea}`,
    `REQUESTED_PAGE_COUNT=${input.requestedPageCount}`,
    '输出适龄、温和、清晰的儿童故事。',
  ].join('\n');

const structuredInstruction = (input: BenchmarkInput) =>
  [
    'XIAOHAI_TASK=STRUCTURED_STORY',
    '输出严格 JSON，不要 Markdown，不要额外说明。',
    'JSON 必须包含 title、outline、characters、pages。',
    '每个角色必须包含 name、description、visualDescription。',
    `pages 必须恰好 ${input.requestedPageCount} 页，pageNumber 从 1 连续到 ${input.requestedPageCount}。`,
    '每页必须包含非空 scene 和 text。',
  ].join('\n');

const outlineInstruction = '只输出简短完整的故事大纲，不要输出正文或 JSON。';

function callRecord(result: AiProviderResult): ProviderCallRecord {
  return {
    latencyMs:
      typeof result.costMetadata.latencyMs === 'number' ? result.costMetadata.latencyMs : null,
    ttftMs: null,
    inputTokens: result.usage.inputTokens ?? null,
    outputTokens: result.usage.outputTokens ?? null,
    totalTokens: result.usage.totalTokens ?? null,
    providerRequestId: result.providerRequestId ?? null,
  };
}

function safeError(error: unknown): { code: string; timeout: boolean } {
  if (error instanceof ProviderError) {
    return { code: error.code, timeout: error.code === 'PROVIDER_TIMEOUT' };
  }
  return { code: 'BENCHMARK_CALL_FAILED', timeout: false };
}

async function generate(
  provider: BenchmarkProvider,
  model: string,
  prompt: string,
  timeoutMs: number,
  responseFormat?: 'json_object',
): Promise<{
  result?: AiProviderResult;
  error?: string;
  timeout: boolean;
  call?: ProviderCallRecord;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await provider.generate({
      model,
      prompt,
      signal: controller.signal,
      ...(responseFormat ? { responseFormat } : {}),
    });
    return { result, timeout: false, call: callRecord(result) };
  } catch (error) {
    const safe = safeError(error);
    const providerError = error instanceof ProviderError ? error : null;
    return {
      error: safe.code,
      timeout: safe.timeout,
      call: {
        latencyMs: providerError?.failureMetadata?.latencyMs ?? null,
        ttftMs: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        providerRequestId: providerError?.providerRequestId ?? null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runBenchmark(
  provider: BenchmarkProvider,
  model: string,
  strategy: Strategy,
  runNumber: number,
  input: BenchmarkInput,
  timeoutMs = 60_000,
): Promise<BenchmarkRun> {
  const started = Date.now();
  const calls: ProviderCallRecord[] = [];
  let timeout = false;
  let errorCode: string | null = null;
  let structuredValidation: BenchmarkRun['structuredValidation'] = 'NOT_RUN';
  let story: StructuredStory | null = null;

  const first = await generate(
    provider,
    model,
    strategy === 'ONE_SHOT'
      ? `${basePrompt(input)}\n${structuredInstruction(input)}`
      : `${basePrompt(input)}\n${outlineInstruction}`,
    timeoutMs,
    strategy === 'ONE_SHOT' ? 'json_object' : undefined,
  );
  if (first.call) calls.push(first.call);
  if (!first.result) {
    errorCode = first.error ?? 'BENCHMARK_CALL_FAILED';
    timeout = first.timeout;
  }

  if (first.result && strategy === 'ONE_SHOT') {
    try {
      story = parseStructuredStoryJson(first.result.text, input.requestedPageCount);
      structuredValidation = 'PASSED';
    } catch {
      structuredValidation = 'FAILED';
      errorCode = 'STRUCTURED_VALIDATION_FAILED';
    }
  }

  if (first.result && strategy === 'OUTLINE_FIRST') {
    const second = await generate(
      provider,
      model,
      `${basePrompt(input)}\n参考大纲（仅用于本次生成）：${first.result.text}\n${structuredInstruction(input)}`,
      timeoutMs,
      'json_object',
    );
    if (second.call) calls.push(second.call);
    if (!second.result) {
      errorCode = second.error ?? 'BENCHMARK_CALL_FAILED';
      timeout = second.timeout;
    }
    if (second.result) {
      try {
        story = parseStructuredStoryJson(second.result.text, input.requestedPageCount);
        structuredValidation = 'PASSED';
      } catch {
        structuredValidation = 'FAILED';
        errorCode = 'STRUCTURED_VALIDATION_FAILED';
      }
    }
  }

  return {
    strategy,
    runNumber,
    requestedPageCount: input.requestedPageCount,
    actualPageCount: story?.pages.length ?? null,
    success: story !== null,
    totalLatencyMs: Date.now() - started,
    providerCalls: calls,
    retries: 0,
    timeout,
    regenerationNeeded: false,
    structuredValidation,
    characterCount: story?.characters.length ?? null,
    qualityNotes: story ? [] : ['STRUCTURAL_OUTPUT_UNAVAILABLE'],
    errorCode,
  };
}

export function summarize(strategy: Strategy, runs: BenchmarkRun[]): BenchmarkSummary {
  const successful = runs.filter((run) => run.success);
  const values = (field: keyof ProviderCallRecord) =>
    runs
      .flatMap((run) => run.providerCalls.map((call) => call[field]))
      .filter((value): value is number => typeof value === 'number');
  const average = (items: number[]) =>
    items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
  const sortedLatency = successful.map((run) => run.totalLatencyMs).sort((a, b) => a - b);
  const p50 = sortedLatency.length
    ? sortedLatency[Math.floor((sortedLatency.length - 1) / 2)]!
    : null;
  return {
    strategy,
    runCount: runs.length,
    successCount: successful.length,
    successRate: runs.length ? successful.length / runs.length : 0,
    p50TotalLatencyMs: p50,
    slowestRunMs: runs.length ? Math.max(...runs.map((run) => run.totalLatencyMs)) : null,
    averageInputTokens: average(values('inputTokens')),
    averageOutputTokens: average(values('outputTokens')),
    averageTotalTokens: average(values('totalTokens')),
    timeoutCount: runs.filter((run) => run.timeout).length,
    failureCount: runs.filter((run) => !run.success).length,
    regenerationCount: runs.filter((run) => run.regenerationNeeded).length,
    structuralQualityProblems: runs.filter((run) => run.structuredValidation !== 'PASSED').length,
    providerCallCount: runs.reduce((sum, run) => sum + run.providerCalls.length, 0),
  };
}

export function createQwenProvider(apiKey: string, baseUrl: string) {
  return new QwenAiProvider(apiKey, baseUrl);
}
