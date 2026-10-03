import { mkdir, readFile, writeFile } from 'node:fs/promises';

const RAW_PATH = 'benchmarks/image/raw/raw-20261003T022843Z.json';
const RESULTS_PATH = 'benchmarks/image/results/qwen-vs-zimage-20261003.json';
const REVIEW_PATH = 'benchmarks/image/PER_IMAGE_REVIEW.json';
const models = new Set(['qwen-image-3.0', 'z-image-turbo']);
const ratingFields = ['characterConsistency', 'promptAdherence', 'illustrationQuality'];

const keyOf = (run) => `${run.model}:${run.promptId}:${run.runNumber}`;
const safeString = (value) => (typeof value === 'string' ? value : '');

export const reviewTemplate = (runs) =>
  runs.map((run) => ({
    model: run.model,
    promptId: run.promptId,
    runNumber: run.runNumber,
    characterConsistency: null,
    promptAdherence: null,
    illustrationQuality: null,
    notes: '',
    obviousTechnicalDefects: [],
  }));

const validateReviews = (runs, reviews, allowIncomplete) => {
  if (!Array.isArray(reviews) || reviews.length !== runs.length)
    throw new Error(`ratings must contain exactly ${runs.length} records`);
  const expected = new Set(runs.map(keyOf));
  const seen = new Set();
  for (const review of reviews) {
    if (
      !models.has(review?.model) ||
      typeof review?.promptId !== 'string' ||
      !Number.isInteger(review?.runNumber)
    )
      throw new Error('ratings contain an invalid run identity');
    const key = keyOf(review);
    if (!expected.has(key) || seen.has(key))
      throw new Error(`ratings do not uniquely match run ${key}`);
    seen.add(key);
    for (const field of ratingFields) {
      const value = review[field];
      if (!allowIncomplete && value === null) throw new Error(`${key} ${field} is missing`);
      if (
        value !== null &&
        value !== 'N/A' &&
        !(typeof value === 'number' && value >= 1 && value <= 5)
      )
        throw new Error(`${key} ${field} must be 1-5, N/A, or null`);
    }
    if (typeof review.notes !== 'string' || !Array.isArray(review.obviousTechnicalDefects))
      throw new Error(`${key} review fields are invalid`);
  }
  if (seen.size !== expected.size) throw new Error('ratings are missing one or more runs');
};

export const buildArtifact = (raw, reviews, reviewStatus = 'complete', allowIncomplete = false) => {
  const runs = raw.runs;
  validateReviews(runs, reviews, allowIncomplete);
  const byKey = new Map(reviews.map((review) => [keyOf(review), review]));
  return {
    schemaVersion: 1,
    reviewStatus,
    sourceArtifact: 'raw-20261003T022843Z.json',
    generatedAt: new Date().toISOString(),
    models: raw.models,
    requestedRuns: runs.length,
    runs: runs.map((run) => {
      const review = byKey.get(keyOf(run));
      return {
        model: run.model,
        promptId: run.promptId,
        runNumber: run.runNumber,
        success: run.success,
        generationLatencyMs: run.generationLatencyMs,
        providerRequestId: run.providerRequestId ?? null,
        outputReference: run.outputReference ?? null,
        width: run.width ?? null,
        height: run.height ?? null,
        errorCode: run.errorCode ?? null,
        errorStage: run.errorStage ?? null,
        httpStatus: run.httpStatus ?? null,
        providerErrorCode: run.providerErrorCode ?? null,
        obviousTechnicalDefects: review.obviousTechnicalDefects,
        manualReview: {
          characterConsistency: review.characterConsistency,
          promptAdherence: review.promptAdherence,
          illustrationQuality: review.illustrationQuality,
          notes: safeString(review.notes),
        },
      };
    }),
  };
};

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.replace(/^--/u, '').split('=');
    return [key, rest.join('=')];
  }),
);
if (process.argv[1]?.endsWith('/finalize.mjs')) {
  const raw = JSON.parse(await readFile(RAW_PATH, 'utf8'));
  if (args.has('init')) {
    await mkdir('benchmarks/image/results', { recursive: true });
    const reviews = reviewTemplate(raw.runs);
    await writeFile(REVIEW_PATH, `${JSON.stringify(reviews, null, 2)}\n`);
    const artifact = buildArtifact(raw, reviews, 'pending', true);
    await writeFile(RESULTS_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`Wrote ${REVIEW_PATH} and ${RESULTS_PATH}`);
    process.exit(0);
  }
  const ratingsPath = args.get('ratings') ?? REVIEW_PATH;
  const reviews = JSON.parse(await readFile(ratingsPath, 'utf8'));
  const artifact = buildArtifact(raw, reviews);
  await mkdir('benchmarks/image/results', { recursive: true });
  await writeFile(RESULTS_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${RESULTS_PATH}`);
}
