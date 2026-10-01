import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MockAiProvider } from '../../apps/worker/src/ai-provider.js';
import {
  createQwenProvider,
  runBenchmark,
  summarize,
  type BenchmarkInput,
  type BenchmarkRun,
  type Strategy,
} from './runner.js';

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
const runs = Number(args.get('runs') ?? 5);
const requestedPageCount = Number(args.get('page-count') ?? 10);
const model = process.env.STORY_AI_MODEL || 'qwen-flash';
const dryRun = args.has('dry-run');
const strategyArgument = args.get('strategy');
const strategies: Strategy[] = strategyArgument
  ? [strategyArgument as Strategy]
  : ['ONE_SHOT', 'OUTLINE_FIRST'];
if (strategies.some((strategy) => !['ONE_SHOT', 'OUTLINE_FIRST'].includes(strategy)))
  throw new Error('--strategy must be ONE_SHOT or OUTLINE_FIRST');
const apiKey = process.env.DASHSCOPE_API_KEY;
const baseUrl = process.env.DASHSCOPE_BASE_URL || process.env.QWEN_BASE_URL;
if (!dryRun && (!apiKey || !baseUrl))
  throw new Error('Missing DASHSCOPE_API_KEY or DashScope base URL');
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
if (![10, 15].includes(requestedPageCount)) throw new Error('--page-count must be 10 or 15');

const input: BenchmarkInput = {
  idea: '一只胆小的小狐狸帮助迷路的小鸟回家',
  ageRange: '5-7',
  theme: '勇气与帮助他人',
  style: '温暖童话',
  requestedPageCount,
};
const provider = dryRun ? new MockAiProvider() : createQwenProvider(apiKey!, baseUrl!);
const allRuns: BenchmarkRun[] = [];
for (const strategy of strategies) {
  for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
    allRuns.push(await runBenchmark(provider, model, strategy, runNumber, input));
  }
}
const summaries = strategies.map((strategy) =>
  summarize(
    strategy as Strategy,
    allRuns.filter((run) => run.strategy === strategy),
  ),
);
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/gu, '')
  .replace(/\.\d{3}Z$/u, 'Z');
const outputDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), 'benchmarks/story/raw');
await mkdir(outputDir, { recursive: true });
const artifact = {
  generatedAt: new Date().toISOString(),
  model,
  requestedPageCount,
  input: { ...input },
  runs: allRuns,
  summaries,
  recommendation: null,
};
const outputPath = path.join(outputDir, `raw-${timestamp}.json`);
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      outputPath,
      runCount: allRuns.length,
      providerCallCount: allRuns.reduce((sum, run) => sum + run.providerCalls.length, 0),
      summaries,
    },
    null,
    2,
  ),
);
