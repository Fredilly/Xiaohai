import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createBaiduBosStorage } from '../../apps/worker/src/bos-storage.js';
import { createMockImageProvider } from './runner.js';
import {
  benchmarkModels,
  createBailianImageProvider,
  runImageBenchmark,
  summarize,
  type BenchmarkModel,
  type ImageRun,
} from './runner.js';
import { imagePrompts } from './prompts.js';

function loadLocalEnv() {
  const candidates = [path.resolve('.env'), path.resolve('../../.env')];
  const envPath = candidates.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!envPath) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const match = raw.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
    const key = match?.[1];
    if (key && process.env[key] === undefined) process.env[key] = match[2]!.replace(/^"|"$/gu, '');
  }
}

loadLocalEnv();
const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.replace(/^--/u, '').split('=');
    return [key, rest.join('=')];
  }),
);
const requestedModel = args.get('model');
const models = requestedModel ? [requestedModel as BenchmarkModel] : [...benchmarkModels];
const runs = Number(args.get('runs') ?? 3);
const dryRun = args.has('dry-run');
if (models.some((model) => !benchmarkModels.includes(model)))
  throw new Error('--model must be qwen-image-3.0 or z-image-turbo');
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');

const outputRoot = path.resolve(process.env.INIT_CWD ?? process.cwd(), 'benchmarks/image');
await mkdir(path.join(outputRoot, 'raw'), { recursive: true });
await mkdir(path.join(outputRoot, 'outputs'), { recursive: true });
const providers = new Map<BenchmarkModel, ReturnType<typeof createMockImageProvider>>();
if (dryRun) {
  for (const model of models) providers.set(model, createMockImageProvider());
} else {
  const bosRequired = [
    'BAIDU_BOS_ENDPOINT',
    'BAIDU_BOS_BUCKET',
    'BAIDU_BOS_PUBLIC_ORIGIN',
    'BAIDU_BOS_ACCESS_KEY_ID',
    'BAIDU_BOS_SECRET_ACCESS_KEY',
  ];
  const missing = bosRequired.filter((key) => !process.env[key]);
  if (missing.length) throw new Error('Missing required BOS benchmark configuration');
  for (const model of models) {
    const apiKey =
      model === 'z-image-turbo'
        ? (process.env.Z_IMAGE_API_KEY ?? process.env.DASHSCOPE_API_KEY)
        : process.env.DASHSCOPE_API_KEY;
    const baseUrl =
      model === 'z-image-turbo'
        ? (process.env.Z_IMAGE_BASE_URL ?? process.env.DASHSCOPE_BASE_URL)
        : process.env.DASHSCOPE_BASE_URL;
    if (!apiKey || !baseUrl) throw new Error(`Missing image provider configuration for ${model}`);
    const storage = createBaiduBosStorage({
      endpoint: process.env.BAIDU_BOS_ENDPOINT!,
      bucket: process.env.BAIDU_BOS_BUCKET!,
      publicOrigin: process.env.BAIDU_BOS_PUBLIC_ORIGIN!,
      accessKeyId: process.env.BAIDU_BOS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.BAIDU_BOS_SECRET_ACCESS_KEY!,
    });
    providers.set(model, createBailianImageProvider(apiKey, baseUrl, storage));
  }
}

const allRuns: ImageRun[] = [];
for (const model of models)
  for (const prompt of imagePrompts)
    for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
      allRuns.push(await runImageBenchmark(providers.get(model)!, model, prompt, runNumber));
    }
const summaries = models.map((model) =>
  summarize(
    model,
    allRuns.filter((run) => run.model === model),
  ),
);
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/gu, '')
  .replace(/\.\d{3}Z$/u, 'Z');
const artifact = {
  generatedAt: new Date().toISOString(),
  models,
  runsPerModel: runs,
  promptCount: imagePrompts.length,
  promptIds: imagePrompts.map((prompt) => prompt.promptId),
  recurringCharacterDescription:
    'See prompt matrix source; identical across recurring-character prompts.',
  runs: allRuns,
  summaries,
  humanScoring: 'Fill humanRating fields after visual review.',
};
await writeFile(
  path.join(outputRoot, 'raw', `raw-${timestamp}.json`),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
const report = [
  `# Image Benchmark Manifest`,
  ``,
  `Models: ${models.join(', ')}`,
  `Runs per model: ${runs}`,
  `Prompts: ${imagePrompts.length}`,
  `Total provider calls: ${allRuns.length}`,
  ``,
  ...summaries.map(
    (summary) =>
      `- ${summary.model}: ${summary.successCount}/${summary.totalRuns} success; p50 ${summary.p50LatencyMs ?? 'null'} ms; p95 ${summary.p95LatencyMs ?? 'null'} ms; failures ${summary.failureCount}`,
  ),
  ``,
  `Quality ratings are intentionally blank for manual review. TTFT is not available from the current non-streaming image provider.`,
  ``,
].join('\n');
await writeFile(path.join(outputRoot, 'REPORT.md'), report);
console.log(
  JSON.stringify(
    {
      outputRoot,
      models,
      promptCount: imagePrompts.length,
      runsPerModel: runs,
      totalProviderCalls: allRuns.length,
      summaries,
    },
    null,
    2,
  ),
);
