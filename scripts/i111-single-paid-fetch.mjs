import { I111_ONE_SHOT_SCOPE as scope } from './i111-one-shot-policy.mjs';

/**
 * Fail-closed fetch transport for a FUTURE source-bound BailianImageProvider.
 * Its only billable operation is one exact Beijing Qwen Image POST. The POST
 * allowance is consumed before awaiting the network call, even on timeout or
 * ambiguous failures. A second POST is never attempted in this process.
 *
 * This is an in-memory guard, not a live executor, owner grant, atomic runtime
 * isolation proof, or evidence that an upstream network library never retries.
 * The reviewed Phase A/B STOP gates remain binding.
 */
const STOP_CODE = 'I111_IMAGE_TRANSPORT_STOP';
const EXPECTED_BUCKET = 'xiaohai-i111-work-2ec3900280.cd.bcebos.com';

class Stop extends Error {
  constructor() {
    super(STOP_CODE);
  }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function trustedUrl(value, host) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === host &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      url.port === ''
    );
  } catch {
    return false;
  }
}

function trustedDownloadUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname !== 'aliyuncs.com' &&
      parsed.hostname.endsWith('.aliyuncs.com') &&
      trustedUrl(value, parsed.hostname)
    );
  } catch {
    return false;
  }
}

function validPaidRequest(url, init, expectedEndpoint) {
  if (url !== expectedEndpoint || !init || init.method !== 'POST') return false;
  if (typeof init.body !== 'string' || init.body.length > 100_000) return false;
  try {
    const payload = JSON.parse(init.body);
    return (
      exactKeys(payload, ['model', 'prompt', 'image', 'n', 'size']) &&
      payload.model === scope.model &&
      typeof payload.prompt === 'string' &&
      payload.prompt.length > 0 &&
      payload.n === 1 &&
      payload.size === '1024x1024' &&
      Array.isArray(payload.image) &&
      payload.image.length === 2 &&
      payload.image.every((ref) => typeof ref === 'string' && trustedUrl(ref, EXPECTED_BUCKET)) &&
      payload.image[0] !== payload.image[1]
    );
  } catch {
    return false;
  }
}

export function createI111SinglePaidFetch({ fetcher, workspaceId }) {
  if (
    typeof fetcher !== 'function' ||
    typeof workspaceId !== 'string' ||
    !/^ws-[a-z0-9]{8,64}$/u.test(workspaceId)
  )
    throw new Stop();

  const endpoint = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations`;
  let postConsumed = false;
  let postSucceeded = false;
  let getConsumed = false;
  let stopped = false;

  const stop = () => {
    stopped = true;
    throw new Stop();
  };

  const guardedFetch = async (url, init) => {
    if (stopped) stop();
    if (!postConsumed) {
      if (!validPaidRequest(url, init, endpoint)) stop();
      // The allowance is burned BEFORE awaiting any external side effect.
      postConsumed = true;
      try {
        const response = await fetcher(url, { ...init, redirect: 'error' });
        postSucceeded = response instanceof Response && response.ok && !response.redirected;
        if (!(response instanceof Response) || response.redirected) stop();
        return response;
      } catch {
        stop();
      }
    }

    if (
      !postSucceeded ||
      getConsumed ||
      typeof url !== 'string' ||
      !init ||
      (init.method !== undefined && init.method !== 'GET') ||
      init.redirect !== 'error' ||
      !trustedDownloadUrl(url)
    )
      stop();

    // Only one image download; do not retry after a network error either.
    getConsumed = true;
    try {
      const response = await fetcher(url, init);
      if (!(response instanceof Response) || response.redirected) stop();
      return response;
    } catch {
      stop();
    }
  };

  return Object.freeze({
    fetcher: guardedFetch,
    usageSummary: () =>
      Object.freeze({
        paidPostConsumed: postConsumed,
        paidPostSucceeded: postSucceeded,
        imageDownloadConsumed: getConsumed,
        paidExecutionAuthorized: false,
      }),
  });
}
