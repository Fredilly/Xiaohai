import {
  ImageProviderError,
  MockImageProvider,
  type ImageGenerationResult,
  type ImageProvider,
} from '../../apps/worker/src/image-provider.js';
import type { BosStorage } from '../../apps/worker/src/bos-storage.js';
import { imagePrompts, type ImagePrompt } from './prompts.js';
import {
  BenchmarkImageProviderError,
  QwenBenchmarkImageProvider,
  ZImageTurboBenchmarkProvider,
} from './providers.js';

export const benchmarkModels = ['qwen-image-3.0', 'z-image-turbo'] as const;
export type BenchmarkModel = (typeof benchmarkModels)[number];

export type HumanRating = {
  characterConsistency: number | null;
  promptAdherence: number | null;
  illustrationQuality: number | null;
  notes: string;
};

export type ImageRun = {
  model: BenchmarkModel;
  promptId: string;
  runNumber: number;
  success: boolean;
  generationLatencyMs: number | null;
  providerRequestId: string | null;
  outputReference: string | null;
  width: number | null;
  height: number | null;
  obviousTechnicalDefects: string[];
  errorCode: string | null;
  humanRating: HumanRating;
};

export type ImageSummary = {
  model: BenchmarkModel;
  totalRuns: number;
  successCount: number;
  successRate: number;
  failureCount: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type BenchmarkImageProvider = Pick<ImageProvider, 'generate'>;

const emptyRating = (): HumanRating => ({
  characterConsistency: null,
  promptAdherence: null,
  illustrationQuality: null,
  notes: '',
});

function safeError(error: unknown): { code: string; requestId: string | null } {
  if (error instanceof ImageProviderError) {
    return { code: error.code, requestId: error.details.providerRequestId ?? null };
  }
  if (error instanceof BenchmarkImageProviderError) {
    return { code: error.code, requestId: error.details.providerRequestId ?? null };
  }
  return { code: 'IMAGE_BENCHMARK_FAILED', requestId: null };
}

export async function runImageBenchmark(
  provider: BenchmarkImageProvider,
  model: BenchmarkModel,
  prompt: ImagePrompt,
  runNumber: number,
  timeoutMs = 180_000,
): Promise<ImageRun> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await provider.generate({
      generationKey: `benchmark-${model}-${prompt.promptId}-${runNumber}`,
      model,
      prompt: prompt.prompt,
      consistency: [],
      signal: controller.signal,
    });
    return {
      model,
      promptId: prompt.promptId,
      runNumber,
      success: true,
      generationLatencyMs: Date.now() - started,
      providerRequestId: result.providerRequestId,
      outputReference: result.playbackUrl || result.objectKey,
      width: null,
      height: null,
      obviousTechnicalDefects: [],
      errorCode: null,
      humanRating: emptyRating(),
    };
  } catch (error) {
    const safe = safeError(error);
    return {
      model,
      promptId: prompt.promptId,
      runNumber,
      success: false,
      generationLatencyMs: Date.now() - started,
      providerRequestId: safe.requestId,
      outputReference: null,
      width: null,
      height: null,
      obviousTechnicalDefects: [],
      errorCode: safe.code,
      humanRating: emptyRating(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function summarize(model: BenchmarkModel, runs: ImageRun[]): ImageSummary {
  const latencies = runs
    .filter((run) => run.success && typeof run.generationLatencyMs === 'number')
    .map((run) => run.generationLatencyMs!)
    .sort((a, b) => a - b);
  const percentile = (percent: number) =>
    latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * percent) - 1)]! : null;
  return {
    model,
    totalRuns: runs.length,
    successCount: runs.filter((run) => run.success).length,
    successRate: runs.length ? runs.filter((run) => run.success).length / runs.length : 0,
    failureCount: runs.filter((run) => !run.success).length,
    p50LatencyMs: percentile(0.5),
    p95LatencyMs: percentile(0.95),
  };
}

export function createQwenBenchmarkProvider(
  apiKey: string,
  baseUrl: string,
  storage: BosStorage,
): BenchmarkImageProvider {
  return new QwenBenchmarkImageProvider(apiKey, baseUrl, storage);
}

export function createZImageBenchmarkProvider(
  apiKey: string,
  baseUrl: string,
  storage: BosStorage,
): BenchmarkImageProvider {
  return new ZImageTurboBenchmarkProvider(apiKey, baseUrl, storage);
}

export function createMockImageProvider(): ImageProvider {
  return new MockImageProvider();
}

export type { ImageGenerationResult };

export const selectImagePrompts = (promptId?: string): ImagePrompt[] => {
  if (!promptId) return imagePrompts;
  const normalized = promptId === 'character-portrait' ? 'portrait-child-friendly' : promptId;
  return imagePrompts.filter((prompt) => prompt.promptId === normalized);
};
