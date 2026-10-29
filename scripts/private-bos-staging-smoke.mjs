import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is a read-only, non-AI staging smoke: it never uploads an object or
// requests a paid model. The operator supplies short-lived URLs via environment.
const FIELDS = [
  'BAIDU_BOS_BUCKET',
  'BAIDU_BOS_ENDPOINT',
  'BAIDU_BOS_PUBLIC_ORIGIN',
  'BOS_PRIVATE_SMOKE_UNSIGNED_URL',
  'BOS_PRIVATE_SMOKE_SIGNED_URL',
  'BOS_PRIVATE_SMOKE_EXPIRED_URL',
];

export function validatePrivateBosSmoke(env) {
  const failures = [];
  for (const name of FIELDS) {
    if (!env[name] || env[name].startsWith('INJECT_')) failures.push(name + ' is missing');
  }
  if (failures.length) return { failures };

  try {
    const bucket = env.BAIDU_BOS_BUCKET;
    const endpoint = new URL(env.BAIDU_BOS_ENDPOINT);
    const origin = new URL(env.BAIDU_BOS_PUBLIC_ORIGIN);
    if (
      !/^[a-z0-9-]{4,63}$/.test(bucket) ||
      endpoint.protocol !== 'https:' ||
      !endpoint.hostname.endsWith('.bcebos.com') ||
      endpoint.origin !== endpoint.href.replace(/\/$/, '') ||
      origin.protocol !== 'https:' ||
      origin.hostname !== bucket + '.' + endpoint.hostname ||
      origin.origin !== origin.href.replace(/\/$/, '')
    ) {
      return { failures: ['invalid private BOS bucket/endpoint/origin configuration'] };
    }

    const unsigned = new URL(env.BOS_PRIVATE_SMOKE_UNSIGNED_URL);
    const signed = new URL(env.BOS_PRIVATE_SMOKE_SIGNED_URL);
    const expired = new URL(env.BOS_PRIVATE_SMOKE_EXPIRED_URL);
    const urls = [unsigned, signed, expired];
    if (
      urls.some(
        (url) =>
          url.protocol !== 'https:' ||
          url.port ||
          url.username ||
          url.password ||
          url.hash ||
          ![endpoint.hostname, origin.hostname].includes(url.hostname),
      ) ||
      unsigned.hostname !== origin.hostname ||
      unsigned.search ||
      !signed.search ||
      !expired.search ||
      signed.search === expired.search
    ) {
      return { failures: ['private BOS smoke URLs have unsafe hosts or signatures'] };
    }

    function key(url) {
      const path = url.pathname;
      const prefix = url.hostname === endpoint.hostname ? '/' + bucket + '/' : '/';
      if (!path.startsWith(prefix)) return null;
      const objectKey = path.slice(prefix.length);
      if (
        !objectKey.startsWith('picture-books/') ||
        !/^[A-Za-z0-9_/.-]+\.png$/.test(objectKey) ||
        objectKey.length > 512 ||
        objectKey.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      ) {
        return null;
      }
      return objectKey;
    }

    const objectKey = key(unsigned);
    if (!objectKey || objectKey !== key(signed) || objectKey !== key(expired)) {
      return { failures: ['private BOS smoke URLs must target the same synthetic image'] };
    }
    return { failures: [], unsigned, signed, expired };
  } catch {
    return { failures: ['invalid private BOS smoke URL configuration'] };
  }
}

export async function runPrivateBosSmoke({
  env = process.env,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const targets = validatePrivateBosSmoke(env);
  if (targets.failures.length) {
    for (const reason of targets.failures) logger.error('Private BOS smoke: ' + reason);
    return 1;
  }

  const cases = [
    { label: 'unsigned-private-object', url: targets.unsigned, expected: 403 },
    { label: 'signed-get', url: targets.signed, expected: 200 },
    { label: 'expired-signed-get', url: targets.expired, expected: 403 },
  ];
  for (const item of cases) {
    let response;
    try {
      response = await fetchImpl(item.url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      logger.error('Private BOS smoke: ' + item.label + ' network failure');
      return 1;
    }
    const status = response.status;
    const contentType = response.headers.get('content-type') ?? '';
    try {
      await response.body?.cancel();
    } catch {
      // We intentionally never read or save the image body.
    }
    if (
      status !== item.expected ||
      (item.expected === 200 && !/^image\/png(?:;|$)/i.test(contentType))
    ) {
      logger.error('Private BOS smoke: ' + item.label + ' unexpected HTTP status/content type');
      return 1;
    }
    logger.log('Private BOS smoke: ' + item.label + ' PASS');
  }
  logger.log('Private BOS smoke PASS: GET-only, no AI provider call, no secrets printed.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPrivateBosSmoke();
}
