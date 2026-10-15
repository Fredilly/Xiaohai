import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { runImagePreflight } from './image-preflight.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function extractMiniProgramStagingUrl(source) {
  const match = source.match(/staging:\s*['"]([^'"]+)['"]/u);
  return match?.[1] ?? null;
}

export function validateHttpsPublicUrl(value, label) {
  if (!value) return [`${label} is missing`];

  let url;
  try {
    url = new URL(value);
  } catch {
    return [`${label} must be a valid URL`];
  }

  const failures = [];
  if (url.protocol !== 'https:') failures.push(`${label} must use HTTPS`);
  if (LOCAL_HOSTS.has(url.hostname)) failures.push(`${label} must not use localhost`);
  if (url.hostname.endsWith('.invalid')) failures.push(`${label} still uses a placeholder domain`);
  return failures;
}

export function validatePublicBosObjectUrl(value, publicOrigin) {
  const failures = [
    ...validateHttpsPublicUrl(value, 'BOS_PREFLIGHT_OBJECT_URL'),
    ...validateHttpsPublicUrl(publicOrigin, 'BAIDU_BOS_PUBLIC_ORIGIN'),
  ];
  if (failures.length > 0) return failures;

  const objectUrl = new URL(value);
  const originUrl = new URL(publicOrigin);
  if (objectUrl.origin !== originUrl.origin) {
    failures.push('BOS_PREFLIGHT_OBJECT_URL must use BAIDU_BOS_PUBLIC_ORIGIN');
  }
  if (objectUrl.search || objectUrl.hash) {
    failures.push('BOS_PREFLIGHT_OBJECT_URL must be a stable public URL without query/hash');
  }
  return failures;
}

export function validatePaidImageConfiguration(env) {
  if (env.PICTURE_BOOK_IMAGE_ENABLED !== 'true' || env.PICTURE_BOOK_IMAGE_PROVIDER !== 'BAILIAN') {
    return ['paid image preflight requires PICTURE_BOOK_IMAGE_ENABLED=true and provider BAILIAN'];
  }

  const required = [
    'PICTURE_BOOK_IMAGE_MODEL',
    'PICTURE_BOOK_IMAGE_BASE_URL',
    'BAIDU_BOS_PUBLIC_ORIGIN',
    'PICTURE_BOOK_IMAGE_BUDGET_KEY',
    'PICTURE_BOOK_IMAGE_BUDGET_RESERVATION_MINOR',
    'PICTURE_BOOK_IMAGE_BUDGET_GLOBAL_LIMIT_MINOR',
    'PICTURE_BOOK_IMAGE_BUDGET_CONSUMER_LIMIT_MINOR',
    'PICTURE_BOOK_IMAGE_BUDGET_WINDOW_KEY',
    'BOS_PREFLIGHT_OBJECT_URL',
  ];
  const failures = required
    .filter((key) => !env[key])
    .map((key) => `${key} is required for release preflight`);

  if (env.PICTURE_BOOK_IMAGE_BUDGET_ENABLED !== 'true') {
    failures.push('PICTURE_BOOK_IMAGE_BUDGET_ENABLED must be true');
  }

  if (env.PICTURE_BOOK_IMAGE_BASE_URL) {
    failures.push(
      ...validateHttpsPublicUrl(env.PICTURE_BOOK_IMAGE_BASE_URL, 'PICTURE_BOOK_IMAGE_BASE_URL'),
    );
  }
  if (env.BAIDU_BOS_PUBLIC_ORIGIN || env.BOS_PREFLIGHT_OBJECT_URL) {
    failures.push(
      ...validatePublicBosObjectUrl(env.BOS_PREFLIGHT_OBJECT_URL, env.BAIDU_BOS_PUBLIC_ORIGIN),
    );
  }

  return [...new Set(failures)];
}

export async function probeApiReady(apiBaseUrl, fetchImpl = fetch) {
  const response = await fetchImpl(new URL('/ready', apiBaseUrl), {
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return false;

  try {
    const payload = await response.json();
    return payload?.status === 'ready';
  } catch {
    return false;
  }
}

export async function probeBosObject(objectUrl, fetchImpl = fetch) {
  const response = await fetchImpl(objectUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(5_000),
  });
  return response.ok;
}

export async function runReleasePreflight({
  root = process.cwd(),
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const imageResult = await runImagePreflight(root);
  if (imageResult !== 0) return 1;

  const miniappConfig = await readFile(resolve(root, 'apps/miniapp/config.ts'), 'utf8');
  const stagingApiUrl = extractMiniProgramStagingUrl(miniappConfig);
  const failures = [
    ...validateHttpsPublicUrl(stagingApiUrl, 'Mini Program staging API'),
    ...validatePaidImageConfiguration(env),
  ];

  if (failures.length > 0) {
    for (const failure of failures) console.error(`Release preflight: ${failure}.`);
    return 1;
  }

  let apiReady = false;
  let bosReady = false;
  try {
    apiReady = await probeApiReady(stagingApiUrl, fetchImpl);
  } catch {
    apiReady = false;
  }
  try {
    bosReady = await probeBosObject(env.BOS_PREFLIGHT_OBJECT_URL, fetchImpl);
  } catch {
    bosReady = false;
  }

  if (!apiReady) {
    console.error('Release preflight: staging API /ready is unreachable or unavailable.');
  }
  if (!bosReady) {
    console.error('Release preflight: public BOS smoke object is unreachable.');
  }
  if (!apiReady || !bosReady) return 1;

  console.log(
    'Release preflight passed: local build/schema checks, staging API readiness, BOS public object, and paid-image configuration are valid. No AI provider request was made.',
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = await runReleasePreflight();
}
